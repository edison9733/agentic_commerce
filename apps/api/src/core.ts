/**
 * The core: every door (HTTP, MCP, Skill, CLI) ends up here. Each function
 * reads the chain, decides, and either answers or returns an unsigned
 * transaction for the caller's own wallet to sign. Every reply carries a
 * `status` from the contract; nothing is answered with an empty 200.
 */
import {
  createNoopSigner,
  getBase64Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  isFullySignedTransaction,
  type Address,
  type Instruction,
} from '@solana/kit';
import { getCreateAssociatedTokenIdempotentInstructionAsync, getTransferCheckedInstruction } from '@solana-program/token';
import {
  agentPdaOf,
  findAta,
  fromHex,
  fromUnits,
  getCancelUnpaidInstructionAsync,
  getConfirmFundedInstructionAsync,
  getDeliverInstructionAsync,
  getEnsureAgentInstructionAsync,
  getOpenDisputeInstruction,
  getOpenOrderInstructionAsync,
  getRefundInstruction,
  getReleaseInstruction,
  getResolveDisputeInstruction,
  getSubmitReviewInstructionAsync,
  hashJson,
  newOrderId,
  OrderState,
  OrderVerificationError,
  orderAddresses,
  pairPdaOf,
  score,
  settleAccounts,
  sha256,
  TESSERA_PROGRAM_ADDRESS,
  TIER_NAMES,
  toHex,
  toUnits,
  verifyOrderForPayment,
  type Agent,
  type Config,
  type Order,
  type Pair,
} from '@tessera/sdk';
import { chainNow, explorerAddress, explorerTx, getConfig, NETWORK, readAgent, readOrder, readPair, rpc, tokenBalance } from './chain.js';
import { HTTP_CODE, ORDER_STATES, type Action, type Decision, type Outcome, type Reason, type Status } from './contract.js';
import { buildUnsigned, type Unsigned } from './tx.js';

export type Reply = { http: number; body: Record<string, unknown> };

export const reply = (status: Status, fields: Record<string, unknown> = {}): Reply => ({ http: HTTP_CODE[status], body: { status, ...fields } });

export type Cfg = { data: Config; decimals: number };

export async function config(): Promise<Cfg | Reply> {
  const c = await getConfig();
  return c ?? reply('not_configured', { message: `The Tessera program ${TESSERA_PROGRAM_ADDRESS} has no config on this cluster.` });
}
export const isReply = (v: unknown): v is Reply => typeof v === 'object' && v !== null && 'http' in v && 'body' in v;

/** An amount both ways: raw units and USDC. */
export const money = (units: bigint, decimals: number) => ({ units: units.toString(), usdc: fromUnits(units, decimals) });

const stateName = (s: OrderState) => ORDER_STATES[s]!;
const seconds = (n: bigint) => Number(n);

/**
 * Standing penalty at which `check_payment` sends a merchant to the longest
 * hold, whatever its tier: half a lost dispute. Nobody is banned: the score
 * routes payments, it never refuses a merchant. Penalties heal a little every
 * period, so the bar sits below one dispute's worth: a lost dispute keeps a
 * merchant on the longest hold for about as many periods as it takes to heal
 * halfway (50 days at the mainnet targets), and so do two missed deliveries
 * close together. One missed delivery does not.
 */
const penaltyBarBps = (p: Config['params']) => Number(process.env.TESSERA_PENALTY_ESCROW_BPS ?? Math.floor(p.penaltyDisputeBps / 2));

// ------------------------------------------------------------------- score

function summarize(wallet: Address, a: Agent | null, cfg: Cfg, now: bigint) {
  const p = cfg.data.params;
  if (!a) {
    return {
      wallet,
      known: false,
      name: null,
      score: 0,
      tier: TIER_NAMES[0],
      holdSecs: p.holdSecs[0]!,
      message: 'No credit file: no order has ever settled through Tessera with this wallet. It scores 0 and is New.',
    };
  }
  const e = score.evaluate(a, p, now);
  const limit = score.instantLimit(a, p);
  const role = (r: Agent['asBuyer']) => ({
    orders: r.orders,
    volume: money(r.volume, cfg.decimals),
    refunds: r.refunds,
    disputes: r.disputes,
    disputesLost: r.disputesLost,
    missedDeliveries: r.expired,
    instant: r.instant,
  });
  return {
    wallet,
    known: true,
    /** Self-declared and not unique. Identify a party by its wallet, never by this. */
    name: a.name || null,
    score: e.score,
    tier: TIER_NAMES[e.tier],
    components: { history: e.history, tenure: e.tenure, diversity: e.diversity, evidence: e.evidence, rating: e.rating, behaviourBps: e.behaviour },
    stars: score.averageStars(a, p),
    reviewsReceived: a.reviewsReceived,
    penaltyBps: Number(score.currentPenalty(a, p, now)),
    activePeriods: a.activePeriods,
    holdSecs: p.holdSecs[e.tier]!,
    instant: {
      limit: money(limit, cfg.decimals),
      exposure: money(a.instantExposure, cfg.decimals),
      room: money(limit > a.instantExposure ? limit - a.instantExposure : 0n, cfg.decimals),
    },
    asMerchant: role(a.asMerchant),
    asBuyer: role(a.asBuyer),
    registeredAt: seconds(a.registeredAt),
    explorer: explorerAddress(wallet),
  };
}

