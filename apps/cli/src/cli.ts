/**
 * tessera: the Tessera API from a terminal. Every command is one call to the
 * HTTP API. With --keypair the CLI signs the returned transaction locally,
 * after reading the order from the chain itself and checking every
 * instruction against what was asked; the API is not trusted, and the key
 * never leaves this machine.
 *
 *   npm run tessera -- check <merchant> 0.25 --buyer <wallet>
 *   npm run tessera -- help
 */
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';
import {
  AccountRole,
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  signTransaction,
  type Address,
  type KeyPairSigner,
} from '@solana/kit';
import {
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  ComputeBudgetInstruction,
  identifyComputeBudgetInstruction,
  parseSetComputeUnitPriceInstruction,
} from '@solana-program/compute-budget';
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  AssociatedTokenInstruction,
  fetchMint,
  identifyAssociatedTokenInstruction,
  identifyTokenInstruction,
  parseCreateAssociatedTokenIdempotentInstruction,
  parseTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
  TokenInstruction,
} from '@solana-program/token';
import {
  bytesEqual,
  configPda,
  fetchMaybeConfig,
  fetchMaybeOrder,
  findAta,
  fromHex,
  fromUnits,
  hashJson,
  newOrderId,
  orderAddresses,
  OrderVerificationError,
  parseTesseraInstruction,
  TESSERA_PROGRAM_ADDRESS,
  TesseraInstruction,
  toHex,
  toUnits,
  verifyOrderForPayment,
} from '@tessera/sdk';
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
  --rpc URL        Solana RPC the CLI reads the order from itself before it signs
                   (default the first of $TESSERA_RPC_URLS or https://api.devnet.solana.com)
                   Both must be https:// unless on this machine.
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
    rpc: { type: 'string' },
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

function die(message: string): never {
  console.error(`tessera: ${message}`);
  process.exit(1);
}

/** Plain http only to this machine: anywhere else an on-path attacker could rewrite what comes back. */
function endpoint(url: string, what: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return die(`${what} is not a URL: ${url}`);
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) die(`${what} must be https:// (http:// only for localhost, 127.0.0.1 or ::1): ${url}`);
  return url.replace(/\/$/, '');
}

const API = endpoint(String(flags.api ?? process.env.TESSERA_API_URL ?? 'http://127.0.0.1:4030'), flags.api ? '--api' : 'TESSERA_API_URL');

/** Every string the API sends, without control or bidirectional characters, so a name or a review cannot move the cursor or reorder a line. */
const scrub = (v: unknown): unknown =>
  typeof v === 'string'
    ? v.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    : Array.isArray(v)
      ? v.map(scrub)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [scrub(k), scrub(x)]))
        : v;

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
  const body = scrub(await res.json().catch(() => ({ status: 'internal_error', message: `HTTP ${res.status} without JSON` }))) as Record<string, unknown>;
  return { http: res.status, body };
}

// ---------------------------------------------------------------- signing

async function loadKeypair(path: string): Promise<KeyPairSigner> {
  const full = path.replace(/^~(?=\/|$)/, homedir());
  let bytes: unknown;
  try {
    // Like ssh: say so when other users can read the key.
    if (process.platform !== 'win32' && statSync(full).mode & 0o044) console.error(`tessera: warning: ${full} is readable by other users (chmod 600 it)`);
    bytes = JSON.parse(readFileSync(full, 'utf8'));
  } catch (e) {
    // Never the parse error: it quotes the file, and the file is the secret key.
    return die(`cannot read keypair ${full}: ${(e as NodeJS.ErrnoException).code ?? 'expected a JSON array of 64 bytes'}`);
  }
  const ok = Array.isArray(bytes) && bytes.length === 64 && bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255);
  if (!ok) die(`cannot read keypair ${full}: expected a JSON array of 64 bytes`);
  return createKeyPairSignerFromBytes(Uint8Array.from(bytes as number[])).catch(() => die(`cannot read keypair ${full}: not a valid key pair`));
}

const ALLOWED_PROGRAMS = new Set<string>([TESSERA_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS, ASSOCIATED_TOKEN_PROGRAM_ADDRESS, COMPUTE_BUDGET_PROGRAM_ADDRESS]);
const SYSTEM_PROGRAM_ADDRESS = address('11111111111111111111111111111111');
/** The highest priority fee signed, in micro-lamports per compute unit: at most 0.0014 SOL at 1.4M units. */
const MAX_CU_PRICE = 1_000_000n;

