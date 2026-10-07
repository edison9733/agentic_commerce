/**
 * The four doors, end to end, against the real program on a local validator:
 *
 *   HTTP API   every tool, every refusal path, transactions signed here (as an
 *              agent's own wallet would) and relayed through the API
 *   MCP        the same tools over Streamable HTTP, enums in the schemas
 *   Skill      SKILL.md names every tool the server offers
 *   CLI        read commands, local signing, and refusing a tampered transaction
 *
 *   npm run build:program && npm run test:doors
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  lamports,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type KeyPairSigner,
} from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import { getInitializeMint2Instruction, getMintSize, getMintToInstruction, getTransferCheckedInstruction, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import express from 'express';
import {
  fetchOrder,
  getInitializeInstructionAsync,
  getResolveDisputeInstruction,
  hashJson,
  programDataAddress,
  settleAccounts,
  TESSERA_PROGRAM_ADDRESS,
  toHex,
  type Params,
} from '@tessera/sdk';
import { generateKeypairBytes, clientForSigner, log, REPO_ROOT, sleep, tokenHelpers, waitForChainTime, type Cluster } from './lib.js';

const PORT = 19899;
const LOCAL: Cluster = { rpcUrl: `http://127.0.0.1:${PORT}` };
const USDC = 1_000_000n;
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
  complaintSecs: 10,
  instantBase: USDC / 2n,
  instantFeePct: 100,
  pairHistoryMin: 2,
  pairAgeSecs: 2,
  penaltyDisputeBps: 2500,
  penaltyExpiredBps: 1000,
  penaltyDecayBps: 1,
};

let checks = 0;
let failures = 0;
function ok(label: string, cond: boolean, detail?: unknown): void {
  checks += 1;
  if (cond) log.ok(label);
  else {
    failures += 1;
    console.log(`   FAIL ${label}${detail === undefined ? '' : `: ${JSON.stringify(detail, (_, v) => (typeof v === 'bigint' ? v.toString() : v)).slice(0, 600)}`}`);
  }
}

const so = resolve(REPO_ROOT, 'target/deploy/tessera.so');
if (!existsSync(so)) throw new Error('target/deploy/tessera.so is missing: run `npm run build:program` first');
const tsx = createRequire(import.meta.url).resolve('tsx/cli');
/** Every role's key in the Solana CLI's 64-byte format, so the CLI can be handed a keypair file. */
const keyBytes = new Map<string, Uint8Array>();
const role = async () => {
  const { signer, bytes } = await generateKeypairBytes();
  keyBytes.set(signer.address, bytes);
  return clientForSigner(signer, LOCAL);
};
const deployer = await role();
const ledger = mkdtempSync(join(tmpdir(), 'tessera-doors-'));
const keydir = mkdtempSync(join(tmpdir(), 'tessera-keys-'));
const children: ChildProcess[] = [];
const validator = spawn(
  'solana-test-validator',
  ['--reset', '--quiet', '--ledger', ledger, '--rpc-port', String(PORT), '--faucet-port', String(PORT + 1001), '--upgradeable-program', TESSERA_PROGRAM_ADDRESS, so, deployer.identity.address],
  { stdio: 'ignore' },
);
children.push(validator);

async function waitHttp(url: string, tries = 120): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetch(url, url.endsWith(String(PORT)) ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' } : {});
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`${url} did not come up`);
}

