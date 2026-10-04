/**
 * The demo network. Buyer agents purchase from merchant agents over A2A and
 * x402, on devnet, period after period, so every wallet's tier is earned
 * on-chain rather than set by hand. Later, three attacks join in:
 *
 *   washer + sock puppets   a wash-trading ring that only trades with itself
 *   mallory                 a merchant that takes orders and never delivers
 *   charlie                 a buyer that disputes what it received
 *
 * This is generated traffic with recycled test USDC. It shows what the
 * program does with each behaviour; it is not organic usage.
 *
 *   npm run agents        (in one terminal)
 *   npm run swarm         (in another)        [--periods 45] [--x402-every 3]
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  fromUnits,
  getEnsureAgentInstructionAsync,
  getSetProfileInstructionAsync,
  TIER_NAMES,
  toUnits,
  USDC_DEVNET,
} from '@tessera/sdk';
import { ADVERSARIES, agentCardUrl, AGENT_HOST, BUYERS, keyPath, MERCHANTS } from '../../../scripts/cast.js';
import { clientForSigner, loadKeypair, localRpcProxy, REPO_ROOT, sleep, tokenHelpers } from '../../../scripts/lib.js';
import { BuyerAgent, type Purchase } from './buyer.js';
import { liveScore, readAgent, send, usdcBalance, type Actor } from './chain.js';
import { SERVICES } from './services.js';

const flag = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : fallback;
};
const PERIODS = flag('periods', 45);
const X402_EVERY = flag('x402-every', 3);
const RING_FROM = flag('ring-from', 3);
const CHARLIE_FRAUD_AT = flag('fraud-at', 24);
const NOSHOW_AT = flag('noshow-at', 26);
const PERIOD_MS = 60_000;

const X402_RPC = process.env.X402_RPC_URL ?? (await localRpcProxy());
const ops = clientForSigner(await loadKeypair('.keys/server.json'));
const actorOf = async (id: string): Promise<Actor> => clientForSigner(await loadKeypair(keyPath(id)));

const stats = { ok: 0, failed: 0, x402: 0, instant: 0, held: 0 };
mkdirSync(resolve(REPO_ROOT, 'deployments'), { recursive: true });
const measurements = resolve(REPO_ROOT, 'deployments/measurements.jsonl');
const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);

let n = 0;
async function buyerAgent(id: string): Promise<BuyerAgent> {
  return new BuyerAgent(id, await actorOf(id), { // The x402 client makes its own RPC calls; send them through the same budgeted pool.
  rpcUrl: X402_RPC, mode: 'direct', sponsor: ops, log });
}

const honest = await Promise.all(BUYERS.map((b) => buyerAgent(b.id)));
const charlie = await buyerAgent('charlie');
const socks = await Promise.all(ADVERSARIES.filter((a) => a.behaviour === 'ring-buyer').map((a) => buyerAgent(a.id)));
const merchantIds = MERCHANTS.map((m) => m.id);

const CORPUS = [
  'Agents will buy from agents they have never met. A card network solves that with chargebacks, which take months. An escrow solves it in seconds. The open question is how long the escrow should hold the money.',
  'A new wallet costs nothing to create. A reputation that can be minted by new wallets is worth nothing. So evidence has to cost something that cannot be recovered: fees on settled volume, and time.',
  'Micropayments settle instantly because little is at risk. Large payments wait because much is. The same rule covers both: the hold is proportional to what is not yet known about the two parties.',
];
const SEEDS = ['solana', 'tessera', 'escrow', 'agent', 'x402', 'credit', 'settle', 'trust'];
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

function inputFor(skill: string): unknown {
  if (skill === 'summary') return { text: pick(CORPUS) };
  if (skill === 'identicon') return { seed: `${pick(SEEDS)}-${Math.floor(Math.random() * 1000)}` };
  if (skill === 'credit-report') return { wallet: pick(honest).wallet };
  return {};
}

async function join(id: string, actor: Actor, uri = ''): Promise<void> {
  const existing = await readAgent(ops, actor.identity.address);
  if (existing && existing.name === id) return;
  await send(ops, [await getEnsureAgentInstructionAsync({ wallet: actor.identity.address, payer: ops.identity })]);
  await send(actor, [await getSetProfileInstructionAsync({ wallet: actor.identity, name: id, uri, kind: 2 })]);
  log(`${id} joined the network`);
}

async function purchase(
  b: BuyerAgent,
  merchant: string,
  opts: { x402?: boolean; minHoldSecs?: number; follow?: Parameters<BuyerAgent['followUp']>[1] } = {},
): Promise<Purchase | null> {
  const skill = SERVICES[merchant]![0]!.sku;
  const agent = opts.x402 ? new BuyerAgent(b.id, b.actor, { ...b.opts, mode: 'x402' }) : b;
  try {
    const p = await agent.buy(agentCardUrl(merchant), skill, inputFor(skill), { minHoldSecs: opts.minHoldSecs });
    if (p.failed) stats.failed += 1;
    else {
      stats.ok += 1;
      if (p.instant) stats.instant += 1;
      else stats.held += 1;
      if (opts.x402) stats.x402 += 1;
      appendFileSync(
        measurements,
        JSON.stringify({ at: Date.now(), buyer: b.id, merchant, mode: p.mode, instant: p.instant, holdSecs: p.terms.holdSecs, ...p.timings }) + '\n',
      );
    }
    // Rate (or dispute) in the background once the escrow settles.
    void agent.followUp(p, opts.follow).catch((e) => log(`[${b.id}] follow-up: ${(e as Error).message.slice(0, 100)}`));
    return p;
  } catch (e) {
    stats.failed += 1;
    log(`[${b.id}] ${merchant}: ${(e as Error).message.slice(0, 140)}`);
    return null;
  }
}

/** Merchants hand their revenue back to buyers so the demo can keep running on a few test dollars. */
async function recycle(): Promise<void> {
  const tok = tokenHelpers(ops, USDC_DEVNET);
  const sellers = [...merchantIds, 'washer'];
  const needy = [...honest, charlie, ...socks];
  for (const id of sellers) {
    const seller = await actorOf(id);
    let have = await usdcBalance(ops, seller.identity.address, USDC_DEVNET);
    for (const b of needy) {
      if (have < toUnits('0.5')) break;
      const balance = await usdcBalance(ops, b.wallet, USDC_DEVNET);
      const want = (id === 'washer') === b.id.startsWith('sock') ? toUnits('2') - balance : 0n;
      if (want < toUnits('0.5')) continue;
      const amount = want < have ? want : have;
      await send(seller, [await tok.transferIx(seller, await tok.ata(b.wallet), amount)]).catch(() => undefined);
      have -= amount;
    }
  }
}

