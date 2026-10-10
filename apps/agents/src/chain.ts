/**
 * Everything the agents do on-chain.
 *
 * Note what is absent: no code path tells the program that an order was
 * paid. A merchant only ever asks the program to look at the vault
 * (`confirm_funded`), and the program decides.
 */
import { getBase58Decoder, getBase64Encoder, isSolanaError, type Address, type Instruction, type TransactionSigner } from '@solana/kit';
import { fetchMaybeToken } from '@solana-program/token';
import {
  agentPdaOf,
  configPda,
  fetchConfig,
  fetchMaybeAgent,
  fetchMaybeOrder,
  findAta,
  getCancelUnpaidInstructionAsync,
  getCloseOrderInstructionAsync,
  getConfirmFundedInstructionAsync,
  getDeliverInstructionAsync,
  getEnsureAgentInstructionAsync,
  getOpenDisputeInstruction,
  getOpenOrderInstructionAsync,
  getRefundInstruction,
  getReleaseInstruction,
  getResolveDisputeInstruction,
  getOrderDecoder,
  getSubmitReviewInstructionAsync,
  newOrderId,
  ORDER_DISCRIMINATOR,
  orderAddresses,
  OrderState,
  pairPdaOf,
  score,
  settleAccounts,
  TESSERA_PROGRAM_ADDRESS,
  type Agent,
  type Config,
  type Decoded,
  type Order,
} from '@tessera/sdk';
import { chainNow, errText, sigOf, sleep, tokenHelpers, type ScriptClient } from '../../../scripts/lib.js';

export type Actor = ScriptClient;

/** A program error means the program ran and refused. Retrying cannot change that. */
function isProgramError(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 8; e = (e as { cause?: unknown }).cause, depth += 1) {
    if (isSolanaError(e)) {
      const code = (e.context as { __code?: number }).__code ?? 0;
      if (code >= 4_615_000 && code < 4_616_000) return true;
    }
  }
  return /custom program error|AnchorError|Error Code:/.test(errText(err));
}

/**
 * Send, retrying failures that say nothing about the transaction itself (a
 * rate-limited or dropped RPC call). After each failure `landed` asks the
 * chain whether an attempt went through anyway.
 */
export async function send(
  actor: Actor,
  ixs: Instruction[],
  landed?: () => Promise<boolean>,
): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return sigOf(await actor.sendTransaction(ixs));
    } catch (err) {
      if (landed && (await landed().catch(() => false))) return '';
      if (isProgramError(err) || attempt >= 5) throw err;
      await sleep(600 * attempt + Math.random() * 400);
    }
  }
}

/** Retry a read that failed only because the RPC was busy. */
export async function read<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 6) throw err;
      await sleep(400 * attempt + Math.random() * 300);
    }
  }
}

let cachedConfig: { at: number; data: Config } | undefined;
export async function getConfig(actor: Actor): Promise<Config> {
  if (cachedConfig && Date.now() - cachedConfig.at < 60_000) return cachedConfig.data;
  const data = (await read(async () => fetchConfig(actor.rpc, await configPda()))).data;
  cachedConfig = { at: Date.now(), data };
  return data;
}

export async function readAgent(actor: Actor, wallet: Address): Promise<Agent | null> {
  const a = await read(async () => fetchMaybeAgent(actor.rpc, await agentPdaOf(wallet)));
  return a.exists ? a.data : null;
}

export async function readOrder(actor: Actor, order: Address): Promise<Order | null> {
  const o = await read(() => fetchMaybeOrder(actor.rpc, order));
  return o.exists ? o.data : null;
}

/** A wallet's score as of right now, recomputed from its account. */
export async function liveScore(actor: Actor, wallet: Address) {
  const [agent, config] = await Promise.all([readAgent(actor, wallet), getConfig(actor)]);
  if (!agent) return null;
  return { agent, ...score.evaluate(agent, config.params, await read(() => chainNow(actor))) };
}

/** Wallets known to have a credit file, so nobody asks twice. */
const hasProfile = new Set<Address>();

/**
 * Read until the chain shows what a transaction we just confirmed did. With
 * more than one RPC endpoint behind the client, a read can land on a node
 * that is a slot behind the one that confirmed the write.
 */
export async function readUntil<T>(fn: () => Promise<T>, ok: (v: T) => boolean, tries = 10): Promise<T> {
  let v = await fn();
  for (let i = 0; i < tries && !ok(v); i += 1) {
    await sleep(500);
    v = await fn();
  }
  return v;
}

export type OpenedOrder = { id: Uint8Array; order: Address; vault: Address; data: Order; signature: string };

/**
 * Open an escrow for `buyer`. `payer` fronts the rent, so a buyer holding
 * only USDC can still buy; missing credit files are created in the same
 * transaction. The merchant co-signs: the program refuses an order in a
 * merchant's name that the merchant did not agree to.
 */