try {
  await waitHttp(LOCAL.rpcUrl);
  const [arbiter, treasury, merchant, buyer, poor, stranger, merchant2] = await Promise.all([role(), role(), role(), role(), role(), role(), role()]);
  const all = [deployer, arbiter, merchant, buyer, poor, stranger, merchant2];
  for (const c of all) await deployer.rpc.requestAirdrop(c.identity.address, lamports(10_000_000_000n)).send();
  await sleep(2000);
  const mintSigner = (await generateKeypairBytes()).signer;
  const space = BigInt(getMintSize());
  await deployer.sendTransaction([
    getCreateAccountInstruction({ payer: deployer.identity, newAccount: mintSigner, lamports: await deployer.rpc.getMinimumBalanceForRentExemption(space).send(), space, programAddress: TOKEN_PROGRAM_ADDRESS }),
    getInitializeMint2Instruction({ mint: mintSigner.address, decimals: 6, mintAuthority: deployer.identity.address, freezeAuthority: null }),
  ]);
  const mint = mintSigner.address;
  const tok = tokenHelpers(deployer, mint);
  for (const c of [buyer, poor, merchant, merchant2]) await deployer.sendTransaction([await tok.ensureAtaIx(c.identity.address)]);
  await deployer.sendTransaction([getMintToInstruction({ mint, token: await tok.ata(buyer.identity.address), mintAuthority: deployer.identity, amount: 20n * USDC })]);
  await deployer.sendTransaction([
    await getInitializeInstructionAsync({ authority: deployer.identity, mint, arbiter: arbiter.identity.address, treasury: treasury.identity.address, programData: await programDataAddress(), feeBps: 100, params: PARAMS }),
  ]);
  log.ok('local validator, mint and config ready');

  // ------------------------------------------------------------- the API
  process.env.TESSERA_RPC_URLS = LOCAL.rpcUrl;
  process.env.TESSERA_READS_PER_MIN = '10000';
  process.env.TESSERA_BUILDS_PER_MIN = '10000';
  process.env.TESSERA_SUBMITS_PER_MIN = '10000';
  const { createApp } = await import('../apps/api/src/server.js');
  const apiServer = createApp().listen(0);
  await new Promise((r) => apiServer.once('listening', r));
  const API = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}`;

  type R = { http: number; body: Record<string, any> };
  async function api(method: 'GET' | 'POST', path: string, body?: unknown, base = API): Promise<R> {
    const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { http: res.status, body: (await res.json()) as Record<string, any> };
  }
  /** What an agent's wallet does with a returned transaction: sign it and send it. */
  async function signSend(r: R, kp: KeyPairSigner): Promise<R> {
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(r.body.transaction));
    const signed = await partiallySignTransaction([kp.keyPair], tx);
    return api('POST', '/v1/tx/submit', { transaction: getBase64EncodedWireTransaction(signed) });
  }
  const sent = (r: R) => r.http === 200 && r.body.status === 'ok' && r.body.confirmed === true;
  const M = merchant.identity.address;
  const B = buyer.identity.address;
  let order1 = '' as Address;

  log.step('HTTP API: answers, never an empty 200');
  const index = await api('GET', '/v1');
  ok('GET /v1 lists the tools and says it holds no keys', index.body.status === 'ok' && Object.keys(index.body.tools).length === 9 && /unsigned/.test(index.body.custody));
  const oas = await api('GET', '/v1/openapi.json');
  const openSchema = oas.body.paths['/v1/escrow/open'].post.requestBody.content['application/json'].schema;
  ok('the OpenAPI document puts allowed values in enums', JSON.stringify(openSchema.properties.role.enum) === '["buyer","merchant"]' && oas.body.components.schemas.Reason.enum.includes('merchant_penalized'));
  const unknown = await api('GET', `/v1/score/${stranger.identity.address}`);
  ok('an unknown wallet is status unknown_wallet, not an empty 200', unknown.http === 200 && unknown.body.status === 'unknown_wallet' && unknown.body.known === false && unknown.body.score === 0, unknown.body);
  const um = await api('POST', '/v1/check', { merchant: M, buyer: B, amount: '0.50' });
  ok('an unknown merchant is status unknown_merchant: escrow with the longest hold', um.body.status === 'unknown_merchant' && um.body.decision === 'escrow' && um.body.reason === 'merchant_unknown' && um.body.holdSecs === 8, um.body);
  const badAmount = await api('POST', '/v1/check', { merchant: M, amount: 0.5 });
  ok('a numeric amount is refused with a message saying what is accepted', badAmount.http === 400 && badAmount.body.status === 'invalid_request' && /decimal string/.test(badAmount.body.message));
  const badRole = await api('POST', '/v1/escrow/open', { role: 'seller', merchant: M, buyer: B, amount: '1' });
  ok('an invented role is refused, listing the allowed values', badRole.http === 400 && /buyer, merchant/.test(badRole.body.message));
  const badAddr = await api('GET', '/v1/score/not-a-wallet');
  ok('a malformed address is refused', badAddr.http === 400 && badAddr.body.status === 'invalid_request');
  ok('self-dealing is blocked', (await api('POST', '/v1/check', { merchant: M, buyer: M, amount: '1' })).body.reason === 'self_dealing');
  ok('below the minimum order is blocked', (await api('POST', '/v1/check', { merchant: M, buyer: B, amount: '0.0001' })).body.reason === 'amount_below_minimum');
  const broke = await api('POST', '/v1/check', { merchant: M, buyer: poor.identity.address, amount: '1' });
  ok('a buyer without the money is blocked', broke.body.decision === 'block' && broke.body.reason === 'insufficient_funds');
  ok('an unknown endpoint says so', (await api('GET', '/v1/nope')).body.status === 'invalid_request');

  log.step('HTTP API: a purchase, both wallets signing their own transactions');
  const request = { sku: 'telemetry', input: {} };
  const opened = await api('POST', '/v1/escrow/open', { role: 'merchant', merchant: M, buyer: B, amount: '0.50', request });
  ok('merchant: open_escrow returns an unsigned, simulated open_order', opened.body.status === 'ok' && opened.body.action === 'open_order' && opened.body.simulation.ok && JSON.stringify(opened.body.signers) === JSON.stringify([M]), opened.body);
  ok('its payTo is the order, not the merchant', opened.body.payTo === opened.body.order && opened.body.payTo !== M);
  ok('merchant signs and sends', sent(await signSend(opened, merchant.identity)));
  order1 = opened.body.order;
  const known = await api('POST', '/v1/check', { merchant: M, buyer: B, amount: '0.50' });
  ok('a known New merchant: status ok, escrow, its tier sets the hold', known.body.status === 'ok' && known.body.decision === 'escrow' && known.body.reason === 'merchant_tier' && known.body.holdSecs === 8, known.body);
  const wrongAmount = await api('POST', '/v1/escrow/open', { role: 'buyer', merchant: M, buyer: B, amount: '5', order: order1 });
  ok('buyer: a quote for a different amount fails verification, naming the field', wrongAmount.http === 422 && wrongAmount.body.status === 'verification_failed' && wrongAmount.body.field === 'amount', wrongAmount.body);
  const wrongBuyer = await api('POST', '/v1/escrow/open', { role: 'buyer', merchant: M, buyer: poor.identity.address, amount: '0.50', order: order1 });
  ok('buyer: an order opened for someone else fails verification', wrongBuyer.body.status === 'verification_failed' && wrongBuyer.body.field === 'buyer');
  const wrongRequest = await api('POST', '/v1/escrow/open', { role: 'buyer', merchant: M, buyer: B, amount: '0.50', order: order1, request: { sku: 'other' } });
  ok('buyer: an order for a different request fails verification', wrongRequest.body.field === 'requestHash');
  const ghost = await api('POST', '/v1/escrow/open', { role: 'buyer', merchant: M, buyer: B, amount: '0.50', orderId: toHex(crypto.getRandomValues(new Uint8Array(32))) });
  ok('buyer: an order that does not exist is unknown_order (404)', ghost.http === 404 && ghost.body.status === 'unknown_order');
  const fund = await api('POST', '/v1/escrow/open', { role: 'buyer', merchant: M, buyer: B, amount: '0.50', order: order1, request });
  ok('buyer: a verified order gets a fund_escrow transaction paying only the vault', fund.body.action === 'fund_escrow' && fund.body.transfers.length === 1 && fund.body.transfers[0].to === fund.body.vault, fund.body);
  ok('buyer signs and sends', sent(await signSend(fund, buyer.identity)));
  ok('the order is Funded', (await api('GET', `/v1/escrow/${order1}`)).body.state === 'Funded');
  ok('reporting satisfied before any delivery is refused', (await api('POST', '/v1/escrow/report', { order: order1, reporter: B, outcome: 'satisfied' })).body.status === 'wrong_state');
  ok('a stranger cannot deliver', (await api('POST', '/v1/escrow/deliver', { order: order1, merchant: stranger.identity.address, deliverable: { x: 1 } })).body.status === 'not_a_party');
  const deliverable = { slot: 1234, ok: true };
  const delivered = await api('POST', '/v1/escrow/deliver', { order: order1, merchant: M, deliverable });
  ok('merchant: deliver_order commits the hash', delivered.body.action === 'deliver' && sent(await signSend(delivered, merchant.identity)), delivered.body);
  const after = await api('GET', `/v1/escrow/${order1}`);
  ok('get_escrow shows the hash of what was delivered', after.body.state === 'Delivered' && after.body.deliveryHash === toHex(await hashJson(deliverable)));
  const early = await api('POST', '/v1/escrow/release', { order: order1, signer: stranger.identity.address });
  ok('a stranger cannot release during the hold', early.body.status === 'hold_not_elapsed' && early.body.secondsLeft > 0, early.body);
  const happy = await api('POST', '/v1/escrow/report', { order: order1, reporter: B, outcome: 'satisfied', comment: 'Exactly what I asked for.' });
  ok('buyer: satisfied releases and reviews in one transaction', happy.body.action === 'release_and_review' && happy.body.payouts.toMerchant.usdc === '0.495', happy.body);
  ok('buyer signs and sends', sent(await signSend(happy, buyer.identity)));
  const mScore = await api('GET', `/v1/score/${M}`);
  ok('the merchant now has a credit file with the order', mScore.body.status === 'ok' && mScore.body.asMerchant.orders === 1, mScore.body);
  const back = await api('POST', '/v1/escrow/report', { order: order1, reporter: M, outcome: 'satisfied' });
  ok('merchant: its review counts because the buyer reviewed first', back.body.action === 'review' && back.body.reviewWeighs === 'full' && sent(await signSend(back, merchant.identity)), back.body);
  ok('reporting twice is already_reported', (await api('POST', '/v1/escrow/report', { order: order1, reporter: B, outcome: 'satisfied' })).body.status === 'already_reported');

  log.step('HTTP API: timeouts');
  const o2 = await api('POST', '/v1/escrow/open', { role: 'merchant', merchant: M, buyer: B, amount: '0.30' });
  await signSend(o2, merchant.identity);
  await signSend(await api('POST', '/v1/escrow/open', { role: 'buyer', merchant: M, buyer: B, amount: '0.30', order: o2.body.order }), buyer.identity);
  const tooSoon = await api('POST', '/v1/escrow/reclaim', { order: o2.body.order, signer: B });
  ok('reclaiming before the delivery deadline is not_yet, with availableAt', tooSoon.body.status === 'not_yet' && typeof tooSoon.body.availableAt === 'number', tooSoon.body);
  await waitForChainTime(deployer, BigInt(tooSoon.body.availableAt));
  const refund = await api('POST', '/v1/escrow/reclaim', { order: o2.body.order, signer: B });
  ok('after the deadline the buyer gets everything back', refund.body.action === 'refund_missed_delivery' && refund.body.payouts.toBuyer.usdc === '0.30' && sent(await signSend(refund, buyer.identity)), refund.body);
  ok('and the merchant carries a penalty', (await api('GET', `/v1/score/${M}`)).body.penaltyBps > 0);

  const o3 = await api('POST', '/v1/escrow/open', { role: 'merchant', merchant: M, buyer: B, amount: '0.10' });
  await signSend(o3, merchant.identity);
  const cancel = await api('POST', '/v1/escrow/reclaim', { order: o3.body.order, signer: B });
  ok('an unpaid quote: the buyer cancels it', cancel.body.action === 'cancel_unpaid' && sent(await signSend(cancel, buyer.identity)), cancel.body);
  ok('and the order account is gone', (await api('GET', `/v1/escrow/${o3.body.order}`)).body.status === 'unknown_order');

  log.step('HTTP API: a dispute the arbiter never answers');
  const o4 = await api('POST', '/v1/escrow/open', { role: 'merchant', merchant: M, buyer: B, amount: '0.40' });
  await signSend(o4, merchant.identity);
  await signSend(await api('POST', '/v1/escrow/open', { role: 'buyer', merchant: M, buyer: B, amount: '0.40', order: o4.body.order }), buyer.identity);
  await signSend(await api('POST', '/v1/escrow/deliver', { order: o4.body.order, merchant: M, deliverable: { junk: true } }), merchant.identity);
  const unhappy = await api('POST', '/v1/escrow/report', { order: o4.body.order, reporter: B, outcome: 'unsatisfied', comment: 'Junk.' });
  ok('buyer: unsatisfied during the hold opens a dispute', unhappy.body.action === 'dispute' && sent(await signSend(unhappy, buyer.identity)), unhappy.body);
  const wait = await api('POST', '/v1/escrow/reclaim', { order: o4.body.order, signer: stranger.identity.address });
  ok('before the arbiter deadline: not_yet', wait.body.status === 'not_yet', wait.body);
  await waitForChainTime(deployer, BigInt(wait.body.availableAt));
  const split = await api('POST', '/v1/escrow/reclaim', { order: o4.body.order, signer: stranger.identity.address });
  ok('after it, anyone splits the vault evenly', split.body.action === 'split_silent_dispute' && split.body.payouts.toBuyer.usdc === '0.20' && sent(await signSend(split, stranger.identity)), split.body);
  ok('the order is Resolved', (await api('GET', `/v1/escrow/${o4.body.order}`)).body.state === 'Resolved');

  log.step('HTTP API: a merchant that lost a dispute is blocked');
  const o5 = await api('POST', '/v1/escrow/open', { role: 'merchant', merchant: M, buyer: B, amount: '0.20' });
  await signSend(o5, merchant.identity);
  await signSend(await api('POST', '/v1/escrow/open', { role: 'buyer', merchant: M, buyer: B, amount: '0.20', order: o5.body.order }), buyer.identity);
  await signSend(await api('POST', '/v1/escrow/deliver', { order: o5.body.order, merchant: M, deliverable: { junk: true } }), merchant.identity);
  await signSend(await api('POST', '/v1/escrow/report', { order: o5.body.order, reporter: B, outcome: 'unsatisfied' }), buyer.identity);
  const od = (await fetchOrder(deployer.rpc, o5.body.order)).data;
  await arbiter.sendTransaction([getResolveDisputeInstruction({ ...(await settleAccounts(o5.body.order, od, treasury.identity.address)), authority: arbiter.identity, merchantBps: 0 })]);
  const blocked = await api('POST', '/v1/check', { merchant: M, buyer: B, amount: '0.20' });
  ok('check_payment now says block: merchant_penalized', blocked.body.decision === 'block' && blocked.body.reason === 'merchant_penalized', blocked.body);

  // ------------------------------------------------------------- the MCP
  log.step('MCP over Streamable HTTP');
  const mcpPort = 19940;
  const mcp = spawn(process.execPath, [tsx, resolve(REPO_ROOT, 'apps/mcp/src/server.ts')], {
    env: { ...process.env, TESSERA_API_URL: API, PORT: String(mcpPort) },
    stdio: 'ignore',
  });
  children.push(mcp);
  await waitHttp(`http://127.0.0.1:${mcpPort}/health`);
  const client = new Client({ name: 'tessera-test', version: '0.0.1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`)));
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  ok('nine tools', names.length === 9 && names.includes('check_payment') && names.includes('reclaim_after_timeout'), names);
  const props = (n: string) => (tools.find((t) => t.name === n)!.inputSchema as { properties: Record<string, { enum?: string[] }> }).properties;
  ok('role and outcome are enums in the schemas', JSON.stringify(props('open_escrow').role!.enum) === '["buyer","merchant"]' && JSON.stringify(props('report_outcome').outcome!.enum) === '["satisfied","unsatisfied","not_delivered"]');
  ok('the server tells the model the rule', /before any paid tool call/i.test(client.getInstructions() ?? ''));
  const viaMcp = await client.callTool({ name: 'check_payment', arguments: { merchant: M, buyer: B, amount: '0.20' } });
  const sc = viaMcp.structuredContent as Record<string, unknown>;
  ok('check_payment over MCP gives the same answer as the API', sc.decision === 'block' && sc.reason === 'merchant_penalized' && !viaMcp.isError, sc);
  const unk = await client.callTool({ name: 'get_score', arguments: { wallet: poor.identity.address } });
  ok('get_score over MCP: unknown_wallet, not an error and not empty', (unk.structuredContent as Record<string, unknown>).status === 'unknown_wallet' && !unk.isError);
  let refused = false;
  try {
    const r = await client.callTool({ name: 'open_escrow', arguments: { role: 'seller', merchant: M, buyer: B, amount: '1' } });
    refused = !!r.isError;
  } catch {
    refused = true;
  }
  ok('an invented role is refused by the schema before the API is called', refused);
  const conflict = await client.callTool({ name: 'release_escrow', arguments: { order: o2.body.order, signer: B } });
  ok('an API refusal comes back as a tool error with its status', conflict.isError === true && (conflict.structuredContent as Record<string, unknown>).status === 'wrong_state');
  await client.close();

  // ------------------------------------------------------------- the skill
  log.step('SKILL.md');
  const skill = readFileSync(resolve(REPO_ROOT, 'skills/tessera/SKILL.md'), 'utf8');
  ok('front matter names the skill and says when to use it', /^---\nname: tessera\ndescription: .*paid tool call/s.test(skill));
  ok('the main rule is there', /Before any paid tool call or x402 payment, call `check_payment`/.test(skill));
  ok('every MCP tool is named in it', names.every((n) => skill.includes(n)), names.filter((n) => !skill.includes(n)));

  // ------------------------------------------------------------- the CLI
  log.step('CLI');
  // Asynchronous on purpose: the API answering the CLI runs in this same process.
  const cli = (args: string[], api = API) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((done) => {
      const p = spawn(process.execPath, [tsx, resolve(REPO_ROOT, 'apps/cli/src/cli.ts'), ...args, '--api', api]);
      let stdout = '';
      let stderr = '';
      p.stdout.on('data', (d) => (stdout += d));
      p.stderr.on('data', (d) => (stderr += d));
      p.on('close', (status) => done({ status, stdout, stderr }));
    });
  const keyfile = async (c: { identity: KeyPairSigner }, name: string) => {
    const path = join(keydir, `${name}.json`);
    writeFileSync(path, JSON.stringify(Array.from(keyBytes.get(c.identity.address)!)));
    return path;
  };
  const scoreOut = await cli(['score', M]);
  ok('tessera score prints the credit file', scoreOut.status === 0 && /as merchant: /.test(scoreOut.stdout), scoreOut.stderr || scoreOut.stdout);
  const checkOut = await cli(['check', M, '0.20', '--buyer', B]);
  ok('tessera check exits 3 on block', checkOut.status === 3 && /^BLOCK/.test(checkOut.stdout), checkOut.stdout);
  const m2key = await keyfile(merchant2, 'merchant2');
  const buyerKey = await keyfile(buyer, 'buyer');
  const openOut = await cli(['open', 'merchant', '--buyer', B, '--amount', '0.05', '--keypair', m2key, '--send']);
  const order6 = /order (\S+)/.exec(openOut.stdout)?.[1];
  ok('tessera open merchant signs locally and sends', openOut.status === 0 && /confirmed:/.test(openOut.stdout) && !!order6, openOut.stdout + openOut.stderr);
  const fundOut = await cli(['open', 'buyer', '--merchant', merchant2.identity.address, '--amount', '0.05', '--order', order6!, '--keypair', buyerKey, '--send']);
  ok('tessera open buyer verifies, signs locally and sends', fundOut.status === 0 && /confirmed:/.test(fundOut.stdout), fundOut.stdout + fundOut.stderr);
  ok('the order is Funded', (await api('GET', `/v1/escrow/${order6}`)).body.state === 'Funded');

  // A lying API: it hands back a "fund_escrow" that pays the attacker instead.
  const thief = (await generateKeypairBytes()).signer.address;
  const o7 = await api('POST', '/v1/escrow/open', { role: 'merchant', merchant: merchant2.identity.address, buyer: B, amount: '0.05' });
  await signSend(o7, merchant2.identity);
  const { value: latest } = await deployer.rpc.getLatestBlockhash().send();
  const evilTx = getBase64EncodedWireTransaction(
    compileTransaction(
      pipe(
        createTransactionMessage({ version: 0 }),
        (m) => setTransactionMessageFeePayer(B, m),
        (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
        (m) =>
          appendTransactionMessageInstructions(
            [getTransferCheckedInstruction({ source: fund.body.transfers[0].from, mint, destination: thief, authority: createNoopSigner(B), amount: 50_000n, decimals: 6 })],
            m,
          ),
      ),
    ),
  );
  const liar = express();
  liar.use(express.json());
  liar.post('/v1/escrow/open', (_req, res) => {
    res.json({ status: 'ok', action: 'fund_escrow', transaction: evilTx, signers: [B], orderId: o7.body.orderId, order: o7.body.order, vault: o7.body.vault, simulation: { ok: true } });
  });
  const liarServer = liar.listen(0);
  await new Promise((r) => liarServer.once('listening', r));
  const liarUrl = `http://127.0.0.1:${(liarServer.address() as AddressInfo).port}`;
  const before = await tok.balance(B);
  const tricked = await cli(['open', 'buyer', '--merchant', merchant2.identity.address, '--amount', '0.05', '--order', o7.body.order, '--keypair', buyerKey, '--send'], liarUrl);
  ok('the CLI refuses to sign a transfer that does not go to the escrow vault', tricked.status === 1 && /refusing to sign/.test(tricked.stderr) && (await tok.balance(B)) === before, tricked.stderr + tricked.stdout);
  liarServer.close();
  apiServer.close();
} catch (e) {
  failures += 1;
  console.log(`\n   FAIL stopped on an unexpected error: ${(e as Error).stack ?? e}`);
} finally {
  for (const c of children) c.kill('SIGKILL');
  await sleep(300);
  rmSync(ledger, { recursive: true, force: true });
  rmSync(keydir, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${checks - failures}/${checks} checks`);
process.exit(failures === 0 ? 0 : 1);
