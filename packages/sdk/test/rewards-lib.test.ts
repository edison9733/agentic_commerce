/**
 * The airdrop's bookkeeping (scripts/rewards-lib.ts) without a validator:
 * the ledger, the lock, the memo, the split of what is owed, and --verify.
 * Paying itself is exercised end to end by `npm run demo:rewards`.
 *
 *   npm run test:formula
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Address } from '@solana/kit';
import { DEVNET_REWARD_PARAMS, maxReward, type RewardParams, type RewardReview } from '../src/rewards.js';
import {
  type Chain,
  createReportFile,
  loadLedger,
  lockLedger,
  memoIx,
  observe,
  parseMemos,
  record,
  saveJson,
  saveSightings,
  score,
  settle,
  verify,
  emptyLedger,
  type Report,
} from '../../../scripts/rewards-lib.js';

const USDC = 1_000_000n;
const P: RewardParams = { ...DEVNET_REWARD_PARAMS, dustUnits: 1_000n };
const NOW = 1_000_000;
let n = 0;
const review = (o: Partial<RewardReview> = {}): RewardReview => ({
  address: `rev${(n += 1)}`,
  order: `ord${n}`,
  reviewer: `buyer${n}`,
  subject: 'merchant',
  reviewerIsBuyer: true,
  rating: 5,
  weight: 10n * USDC,
  createdAt: NOW - 10_000,
  ...o,
});
const chainOf = (reviews: RewardReview[], o: Partial<Chain> = {}): Chain => ({
  now: NOW,
  feeBps: 100,
  mint: 'mint' as Address,
  treasury: 'treasury' as Address,
  genesisHash: 'genesis',
  reviews,
  failuresNow: {},
  orderFeeBps: {},
  ...o,
});
const tmp = () => mkdtempSync(join(tmpdir(), 'tessera-rewards-test-'));
/** What a published report looks like once it has been through a file. */
const published = (r: Report): Report => JSON.parse(JSON.stringify(r, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));

/** A scored report with two reviewers and one carried-in balance, as pay() would start from. */
function sample(): Report {
  const [a, b, c] = [review({ reviewer: 'alice', rating: 5 }), review({ reviewer: 'bob', rating: 4, weight: 4n * USDC }), review({ reviewer: 'carol', rating: 5, weight: 1_000n })];
  const ledger = emptyLedger();
  ledger.carry = { carol: '400' };
  ledger.carryReviews = { carol: ['oldrev'] };
  const chain = chainOf([a, b, c], { orderFeeBps: { [a.order!]: 100, [b.order!]: 100, [c.order!]: 100 } });
  observe(ledger, chain);
  return published(score(ledger, chain, P));
}

test('the reward uses the fee the order paid when the review was first seen', () => {
  const r = review({ createdAt: NOW - 5_000 });
  const ledger = emptyLedger();
  // The order paid 0.5%; by the time the review is scored the config says 5%.
  observe(ledger, chainOf([r], { orderFeeBps: { [r.order!]: 50 } }));
  assert.equal(ledger.sightings[r.address]!.orderFeeBps, 50);
  const report = score(ledger, chainOf([r], { feeBps: 500 }), P);
  const row = report.rows[0]!;
  assert.equal(row.feeBps, 50);
  assert.equal(row.orderFeeSeen, true);
  const feePaid = (r.weight * 50n) / 10_000n;
  assert.ok(BigInt(row.reward) <= (feePaid * 375n) / 1000n, 'one side gets back at most 37.5% of the fee the order paid');
  assert.deepEqual(verify(published(report)), []);
});

test('verify accepts what score produced, and a carried-over wallet', () => {
  const report = sample();
  assert.equal(report.rows.length, 3);
  // carol earned 10 units + 400 carried = 410 < dust: carried, not paid.
  assert.ok(report.carried.carol, 'carol is under the dust threshold');
  assert.ok(report.payouts.every((x) => x.wallet !== 'carol'));
  assert.deepEqual(verify(report), []);
});

test('a recipient without a token account is carried, and the report still verifies', () => {
  const report = sample();
  const alice = report.payouts.find((x) => x.wallet === 'alice')!;
  report.withheld.alice = 'no USDC token account';
  // Before settle(), the report would still pay alice, and verify must say so.
  assert.ok(verify(report).some((m) => m.includes('alice') && m.includes('withheld')));
  settle(report);
  assert.ok(!report.payouts.some((x) => x.wallet === 'alice'));
  assert.equal(report.carried.alice, alice.amount);
  assert.deepEqual(report.carriedReviews.alice, alice.reviews);
  assert.deepEqual(verify(published(report)), []);
});

test('verify fails loudly on every kind of tampering', () => {
  const tamper = (f: (r: Report) => void): string[] => {
    const r = sample();
    f(r);
    return verify(r);
  };
  assert.ok(tamper((r) => (r.payouts[0]!.amount = (BigInt(r.payouts[0]!.amount) + 1n).toString())).length, 'a larger payout');
  assert.ok(tamper((r) => r.payouts.pop()).length, 'a payout dropped');
  assert.ok(tamper((r) => r.rows.push({ ...r.rows[0]! })).length, 'a row listed twice');
  assert.ok(tamper((r) => r.rows.pop()).length, 'a due review without a row');
  assert.ok(tamper((r) => (r.rows[0]!.reward = '999999999')).length, 'an inflated reward');
  assert.ok(tamper((r) => (r.input.reviews.push({ ...r.input.reviews[0]! }) as unknown)).length, 'a duplicate input review');
  assert.ok(tamper((r) => (r.params.shareBps = 9000)).length, 'a larger share');
  assert.ok(tamper((r) => (r.paramsSet = 'mainnet')).length, 'params that are not the set they claim');
  assert.ok(tamper((r) => (r.carryIn.carol = '1000000')).length, 'a larger carry-in');
  assert.ok(tamper((r) => (r.carried.carol = '1')).length, 'a changed carry-out');
  assert.ok(tamper((r) => (r.totals.paid = '1')).length, 'wrong totals');
  assert.ok(tamper((r) => (r.input.feeBps = 10)).length, 'a lower fee rate than the rows used');
  assert.ok(tamper((r) => (r.payouts[0]!.reviews = [])).length, 'a payout that names no reviews');
});