export async function getScore(wallet: Address): Promise<Reply> {
  const cfg = await config();
  if (isReply(cfg)) return cfg;
  const [agent, now] = await Promise.all([readAgent(wallet), chainNow()]);
  return reply(agent ? 'ok' : 'unknown_wallet', summarize(wallet, agent, cfg, now));
}

// ----------------------------------------------------------- check_payment

export type Assessment = {
  decision: Decision;
  reason: Reason;
  message: string;
  holdSecs: number;
  merchantKnown: boolean;
  pairTrusted: boolean;
  /** Ask the merchant for at least this hold when it quotes (open_order's minHoldSecs). */
  askMinHoldSecs?: number;
};

async function assess(cfg: Cfg, merchant: Address, buyer: Address | undefined, units: bigint, minHoldSecs: number, now: bigint) {
  const [m, b, pair, balance] = await Promise.all([
    readAgent(merchant),
    buyer ? readAgent(buyer) : Promise.resolve(null),
    buyer ? readPair(buyer, merchant) : Promise.resolve(null),
    buyer ? tokenBalance(buyer, cfg.data.mint) : Promise.resolve(null),
  ]);
  return { a: decide(cfg, { merchant, buyer, units, minHoldSecs, now, m, b, pair, balance }), m, b };
}

/**
 * The decision itself, from accounts already read. `find_merchants` calls it
 * for every candidate with one read of everything, `check_payment` for one.
 */
export function decide(
  cfg: Cfg,
  i: { merchant: Address; buyer?: Address; units: bigint; minHoldSecs: number; now: bigint; m: Agent | null; b: Agent | null; pair: Pair | null; balance: bigint | null },
): Assessment {
  const { merchant, buyer, units, minHoldSecs, now, m, b, pair, balance } = i;
  const p = cfg.data.params;
  // `block` only means the payment cannot work as asked. It is never a verdict on the merchant.
  const block = (reason: Reason, message: string): Assessment => ({ decision: 'block', reason, message, holdSecs: 0, merchantKnown: !!m, pairTrusted: false });

  const a = ((): Assessment => {
    if (buyer && buyer === merchant) return block('self_dealing', 'Buyer and merchant are the same wallet.');
    if (units < p.minOrder) return block('amount_below_minimum', `The program's smallest order is ${fromUnits(p.minOrder, cfg.decimals, 0)} USDC.`);
    if (balance !== null && balance < units) {
      return block('insufficient_funds', `The buyer holds ${fromUnits(balance, cfg.decimals)} USDC, less than ${fromUnits(units, cfg.decimals)}.`);
    }
    if (!m) {
      const hold = Math.max(p.holdSecs[0]!, minHoldSecs);
      return {
        decision: 'escrow',
        reason: 'merchant_unknown',
        message: `Nobody has settled an order with this merchant. Pay only into an escrow it opens, held ${hold} s. If it cannot open one, do not pay.`,
        holdSecs: hold,
        merchantKnown: false,
        pairTrusted: false,
      };
    }
    const penalty = Number(score.currentPenalty(m, p, now));
    if (penalty >= penaltyBarBps(p)) {
      const hold = Math.max(p.holdSecs[0]!, minHoldSecs);
      return {
        decision: 'escrow',
        reason: 'merchant_penalized',
        message:
          `Not banned, but the merchant carries a ${penalty / 100}% penalty (${m.asMerchant.disputesLost} lost dispute(s), ` +
          `${m.asMerchant.expired} missed delivery(ies)). Pay only into escrow, and ask for a ${hold} s hold (minHoldSecs) when it quotes.`,
        holdSecs: hold,
        merchantKnown: true,
        pairTrusted: false,
        askMinHoldSecs: hold,
      };
    }
    const mTier = score.evaluate(m, p, now).tier;
    const bTier = b ? score.evaluate(b, p, now).tier : 0;
    const pairTrusted =
      !!pair &&
      !!b &&
      pair.orders >= p.pairHistoryMin &&
      pair.disputes === 0 &&
      pair.firstSettledAt > 0n &&
      now - pair.firstSettledAt >= BigInt(p.pairAgeSecs) &&
      score.currentPenalty(b, p, now) === 0n;
    const tierHold = score.holdFor(p, mTier, bTier, pairTrusted);
    const hold = Math.max(tierHold, minHoldSecs);
    if (hold === 0) {
      const room = score.instantLimit(m, p) - m.instantExposure;
      if (units <= room) {
        return {
          decision: 'instant',
          reason: pairTrusted && bTier < 3 ? 'pair_history' : 'both_trusted',
          message: 'Settles with delivery: there is no dispute window. Check what you receive against the hash committed on-chain.',
          holdSecs: 0,
          merchantKnown: true,
          pairTrusted,
        };
      }
      return {
        decision: 'escrow',
        reason: 'instant_limit_reached',
        message: `The merchant has used its instant limit, so this order waits like an Established one: ${p.holdSecs[2]} s.`,
        holdSecs: p.holdSecs[2]!,
        merchantKnown: true,
        pairTrusted,
      };
    }
    const buyerEffective = pairTrusted ? 3 : bTier;
    const reason: Reason =
      minHoldSecs > tierHold ? 'buyer_requested_hold' : p.holdSecs[mTier]! >= p.holdSecs[buyerEffective]! ? 'merchant_tier' : 'buyer_tier';
    const who = { merchant_tier: `the merchant is ${TIER_NAMES[mTier]}`, buyer_tier: `the buyer is ${TIER_NAMES[bTier]}`, buyer_requested_hold: 'the buyer asked for it' }[
      reason as 'merchant_tier'
    ];
    return {
      decision: 'escrow',
      reason,
      message: `Pay into escrow. The money is held ${hold} s after delivery because ${who}; the buyer can dispute until then.`,
      holdSecs: hold,
      merchantKnown: true,
      pairTrusted,
    };
  })();
  return a;
}

