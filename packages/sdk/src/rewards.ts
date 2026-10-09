/**
 * Review rewards: a share of the protocol fee, paid to whoever left a review
 * that counted, scaled by how accurate the review proved to be.
 *
 *   base   = weight x feeBps x shareBps / 10^8      (never depends on the stars)
 *   reward = base x accuracy / 10^4
 *
 * `weight` is the program's own review weight: the money that settled on the
 * order, scaled by the reviewer's tier and capped per pair. A review of a
 * refund, or by the side that lost a dispute, weighs 0 and earns nothing.
 *
 * Accuracy is judged once the review is `maturitySecs` old, from what happened
 * next: did the subject go on to lose a dispute or miss a delivery, and does
 * the rating agree with what other reviewers of the same subject said around
 * the same time? An honest warning is paid the most; a glowing review of a
 * wallet that then failed is paid nothing.
 *
 * Weight <= settled and the fee is settled x feeBps, so each side's base is at
 * most shareBps of the order's fee. With shareBps = 2500 and the 1.5x ceiling,
 * both sides together get back at most 75% of the fee: trading with yourself
 * to farm rewards always costs more than it pays.
 *
 * Every input is public chain data plus one thing the chain does not keep:
 * the subject's failure counts at the moment the review was first seen. The
 * airdrop script records those and publishes them with each payout, so anyone
 * can recompute it (`npm run rewards -- --verify <report>`).
 */

export type RewardParams = {
  /** Share of the order's fee rate each side's review can earn at 1x, in basis points. */
  shareBps: number;
  /** A review is judged, and paid, this long after it was written. */
  maturitySecs: number;
  /** Other reviews of the same subject within this many seconds either side form the consensus. */
  consensusWindowSecs: number;
  /** A review first seen later than this after it was written has no "before" state to compare. */
  lateSightSecs: number;
  /** Payouts smaller than this carry over to the next epoch, in token units. */
  dustUnits: bigint;
};

/** The ceiling of the accuracy multiplier, in basis points. The fee bound above relies on it. */
export const MAX_ACCURACY_BPS = 15_000;

export const DEVNET_REWARD_PARAMS: RewardParams = {
  shareBps: 2500,
  maturitySecs: 600,
  consensusWindowSecs: 3600,
  lateSightSecs: 120,
  dustUnits: 1_000n,
};

export const MAINNET_REWARD_PARAMS: RewardParams = {
  shareBps: 2500,
  maturitySecs: 14 * 86_400,
  consensusWindowSecs: 30 * 86_400,
  lateSightSecs: 86_400,
  dustUnits: 10_000n,
};

/** The fields of a Review account the rules read. */
export type RewardReview = {
  address: string;
  reviewer: string;
  subject: string;
  reviewerIsBuyer: boolean;
  rating: number;
  weight: bigint;
  createdAt: number;
};

/** How often a wallet has failed in the role the review judged it in. */
export type Failures = { disputesLost: number; missed: number };

/** When the airdrop first saw a review, and the subject's failures at that moment. */
export type Sighting = { firstSeenAt: number; before: Failures };

export type AccuracyLabel =
  | 'early_warning'
  | 'vouched_then_failed'
  | 'failed_neutral'
  | 'agrees'
  | 'fair'
  | 'outlier'
  | 'no_peers';

export type Accuracy = {
  bps: number;
  label: AccuracyLabel;
  /** Money-weighted average of the peers' stars, in thousandths, when there were peers. */
  consensusMilli: number | null;
  /** Whether the subject failed after the review; null when the review was first seen too late to tell. */
  failedAfter: boolean | null;
};

export const ACCURACY_TEXT: Record<AccuracyLabel, string> = {
  early_warning: 'Warned others, then the wallet failed: paid 1.5x',
  vouched_then_failed: 'Rated it 4 or 5 stars, then the wallet failed: paid nothing',
  failed_neutral: 'Rated it 3 stars, then the wallet failed: paid 1x',
  agrees: 'Within 1 star of what other reviewers said: paid 1.2x',
  fair: 'Within 2 stars of what other reviewers said: paid 1x',
  outlier: 'More than 2 stars from what everyone else said: paid 0.5x',
  no_peers: 'Nobody else reviewed it around then: paid 1x',
};

const ACCURACY_BPS: Record<AccuracyLabel, number> = {
  early_warning: 15_000,
  vouched_then_failed: 0,
  failed_neutral: 10_000,
  agrees: 12_000,
  fair: 10_000,
  outlier: 5_000,
  no_peers: 10_000,
};

/** What a review earns at 1x. The stars play no part. */
export function baseReward(weight: bigint, feeBps: number, p: RewardParams): bigint {
  if (weight <= 0n) return 0n;
  return (weight * BigInt(feeBps) * BigInt(p.shareBps)) / 100_000_000n;
}

