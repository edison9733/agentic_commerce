/**
 * The review-reward airdrop, as functions: watch reviews, score the ones that
 * have matured, pay from the treasury, and check a published payout.
 * `scripts/rewards.ts` is the command line; `scripts/demo-rewards.ts` uses
 * the same functions on a local validator. The rules are in
 * packages/sdk/src/rewards.ts and docs/REWARDS.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Address } from '@solana/kit';
import {
  configPda,
  fetchAllAgents,
  fetchAllReviews,
  fetchMaybeConfig,
  fromUnits,
  rewards,
  type EpochInput,
  type Failures,
  type ProgramAccountsRpc,
  type RewardParams,
  type RewardReview,
  type RewardRow,
  type Sighting,
} from '@tessera/sdk';
import { chainTime, sigOf, tokenHelpers, type ScriptClient } from './lib.js';

export type Ledger = {
  version: 1;
  /** When each review was first seen, and its subject's failures then. */
  sightings: Record<string, Sighting>;
  /** Reviews already scored, so none is paid twice. */
  paid: Record<string, { epoch: string; reward: string; label: string }>;
  /** Earned but below the dust threshold, carried to the next payout. */
  carry: Record<string, string>;
};

export type Chain = {
  now: number;
  feeBps: number;
  mint: Address;
  treasury: Address;
  reviews: RewardReview[];
  failuresNow: Record<string, Failures>;
};

export type Payout = { wallet: string; amount: string; usdc: string; reviews: string[]; signature?: string };

export type Report = {
  epoch: string;
  params: Omit<RewardParams, 'dustUnits'> & { dustUnits: string };
  input: Omit<EpochInput, 'paid'> & { paidBefore: string[] };
  rows: (Omit<RewardRow, 'weight' | 'base' | 'reward'> & { weight: string; base: string; reward: string; why: string })[];
  payouts: Payout[];
  carried: Record<string, string>;
  totals: { reviews: number; paid: string; paidUsdc: string };
};

const big = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

export function loadLedger(path: string): Ledger {
  if (!existsSync(path)) return { version: 1, sightings: {}, paid: {}, carry: {} };
  return JSON.parse(readFileSync(path, 'utf8')) as Ledger;
}

