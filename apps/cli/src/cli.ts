/**
 * tessera: the Tessera API from a terminal. Every command is one call to the
 * HTTP API. With --keypair the CLI signs the returned transaction locally,
 * after checking it only touches the programs it should and only pays into
 * the order's own escrow vault; the key never leaves this machine.
 *
 *   npm run tessera -- check <merchant> 0.25 --buyer <wallet>
 *   npm run tessera -- help
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import {
  createKeyPairSignerFromBytes,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  isFullySignedTransaction,
  partiallySignTransaction,
  type Address,
  type KeyPairSigner,
} from '@solana/kit';
import { COMPUTE_BUDGET_PROGRAM_ADDRESS } from '@solana-program/compute-budget';
import { ASSOCIATED_TOKEN_PROGRAM_ADDRESS, identifyTokenInstruction, TOKEN_PROGRAM_ADDRESS, TokenInstruction } from '@solana-program/token';
import { fromHex, orderAddresses, TESSERA_PROGRAM_ADDRESS } from '@tessera/sdk';
import { OUTCOMES, ROLES, TOOLS, type ToolName } from '@tessera/api/contract';

const HELP = `tessera: credit checks and non-custodial escrow for agent payments on Solana

Before payment
  find [need words…] [--buyer W] [--sort best|fastest|cheapest] [--max-price A] [--amount A] [--limit N]
                                                 the best merchants for a need, ranked by on-chain record
  score <wallet>                                 a wallet's credit file
  check <merchant> <amount> [--buyer W] [--min-hold S]
                                                 instant, escrow or block, and why
During payment
  open merchant --buyer W --amount A [--merchant W] [--request JSON] [--order-id HEX] [--min-hold S]
  open buyer --merchant W --amount A --order O [--buyer W] [--request JSON] [--min-hold S]
  deliver <order> (--deliverable JSON | --delivery-hash HEX) [--merchant W]
  escrow <order>                                 state, deadlines, what each side can do next
After payment
  release <order> [--signer W]
  reclaim <order> [--signer W]                   missed delivery, unpaid quote, silent arbiter
  report <order> --outcome ${OUTCOMES.join('|')} [--rating 1-5] [--comment TEXT] [--reporter W]
  submit <signed-base64>

Options
  --api URL        Tessera API (default $TESSERA_API_URL or http://127.0.0.1:4030)
  --keypair PATH   sign locally with this Solana keypair file (~ allowed); its address
                   fills in --buyer, --merchant, --signer or --reporter when omitted
  --send           with --keypair: send the signed transaction through the API
  --json           print the API's JSON as it is

Exit codes: 0 ok, 1 refused or failed, 3 check said block.`;

type Flags = Record<string, string | boolean | undefined>;

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    api: { type: 'string' },
    keypair: { type: 'string' },
    send: { type: 'boolean' },
    json: { type: 'boolean' },
    buyer: { type: 'string' },
    merchant: { type: 'string' },
    signer: { type: 'string' },
    reporter: { type: 'string' },
    amount: { type: 'string' },
    order: { type: 'string' },
    'order-id': { type: 'string' },
    request: { type: 'string' },
    'request-hash': { type: 'string' },
    'min-hold': { type: 'string' },
    deliverable: { type: 'string' },
    'delivery-hash': { type: 'string' },
    outcome: { type: 'string' },
    rating: { type: 'string' },
    comment: { type: 'string' },
    sort: { type: 'string' },
    'max-price': { type: 'string' },
    limit: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
}) as { values: Flags; positionals: string[] };

const API = String(flags.api ?? process.env.TESSERA_API_URL ?? 'http://127.0.0.1:4030').replace(/\/$/, '');

function die(message: string): never {
  console.error(`tessera: ${message}`);
  process.exit(1);
}

const json = (s: string | undefined, what: string): unknown => {
  if (s === undefined) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return die(`${what} must be JSON`);
  }
};
const int = (s: string | undefined, what: string): number | undefined => {
  if (s === undefined) return undefined;
  const n = Number(s);
  if (!Number.isInteger(n)) die(`${what} must be an integer`);
  return n;
};

async function call(tool: ToolName, args: Record<string, unknown>): Promise<{ http: number; body: Record<string, unknown> }> {
  const spec = TOOLS[tool];
  const rest = Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
  const path = spec.path.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = String(rest[k] ?? '');
    delete rest[k];
    return encodeURIComponent(v);
  });
  let res: Response;
  try {
    const qs = spec.method === 'GET' && Object.keys(rest).length ? `?${new URLSearchParams(Object.entries(rest).map(([k, v]) => [k, String(v)])).toString()}` : '';
    res = await fetch(`${API}${path}${qs}`, {
      method: spec.method,
      headers: { 'content-type': 'application/json' },
      ...(spec.method === 'POST' ? { body: JSON.stringify(rest) } : {}),
    });
  } catch (e) {
    return die(`the API at ${API} is unreachable (${(e as Error).message}). Start it with: npm run api`);
  }
  const body = (await res.json().catch(() => ({ status: 'internal_error', message: `HTTP ${res.status} without JSON` }))) as Record<string, unknown>;
  return { http: res.status, body };
}

// ---------------------------------------------------------------- signing

async function loadKeypair(path: string): Promise<KeyPairSigner> {
  const full = path.replace(/^~(?=\/|$)/, homedir());
  let bytes: number[];
  try {
    bytes = JSON.parse(readFileSync(full, 'utf8')) as number[];
  } catch (e) {
    return die(`cannot read keypair ${full}: ${(e as Error).message}`);
  }
  return createKeyPairSignerFromBytes(Uint8Array.from(bytes));
}

const ALLOWED_PROGRAMS = new Set<string>([TESSERA_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS, COMPUTE_BUDGET_PROGRAM_ADDRESS]);

/**
 * Refuse to sign anything but what the API said it built: only the Tessera,
 * SPL Token, associated-token and compute-budget programs, no lookup tables,
 * and the only token instruction a transfer into the escrow vault that this
 * machine derives itself from the order id.
 */
