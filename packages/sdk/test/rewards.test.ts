/**
 * The review-reward rules in docs/REWARDS.md, as tests.
 *
 *   npm run test:formula
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_FEE_BPS } from '../src/constants.js';
import { accuracy, baseReward, DEVNET_REWARD_PARAMS, MAINNET_REWARD_PARAMS, MAX_ACCURACY_BPS, maxReward, scoreEpoch, type RewardReview, type Sighting } from '../src/rewards.js';
import { TIER_WEIGHT } from '../src/score.js';

const P = MAINNET_REWARD_PARAMS;
const USDC = 1_000_000n;
const fee = (settled: bigint) => (settled * BigInt(PROTOCOL_FEE_BPS)) / 10_000n;
const clean = { disputesLost: 0, missed: 0 };
const seenAt = (r: RewardReview, before = clean): Sighting => ({ firstSeenAt: r.createdAt + 10, before });
let n = 0;
const review = (o: Partial<RewardReview> = {}): RewardReview => ({
  address: `r${(n += 1)}`,
  reviewer: `buyer${n}`,
  subject: 'merchant',
  reviewerIsBuyer: true,
  rating: 5,
  weight: USDC,
  createdAt: 1_000_000,
  ...o,
});

test('the base reward never depends on the stars', () => {
  // baseReward takes no rating at all; and when nothing happened next, the stars change nothing either.
  assert.equal(baseReward(USDC, PROTOCOL_FEE_BPS, P), (USDC * 100n * 2500n) / 100_000_000n);
  const one = review({ rating: 1 });
  const five = review({ rating: 5 });
  const a = accuracy(one, [], seenAt(one), clean, P);
  const b = accuracy(five, [], seenAt(five), clean, P);
  assert.equal(a.bps, b.bps, 'with nothing to compare, 1 and 5 stars are paid the same');
});

test('a review that weighed nothing earns nothing', () => {
  assert.equal(baseReward(0n, PROTOCOL_FEE_BPS, P), 0n);
  const r = review({ weight: 0n, createdAt: 0 });
  const out = scoreEpoch({ reviews: [r], sightings: {}, failuresNow: {}, paid: {}, feeBps: PROTOCOL_FEE_BPS, now: 10 ** 9 }, P);
  assert.equal(out.rows.length, 0);
});

test('both sides of one order together never get back more than 75% of its fee', () => {
  // Weight is at most what settled; check every settled amount and tier.
  for (const settled of [1_000n, 123_457n, USDC, 37n * USDC, 10_000n * USDC]) {
    for (const q of TIER_WEIGHT) {
      const weight = (settled * q) / 100n;
      const both = 2n * maxReward(weight, PROTOCOL_FEE_BPS, P);
      assert.ok(both * 100n <= fee(settled) * 75n, `${settled} at ${q}%: ${both} vs fee ${fee(settled)}`);
    }
  }
  assert.equal(MAX_ACCURACY_BPS, 15_000);
});

test('a wash-trading ring of new wallets loses money farming rewards', () => {
  // Ten orders of 100 USDC between wallets the ring made: they are New, so each review weighs 10%.
  const settled = 100n * USDC;
  const orders = 10n;
  const paidInFees = fee(settled) * orders;
  const weight = (settled * TIER_WEIGHT[0]) / 100n;
  const bestCaseBack = 2n * maxReward(weight, PROTOCOL_FEE_BPS, P) * orders;
  assert.ok(bestCaseBack < paidInFees / 10n, `back ${bestCaseBack} of ${paidInFees} paid`);
});

test('a glowing review of a wallet that then failed earns nothing; a warning earns 1.5x', () => {
  const glowing = review({ rating: 5 });
  const warning = review({ rating: 1 });
  const failedLater = { disputesLost: 1, missed: 0 };
  assert.deepEqual([accuracy(glowing, [], seenAt(glowing), failedLater, P).bps, accuracy(glowing, [], seenAt(glowing), failedLater, P).label], [0, 'vouched_then_failed']);
  assert.deepEqual([accuracy(warning, [], seenAt(warning), failedLater, P).bps, accuracy(warning, [], seenAt(warning), failedLater, P).label], [15_000, 'early_warning']);
  const missed = { disputesLost: 0, missed: 1 };
  assert.equal(accuracy(warning, [], seenAt(warning), missed, P).label, 'early_warning', 'a missed delivery counts as failing');
});

test('failures from before the review do not count against it', () => {
  const r = review({ rating: 5 });
  const before = { disputesLost: 2, missed: 1 };
  assert.equal(accuracy(r, [], seenAt(r, before), before, P).label, 'no_peers');
});

test('a review first seen too late cannot be judged on what followed', () => {
  const r = review({ rating: 5 });
  const late: Sighting = { firstSeenAt: r.createdAt + P.lateSightSecs + 1, before: clean };
  const a = accuracy(r, [], late, { disputesLost: 3, missed: 0 }, P);
  assert.deepEqual([a.failedAfter, a.label], [null, 'no_peers']);
});

test('agreeing with the money-weighted consensus earns more than being an outlier', () => {
  const r = review({ rating: 5, reviewer: 'me' });
  const peers = [review({ rating: 5, weight: 3n * USDC }), review({ rating: 4, weight: USDC })];
  assert.equal(accuracy(r, peers, seenAt(r), clean, P).label, 'agrees');
  const harsh = review({ rating: 1, reviewer: 'me' });
  assert.equal(accuracy(harsh, peers, seenAt(harsh), clean, P).label, 'outlier');
  assert.equal(accuracy(harsh, peers, seenAt(harsh), clean, P).bps, 5_000);
  // A big buyer's opinion counts for more than a small one's.
  const split = [review({ rating: 1, weight: 9n * USDC }), review({ rating: 5, weight: USDC })];
  const mid = review({ rating: 2, reviewer: 'me' });
  assert.equal(accuracy(mid, split, seenAt(mid), clean, P).label, 'agrees');
});

test('only matured, unpaid reviews are scored, and the result is deterministic', () => {
  const old = review({ createdAt: 0, reviewer: 'a' });
  const young = review({ createdAt: 10 ** 9 - 10, reviewer: 'b' });
  const paid = review({ createdAt: 0, reviewer: 'c' });
  const input = {
    reviews: [old, young, paid],
    sightings: { [old.address]: seenAt(old), [young.address]: seenAt(young), [paid.address]: seenAt(paid) },
    failuresNow: {},
    paid: { [paid.address]: true },
    feeBps: PROTOCOL_FEE_BPS,
    now: 10 ** 9,
  };
  const a = scoreEpoch(input, DEVNET_REWARD_PARAMS);
  const b = scoreEpoch(structuredClone(input), DEVNET_REWARD_PARAMS);
  assert.deepEqual(a.rows.map((r) => r.review), [old.address]);
  assert.deepEqual(a, b);
  assert.equal(a.totals.a, (baseReward(USDC, PROTOCOL_FEE_BPS, DEVNET_REWARD_PARAMS) * 12_000n) / 10_000n);
});