export function saveJson(path: string, v: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(v, big, 2)}\n`);
}

/** Every review and every wallet's failure counters, read from the chain now. */
export async function readChain(c: ScriptClient): Promise<Chain> {
  const rpc = c.rpc as unknown as ProgramAccountsRpc;
  const [reviews, agents, config, now] = await Promise.all([fetchAllReviews(rpc), fetchAllAgents(rpc), fetchMaybeConfig(c.rpc, await configPda()), chainTime(c)]);
  if (!config.exists) throw new Error('no Tessera config on this cluster');
  const failuresNow: Record<string, Failures> = {};
  for (const a of agents) {
    const f = rewards.failuresOf(a.data);
    failuresNow[`${a.data.wallet}:merchant`] = f.merchant;
    failuresNow[`${a.data.wallet}:buyer`] = f.buyer;
  }
  return {
    now: Number(now),
    feeBps: config.data.feeBps,
    mint: config.data.mint,
    treasury: config.data.treasury,
    reviews: reviews.map((r) => ({
      address: r.address,
      reviewer: r.data.reviewer,
      subject: r.data.subject,
      reviewerIsBuyer: r.data.reviewerIsBuyer,
      rating: r.data.rating,
      weight: r.data.weight,
      createdAt: Number(r.data.createdAt),
    })),
    failuresNow,
  };
}

/** Record when each new review was first seen and how its subject stood then. Run this often. */
export function observe(ledger: Ledger, chain: Chain): number {
  let added = 0;
  for (const r of chain.reviews) {
    if (ledger.sightings[r.address]) continue;
    ledger.sightings[r.address] = { firstSeenAt: chain.now, before: chain.failuresNow[rewards.subjectKey(r)] ?? { disputesLost: 0, missed: 0 } };
    added += 1;
  }
  return added;
}

/** Score the reviews that have matured and add up what each wallet is owed, carry included. */
export function score(ledger: Ledger, chain: Chain, p: RewardParams, decimals = 6): Report {
  const input: EpochInput = { reviews: chain.reviews, sightings: ledger.sightings, failuresNow: chain.failuresNow, paid: ledger.paid, feeBps: chain.feeBps, now: chain.now };
  const { rows, totals } = rewards.scoreEpoch(input, p);
  const epoch = new Date(chain.now * 1000).toISOString().replace(/\.\d+Z$/, 'Z');

  const owed: Record<string, bigint> = {};
  for (const [w, v] of Object.entries(ledger.carry)) owed[w] = BigInt(v);
  for (const [w, v] of Object.entries(totals)) owed[w] = (owed[w] ?? 0n) + v;
  const payouts: Payout[] = [];
  const carried: Record<string, string> = {};
  for (const [wallet, amount] of Object.entries(owed).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (amount <= 0n) continue;
    if (amount < p.dustUnits) carried[wallet] = amount.toString();
    else payouts.push({ wallet, amount: amount.toString(), usdc: fromUnits(amount, decimals), reviews: rows.filter((r) => r.reviewer === wallet).map((r) => r.review) });
  }

  // Only what is needed to recompute these rows goes in the report.
  const due = new Set(rows.map((r) => r.review));
  const subjects = new Set(rows.map((r) => rewards.subjectKey(r)));
  const paid = payouts.reduce((s, x) => s + BigInt(x.amount), 0n);
  return {
    epoch,
    params: { ...p, dustUnits: p.dustUnits.toString() },
    input: {
      reviews: chain.reviews,
      sightings: Object.fromEntries(Object.entries(ledger.sightings).filter(([k]) => due.has(k))),
      failuresNow: Object.fromEntries(Object.entries(chain.failuresNow).filter(([k]) => subjects.has(k))),
      paidBefore: Object.keys(ledger.paid),
      feeBps: chain.feeBps,
      now: chain.now,
    },
    rows: rows.map((r) => ({ ...r, weight: r.weight.toString(), base: r.base.toString(), reward: r.reward.toString(), why: rewards.ACCURACY_TEXT[r.accuracy.label] })),
    payouts,
    carried,
    totals: { reviews: rows.length, paid: paid.toString(), paidUsdc: fromUnits(paid, decimals) },
  };
}

/**
 * Send each payout from the treasury's token account, a few per transaction,
 * creating the recipient's token account when it has none. Then mark the
 * reviews paid and keep the carry. The ledger is saved by the caller.
 */
export async function pay(report: Report, ledger: Ledger, treasury: ScriptClient, mint: Address, perTx = 4): Promise<void> {
  const tok = tokenHelpers(treasury, mint);
  const need = report.payouts.reduce((s, x) => s + BigInt(x.amount), 0n);
  const have = await tok.balance(treasury.identity.address);
  if (have < need) throw new Error(`the treasury holds ${fromUnits(have, 6)} USDC, this payout needs ${fromUnits(need, 6)}`);
  for (let i = 0; i < report.payouts.length; i += perTx) {
    const batch = report.payouts.slice(i, i + perTx);
    const ixs = [];
    for (const x of batch) {
      const owner = x.wallet as Address;
      ixs.push(await tok.ensureAtaIx(owner), await tok.transferIx(treasury, await tok.ata(owner), BigInt(x.amount)));
    }
    const sig = sigOf(await treasury.sendTransaction(ixs));
    for (const x of batch) x.signature = sig;
  }
  record(report, ledger);
}

/** Mark the report's reviews scored and replace the carry. Also what a dry run would have done. */
export function record(report: Report, ledger: Ledger): void {
  for (const r of report.rows) ledger.paid[r.review] = { epoch: report.epoch, reward: r.reward, label: r.accuracy.label };
  ledger.carry = { ...report.carried };
}

/** Recompute a published report from its own inputs. Returns the rows that disagree. */
export function verify(report: Report): string[] {
  const p: RewardParams = { ...report.params, dustUnits: BigInt(report.params.dustUnits) };
  const revive = (r: RewardReview) => ({ ...r, weight: BigInt(r.weight as unknown as string) });
  const { rows } = rewards.scoreEpoch(
    {
      reviews: report.input.reviews.map(revive),
      sightings: report.input.sightings,
      failuresNow: report.input.failuresNow,
      paid: Object.fromEntries(report.input.paidBefore.map((k) => [k, true])),
      feeBps: report.input.feeBps,
      now: report.input.now,
    },
    p,
  );
  const got = new Map(rows.map((r) => [r.review, r]));
  const bad: string[] = [];
  for (const r of report.rows) {
    const g = got.get(r.review);
    if (!g || g.reward.toString() !== r.reward || g.accuracy.label !== r.accuracy.label) bad.push(r.review);
  }
  if (rows.length !== report.rows.length) bad.push(`row count ${rows.length} != ${report.rows.length}`);
  return bad;
}