async function guard(b64: string, reply: Record<string, unknown>, me: Address): Promise<void> {
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(b64));
  const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  if (msg.version !== 0 && msg.version !== 'legacy') return die('refusing to sign: only legacy and version-0 transactions can be checked');
  if ('addressTableLookups' in msg && (msg.addressTableLookups?.length ?? 0) > 0) die('refusing to sign: the transaction uses address lookup tables');
  const keys = msg.staticAccounts;
  if (keys[0] !== me) die(`refusing to sign: the fee payer is ${keys[0]}, not your wallet ${me}`);
  for (const ix of msg.instructions) {
    const program = keys[ix.programAddressIndex]!;
    if (!ALLOWED_PROGRAMS.has(program)) die(`refusing to sign: the transaction calls ${program}`);
    if (program !== TOKEN_PROGRAM_ADDRESS) continue;
    if (identifyTokenInstruction(ix.data ?? new Uint8Array()) !== TokenInstruction.TransferChecked) die('refusing to sign: a token instruction other than a transfer');
    const [, mintIdx, destIdx] = ix.accountIndices ?? [];
    const mint = keys[mintIdx!]!;
    const destination = keys[destIdx!]!;
    if (typeof reply.orderId !== 'string') die('refusing to sign: a token transfer without an order id to check it against');
    const { vault } = await orderAddresses(fromHex(reply.orderId), mint);
    if (destination !== vault) die(`refusing to sign: the transfer goes to ${destination}, not the escrow vault ${vault}`);
  }
}

async function signAndMaybeSend(reply: Record<string, unknown>, kp: KeyPairSigner): Promise<void> {
  const b64 = String(reply.transaction);
  await guard(b64, reply, kp.address);
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(b64));
  const signed = await partiallySignTransaction([kp.keyPair], tx);
  if (!isFullySignedTransaction(signed)) {
    const missing = Object.entries(signed.signatures).filter(([, s]) => !s).map(([a]) => a);
    console.log(`signed by you; still needs: ${missing.join(', ')}`);
  }
  const wire = getBase64EncodedWireTransaction(signed);
  if (!flags.send) {
    console.log(flags.json ? JSON.stringify({ signed: wire }) : `signed transaction (send with --send or any RPC):\n${wire}`);
    return;
  }
  const out = await call('submit_transaction', { transaction: wire });
  show('submit_transaction', out);
  if (out.http >= 400) process.exit(1);
}

// ---------------------------------------------------------------- output

const short = (a: unknown) => (typeof a === 'string' && a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : String(a));
const usdc = (m: unknown) => (m && typeof m === 'object' && 'usdc' in m ? `${(m as { usdc: string }).usdc} USDC` : '');

function party(label: string, s: Record<string, unknown> | null | undefined): string {
  if (!s) return '';
  const name = s.name ? ` ${s.name}` : '';
  const stars = typeof s.stars === 'number' ? `  ★${s.stars.toFixed(2)}` : '';
  return `${label.padEnd(9)}${short(s.wallet)}${name}  ${s.tier} ${s.score}${stars}${s.known === false ? '  (no credit file)' : ''}`;
}

