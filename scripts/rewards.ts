/**
 * The review-reward airdrop (docs/REWARDS.md).
 *
 *   npm run rewards                         preview: record new reviews, score the matured ones, pay nothing
 *   npm run rewards -- --pay                also pay, from .keys/treasury.json or --payer
 *   npm run rewards -- --watch 60 --pay     record every 60 s, pay every --epoch seconds (default 3600)
 *   npm run rewards -- --verify <report>    recompute a published payout from its own inputs
 *
 * Options: --params devnet|mainnet (default devnet), --ledger <file>
 * (default deployments/rewards/ledger.json), --out <dir> (default
 * deployments/rewards), --payer <keypair file> (default .keys/treasury.json,
 * also --treasury; a separate rewards wallet is better), --force-unlock (clear a lock left by
 * a run that died), --init-ledger (the first paying run, when no ledger exists
 * yet), --allow-treasury-payer (let --watch --pay hold the fee treasury's key),
 * --allow-fallback-rpc (also read from SOLANA_RPC_FALLBACKS). The cluster is SOLANA_RPC_URL, devnet by default.
 *
 * Record often: a review is judged on what its subject did after the moment it
 * was first recorded, and one first seen too late is judged on consensus only.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { clientForSigner, DEVNET, generateKeypairBytes, loadKeypair, log, REPO_ROOT, sleep, type Cluster } from './lib.js';
import {
  createReportFile,
  DOCUMENTED_PARAMS,
  loadLedger,
  lockLedger,
  MAINNET_GENESIS,
  observe,
  pay,
  readChain,
  reconcile,
  record,
  saveJson,
  saveSightings,
  score,
  verify,
  withhold,
  type Report,
} from './rewards-lib.js';

const fail = (m: string): never => {
  log.fail(m);
  process.exit(1);
};

const options = {
  pay: { type: 'boolean' },
  verify: { type: 'string' },
  watch: { type: 'string' },
  epoch: { type: 'string' },
  params: { type: 'string' },
  ledger: { type: 'string' },
  out: { type: 'string' },
  payer: { type: 'string' },
  treasury: { type: 'string' },
  'force-unlock': { type: 'boolean' },
  'init-ledger': { type: 'boolean' },
  'allow-treasury-payer': { type: 'boolean' },
  'allow-fallback-rpc': { type: 'boolean' },
} as const;
let parsed: ReturnType<typeof parseArgs<{ options: typeof options }>>;
try {
  parsed = parseArgs({ options });
} catch (e) {
  fail((e as Error).message.split('\n')[0]!);
}
const flags = parsed!.values;

if (flags.verify) {
  let report: Report | undefined;
  let bad: string[] = [];
  try {
    report = JSON.parse(readFileSync(resolve(flags.verify), 'utf8')) as Report;
    bad = verify(report);
  } catch (e) {
    fail(`${flags.verify} is not a payout report this version can check (${(e as Error).message})`);
  }
  const r = report!;
  if (r.paramsSet === 'custom') log.warn(`not the documented devnet or mainnet params (flagged custom): ${JSON.stringify(r.params)}`);
  if (bad.length) {
    log.fail(`${bad.length} mismatches with the report's own inputs:`);
    for (const b of bad) log.info(b);
    process.exit(1);
  }
  log.ok(`${r.rows.length} reviews recomputed from the report's own inputs: every row, payout, carry and total matches (${r.totals.paidUsdc} USDC paid)`);
  process.exit(0);
}

/** A whole number of seconds above zero (and within what a timer can wait), or exit. */
function seconds(flag: string, v: string): number {
  const n = Number(v);
  if (!/^\d+$/.test(v) || !Number.isSafeInteger(n) || n < 1 || n > 2_147_483) fail(`${flag} takes a whole number of seconds from 1 to 2147483, not ${JSON.stringify(v)}`);
  return n;
}
const every = flags.watch === undefined ? undefined : seconds('--watch', flags.watch);
const epochSecs = seconds('--epoch', flags.epoch ?? '3600');
const paramsName = flags.params ?? 'devnet';
if (paramsName !== 'devnet' && paramsName !== 'mainnet') fail(`--params takes devnet or mainnet, not ${JSON.stringify(paramsName)}`);
const p = DOCUMENTED_PARAMS[paramsName as 'devnet' | 'mainnet'];
if (paramsName === 'mainnet' && !process.env.SOLANA_RPC_URL) fail('--params mainnet needs SOLANA_RPC_URL: the default endpoint is devnet');

const ledgerPath = resolve(REPO_ROOT, flags.ledger ?? 'deployments/rewards/ledger.json');
const outDir = resolve(REPO_ROOT, flags.out ?? 'deployments/rewards');

// What gets paid is decided by what the RPC says, so read only from the configured endpoint.
const cluster: Cluster = flags['allow-fallback-rpc'] ? DEVNET : { ...DEVNET, fallbackUrls: [] };
if (!flags['allow-fallback-rpc'] && DEVNET.fallbackUrls?.length) log.info(`reading only from ${DEVNET.rpcUrl}; --allow-fallback-rpc would also use ${DEVNET.fallbackUrls.join(', ')}`);