export async function checkPayment(i: { merchant: Address; buyer?: Address; amount: string; minHoldSecs?: number }): Promise<Reply> {
  const cfg = await config();
  if (isReply(cfg)) return cfg;
  const units = toUnits(i.amount, cfg.decimals);
  const now = await chainNow();
  const { a, m, b } = await assess(cfg, i.merchant, i.buyer, units, i.minHoldSecs ?? 0, now);
  return reply(a.merchantKnown ? 'ok' : 'unknown_merchant', {
    decision: a.decision,
    reason: a.reason,
    message: a.message,
    holdSecs: a.holdSecs,
    disputeWindowSecs: a.decision === 'escrow' ? a.holdSecs : 0,
    ...(a.askMinHoldSecs ? { askMinHoldSecs: a.askMinHoldSecs } : {}),
    pairTrusted: a.pairTrusted,
    amount: money(units, cfg.decimals),
    merchant: summarize(i.merchant, m, cfg, now),
    buyer: i.buyer ? summarize(i.buyer, b, cfg, now) : null,
    ...(i.buyer ? {} : { assumedBuyerTier: TIER_NAMES[0] }),
    network: NETWORK,
    program: TESSERA_PROGRAM_ADDRESS,
  });
}

// ------------------------------------------------------- shared tx pieces

const signer = (a: Address) => createNoopSigner(a);

/** Recreate the payees' token accounts if missing, so nobody can stall a payout by closing theirs. */
async function payeeAccounts(payer: Address, o: Order, treasury: Address): Promise<Instruction[]> {
  return Promise.all(
    [o.buyer, o.merchant, treasury].map((owner) => getCreateAssociatedTokenIdempotentInstructionAsync({ payer: signer(payer), owner, mint: o.mint })),
  );
}

async function settleInput(orderAddr: Address, o: Order, cfg: Cfg, authority: Address) {
  return { ...(await settleAccounts(orderAddr, o, cfg.data.treasury)), authority: signer(authority) };
}

/** Who gets what if the vault is settled with `merchantBps` to the merchant. */
async function payouts(orderAddr: Address, o: Order, cfg: Cfg, merchantBps: number) {
  const vault = await tokenBalance(orderAddr, o.mint);
  const principal = vault < o.amount ? vault : o.amount;
  const gross = (principal * BigInt(merchantBps)) / 10_000n;
  const fee = (gross * BigInt(o.feeBps)) / 10_000n;
  return {
    toMerchant: money(gross - fee, cfg.decimals),
    protocolFee: money(fee, cfg.decimals),
    toBuyer: money(principal - gross + (vault - principal), cfg.decimals),
  };
}

/** A built transaction, or the reason it was not handed out. */
async function txReply(action: Action, feePayer: Address, ixs: Instruction[], fields: Record<string, unknown>): Promise<Reply> {
  const tx: Unsigned = await buildUnsigned(feePayer, ixs);
  if (!tx.simulation.ok) {
    return reply('rejected', {
      action,
      message: 'The transaction failed in simulation, so it was not handed out.',
      simulation: tx.simulation,
      ...fields,
    });
  }
  return reply('ok', { action, ...tx, ...fields });
}

