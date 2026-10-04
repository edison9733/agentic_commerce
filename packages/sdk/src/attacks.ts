/**
 * Attacks, run through the reference model. Every number the docs, the pitch
 * and the website's attack lab quote comes out of these functions, so it is
 * the program's own arithmetic rather than an estimate.
 */
import type { Params } from './generated/types/params.js';
import * as model from './model.js';
import { evaluate, instantLimit } from './score.js';

export type RingSnapshot = {
  period: number;
  /** Best score and tier any wallet in the ring holds. */
  score: number;
  tier: number;
  /** Total pushed through escrow so far. */
  volume: bigint;
  /** Protocol fees burned so far. They never come back. */
  fees: bigint;
  /** Instant settlement the best wallet may carry unaccepted. */
  instantLimit: bigint;
};

export type RingResult = {
  wallets: number;
  snapshots: RingSnapshot[];
  /** First period in which a ring wallet is Trusted, or null if it never is. */
  trustedAt: number | null;
  /** The most the whole ring can take by exit-scamming through instant settlement. */
  maxInstantTake: bigint;
  fees: bigint;
  volume: bigint;
};

/**
 * A closed ring of brand-new wallets that only trade with each other. Every
 * period each wallet buys `orderSize` from every other wallet and both sides
 * leave each other five stars. This is the strongest version of reputation
 * farming that needs no outside help.
 */
export function simulateRing(opts: {
  params: Params;
  feeBps: number;
  wallets: number;
  orderSize: bigint;
  periods: number;
}): RingResult {
  const { params: p, feeBps, wallets: n, orderSize, periods } = opts;
  const period = BigInt(p.periodSecs);
  const t0 = 1_000_000n * period;
  const agents = Array.from({ length: n }, () => model.newAgent(t0));
  const pairs = new Map<number, model.ModelPair>();
  const pairOf = (b: number, m: number) => {
    const k = b * n + m;
    let v = pairs.get(k);
    if (!v) pairs.set(k, (v = model.newPair()));
    return v;
  };

  let volume = 0n;
  let fees = 0n;
  let trustedAt: number | null = null;
  const snapshots: RingSnapshot[] = [];

  for (let k = 1; k <= periods; k += 1) {
    const now = t0 + BigInt(k) * period;
    for (let b = 0; b < n; b += 1) {
      for (let m = 0; m < n; m += 1) {
        if (b === m) continue;
        const pair = pairOf(b, m);
        // A pair that can grant nothing more is not worth the fee.
        const cap = p.pairCap;
        if (pair.creditToMerchant >= cap && pair.creditToBuyer >= cap) continue;
        const order = model.openOrder(agents[b]!, agents[m]!, pair, p, feeBps, orderSize, now);
        model.deliver(order, agents[m]!, p, now);
        model.settle(order, agents[b]!, agents[m]!, pair, p, { kind: 'release' }, now);
        model.review(order, agents[b]!, agents[m]!, pair, true, 5, p, now);
        model.review(order, agents[m]!, agents[b]!, pair, false, 5, p, now);
        volume += orderSize;
        fees += order.paidFee;
      }
    }
    for (const a of agents) model.refresh(a, p, now);
    const best = agents.reduce((x, y) => (y.score > x.score ? y : x));
    if (trustedAt === null && best.tier === 3) trustedAt = k;
    snapshots.push({
      period: k,
      score: best.score,
      tier: best.tier,
      volume,
      fees,
      instantLimit: instantLimit(best, p),
    });
  }

  const maxInstantTake = agents.reduce((sum, a) => sum + (a.tier === 3 ? instantLimit(a, p) : 0n), 0n);
  return { wallets: n, snapshots, trustedAt, maxInstantTake, fees, volume };
}

export type JourneySnapshot = {
  period: number;
  score: number;
  tier: number;
  history: number;
  tenure: number;
  diversity: number;
  rating: number;
  holdSecs: number;
};

/**
 * A wallet that already sits at `tier`: full credit, diversity and five-star
 * reviews, with just enough active periods to pass that tier's time gate.
 * Used to stand in for counterparties that have a life outside a simulation.
 */
export function establishedAgent(p: Params, tier: 0 | 1 | 2 | 3, now: bigint): model.ModelAgent {
  const a = model.newAgent(now);
  if (tier === 0) return a;
  const active = tier === 3 ? Math.max(p.tierPeriods[2]!, p.tenureFull) : p.tierPeriods[tier - 1]!;
  a.registeredAt = now - BigInt(p.periodSecs) * BigInt(Math.max(active * 3, p.tenureFull));
  a.activePeriods = active;
  a.lastActivePeriod = now / BigInt(p.periodSecs);
  a.credit = p.creditFull;
  a.counterpartyPoints = p.diversityFull;
  a.ratingWeight = p.reviewPrior * 100n;
  a.ratingSum = a.ratingWeight * 5n;
  model.refresh(a, p, now);
  return a;
}

/**
 * An honest merchant that sells one order per period to each of `buyers`
 * customers who are already at `buyerTier` and rate it `rating` stars.
 */
export function simulateHonestMerchant(opts: {
  params: Params;
  feeBps: number;
  buyers: number;
  buyerTier: 0 | 1 | 2 | 3;
  orderSize: bigint;
  rating: number;
  periods: number;
}): JourneySnapshot[] {
  const { params: p, feeBps, buyers, buyerTier, orderSize, rating, periods } = opts;
  const period = BigInt(p.periodSecs);
  const t0 = 1_000_000n * period;
  const merchant = model.newAgent(t0);
  const customers = Array.from({ length: buyers }, () => establishedAgent(p, buyerTier, t0));
  const pairs = customers.map(() => model.newPair());
  const out: JourneySnapshot[] = [];

  for (let k = 1; k <= periods; k += 1) {
    const now = t0 + BigInt(k) * period;
    customers.forEach((c, i) => {
      const order = model.openOrder(c, merchant, pairs[i]!, p, feeBps, orderSize, now);
      model.deliver(order, merchant, p, now);
      model.settle(order, c, merchant, pairs[i]!, p, { kind: 'release' }, now);
      model.review(order, c, merchant, pairs[i]!, true, rating, p, now);
    });
    model.refresh(merchant, p, now);
    const e = evaluate(merchant, p, now);
    out.push({
      period: k,
      score: e.score,
      tier: e.tier,
      history: e.history,
      tenure: e.tenure,
      diversity: e.diversity,
      rating: e.rating,
      holdSecs: p.holdSecs[e.tier]!,
    });
  }
  return out;
}

/**
 * The most an exit scam can net from instant settlement, per identity.
 *
 * A Trusted merchant may carry `instantBase + fees it has paid` of instant
 * volume that buyers have not accepted. An order a buyer rates 1 or 2 stars
 * never stops counting, so once victims complain the merchant has no instant
 * capacity left. The fees are already gone, so:
 *
 *   profit = taken - sunk  <=  (instantBase + fees) - fees  =  instantBase
 *
 * That holds for the life of the identity as long as victims leave a rating
 * inside the review window. It is before the lost reputation, which cost
 * time that cannot be bought back.
 */
export function exitScamBound(p: Params, feesPaid: bigint): { take: bigint; sunk: bigint; net: bigint } {
  const take = p.instantBase + (feesPaid * BigInt(p.instantFeePct)) / 100n;
  return { take, sunk: feesPaid, net: take - feesPaid };
}
