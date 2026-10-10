/**
 * A reference model of the program's book-keeping in plain TypeScript.
 *
 * It mirrors `settle`, `deliver`, `open_order` and `submit_review` in
 * `programs/tessera/src/lib.rs` step for step. Two things use it:
 *   - `scripts/test-local.ts` runs the real program on a local validator and
 *     checks every account against this model after every instruction;
 *   - the website's attack lab and the numbers in docs/SCORING.md run attacks
 *     through it, so those numbers are the program's own arithmetic.
 */
import type { Params } from './generated/types/params.js';
import {
  currentPenalty,
  evaluate,
  instantLimit,
  periodOf,
  TIER_WEIGHT,
  type ScoreAgent,
} from './score.js';

const BPS = 10_000n;
const minB = (a: bigint, b: bigint) => (a < b ? a : b);
const satSub = (a: bigint, b: bigint) => (a > b ? a - b : 0n);

export type ModelRole = {
  orders: number;
  volume: bigint;
  refunds: number;
  disputes: number;
  disputesLost: number;
  expired: number;
  instant: number;
};

export type ModelAgent = ScoreAgent & {
  counterparties: number;
  lastActivePeriod: bigint;
  reviewsReceived: number;
  asBuyer: ModelRole;
  asMerchant: ModelRole;
  instantExposure: bigint;
  score: number;
  tier: number;
  scoreUpdatedAt: bigint;
};

export type ModelPair = {
  orders: number;
  volume: bigint;
  creditToBuyer: bigint;
  creditToMerchant: bigint;
  pointsToBuyer: number;
  pointsToMerchant: number;
  ratedByBuyer: bigint;
  ratedByMerchant: bigint;
  firstSettledAt: bigint;
  lastSettledAt: bigint;
  disputes: number;
};

export type ModelOrder = {
  amount: bigint;
  feeBps: number;
  buyerTier: number;
  merchantTier: number;
  buyerScore: number;
  merchantScore: number;
  pairTrusted: boolean;
  holdSecs: number;
  instant: boolean;
  seasoned: boolean;
  complained: boolean;
  releaseAt: bigint;
  /** How it settled, once it has. */
  outcome: Outcome['kind'] | null;
  buyerReviewed: boolean;
  paidMerchant: bigint;
  paidFee: bigint;
  refunded: bigint;
};

const role = (): ModelRole => ({
  orders: 0,
  volume: 0n,
  refunds: 0,
  disputes: 0,
  disputesLost: 0,
  expired: 0,
  instant: 0,
});

export function newAgent(now: bigint): ModelAgent {
  return {
    registeredAt: now,
    credit: 0n,
    counterpartyPoints: 0,
    counterparties: 0,
    activePeriods: 0,
    lastActivePeriod: 0n,
    feesPaid: 0n,
    penaltyBps: 0,
    penaltyPeriod: 0n,
    ratingSum: 0n,
    ratingWeight: 0n,
    reviewsReceived: 0,
    asBuyer: role(),
    asMerchant: role(),
    instantExposure: 0n,
    score: 0,
    tier: 0,
    scoreUpdatedAt: 0n,
  };
}

export function newPair(): ModelPair {
  return {
    orders: 0,
    volume: 0n,
    creditToBuyer: 0n,
    creditToMerchant: 0n,
    pointsToBuyer: 0,
    pointsToMerchant: 0,
    ratedByBuyer: 0n,
    ratedByMerchant: 0n,
    firstSettledAt: 0n,
    lastSettledAt: 0n,
    disputes: 0,
  };
}

export function refresh(a: ModelAgent, p: Params, now: bigint): void {
  a.penaltyBps = Number(currentPenalty(a, p, now));
  a.penaltyPeriod = periodOf(now, p);
  const e = evaluate(a, p, now);
  a.score = e.score;
  a.tier = e.tier;
  a.scoreUpdatedAt = now;
}

function addPenalty(a: ModelAgent, p: Params, now: bigint, bps: number): void {
  const standing = currentPenalty(a, p, now);
  a.penaltyBps = Number(minB(standing + BigInt(bps), BPS));
  a.penaltyPeriod = periodOf(now, p);
}

function touchActivity(a: ModelAgent, p: Params, now: bigint): void {
  const period = periodOf(now, p);
  if (a.activePeriods === 0 || period > a.lastActivePeriod) {
    a.activePeriods += 1;
    a.lastActivePeriod = period;
  }
}

const weighted = (value: bigint, pct: bigint) => (value * pct) / 100n;

