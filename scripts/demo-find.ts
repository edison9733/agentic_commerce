/**
 * A small, real market for `find_merchants`, on a local validator with the
 * real program: four merchant agents publish A2A cards, three buyer agents
 * buy from them through the Tessera API (each wallet signing its own
 * transactions), leave reviews, and one merchant misses a delivery. Then a
 * buyer asks who to buy a text summary from, the way an agent would.
 *
 * Everything the slides and the website show about find_merchants comes from
 * the file this writes: deployments/find-demo.json.
 *
 *   npm run build:program && npm run demo:find
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getBase64EncodedWireTransaction, getBase64Encoder, getTransactionDecoder, lamports, partiallySignTransaction, type KeyPairSigner } from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import { getInitializeMint2Instruction, getMintSize, getMintToInstruction, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import express from 'express';
import {
  getEnsureAgentInstructionAsync,
  getInitializeInstructionAsync,
  getSetProfileInstructionAsync,
  programDataAddress,
  TESSERA_PROGRAM_ADDRESS,
  type Params,
} from '@tessera/sdk';
import { clientForSigner, generateKeypairBytes, log, REPO_ROOT, sleep, tokenHelpers, waitForChainTime, type Cluster, type ScriptClient } from './lib.js';

const PORT = 19799;
const LOCAL: Cluster = { rpcUrl: `http://127.0.0.1:${PORT}` };
const USDC = 1_000_000n;
// Time compressed like the devnet demo, more so: a period is 2 s.
const PARAMS: Params = {
  periodSecs: 2,
  holdSecs: [8, 6, 4, 0],
  tierScore: [100, 300, 500],
  tierPeriods: [1, 2, 3],
  creditFull: USDC,
  pairCap: USDC,
  tenureFull: 4,
  diversityFull: 20,
  reviewPrior: USDC / 100n,
  minOrder: 1_000n,
  deliverSecs: 6,
  unpaidSecs: 6,
  reviewSecs: 90,
  complaintSecs: 90,
  instantBase: USDC / 2n,
  instantFeePct: 100,
  pairHistoryMin: 2,
  pairAgeSecs: 2,
  penaltyDisputeBps: 2500,
  penaltyExpiredBps: 1000,
  penaltyDecayBps: 1,
};

const so = resolve(REPO_ROOT, 'target/deploy/tessera.so');
if (!existsSync(so)) throw new Error('target/deploy/tessera.so is missing: run `npm run build:program` first');

const role = async () => clientForSigner((await generateKeypairBytes()).signer, LOCAL);
const deployer = await role();
const ledger = mkdtempSync(join(tmpdir(), 'tessera-find-demo-'));
const children: ChildProcess[] = [];
children.push(
  spawn(
    'solana-test-validator',
    ['--reset', '--quiet', '--ledger', ledger, '--rpc-port', String(PORT), '--faucet-port', String(PORT + 1001), '--upgradeable-program', TESSERA_PROGRAM_ADDRESS, so, deployer.identity.address],
    { stdio: 'ignore', detached: true },
  ),
);

type R = { http: number; body: Record<string, any> };

try {
  for (let i = 0; ; i += 1) {
    try {
      await deployer.rpc.getHealth().send();
      break;
    } catch {
      if (i > 120) throw new Error('the validator did not start');
      await sleep(500);
    }
  }

  log.step('A local validator with the real program, a test USDC and the config');
  const [arbiter, treasury] = await Promise.all([role(), role()]);
  const merchants = {
    quill: { client: await role(), title: 'Quill', about: 'Text summaries.', skills: [['summary', 'Text summary', 'The two sentences that carry the most of a text.', '250000', ['text', 'nlp']]] },
    scribe: { client: await role(), title: 'Scribe', about: 'Careful text summaries.', skills: [['summary', 'Text summary', 'A short summary of any text, checked twice.', '150000', ['text', 'nlp']]] },
    glib: { client: await role(), title: 'Glib', about: 'Instant summaries.', skills: [['summary', 'Text summary', 'Summaries in a flash.', '100000', ['text', 'nlp']]] },
    atlas: { client: await role(), title: 'Atlas', about: 'Solana network telemetry.', skills: [['telemetry', 'Solana network telemetry', 'Slot, epoch and throughput.', '200000', ['solana']]] },
  } as const;
  type MerchantId = keyof typeof merchants;
  const buyers = { scout: await role(), nova: await role(), orbit: await role() };
  const everyone = [deployer, arbiter, ...Object.values(merchants).map((m) => m.client), ...Object.values(buyers)];
  for (const c of everyone) await deployer.rpc.requestAirdrop(c.identity.address, lamports(10_000_000_000n)).send();
  await sleep(2000);
  const mintSigner = (await generateKeypairBytes()).signer;
  const space = BigInt(getMintSize());
  await deployer.sendTransaction([
    getCreateAccountInstruction({ payer: deployer.identity, newAccount: mintSigner, lamports: await deployer.rpc.getMinimumBalanceForRentExemption(space).send(), space, programAddress: TOKEN_PROGRAM_ADDRESS }),
    getInitializeMint2Instruction({ mint: mintSigner.address, decimals: 6, mintAuthority: deployer.identity.address, freezeAuthority: null }),
  ]);
  const mint = mintSigner.address;
  const tok = tokenHelpers(deployer, mint);
  for (const c of [...Object.values(merchants).map((m) => m.client), ...Object.values(buyers)]) await deployer.sendTransaction([await tok.ensureAtaIx(c.identity.address)]);
  for (const b of Object.values(buyers)) await deployer.sendTransaction([getMintToInstruction({ mint, token: await tok.ata(b.identity.address), mintAuthority: deployer.identity, amount: 20n * USDC })]);
  await deployer.sendTransaction([
    await getInitializeInstructionAsync({ authority: deployer.identity, mint, arbiter: arbiter.identity.address, treasury: treasury.identity.address, programData: await programDataAddress(), feeBps: 100, params: PARAMS }),
  ]);
  log.ok('ready');

  log.step('Four merchant agents publish A2A cards and point their credit files at them');
  const cards = express();
  cards.get('/agents/:id/card.json', (req, res) => {
    const m = merchants[req.params.id as MerchantId];
    if (!m) return void res.status(404).end();
    res.json({
      protocolVersion: '0.3.0',
      name: m.title,
      description: m.about,
      url: `http://127.0.0.1:${(cardServer.address() as AddressInfo).port}/agents/${req.params.id}/a2a`,
      skills: m.skills.map(([id, name, description, , tags]) => ({ id, name, description, tags })),
      capabilities: {
        extensions: [
          {
            uri: 'https://github.com/edison9733/agentic_commerce/blob/main/docs/A2A-EXTENSION.md',
            params: {
              wallet: m.client.identity.address,
              prices: Object.fromEntries(m.skills.map(([id, , , price]) => [id, price])),
              decimals: 6,
              x402Resource: `http://127.0.0.1:${(cardServer.address() as AddressInfo).port}/agents/${req.params.id}/x402/{skill}`,
            },
          },
        ],
      },
    });
  });
  const cardServer = cards.listen(0);
  await new Promise((r) => cardServer.once('listening', r));
  const cardBase = `http://127.0.0.1:${(cardServer.address() as AddressInfo).port}`;
  for (const [id, m] of Object.entries(merchants)) {
    await m.client.sendTransaction([
      await getEnsureAgentInstructionAsync({ wallet: m.client.identity.address, payer: m.client.identity }),
      await getSetProfileInstructionAsync({ wallet: m.client.identity, name: id, uri: `${cardBase}/agents/${id}/card.json`, kind: 2 }),
    ]);
    log.info(`${m.title.padEnd(7)} ${m.client.identity.address}`);
  }

  // The API, in this process, against the validator.
  process.env.TESSERA_RPC_URLS = LOCAL.rpcUrl;
  // Explorer links in the replies point at this validator, not devnet.
  process.env.TESSERA_EXPLORER_CLUSTER = `custom&customUrl=${encodeURIComponent(LOCAL.rpcUrl)}`;
  process.env.TESSERA_READS_PER_MIN = '10000';
  process.env.TESSERA_BUILDS_PER_MIN = '10000';
  process.env.TESSERA_SUBMITS_PER_MIN = '10000';
  process.env.TESSERA_FIND_SNAPSHOT_MS = '0';
  process.env.TESSERA_ALLOW_PRIVATE_CARDS = '1';
  const { createApp } = await import('../apps/api/src/server.js');
  const apiServer = createApp().listen(0);
  await new Promise((r) => apiServer.once('listening', r));
  const API = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`;
  const api = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<R> => {
    const res = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { http: res.status, body: (await res.json()) as Record<string, any> };
  };
  /** What an agent's wallet does with a transaction the API built: sign it, send it. */
  const signSend = async (r: R, kp: KeyPairSigner) => {
    if (r.body.status !== 'ok') throw new Error(`${r.body.tool}: ${r.body.status} ${r.body.message ?? ''}`);
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(r.body.transaction));
    const signed = await partiallySignTransaction([kp.keyPair], tx);
    const sent = await api('POST', '/v1/tx/submit', { transaction: getBase64EncodedWireTransaction(signed) });
    if (sent.body.confirmed !== true) throw new Error(`submit: ${JSON.stringify(sent.body).slice(0, 300)}`);
  };

  /** One purchase through the API, as two agents would make it. */
  async function buy(b: ScriptClient, id: MerchantId, o: { rating?: number; comment?: string; deliverAfterMs?: number; ghost?: boolean } = {}) {
    const m = merchants[id];
    const [sku, , , price] = m.skills[0];
    const amount = (Number(price) / 1e6).toFixed(2);
    const B = b.identity.address;
    const M = m.client.identity.address;
    const request = { skill: sku, input: { text: 'Agents pay each other now.' } };
    const opened = await api('POST', '/v1/escrow/open', { role: 'merchant', merchant: M, buyer: B, amount, request });
    await signSend(opened, m.client.identity);
    await signSend(await api('POST', '/v1/escrow/open', { role: 'buyer', merchant: M, buyer: B, amount, order: opened.body.order, request }), b.identity);
    if (o.ghost) {
      const early = await api('POST', '/v1/escrow/reclaim', { order: opened.body.order, signer: B });
      await waitForChainTime(deployer, BigInt(early.body.availableAt));
      await signSend(await api('POST', '/v1/escrow/reclaim', { order: opened.body.order, signer: B }), b.identity);
      log.info(`${m.title.padEnd(7)} never delivered: refunded`);
      return;
    }
    if (o.deliverAfterMs) await sleep(o.deliverAfterMs);
    await signSend(await api('POST', '/v1/escrow/deliver', { order: opened.body.order, merchant: M, deliverable: { summary: 'Agents pay each other now.' } }), m.client.identity);
    const state = (await api('GET', `/v1/escrow/${opened.body.order}`)).body.state;
    if (state !== 'Released') {
      await signSend(await api('POST', '/v1/escrow/report', { order: opened.body.order, reporter: B, outcome: 'satisfied', rating: o.rating ?? 5, comment: o.comment }), b.identity);
    }
    log.info(`${m.title.padEnd(7)} ${amount} USDC  ★${o.rating ?? 5}${o.comment ? `  "${o.comment}"` : ''}`);
  }

  log.step('Buyer agents shop and leave reviews (every review needs a real settled order)');
  const { scout, nova, orbit } = buyers;
  await buy(scout, 'quill', { rating: 5, comment: 'Exactly the two sentences I needed.' });
  await buy(nova, 'scribe', { rating: 5, comment: 'Good, a little slow.', deliverAfterMs: 4000 });
  await buy(orbit, 'glib', { rating: 3 });
  await buy(nova, 'quill', { rating: 5 });
  await buy(scout, 'atlas', { rating: 5 });
  await buy(orbit, 'quill', { rating: 4, comment: 'Fast and right.' });
  await buy(scout, 'glib', { ghost: true });
  await buy(orbit, 'scribe', { rating: 4, deliverAfterMs: 4000 });
  await buy(scout, 'quill', { rating: 5 });
  await buy(nova, 'glib', { rating: 2, comment: 'Wrong text summarised.' });
  await buy(nova, 'quill', { rating: 5, comment: 'Reliable every time.' });
  await buy(orbit, 'atlas', { rating: 5 });

  log.step('A new buyer agent asks: who should I buy a text summary from?');
  const newcomer = await role();
  await deployer.sendTransaction([await tok.ensureAtaIx(newcomer.identity.address)]);
  await deployer.sendTransaction([getMintToInstruction({ mint, token: await tok.ata(newcomer.identity.address), mintAuthority: deployer.identity, amount: 5n * USDC })]);
  const tsx = createRequire(import.meta.url).resolve('tsx/cli');
  const cli = (args: string[]) =>
    new Promise<string>((done) => {
      const p = spawn(process.execPath, [tsx, resolve(REPO_ROOT, 'apps/cli/src/cli.ts'), ...args, '--api', API]);
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (out += d));
      p.on('close', () => done(out.trimEnd()));
    });
  const asks = [
    { label: 'best', cli: ['find', 'text', 'summary', '--buyer', newcomer.identity.address], query: `need=text%20summary&buyer=${newcomer.identity.address}` },
    { label: 'fastest', cli: ['find', 'text', 'summary', '--sort', 'fastest', '--buyer', newcomer.identity.address], query: `need=text%20summary&sort=fastest&buyer=${newcomer.identity.address}` },
    { label: 'cheapest', cli: ['find', 'text', 'summary', '--sort', 'cheapest', '--buyer', newcomer.identity.address], query: `need=text%20summary&sort=cheapest&buyer=${newcomer.identity.address}` },
    { label: 'returning', cli: ['find', 'text', 'summary', '--limit', '1', '--buyer', buyers.scout.identity.address], query: `need=text%20summary&limit=1&buyer=${buyers.scout.identity.address}` },
    { label: 'no_match', cli: ['find', 'quantum', 'teleportation'], query: 'need=quantum%20teleportation' },
  ];
  const results = [];
  for (const a of asks) {
    const reply = (await api('GET', `/v1/merchants?${a.query}`)).body;
    const out = await cli(a.cli);
    console.log(`\n$ tessera ${a.cli.join(' ').replace(newcomer.identity.address, '<new buyer>').replace(buyers.scout.identity.address, '<scout>')}\n${out}`);
    results.push({ label: a.label, command: `tessera ${a.cli.join(' ')}`, request: `GET /v1/merchants?${a.query}`, cli: out, reply });
  }
  const top = results[0]!.reply.ranked[0];
  const check = (await api('POST', '/v1/check', { merchant: top.merchant, buyer: newcomer.identity.address, amount: top.service.price.usdc })).body;
  console.log(`\nthen check_payment on #1: ${check.decision} (${check.reason}), hold ${check.holdSecs} s`);

  const file = resolve(REPO_ROOT, 'deployments/find-demo.json');
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        network: 'local solana-test-validator, the real Tessera program, time compressed (a period is 2 s)',
        reproduce: 'npm run build:program && npm run demo:find',
        merchants: Object.fromEntries(Object.entries(merchants).map(([id, m]) => [id, m.client.identity.address])),
        buyers: { ...Object.fromEntries(Object.entries(buyers).map(([id, c]) => [id, c.identity.address])), newcomer: newcomer.identity.address },
        results,
        thenCheck: { decision: check.decision, reason: check.reason, holdSecs: check.holdSecs },
      },
      null,
      2,
    )}\n`,
  );
  log.ok(`recorded to ${file}`);
  cardServer.close();
  apiServer.close();
} finally {
  for (const c of children) {
    try {
      process.kill(-c.pid!, 'SIGKILL');
    } catch {
      c.kill('SIGKILL');
    }
  }
  await sleep(300);
  rmSync(ledger, { recursive: true, force: true });
}
process.exit(0);
