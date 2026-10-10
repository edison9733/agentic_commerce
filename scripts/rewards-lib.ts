/**
 * The review-reward airdrop, as functions: watch reviews, score the ones that
 * have matured, pay from the treasury, and check a published payout.
 * `scripts/rewards.ts` is the command line; `scripts/demo-rewards.ts` uses
 * the same functions on a local validator. The rules are in
 * packages/sdk/src/rewards.ts and docs/REWARDS.md.
 *
 * Nothing is paid twice:
 * - each batch is written to the ledger as pending before it is sent, and as
 *   paid as soon as it confirms; the ledger is written atomically;
 * - every payout transaction carries a memo naming the reviews it pays, and a
 *   paying run first reads the payer's and the treasury's recent memos and
 *   skips what they name;
 * - one lock file per ledger, so two runs never pay at once.
 */
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import {
  address,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  fetchEncodedAccounts,
  getBase58Encoder,
  getTransactionMessageSize,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
  type Signature,
} from '@solana/kit';
import { getSetComputeUnitLimitInstruction } from '@solana-program/compute-budget';
import { AccountState, fetchAllMaybeToken, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import {
  configPda,
  decodeOrder,
  fetchAllAgents,
  fetchAllReviews,
  fetchMaybeConfig,
  fromUnits,
  ORDER_DISCRIMINATOR,
  rewards,
  TESSERA_PROGRAM_ADDRESS,
  type EpochInput,
  type Failures,
  type ProgramAccountsRpc,
  type RewardParams,
  type RewardReview,
  type RewardRow,
  type Sighting,
} from '@tessera/sdk';
import { chainTime, sigOf, tokenHelpers, type ScriptClient } from './lib.js';

type Mark = { epoch: string; reward: string; label: string };

/** A payout transaction sent but not yet known to have landed. */
export type Pending = {
  /** Local time it was handed to the RPC, in ms. */
  sentAt: number;
  /** The wallet that signed it. */
  payer: string;
  /** The batch tag in its memo, unique to this send. */
  tag: string;
  /** Every review its memo names. */
  reviews: string[];
  /** The ledger entries to write if it landed. */
  marks: Record<string, Mark>;
  /** Wallets whose carry it pays. */
  carryOf: string[];
};

export type Ledger = {
  version: 1;
  /** When each review was first seen, its subject's failures then, and its order's fee rate. */
  sightings: Record<string, Sighting>;
  /** Reviews already scored, so none is paid twice, and the transfer that paid each. */
  paid: Record<string, Mark & { signature?: string }>;
  /** Earned but not sent (under the dust threshold, or no token account), carried to the next payout. */
  carry: Record<string, string>;
  /** The reviews each carried amount was earned by, named in the memo of the payout that sends it. */
  carryReviews?: Record<string, string[]>;
  pending?: Pending;
};

export type Chain = {
  now: number;
  feeBps: number;
  mint: Address;
  treasury: Address;
  /** Names the cluster. */
  genesisHash: string;
  reviews: RewardReview[];
  failuresNow: Record<string, Failures>;
  /** The fee rate of the order of each review not sighted yet, when the order still exists. */
  orderFeeBps: Record<string, number>;
};

/** One transfer. A wallet with many reviews gets several, so each memo fits its transaction. */
export type Payout = { wallet: string; amount: string; usdc: string; reviews: string[]; signature?: string };

export type ParamsSet = 'devnet' | 'mainnet' | 'custom';

export type Report = {
  epoch: string;
  /** Genesis hash of the cluster it was scored and paid on. */
  network: string;
  /** Which documented set `params` is; `custom` flags anything else. */
  paramsSet: ParamsSet;
  params: Omit<RewardParams, 'dustUnits'> & { dustUnits: string };
  input: Omit<EpochInput, 'paid'> & { paidBefore: string[] };
  /** Owed from earlier payouts (the previous report's `carried`), and the reviews it was earned by. */
  carryIn: Record<string, string>;
  carryInReviews: Record<string, string[]>;
  rows: (Omit<RewardRow, 'weight' | 'base' | 'reward'> & { weight: string; base: string; reward: string; why: string })[];
  payouts: Payout[];
  /** Wallets not paid this time because they have no usable USDC token account; their amount is carried. */
  withheld: Record<string, string>;
  carried: Record<string, string>;
  carriedReviews: Record<string, string[]>;
  totals: { reviews: number; paid: string; paidUsdc: string };
};

export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const DOCUMENTED_PARAMS: Record<Exclude<ParamsSet, 'custom'>, RewardParams> = { devnet: rewards.DEVNET_REWARD_PARAMS, mainnet: rewards.MAINNET_REWARD_PARAMS };

const MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const MEMO_TAG = 'tessera-rewards 1';
/** A transfer's memo names at most this many reviews, so one transfer always fits a transaction. */
export const REVIEWS_PER_TRANSFER = 16;
/** A v0 transaction's 1232 bytes, less room for anything `sendTransaction` adds. */
const TX_LIMIT = 1232 - 64;
/** A sent transaction's blockhash has expired by then (150 blocks, about a minute), so it can no longer land. */
const PENDING_EXPIRY_MS = 3 * 60_000;

const big = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

export const emptyLedger = (): Ledger => ({ version: 1, sightings: {}, paid: {}, carry: {} });

/** The payout reports in these folders. */
function reportsIn(dirs: string[]): string[] {
  const out: string[] = [];
  for (const d of new Set(dirs)) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (/^epoch-.*\.json$/.test(f) && !f.includes('-preview')) out.push(`${d}/${f}`);
  }
  return out;
}