/** `open_order`: refresh both parties and price the risk. */
export function openOrder(
  buyer: ModelAgent,
  merchant: ModelAgent,
  pair: ModelPair,
  p: Params,
  feeBps: number,
  amount: bigint,
  now: bigint,
  /** A buyer may ask for a longer hold than the tiers call for. */
  minHoldSecs = 0,
): ModelOrder {
  refresh(buyer, p, now);
  refresh(merchant, p, now);
  const pairTrusted =
    pair.orders >= p.pairHistoryMin &&
    pair.disputes === 0 &&
    pair.firstSettledAt > 0n &&
    now - pair.firstSettledAt >= BigInt(p.pairAgeSecs) &&
    buyer.penaltyBps === 0;
  const buyerEffective = pairTrusted ? 3 : buyer.tier;
  return {
    amount,
    feeBps,
    buyerTier: buyer.tier,
    merchantTier: merchant.tier,
    buyerScore: buyer.score,
    merchantScore: merchant.score,
    pairTrusted,
    holdSecs: Math.max(p.holdSecs[merchant.tier]!, p.holdSecs[buyerEffective]!, minHoldSecs),
    instant: false,
    seasoned: false,
    complained: false,
    releaseAt: 0n,
    outcome: null,
    buyerReviewed: false,
    paidMerchant: 0n,
    paidFee: 0n,
    refunded: 0n,
  };
}

/**
 * `deliver`: start the hold, or settle instantly inside the instant limit --
 * only while the merchant is still Trusted.
 */
export function deliver(order: ModelOrder, merchant: ModelAgent, p: Params, now: bigint): void {
  let hold = order.holdSecs;
  let instant = false;
  if (hold === 0) {
    refresh(merchant, p, now);
    const exposure = merchant.instantExposure + order.amount;
    if (merchant.tier === 3 && exposure <= instantLimit(merchant, p)) {
      merchant.instantExposure = exposure;
      instant = true;
    } else {
      hold = Math.max(p.holdSecs[2]!, p.holdSecs[merchant.tier]!);
    }
  }
  order.instant = instant;
  order.releaseAt = now + BigInt(hold);
}

export type Outcome =
  | { kind: 'release' }
  | { kind: 'refund'; expired: boolean }
  | { kind: 'resolve'; merchantBps: number };

/** `settle`: pay out and update both credit files. */
export function settle(
  order: ModelOrder,
  buyer: ModelAgent,
  merchant: ModelAgent,
  pair: ModelPair,
  p: Params,
  outcome: Outcome,
  now: bigint,
  /** Anything paid beyond the price. It always returns to the buyer. */
  excess = 0n,
): void {
  const merchantBps =
    outcome.kind === 'release' ? 10_000n : outcome.kind === 'refund' ? 0n : BigInt(outcome.merchantBps);
  const gross = (order.amount * merchantBps) / BPS;
  const fee = (gross * BigInt(order.feeBps)) / BPS;
  order.paidMerchant = gross - fee;
  order.paidFee = fee;
  order.refunded = order.amount - gross + excess;
  order.outcome = outcome.kind;

  const m = merchant;
  const b = buyer;
  if (outcome.kind === 'release') {
    m.asMerchant.orders += 1;
    m.asMerchant.volume += gross;
    b.asBuyer.orders += 1;
    b.asBuyer.volume += gross;
    if (order.instant) {
      m.asMerchant.instant += 1;
      b.asBuyer.instant += 1;
    }
    m.feesPaid += fee;

    // The merchant's evidence waits for the buyer's review (see `review`).
    const pctForBuyer = TIER_WEIGHT[order.merchantTier]!;
    {
      const room = satSub(weighted(p.pairCap, pctForBuyer), pair.creditToBuyer);
      const earned = minB(weighted(gross, pctForBuyer), room);
      b.credit += earned;
      pair.creditToBuyer += earned;
    }

    if (pair.lastSettledAt === 0n) {
      m.counterparties += 1;
      b.counterparties += 1;
    }
    pair.volume += gross;
    pair.lastSettledAt = now;

    if (pair.volume >= p.pairCap / 10n) {
      const pb = Number(pctForBuyer);
      if (pb > pair.pointsToBuyer) {
        b.counterpartyPoints += pb - pair.pointsToBuyer;
        pair.pointsToBuyer = pb;
      }
    }

    touchActivity(b, p, now);
  } else if (outcome.kind === 'refund') {
    m.asMerchant.refunds += 1;
    b.asBuyer.refunds += 1;
    // The buyer got everything back: an instant order no longer counts.
    if (order.instant && !order.seasoned) {
      m.instantExposure = satSub(m.instantExposure, order.amount);
      order.seasoned = true;
    }
    if (outcome.expired) {
      m.asMerchant.expired += 1;
      addPenalty(m, p, now, p.penaltyExpiredBps);
    }
  } else {
    m.asMerchant.volume += gross;
    b.asBuyer.volume += gross;
    m.feesPaid += fee;
    if (merchantBps < 5_000n) {
      m.asMerchant.disputesLost += 1;
      addPenalty(m, p, now, p.penaltyDisputeBps);
    } else if (merchantBps > 5_000n) {
      b.asBuyer.disputesLost += 1;
      addPenalty(b, p, now, p.penaltyDisputeBps);
    }
  }
  refresh(m, p, now);
  refresh(b, p, now);
}

