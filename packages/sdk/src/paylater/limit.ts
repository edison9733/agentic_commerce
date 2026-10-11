/**
 * The pay-later credit limit, line for line with
 * `programs/tessera-paylater/src/credit.rs`.
 *
 *   limit = tierLimit[tier] x score / 1000 x (1 + boost)
 *   boost = min(repaidOnTime x step, maxBoost)
 */
import type { CreditLine } from './generated/accounts/creditLine.js';
import type { LineParams } from './generated/types/lineParams.js';

const BPS = 10_000n;
const min = (a: bigint, b: bigint) => (a < b ? a : b);

export type LimitLine = Pick<CreditLine, 'defaults' | 'repaidOnTime' | 'outstanding'>;

/** A wallet that has never borrowed has no line yet: this is its blank one. */
export const NO_LINE: LimitLine = { defaults: 0, repaidOnTime: 0, outstanding: 0n };

export function limit(line: LimitLine, p: LineParams, tier: number, score: number): bigint {
  if (line.defaults > 0) return 0n;
  const base = (p.tierLimit[Math.min(tier, 3)]! * BigInt(Math.min(score, 1000))) / 1000n;
  const boost = min(BigInt(line.repaidOnTime) * BigInt(p.stepBps), BigInt(p.maxBoostBps));
  return (base * (BPS + boost)) / BPS;
}

export function available(line: LimitLine, p: LineParams, tier: number, score: number): bigint {
  const l = limit(line, p, tier, score);
  return l > line.outstanding ? l - line.outstanding : 0n;
}

export const feeOf = (amount: bigint, p: LineParams): bigint => (amount * BigInt(p.feeBps)) / BPS;
