/**
 * Runs the real program on a local validator and checks it two ways:
 *
 *   1. every account is compared, field by field, with the reference model in
 *      packages/sdk/src/model.ts after every instruction, so the score the
 *      program stores is proven to be the score anyone can recompute;
 *   2. every attack in docs/SECURITY.md is sent as a real transaction and has
 *      to be rejected with the expected error.
 *
 * Time is compressed (2-second periods, holds of a few seconds), so holds,
 * deadlines and tier gates are crossed for real rather than mocked.
 *
 *   npm run build:program && npm run test:local
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AccountRole, createNoopSigner, lamports, type Address, type TransactionSigner } from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
  getInitializeMint2Instruction,
  getMintSize,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';
import {
  agentPdaOf,
  configPda,
  fetchAgent,
  fetchConfig,
  fetchMaybeOrder,
  fetchOrder,
  fetchPair,
  fetchReview,
  getCancelUnpaidInstructionAsync,
  getCloseOrderInstructionAsync,
  getConfirmFundedInstructionAsync,
  getDeliverInstructionAsync,
  getEnsureAgentInstructionAsync,
  getInitializeInstructionAsync,
  getOpenDisputeInstruction,
  getOpenOrderInstructionAsync,
  getRefundInstruction,
  getReleaseInstruction,
  getResolveDisputeInstruction,
  getSetProfileInstructionAsync,
  getSubmitReviewInstructionAsync,
  getUpdateConfigInstructionAsync,
  newOrderId,
  orderAddresses,
  OrderState,
  pairPdaOf,
  programDataAddress,
  reviewPdaOf,
  settleAccounts,
  sha256,
  TESSERA_PROGRAM_ADDRESS,
  verifyOrderForPayment,
  type Params,
} from '@tessera/sdk';
import * as model from '../packages/sdk/src/model.js';
import {
  chainTime,
  clientForSigner,
  errText,
  generateKeypairBytes,
  log,
  REPO_ROOT,
  sleep,
  tokenHelpers,
  waitForChainTime,
  type Cluster,
  type ScriptClient,
} from './lib.js';

const RPC_PORT = 18899;
const LOCAL: Cluster = { rpcUrl: `http://127.0.0.1:${RPC_PORT}` };
const FEE_BPS = 100;
const USDC = 1_000_000n;

const PARAMS: Params = {
  periodSecs: 2,
  holdSecs: [4, 3, 2, 0],
  tierScore: [100, 300, 500],
  tierPeriods: [1, 2, 3],
  creditFull: USDC,
  pairCap: USDC,
  tenureFull: 4,
  diversityFull: 20,
  reviewPrior: USDC / 100n,
  minOrder: 1_000n,
  deliverSecs: 6,
  unpaidSecs: 6,
  reviewSecs: 20,
  complaintSecs: 32,
  instantBase: USDC / 2n,
  instantFeePct: 100,
  pairHistoryMin: 2,
  pairAgeSecs: 2,
  penaltyDisputeBps: 2500,
  penaltyExpiredBps: 1000,
  penaltyDecayBps: 100,
};

// ----------------------------------------------------------------- assertions

let checks = 0;
let failures = 0;
const show = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? `${x}n` : x));

function eq(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  if (show(actual) !== show(expected)) {
    failures += 1;
    console.log(`   FAIL ${label}: got ${show(actual)}, expected ${show(expected)}`);
  }
}

function pass(label: string): void {
  checks += 1;
  log.ok(label);
}

async function expectFail(label: string, expected: string, fn: () => Promise<unknown>): Promise<void> {
  checks += 1;
  try {
    await fn();
  } catch (e) {
    const text = errText(e);
    if (text.includes(expected)) log.ok(`${label}: rejected with ${expected}`);
    else {
      failures += 1;
      console.log(`   FAIL ${label}: expected ${expected}, got: ${text.slice(-900)}`);
    }
    return;
  }
  failures += 1;
  console.log(`   FAIL ${label}: the call succeeded but should have been rejected`);
}

// ------------------------------------------------------------------ validator

async function startValidator(upgradeAuthority: Address): Promise<{ proc: ChildProcess; ledger: string }> {
  const so = resolve(REPO_ROOT, 'target/deploy/tessera.so');
  if (!existsSync(so)) throw new Error('target/deploy/tessera.so is missing: run `npm run build:program` first');
  const ledger = mkdtempSync(join(tmpdir(), 'tessera-ledger-'));
  const proc = spawn(
    'solana-test-validator',
    [
      '--reset',
      '--quiet',
      '--ledger', ledger,
      '--rpc-port', String(RPC_PORT),
      '--faucet-port', String(RPC_PORT + 1001),
      '--upgradeable-program', TESSERA_PROGRAM_ADDRESS, so, upgradeAuthority,
    ],
    { stdio: 'ignore' },
  );
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(LOCAL.rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      });
      if (((await res.json()) as { result?: string }).result === 'ok') return { proc, ledger };
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  proc.kill('SIGKILL');
  throw new Error('local validator did not become healthy');
}

// ----------------------------------------------------------------------- main

const role = async () => clientForSigner((await generateKeypairBytes()).signer, LOCAL);

const deployer = await role();
const { proc, ledger } = await startValidator(deployer.identity.address);

try {
  const server = await role();
  const arbiter = await role();
  const treasury = await role();
  const stranger = await role();
  const m1 = await role();
  const m2 = await role();
  const b1 = await role();
  const b2 = await role();
  const b3 = await role();
  const b4 = await role();
  const everyone = [deployer, server, arbiter, treasury, stranger, m1, m2, b1, b2, b3, b4];
  const rpc = server.rpc;

  log.step('Funding roles and creating a test mint');
  for (const c of everyone) await rpc.requestAirdrop(c.identity.address, lamports(20_000_000_000n)).send();
  for (let i = 0; i < 60; i += 1) {
    const b = await rpc.getBalance(everyone.at(-1)!.identity.address).send();
    if (b.value > 0n) break;
    await sleep(250);
  }

  const mintSigner = (await generateKeypairBytes()).signer;
  const space = BigInt(getMintSize());
  await server.sendTransaction([
    getCreateAccountInstruction({
      payer: server.identity,
      newAccount: mintSigner,
      lamports: await rpc.getMinimumBalanceForRentExemption(space).send(),
      space,
      programAddress: TOKEN_PROGRAM_ADDRESS,
    }),
    getInitializeMint2Instruction({
      mint: mintSigner.address,
      decimals: 6,
      mintAuthority: server.identity.address,
      freezeAuthority: null,
    }),
  ]);
  const mint = mintSigner.address;
  const tok = tokenHelpers(server, mint);
  for (const c of [treasury, m1, m2, b1, b2, b3, b4]) {
    await server.sendTransaction([await tok.ensureAtaIx(c.identity.address)]);
  }
  for (const c of [b1, b2, b3, b4]) {
    await server.sendTransaction([
      getMintToInstruction({
        mint,
        token: await tok.ata(c.identity.address),
        mintAuthority: server.identity,
        amount: 100n * USDC,
      }),
    ]);
  }
  pass(`mint ${mint}, buyers funded`);

  // ------------------------------------------------------------ governance
  log.step('Governance');
  const programData = await programDataAddress();
  const config = await configPda();
  const init = async (authority: ScriptClient) =>
    authority.sendTransaction([
      await getInitializeInstructionAsync({
        authority: authority.identity,
        mint,
        arbiter: arbiter.identity.address,
        treasury: treasury.identity.address,
        programData,
        feeBps: FEE_BPS,
        params: PARAMS,
      }),
    ]);
  await expectFail('a wallet that is not the upgrade authority initialises the program', 'Unauthorized', () =>
    init(stranger),
  );
  await init(deployer);
  eq('config.params', (await fetchConfig(rpc, config)).data.params, PARAMS);
  await expectFail('a stranger rewrites the config', 'Unauthorized', async () =>
    stranger.sendTransaction([
      await getUpdateConfigInstructionAsync({
        authority: stranger.identity,
        feeBps: 0,
        params: PARAMS,
        arbiter: stranger.identity.address,
        treasury: stranger.identity.address,
      }),
    ]),
  );
  await expectFail('the authority sets a fee above 10%', 'InvalidParams', async () =>
    deployer.sendTransaction([
      await getUpdateConfigInstructionAsync({
        authority: deployer.identity,
        feeBps: 1001,
        params: PARAMS,
        arbiter: arbiter.identity.address,
        treasury: treasury.identity.address,
      }),
    ]),
  );

  // ------------------------------------------------------- model + helpers
  const agents = new Map<Address, model.ModelAgent>();
  const pairs = new Map<string, model.ModelPair>();
  const agentOf = (c: ScriptClient) => agents.get(c.identity.address)!;
  const pairOf = (b: ScriptClient, m: ScriptClient) => {
    const k = `${b.identity.address}:${m.identity.address}`;
    if (!pairs.has(k)) pairs.set(k, model.newPair());
    return pairs.get(k)!;
  };

  async function checkAgent(label: string, c: ScriptClient): Promise<void> {
    const d = (await fetchAgent(rpc, await agentPdaOf(c.identity.address))).data;
    const m = agentOf(c);
    const roleOf = (r: typeof d.asBuyer) => ({
      orders: r.orders,
      volume: r.volume,
      refunds: r.refunds,
      disputes: r.disputes,
      disputesLost: r.disputesLost,
      expired: r.expired,
      instant: r.instant,
    });
    eq(
      `${label} agent matches the model`,
      {
        credit: d.credit,
        counterpartyPoints: d.counterpartyPoints,
        counterparties: d.counterparties,
        activePeriods: d.activePeriods,
        lastActivePeriod: d.lastActivePeriod,
        feesPaid: d.feesPaid,
        penaltyBps: d.penaltyBps,
        penaltyPeriod: d.penaltyPeriod,
        ratingSum: d.ratingSum,
        ratingWeight: d.ratingWeight,
        reviewsReceived: d.reviewsReceived,
        asBuyer: roleOf(d.asBuyer),
        asMerchant: roleOf(d.asMerchant),
        instantExposure: d.instantExposure,
        score: d.score,
        tier: d.tier,
        scoreUpdatedAt: d.scoreUpdatedAt,
      },
      {
        credit: m.credit,
        counterpartyPoints: m.counterpartyPoints,
        counterparties: m.counterparties,
        activePeriods: m.activePeriods,
        lastActivePeriod: m.lastActivePeriod,
        feesPaid: m.feesPaid,
        penaltyBps: m.penaltyBps,
        penaltyPeriod: m.penaltyPeriod,
        ratingSum: m.ratingSum,
        ratingWeight: m.ratingWeight,
        reviewsReceived: m.reviewsReceived,
        asBuyer: m.asBuyer,
        asMerchant: m.asMerchant,
        instantExposure: m.instantExposure,
        score: m.score,
        tier: m.tier,
        scoreUpdatedAt: m.scoreUpdatedAt,
      },
    );
  }

  async function checkPair(label: string, b: ScriptClient, m: ScriptClient): Promise<void> {
    const d = (await fetchPair(rpc, await pairPdaOf(b.identity.address, m.identity.address))).data;
    const p = pairOf(b, m);
    eq(
      `${label} pair matches the model`,
      {
        orders: d.orders,
        volume: d.volume,
        creditToBuyer: d.creditToBuyer,
        creditToMerchant: d.creditToMerchant,
        pointsToBuyer: d.pointsToBuyer,
        pointsToMerchant: d.pointsToMerchant,
        ratedByBuyer: d.ratedByBuyer,
        ratedByMerchant: d.ratedByMerchant,
        firstSettledAt: d.firstSettledAt,
        lastSettledAt: d.lastSettledAt,
        disputes: d.disputes,
      },
      p,
    );
  }

  type Ctx = {
    id: Uint8Array;
    order: Address;
    vault: Address;
    buyer: ScriptClient;
    merchant: ScriptClient;
    amount: bigint;
    m: model.ModelOrder;
  };

  const requestHash = await sha256('GET /report?wallet=demo');
  const deliveryHash = await sha256('{"report":"ok"}');

  async function register(c: ScriptClient, name: string): Promise<void> {
    await server.sendTransaction([
      await getEnsureAgentInstructionAsync({ wallet: c.identity.address, payer: server.identity }),
    ]);
    await c.sendTransaction([
      await getSetProfileInstructionAsync({ wallet: c.identity, name, uri: `https://agents.example/${name}`, kind: 2 }),
    ]);
    const d = (await fetchAgent(rpc, await agentPdaOf(c.identity.address))).data;
    agents.set(c.identity.address, model.newAgent(d.registeredAt));
    eq(`${name} profile`, [d.name, d.kind, d.wallet], [name, 2, c.identity.address]);
  }

  const openIx = async (buyer: Address, merchant: TransactionSigner, id: Uint8Array, amount: bigint, minHoldSecs = 0) =>
    getOpenOrderInstructionAsync({
      mint,
      buyer,
      merchant,
      payer: server.identity,
      orderId: id,
      amount,
      requestHash,
      minHoldSecs,
    });

  async function open(buyer: ScriptClient, merchant: ScriptClient, amount: bigint, minHoldSecs = 0): Promise<Ctx> {
    const id = newOrderId();
    const { order, vault } = await orderAddresses(id, mint);
    await server.sendTransaction([
      await openIx(buyer.identity.address, merchant.identity, id, amount, minHoldSecs),
    ]);
    const d = (await fetchOrder(rpc, order)).data;
    const m = model.openOrder(
      agentOf(buyer), agentOf(merchant), pairOf(buyer, merchant), PARAMS, FEE_BPS, amount, d.createdAt, minHoldSecs,
    );
    eq(
      'order risk snapshot matches the model',
      [d.holdSecs, d.buyerTier, d.merchantTier, d.buyerScore, d.merchantScore, d.pairTrusted, d.state],
      [m.holdSecs, m.buyerTier, m.merchantTier, m.buyerScore, m.merchantScore, m.pairTrusted, OrderState.AwaitingPayment],
    );
    return { id, order, vault, buyer, merchant, amount, m };
  }

  const pay = async (o: Ctx, amount = o.amount) =>
    o.buyer.sendTransaction([await tok.transferIx(o.buyer, o.vault, amount)]);

  const confirm = async (o: Ctx) =>
    stranger.sendTransaction([await getConfirmFundedInstructionAsync({ order: o.order, mint })]);

  const deliverIx = async (o: Ctx, as: ScriptClient = o.merchant) =>
    getDeliverInstructionAsync({ order: o.order, merchant: as.identity, deliveryHash });

  async function afterDeliver(o: Ctx): Promise<void> {
    const d = (await fetchOrder(rpc, o.order)).data;
    // An order released in the same transaction is already past Delivered.
    model.deliver(o.m, agentOf(o.merchant), PARAMS, d.deliveredAt);
    eq('hold and instant flag match the model', [d.releaseAt, d.instant], [o.m.releaseAt, o.m.instant]);
  }

  async function deliver(o: Ctx): Promise<void> {
    await o.merchant.sendTransaction([await deliverIx(o)]);
    await afterDeliver(o);
  }

  const settleInput = async (o: Ctx, authority: ScriptClient) => ({
    ...(await settleAccounts(
      o.order,
      { buyer: o.buyer.identity.address, merchant: o.merchant.identity.address, mint, payer: server.identity.address },
      treasury.identity.address,
    )),
    authority: authority.identity,
  });
  const releaseIx = async (o: Ctx, as: ScriptClient) => getReleaseInstruction(await settleInput(o, as));
  const refundIx = async (o: Ctx, as: ScriptClient) => getRefundInstruction(await settleInput(o, as));
  const resolveIx = async (o: Ctx, as: ScriptClient, merchantBps: number) =>
    getResolveDisputeInstruction({ ...(await settleInput(o, as)), merchantBps });

  const balances = async (o: Ctx) =>
    Promise.all([
      tok.balance(o.merchant.identity.address),
      tok.balance(o.buyer.identity.address),
      tok.balance(treasury.identity.address),
    ]);

  /** Send a settling instruction, then hold the chain to the model. */
  async function settleAndCheck(
    label: string,
    o: Ctx,
    outcome: model.Outcome,
    send: () => Promise<unknown>,
    excess = 0n,
  ): Promise<void> {
    const before = await balances(o);
    await send();
    const d = (await fetchOrder(rpc, o.order)).data;
    model.settle(o.m, agentOf(o.buyer), agentOf(o.merchant), pairOf(o.buyer, o.merchant), PARAMS, outcome, d.settledAt, excess);
    const after = await balances(o);
    eq(
      `${label}: payouts`,
      [after[0] - before[0], after[1] - before[1], after[2] - before[2], d.paidMerchant, d.paidFee, d.refunded],
      [o.m.paidMerchant, o.m.refunded, o.m.paidFee, o.m.paidMerchant, o.m.paidFee, o.m.refunded],
    );
    const vault = await rpc.getAccountInfo(o.vault, { encoding: 'base64' }).send();
    eq(`${label}: vault closed`, vault.value, null);
    await checkAgent(`${label}: merchant`, o.merchant);
    await checkAgent(`${label}: buyer`, o.buyer);
    await checkPair(label, o.buyer, o.merchant);
  }

  async function review(o: Ctx, reviewer: ScriptClient, rating: number, text: string): Promise<bigint> {
    const reviewerIsBuyer = reviewer === o.buyer;
    const subject = reviewerIsBuyer ? o.merchant : o.buyer;
    await reviewer.sendTransaction([
      await getSubmitReviewInstructionAsync({
        order: o.order,
        subject: subject.identity.address,
        pair: await pairPdaOf(o.buyer.identity.address, o.merchant.identity.address),
        reviewer: reviewer.identity,
        payer: reviewer.identity,
        rating,
        text,
      }),
    ]);
    const r = (await fetchReview(rpc, await reviewPdaOf(o.order, reviewer.identity.address))).data;
    const weight = model.review(
      o.m,
      agentOf(reviewer),
      agentOf(subject),
      pairOf(o.buyer, o.merchant),
      reviewerIsBuyer,
      rating,
      PARAMS,
      r.createdAt,
    );
    eq('review stored on-chain', [r.rating, r.text, r.weight, r.subject], [rating, text, weight, subject.identity.address]);
    await checkAgent('review: subject', subject);
    return weight;
  }

  const waitHold = async (o: Ctx) => waitForChainTime(server, o.m.releaseAt);

  /** A full clean purchase: open, pay, confirm, deliver, wait, release, rate both ways. */
  async function cleanOrder(buyer: ScriptClient, merchant: ScriptClient, amount: bigint, label: string): Promise<Ctx> {
    const o = await open(buyer, merchant, amount);
    await pay(o);
    await confirm(o);
    await deliver(o);
    await waitHold(o);
    await settleAndCheck(label, o, { kind: 'release' }, async () =>
      stranger.sendTransaction([await releaseIx(o, stranger)]),
    );
    await review(o, buyer, 5, 'Delivered what was asked.');
    await review(o, merchant, 5, 'Paid in full.');
    return o;
  }

  const nextPeriod = async () => {
    const now = await chainTime(server);
    const period = BigInt(PARAMS.periodSecs);
    await waitForChainTime(server, (now / period + 1n) * period);
  };

  // ----------------------------------------------------------- identities
  log.step('Identity');
  await register(m1, 'atlas');
  await register(m2, 'meridian');
  await register(b1, 'buyer-one');
  await register(b2, 'buyer-two');
  await register(b3, 'buyer-three');
  await register(b4, 'buyer-four');
  await register(stranger, 'stranger');
  await checkAgent('fresh', m1);
  eq('a fresh wallet scores 0 and is New', [agentOf(m1).score, agentOf(m1).tier], [0, 0]);

  // --------------------------------------------- 1. the hold is enforced
  log.step('1. Two unknown wallets: the money waits');
  await expectFail('buyer and merchant are the same wallet', 'ConstraintDuplicateMutableAccount', async () =>
    server.sendTransaction([await openIx(b1.identity.address, b1.identity, newOrderId(), USDC)]),
  );
  await expectFail('order below the minimum', 'AmountTooSmall', async () =>
    server.sendTransaction([await openIx(b1.identity.address, m1.identity, newOrderId(), 10n)]),
  );
  // Without the merchant's signature anyone could open orders in its name,
  // fund them and let them expire: each missed delivery costs it score.
  await expectFail('a stranger opens an order in a merchant\'s name', 'AccountNotSigner', async () => {
    const ix = await openIx(b1.identity.address, createNoopSigner(m1.identity.address), newOrderId(), USDC);
    const unsigned = {
      ...ix,
      accounts: ix.accounts.map((a) => (a.address === m1.identity.address ? { address: a.address, role: AccountRole.READONLY } : a)),
    };
    return server.sendTransaction([unsigned]);
  });
  const o1 = await open(b1, m1, USDC);
  eq('New buyer + New merchant get the longest hold', o1.m.holdSecs, PARAMS.holdSecs[0]);

  // What a buyer agent does before paying.
  const good = { orderId: o1.id, buyer: b1.identity.address, merchant: m1.identity.address, amount: USDC, mint, payTo: o1.order };
  await verifyOrderForPayment(rpc, good);
  pass('buyer verifies the quoted order on-chain before paying');
  await expectFail('quote names an escrow that is not this order', 'payTo', () =>
    verifyOrderForPayment(rpc, { ...good, payTo: m1.identity.address }),
  );
  await expectFail('quote is for an order opened for a different buyer', 'buyer', () =>
    verifyOrderForPayment(rpc, { ...good, buyer: b2.identity.address }),
  );
  await expectFail('quote is for a different amount', 'amount', () =>
    verifyOrderForPayment(rpc, { ...good, amount: 2n * USDC }),
  );

  await expectFail('confirming an order nobody paid', 'VaultUnderfunded', () => confirm(o1));
  await expectFail('delivering before payment', 'InvalidState', () => deliver(o1));
  await pay(o1);
  await confirm(o1);
  await expectFail('a stranger marks the order delivered', 'NotAParty', async () =>
    stranger.sendTransaction([await deliverIx(o1, stranger)]),
  );
  await deliver(o1);
  await expectFail('the merchant takes the money before the hold ends', 'HoldNotElapsed', async () =>
    m1.sendTransaction([await releaseIx(o1, m1)]),
  );
  await expectFail('a stranger refunds a delivered order', 'Unauthorized', async () =>
    stranger.sendTransaction([await refundIx(o1, stranger)]),
  );
  await waitHold(o1);
  await settleAndCheck('order 1', o1, { kind: 'release' }, async () =>
    stranger.sendTransaction([await releaseIx(o1, stranger)]),
  );
  eq('1% fee went to the treasury', o1.m.paidFee, USDC / 100n);
  eq('released, but the merchant has no credit until the buyer speaks for the order', agentOf(m1).credit, 0n);
  await expectFail('releasing the same order twice', 'AccountNotInitialized', async () =>
    stranger.sendTransaction([await releaseIx(o1, stranger)]),
  );

  // ------------------------------------------------------- 2. reviews
  log.step('2. Two-sided reviews, weighted by what settled');
  await review(o1, b1, 5, 'Fast and correct.');
  eq('the buyer reviewed: a New counterparty counts for 10%', agentOf(m1).credit, USDC / 10n);
  await review(o1, m1, 4, 'Paid on time.');
  await expectFail('the same party reviews an order twice', 'already in use', () => review(o1, b1, 1, 'again'));
  await expectFail('a stranger reviews an order it was not part of', 'NotAParty', async () =>
    stranger.sendTransaction([
      await getSubmitReviewInstructionAsync({
        order: o1.order,
        subject: m1.identity.address,
        pair: await pairPdaOf(b1.identity.address, m1.identity.address),
        reviewer: stranger.identity,
        payer: stranger.identity,
        rating: 1,
        text: 'never bought anything',
      }),
    ]),
  );

  // -------------------------------------------- 3. buyer confirms early
  log.step('3. The buyer may release early');
  const o2 = await open(b1, m1, USDC / 2n);
  await pay(o2);
  await confirm(o2);
  await deliver(o2);
  await settleAndCheck('order 2 (buyer confirms receipt)', o2, { kind: 'release' }, async () =>
    b1.sendTransaction([await releaseIx(o2, b1)]),
  );

  // ----------------------------------------------------- 4. refunds
  log.step('4. Refunds');
  const o3 = await open(b2, m1, USDC);
  await pay(o3, USDC + 250_000n); // overpays by 0.25
  await confirm(o3);
  const creditBefore = agentOf(m1).credit;
  await settleAndCheck(
    'order 3 (merchant refunds)',
    o3,
    { kind: 'refund', expired: false },
    async () => m1.sendTransaction([await refundIx(o3, m1)]),
    250_000n,
  );
  eq('an overpayment comes back with the refund', o3.m.refunded, USDC + 250_000n);
  eq('a refund earns the merchant no credit', agentOf(m1).credit, creditBefore);
  const w = await review(o3, b2, 1, 'Refunded, never delivered.');
  eq('a review of a refunded order weighs nothing', w, 0n);

  const o4 = await open(b2, m1, USDC);
  await pay(o4);
  await confirm(o4);
  await expectFail('a stranger refunds before the delivery deadline', 'DeliveryWindowOpen', async () =>
    stranger.sendTransaction([await refundIx(o4, stranger)]),
  );
  const d4 = (await fetchOrder(rpc, o4.order)).data;
  await waitForChainTime(server, d4.deliverBy + 1n);
  await expectFail('the merchant delivers after the deadline', 'DeliveryWindowClosed', async () =>
    m1.sendTransaction([await deliverIx(o4)]),
  );
  const penaltyBefore = agentOf(m1).penaltyBps;
  await settleAndCheck('order 4 (merchant never delivered)', o4, { kind: 'refund', expired: true }, async () =>
    stranger.sendTransaction([await refundIx(o4, stranger)]),
  );
  eq('missing a delivery costs the merchant score', agentOf(m1).penaltyBps > penaltyBefore, true);

  // ----------------------------------------------------- 5. disputes
  log.step('5. Disputes');
  const o5 = await open(b1, m1, USDC);
  await pay(o5);
  await confirm(o5);
  await deliver(o5);
  const pairKey = await pairPdaOf(b1.identity.address, m1.identity.address);
  const disputeIx = async (o: Ctx, as: ScriptClient) =>
    getOpenDisputeInstruction({
      order: o.order,
      buyerAgent: await agentPdaOf(o.buyer.identity.address),
      merchantAgent: await agentPdaOf(o.merchant.identity.address),
      pair: await pairPdaOf(o.buyer.identity.address, o.merchant.identity.address),
      buyer: as.identity,
      disputeHash: await sha256('not what was ordered'),
    });
  await expectFail('a stranger disputes someone else\'s order', 'NotAParty', async () =>
    stranger.sendTransaction([await disputeIx(o5, stranger)]),
  );
  await b1.sendTransaction([await disputeIx(o5, b1)]);
  model.dispute(agentOf(b1), agentOf(m1), pairOf(b1, m1));
  eq('pair records the dispute', (await fetchPair(rpc, pairKey)).data.disputes, 1);
  await waitHold(o5);
  await expectFail('the merchant releases a disputed order', 'InvalidState', async () =>
    m1.sendTransaction([await releaseIx(o5, m1)]),
  );
  await expectFail('a stranger resolves the dispute', 'Unauthorized', async () =>
    stranger.sendTransaction([await resolveIx(o5, stranger, 10_000)]),
  );
  await settleAndCheck('order 5 (arbiter: 30% to the merchant)', o5, { kind: 'resolve', merchantBps: 3000 }, async () =>
    arbiter.sendTransaction([await resolveIx(o5, arbiter, 3000)]),
  );
  eq('the merchant lost the dispute', agentOf(m1).asMerchant.disputesLost, 1);
  eq('a merchant that lost a dispute gets no weighted say on it', await review(o5, m1, 1, 'Unfair.'), 0n);

  // Friendly fraud: the buyer got the goods and disputes anyway.
  const o6 = await open(b2, m1, USDC);
  await pay(o6);
  await confirm(o6);
  await deliver(o6);
  await b2.sendTransaction([await disputeIx(o6, b2)]);
  model.dispute(agentOf(b2), agentOf(m1), pairOf(b2, m1));
  const scoreBefore = agentOf(b2).penaltyBps;
  await settleAndCheck('order 6 (arbiter: buyer was wrong)', o6, { kind: 'resolve', merchantBps: 10_000 }, async () =>
    arbiter.sendTransaction([await resolveIx(o6, arbiter, 10_000)]),
  );
  eq('a false dispute costs the buyer score', [agentOf(b2).asBuyer.disputesLost, agentOf(b2).penaltyBps > scoreBefore], [1, true]);
  eq('the buyer who lost cannot hit back with a weighted one-star review', await review(o6, b2, 1, 'Scam merchant.'), 0n);
  eq('the merchant that won is heard', (await review(o6, m1, 1, 'Disputed a delivery that matched its hash.')) > 0n, true);

  // An arbiter that never answers. Settled at the end of the run.
  const stuck = await open(b2, m1, USDC / 4n);
  await pay(stuck);
  await confirm(stuck);
  await deliver(stuck);
  await b2.sendTransaction([await disputeIx(stuck, b2)]);
  model.dispute(agentOf(b2), agentOf(m1), pairOf(b2, m1));
  await expectFail('a stranger settles a dispute while the arbiter still has time', 'Unauthorized', async () =>
    stranger.sendTransaction([await resolveIx(stuck, stranger, 5000)]),
  );

  const o7 = await open(b1, m1, USDC / 4n);
  await pay(o7);
  await confirm(o7);
  await deliver(o7);
  await waitHold(o7);
  await expectFail('the buyer disputes after the hold has ended', 'DisputeWindowClosed', async () =>
    b1.sendTransaction([await disputeIx(o7, b1)]),
  );
  await settleAndCheck('order 7', o7, { kind: 'release' }, async () =>
    stranger.sendTransaction([await releaseIx(o7, stranger)]),
  );

  // ------------------------------------------------ 6. unpaid orders
  log.step('6. Unpaid orders give their rent back');
  const o8 = await open(b1, m1, USDC);
  await pay(o8, 400_000n);
  const cancelIx = async (o: Ctx, as: ScriptClient, withBuyerToken: boolean) =>
    getCancelUnpaidInstructionAsync({
      order: o.order,
      mint,
      payer: server.identity.address,
      authority: as.identity,
      ...(withBuyerToken ? { buyerToken: await tok.ata(o.buyer.identity.address) } : {}),
    });
  await expectFail('a stranger cancels someone else\'s order', 'Unauthorized', async () =>
    stranger.sendTransaction([await cancelIx(o8, stranger, true)]),
  );
  await expectFail('the rent payer cancels before the payment window ends', 'Unauthorized', async () =>
    server.sendTransaction([await cancelIx(o8, server, true)]),
  );
  const b1Before = await tok.balance(b1.identity.address);
  await b1.sendTransaction([await cancelIx(o8, b1, true)]);
  eq('a partial payment is returned', (await tok.balance(b1.identity.address)) - b1Before, 400_000n);
  eq('the order account is closed', (await fetchMaybeOrder(rpc, o8.order)).exists, false);

  const o9 = await open(b1, m1, USDC);
  const d9 = (await fetchOrder(rpc, o9.order)).data;
  await waitForChainTime(server, d9.createdAt + BigInt(PARAMS.unpaidSecs));
  await server.sendTransaction([await cancelIx(o9, server, false)]);
  eq('the rent payer reclaims an abandoned order', (await fetchMaybeOrder(rpc, o9.order)).exists, false);

  // ---------------------------------------- 7. earning instant settlement
  log.step('7. Two wallets earn Trusted, then settle instantly');
  for (let round = 1; round <= 3; round += 1) {
    await nextPeriod();
    await cleanOrder(b3, m2, USDC / 2n, `round ${round}`);
    log.info(
      `round ${round}: merchant score ${agentOf(m2).score} tier ${agentOf(m2).tier}, buyer score ${agentOf(b3).score} tier ${agentOf(b3).tier}`,
    );
  }
  eq('both wallets reached Trusted', [agentOf(m2).tier, agentOf(b3).tier], [3, 3]);

  const o10 = await open(b3, m2, 300_000n);
  eq('Trusted + Trusted: no hold', o10.m.holdSecs, 0);
  await pay(o10);
  await confirm(o10);
  // One transaction: deliver and take the money.
  await settleAndCheck('order 10 (instant)', o10, { kind: 'release' }, async () => {
    await m2.sendTransaction([await deliverIx(o10), await releaseIx(o10, m2)]);
    await afterDeliver(o10);
  });
  eq('settled instantly', [o10.m.instant, agentOf(m2).asMerchant.instant], [true, 1]);

  const o11 = await open(b3, m2, 300_000n);
  await pay(o11);
  await confirm(o11);
  await deliver(o11);
  eq('past the instant limit the order waits like an Established one', [o11.m.instant, o11.m.releaseAt > 0n], [false, true]);
  await expectFail('the merchant takes more than its instant limit', 'HoldNotElapsed', async () =>
    m2.sendTransaction([await releaseIx(o11, m2)]),
  );
  await waitHold(o11);
  await settleAndCheck('order 11', o11, { kind: 'release' }, async () =>
    stranger.sendTransaction([await releaseIx(o11, stranger)]),
  );

  // The buyer accepting an instant order gives the merchant that capacity back.
  eq('the instant order still counts against the limit', agentOf(m2).instantExposure, 300_000n);
  await review(o10, b3, 5, 'Instant and correct.');
  eq('accepted: the limit is free again', agentOf(m2).instantExposure, 0n);
  await checkAgent('after acceptance: merchant', m2);

  const closeIx = async (o: Ctx) =>
    getCloseOrderInstructionAsync({
      order: o.order,
      merchantAgent: await agentPdaOf(o.merchant.identity.address),
      payer: server.identity.address,
    });

  // ------------------------------------- 8. a buyer can ask for more
  log.step('8. A buyer can always ask for a longer hold');
  const cautious = await open(b3, m2, 100_000n, 7);
  eq('Trusted + Trusted, but the buyer asked for 7 seconds', cautious.m.holdSecs, 7);
  await pay(cautious);
  await confirm(cautious);
  await deliver(cautious);
  await expectFail('the merchant cannot shorten a hold the buyer asked for', 'HoldNotElapsed', async () =>
    m2.sendTransaction([await releaseIx(cautious, m2)]),
  );
  await settleAndCheck('cautious order (buyer confirms)', cautious, { kind: 'release' }, async () =>
    b3.sendTransaction([await releaseIx(cautious, b3)]),
  );

  // ----------------------------- 9. history with one merchant is evidence
  log.step('9. Prior undisputed purchases waive the buyer-side hold');
  const first = await cleanOrder(b4, m2, 200_000n, 'new buyer, order A');
  eq('a New buyer waits even with a Trusted merchant', first.m.holdSecs > 0, true);
  await cleanOrder(b4, m2, 200_000n, 'new buyer, order B');
  await sleep(PARAMS.pairAgeSecs * 1000 + 500);
  await nextPeriod();
  const third = await open(b4, m2, 50_000n);
  eq('third purchase: pair is trusted, no hold', [third.m.pairTrusted, third.m.holdSecs], [true, 0]);
  await pay(third);
  await confirm(third);
  await settleAndCheck('new buyer, order C (instant)', third, { kind: 'release' }, async () => {
    await m2.sendTransaction([await deliverIx(third), await releaseIx(third, m2)]);
    await afterDeliver(third);
  });
  eq('an unreviewed instant order keeps counting', agentOf(m2).instantExposure, 50_000n);

  // A dispute ends that trust for good.
  const o12 = await open(b1, m1, USDC / 4n);
  eq('a pair with a dispute on record is never pair-trusted', o12.m.pairTrusted, false);

  // --------------------------------- 10. an exit scam runs out of road
  log.step('10. A complaint locks the instant limit: an exit scam cannot repeat');
  const scam = await open(b3, m2, 300_000n);
  await pay(scam);
  await confirm(scam);
  await settleAndCheck('instant order, nothing useful delivered', scam, { kind: 'release' }, async () => {
    await m2.sendTransaction([await deliverIx(scam), await releaseIx(scam, m2)]);
    await afterDeliver(scam);
  });
  eq('it settled instantly', scam.m.instant, true);
  await review(scam, b3, 1, 'Paid, got nothing usable.');
  const complained = (await fetchOrder(rpc, scam.order)).data;
  eq('the complaint is recorded and the exposure stays', [complained.complained, complained.seasoned, agentOf(m2).instantExposure], [true, false, 350_000n]);
  const again = await open(b3, m2, 300_000n);
  await pay(again);
  await confirm(again);
  await deliver(again);
  eq('the next order is not instant any more', again.m.instant, false);
  await waitHold(again);
  await settleAndCheck('order after the complaint', again, { kind: 'release' }, async () =>
    stranger.sendTransaction([await releaseIx(again, stranger)]),
  );

  // --------------------------------------------- 11. sybil ring economics
  log.step('11. Wash trading through one sock puppet is capped at the pair cap');
  const ring = await role();
  const sock = await role();
  for (const c of [ring, sock]) await rpc.requestAirdrop(c.identity.address, lamports(5_000_000_000n)).send();
  await sleep(1500);
  await server.sendTransaction([await tok.ensureAtaIx(ring.identity.address), await tok.ensureAtaIx(sock.identity.address)]);
  await server.sendTransaction([
    getMintToInstruction({ mint, token: await tok.ata(sock.identity.address), mintAuthority: server.identity, amount: 100n * USDC }),
  ]);
  await register(ring, 'ring-merchant');
  await register(sock, 'sock-puppet');
  for (let i = 0; i < 3; i += 1) {
    const o = await open(sock, ring, 5n * USDC);
    await pay(o);
    await confirm(o);
    await deliver(o);
    await settleAndCheck(`wash trade ${i + 1}`, o, { kind: 'release' }, async () =>
      sock.sendTransaction([await releaseIx(o, sock)]),
    );
    await review(o, sock, 5, 'Great seller.');
  }
  eq(
    '$15 of wash trades through one sock puppet can never earn more than the $1 pair cap',
    agentOf(ring).credit <= PARAMS.pairCap,
    true,
  );
  log.info(`ring merchant: credit ${agentOf(ring).credit} from 15000000 of volume, fees burned ${agentOf(ring).feesPaid}`);
  eq('and burned 1% in fees', agentOf(ring).feesPaid, 150_000n);

  // ------------------------------- 12. orders a buyer never agreed to
  log.step('12. A merchant names a Trusted buyer who never agreed, and pays itself');
  await server.sendTransaction([
    getMintToInstruction({ mint, token: await tok.ata(ring.identity.address), mintAuthority: server.identity, amount: 10n * USDC }),
  ]);
  const ringCredit = agentOf(ring).credit;
  const forged = await open(b3, ring, USDC);
  await ring.sendTransaction([await tok.transferIx(ring, forged.vault, USDC)]);
  await confirm(forged);
  await deliver(forged);
  await waitHold(forged);
  await settleAndCheck('order the buyer never placed', forged, { kind: 'release' }, async () =>
    stranger.sendTransaction([await releaseIx(forged, stranger)]),
  );
  eq('the merchant borrows nothing from a Trusted buyer who never spoke for the order', agentOf(ring).credit, ringCredit);
  eq('and its one-star review of that buyer weighs nothing', await review(forged, ring, 1, 'Terrible buyer.'), 0n);

  // ------------------------------------------------ 12. windows close
  log.step('13. Windows close, rent comes back');
  await expectFail('closing an order before its review window ends', 'TooEarly', async () =>
    stranger.sendTransaction([await closeIx(again)]),
  );
  const o2Settled = (await fetchOrder(rpc, o2.order)).data.settledAt;
  await waitForChainTime(server, o2Settled + BigInt(PARAMS.reviewSecs) + 1n);
  await expectFail('reviewing after the window', 'ReviewWindowClosed', async () =>
    m1.sendTransaction([
      await getSubmitReviewInstructionAsync({
        order: o2.order,
        subject: b1.identity.address,
        pair: pairKey,
        reviewer: m1.identity,
        payer: m1.identity,
        rating: 5,
        text: 'too late',
      }),
    ]),
  );
  await stranger.sendTransaction([await closeIx(o1)]);
  eq('a settled order returns its rent after the review window', (await fetchMaybeOrder(rpc, o1.order)).exists, false);

  // An instant order nobody objected to stops counting once its window passes.
  const thirdSettled = (await fetchOrder(rpc, third.order)).data.settledAt;
  await waitForChainTime(server, thirdSettled + BigInt(PARAMS.reviewSecs) + 1n);
  await stranger.sendTransaction([await closeIx(third)]);
  model.closeOrder(third.m, agentOf(m2));
  await checkAgent('unreviewed instant order seasoned', m2);
  eq('only the complained-about order still counts', agentOf(m2).instantExposure, 300_000n);

  // The complained-about one stays locked for the longer complaint period.
  const scamSettled = (await fetchOrder(rpc, scam.order)).data.settledAt;
  await waitForChainTime(server, scamSettled + BigInt(PARAMS.reviewSecs) + 1n);
  await expectFail('closing a complained-about order after only the review window', 'TooEarly', async () =>
    stranger.sendTransaction([await closeIx(scam)]),
  );
  await waitForChainTime(server, scamSettled + BigInt(PARAMS.complaintSecs) + 1n);
  await stranger.sendTransaction([await closeIx(scam)]);
  model.closeOrder(scam.m, agentOf(m2));
  await checkAgent('complaint period over', m2);
  eq('the lock ends with the complaint period', agentOf(m2).instantExposure, 0n);

  // -------------------------------- 14. a silent arbiter
  log.step('14. An arbiter that never answers cannot lock the money forever');
  await waitForChainTime(server, stuck.m.releaseAt + BigInt(PARAMS.complaintSecs) + 1n);
  await expectFail('after the complaint period anyone may only split it evenly', 'InvalidParams', async () =>
    stranger.sendTransaction([await resolveIx(stuck, stranger, 10_000)]),
  );
  const lostBefore = [agentOf(b2).asBuyer.disputesLost, agentOf(m1).asMerchant.disputesLost];
  await settleAndCheck('dispute the arbiter never answered', stuck, { kind: 'resolve', merchantBps: 5000 }, async () =>
    stranger.sendTransaction([await resolveIx(stuck, stranger, 5000)]),
  );
  eq('an even split penalises nobody', [agentOf(b2).asBuyer.disputesLost, agentOf(m1).asMerchant.disputesLost], lostBefore);

  const cfg = (await fetchConfig(rpc, config)).data;
  log.info(`program counters: ${cfg.ordersOpened} opened, ${cfg.ordersSettled} settled, volume ${cfg.volumeSettled}, fees ${cfg.feesCollected}`);
} catch (e) {
  failures += 1;
  console.log(`\n   FAIL the run stopped on an unexpected error:\n${errText(e).slice(0, 1500)}`);
} finally {
  proc.kill('SIGKILL');
  await sleep(300);
  rmSync(ledger, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${checks - failures}/${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
