/**
 * Shared helpers for the scripts. Each role signs with its own keypair, so
 * scripts go through the same authorisation paths a real user would.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  address,
  appendTransactionMessageInstructions,
  createDefaultRpcTransport,
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpcFromTransport,
  createTransactionMessage,
  fetchEncodedAccount,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  isSolanaError,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type RpcTransport,
} from '@solana/kit';
import { getSetComputeUnitLimitInstruction } from '@solana-program/compute-budget';
import {
  fetchMaybeToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token';

/** Repo root, independent of the caller's cwd. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export type Cluster = {
  rpcUrl: string;
  /** Other endpoints for the same cluster, used when the first is rate limiting. */
  fallbackUrls?: string[];
  /** Requests this process may send to each endpoint per 10 seconds. */
  budgetPer10s?: number;
};

export const DEVNET: Cluster = {
  rpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
  fallbackUrls: (process.env.SOLANA_RPC_FALLBACKS ?? 'https://solana-devnet.api.onfinality.io/public')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean),
  // The public endpoint allows 100 requests per 10 s per IP. Two processes
  // (agents and swarm) share it, and the website reads from it too.
  budgetPer10s: Number(process.env.RPC_BUDGET_PER_10S ?? 30),
};

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Keys handed over in the environment instead of files, for hosts with no
 * disk to put `.keys/` on (Railway and the like): TESSERA_KEYS is base64 of a
 * JSON map from a path under `.keys/` to the key's 64 bytes, as
 * `npm run keys:export` prints it. A file on disk still wins.
 */
let envKeys: Record<string, number[]> | undefined;
function keyFromEnv(path: string): number[] | undefined {
  if (!process.env.TESSERA_KEYS || !path.startsWith('.keys/')) return undefined;
  envKeys ??= JSON.parse(Buffer.from(process.env.TESSERA_KEYS, 'base64').toString('utf8')) as Record<string, number[]>;
  return envKeys[path.slice('.keys/'.length)];
}

export async function loadKeypair(path: string): Promise<KeyPairSigner> {
  const full = path.startsWith('~') ? path.replace('~', process.env.HOME ?? '') : resolve(REPO_ROOT, path);
  const fromEnv = existsSync(full) ? undefined : keyFromEnv(path);
  const bytes = new Uint8Array(fromEnv ?? (JSON.parse(readFileSync(full, 'utf8')) as number[]));
  return createKeyPairSignerFromBytes(bytes);
}

/** A fresh keypair in the Solana CLI's 64-byte JSON format. */
export async function generateKeypairBytes(): Promise<{ signer: KeyPairSigner; bytes: Uint8Array }> {
  const seed = new Uint8Array(randomBytes(32));
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
  const bytes = new Uint8Array(64);
  bytes.set(seed, 0);
  bytes.set(getAddressEncoder().encode(signer.address), 32);
  return { signer, bytes };
}

/** Load a role's keypair from `.keys/`, creating it on first use. */
export async function loadOrCreateKeypair(path: string): Promise<KeyPairSigner> {
  const full = resolve(REPO_ROOT, path);
  if (existsSync(full)) return loadKeypair(path);
  const { signer, bytes } = await generateKeypairBytes();
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, JSON.stringify(Array.from(bytes)), { mode: 0o600 });
  return signer;
}

const isRateLimited = (e: unknown): boolean =>
  (isSolanaError(e, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) &&
    [429, 502, 503, 504].includes((e.context as { statusCode: number }).statusCode)) ||
  (e instanceof Error && /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|terminated/i.test(e.message));

/**
 * One transport for a whole cluster: it keeps each endpoint inside a request
 * budget, moves to the next endpoint when one is saturated or answers 429,
 * and waits when all of them are. Everything in a process shares it, so the
 * budget is real.
 */
type Endpoint = { url: string; send: RpcTransport; sent: number[]; coolUntil: number };
const pools = new Map<string, Endpoint[]>();
const transports = new Map<string, RpcTransport>();
const keyOf = (c: Cluster) => [c.rpcUrl, ...(c.fallbackUrls ?? [])].join('|');

