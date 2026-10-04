import { address } from '@solana/kit';
import type { Params } from './generated/types/params.js';

export { TESSERA_PROGRAM_ADDRESS } from './generated/programs/tessera.js';

/** Circle's USDC on Solana devnet. */
export const USDC_DEVNET = address('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
export const USDC_DECIMALS = 6;

/** CAIP-2 id of Solana devnet, as x402 v2 names networks. */
export const SOLANA_DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

export const TIER_NAMES = ['New', 'Building', 'Established', 'Trusted'] as const;
export type TierName = (typeof TIER_NAMES)[number];

export const ORDER_STATE_NAMES = [
  'AwaitingPayment',
  'Funded',
  'Delivered',
  'Released',
  'Refunded',
  'Disputed',
  'Resolved',
] as const;

export const PROTOCOL_FEE_BPS = 100;

const USDC = 1_000_000n;

/**
 * What the devnet deployment runs with. Time and amounts are compressed so a
 * wallet's whole journey from New to Trusted can be watched in under an hour
 * with a few dollars of test USDC. The formula itself is the same everywhere.
 */
export const DEVNET_PARAMS: Params = {
  periodSecs: 60,
  holdSecs: [120, 45, 10, 0],
  tierScore: [250, 500, 750],
  tierPeriods: [2, 8, 20],
  creditFull: 5n * USDC,
  pairCap: 1n * USDC,
  tenureFull: 30,
  diversityFull: 500,
  reviewPrior: USDC / 2n,
  minOrder: 1_000n,
  deliverSecs: 300,
  unpaidSecs: 300,
  reviewSecs: 600,
  complaintSecs: 1800,
  instantBase: USDC / 4n,
  instantFeePct: 100,
  pairHistoryMin: 2,
  pairAgeSecs: 300,
  penaltyDisputeBps: 2500,
  penaltyExpiredBps: 1000,
  penaltyDecayBps: 25,
};

/**
 * The same rules at the scale they are meant for. Not deployed anywhere: these
 * are the targets the devnet numbers were compressed from.
 */
export const MAINNET_TARGET_PARAMS: Params = {
  periodSecs: 86_400,
  holdSecs: [3 * 86_400, 86_400, 3_600, 0],
  tierScore: [250, 500, 750],
  tierPeriods: [3, 14, 30],
  creditFull: 10_000n * USDC,
  pairCap: 500n * USDC,
  tenureFull: 90,
  diversityFull: 2000,
  reviewPrior: 250n * USDC,
  minOrder: 1_000n,
  deliverSecs: 86_400,
  unpaidSecs: 1_800,
  reviewSecs: 14 * 86_400,
  complaintSecs: 90 * 86_400,
  instantBase: 25n * USDC,
  instantFeePct: 100,
  pairHistoryMin: 2,
  pairAgeSecs: 30 * 86_400,
  penaltyDisputeBps: 2500,
  penaltyExpiredBps: 1000,
  penaltyDecayBps: 25,
};