/**
 * Read the ledger. A missing ledger is a fresh start only while no payout
 * report sits next to it or in `reportDirs`: otherwise it was lost, and an
 * empty one would pay every review again. A paying run passes `fresh: false`
 * and then refuses a missing ledger outright, unless the operator said this
 * is the first run (`fresh: true`: the memo scan still guards it). An
 * unreadable ledger is never replaced.
 */
export function loadLedger(path: string, reportDirs: string[] = [], opts: { fresh?: boolean } = {}): Ledger {
  if (!existsSync(path)) {
    if (opts.fresh === false) throw new Error(`${path} is missing. If this is the first paying run, pass --init-ledger; otherwise restore it from a backup: an empty ledger would pay every review again`);
    const reports = opts.fresh ? [] : reportsIn([dirname(path), ...reportDirs]);
    if (reports.length) throw new Error(`${path} is missing, but ${reports.length} payout reports exist (${reports[0]}): restore the ledger from a backup. Starting empty would pay every review again`);
    return emptyLedger();
  }
  let ledger: Ledger;
  try {
    ledger = JSON.parse(readFileSync(path, 'utf8')) as Ledger;
  } catch (e) {
    throw new Error(`${path} cannot be read (${(e as Error).message}): restore it from a backup. It is never replaced with an empty one`);
  }
  if (ledger?.version !== 1 || !ledger.sightings || !ledger.paid || !ledger.carry) throw new Error(`${path} is not a version 1 ledger`);
  return ledger;
}