export async function openOrder(
  payer: Actor,
  p: { buyer: Address; merchant: TransactionSigner; amount: bigint; requestHash: Uint8Array; minHoldSecs?: number },
): Promise<OpenedOrder> {
  const config = await getConfig(payer);
  const id = newOrderId();
  const { order, vault } = await orderAddresses(id, config.mint);
  const ixs: Instruction[] = [];
  for (const wallet of [p.buyer, p.merchant.address]) {
    if (hasProfile.has(wallet)) continue;
    if (await readAgent(payer, wallet)) hasProfile.add(wallet);
    else ixs.push(await getEnsureAgentInstructionAsync({ wallet, payer: payer.identity }));
  }
  ixs.push(
    await getOpenOrderInstructionAsync({
      mint: config.mint,
      buyer: p.buyer,
      merchant: p.merchant,
      payer: payer.identity,
      orderId: id,
      amount: p.amount,
      requestHash: p.requestHash,
      minHoldSecs: p.minHoldSecs ?? 0,
    }),
  );
  const signature = await send(payer, ixs, async () => (await readOrder(payer, order)) !== null);
  const data = await readUntil(() => readOrder(payer, order), (o) => o !== null);
  if (!data) throw new Error('order was not created');
  return { id, order, vault, data, signature };
}

/**
 * Where a field sits in an Order account: an 8-byte discriminator, the
 * 32-byte order id, then buyer, merchant, payer, mint and arbiter (32 bytes
 * each), the amount (u64), the fee (u16) and the state (u8).
 */
const ORDER_OFFSET = { merchant: 72n, payer: 104n, state: 210n } as const;

/**
 * The orders of one merchant, or one rent payer, optionally in one state.
 * The RPC filters them, so this does not download every order in the program
 * (they are kept on-chain as history, and anyone can open them).
 */
export async function findOrders(actor: Actor, where: { merchant?: Address; payer?: Address; state?: OrderState }): Promise<Decoded<Order>[]> {
  const b58 = (bytes: Uint8Array) => getBase58Decoder().decode(bytes);
  const memcmp = (offset: bigint, bytes: string) => ({ memcmp: { offset, bytes, encoding: 'base58' as const } });
  const filters = [
    memcmp(0n, b58(ORDER_DISCRIMINATOR as Uint8Array)),
    ...(where.merchant ? [memcmp(ORDER_OFFSET.merchant, where.merchant)] : []),
    ...(where.payer ? [memcmp(ORDER_OFFSET.payer, where.payer)] : []),
    ...(where.state !== undefined ? [memcmp(ORDER_OFFSET.state, b58(Uint8Array.of(where.state)))] : []),
  ];
  const rows = (await read(() =>
    actor.rpc.getProgramAccounts(TESSERA_PROGRAM_ADDRESS, { encoding: 'base64', filters: filters as never }).send(),
  )) as unknown as { pubkey: Address; account: { data: [string, string] } }[];
  const out: Decoded<Order>[] = [];
  for (const row of rows) {
    try {
      out.push({ address: row.pubkey, data: getOrderDecoder().decode(getBase64Encoder().encode(row.account.data[0])) });
    } catch {
      // an account this client cannot decode is skipped rather than trusted
    }
  }
  return out;
}

export async function vaultBalance(actor: Actor, vault: Address): Promise<bigint> {
  const t = await read(() => fetchMaybeToken(actor.rpc, vault));
  return t.exists ? t.data.amount : 0n;
}

/** Ask the program to look at the vault. Anyone may. */
export async function confirmFunded(actor: Actor, order: Address, mint: Address): Promise<string> {
  return send(actor, [await getConfirmFundedInstructionAsync({ order, mint })], async () => {
    const o = await readOrder(actor, order);
    return o !== null && o.state !== OrderState.AwaitingPayment;
  });
}

/** The buyer pays the vault itself and has the program confirm, in one transaction. */
export async function payDirect(buyer: Actor, order: Address, o: Order, vault: Address): Promise<string> {
  const tok = tokenHelpers(buyer, o.mint);
  return send(
    buyer,
    [await tok.transferIx(buyer, vault, o.amount), await getConfirmFundedInstructionAsync({ order, mint: o.mint })],
    async () => {
      const now = await readOrder(buyer, order);
      return now !== null && now.state !== OrderState.AwaitingPayment;
    },
  );
}

async function settleInput(actor: Actor, order: Address, o: Order) {
  const config = await getConfig(actor);
  return { ...(await settleAccounts(order, o, config.treasury)), authority: actor.identity };
}

/**
 * Settling pays into the buyer's, the merchant's and the treasury's token
 * accounts, so each has to exist. A party could close its own to stall a
 * release or a refund; recreating it first costs the sender a little rent and
 * takes that lever away.
 */
async function payeeAccounts(actor: Actor, o: Order): Promise<Instruction[]> {
  const config = await getConfig(actor);
  const tok = tokenHelpers(actor, o.mint);
  return Promise.all([o.buyer, o.merchant, config.treasury].map((owner) => tok.ensureAtaIx(owner)));
}

/**
 * Assert delivery. If the tiers call for no hold and the merchant is inside
 * its instant limit, take the money in the same transaction.
 */