async function loadOrder(orderAddr: Address): Promise<Order | Reply> {
  const o = await readOrder(orderAddr);
  return o ?? reply('unknown_order', { order: orderAddr, message: 'No Tessera order account at this address.' });
}

// ------------------------------------------------------------ open_escrow

export async function openAsMerchant(i: {
  merchant: Address;
  buyer: Address;
  amount: string;
  orderId?: string;
  requestHash?: string;
  request?: unknown;
  minHoldSecs?: number;
}): Promise<Reply> {
  const cfg = await config();
  if (isReply(cfg)) return cfg;
  const units = toUnits(i.amount, cfg.decimals);
  if (i.buyer === i.merchant) return reply('invalid_request', { message: 'buyer and merchant must be different wallets' });
  if (units < cfg.data.params.minOrder) return reply('invalid_request', { message: `amount is below the minimum order of ${fromUnits(cfg.data.params.minOrder, cfg.decimals, 0)} USDC` });

  const id = i.orderId ? fromHex(i.orderId) : newOrderId();
  const { order, vault } = await orderAddresses(id, cfg.data.mint);
  if (await readOrder(order)) return reply('wrong_state', { order, message: 'An order with this id already exists.' });
  const requestHash = i.requestHash ? fromHex(i.requestHash) : await hashJson(i.request ?? {});
  const now = await chainNow();
  const { a } = await assess(cfg, i.merchant, i.buyer, units, i.minHoldSecs ?? 0, now);

  const ixs: Instruction[] = [];
  for (const wallet of [i.buyer, i.merchant]) {
    if (!(await readAgent(wallet))) ixs.push(await getEnsureAgentInstructionAsync({ wallet, payer: signer(i.merchant) }));
  }
  ixs.push(
    await getOpenOrderInstructionAsync({
      mint: cfg.data.mint,
      buyer: i.buyer,
      merchant: signer(i.merchant),
      payer: signer(i.merchant),
      orderId: id,
      amount: units,
      requestHash,
      minHoldSecs: i.minHoldSecs ?? 0,
    }),
  );
  return txReply('open_order', i.merchant, ixs, {
    role: 'merchant',
    order,
    vault,
    orderId: toHex(id),
    requestHash: toHex(requestHash),
    amount: money(units, cfg.decimals),
    expectedHoldSecs: a.decision === 'block' ? null : a.holdSecs,
    payTo: order,
    x402: { scheme: 'exact', network: NETWORK, asset: cfg.data.mint, amount: units.toString(), payTo: order },
    next: 'Sign with the merchant wallet and send. Quote `payTo` as the x402 payTo. Once the buyer has funded the vault, call deliver_order.',
  });
}

export async function openAsBuyer(i: {
  buyer: Address;
  merchant: Address;
  amount: string;
  orderId?: string;
  order?: Address;
  requestHash?: string;
  request?: unknown;
  minHoldSecs?: number;
}): Promise<Reply> {
  const cfg = await config();
  if (isReply(cfg)) return cfg;
  const units = toUnits(i.amount, cfg.decimals);
  let id: Uint8Array;
  if (i.orderId) id = fromHex(i.orderId);
  else {
    const o = await loadOrder(i.order!);
    if (isReply(o)) return o;
    id = Uint8Array.from(o.orderId);
  }
  const derived = await orderAddresses(id, cfg.data.mint);
  let verified;
  try {
    verified = await verifyOrderForPayment(rpc as never, {
      orderId: id,
      buyer: i.buyer,
      merchant: i.merchant,
      amount: units,
      mint: cfg.data.mint,
      payTo: i.order ?? derived.order,
      requestHash: i.requestHash ? fromHex(i.requestHash) : i.request !== undefined ? await hashJson(i.request) : undefined,
      minHoldSecs: i.minHoldSecs,
    });
  } catch (e) {
    if (!(e instanceof OrderVerificationError)) throw e;
    if (e.field === 'order' && /does not exist/.test(e.message)) return reply('unknown_order', { order: derived.order, message: e.message });
    return reply('verification_failed', { field: e.field, message: e.message, order: derived.order });
  }
  const balance = await tokenBalance(i.buyer, cfg.data.mint);
  if (balance < units) {
    return reply('insufficient_funds', { message: `The buyer holds ${fromUnits(balance, cfg.decimals)} USDC, the order is ${fromUnits(units, cfg.decimals)}.` });
  }
  const source = await findAta(i.buyer, cfg.data.mint);
  return txReply(
    'fund_escrow',
    i.buyer,
    [
      getTransferCheckedInstruction({ source, mint: cfg.data.mint, destination: verified.vault, authority: signer(i.buyer), amount: units, decimals: cfg.decimals }),
      await getConfirmFundedInstructionAsync({ order: verified.order, mint: cfg.data.mint }),
    ],
    {
      role: 'buyer',
      order: verified.order,
      vault: verified.vault,
      orderId: toHex(id),
      amount: money(units, cfg.decimals),
      holdSecs: verified.data.holdSecs,
      deliverWithinSecs: cfg.data.params.deliverSecs,
      verified: ['payTo is this order’s escrow', 'buyer', 'merchant', 'amount', 'mint', 'state AwaitingPayment', ...(i.requestHash || i.request !== undefined ? ['request hash'] : []), ...(i.minHoldSecs ? ['hold'] : [])],
      transfers: [{ from: source, to: verified.vault, amount: money(units, cfg.decimals) }],
      next: 'Sign with the buyer wallet and send. The merchant must deliver within deliverWithinSecs; then report_outcome.',
    },
  );
}

