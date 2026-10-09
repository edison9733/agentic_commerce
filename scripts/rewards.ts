/**
 * The review-reward airdrop (docs/REWARDS.md).
 *
 *   npm run rewards                         preview: record new reviews, score the matured ones, pay nothing
 *   npm run rewards -- --pay                also pay from the treasury (.keys/treasury.json)
 *   npm run rewards -- --watch 60 --pay     record every 60 s, pay every --epoch seconds (default 3600)
 *   npm run rewards -- --verify <report>    recompute a published payout from its own inputs
 *
 * Options: --params devnet|mainnet (default devnet), --ledger <file>
 * (default deployments/rewards/ledger.json), --out <dir> (default
 * deployments/rewards), --treasury <keypair file>. The cluster is
 * SOLANA_RPC_URL, devnet by default.
 *
 * Record often: a review is judged on what its subject did after the moment it
 * was first recorded, and one first seen too late is judged on consensus only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { rewards } from '@tessera/sdk';
import { clientForSigner, DEVNET, generateKeypairBytes, loadKeypair, log, REPO_ROOT, sleep } from './lib.js';
import { loadLedger, observe, pay, readChain, record, saveJson, score, verify, type Report } from './rewards-lib.js';

const { values: flags } = parseArgs({
  options: {
    pay: { type: 'boolean' },
    verify: { type: 'string' },
    watch: { type: 'string' },
    epoch: { type: 'string' },
    params: { type: 'string' },
    ledger: { type: 'string' },
    out: { type: 'string' },
    treasury: { type: 'string' },
  },
});

if (flags.verify) {
  const report = JSON.parse(readFileSync(resolve(flags.verify), 'utf8')) as Report;
  const bad = verify(report);
  if (bad.length) {
    log.fail(`${bad.length} rows do not match: ${bad.slice(0, 5).join(', ')}`);
    process.exit(1);
  }
  log.ok(`${report.rows.length} reviews recomputed from the report's own inputs: every reward and label matches (${report.totals.paidUsdc} USDC paid)`);
  process.exit(0);
}

const p = flags.params === 'mainnet' ? rewards.MAINNET_REWARD_PARAMS : rewards.DEVNET_REWARD_PARAMS;
const ledgerPath = resolve(REPO_ROOT, flags.ledger ?? 'deployments/rewards/ledger.json');
const outDir = resolve(REPO_ROOT, flags.out ?? 'deployments/rewards');
const signer = flags.pay ? await loadKeypair(flags.treasury ?? resolve(REPO_ROOT, '.keys/treasury.json')) : (await generateKeypairBytes()).signer;
const client = clientForSigner(signer, DEVNET);

async function once(payNow: boolean): Promise<void> {
  const ledger = loadLedger(ledgerPath);
  const chain = await readChain(client);
  const seen = observe(ledger, chain);
  if (seen) log.info(`recorded ${seen} new reviews`);
  if (!payNow) return saveJson(ledgerPath, ledger);

  const report = score(ledger, chain, p);
  if (flags.pay && signer.address !== chain.treasury) throw new Error(`${signer.address} is not the treasury (${chain.treasury})`);
  if (flags.pay && report.payouts.length) await pay(report, ledger, client, chain.mint);
  else if (flags.pay) record(report, ledger);
  const file = `${outDir}/epoch-${report.epoch.replace(/[:]/g, '')}${flags.pay ? '' : '-preview'}.json`;
  saveJson(file, report);
  saveJson(ledgerPath, ledger);
  log.ok(`${report.totals.reviews} reviews scored, ${report.payouts.length} wallets, ${report.totals.paidUsdc} USDC ${flags.pay ? 'paid' : 'owed (preview)'} → ${file}`);
  for (const r of report.rows) log.info(`${r.reviewer.slice(0, 4)}… ★${r.rating} → ${r.reward} units  ${r.why}`);
}

if (!flags.watch) {
  await once(true);
  process.exit(0);
}
const every = Number(flags.watch) * 1000;
const epochMs = Number(flags.epoch ?? 3600) * 1000;
let last = 0;
for (;;) {
  const due = Date.now() - last >= epochMs;
  try {
    await once(due);
    if (due) last = Date.now();
  } catch (e) {
    log.warn((e as Error).message);
  }
  await sleep(every);
}
