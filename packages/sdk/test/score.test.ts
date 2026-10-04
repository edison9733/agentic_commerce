/**
 * The guarantees docs/SCORING.md and docs/SECURITY.md state, as tests.
 * These run on the same arithmetic the program uses (see scripts/test-local.ts
 * for the proof that model and program agree).
 *
 *   npm run test:formula
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVNET_PARAMS, MAINNET_TARGET_PARAMS, PROTOCOL_FEE_BPS } from '../src/constants.js';
import { establishedAgent, exitScamBound, simulateHonestMerchant, simulateRing } from '../src/attacks.js';
import * as model from '../src/model.js';
import { evaluate, farmingCost, holdFor, instantLimit, isqrt } from '../src/score.js';

const P = MAINNET_TARGET_PARAMS;
const USDC = 1_000_000n;
const DAY = 86_400n;
const T0 = 1_000_000n * DAY;

test('isqrt is the exact floor of the square root', () => {
  for (const n of [0n, 1n, 2n, 3n, 4n, 15n, 16n, 17n, 999_999n, 1_000_000n, 2n ** 64n - 1n, 10n ** 30n]) {
    const r = isqrt(n);
    assert.ok(r * r <= n && (r + 1n) * (r + 1n) > n, String(n));
  }
});

test('a wallet nobody knows scores 0, is New, and waits the longest hold', () => {
  const a = model.newAgent(T0);
  const e = evaluate(a, P, T0 + 400n * DAY);
  assert.deepEqual([e.score, e.tier], [0, 0]);
  assert.equal(holdFor(P, 0, 0), P.holdSecs[0]);
});

test('age alone earns nothing: a wallet left idle for a year has no tenure', () => {
  const a = model.newAgent(T0);
  assert.equal(evaluate(a, P, T0 + 365n * DAY).tenure, 0);
});

test('time cannot be bought in a burst: full evidence in one day is still not Trusted', () => {
  const a = model.newAgent(T0);
  a.credit = P.creditFull;
  a.counterpartyPoints = P.diversityFull;
  a.ratingWeight = 1_000_000n * USDC;
  a.ratingSum = a.ratingWeight * 5n;
  a.activePeriods = 1;
  const e = evaluate(a, P, T0 + DAY);
  assert.equal(e.history, 1000);
  assert.equal(e.diversity, 1000);
  assert.ok(e.tier < 3, `tier ${e.tier}`);
  assert.equal(e.tier, 0, 'one active period does not even reach Building');
});

test('quality multiplies: one-star reviews sink any amount of history', () => {
  const a = establishedAgent(P, 3, T0);
  assert.equal(evaluate(a, P, T0).tier, 3);
  a.ratingSum = a.ratingWeight * 1n;
  assert.equal(evaluate(a, P, T0).score, 0);
});

test('no reviews yet means half marks, not full marks', () => {
  const a = establishedAgent(P, 3, T0);
  a.ratingSum = 0n;
  a.ratingWeight = 0n;
  const e = evaluate(a, P, T0);
  assert.equal(e.rating, 500);
  assert.ok(e.tier < 3);
});

test('losing a dispute costs a quarter of the score and heals over 100 periods', () => {
  const a = establishedAgent(P, 3, T0);
  const clean = evaluate(a, P, T0).score;
  a.penaltyBps = P.penaltyDisputeBps;
  a.penaltyPeriod = T0 / DAY;
  assert.equal(evaluate(a, P, T0).score, Math.floor((clean * 7500) / 10_000));
  assert.ok(evaluate(a, P, T0).tier < 3, 'a Trusted wallet that loses a dispute loses instant settlement');
  assert.equal(evaluate(a, P, T0 + 50n * DAY).behaviour, 10_000 - 1250);
  assert.equal(evaluate(a, P, T0 + 100n * DAY).behaviour, 10_000);
});

test('one counterparty can never grant more than the pair cap', () => {
  const m = model.newAgent(T0);
  const b = establishedAgent(P, 3, T0);
  const pair = model.newPair();
  for (let i = 1; i <= 50; i += 1) {
    const now = T0 + BigInt(i) * DAY;
    const o = model.openOrder(b, m, pair, P, PROTOCOL_FEE_BPS, 1_000n * USDC, now);
    model.deliver(o, m, P, now);
    model.settle(o, b, m, pair, P, { kind: 'release' }, now);
  }
  assert.equal(m.credit, P.pairCap, '$50,000 from one Trusted buyer earns exactly the $500 cap');
  assert.ok(evaluate(m, P, T0 + 50n * DAY).tier < 2, 'one big customer does not make a merchant Established');
});

test('splitting a purchase into many small ones earns nothing extra', () => {
  const run = (orders: number, size: bigint) => {
    const m = model.newAgent(T0);
    const b = establishedAgent(P, 2, T0);
    const pair = model.newPair();
    for (let i = 0; i < orders; i += 1) {
      const o = model.openOrder(b, m, pair, P, PROTOCOL_FEE_BPS, size, T0 + DAY);
      model.deliver(o, m, P, T0 + DAY);
      model.settle(o, b, m, pair, P, { kind: 'release' }, T0 + DAY);
    }
    return m.credit;
  };
  assert.equal(run(1, 100n * USDC), run(100, 1n * USDC));
});

test('a refund or a lost dispute earns no credit', () => {
  const m = model.newAgent(T0);
  const b = establishedAgent(P, 3, T0);
  const pair = model.newPair();
  const o1 = model.openOrder(b, m, pair, P, PROTOCOL_FEE_BPS, 100n * USDC, T0 + DAY);
  model.settle(o1, b, m, pair, P, { kind: 'refund', expired: false }, T0 + DAY);
  const o2 = model.openOrder(b, m, pair, P, PROTOCOL_FEE_BPS, 100n * USDC, T0 + DAY);
  model.deliver(o2, m, P, T0 + DAY);
  model.dispute(b, m, pair);
  model.settle(o2, b, m, pair, P, { kind: 'resolve', merchantBps: 10_000 }, T0 + DAY);
  assert.equal(m.credit, 0n);
  assert.equal(model.review(o1, b, m, pair, true, 5, P, T0 + DAY), 0n, 'a review of a refund weighs nothing');
});

test('friendly fraud: a buyer who loses a dispute drops a tier and loses pair trust for good', () => {
  const m = establishedAgent(P, 3, T0);
  const b = establishedAgent(P, 3, T0);
  const pair = model.newPair();
  for (let i = 1; i <= 3; i += 1) {
    const now = T0 + BigInt(i) * 40n * DAY;
    const o = model.openOrder(b, m, pair, P, PROTOCOL_FEE_BPS, 20n * USDC, now);
    model.deliver(o, m, P, now);
    model.settle(o, b, m, pair, P, { kind: 'release' }, now);
  }
  const now = T0 + 130n * DAY;
  const o = model.openOrder(b, m, pair, P, PROTOCOL_FEE_BPS, 20n * USDC, now);
  assert.equal(o.pairTrusted, true, 'three undisputed purchases over 120 days: the pair is trusted');
  model.deliver(o, m, P, now);
  model.dispute(b, m, pair);
  model.settle(o, b, m, pair, P, { kind: 'resolve', merchantBps: 10_000 }, now);
  assert.equal(b.asBuyer.disputesLost, 1);
  assert.ok(b.tier < 3, 'the buyer is no longer Trusted');
  const next = model.openOrder(b, m, pair, P, PROTOCOL_FEE_BPS, 20n * USDC, now + DAY);
  assert.equal(next.pairTrusted, false);
  assert.ok(next.holdSecs > 0, 'and every later order with this merchant is held');
});

test('exit scam: instant settlement can net at most the base allowance', () => {
  for (const fees of [0n, 10n * USDC, 1_000n * USDC, 250_000n * USDC]) {
    const { take, sunk, net } = exitScamBound(P, fees);
    assert.equal(take - sunk, net);
    assert.equal(net, P.instantBase);
  }
  const a = establishedAgent(P, 3, T0);
  a.feesPaid = 300n * USDC;
  assert.equal(instantLimit(a, P), P.instantBase + 300n * USDC);
});

test('a ring of fresh wallets: what faking Trusted costs (mainnet targets)', () => {
  const rows: string[] = [];
  for (const wallets of [3, 6, 12, 21, 40]) {
    const r = simulateRing({ params: P, feeBps: PROTOCOL_FEE_BPS, wallets, orderSize: 100n * USDC, periods: 120 });
    const last = r.snapshots.at(-1)!;
    rows.push(
      `${String(wallets).padStart(3)} wallets | best score ${String(last.score).padStart(4)} tier ${last.tier} | ` +
        `Trusted at day ${r.trustedAt ?? 'never'} | volume $${r.volume / USDC} | fees burned $${r.fees / USDC} | ` +
        `max instant take $${r.maxInstantTake / USDC}`,
    );
    // Whatever the ring takes instantly, it burned at least that much less the base allowance.
    const trusted = r.maxInstantTake === 0n ? 0n : r.maxInstantTake;
    assert.ok(trusted <= r.fees + BigInt(wallets) * P.instantBase);
    if (r.trustedAt !== null) assert.ok(r.trustedAt >= P.tierPeriods[2]!, 'never before the time gate');
  }
  console.log('\n' + rows.join('\n') + '\n');
  const small = simulateRing({ params: P, feeBps: PROTOCOL_FEE_BPS, wallets: 3, orderSize: 100n * USDC, periods: 365 });
  assert.equal(small.trustedAt, null, 'three wallets trading with each other for a year never reach Trusted');
});

test('an honest merchant with real customers gets there, and faster with better customers', () => {
  const run = (buyerTier: 0 | 1 | 2 | 3) =>
    simulateHonestMerchant({ params: P, feeBps: PROTOCOL_FEE_BPS, buyers: 25, buyerTier, orderSize: 40n * USDC, rating: 5, periods: 120 });
  const day = (rows: ReturnType<typeof run>, tier: number) => rows.find((r) => r.tier >= tier)?.period ?? null;
  const withTrusted = run(3);
  const withNew = run(0);
  console.log(
    `\n25 Trusted customers: Building day ${day(withTrusted, 1)}, Established day ${day(withTrusted, 2)}, Trusted day ${day(withTrusted, 3)}` +
      `\n25 New customers:     Building day ${day(withNew, 1)}, Established day ${day(withNew, 2)}, Trusted day ${day(withNew, 3)}\n`,
  );
  assert.equal(day(withTrusted, 3), P.tierPeriods[2], 'with Trusted customers the only wait is the time gate');
  assert.equal(day(withNew, 3), null, 'customers nobody knows cannot vouch a merchant into Trusted');
});

test('farming History with brand-new sock puppets (closed form)', () => {
  const c = farmingCost(P, PROTOCOL_FEE_BPS, 1000);
  assert.equal(c.wallets, 200);
  assert.equal(c.volume, 100_000n * USDC);
  assert.equal(c.fees, 1_000n * USDC);
  assert.equal(c.instantLimit - c.fees, P.instantBase);
});

test('devnet runs the same rules, compressed', () => {
  assert.deepEqual(DEVNET_PARAMS.tierScore, P.tierScore);
  assert.equal(DEVNET_PARAMS.penaltyDisputeBps, P.penaltyDisputeBps);
  assert.ok(DEVNET_PARAMS.periodSecs < P.periodSecs);
});