export async function deliver(
  merchant: Actor,
  order: Address,
  o: Order,
  deliveryHash: Uint8Array,
): Promise<{ signature: string; instant: boolean }> {
  const ixs: Instruction[] = [await getDeliverInstructionAsync({ order, merchant: merchant.identity, deliveryHash })];
  let instant = false;
  if (o.holdSecs === 0) {
    const [me, config] = await Promise.all([readAgent(merchant, merchant.identity.address), getConfig(merchant)]);
    if (me && me.instantExposure + o.amount <= score.instantLimit(me, config.params)) {
      ixs.unshift(...(await payeeAccounts(merchant, o)));
      ixs.push(getReleaseInstruction(await settleInput(merchant, order, o)));
      instant = true;
    }
  }
  const signature = await send(merchant, ixs, async () => {
    const now = await readOrder(merchant, order);
    return now !== null && now.state !== OrderState.Funded;
  });
  return { signature, instant };
}

/** Crank a release. Permissionless once the hold has elapsed; the buyer may do it earlier. */
export async function release(actor: Actor, order: Address, o: Order): Promise<string> {
  return send(actor, [...(await payeeAccounts(actor, o)), getReleaseInstruction(await settleInput(actor, order, o))], async () => {
    const now = await readOrder(actor, order);
    return now !== null && now.state === OrderState.Released;
  });
}

export async function refund(actor: Actor, order: Address, o: Order): Promise<string> {
  return send(actor, [...(await payeeAccounts(actor, o)), getRefundInstruction(await settleInput(actor, order, o))], async () => {
    const now = await readOrder(actor, order);
    return now !== null && now.state === OrderState.Refunded;
  });
}

/**
 * Abandon an unpaid order as its rent payer. Anything that reached the vault
 * (a payment that came too late, or dust sent to block the cancel) goes back
 * to the buyer, whose token account is created first if it has none; that
 * costs less than the rent the cancel returns. Run again on a Cancelled order
 * whose vault was paid into after the cancel, it returns that money too.
 */
export async function cancelUnpaid(payer: Actor, order: Address, o: Order): Promise<string> {
  const tok = tokenHelpers(payer, o.mint);
  const paidIn = await vaultBalance(payer, await tok.ata(order));
  const again = o.state === OrderState.Cancelled;
  return send(
    payer,
    [
      ...(paidIn > 0n ? [await tok.ensureAtaIx(o.buyer)] : []),
      await getCancelUnpaidInstructionAsync({
        order,
        mint: o.mint,
        payer: o.payer,
        authority: payer.identity,
        ...(paidIn > 0n ? { buyerToken: await tok.ata(o.buyer) } : {}),
      }),
    ],
    // The old devnet program closed the order when it cancelled it.
    again ? undefined : async () => {
      const now = await readOrder(payer, order);
      return now === null || now.state === OrderState.Cancelled;
    },
  );
}

/** Return a settled or cancelled order's rent to whoever paid it, once the program allows. Anyone may. */
export async function closeOrder(actor: Actor, order: Address, o: Order): Promise<string> {
  return send(actor, [await getCloseOrderInstructionAsync({ order, vault: await findAta(order, o.mint), merchantAgent: await agentPdaOf(o.merchant), payer: o.payer })]);
}

export async function openDispute(buyer: Actor, order: Address, o: Order, disputeHash: Uint8Array): Promise<string> {
  return send(
    buyer,
    [
      getOpenDisputeInstruction({
        order,
        buyerAgent: await agentPdaOf(o.buyer),
        merchantAgent: await agentPdaOf(o.merchant),
        pair: await pairPdaOf(o.buyer, o.merchant),
        buyer: buyer.identity,
        disputeHash,
      }),
    ],
    async () => (await readOrder(buyer, order))?.state === OrderState.Disputed,
  );
}

export async function resolveDispute(arbiter: Actor, order: Address, o: Order, merchantBps: number): Promise<string> {
  return send(
    arbiter,
    [...(await payeeAccounts(arbiter, o)), getResolveDisputeInstruction({ ...(await settleInput(arbiter, order, o)), merchantBps })],
    async () => (await readOrder(arbiter, order))?.state === OrderState.Resolved,
  );
}

/** Rate the other party. `payer` covers the review account's rent. */
export async function submitReview(
  reviewer: Actor,
  payer: Actor,
  order: Address,
  o: Order,
  rating: number,
  text: string,
): Promise<string> {
  const reviewerIsBuyer = reviewer.identity.address === o.buyer;
  const ix = await getSubmitReviewInstructionAsync({
    order,
    subject: reviewerIsBuyer ? o.merchant : o.buyer,
    pair: await pairPdaOf(o.buyer, o.merchant),
    reviewer: reviewer.identity,
    payer: payer.identity,
    rating,
    text,
  });
  return send(payer, [ix], async () => {
    const now = await readOrder(payer, order);
    return now !== null && (reviewerIsBuyer ? now.buyerReviewed : now.merchantReviewed);
  });
}

export async function usdcBalance(actor: Actor, owner: Address, mint: Address): Promise<bigint> {
  return vaultBalance(actor, await findAta(owner, mint));
}

export { OrderState };