function show(tool: ToolName, { http, body }: { http: number; body: Record<string, unknown> }): void {
  if (flags.json) return void console.log(JSON.stringify(body, null, 2));
  const status = String(body.status);
  if (http >= 400) {
    console.log(`${status}: ${body.message ?? ''}`);
    for (const k of ['field', 'state', 'availableAt', 'releaseAt', 'missing'] as const) if (body[k] !== undefined) console.log(`  ${k}: ${JSON.stringify(body[k])}`);
    const sim = body.simulation as { logs?: string[] } | undefined;
    for (const l of sim?.logs ?? (body.logs as string[] | undefined) ?? []) console.log(`  ${l}`);
    return;
  }
  if (tool === 'find_merchants') {
    if (status === 'no_match') return void console.log(`no_match: ${body.message}`);
    console.log(`${body.count} found · sorted ${body.sort}: ${body.basis}`);
    for (const r of (body.ranked as Record<string, any>[]) ?? []) {
      const svc = r.service ? `  ${r.service.id} ${r.service.price ? usdc(r.service.price) : 'price ?'}` : '';
      const time = r.expectedSecs === null ? 'cannot pay' : `~${r.expectedSecs} s to settled`;
      console.log(`${String(r.rank).padStart(2)}. ${r.merchant}  ${r.name ?? ''}  ${r.tier} ${r.score} ★${Number(r.stars).toFixed(2)} (${r.reviews} reviews, ${r.sales} sales)`);
      console.log(`    ${String(r.decision).toUpperCase()} ${time}${svc}`);
      for (const rv of r.topReviews ?? []) console.log(`    "${rv.text}" ★${rv.stars}`);
    }
    console.log(String(body.next));
    return;
  }
  if (tool === 'get_score') {
    console.log(party('wallet', body));
    if (body.known === false) console.log(String(body.message));
    else {
      const m = body.asMerchant as Record<string, unknown>;
      const b = body.asBuyer as Record<string, unknown>;
      console.log(`hold at this tier ${body.holdSecs} s · penalty ${Number(body.penaltyBps) / 100}% · ${body.reviewsReceived} reviews`);
      console.log(`as merchant: ${m.orders} orders, ${usdc(m.volume)}, ${m.disputesLost} disputes lost, ${m.missedDeliveries} missed`);
      console.log(`as buyer:    ${b.orders} orders, ${usdc(b.volume)}, ${b.disputesLost} disputes lost`);
    }
    return;
  }
  if (tool === 'check_payment') {
    console.log(`${String(body.decision).toUpperCase()}  ${usdc(body.amount)}  hold ${body.holdSecs} s  (${body.reason})${status !== 'ok' ? `  [${status}]` : ''}`);
    console.log(String(body.message));
    console.log(party('merchant', body.merchant as Record<string, unknown>));
    if (body.buyer) console.log(party('buyer', body.buyer as Record<string, unknown>));
    return;
  }
  if (tool === 'get_escrow') {
    console.log(`${body.order}  ${body.state}  ${usdc(body.amount)}  hold ${body.holdSecs} s${body.instant ? ' (instant)' : ''}`);
    console.log(`buyer ${short(body.buyer)}  merchant ${short(body.merchant)}  vault holds ${usdc(body.vaultBalance)}`);
    for (const n of (body.next as { who: string; tool: string; what: string; from?: number; until?: number }[]) ?? []) {
      const when = n.from ? ` from ${new Date(n.from * 1000).toISOString()}` : n.until ? ` until ${new Date(n.until * 1000).toISOString()}` : '';
      console.log(`  next: ${n.who} → ${n.tool}: ${n.what}${when}`);
    }
    return;
  }
  if (tool === 'submit_transaction') {
    console.log(`${body.confirmed ? 'confirmed' : 'sent'}: ${body.signature}\n${body.explorer}`);
    return;
  }
  // A built transaction.
  const sim = body.simulation as { ok: boolean; unitsConsumed?: number | null };
  console.log(`${body.action}  ·  signers ${(body.signers as string[]).map(short).join(', ')}  ·  simulation ${sim.ok ? `ok (${sim.unitsConsumed ?? '?'} CU)` : 'failed'}`);
  if (body.order) console.log(`order ${body.order}${body.vault ? `  vault ${body.vault}` : ''}`);
  for (const t of (body.transfers as { from: string; to: string; amount: unknown }[]) ?? []) console.log(`transfer ${usdc(t.amount)} ${short(t.from)} → ${short(t.to)}`);
  const pay = body.payouts as Record<string, unknown> | undefined;
  if (pay) console.log(`payouts: merchant ${usdc(pay.toMerchant)}, fee ${usdc(pay.protocolFee)}, buyer ${usdc(pay.toBuyer)}`);
  if (body.reviewWeighs) console.log(`review weighs ${body.reviewWeighs}${body.because ? `: ${body.because}` : ''}`);
  for (const k of ['note', 'next'] as const) if (body[k]) console.log(String(body[k]));
  if (!flags.keypair) console.log(`unsigned transaction:\n${body.transaction}`);
}