function poolFor(cluster: Cluster): Endpoint[] {
  const key = keyOf(cluster);
  let pool = pools.get(key);
  if (!pool) {
    pool = key.split('|').map((url) => ({ url, send: createDefaultRpcTransport({ url }), sent: [], coolUntil: 0 }));
    pools.set(key, pool);
  }
  return pool;
}

/** The first endpoint with budget left, waiting if none has. */
async function nextEndpoint(cluster: Cluster): Promise<Endpoint> {
  const budget = cluster.budgetPer10s ?? Infinity;
  const pool = poolFor(cluster);
  for (;;) {
    const now = Date.now();
    const free = pool.find((e) => {
      while (e.sent.length && now - e.sent[0]! > 10_000) e.sent.shift();
      return now >= e.coolUntil && e.sent.length < budget;
    });
    if (free) {
      free.sent.push(now);
      return free;
    }
    await sleep(250);
  }
}

function transportFor(cluster: Cluster): RpcTransport {
  const key = keyOf(cluster);
  const cached = transports.get(key);
  if (cached) return cached;
  const transport = (async (request: Parameters<RpcTransport>[0]) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const endpoint = await nextEndpoint(cluster);
      try {
        return await endpoint.send(request);
      } catch (e) {
        if (!isRateLimited(e)) throw e;
        lastError = e;
        endpoint.coolUntil = Date.now() + 2500;
      }
    }
    throw lastError ?? new Error('every RPC endpoint stayed saturated');
  }) as RpcTransport;
  transports.set(key, transport);
  return transport;
}

/**
 * A localhost JSON-RPC endpoint backed by the same budgeted pool. Libraries
 * that only take an RPC URL (the x402 client makes its own calls) point here,
 * so their requests are throttled and failed over with everyone else's.
 */
export async function localRpcProxy(cluster: Cluster = DEVNET): Promise<string> {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const endpoint = await nextEndpoint(cluster);
        try {
          const upstream = await fetch(endpoint.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
          if ([429, 502, 503, 504].includes(upstream.status)) {
            endpoint.coolUntil = Date.now() + 2500;
            continue;
          }
          res.writeHead(upstream.status, { 'content-type': 'application/json' });
          return void res.end(await upstream.text());
        } catch {
          endpoint.coolUntil = Date.now() + 2500;
        }
      }
      res.writeHead(503);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  server.unref();
  const { port } = server.address() as { port: number };
  return `http://127.0.0.1:${port}`;
}

const blockhashes = new Map<RpcTransport, { at: number; value: { blockhash: string; lastValidBlockHeight: bigint } }>();

/**
 * A signer plus an RPC, with a `sendTransaction` that uses plain HTTP only:
 * send with preflight, then poll the signature. No websocket per client,
 * which is what public endpoints rate-limit hardest.
 */