// ------------------------------------------------------------ deliver_order

export async function deliverOrder(i: { order: Address; merchant: Address; deliverable?: unknown; deliveryHash?: string }): Promise<Reply> {
  const cfg = await config();
  if (isReply(cfg)) return cfg;
  const o = await loadOrder(i.order);
  if (isReply(o)) return o;
  if (o.merchant !== i.merchant) return reply('not_a_party', { message: 'Only the order’s merchant can deliver it.' });
  const now = await chainNow();
  const ixs: Instruction[] = [];
  if (o.state === OrderState.AwaitingPayment) {
    const vault = await tokenBalance(i.order, o.mint);
    if (vault < o.amount) return reply('not_yet', { message: `The vault holds ${fromUnits(vault, cfg.decimals)} of ${fromUnits(o.amount, cfg.decimals)} USDC. Deliver once it is funded.` });
    ixs.push(await getConfirmFundedInstructionAsync({ order: i.order, mint: o.mint }));
  } else if (o.state === OrderState.Funded) {
    if (now > o.deliverBy) return reply('wrong_state', { state: stateName(o.state), message: 'The delivery deadline has passed; the buyer can reclaim the money.' });
  } else {
    return reply('wrong_state', { state: stateName(o.state), message: 'Only a funded order can be delivered.' });
  }
  const deliveryHash = i.deliveryHash ? fromHex(i.deliveryHash) : await hashJson(i.deliverable);
  ixs.push(await getDeliverInstructionAsync({ order: i.order, merchant: signer(i.merchant), deliveryHash }));

  // Between two Trusted parties, inside the instant limit, take the money in the same transaction.
  let action: Action = 'deliver';
  if (o.holdSecs === 0) {
    const m = await readAgent(i.merchant);
    if (m && m.instantExposure + o.amount <= score.instantLimit(m, cfg.data.params)) {
      ixs.unshift(...(await payeeAccounts(i.merchant, o, cfg.data.treasury)));
      ixs.push(getReleaseInstruction(await settleInput(i.order, o, cfg, i.merchant)));
      action = 'deliver_and_release';
    }
  }
  return txReply(action, i.merchant, ixs, {
    order: i.order,
    deliveryHash: toHex(deliveryHash),
    holdSecs: o.holdSecs,
    next:
      action === 'deliver_and_release'
        ? 'Sign and send: the order settles to you in the same transaction.'
        : 'Sign and send. Hand the buyer the deliverable; it checks the hash. The money is released when the hold ends.',
  });
}

// --------------------------------------------------------- release_escrow

export async function releaseEscrow(i: { order: Address; signer: Address }): Promise<Reply> {
  const cfg = await config();
  if (isReply(cfg)) return cfg;
  const o = await loadOrder(i.order);
  if (isReply(o)) return o;
  if (o.state !== OrderState.Delivered) {
    return reply('wrong_state', { state: stateName(o.state), message: 'Only a delivered order can be released.' });
  }
  const now = await chainNow();
  if (i.signer !== o.buyer && now < o.releaseAt) {
    return reply('hold_not_elapsed', { releaseAt: seconds(o.releaseAt), secondsLeft: seconds(o.releaseAt - now), message: 'Only the buyer can release before the hold ends.' });
  }
  return txReply(
    'release',
    i.signer,
    [...(await payeeAccounts(i.signer, o, cfg.data.treasury)), getReleaseInstruction(await settleInput(i.order, o, cfg, i.signer))],
    { order: i.order, payouts: await payouts(i.order, o, cfg, 10_000), next: 'Sign and send. Then report_outcome to leave a review.' },
  );
}

// -------------------------------------------------- reclaim_after_timeout