// ---------------------------------------------------------------- commands

const [cmd, a1, a2] = positionals;
if (!cmd || flags.help || cmd === 'help') {
  console.log(HELP);
  process.exit(0);
}

const kp = flags.keypair ? await loadKeypair(String(flags.keypair)) : undefined;
const me = (flag: string): string | undefined => (flags[flag] as string | undefined) ?? kp?.address;
const need = (v: unknown, what: string) => (v === undefined || v === '' ? die(`${what} is required (see: tessera help)`) : v);

let tool: ToolName;
let args: Record<string, unknown>;
switch (cmd) {
  case 'find':
    tool = 'find_merchants';
    args = {
      need: positionals.slice(1).join(' ') || undefined,
      buyer: me('buyer'),
      sort: flags.sort,
      maxPrice: flags['max-price'],
      amount: flags.amount,
      limit: int(flags.limit as string, '--limit'),
    };
    break;
  case 'score':
    tool = 'get_score';
    args = { wallet: need(a1, '<wallet>') };
    break;
  case 'check':
    tool = 'check_payment';
    args = { merchant: need(a1, '<merchant>'), amount: need(a2 ?? flags.amount, '<amount>'), buyer: me('buyer'), minHoldSecs: int(flags['min-hold'] as string, '--min-hold') };
    break;
  case 'open': {
    if (!ROLES.includes(a1 as (typeof ROLES)[number])) die(`open needs a role: ${ROLES.join(' or ')}`);
    tool = 'open_escrow';
    const role = a1 as (typeof ROLES)[number];
    args = {
      role,
      merchant: need(role === 'merchant' ? me('merchant') : flags.merchant, '--merchant'),
      buyer: need(role === 'buyer' ? me('buyer') : flags.buyer, '--buyer'),
      amount: need(flags.amount, '--amount'),
      order: flags.order,
      orderId: flags['order-id'],
      request: json(flags.request as string, '--request'),
      requestHash: flags['request-hash'],
      minHoldSecs: int(flags['min-hold'] as string, '--min-hold'),
    };
    if (role === 'buyer' && !args.order && !args.orderId) die('open buyer needs --order (the payTo the merchant quoted) or --order-id');
    break;
  }
  case 'deliver':
    tool = 'deliver_order';
    args = { order: need(a1, '<order>'), merchant: need(me('merchant'), '--merchant'), deliverable: json(flags.deliverable as string, '--deliverable'), deliveryHash: flags['delivery-hash'] };
    break;
  case 'escrow':
    tool = 'get_escrow';
    args = { order: need(a1, '<order>') };
    break;
  case 'release':
    tool = 'release_escrow';
    args = { order: need(a1, '<order>'), signer: need(me('signer'), '--signer') };
    break;
  case 'reclaim':
    tool = 'reclaim_after_timeout';
    args = { order: need(a1, '<order>'), signer: need(me('signer'), '--signer') };
    break;
  case 'report': {
    const outcome = need(flags.outcome, '--outcome');
    if (!OUTCOMES.includes(outcome as (typeof OUTCOMES)[number])) die(`--outcome must be one of: ${OUTCOMES.join(', ')}`);
    tool = 'report_outcome';
    args = { order: need(a1, '<order>'), reporter: need(me('reporter'), '--reporter'), outcome, rating: int(flags.rating as string, '--rating'), comment: flags.comment };
    break;
  }
  case 'submit':
    tool = 'submit_transaction';
    args = { transaction: need(a1, '<signed-base64>') };
    break;
  default:
    die(`unknown command "${cmd}" (see: tessera help)`);
}

const out = await call(tool, args);
const built = out.http < 400 && typeof out.body.transaction === 'string';
if (!(built && kp && flags.json)) show(tool, out);
if (built && kp) await signAndMaybeSend(out.body, kp);
if (out.http >= 400) process.exit(1);
if (tool === 'check_payment' && out.body.decision === 'block') process.exit(3);