/** The most a review of this weight can earn, at the accuracy ceiling. */
export const maxReward = (weight: bigint, feeBps: number, p: RewardParams): bigint =>
  (baseReward(weight, feeBps, p) * BigInt(MAX_ACCURACY_BPS)) / 10_000n;

/** The other reviews of the same subject, in the same direction, around the same time, that counted. */
export function peersOf(r: RewardReview, all: RewardReview[], p: RewardParams): RewardReview[] {
  return all.filter(
    (o) =>
      o.address !== r.address &&
      o.subject === r.subject &&
      o.reviewer !== r.reviewer &&
      o.reviewerIsBuyer === r.reviewerIsBuyer &&
      o.weight > 0n &&
      Math.abs(o.createdAt - r.createdAt) <= p.consensusWindowSecs,
  );
}

const failures = (f: Failures) => f.disputesLost + f.missed;

export function accuracy(r: RewardReview, peers: RewardReview[], seen: Sighting | undefined, after: Failures, p: RewardParams): Accuracy {
  const knowable = !!seen && seen.firstSeenAt - r.createdAt <= p.lateSightSecs;
  const failedAfter = knowable ? failures(after) > failures(seen!.before) : null;

  let consensusMilli: number | null = null;
  const total = peers.reduce((s, o) => s + o.weight, 0n);
  if (total > 0n) consensusMilli = Number(peers.reduce((s, o) => s + o.weight * BigInt(o.rating) * 1000n, 0n) / total);

  let label: AccuracyLabel;
  if (failedAfter) label = r.rating <= 2 ? 'early_warning' : r.rating === 3 ? 'failed_neutral' : 'vouched_then_failed';
  else if (consensusMilli === null) label = 'no_peers';
  else {
    const gap = Math.abs(r.rating * 1000 - consensusMilli);
    label = gap <= 1000 ? 'agrees' : gap <= 2000 ? 'fair' : 'outlier';
  }
  return { bps: ACCURACY_BPS[label], label, consensusMilli, failedAfter };
}

export type RewardRow = {
  review: string;
  reviewer: string;
  subject: string;
  reviewerIsBuyer: boolean;
  rating: number;
  weight: bigint;
  base: bigint;
  accuracy: Accuracy;
  reward: bigint;
};

export type EpochInput = {
  /** Every review on chain: the ones being paid and the peers they are compared with. */
  reviews: RewardReview[];
  /** First sightings, by review address. */
  sightings: Record<string, Sighting>;
  /** Each subject's failures now, keyed `${wallet}:merchant` or `${wallet}:buyer`. */
  failuresNow: Record<string, Failures>;
  /** Reviews already paid, by address. */
  paid: Record<string, unknown>;
  feeBps: number;
  now: number;
};

/** The role a review judged its subject in: a buyer reviews a merchant, and the other way round. */
export const subjectKey = (r: Pick<RewardReview, 'subject' | 'reviewerIsBuyer'>) => `${r.subject}:${r.reviewerIsBuyer ? 'merchant' : 'buyer'}`;

/** Score every matured, unpaid review. Deterministic: the same input gives the same rows. */
export function scoreEpoch(input: EpochInput, p: RewardParams): { rows: RewardRow[]; totals: Record<string, bigint> } {
  const none: Failures = { disputesLost: 0, missed: 0 };
  const rows: RewardRow[] = [];
  const due = input.reviews
    .filter((r) => r.weight > 0n && r.createdAt + p.maturitySecs <= input.now && !(r.address in input.paid))
    .sort((a, b) => a.createdAt - b.createdAt || (a.address < b.address ? -1 : 1));
  for (const r of due) {
    const acc = accuracy(r, peersOf(r, input.reviews, p), input.sightings[r.address], input.failuresNow[subjectKey(r)] ?? none, p);
    const base = baseReward(r.weight, input.feeBps, p);
    rows.push({ review: r.address, reviewer: r.reviewer, subject: r.subject, reviewerIsBuyer: r.reviewerIsBuyer, rating: r.rating, weight: r.weight, base, accuracy: acc, reward: (base * BigInt(acc.bps)) / 10_000n });
  }
  const totals: Record<string, bigint> = {};
  for (const row of rows) totals[row.reviewer] = (totals[row.reviewer] ?? 0n) + row.reward;
  return { rows, totals };
}

/** A wallet's failures in each role, from its Agent account's counters. */
export function failuresOf(a: { asMerchant: { disputesLost: number; expired: number }; asBuyer: { disputesLost: number } }): { merchant: Failures; buyer: Failures } {
  return {
    merchant: { disputesLost: a.asMerchant.disputesLost, missed: a.asMerchant.expired },
    buyer: { disputesLost: a.asBuyer.disputesLost, missed: 0 },
  };
}