const payerFile = resolve(REPO_ROOT, flags.payer ?? flags.treasury ?? '.keys/treasury.json');
if (flags.pay && existsSync(payerFile) && statSync(payerFile).mode & 0o077) log.warn(`${payerFile} can be read by other users: chmod 600 it`);
const signer = flags.pay ? await loadKeypair(payerFile).catch((e: Error) => fail(e.message)) : (await generateKeypairBytes()).signer;
const client = clientForSigner(signer, cluster);

const genesis = await client.rpc.getGenesisHash().send();
if (genesis === MAINNET_GENESIS && paramsName !== 'mainnet') fail('this is mainnet: pass --params mainnet');

// One run at a time per ledger. A preview that finds it taken still runs, but records nothing.
let locked = false;
try {
  lockLedger(ledgerPath, flags['force-unlock']);
  locked = true;
} catch (e) {
  if (flags.pay) fail((e as Error).message);
  log.warn(`${(e as Error).message}. Previewing without recording sightings`);
}
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

/** A failure while paying. The watch loop stops on it rather than try again. */
class PayFailed extends Error {}

function summary(report: Report, file: string, what: string): void {
  const wallets = new Set(report.payouts.map((x) => x.wallet)).size;
  log.ok(`${report.totals.reviews} reviews scored, ${wallets} wallets, ${report.totals.paidUsdc} USDC ${what} → ${file}`);
  for (const r of report.rows) log.info(`${r.reviewer.slice(0, 4)}… ★${r.rating} → ${r.reward} units  ${r.why}${r.orderFeeSeen ? '' : ` (order not seen: fee taken as ${r.feeBps} bps)`}`);
  for (const [w, why] of Object.entries(report.withheld)) log.warn(`${w}: ${why}, so ${report.carried[w]} units are carried until it has one`);
}

async function once(payNow: boolean): Promise<void> {
  // A paying run needs a ledger that already exists; only --init-ledger starts one.
  const ledger = loadLedger(ledgerPath, [outDir], flags.pay ? { fresh: flags['init-ledger'] ? true : false } : {});
  const chain = await readChain(client, ledger.sightings);
  // A watcher keeps its key in memory for good, so it must not be the key that holds every fee.
  if (flags.pay && every !== undefined && signer.address === chain.treasury && !flags['allow-treasury-payer'])
    fail(`--watch --pay would keep the fee treasury's key (${signer.address}) in memory: pay from a separate rewards wallet with --payer <keypair file>, or pass --allow-treasury-payer to accept that`);
  const seen = observe(ledger, chain);
  if (seen) log.info(`recorded ${seen} new reviews`);

  if (!flags.pay) {
    // A preview adds sightings to the ledger on disk and never writes anything else there.
    if (locked) saveSightings(ledgerPath, ledger, [outDir]);
    if (!payNow) return;
    const report = score(ledger, chain, p);
    if (!report.rows.length && !report.payouts.length) return log.info('nothing owed');
    await withhold(report, client, chain.mint);
    const file = createReportFile(`${outDir}/epoch-${report.epoch.replace(/[:]/g, '')}-preview`);
    saveJson(file, report);
    return summary(report, file, 'owed (preview)');
  }
  if (!payNow) return saveJson(ledgerPath, ledger);

  // What the chain says was paid wins over the ledger.
  const { recovered } = await reconcile(ledger, chain, client, p, [...new Set([signer.address, chain.treasury])]);
  if (recovered) log.warn(`${recovered} reviews or carries were already paid on chain but not in the ledger: marked paid, not paid again`);
  saveJson(ledgerPath, ledger);

  const report = score(ledger, chain, p);
  if (!report.rows.length && !report.payouts.length) return log.info('nothing to pay');
  const file = createReportFile(`${outDir}/epoch-${report.epoch.replace(/[:]/g, '')}`);
  const save = () => {
    saveJson(file, report);
    saveJson(ledgerPath, ledger);
  };
  if (report.payouts.length) {
    try {
      await pay(report, ledger, client, chain.mint, { save });
    } catch (e) {
      const sent = report.payouts.filter((x) => x.signature).length;
      throw new PayFailed(`${(e as Error).message}. ${sent} of ${report.payouts.length} transfers were sent and are in the ledger and ${file}; a batch in flight is checked on chain at the next run`);
    }
  } else {
    record(report, ledger);
    save();
  }
  summary(report, file, 'paid');
}

if (every === undefined) {
  try {
    await once(true);
  } catch (e) {
    fail((e as Error).message);
  }
  process.exit(0);
}
let last = 0;
for (;;) {
  const due = Date.now() - last >= epochSecs * 1000;
  try {
    await once(due);
    if (due) last = Date.now();
  } catch (e) {
    if (e instanceof PayFailed) fail(`${e.message}. Stopped paying; start it again once the cause is fixed`);
    log.warn((e as Error).message);
  }
  await sleep(every * 1000);
}