export function clientForSigner(kp: KeyPairSigner, cluster: Cluster = DEVNET) {
  const transport = transportFor(cluster);
  const rpc = createSolanaRpcFromTransport(transport);
  // A blockhash is good for about a minute; reuse it for a few seconds on shared endpoints.
  const reuseMs = cluster.budgetPer10s ? 4000 : 0;

  async function sendTransaction(instructions: Instruction[]): Promise<{ context: { signature: string } }> {
    let latest = blockhashes.get(transport);
    if (!latest || Date.now() - latest.at > reuseMs) {
      const { value } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
      latest = { at: Date.now(), value };
      blockhashes.set(transport, latest);
    }
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(kp, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(latest!.value as never, m),
      (m) => appendTransactionMessageInstructions([getSetComputeUnitLimitInstruction({ units: 400_000 }), ...instructions], m),
    );
    const signed = await signTransactionMessageWithSigners(message);
    const signature = getSignatureFromTransaction(signed);
    const wire = getBase64EncodedWireTransaction(signed);

    const broadcast = () => rpc.sendTransaction(wire, { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
    await broadcast();
    const started = Date.now();
    let lastBroadcast = started;
    for (;;) {
      await sleep(cluster.budgetPer10s ? 900 : 300);
      const { value } = await rpc.getSignatureStatuses([signature]).send();
      const status = value[0];
      if (status?.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err, (_, v) => (typeof v === 'bigint' ? Number(v) : v))}`);
      if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) {
        return { context: { signature } };
      }
      if (Date.now() - started > 60_000) throw new Error(`transaction ${signature} was not confirmed within 60s`);
      if (Date.now() - lastBroadcast > 6000) {
        lastBroadcast = Date.now();
        await broadcast().catch(() => undefined);
      }
    }
  }

  return { identity: kp, rpc, sendTransaction };
}

export type ScriptClient = ReturnType<typeof clientForSigner>;

export function sigOf(result: unknown): string {
  return (result as { context?: { signature?: string } })?.context?.signature ?? '';
}

export function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

export function explorerAddress(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=devnet`;
}

const CLOCK = address('SysvarC1ock11111111111111111111111111111111');

/** The chain's own clock. Program deadlines are judged by this, not by ours. */
export async function chainTime(c: ScriptClient): Promise<bigint> {
  const acct = await fetchEncodedAccount(c.rpc, CLOCK);
  if (!acct.exists) throw new Error('clock sysvar missing');
  return new DataView(acct.data.buffer, acct.data.byteOffset).getBigInt64(32, true);
}

const offsets = new WeakMap<object, { at: number; offset: number }>();

/** Chain time from the local clock plus an offset measured once a minute. Saves an RPC call per look. */
export async function chainNow(c: ScriptClient): Promise<bigint> {
  let o = offsets.get(c.rpc);
  if (!o || Date.now() - o.at > 60_000) {
    o = { at: Date.now(), offset: Number(await chainTime(c)) - Date.now() / 1000 };
    offsets.set(c.rpc, o);
  }
  return BigInt(Math.floor(Date.now() / 1000 + o.offset));
}

export async function waitForChainTime(c: ScriptClient, target: bigint, pollMs = 400): Promise<void> {
  for (;;) {
    if ((await chainTime(c)) >= target) return;
    await sleep(pollMs);
  }
}

/** Every string anywhere inside an error, so a test can match a program error name. */
export function errText(e: unknown): string {
  const parts: string[] = [];
  const seen = new Set<object>();
  const walk = (v: unknown, depth: number): void => {
    if (v == null || depth > 8) return;
    if (typeof v === 'string') return void parts.push(v);
    if (typeof v !== 'object') return void parts.push(String(v));
    if (seen.has(v as object)) return;
    seen.add(v as object);
    if (v instanceof Error) {
      parts.push(v.message);
      walk(v.cause, depth + 1);
    }
    for (const val of Object.values(v as Record<string, unknown>)) walk(val, depth + 1);
  };
  walk(e, 0);
  return parts.join(' | ');
}

export function tokenHelpers(payer: ScriptClient, mint: Address, decimals = 6) {
  const ata = async (owner: Address): Promise<Address> =>
    (await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
  const balance = async (owner: Address): Promise<bigint> => {
    const t = await fetchMaybeToken(payer.rpc, await ata(owner));
    return t.exists ? t.data.amount : 0n;
  };
  const ensureAtaIx = async (owner: Address, from: ScriptClient = payer) =>
    getCreateAssociatedTokenIdempotentInstruction({
      payer: from.identity,
      owner,
      mint,
      ata: await ata(owner),
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });
  const transferIx = async (from: ScriptClient, toOwnerAta: Address, amount: bigint) =>
    getTransferCheckedInstruction({
      source: await ata(from.identity.address),
      mint,
      destination: toOwnerAta,
      authority: from.identity,
      amount,
      decimals,
    });
  return { ata, balance, ensureAtaIx, transferIx };
}

export const log = {
  step: (m: string) => console.log(`\n== ${m}`),
  ok: (m: string) => console.log(`   ok  ${m}`),
  info: (m: string) => console.log(`       ${m}`),
  warn: (m: string) => console.log(`   !!  ${m}`),
  fail: (m: string) => console.log(` FAIL  ${m}`),
};