/** The Tessera instructions each command that acts on an existing order may build. */
const SETTLES: Record<string, TesseraInstruction[] | undefined> = {
  deliver: [TesseraInstruction.ConfirmFunded, TesseraInstruction.Deliver, TesseraInstruction.Release],
  release: [TesseraInstruction.Release],
  reclaim: [TesseraInstruction.Refund, TesseraInstruction.CancelUnpaid, TesseraInstruction.ResolveDispute],
  report: [TesseraInstruction.Release, TesseraInstruction.SubmitReview, TesseraInstruction.OpenDispute, TesseraInstruction.Refund],
};

/** What a transaction may do, from the command line and this machine's own reads of the chain; nothing from the API's reply. */
type Expected = {
  order: Address;
  vault: Address;
  mint: Address;
  decimals: number;
  tessera: TesseraInstruction[];
  /** Besides the signer and the order's vault, whose token accounts the signer may pay to recreate. */
  payees: Address[];
  /** open buyer: the one transfer, from the signer's token account, of the order's on-chain amount. */
  pay?: { source: Address; amount: bigint };
  open?: { orderId: Uint8Array; buyer: Address; amount: bigint; requestHash: Uint8Array; minHoldSecs: number };
  deliveryHash?: Uint8Array;
  review?: { rating: number; text?: string };
};

async function expected(cmd: string, args: Record<string, unknown>, me: Address): Promise<Expected> {
  const url = endpoint(String(flags.rpc ?? ((process.env.TESSERA_RPC_URLS ?? '').split(',')[0]!.trim() || 'https://api.devnet.solana.com')), flags.rpc ? '--rpc' : 'TESSERA_RPC_URLS');
  const rpc = createSolanaRpc(url);
  const read = <T>(p: Promise<T>): Promise<T> => p.catch((e: Error) => die(`cannot read the chain at ${url}: ${e.message}`));
  const cfg = await read(fetchMaybeConfig(rpc, await configPda()));
  if (!cfg.exists) return die(`no Tessera program is set up at ${url}; pass --rpc for the cluster the API serves`);
  const mint = cfg.data.mint;
  const { decimals } = (await read(fetchMint(rpc, mint))).data;
  const hex = (k: string) => (args[k] === undefined ? undefined : fromHex(String(args[k])));

  if (cmd === 'open' && args.role === 'merchant') {
    // The order id is the user's --order-id or one this machine chose, never the API's.
    const orderId = hex('orderId')!;
    const open = {
      orderId,
      buyer: args.buyer as Address,
      amount: toUnits(String(args.amount), decimals),
      requestHash: hex('requestHash') ?? (await hashJson(args.request ?? {})),
      minHoldSecs: (args.minHoldSecs as number | undefined) ?? 0,
    };
    return { ...(await orderAddresses(orderId, mint)), mint, decimals, tessera: [TesseraInstruction.EnsureAgent, TesseraInstruction.OpenOrder], payees: [], open };
  }
  if (cmd === 'open') {
    // The order id is the user's --order-id, or read here from the order account the user named.
    let orderId = hex('orderId');
    if (!orderId) {
      const o = await read(fetchMaybeOrder(rpc, args.order as Address));
      if (!o.exists) return die(`refusing to pay: order ${args.order} does not exist on-chain`);
      orderId = Uint8Array.from(o.data.orderId);
    }
    const v = await verifyOrderForPayment(rpc, {
      orderId,
      buyer: me,
      merchant: args.merchant as Address,
      amount: toUnits(String(args.amount), decimals),
      mint,
      payTo: (args.order as Address | undefined) ?? (await orderAddresses(orderId, mint)).order,
      requestHash: hex('requestHash') ?? (args.request !== undefined ? await hashJson(args.request) : undefined),
      minHoldSecs: args.minHoldSecs as number | undefined,
    }).catch((e: Error) => die(e instanceof OrderVerificationError ? e.message : `cannot read the chain at ${url}: ${e.message}`));
    return { order: v.order, vault: v.vault, mint, decimals, tessera: [TesseraInstruction.ConfirmFunded], payees: [], pay: { source: await findAta(me, mint), amount: v.data.amount } };
  }
  const tessera = SETTLES[cmd];
  if (!tessera) return die(`refusing to sign: "${cmd}" does not build a transaction`);
  // The order the user named, as the chain has it. Its payout recreates its payees' token accounts.
  const order = args.order as Address;
  const o = await read(fetchMaybeOrder(rpc, order));
  if (!o.exists || o.programAddress !== TESSERA_PROGRAM_ADDRESS) return die(`refusing to sign: order ${order} is not a Tessera order on-chain`);
  return {
    order,
    vault: await findAta(order, o.data.mint),
    mint: o.data.mint,
    decimals,
    tessera,
    payees: [o.data.buyer, o.data.merchant, cfg.data.treasury],
    ...(cmd === 'deliver' ? { deliveryHash: hex('deliveryHash') ?? (await hashJson(args.deliverable)) } : {}),
    ...(cmd === 'report' ? { review: { rating: (args.rating as number | undefined) ?? (args.outcome === 'satisfied' ? 5 : 1), text: (args.comment as string | undefined) || undefined } } : {}),
  };
}

