/**
 * Everything the API reads from Solana. Read-only: the API never holds a key
 * and never sends a transaction it built itself.
 */
import {
  address,
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  fetchEncodedAccount,
  fetchEncodedAccounts,
  isSolanaError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  type Address,
  type Decoder,
  type MaybeEncodedAccount,
  type ReadonlyUint8Array,
  type RpcTransport,
} from '@solana/kit';
import { getMintDecoder, getMintSize, getTokenDecoder, getTokenSize, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import {
  AGENT_DISCRIMINATOR,
  agentPdaOf,
  CONFIG_DISCRIMINATOR,
  configPda,
  findAta,
  getAgentDecoder,
  getConfigDecoder,
  getOrderDecoder,
  getPairDecoder,
  ORDER_DISCRIMINATOR,
  PAIR_DISCRIMINATOR,
  pairPdaOf,
  TESSERA_PROGRAM_ADDRESS,
  type Agent,
  type Config,
  type Order,
  type Pair,
} from '@tessera/sdk';

export const RPC_URLS = (process.env.TESSERA_RPC_URLS ?? 'https://api.devnet.solana.com,https://solana-devnet.api.onfinality.io/public')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

/** The network the RPC serves, as x402 names it. Only used in responses. */
export const NETWORK = process.env.TESSERA_NETWORK ?? 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
export const EXPLORER_CLUSTER = process.env.TESSERA_EXPLORER_CLUSTER ?? 'devnet';

/** Raised when every endpoint failed: the API answers 503, never a guess. */
export class RpcUnavailable extends Error {}

const envMs = (v: string | undefined, fallback: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);
/** How long one endpoint gets to answer one request, and how long a request may take across all of them. */
const RPC_TIMEOUT_MS = envMs(process.env.TESSERA_RPC_TIMEOUT_MS, 8_000);
const RPC_DEADLINE_MS = 2 * RPC_TIMEOUT_MS;

const busy = (e: unknown) =>
  (isSolanaError(e, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) &&
    [429, 502, 503, 504].includes((e.context as { statusCode: number }).statusCode)) ||
  e instanceof TypeError ||
  (e instanceof Error && e.name === 'TimeoutError') ||
  (e instanceof Error && /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(e.message));

/**
 * Each request goes to whichever endpoint is answering; a busy one is retried
 * with a growing pause. An endpoint that accepts the connection and then says
 * nothing counts as busy after RPC_TIMEOUT_MS, and no request outlives
 * RPC_DEADLINE_MS, so a hung RPC fails fast instead of holding every route.
 */
function failover(urls: string[]): RpcTransport {
  const sends = urls.map((url) => createDefaultRpcTransport({ url }));
  let first = 0;
  return (async (request: Parameters<RpcTransport>[0]) => {
    const deadline = Date.now() + RPC_DEADLINE_MS;
    let last: unknown;
    for (let i = 0; i < Math.max(6, sends.length * 3) && Date.now() < deadline; i += 1) {
      const k = (first + i) % sends.length;
      try {
        const timeout = AbortSignal.timeout(Math.min(RPC_TIMEOUT_MS, deadline - Date.now()));
        return await sends[k]!({ ...request, signal: request.signal ? AbortSignal.any([request.signal, timeout]) : timeout });
      } catch (e) {
        if (request.signal?.aborted || !busy(e)) throw e;
        last = e;
        first = (k + 1) % sends.length;
        await new Promise((r) => setTimeout(r, Math.max(0, Math.min(2000, 250 * (i + 1), deadline - Date.now()))));
      }
    }
    throw new RpcUnavailable(`no RPC endpoint answered: ${(last as Error)?.message ?? 'out of time'}`);
  }) as RpcTransport;
}

export const rpc = createSolanaRpcFromTransport(failover(RPC_URLS));
export type Rpc = typeof rpc;

/**
 * An account decoded only if it is what it claims to be: owned by `owner`
 * and, for the program's own accounts, starting with the discriminator of its
 * kind. Anything else (another program's look-alike, a PDA someone sent
 * lamports to, garbage) reads as no account, never as a forged one and never
 * as an error that takes the route down.
 */
function decodeIf<T>(a: MaybeEncodedAccount, decoder: Decoder<T>, owner: Address, discriminator?: ReadonlyUint8Array, size?: number): T | null {
  if (!a.exists || a.programAddress !== owner) return null;
  if (size !== undefined && a.data.length !== size) return null;
  if (discriminator && (a.data.length < discriminator.length || discriminator.some((b, k) => a.data[k] !== b))) return null;
  try {
    return decoder.decode(a.data);
  } catch {
    return null;
  }
}
const asAgent = (a: MaybeEncodedAccount) => decodeIf(a, getAgentDecoder(), TESSERA_PROGRAM_ADDRESS, AGENT_DISCRIMINATOR);
const asPair = (a: MaybeEncodedAccount) => decodeIf(a, getPairDecoder(), TESSERA_PROGRAM_ADDRESS, PAIR_DISCRIMINATOR);

let cachedConfig: { at: number; data: Config; decimals: number } | undefined;
let configInFlight: Promise<{ data: Config; decimals: number } | null> | undefined;

/** The program's rules, cached for a minute and read once however many ask at the same time. `null` when this cluster has no Tessera config. */
export function getConfig(): Promise<{ data: Config; decimals: number } | null> {
  if (cachedConfig && Date.now() - cachedConfig.at < 60_000) return Promise.resolve(cachedConfig);
  configInFlight ??= (async () => {
    const c = decodeIf(await fetchEncodedAccount(rpc, await configPda()), getConfigDecoder(), TESSERA_PROGRAM_ADDRESS, CONFIG_DISCRIMINATOR);
    if (!c) return null;
    const mint = decodeIf(await fetchEncodedAccount(rpc, c.mint), getMintDecoder(), TOKEN_PROGRAM_ADDRESS, undefined, getMintSize());
    cachedConfig = { at: Date.now(), data: c, decimals: mint ? mint.decimals : 6 };
    return cachedConfig;
  })().finally(() => (configInFlight = undefined));
  return configInFlight;
}

const CLOCK = address('SysvarC1ock11111111111111111111111111111111');
let clock: { at: number; value: Promise<bigint> } | undefined;

/**
 * The chain's clock, which is what program deadlines are judged by. Read from
 * the Clock sysvar, not estimated: it drifts from wall time, and a deadline
 * answered a second early is a wrong answer. Shared for one second.
 */
export function chainNow(): Promise<bigint> {
  if (!clock || Date.now() - clock.at > 1000) {
    const value = fetchEncodedAccount(rpc, CLOCK).then((acct) => {
      if (!acct.exists) throw new RpcUnavailable('clock sysvar missing');
      return new DataView(acct.data.buffer, acct.data.byteOffset).getBigInt64(32, true);
    });
    value.catch(() => (clock = undefined));
    clock = { at: Date.now(), value };
  }
  return clock.value;
}

export async function readAgent(wallet: Address): Promise<Agent | null> {
  return asAgent(await fetchEncodedAccount(rpc, await agentPdaOf(wallet)));
}

export async function readPair(buyer: Address, merchant: Address): Promise<Pair | null> {
  return asPair(await fetchEncodedAccount(rpc, await pairPdaOf(buyer, merchant)));
}

/** Many pairs at once, in order. The RPC takes at most 100 addresses per call. */
export async function readPairs(pdas: Address[]): Promise<(Pair | null)[]> {
  const chunks: Address[][] = [];
  for (let k = 0; k < pdas.length; k += 100) chunks.push(pdas.slice(k, k + 100));
  return (await Promise.all(chunks.map((c) => fetchEncodedAccounts(rpc, c)))).flat().map(asPair);
}

export async function readOrder(order: Address): Promise<Order | null> {
  return decodeIf(await fetchEncodedAccount(rpc, order), getOrderDecoder(), TESSERA_PROGRAM_ADDRESS, ORDER_DISCRIMINATOR);
}

/** Balance of `owner`'s associated token account for `mint`, 0 if it has none (or what is there is not a token account). */
export async function tokenBalance(owner: Address, mint: Address): Promise<bigint> {
  const t = decodeIf(await fetchEncodedAccount(rpc, await findAta(owner, mint)), getTokenDecoder(), TOKEN_PROGRAM_ADDRESS, undefined, getTokenSize());
  return t ? t.amount : 0n;
}

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=${EXPLORER_CLUSTER}`;
export const explorerAddress = (a: string) => `https://explorer.solana.com/address/${a}?cluster=${EXPLORER_CLUSTER}`;
