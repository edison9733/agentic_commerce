/**
 * Everything the API reads from Solana. Read-only: the API never holds a key
 * and never sends a transaction it built itself.
 */
import {
  address,
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  fetchEncodedAccount,
  isSolanaError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  type Address,
  type RpcTransport,
} from '@solana/kit';
import { fetchMaybeMint, fetchMaybeToken } from '@solana-program/token';
import {
  agentPdaOf,
  configPda,
  fetchMaybeAgent,
  fetchMaybeConfig,
  fetchMaybeOrder,
  fetchMaybePair,
  findAta,
  pairPdaOf,
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

const busy = (e: unknown) =>
  (isSolanaError(e, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) &&
    [429, 502, 503, 504].includes((e.context as { statusCode: number }).statusCode)) ||
  e instanceof TypeError ||
  (e instanceof Error && /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(e.message));

/** Each request goes to whichever endpoint is answering; a busy one is retried with a growing pause. */
function failover(urls: string[]): RpcTransport {
  const sends = urls.map((url) => createDefaultRpcTransport({ url }));
  let first = 0;
  return (async (request: Parameters<RpcTransport>[0]) => {
    let last: unknown;
    for (let i = 0; i < Math.max(6, sends.length * 3); i += 1) {
      const k = (first + i) % sends.length;
      try {
        return await sends[k]!(request);
      } catch (e) {
        if (!busy(e)) throw e;
        last = e;
        first = (k + 1) % sends.length;
        await new Promise((r) => setTimeout(r, Math.min(2000, 250 * (i + 1))));
      }
    }
    throw new RpcUnavailable(`no RPC endpoint answered: ${(last as Error)?.message ?? 'unknown'}`);
  }) as RpcTransport;
}

export const rpc = createSolanaRpcFromTransport(failover(RPC_URLS));
export type Rpc = typeof rpc;

let cachedConfig: { at: number; data: Config; decimals: number } | undefined;

/** The program's rules, cached for a minute. `null` when this cluster has no Tessera config. */
export async function getConfig(): Promise<{ data: Config; decimals: number } | null> {
  if (cachedConfig && Date.now() - cachedConfig.at < 60_000) return cachedConfig;
  const c = await fetchMaybeConfig(rpc, await configPda());
  if (!c.exists) return null;
  const mint = await fetchMaybeMint(rpc, c.data.mint);
  cachedConfig = { at: Date.now(), data: c.data, decimals: mint.exists ? mint.data.decimals : 6 };
  return cachedConfig;
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
  const a = await fetchMaybeAgent(rpc, await agentPdaOf(wallet));
  return a.exists ? a.data : null;
}

export async function readPair(buyer: Address, merchant: Address): Promise<Pair | null> {
  const p = await fetchMaybePair(rpc, await pairPdaOf(buyer, merchant));
  return p.exists ? p.data : null;
}

export async function readOrder(order: Address): Promise<Order | null> {
  const o = await fetchMaybeOrder(rpc, order);
  return o.exists ? o.data : null;
}

/** Balance of `owner`'s associated token account for `mint`, 0 if it has none. */
export async function tokenBalance(owner: Address, mint: Address): Promise<bigint> {
  const t = await fetchMaybeToken(rpc, await findAta(owner, mint));
  return t.exists ? t.data.amount : 0n;
}

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=${EXPLORER_CLUSTER}`;
export const explorerAddress = (a: string) => `https://explorer.solana.com/address/${a}?cluster=${EXPLORER_CLUSTER}`;