export async function reclaim(i: { order: Address; signer: Address }): Promise<Reply> {
  const cfg = await config();
  if (isReply(cfg)) return cfg;
  const o = await loadOrder(i.order);
  if (isReply(o)) return o;
  const p = cfg.data.params;
  const now = await chainNow();
  const state = stateName(o.state);

  if (o.state === OrderState.Funded) {
    const isMerchant = i.signer === o.merchant;
    if (!isMerchant && now <= o.deliverBy) {
      return reply('not_yet', { state, availableAt: seconds(o.deliverBy) + 1, message: 'The merchant still has time to deliver.' });
    }
    return txReply(
      isMerchant ? 'refund' : 'refund_missed_delivery',
      i.signer,
      [...(await payeeAccounts(i.signer, o, cfg.data.treasury)), getRefundInstruction(await settleInput(i.order, o, cfg, i.signer))],
      { order: i.order, payouts: await payouts(i.order, o, cfg, 0), next: 'Sign and send. The buyer gets everything back.' },
    );
  }

  if (o.state === OrderState.AwaitingPayment) {
    const party = i.signer === o.buyer || i.signer === o.merchant;
    const payerMay = i.signer === o.payer && now >= o.createdAt + BigInt(p.unpaidSecs);
    if (!party && !payerMay) {
      return i.signer === o.payer
        ? reply('not_yet', { state, availableAt: seconds(o.createdAt) + p.unpaidSecs, message: 'The rent payer may cancel once the payment window has passed.' })
        : reply('not_a_party', { message: 'Only the buyer, the merchant or the rent payer can cancel an unpaid order.' });
    }
    const paidIn = await tokenBalance(i.order, o.mint);
    const ixs: Instruction[] = [];
    if (paidIn > 0n) ixs.push(await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: signer(i.signer), owner: o.buyer, mint: o.mint }));
    ixs.push(
      await getCancelUnpaidInstructionAsync({
        order: i.order,
        mint: o.mint,
        payer: o.payer,
        authority: signer(i.signer),
        ...(paidIn > 0n ? { buyerToken: await findAta(o.buyer, o.mint) } : {}),
      }),
    );
    return txReply('cancel_unpaid', i.signer, ixs, {
      order: i.order,
      returnedToBuyer: money(paidIn, cfg.decimals),
      next: 'Sign and send. Anything paid in goes back to the buyer; the rent goes back to whoever paid it.',
    });
  }

  if (o.state === OrderState.Disputed) {
    const deadline = o.releaseAt + BigInt(p.complaintSecs);
    if (i.signer !== o.arbiter && now <= deadline) {
      return reply('not_yet', { state, availableAt: seconds(deadline) + 1, message: 'The arbiter still has time to rule. After that anyone may split the vault evenly.' });
    }
    return txReply(
      'split_silent_dispute',
      i.signer,
      [...(await payeeAccounts(i.signer, o, cfg.data.treasury)), getResolveDisputeInstruction({ ...(await settleInput(i.order, o, cfg, i.signer)), merchantBps: 5_000 })],
      { order: i.order, payouts: await payouts(i.order, o, cfg, 5_000), next: 'Sign and send. The vault splits evenly and nobody is penalised.' },
    );
  }

  if (o.state === OrderState.Delivered) {
    return reply('wrong_state', {
      state,
      releaseAt: seconds(o.releaseAt),
      message: 'Delivered. The buyer can dispute until releaseAt with report_outcome; after that it releases to the merchant.',
    });
  }
  return reply('wrong_state', { state, message: 'This order has already settled.' });
}

// --------------------------------------------------------- report_outcome

/** Whether the program will give a review weight, given the order as it will be when the review lands. */
function reviewCounts(o: Order, reviewerIsBuyer: boolean, state: OrderState): { counts: boolean; why: string } {
  if (state === OrderState.Refunded) return { counts: false, why: 'a refunded order settled nothing, so its review weighs nothing' };
  const settled = o.paidMerchant + o.paidFee;
  if (state === OrderState.Resolved) {
    const lost = reviewerIsBuyer ? settled * 2n > o.amount : settled * 2n < o.amount;
    return lost ? { counts: false, why: 'the side that lost a dispute gets no weight on it' } : { counts: true, why: 'weighted by what settled' };
  }
  if (!reviewerIsBuyer && !o.buyerReviewed) return { counts: false, why: 'a merchant’s review counts once the buyer has reviewed the same order' };
  return { counts: true, why: 'weighted by what settled' };
}

