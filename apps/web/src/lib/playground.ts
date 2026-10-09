import { score, type Evaluation, type Params, type ScoreAgent } from '@tessera/sdk';

/** A wallet described the way a person would: what it sold, to whom, for how long, and how it went. */
export type Wallet = {
  /** Total sales, in USDC base units. */
  sales: bigint;
  /** Distinct buyers the sales were spread across. */
  buyers: number;
  /** The tier those buyers were in when they bought. */
  buyerTier: 0 | 1 | 2 | 3;
  /** Periods (days on mainnet, minutes on devnet) in which the wallet actually traded. */
  activePeriods: number;
  /** Average stars its buyers gave. */
  stars: number;
  /** Disputes lost recently. */
  disputesLost: number;
};

export type Outcome = {
  e: Evaluation;
  /** Sales that count as evidence, after the buyer's tier and the per-buyer cap. */
  counted: bigint;
  /** Stars after blending with the 3-star starting point. */
  shownStars: number;
  instantLimit: bigint;
};

const USDC = 1_000_000n;

/**
 * Turns a wallet into the account the program would hold and scores it with
 * the program's own arithmetic. Sales are spread evenly across buyers; each
 * buyer counts for its tier's share and only up to the per-buyer cap, exactly
 * as the program grants credit and review weight.
 */
export function outcome(w: Wallet, p: Params): Outcome {
  const period = BigInt(p.periodSecs);
  const now = 1_000_000n * period;
  const pct = score.TIER_WEIGHT[w.buyerTier];
  const buyers = BigInt(w.buyers);
  const perBuyer = buyers > 0n ? w.sales / buyers : 0n;
  // Each buyer counts up to the cap; spread evenly, that is the smaller of all sales and buyers x cap.
  const capped = buyers * p.pairCap;
  const counted = ((w.sales < capped ? w.sales : capped) * pct) / 100n;
  // A buyer adds Diversity once it has bought a tenth of the cap.
  const points = buyers > 0n && perBuyer >= p.pairCap / 10n ? w.buyers * Number(pct) : 0;
  const tenths = BigInt(Math.round(w.stars * 10));
  const a: ScoreAgent = {
    registeredAt: now - period * BigInt(w.activePeriods * 3),
    credit: counted,
    counterpartyPoints: points,
    activePeriods: w.activePeriods,
    feesPaid: w.sales / 100n,
    penaltyBps: Math.min(10_000, w.disputesLost * p.penaltyDisputeBps),
    penaltyPeriod: now / period,
    ratingSum: (counted * tenths) / 10n,
    ratingWeight: counted,
  };
  return { e: score.evaluate(a, p, now), counted, shownStars: score.averageStars(a, p), instantLimit: score.instantLimit(a, p) };
}

/** Ready-made wallets to start from, sized to the parameters in use. */
export function presets(p: Params): { id: string; title: string; blurb: string; w: Wallet }[] {
  const full = p.creditFull;
  const days = p.tierPeriods;
  return [
    {
      id: 'new',
      title: 'Brand new',
      blurb: 'No sales yet. Everyone starts here.',
      w: { sales: 0n, buyers: 0, buyerTier: 2, activePeriods: 0, stars: 3, disputesLost: 0 },
    },
    {
      id: 'small',
      title: 'Small honest shop',
      blurb: 'A few sales to a dozen real buyers, good reviews.',
      w: { sales: full / 5n, buyers: 12, buyerTier: 1, activePeriods: days[1]! + 2, stars: 4.5, disputesLost: 0 },
    },
    {
      id: 'busy',
      title: 'Busy and well reviewed',
      blurb: 'Lots of sales to many established buyers, for a long time.',
      w: { sales: (full * 3n) / 2n, buyers: 30, buyerTier: 2, activePeriods: days[2]! + 5, stars: 4.8, disputesLost: 0 },
    },
    {
      id: 'dispute',
      title: 'Same, but lost a dispute',
      blurb: 'The busy seller, after a buyer won a dispute against it.',
      w: { sales: (full * 3n) / 2n, buyers: 30, buyerTier: 2, activePeriods: days[2]! + 5, stars: 4.8, disputesLost: 1 },
    },
    {
      id: 'fake',
      title: 'Sells to itself',
      blurb: 'The same sales, but to 5 brand-new wallets it made, all leaving 5 stars.',
      w: { sales: (full * 3n) / 2n, buyers: 5, buyerTier: 0, activePeriods: days[2]! + 5, stars: 5, disputesLost: 0 },
    },
  ];
}

/** Slider position (0..1000) to sales and back. Squared, so small amounts get most of the track. */
export const salesMax = (p: Params) => p.creditFull * 5n;
export function salesAt(pos: number, p: Params): bigint {
  const raw = (salesMax(p) * BigInt(pos * pos)) / 1_000_000n;
  const step = p.creditFull >= 1000n * USDC ? 10n * USDC : USDC / 100n;
  return (raw / step) * step;
}
export function posOf(sales: bigint, p: Params): number {
  const r = Number(sales) / Number(salesMax(p));
  return Math.round(Math.sqrt(Math.max(0, Math.min(1, r))) * 1000);
}