/** `open_dispute`. */
export function dispute(buyer: ModelAgent, merchant: ModelAgent, pair: ModelPair): void {
  buyer.asBuyer.disputes += 1;
  merchant.asMerchant.disputes += 1;
  pair.disputes += 1;
}

/** `submit_review`. Returns the weight the review carried. */
export function review(
  order: ModelOrder,
  reviewer: ModelAgent,
  subject: ModelAgent,
  pair: ModelPair,
  reviewerIsBuyer: boolean,
  rating: number,
  p: Params,
  now: bigint,
): bigint {
  // An instant order's rating decides whether the merchant gets that slice
  // of its instant limit back.
  let freed = 0n;
  if (reviewerIsBuyer && order.instant && !order.seasoned && !order.complained) {
    if (rating >= 3) {
      order.seasoned = true;
      freed = order.amount;
    } else {
      order.complained = true;
    }
  }
  subject.instantExposure = satSub(subject.instantExposure, freed);
  const settled = order.paidMerchant + order.paidFee;
  // A merchant's review counts once the buyer has spoken for the order; the
  // side that lost a dispute gets no weighted say.
  const half = (order.amount * 5_000n) / BPS;
  const counts =
    order.outcome === 'release'
      ? reviewerIsBuyer || order.buyerReviewed
      : order.outcome === 'resolve'
        ? reviewerIsBuyer
          ? settled <= half
          : settled >= half
        : true;
  if (reviewerIsBuyer) order.buyerReviewed = true;
  const q = TIER_WEIGHT[evaluate(reviewer, p, now).tier]!;
  const spent = reviewerIsBuyer ? pair.ratedByBuyer : pair.ratedByMerchant;
  const weight = counts ? minB(weighted(settled, q), satSub(weighted(p.pairCap, q), spent)) : 0n;
  if (reviewerIsBuyer) pair.ratedByBuyer += weight;
  else pair.ratedByMerchant += weight;
  subject.ratingSum += weight * BigInt(rating);
  subject.ratingWeight += weight;
  subject.reviewsReceived += 1;
  if (reviewerIsBuyer && order.outcome === 'release') grantMerchantEvidence(order, subject, pair, p, settled, now);
  refresh(subject, p, now);
  return weight;
}

/**
 * What a released order earns the merchant, granted at the buyer's review:
 * money moves without the buyer, reputation does not.
 */
function grantMerchantEvidence(order: ModelOrder, m: ModelAgent, pair: ModelPair, p: Params, gross: bigint, now: bigint): void {
  // Pair history, which can waive the buyer-side hold, is the buyer's word too.
  pair.orders += 1;
  if (pair.firstSettledAt === 0n) pair.firstSettledAt = now;
  const pct = TIER_WEIGHT[order.buyerTier]!;
  const room = satSub(weighted(p.pairCap, pct), pair.creditToMerchant);
  const earned = minB(weighted(gross, pct), room);
  m.credit += earned;
  pair.creditToMerchant += earned;
  if (pair.volume >= p.pairCap / 10n) {
    const pm = Number(pct);
    if (pm > pair.pointsToMerchant) {
      m.counterpartyPoints += pm - pair.pointsToMerchant;
      pair.pointsToMerchant = pm;
    }
  }
  touchActivity(m, p, now);
}

/**
 * `close_order`: an instant order nobody objected to stops counting. One the
 * buyer complained about keeps counting for the life of the identity.
 */
export function closeOrder(order: ModelOrder, merchant: ModelAgent): void {
  if (order.instant && !order.seasoned && !order.complained) {
    merchant.instantExposure = satSub(merchant.instantExposure, order.amount);
  }
}