function refuse(why: string): never {
  return die(`refusing to sign: ${why}`);
}

/** A parser's answer, or undefined for data it cannot read. */
function attempt<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch {
    return undefined;
  }
}

/**
 * Refuse to sign anything but what was asked. This wallet is the fee payer and
 * the only signer; no lookup tables; only the Tessera, SPL Token,
 * associated-token and compute-budget programs, so no System instruction (no
 * SOL transfer, no durable nonce). Every instruction is read in full:
 * - compute budget: a unit limit, and a unit price of at most MAX_CU_PRICE;
 * - associated token: create-if-missing only, paid by this wallet, for its own
 *   account, the order's vault or the order's payees;
 * - SPL Token: one TransferChecked from this wallet into the vault derived
 *   here, of the order's on-chain amount (open buyer only);
 * - Tessera: only the instructions this command builds, on the order the user
 *   named, with this wallet where the signer goes.
 * Returns the transfers it found, for display in place of the API's.
 */
function guard(b64: string, cmd: string, me: Address, e: Expected): { transfers: { from: Address; to: Address; amount: { usdc: string } }[] } {
  const tx = attempt(() => getTransactionDecoder().decode(getBase64Encoder().encode(b64))) ?? refuse('a transaction it cannot read');
  const msg = attempt(() => getCompiledTransactionMessageDecoder().decode(tx.messageBytes)) ?? refuse('a transaction it cannot read');
  if (msg.version !== 0 && msg.version !== 'legacy') return refuse('only legacy and version-0 transactions can be checked');
  if ('addressTableLookups' in msg && (msg.addressTableLookups?.length ?? 0) > 0) refuse('the transaction uses address lookup tables');
  const keys = msg.staticAccounts;
  if (keys[0] !== me) refuse(`the fee payer is ${keys[0]}, not your wallet ${me}`);
  if (msg.header.numSignerAccounts !== 1 || Object.keys(tx.signatures).length !== 1) refuse(`it wants ${msg.header.numSignerAccounts} signers; only your wallet may sign`);
  const transfers: { from: Address; to: Address; amount: { usdc: string } }[] = [];
  for (const c of msg.instructions) {
    const program = keys[c.programAddressIndex];
    if (!program || !ALLOWED_PROGRAMS.has(program)) refuse(`the transaction calls ${program}`);
    const accounts = (c.accountIndices ?? []).map((i) => ({ address: keys[i] ?? refuse('an instruction names an account the transaction does not carry'), role: AccountRole.READONLY }));
    const ix = { programAddress: program, accounts, data: c.data ?? new Uint8Array() };

    if (program === COMPUTE_BUDGET_PROGRAM_ADDRESS) {
      const kind = attempt(() => identifyComputeBudgetInstruction(ix));
      if (kind === ComputeBudgetInstruction.SetComputeUnitLimit) continue;
      if (kind !== ComputeBudgetInstruction.SetComputeUnitPrice) refuse('a compute-budget instruction other than a unit limit or price');
      const price = attempt(() => parseSetComputeUnitPriceInstruction(ix).data.microLamports) ?? refuse('a unit price it cannot read');
      if (price > MAX_CU_PRICE) refuse(`a priority fee of ${price} micro-lamports per unit (at most ${MAX_CU_PRICE})`);
    } else if (program === ASSOCIATED_TOKEN_PROGRAM_ADDRESS) {
      const a = attempt(() =>
        identifyAssociatedTokenInstruction(ix) === AssociatedTokenInstruction.CreateAssociatedTokenIdempotent ? parseCreateAssociatedTokenIdempotentInstruction(ix).accounts : undefined,
      );
      if (!a || a.payer.address !== me || a.mint.address !== e.mint || a.systemProgram.address !== SYSTEM_PROGRAM_ADDRESS || a.tokenProgram.address !== TOKEN_PROGRAM_ADDRESS) {
        refuse('an associated-token instruction other than creating a missing token account, paid by you');
      }
      if (![me, e.order, ...e.payees].includes(a.owner.address)) refuse(`it creates a token account for ${a.owner.address}, who is not a party to order ${e.order}`);
    } else if (program === TOKEN_PROGRAM_ADDRESS) {
      const t = attempt(() => (identifyTokenInstruction(ix) === TokenInstruction.TransferChecked ? parseTransferCheckedInstruction(ix) : undefined));
      if (!t) return refuse('a token instruction other than a transfer');
      if (t.accounts.destination.address !== e.vault) refuse(`the transfer goes to ${t.accounts.destination.address}, not the escrow vault ${e.vault}`);
      if (!e.pay || transfers.length || accounts.length !== 4 || t.accounts.source.address !== e.pay.source || t.accounts.authority.address !== me || t.accounts.mint.address !== e.mint) {
        refuse('a token transfer other than one payment from your wallet into the vault');
      }
      if (t.data.amount !== e.pay.amount) refuse(`the transfer is ${fromUnits(t.data.amount, e.decimals)}, the order is ${fromUnits(e.pay.amount, e.decimals)}`);
      transfers.push({ from: e.pay.source, to: e.vault, amount: { usdc: fromUnits(t.data.amount, e.decimals) } });
    } else {
      const p = attempt(() => parseTesseraInstruction(ix));
      if (!p || !e.tessera.includes(p.instructionType)) return refuse(`a Tessera ${p ? TesseraInstruction[p.instructionType] : 'instruction it cannot read'}, which ${cmd} does not build`);
      const name = TesseraInstruction[p.instructionType];
      const on = (p.accounts as { order?: { address: Address } }).order?.address;
      if (p.instructionType !== TesseraInstruction.EnsureAgent && on !== e.order) refuse(`${name} on order ${on}, not ${e.order}`);
      let fits: boolean;
      switch (p.instructionType) {
        case TesseraInstruction.EnsureAgent:
          fits = p.accounts.payer.address === me && [me, e.open?.buyer].includes(p.accounts.wallet.address);
          break;
        case TesseraInstruction.OpenOrder: {
          const { accounts: a, data: d } = p;
          const o = e.open!;
          fits = a.merchant.address === me && a.payer.address === me && a.buyer.address === o.buyer && a.mint.address === e.mint && bytesEqual(d.orderId, o.orderId) && d.amount === o.amount && bytesEqual(d.requestHash, o.requestHash) && d.minHoldSecs === o.minHoldSecs;
          break;
        }
        case TesseraInstruction.ConfirmFunded:
          fits = true;
          break;
        case TesseraInstruction.Deliver:
          fits = p.accounts.merchant.address === me && bytesEqual(p.data.deliveryHash, e.deliveryHash!);
          break;
        case TesseraInstruction.Release:
        case TesseraInstruction.Refund:
        case TesseraInstruction.CancelUnpaid:
          fits = p.accounts.authority.address === me;
          break;
        case TesseraInstruction.ResolveDispute:
          fits = p.accounts.authority.address === me && p.data.merchantBps === 5_000;
          break;
        case TesseraInstruction.SubmitReview:
          fits = p.accounts.reviewer.address === me && p.accounts.payer.address === me && p.data.rating === e.review!.rating && (e.review!.text === undefined || p.data.text === e.review!.text);
          break;
        case TesseraInstruction.OpenDispute:
          fits = p.accounts.buyer.address === me;
          break;
        default:
          fits = false;
      }
      if (!fits) refuse(`${name} is not what you asked for`);
    }
  }
  return { transfers };
}