export async function reportOutcome(i: { order: Address; reporter: Address; outcome: Outcome; rating?: number; comment?: string }): Promise<Reply> {
  const cfg = await config();
  if (isReply(cfg)) return cfg;
  const o = await loadOrder(i.order);
  if (isReply(o)) return o;
  const isBuyer = i.reporter === o.buyer;
  if (!isBuyer && i.reporter !== o.merchant) return reply('not_a_party', { message: 'Only the buyer or the merchant can report on this order.' });
  const p = cfg.data.params;
  const now = await chainNow();
  const state = stateName(o.state);
  const rating = i.rating ?? (i.outcome === 'satisfied' ? 5 : 1);
  const comment = i.comment ?? { satisfied: 'Delivered as asked.', unsatisfied: 'Not what was asked for.', not_delivered: 'Nothing was delivered.' }[i.outcome];
  const subject = isBuyer ? o.merchant : o.buyer;
  const reviewIx = async () =>
    getSubmitReviewInstructionAsync({
      order: i.order,
      subject,
      pair: await pairPdaOf(o.buyer, o.merchant),
      reviewer: signer(i.reporter),
      payer: signer(i.reporter),
      rating,
      text: comment,
    });

  // Settled: all that is left is the review.
  if (o.state === OrderState.Released || o.state === OrderState.Refunded || o.state === OrderState.Resolved) {
    if (isBuyer ? o.buyerReviewed : o.merchantReviewed) return reply('already_reported', { state, message: 'This party has already reviewed this order.' });
    if (now > o.settledAt + BigInt(p.reviewSecs)) return reply('review_window_closed', { state, message: 'Reviews are accepted for a limited time after settlement.' });
    const w = reviewCounts(o, isBuyer, o.state);
    return txReply('review', i.reporter, [await reviewIx()], { order: i.order, rating, reviewWeighs: w.counts ? 'full' : 'nothing', because: w.why });
  }

  if (!isBuyer) return reply('wrong_state', { state, message: 'A merchant can report on an order once it has settled.' });

  if (o.state === OrderState.Delivered) {
    if (i.outcome === 'satisfied' || now >= o.releaseAt) {
      // Release and review in one transaction. Past the hold, the money goes to the merchant either way.
      return txReply(
        'release_and_review',
        i.reporter,
        [...(await payeeAccounts(i.reporter, o, cfg.data.treasury)), getReleaseInstruction(await settleInput(i.order, o, cfg, i.reporter)), await reviewIx()],
        {
          order: i.order,
          rating,
          reviewWeighs: 'full',
          payouts: await payouts(i.order, o, cfg, 10_000),
          ...(i.outcome === 'satisfied' ? {} : { note: 'The hold is over, so it is too late to dispute. This releases the money and records your rating.' }),
        },
      );
    }
    return txReply(
      'dispute',
      i.reporter,
      [
        getOpenDisputeInstruction({
          order: i.order,
          buyerAgent: await agentPdaOf(o.buyer),
          merchantAgent: await agentPdaOf(o.merchant),
          pair: await pairPdaOf(o.buyer, o.merchant),
          buyer: signer(i.reporter),
          disputeHash: await sha256(`${i.outcome}: ${comment}`),
        }),
      ],
      {
        order: i.order,
        disputeWindowEndsAt: seconds(o.releaseAt),
        arbiterDeadline: seconds(o.releaseAt) + p.complaintSecs,
        next: 'Sign and send. The money stays in escrow until the arbiter rules; if it never does, reclaim_after_timeout splits it evenly after arbiterDeadline. Review once it settles.',
      },
    );
  }

  if (o.state === OrderState.Funded) {
    if (i.outcome === 'satisfied') return reply('wrong_state', { state, message: 'Nothing has been delivered on-chain yet.' });
    if (now <= o.deliverBy) return reply('not_yet', { state, availableAt: seconds(o.deliverBy) + 1, message: 'The merchant still has time to deliver.' });
    return reclaim({ order: i.order, signer: i.reporter });
  }

  return reply('wrong_state', {
    state,
    message: o.state === OrderState.Disputed ? 'Waiting on the arbiter. Review once the order settles.' : 'The order has not been paid yet.',
  });
}

// ------------------------------------------------------------ get_escrow