/** Write JSON atomically: a temporary file, flushed to disk, then renamed over the old one. */
export function saveJson(path: string, v: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    const fd = openSync(tmp, 'w', 0o644);
    try {
      writeFileSync(fd, `${JSON.stringify(v, big, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (e) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw e;
  }
  try {
    const dir = openSync(dirname(path), 'r');
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  } catch {
    // Not every platform can fsync a directory; the rename is still atomic.
  }
}

/** Create `<base>.json`, or `<base>-2.json` and so on if taken, so no report is ever overwritten. */
export function createReportFile(base: string): string {
  mkdirSync(dirname(base), { recursive: true });
  for (let i = 1; ; i += 1) {
    const path = `${base}${i === 1 ? '' : `-${i}`}.json`;
    try {
      closeSync(openSync(path, 'wx'));
      return path;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
}

/** Add the sightings this run recorded to the ledger on disk, and change nothing else there. */
export function saveSightings(path: string, ledger: Ledger, reportDirs: string[] = []): number {
  const disk = loadLedger(path, reportDirs);
  let added = 0;
  for (const [k, s] of Object.entries(ledger.sightings)) {
    if (disk.sightings[k]) continue;
    disk.sightings[k] = s;
    added += 1;
  }
  if (added || !existsSync(path)) saveJson(path, disk);
  return added;
}

type LockInfo = { pid: number; host: string; startedAt: string };

function readLock(path: string): LockInfo | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as LockInfo;
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Take the ledger's lock for the rest of this process: `<ledger>.lock`,
 * created exclusively, holding this pid, host and start time. It is removed
 * when the process exits. While another run holds it this throws, and a lock
 * left by a run that died is only cleared by `force` (`--force-unlock`).
 */
export function lockLedger(ledgerPath: string, force = false): () => void {
  const path = `${ledgerPath}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  if (force && existsSync(path)) {
    const held = readLock(path);
    if (held && held.host === hostname() && alive(held.pid)) throw new Error(`${path} belongs to pid ${held.pid}, which is still running: stop it rather than force the lock`);
    unlinkSync(path);
  }
  let fd: number;
  try {
    fd = openSync(path, 'wx', 0o644);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    const held = readLock(path);
    if (!held) throw new Error(`${path} exists but cannot be read. If no other airdrop is running on this ledger, rerun with --force-unlock`);
    const who = `pid ${held.pid} on ${held.host}, started ${held.startedAt}`;
    if (held.host === hostname() && !alive(held.pid)) throw new Error(`${path} was left by ${who}, which is no longer running. Check that its last payout is in the ledger, then rerun with --force-unlock`);
    throw new Error(`another airdrop run holds ${path} (${who}). If it has stopped, rerun with --force-unlock`);
  }
  try {
    writeFileSync(fd, `${JSON.stringify({ pid: process.pid, host: hostname(), startedAt: new Date().toISOString() } satisfies LockInfo)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  let held = true;
  const release = () => {
    if (!held) return;
    held = false;
    try {
      unlinkSync(path);
    } catch {
      // already gone
    }
  };
  process.once('exit', release);
  return release;
}

/**
 * Every review, every wallet's failure counters, and the fee rate of each
 * order whose review is new (not in `sighted`), read from the chain now.
 */
export async function readChain(c: ScriptClient, sighted: Record<string, unknown> = {}): Promise<Chain> {
  const rpc = c.rpc as unknown as ProgramAccountsRpc;
  const [reviews, agents, config, now, genesisHash] = await Promise.all([
    fetchAllReviews(rpc),
    fetchAllAgents(rpc),
    fetchMaybeConfig(c.rpc, await configPda()),
    chainTime(c),
    c.rpc.getGenesisHash().send(),
  ]);
  if (!config.exists) throw new Error('no Tessera config on this cluster');
  const failuresNow: Record<string, Failures> = {};
  for (const a of agents) {
    const f = rewards.failuresOf(a.data);
    failuresNow[`${a.data.wallet}:merchant`] = f.merchant;
    failuresNow[`${a.data.wallet}:buyer`] = f.buyer;
  }
  // A new review's order still exists: it cannot close until its review window has passed.
  const orders = [...new Set(reviews.filter((r) => !(r.address in sighted)).map((r) => r.data.order))];
  const orderFeeBps: Record<string, number> = {};
  const disc = Array.from(ORDER_DISCRIMINATOR).join();
  for (let i = 0; i < orders.length; i += 100) {
    for (const acct of await fetchEncodedAccounts(c.rpc, orders.slice(i, i + 100))) {
      if (!acct.exists || acct.programAddress !== TESSERA_PROGRAM_ADDRESS || Array.from(acct.data.slice(0, 8)).join() !== disc) continue;
      try {
        orderFeeBps[acct.address] = decodeOrder(acct).data.feeBps;
      } catch {
        // An order this client cannot decode counts as unseen.
      }
    }
  }
  return {
    now: Number(now),
    feeBps: config.data.feeBps,
    mint: config.data.mint,
    treasury: config.data.treasury,
    genesisHash,
    reviews: reviews.map((r) => ({
      address: r.address,
      order: r.data.order,
      reviewer: r.data.reviewer,
      subject: r.data.subject,
      reviewerIsBuyer: r.data.reviewerIsBuyer,
      rating: r.data.rating,
      weight: r.data.weight,
      createdAt: Number(r.data.createdAt),
    })),
    failuresNow,
    orderFeeBps,
  };
}

/** Record when each new review was first seen, how its subject stood then, and its order's fee rate. Run this often. */
export function observe(ledger: Ledger, chain: Chain): number {
  let added = 0;
  for (const r of chain.reviews) {
    if (ledger.sightings[r.address]) continue;
    const s: Sighting = { firstSeenAt: chain.now, before: chain.failuresNow[rewards.subjectKey(r)] ?? { disputesLost: 0, missed: 0 } };
    const fee = r.order === undefined ? undefined : chain.orderFeeBps[r.order];
    if (fee !== undefined) s.orderFeeBps = fee;
    ledger.sightings[r.address] = s;
    added += 1;
  }
  return added;
}

export function paramsSetOf(p: RewardParams): ParamsSet {
  for (const [name, d] of Object.entries(DOCUMENTED_PARAMS) as [Exclude<ParamsSet, 'custom'>, RewardParams][]) {
    if (p.shareBps === d.shareBps && p.maturitySecs === d.maturitySecs && p.consensusWindowSecs === d.consensusWindowSecs && p.lateSightSecs === d.lateSightSecs && p.dustUnits === d.dustUnits) return name;
  }
  return 'custom';
}

const toRow = (r: RewardRow): Report['rows'][number] => ({ ...r, weight: r.weight.toString(), base: r.base.toString(), reward: r.reward.toString(), why: rewards.ACCURACY_TEXT[r.accuracy.label] });
const byKey = <T>([a]: [string, T], [b]: [string, T]) => (a < b ? -1 : 1);

/**
 * What each wallet is owed (its carry plus its rows) becomes transfers, or is
 * carried when it is under the dust threshold or the wallet is withheld.
 * Reads rows, carryIn and withheld; writes payouts, carried and totals.
 */
export function settle(report: Report, decimals = 6): void {
  const dust = BigInt(report.params.dustUnits);
  const owed = new Map<string, { amount: bigint; names: string[]; reward: Map<string, bigint> }>();
  const of = (w: string) => owed.get(w) ?? owed.set(w, { amount: 0n, names: [], reward: new Map() }).get(w)!;
  for (const [w, v] of Object.entries(report.carryIn)) {
    const e = of(w);
    e.amount += BigInt(v);
    e.names.push(...(report.carryInReviews[w] ?? []));
  }
  for (const r of report.rows) {
    const e = of(r.reviewer);
    e.amount += BigInt(r.reward);
    e.names.push(r.review);
    e.reward.set(r.review, BigInt(r.reward));
  }
  const payouts: Payout[] = [];
  const carried: Record<string, string> = {};
  const carriedReviews: Record<string, string[]> = {};
  for (const [wallet, e] of [...owed].sort(byKey)) {
    if (e.amount <= 0n) continue;
    if (e.amount < dust || wallet in report.withheld) {
      carried[wallet] = e.amount.toString();
      carriedReviews[wallet] = e.names;
      continue;
    }
    // The carry rides on the wallet's first transfer.
    for (let i = 0; i < Math.max(e.names.length, 1); i += REVIEWS_PER_TRANSFER) {
      const part = e.names.slice(i, i + REVIEWS_PER_TRANSFER);
      const amount = part.reduce((s, k) => s + (e.reward.get(k) ?? 0n), i === 0 ? BigInt(report.carryIn[wallet] ?? '0') : 0n);
      payouts.push({ wallet, amount: amount.toString(), usdc: fromUnits(amount, decimals), reviews: part });
    }
  }
  const paid = payouts.reduce((s, x) => s + BigInt(x.amount), 0n);
  report.payouts = payouts;
  report.carried = carried;
  report.carriedReviews = carriedReviews;
  report.totals = { reviews: report.rows.length, paid: paid.toString(), paidUsdc: fromUnits(paid, decimals) };
}

/** Score the reviews that have matured and add up what each wallet is owed, carry included. */
export function score(ledger: Ledger, chain: Chain, p: RewardParams, decimals = 6): Report {
  const input: EpochInput = { reviews: chain.reviews, sightings: ledger.sightings, failuresNow: chain.failuresNow, paid: ledger.paid, feeBps: chain.feeBps, now: chain.now };
  const { rows } = rewards.scoreEpoch(input, p);
  const epoch = new Date(chain.now * 1000).toISOString().replace(/\.\d+Z$/, 'Z');

  // Only what is needed to recompute these rows goes in the report.
  const due = new Set(rows.map((r) => r.review));
  const subjects = new Set(rows.map((r) => rewards.subjectKey(r)));
  const report: Report = {
    epoch,
    network: chain.genesisHash,
    paramsSet: paramsSetOf(p),
    params: { ...p, dustUnits: p.dustUnits.toString() },
    input: {
      reviews: chain.reviews,
      sightings: Object.fromEntries(Object.entries(ledger.sightings).filter(([k]) => due.has(k))),
      failuresNow: Object.fromEntries(Object.entries(chain.failuresNow).filter(([k]) => subjects.has(k))),
      paidBefore: Object.keys(ledger.paid),
      feeBps: chain.feeBps,
      now: chain.now,
    },
    carryIn: { ...ledger.carry },
    carryInReviews: Object.fromEntries(Object.keys(ledger.carry).map((w) => [w, ledger.carryReviews?.[w] ?? []])),
    rows: rows.map(toRow),
    payouts: [],
    withheld: {},
    carried: {},
    carriedReviews: {},
    totals: { reviews: 0, paid: '0', paidUsdc: '0' },
  };
  settle(report, decimals);
  return report;
}

/**
 * Hold back each payout whose wallet has no usable USDC token account
 * (missing, frozen, or not its own) and carry the amount instead. The payer
 * never creates token accounts: a recipient that closed its account after
 * every payout would take the rent each time, and one bad account would fail
 * its whole batch.
 */
export async function withhold(report: Report, c: ScriptClient, mint: Address, decimals = 6): Promise<void> {
  const tok = tokenHelpers(c, mint);
  const wallets = [...new Set(report.payouts.map((x) => x.wallet))];
  const atas = await Promise.all(wallets.map((w) => tok.ata(w as Address)));
  for (let i = 0; i < wallets.length; i += 100) {
    const accounts = await fetchAllMaybeToken(c.rpc, atas.slice(i, i + 100));
    accounts.forEach((a, j) => {
      const w = wallets[i + j]!;
      const why = !a.exists
        ? 'no USDC token account'
        : a.programAddress !== TOKEN_PROGRAM_ADDRESS || a.data.mint !== mint || a.data.owner !== w
          ? 'its USDC token account is no longer its own'
          : a.data.state !== AccountState.Initialized
            ? 'its USDC token account is frozen'
            : null;
      if (why) report.withheld[w] = why;
    });
  }
  settle(report, decimals);
}

/** The memo a payout transaction carries: its batch tag and every review it pays. */
export function memoIx(tag: string, reviews: string[]): Instruction {
  return { programAddress: MEMO_PROGRAM, data: new TextEncoder().encode(`${MEMO_TAG} ${tag} ${reviews.join(',')}`) };
}

/** The batch tags and reviews named by payout memos in some text (an RPC joins several memos with "; "). */
export function parseMemos(text: string | null | undefined): { tag: string; reviews: string[] }[] {
  const out: { tag: string; reviews: string[] }[] = [];
  for (const m of (text ?? '').matchAll(/tessera-rewards 1 (\S+) ([^\s;]*)/g)) out.push({ tag: m[1]!, reviews: m[2]!.split(',').filter(Boolean) });
  return out;
}

/**
 * What the chain says was already paid: the payout memos in successful
 * transactions paid for by one of `payers`, back to `since` (unix seconds).
 * Every payout transaction has its payer as fee payer, so the payers' own
 * signature lists hold them all; the fee transfers into the treasury's token
 * account do not name the treasury wallet, so they stay out of the scan. A
 * memo in anyone else's transaction is ignored: nobody else can mark a review
 * paid.
 */
export async function paidOnChain(c: ScriptClient, payers: Address[], since: number, maxPages = 50): Promise<{ reviews: Map<string, string>; tags: Map<string, string> }> {
  const candidates = new Set<Signature>();
  for (const owner of payers) {
    let before: Signature | undefined;
    for (let page = 0; ; page += 1) {
      if (page === maxPages) throw new Error(`over ${maxPages * 1000} transactions name ${owner} since ${new Date(since * 1000).toISOString()}: cannot rule out an earlier payout`);
      const sigs = await c.rpc.getSignaturesForAddress(owner, { limit: 1000, commitment: 'confirmed', ...(before ? { before } : {}) }).send();
      for (const s of sigs) if (!s.err && s.memo?.includes(MEMO_TAG)) candidates.add(s.signature);
      const last = sigs[sigs.length - 1];
      if (!last || sigs.length < 1000 || (last.blockTime !== null && Number(last.blockTime) < since)) break;
      before = last.signature;
    }
  }
  const reviews = new Map<string, string>();
  const tags = new Map<string, string>();
  for (const sig of candidates) {
    const tx = await c.rpc.getTransaction(sig, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }).send();
    if (!tx) throw new Error(`payout transaction ${sig} is listed but cannot be fetched: rerun in a minute`);
    if (tx.meta?.err) continue;
    const keys = tx.transaction.message.accountKeys;
    if (!payers.includes(keys[0]!)) continue;
    for (const ix of tx.transaction.message.instructions) {
      if (keys[ix.programIdIndex] !== MEMO_PROGRAM) continue;
      for (const m of parseMemos(new TextDecoder().decode(getBase58Encoder().encode(ix.data)))) {
        tags.set(m.tag, sig);
        for (const r of m.reviews) reviews.set(r, sig);
      }
    }
  }
  return { reviews, tags };
}

/** Write a landed batch into the ledger. */
function settlePending(ledger: Ledger, p: Pending, signature: string): void {
  for (const [k, m] of Object.entries(p.marks)) ledger.paid[k] = { ...m, signature };
  for (const k of p.reviews) if (ledger.paid[k] && !(k in p.marks)) ledger.paid[k]!.signature = signature;
  for (const w of p.carryOf) {
    delete ledger.carry[w];
    delete ledger.carryReviews?.[w];
  }
}

/**
 * Before paying, check the chain: mark paid every due review a payout memo
 * already names, drop a carry a memo shows was sent, and settle a batch left
 * pending by a run that stopped while sending. Throws while that batch could
 * still land.
 */
export async function reconcile(ledger: Ledger, chain: Chain, c: ScriptClient, p: RewardParams, payers: Address[]): Promise<{ recovered: number }> {
  const due = chain.reviews.filter((r) => r.weight > 0n && r.createdAt + p.maturitySecs <= chain.now && !(r.address in ledger.paid));
  const pending = ledger.pending;
  if (!due.length && !pending && !Object.keys(ledger.carry).length) return { recovered: 0 };
  // Nothing can have been paid before it matured, or before the pending batch was sent. An hour of slack.
  const since = due.reduce((t, r) => Math.min(t, r.createdAt + p.maturitySecs), pending ? Math.min(chain.now, Math.floor(pending.sentAt / 1000)) : chain.now) - 3600;
  const onChain = await paidOnChain(c, [...new Set([...payers, ...(pending ? [pending.payer as Address] : [])])], since);

  if (pending) {
    const sig = onChain.tags.get(pending.tag);
    // Dropped only once its blockhash has surely expired, by our clock and by the RPC's view of the chain's
    // clock, so an RPC that is behind cannot hide a batch that landed.
    const until = pending.sentAt + PENDING_EXPIRY_MS;
    if (sig) settlePending(ledger, pending, sig);
    else if (Date.now() < until || chain.now * 1000 < until - 60_000)
      throw new Error(`payout batch ${pending.tag}, sent at ${new Date(pending.sentAt).toISOString()}, is not on chain yet and could still land until about ${new Date(until).toISOString()}: rerun after that`);
    delete ledger.pending;
  }
  let recovered = 0;
  for (const r of due) {
    const signature = onChain.reviews.get(r.address);
    if (!signature || r.address in ledger.paid) continue;
    ledger.paid[r.address] = { epoch: 'unknown', reward: 'unknown', label: 'paid_on_chain', signature };
    recovered += 1;
  }
  for (const [w, names] of Object.entries(ledger.carryReviews ?? {})) {
    if (!names.some((k) => onChain.reviews.has(k))) continue;
    delete ledger.carry[w];
    delete ledger.carryReviews![w];
    recovered += 1;
  }
  return { recovered };
}

const mark = (report: Report, r: Report['rows'][number]): Mark => ({ epoch: report.epoch, reward: r.reward, label: r.accuracy.label });

/** Group payouts into transactions: at most `perTx` transfers, and always within the size limit with the memo. */
async function batches(report: Report, payer: ScriptClient, mint: Address, perTx: number, tagOf: (n: number) => string): Promise<{ batch: Payout[]; ixs: Instruction[] }[]> {
  const tok = tokenHelpers(payer, mint);
  const transfer = new Map<Payout, Instruction>();
  for (const x of report.payouts) transfer.set(x, await tok.transferIx(payer, await tok.ata(x.wallet as Address), BigInt(x.amount)));
  const ixsOf = (batch: Payout[], n: number) => [...batch.map((x) => transfer.get(x)!), memoIx(tagOf(n), batch.flatMap((x) => x.reviews))];
  const size = (ixs: Instruction[]) =>
    getTransactionMessageSize(
      pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayerSigner(payer.identity, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: '11111111111111111111111111111111' as Blockhash, lastValidBlockHeight: 0n }, m),
        (m) => appendTransactionMessageInstructions([getSetComputeUnitLimitInstruction({ units: 400_000 }), ...ixs], m),
      ),
    );
  const out: { batch: Payout[]; ixs: Instruction[] }[] = [];
  let cur: Payout[] = [];
  for (const x of report.payouts) {
    if (cur.length && (cur.length >= perTx || size(ixsOf([...cur, x], out.length + 1)) > TX_LIMIT)) {
      out.push({ batch: cur, ixs: ixsOf(cur, out.length + 1) });
      cur = [];
    }
    cur.push(x);
    if (size(ixsOf(cur, out.length + 1)) > TX_LIMIT) throw new Error(`the transfer to ${x.wallet} does not fit in a transaction`);
  }
  if (cur.length) out.push({ batch: cur, ixs: ixsOf(cur, out.length + 1) });
  return out;
}

/**
 * Send each payout from the payer's token account, a few per transaction,
 * each with a memo naming the reviews it pays. Wallets without a usable token
 * account are carried first (`withhold`). Each batch goes into the ledger as
 * pending before it is sent and as paid once it confirms, and `save` is called
 * after each step, so a failure part-way never pays a confirmed batch again.
 * Then the rest of the report is recorded.
 */
export async function pay(report: Report, ledger: Ledger, payer: ScriptClient, mint: Address, opts: { save?: () => void; perTx?: number } = {}): Promise<void> {
  const save = opts.save ?? (() => undefined);
  await withhold(report, payer, mint);
  const tok = tokenHelpers(payer, mint);
  const need = report.payouts.reduce((s, x) => s + BigInt(x.amount), 0n);
  const have = await tok.balance(payer.identity.address);
  if (have < need) throw new Error(`${payer.identity.address} holds ${fromUnits(have, 6)} USDC, this payout needs ${fromUnits(need, 6)}`);
  save();

  const rowOf = new Map(report.rows.map((r) => [r.review, r]));
  const first = new Set(report.payouts.filter((x, i) => report.payouts.findIndex((y) => y.wallet === x.wallet) === i));
  // A tag no other send shares, so a pending batch is only ever matched to its own transaction.
  const run = randomBytes(4).toString('hex');
  const tagOf = (n: number) => `${report.epoch}/${run}.${n}`;
  for (const [n, { batch, ixs }] of (await batches(report, payer, mint, opts.perTx ?? 4, tagOf)).entries()) {
    const reviews = batch.flatMap((x) => x.reviews);
    const pending: Pending = {
      sentAt: Date.now(),
      payer: payer.identity.address,
      tag: tagOf(n + 1),
      reviews,
      marks: Object.fromEntries(reviews.filter((k) => rowOf.has(k)).map((k) => [k, mark(report, rowOf.get(k)!)])),
      carryOf: batch.filter((x) => first.has(x) && x.wallet in report.carryIn).map((x) => x.wallet),
    };
    ledger.pending = pending;
    save();
    const sig = sigOf(await payer.sendTransaction(ixs));
    for (const x of batch) x.signature = sig;
    settlePending(ledger, pending, sig);
    delete ledger.pending;
    save();
  }
  record(report, ledger);
  save();
}

/** Mark the report's reviews scored and replace the carry. Also what a dry run would have done. */
export function record(report: Report, ledger: Ledger): void {
  const sent = new Map(report.payouts.flatMap((x) => (x.signature ? x.reviews.map((k) => [k, x.signature!] as const) : [])));
  for (const r of report.rows) {
    const signature = sent.get(r.review);
    ledger.paid[r.review] = { ...mark(report, r), ...(signature ? { signature } : {}) };
  }
  ledger.carry = { ...report.carried };
  ledger.carryReviews = structuredClone(report.carriedReviews);
}

const dups = (xs: string[]) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];

/**
 * Recompute a published report from its own inputs and check everything in
 * it: every row, the params, the fee bound, and every payout and carry
 * against what each wallet was owed. Returns every mismatch.
 */
export function verify(report: Report): string[] {
  const bad: string[] = [];
  const keys = ['consensusWindowSecs', 'dustUnits', 'lateSightSecs', 'maturitySecs', 'shareBps'] as const;
  const p: RewardParams = { ...report.params, dustUnits: BigInt(report.params.dustUnits) };
  const carryIn = report.carryIn ?? {};
  const withheld = report.withheld ?? {};
  for (const [k, v] of [['carryIn', report.carryIn], ['carryInReviews', report.carryInReviews], ['withheld', report.withheld], ['carried', report.carried], ['carriedReviews', report.carriedReviews]] as const) {
    if (!v || typeof v !== 'object') bad.push(`the report has no ${k}`);
  }

  // The params: the documented set for the network, or flagged as custom, and never above the fee bound.
  if (Object.keys(report.params).sort().join() !== keys.join()) bad.push(`params has fields ${Object.keys(report.params).sort().join(', ')}, expected ${keys.join(', ')}`);
  if (report.paramsSet === 'devnet' || report.paramsSet === 'mainnet') {
    const d = DOCUMENTED_PARAMS[report.paramsSet];
    for (const k of keys) if (String(p[k]) !== String(d[k])) bad.push(`params.${k} is ${p[k]}, the documented ${report.paramsSet} value is ${d[k]}`);
  } else if (report.paramsSet !== 'custom') bad.push(`paramsSet is ${JSON.stringify(report.paramsSet)}: it must be devnet, mainnet, or custom for any other params`);
  if (report.network === MAINNET_GENESIS && report.paramsSet !== 'mainnet') bad.push(`this payout is on mainnet but its params are ${report.paramsSet}, not mainnet`);
  if (!Number.isInteger(p.shareBps) || p.shareBps < 0 || p.shareBps > rewards.MAX_SHARE_BPS) bad.push(`params.shareBps is ${p.shareBps}: above ${rewards.MAX_SHARE_BPS} a review can earn more than 37.5% of its order's fee`);

  // The rows, recomputed.
  for (const d of dups(report.input.reviews.map((r) => r.address))) bad.push(`input review ${d} is listed more than once`);
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
  const want = new Map(rows.map((r) => [r.review, toRow(r)]));
  const listed = new Set<string>();
  for (const r of report.rows) {
    if (listed.has(r.review)) {
      bad.push(`row ${r.review} is listed more than once`);
      continue;
    }
    listed.add(r.review);
    const g = want.get(r.review);
    if (!g) {
      bad.push(`row ${r.review} is not due by the report's own inputs`);
      continue;
    }
    const fields = (x: Report['rows'][number]) => ({ reviewer: x.reviewer, subject: x.subject, reviewerIsBuyer: x.reviewerIsBuyer, rating: x.rating, weight: x.weight, feeBps: x.feeBps, orderFeeSeen: x.orderFeeSeen, base: x.base, reward: x.reward, label: x.accuracy?.label, bps: x.accuracy?.bps });
    const [have, should] = [fields(r), fields(g)];
    for (const k of Object.keys(should) as (keyof typeof should)[]) if (String(have[k]) !== String(should[k])) bad.push(`row ${r.review}: ${k} is ${have[k]}, recomputed ${should[k]}`);
  }
  for (const r of rows) if (!listed.has(r.review)) bad.push(`review ${r.review} is due by the report's own inputs but has no row`);

  // The fee bound: no review above 1.5x a quarter of what its order paid.
  const cap = (r: Report['rows'][number]) => rewards.maxReward(BigInt(r.weight), rewards.rewardFeeBps(report.input.sightings[r.review], report.input.feeBps).feeBps, { ...p, shareBps: Math.min(p.shareBps, rewards.MAX_SHARE_BPS) });
  for (const r of report.rows) if (BigInt(r.reward) > cap(r)) bad.push(`row ${r.review} pays ${r.reward}, above its order's bound ${cap(r)}`);

  // Every wallet: paid + carried out = carried in + its rows, as recomputed.
  const owed = new Map<string, bigint>();
  const add = (m: Map<string, bigint>, w: string, v: bigint) => m.set(w, (m.get(w) ?? 0n) + v);
  for (const [w, v] of Object.entries(carryIn)) add(owed, w, BigInt(v));
  for (const r of rows) add(owed, r.reviewer, r.reward);
  const sent = new Map<string, bigint>();
  for (const x of report.payouts) add(sent, x.wallet, BigInt(x.amount));
  const out = new Map(Object.entries(report.carried ?? {}).map(([w, v]) => [w, BigInt(v)] as const));
  for (const w of new Set([...owed.keys(), ...sent.keys(), ...out.keys()])) {
    const [o, s, c] = [owed.get(w) ?? 0n, sent.get(w) ?? 0n, out.get(w) ?? 0n];
    if (s + c !== o) bad.push(`${w} is owed ${o} (carried in ${carryIn[w] ?? 0}, plus its rows) but was paid ${s} and carried ${c}`);
    if (s > 0n && o < p.dustUnits) bad.push(`${w} was paid ${s} although it is owed ${o}, under the dust threshold`);
    if (s > 0n && w in withheld) bad.push(`${w} was paid ${s} although it is withheld`);
    if (c > 0n && o >= p.dustUnits && !(w in withheld)) bad.push(`${w} is owed ${o} but ${c} was carried instead of paid`);
  }
  for (const w of Object.keys(withheld)) if (!owed.get(w)) bad.push(`${w} is withheld but owed nothing`);

  // Every transfer: the split and the memo's reviews, as planned from the recomputed rows.
  for (const d of dups(report.payouts.flatMap((x) => x.reviews))) bad.push(`review ${d} is in more than one payout`);
  const rowOf = new Map(report.rows.map((r) => [r.review, r]));
  const plan: Report = { ...report, carryIn, carryInReviews: report.carryInReviews ?? {}, withheld, rows: rows.map(toRow) };
  settle(plan);
  if (plan.payouts.length !== report.payouts.length) bad.push(`${report.payouts.length} payouts, recomputed ${plan.payouts.length}`);
  report.payouts.forEach((x, i) => {
    const y = plan.payouts[i];
    if (!y) return;
    if (x.wallet !== y.wallet || x.amount !== y.amount || x.usdc !== y.usdc || x.reviews.join() !== y.reviews.join())
      bad.push(`payout ${i} is ${x.amount} to ${x.wallet} for [${x.reviews.join(', ')}], recomputed ${y.amount} to ${y.wallet} for [${y.reviews.join(', ')}]`);
    const firstOfWallet = report.payouts.findIndex((z) => z.wallet === x.wallet) === i;
    const bound = x.reviews.reduce((s, k) => {
      const r = rowOf.get(k);
      return s + (r && r.reviewer === x.wallet ? cap(r) : 0n);
    }, firstOfWallet ? BigInt(carryIn[x.wallet] ?? '0') : 0n);
    if (BigInt(x.amount) > bound) bad.push(`payout ${i} sends ${x.amount} to ${x.wallet}, above the bound of its reviews' orders plus its carry, ${bound}`);
  });
  for (const w of new Set([...Object.keys(report.carriedReviews ?? {}), ...Object.keys(plan.carriedReviews)])) {
    if ((report.carriedReviews?.[w] ?? []).join() !== (plan.carriedReviews[w] ?? []).join()) bad.push(`carriedReviews of ${w} are [${(report.carriedReviews?.[w] ?? []).join(', ')}], recomputed [${(plan.carriedReviews[w] ?? []).join(', ')}]`);
  }

  if (report.totals.reviews !== report.rows.length) bad.push(`totals.reviews is ${report.totals.reviews}, there are ${report.rows.length} rows`);
  const paid = report.payouts.reduce((s, x) => s + BigInt(x.amount), 0n);
  if (report.totals.paid !== paid.toString() || report.totals.paidUsdc !== fromUnits(paid, 6)) bad.push(`totals say ${report.totals.paid} (${report.totals.paidUsdc} USDC) paid, the payouts add up to ${paid}`);
  return bad;
}