async function signAndMaybeSend(b64: string, kp: KeyPairSigner): Promise<void> {
  const signed = await signTransaction([kp.keyPair], getTransactionDecoder().decode(getBase64Encoder().encode(b64)));
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
      console.log(`${String(r.rank).padStart(2)}. ${r.merchant}  ${r.name ?? ''}  ${r.tier} ${r.score} ★${Number(r.stars).toFixed(2)} (${r.reviews} reviews, ${r.sales} sales${r.missedDeliveries ? `, ${r.missedDeliveries} missed` : ''}${r.disputesLost ? `, ${r.disputesLost} disputes lost` : ''})`);
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
      // A merchant's order id is chosen here, so the order signed for is never the API's pick.
      orderId: flags['order-id'] ?? (role === 'merchant' ? toHex(newOrderId()) : undefined),
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
if (built && kp) {
  // Checked before anything of the reply is shown or signed; what is shown is what was checked.
  const e = await expected(cmd, args, kp.address).catch((err: Error) => die(err.message));
  Object.assign(out.body, { order: e.order, vault: e.vault, signers: [kp.address], ...guard(String(out.body.transaction), cmd, kp.address, e) });
}
if (!(built && kp && flags.json)) show(tool, out);
if (built && kp) await signAndMaybeSend(String(out.body.transaction), kp);
if (out.http >= 400) process.exit(1);
if (tool === 'check_payment' && out.body.decision === 'block') process.exit(3);