test('no row can exceed 1.5x a quarter of the fee its order paid', () => {
  const report = sample();
  for (const row of report.rows) assert.ok(BigInt(row.reward) <= maxReward(BigInt(row.weight), row.feeBps, P));
  // Paying a row above the bound is refused even if the rest is rewritten to agree.
  const r = sample();
  r.params.shareBps = 4000;
  assert.ok(verify(r).some((m) => m.includes('shareBps')));
});

test('a missing ledger is only a fresh start when nothing was paid before', () => {
  const dir = tmp();
  try {
    const path = join(dir, 'ledger.json');
    assert.deepEqual(loadLedger(path), emptyLedger());
    assert.throws(() => loadLedger(path, [], { fresh: false }), /--init-ledger/);
    assert.deepEqual(loadLedger(path, [], { fresh: true }), emptyLedger());
    writeFileSync(join(dir, 'epoch-2026-01-01T00-00-00Z.json'), '{}');
    assert.throws(() => loadLedger(path), /restore the ledger/);
    assert.deepEqual(loadLedger(path, [], { fresh: true }), emptyLedger(), 'the operator says it is the first run: the memo scan guards it');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a corrupt or truncated ledger is never replaced by an empty one', () => {
  const dir = tmp();
  try {
    const path = join(dir, 'ledger.json');
    saveJson(path, emptyLedger());
    assert.deepEqual(loadLedger(path), emptyLedger());
    const text = readFileSync(path, 'utf8');
    writeFileSync(path, text.slice(0, text.length - 5));
    assert.throws(() => loadLedger(path), /cannot be read/);
    writeFileSync(path, '{"version":2}');
    assert.throws(() => loadLedger(path), /not a version 1 ledger/);
    assert.equal(readFileSync(path, 'utf8'), '{"version":2}');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes are atomic: no temporary file is left, and a preview adds sightings only', () => {
  const dir = tmp();
  try {
    const path = join(dir, 'ledger.json');
    const disk = emptyLedger();
    disk.paid.old = { epoch: 'e', reward: '5', label: 'fair', signature: 'sig' };
    disk.carry.w = '7';
    saveJson(path, disk);
    assert.deepEqual(readdirSync(dir), ['ledger.json']);
    // A preview that loaded the ledger long ago holds a stale view of what was paid.
    const stale = emptyLedger();
    stale.sightings.fresh = { firstSeenAt: 5, before: { disputesLost: 0, missed: 0 } };
    assert.equal(saveSightings(path, stale), 1);
    const after = loadLedger(path);
    assert.deepEqual(after.paid, disk.paid);
    assert.deepEqual(after.carry, disk.carry);
    assert.ok(after.sightings.fresh);
    assert.deepEqual(readdirSync(dir), ['ledger.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a report file is never overwritten', () => {
  const dir = tmp();
  try {
    const a = createReportFile(join(dir, 'epoch-x'));
    const b = createReportFile(join(dir, 'epoch-x'));
    assert.notEqual(a, b);
    assert.ok(existsSync(a) && existsSync(b));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two runs cannot hold the ledger at once, and a dead run needs --force-unlock', () => {
  const dir = tmp();
  try {
    const path = join(dir, 'ledger.json');
    const release = lockLedger(path);
    assert.throws(() => lockLedger(path), /another airdrop run holds/);
    release();
    assert.ok(!existsSync(`${path}.lock`));
    const again = lockLedger(path);
    again();
    // A lock left by a pid that no longer exists is reported, not silently reused.
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${path}.lock`, JSON.stringify({ pid: 2 ** 22 + 12345, host: hostname(), startedAt: 'then' }));
    assert.throws(() => lockLedger(path), /--force-unlock/);
    const forced = lockLedger(path, true);
    forced();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the memo names its reviews and reads back', () => {
  const ix = memoIx('2026-01-01T00:00:00Z/ab12cd34.1', ['a', 'b', 'c']);
  const text = new TextDecoder().decode(ix.data!);
  assert.deepEqual(parseMemos(`[${text.length}] ${text}`), [{ tag: '2026-01-01T00:00:00Z/ab12cd34.1', reviews: ['a', 'b', 'c'] }]);
  assert.deepEqual(parseMemos(`${text}; ${text}`).length, 2);
  assert.deepEqual(parseMemos('some other memo'), []);
  assert.deepEqual(parseMemos(null), []);
});

test('record marks every row scored and replaces the carry', () => {
  const report = sample();
  const ledger = emptyLedger();
  ledger.carry = { carol: '400' };
  record(report, ledger);
  assert.deepEqual(Object.keys(ledger.paid).sort(), report.rows.map((r) => r.review).sort());
  assert.deepEqual(ledger.carry, report.carried);
});