async function board(): Promise<void> {
  const rows: string[] = [];
  for (const id of [...merchantIds, ...BUYERS.map((b) => b.id), 'charlie', 'washer', 'sock-1', 'mallory']) {
    const s = await liveScore(ops, (await actorOf(id)).identity.address);
    if (s) rows.push(`${id} ${s.score} ${TIER_NAMES[s.tier]![0]}`);
  }
  log(`scores | ${rows.join(' | ')}`);
  log(`orders | ${stats.ok} delivered (${stats.instant} instant, ${stats.held} held, ${stats.x402} via facilitator), ${stats.failed} failed`);
}

const washer = await actorOf('washer');
const mallory = await actorOf('mallory');
log(`swarm against ${AGENT_HOST}: ${honest.length} buyers, ${merchantIds.length} merchants, ${PERIODS} periods`);

for (let k = 1; k <= PERIODS; k += 1) {
  const started = Date.now();
  const jobs: (() => Promise<unknown>)[] = [];

  // Honest traffic: every buyer buys once a period, rotating through the merchants.
  honest.forEach((b, i) => {
    const merchant = merchantIds[(i + k) % merchantIds.length]!;
    n += 1;
    const x402 = X402_EVERY > 0 && n % X402_EVERY === 0;
    jobs.push(() => purchase(b, merchant, { x402 }));
  });

  // Charlie looks like any other buyer, until it is not.
  if (k >= 2 && k < CHARLIE_FRAUD_AT) {
    if (k === 2) await join('charlie', charlie.actor);
    jobs.push(() => purchase(charlie, 'atlas'));
  } else if (k === CHARLIE_FRAUD_AT || k === CHARLIE_FRAUD_AT + 2) {
    log('charlie: received a valid delivery and is disputing it anyway');
    // It asks for a hold, which any buyer may, so that it has a window to dispute in.
    jobs.push(() => purchase(charlie, 'atlas', { minHoldSecs: 60, follow: { disputeAnyway: true } }));
  }

  // The ring: one merchant and its own sock puppets, trading in a circle.
  if (k >= RING_FROM) {
    if (k === RING_FROM) {
      await join('washer', washer, agentCardUrl('washer'));
      for (const s of socks) await join(s.id, s.actor);
    }
    for (const s of socks) jobs.push(() => purchase(s, 'washer', { follow: { rating: 5, text: 'Great service!!' } }));
  }

  // The no-show: takes real orders from real buyers and delivers nothing.
  if (k === NOSHOW_AT) {
    await join('mallory', mallory, agentCardUrl('mallory'));
    for (const b of honest.slice(0, 3)) jobs.push(() => purchase(b, 'mallory'));
  }

  // Three at a time, spread over the period, to stay inside the public RPC's limits.
  const gap = Math.floor((PERIOD_MS * 0.8) / Math.max(1, Math.ceil(jobs.length / 3)));
  for (let i = 0; i < jobs.length; i += 3) {
    const batch = Date.now();
    await Promise.all(jobs.slice(i, i + 3).map((j) => j()));
    await sleep(Math.max(0, gap - (Date.now() - batch)));
  }

  if (k % 2 === 0) await recycle().catch((e) => log(`recycle: ${(e as Error).message.slice(0, 100)}`));
  if (k % 3 === 0 || k === 1) await board().catch(() => undefined);
  log(`period ${k}/${PERIODS} done in ${Math.round((Date.now() - started) / 1000)}s`);
  await sleep(Math.max(0, PERIOD_MS - (Date.now() - started)));
}

log('waiting for the last escrows to settle and be rated...');
await sleep(150_000);
await board();
log(`buyers hold ${fromUnits(await usdcBalance(ops, honest[0]!.wallet, USDC_DEVNET))} USDC each (first buyer)`);
process.exit(0);
