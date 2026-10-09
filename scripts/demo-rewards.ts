/**
 * The review-reward airdrop on a small, real market: a local validator with
 * the real program. Buyer agents buy from two merchants through the Tessera
 * API and review them; one merchant then takes an order and never delivers.
 * The airdrop records the reviews as they land, waits for them to mature,
 * scores them on what happened next, and pays from the treasury's fees.
 *
 * Everything the slides and the website show about review rewards comes from
 * the file this writes: deployments/rewards-demo.json.
 *
 *   npm run build:program && npm run demo:rewards
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getBase64EncodedWireTransaction, getBase64Encoder, getTransactionDecoder, lamports, partiallySignTransaction, type KeyPairSigner } from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import { getInitializeMint2Instruction, getMintSize, getMintToInstruction, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { configPda, fetchMaybeConfig, fromUnits, getEnsureAgentInstructionAsync, getInitializeInstructionAsync, getSetProfileInstructionAsync, programDataAddress, TESSERA_PROGRAM_ADDRESS, type Params, type RewardParams } from '@tessera/sdk';
import { clientForSigner, generateKeypairBytes, log, REPO_ROOT, sleep, tokenHelpers, waitForChainTime, type Cluster, type ScriptClient } from './lib.js';
import { observe, pay, readChain, saveJson, score, verify, type Ledger } from './rewards-lib.js';

const PORT = 19699;
const LOCAL: Cluster = { rpcUrl: `http://127.0.0.1:${PORT}` };
const USDC = 1_000_000n;
// Time compressed: a period is 2 s. The per-pair cap is large so a review weighs what its order settled.
const PARAMS: Params = {
  periodSecs: 2,
  holdSecs: [8, 6, 4, 0],
  tierScore: [100, 300, 500],
  tierPeriods: [1, 2, 3],
  creditFull: 100n * USDC,
  pairCap: 100n * USDC,
  tenureFull: 4,
  diversityFull: 20,
  reviewPrior: USDC,
  minOrder: 1_000n,
  deliverSecs: 6,
  unpaidSecs: 6,
  reviewSecs: 300,
  complaintSecs: 10,
  instantBase: USDC / 2n,
  instantFeePct: 100,
  pairHistoryMin: 2,
  pairAgeSecs: 2,
  penaltyDisputeBps: 2500,
  penaltyExpiredBps: 1000,
  penaltyDecayBps: 1,
};
// The devnet rules, with maturity compressed to 25 s.
const REWARD_PARAMS: RewardParams = { shareBps: 2500, maturitySecs: 25, consensusWindowSecs: 3600, lateSightSecs: 30, dustUnits: 1n };

const so = resolve(REPO_ROOT, 'target/deploy/tessera.so');
if (!existsSync(so)) throw new Error('target/deploy/tessera.so is missing: run `npm run build:program` first');

const role = async () => clientForSigner((await generateKeypairBytes()).signer, LOCAL);
const deployer = await role();
const ledgerDir = mkdtempSync(join(tmpdir(), 'tessera-rewards-demo-'));
const children: ChildProcess[] = [];
children.push(
  spawn(
    'solana-test-validator',
    ['--reset', '--quiet', '--ledger', ledgerDir, '--rpc-port', String(PORT), '--faucet-port', String(PORT + 1001), '--upgradeable-program', TESSERA_PROGRAM_ADDRESS, so, deployer.identity.address],
    { stdio: 'ignore', detached: true },
  ),
);

type R = { http: number; body: Record<string, any> };
let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) log.ok(label);
  else {
    failures += 1;
    log.fail(`${label}${detail === undefined ? '' : `: ${JSON.stringify(detail, (_, v) => (typeof v === 'bigint' ? v.toString() : v))}`}`);
  }
};

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
  const merchants = { quill: { client: await role(), title: 'Quill', price: 20n * USDC }, glib: { client: await role(), title: 'Glib', price: 15n * USDC } } as const;
  type MerchantId = keyof typeof merchants;
  const buyers = { scout: await role(), nova: await role(), orbit: await role(), wren: await role() };
  type BuyerId = keyof typeof buyers;
  const everyone = [deployer, arbiter, treasury, ...Object.values(merchants).map((m) => m.client), ...Object.values(buyers)];
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
  for (const c of [treasury, ...Object.values(merchants).map((m) => m.client), ...Object.values(buyers)]) await deployer.sendTransaction([await tok.ensureAtaIx(c.identity.address)]);
  for (const b of Object.values(buyers)) await deployer.sendTransaction([getMintToInstruction({ mint, token: await tok.ata(b.identity.address), mintAuthority: deployer.identity, amount: 100n * USDC })]);
  await deployer.sendTransaction([
    await getInitializeInstructionAsync({ authority: deployer.identity, mint, arbiter: arbiter.identity.address, treasury: treasury.identity.address, programData: await programDataAddress(), feeBps: 100, params: PARAMS }),
  ]);
  for (const [id, m] of Object.entries(merchants)) {
    await m.client.sendTransaction([
      await getEnsureAgentInstructionAsync({ wallet: m.client.identity.address, payer: m.client.identity }),
      await getSetProfileInstructionAsync({ wallet: m.client.identity, name: id, uri: '', kind: 2 }),
    ]);
  }
  log.ok('ready');

  process.env.TESSERA_RPC_URLS = LOCAL.rpcUrl;
  process.env.TESSERA_EXPLORER_CLUSTER = `custom&customUrl=${encodeURIComponent(LOCAL.rpcUrl)}`;
  process.env.TESSERA_READS_PER_MIN = '10000';
  process.env.TESSERA_BUILDS_PER_MIN = '10000';
  process.env.TESSERA_SUBMITS_PER_MIN = '10000';
  const { createApp } = await import('../apps/api/src/server.js');
  const apiServer = createApp().listen(0);
  await new Promise((r) => apiServer.once('listening', r));
  const API = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`;
  const api = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<R> => {
    const res = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { http: res.status, body: (await res.json()) as Record<string, any> };
  };
  const signSend = async (r: R, kp: KeyPairSigner) => {
    if (r.body.status !== 'ok') throw new Error(`${r.body.tool}: ${r.body.status} ${r.body.message ?? ''}`);
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(r.body.transaction));
    const signed = await partiallySignTransaction([kp.keyPair], tx);
    const sent = await api('POST', '/v1/tx/submit', { transaction: getBase64EncodedWireTransaction(signed) });
    if (sent.body.confirmed !== true) throw new Error(`submit: ${JSON.stringify(sent.body).slice(0, 300)}`);
  };

  // What the API told a buyer its review could earn, kept for the slides.
  let estimate: Record<string, unknown> | null = null;
  const story: { buyer: BuyerId; merchant: MerchantId; rating: number; comment: string }[] = [];

  /** One purchase and its review, through the API, each wallet signing its own transactions. */
  async function buy(bid: BuyerId, id: MerchantId, rating: number, comment: string) {
    const b = buyers[bid];
    const m = merchants[id];
    const amount = fromUnits(m.price, 6);
    const [B, M] = [b.identity.address, m.client.identity.address];
    const request = { skill: 'summary', input: { text: 'Agents pay each other now.' } };
    const opened = await api('POST', '/v1/escrow/open', { role: 'merchant', merchant: M, buyer: B, amount, request });
    await signSend(opened, m.client.identity);
    await signSend(await api('POST', '/v1/escrow/open', { role: 'buyer', merchant: M, buyer: B, amount, order: opened.body.order, request }), b.identity);
    await signSend(await api('POST', '/v1/escrow/deliver', { order: opened.body.order, merchant: M, deliverable: { summary: 'Agents pay each other now.' } }), m.client.identity);
    const reported = await api('POST', '/v1/escrow/report', { order: opened.body.order, reporter: B, outcome: 'satisfied', rating, comment });
    estimate ??= { buyer: bid, merchant: id, amount, rating, reward: reported.body.reward };
    await signSend(reported, b.identity);
    story.push({ buyer: bid, merchant: id, rating, comment });
    log.info(`${bid.padEnd(6)} bought from ${m.title.padEnd(6)} ${amount} USDC  ★${rating}  "${comment}"`);
    return opened.body.order as string;
  }

  log.step('Buyer agents shop and review (every review needs a real settled order)');
  await buy('scout', 'quill', 5, 'Exactly the two sentences I needed.');
  const novaQuill = await buy('nova', 'quill', 5, 'Reliable every time.');
  await buy('orbit', 'quill', 4, 'Fast and right.');
  await buy('wren', 'quill', 1, 'Useless.');
  await buy('scout', 'glib', 5, 'Brilliant, instant.');
  await buy('nova', 'glib', 4, 'Good enough.');
  await buy('orbit', 'glib', 2, 'Summarised the wrong text. Careful with this one.');
  // Merchants review buyers too, once the buyer has reviewed the same order.
  await signSend(await api('POST', '/v1/escrow/report', { order: novaQuill, reporter: merchants.quill.client.identity.address, outcome: 'satisfied', rating: 5, comment: 'Paid promptly.' }), merchants.quill.client.identity);
  log.info('quill  reviewed nova  ★5  "Paid promptly."');

  log.step('The airdrop records each review as it lands, and how its subject stood then');
  const ledger: Ledger = { version: 1, sightings: {}, paid: {}, carry: {} };
  const ledgerClient = clientForSigner(treasury.identity, LOCAL);
  const seen = observe(ledger, await readChain(ledgerClient));
  check(`${seen} reviews recorded`, seen === 8, seen);

  log.step('Then Glib takes an order and never delivers');
  {
    const b = buyers.wren;
    const M = merchants.glib.client.identity.address;
    const opened = await api('POST', '/v1/escrow/open', { role: 'merchant', merchant: M, buyer: b.identity.address, amount: '15' });
    await signSend(opened, merchants.glib.client.identity);
    await signSend(await api('POST', '/v1/escrow/open', { role: 'buyer', merchant: M, buyer: b.identity.address, amount: '15', order: opened.body.order }), b.identity);
    const early = await api('POST', '/v1/escrow/reclaim', { order: opened.body.order, signer: b.identity.address });
    await waitForChainTime(deployer, BigInt(early.body.availableAt));
    await signSend(await api('POST', '/v1/escrow/reclaim', { order: opened.body.order, signer: b.identity.address }), b.identity);
    log.info('Glib missed the deadline: wren was refunded in full, and Glib has a missed delivery on its file');
  }

  log.step('The reviews mature; the airdrop scores them on what happened next and pays');
  const newest = Math.max(...Object.values(ledger.sightings).map((s) => s.firstSeenAt));
  await waitForChainTime(deployer, BigInt(newest + REWARD_PARAMS.maturitySecs + 2));
  const chain = await readChain(ledgerClient);
  observe(ledger, chain);
  const report = score(ledger, chain, REWARD_PARAMS);
  const wallet = (id: string): ScriptClient => (buyers as Record<string, ScriptClient>)[id] ?? merchants[id as MerchantId].client;
  const ids = [...Object.keys(buyers), ...Object.keys(merchants)];
  const nameOf = (w: string) => ids.find((id) => wallet(id).identity.address === w) ?? w;
  const before = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await tok.balance(wallet(id).identity.address)] as const)));
  const treasuryBefore = await tok.balance(treasury.identity.address);
  await pay(report, ledger, ledgerClient, mint);
  const after = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await tok.balance(wallet(id).identity.address)] as const)));
  const treasuryAfter = await tok.balance(treasury.identity.address);

  for (const r of report.rows) log.info(`${nameOf(r.reviewer).padEnd(6)} → ${nameOf(r.subject).padEnd(6)} ★${r.rating}  ${fromUnits(BigInt(r.reward), 6).padStart(9)} USDC  ${r.why}`);
  const row = (reviewer: string, subject: string) => report.rows.find((r) => nameOf(r.reviewer) === reviewer && nameOf(r.subject) === subject)!;
  check('a 5-star review of Glib, which then failed, earns nothing', row('scout', 'glib').accuracy.label === 'vouched_then_failed' && row('scout', 'glib').reward === '0');
  check('a 4-star review of Glib earns nothing', row('nova', 'glib').reward === '0');
  check('the 2-star warning about Glib earns 1.5x', row('orbit', 'glib').accuracy.label === 'early_warning' && BigInt(row('orbit', 'glib').reward) === (BigInt(row('orbit', 'glib').base) * 3n) / 2n);
  check('the 1-star outlier on Quill earns 0.5x', row('wren', 'quill').accuracy.label === 'outlier');
  check('the merchant review of a good buyer is paid too', row('quill', 'nova').reward !== '0');
  for (const x of report.payouts) {
    const id = nameOf(x.wallet);
    check(`${id} received ${x.usdc} USDC on chain`, after[id]! - before[id]! === BigInt(x.amount), { before: before[id], after: after[id] });
  }
  const cfg = await fetchMaybeConfig(deployer.rpc, await configPda());
  const feesCollected = cfg.exists ? cfg.data.feesCollected : 0n;
  const paidOut = treasuryBefore - treasuryAfter;
  check(`paid ${fromUnits(paidOut, 6)} USDC of ${fromUnits(feesCollected, 6)} USDC in fees: under 75%`, paidOut * 100n <= feesCollected * 75n);
  check('anyone can recompute the payout from the report alone', verify(JSON.parse(JSON.stringify(report, (_, v) => (typeof v === 'bigint' ? v.toString() : v)))).length === 0);

  const file = resolve(REPO_ROOT, 'deployments/rewards-demo.json');
  saveJson(file, {
    recordedAt: new Date().toISOString(),
    network: 'local solana-test-validator, the real Tessera program, time compressed (a period is 2 s, reviews mature after 25 s)',
    reproduce: 'npm run build:program && npm run demo:rewards',
    names: Object.fromEntries(ids.map((id) => [wallet(id).identity.address, id])),
    story,
    afterwards: 'Glib then took an order from wren and never delivered: wren was refunded in full.',
    estimate,
    fees: { collected: fromUnits(feesCollected, 6), paidToReviewers: fromUnits(paidOut, 6), shareOfFees: Number((paidOut * 10_000n) / (feesCollected || 1n)) / 100 },
    rows: report.rows.map((r) => ({ reviewer: nameOf(r.reviewer), subject: nameOf(r.subject), rating: r.rating, weight: fromUnits(BigInt(r.weight), 6), base: fromUnits(BigInt(r.base), 6), label: r.accuracy.label, bps: r.accuracy.bps, reward: fromUnits(BigInt(r.reward), 6), why: r.why })),
    payouts: report.payouts.map((x) => ({ who: nameOf(x.wallet), usdc: x.usdc, signature: x.signature })),
    report,
  });
  log.ok(`recorded to ${file}`);
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
  rmSync(ledgerDir, { recursive: true, force: true });
}
if (failures) {
  log.fail(`${failures} checks failed`);
  process.exit(1);
}
process.exit(0);
