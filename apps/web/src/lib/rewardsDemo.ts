/**
 * The review-reward airdrop, as recorded by `npm run demo:rewards`: real
 * purchases, reviews, a merchant that then failed, and the payout, on a local
 * validator running the real program. Nothing here is made up.
 */
import demo from '../../../../deployments/rewards-demo.json';

export type RewardRow = { reviewer: string; subject: string; rating: number; weight: string; base: string; label: string; bps: number; reward: string; why: string };

export const rows = demo.rows as RewardRow[];
export const story = demo.story as { buyer: string; merchant: string; rating: number; comment: string }[];
export const fees = demo.fees;
export const estimate = demo.estimate as { buyer: string; merchant: string; amount: string; rating: number; reward: { atOneTimes: { usdc: string }; upTo: { usdc: string } } };
export const afterwards = demo.afterwards;
export const recordedAt = demo.recordedAt.slice(0, 10);
export const reproduce = demo.reproduce;
export const comment = (reviewer: string, subject: string) => story.find((s) => s.buyer === reviewer && s.merchant === subject)?.comment ?? '';
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** What each accuracy label pays, as a multiplier, and a short name for it. */
export const LABELS: Record<string, { x: string; short: string; tone: 'good' | 'bad' | 'plain' }> = {
  early_warning: { x: '1.5×', short: 'warned, then it failed', tone: 'good' },
  agrees: { x: '1.2×', short: 'agrees with other buyers', tone: 'good' },
  fair: { x: '1×', short: 'close to other buyers', tone: 'plain' },
  no_peers: { x: '1×', short: 'nothing to compare yet', tone: 'plain' },
  failed_neutral: { x: '1×', short: '3 stars, then it failed', tone: 'plain' },
  outlier: { x: '0.5×', short: 'far from everyone else', tone: 'bad' },
  vouched_then_failed: { x: '0×', short: 'praised it, then it failed', tone: 'bad' },
};