export async function getEscrow(orderAddr: Address): Promise<Reply> {
  const cfg = await config();
  if (isReply(cfg)) return cfg;
  const o = await loadOrder(orderAddr);
  if (isReply(o)) return o;
  const p = cfg.data.params;
  const now = await chainNow();
  const next: { who: 'buyer' | 'merchant' | 'anyone'; tool: string; what: string; from?: number; until?: number }[] = [];
  switch (o.state) {
    case OrderState.AwaitingPayment:
      next.push({ who: 'buyer', tool: 'open_escrow', what: 'fund it (role buyer)' });
      next.push({ who: 'buyer', tool: 'reclaim_after_timeout', what: 'cancel it' });
      break;
    case OrderState.Funded:
      next.push({ who: 'merchant', tool: 'deliver_order', what: 'deliver', until: seconds(o.deliverBy) });
      next.push({ who: 'anyone', tool: 'reclaim_after_timeout', what: 'refund the buyer if nothing was delivered', from: seconds(o.deliverBy) + 1 });
      break;
    case OrderState.Delivered:
      next.push({ who: 'buyer', tool: 'report_outcome', what: 'satisfied: release now; unsatisfied: dispute', until: seconds(o.releaseAt) });
      next.push({ who: 'anyone', tool: 'release_escrow', what: 'pay the merchant', from: seconds(o.releaseAt) });
      break;
    case OrderState.Disputed:
      next.push({ who: 'anyone', tool: 'reclaim_after_timeout', what: 'split evenly if the arbiter never ruled', from: seconds(o.releaseAt) + p.complaintSecs + 1 });
      break;
    default:
      if (now <= o.settledAt + BigInt(p.reviewSecs)) {
        if (!o.buyerReviewed) next.push({ who: 'buyer', tool: 'report_outcome', what: 'review', until: seconds(o.settledAt) + p.reviewSecs });
        if (!o.merchantReviewed) next.push({ who: 'merchant', tool: 'report_outcome', what: 'review', until: seconds(o.settledAt) + p.reviewSecs });
      }
  }
  return reply('ok', {
    order: orderAddr,
    orderId: toHex(o.orderId),
    state: stateName(o.state),
    buyer: o.buyer,
    merchant: o.merchant,
    amount: money(o.amount, cfg.decimals),
    vaultBalance: money(await tokenBalance(orderAddr, o.mint), cfg.decimals),
    holdSecs: o.holdSecs,
    instant: o.instant,
    pairTrusted: o.pairTrusted,
    tiersAtOpen: { buyer: TIER_NAMES[o.buyerTier], merchant: TIER_NAMES[o.merchantTier] },
    times: {
      now: seconds(now),
      createdAt: seconds(o.createdAt),
      fundedAt: seconds(o.fundedAt) || null,
      deliverBy: seconds(o.deliverBy) || null,
      deliveredAt: seconds(o.deliveredAt) || null,
      releaseAt: seconds(o.releaseAt) || null,
      settledAt: seconds(o.settledAt) || null,
    },
    requestHash: toHex(o.requestHash),
    deliveryHash: o.deliveredAt > 0n ? toHex(o.deliveryHash) : null,
    paid: { toMerchant: money(o.paidMerchant, cfg.decimals), protocolFee: money(o.paidFee, cfg.decimals), toBuyer: money(o.refunded, cfg.decimals) },
    reviewed: { buyer: o.buyerReviewed, merchant: o.merchantReviewed },
    next,
    explorer: explorerAddress(orderAddr),
  });
}

// ------------------------------------------------------------- submit

function errorText(e: unknown): { message: string; logs: string[] } {
  const logs: string[] = [];
  const parts: string[] = [];
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number) => {
    if (!v || depth > 6 || seen.has(v)) return;
    seen.add(v);
    if (v instanceof Error) parts.push(v.message);
    const ctx = (v as { context?: { logs?: unknown } }).context;
    if (ctx && Array.isArray(ctx.logs)) logs.push(...(ctx.logs as string[]));
    walk((v as { cause?: unknown }).cause, depth + 1);
  };
  walk(e, 0);
  return { message: parts.join(': ').slice(0, 400), logs: logs.filter((l) => /Error|failed|AnchorError/.test(l)).slice(-8) };
}

export async function submit(i: { transaction: string }): Promise<Reply> {
  let tx;
  try {
    tx = getTransactionDecoder().decode(getBase64Encoder().encode(i.transaction));
  } catch {
    return reply('invalid_request', { message: 'transaction is not a base64 wire transaction' });
  }
  if (!isFullySignedTransaction(tx)) {
    const missing = Object.entries(tx.signatures).filter(([, s]) => !s).map(([a]) => a);
    return reply('invalid_request', { message: 'transaction is not fully signed', missing });
  }
  const signature = getSignatureFromTransaction(tx);
  try {
    await rpc.sendTransaction(i.transaction as never, { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
  } catch (e) {
    return reply('rejected', { signature, ...errorText(e) });
  }
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    await new Promise((r) => setTimeout(r, 800));
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const st = value[0];
    if (st?.err) return reply('rejected', { signature, message: JSON.stringify(st.err, (_, v) => (typeof v === 'bigint' ? Number(v) : v)) });
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
      return reply('ok', { signature, confirmed: true, explorer: explorerTx(signature) });
    }
  }
  return reply('ok', { signature, confirmed: false, explorer: explorerTx(signature), message: 'Sent, but not confirmed within 60 s. Look the signature up before sending again.' });
}
