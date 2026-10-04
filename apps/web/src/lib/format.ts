import { fromUnits, shortAddress, TIER_NAMES } from '@tessera/sdk';

export const usd = (units: bigint, dp = 2): string => `$${fromUnits(units, 6, dp)}`;

export function compactUsd(units: bigint): string {
  const n = Number(units) / 1e6;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

/** 0 -> "instant", 45 -> "45 s", 3600 -> "1 h", 259200 -> "3 d". */
export function duration(secs: number): string {
  if (secs <= 0) return 'instant';
  if (secs < 90) return `${secs} s`;
  if (secs < 5400) return `${Math.round(secs / 60)} min`;
  if (secs < 129_600) return `${Math.round(secs / 3600)} h`;
  return `${Math.round(secs / 86_400)} d`;
}

export function ago(unixSecs: number, now = Date.now() / 1000): string {
  const d = Math.max(0, Math.floor(now - unixSecs));
  if (d < 5) return 'just now';
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86_400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86_400)}d ago`;
}

export const tierName = (t: number) => TIER_NAMES[Math.max(0, Math.min(3, t))]!;
export const short = shortAddress;

export const explorerAddress = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
export const explorerTx = (s: string) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;

export const TIER_DARK = ['#35705a', '#2f9e73', '#4fd19a', '#b9f8da'] as const;
export const TIER_LIGHT = ['#62ad89', '#2f8f66', '#126b4a', '#083d2a'] as const;
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500'] as const;
