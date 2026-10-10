import {
  createClient,
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  isSolanaError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  type RpcTransport,
} from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { walletSigner } from '@solana/kit-plugin-wallet';

// Each variable is read by name, so the build inlines only these two. They
// are public: use only RPC URLs that carry no key, or keys locked to this site.
const rpcUrls = import.meta.env.VITE_RPC_URLS as string | undefined;
const agentsUrl = import.meta.env.VITE_AGENTS_URL as string | undefined;

export const RPC_URLS = (rpcUrls ?? 'https://api.devnet.solana.com,https://solana-devnet.api.onfinality.io/public')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

/**
 * Where the merchant agents are served (`npm run agents`). Only the market
 * page needs it. A production build without it has no market, rather than
 * one that quietly talks to localhost.
 */
export const AGENTS_URL = agentsUrl ?? (import.meta.env.DEV ? 'http://localhost:4020' : 'https://agents.invalid');

/**
 * One wallet-backed client for the app. The connected wallet is payer and
 * signer. Transactions are v0: the checkout is two small instructions, and
 * v0 is what every Wallet Standard wallet signs today.
 */
export const client = createClient()
  .use(walletSigner({ chain: 'solana:devnet' }))
  .use(solanaRpc({ rpcUrl: RPC_URLS[0]!, transactionConfig: { version: 0 } }));

export type AppClient = Awaited<typeof client>;

const busy = (e: unknown) =>
  (isSolanaError(e, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) &&
    [429, 502, 503, 504].includes((e.context as { statusCode: number }).statusCode)) ||
  e instanceof TypeError;

/**
 * Every request goes to whichever endpoint is not rate limiting right now.
 * Public devnet endpoints throttle hard, so a busy answer is retried with a
 * growing pause rather than shown to the user as a failure.
 */
function failover(urls: string[]): RpcTransport {
  const sends = urls.map((url) => createDefaultRpcTransport({ url }));
  let first = 0;
  return (async (request: Parameters<RpcTransport>[0]) => {
    let last: unknown;
    for (let i = 0; i < 16; i += 1) {
      const k = (first + i) % sends.length;
      try {
        return await sends[k]!(request);
      } catch (e) {
        if (!busy(e)) throw e;
        last = e;
        first = (k + 1) % sends.length;
        if (i % sends.length === sends.length - 1) await new Promise((r) => setTimeout(r, Math.min(2500, 350 * (i + 1))));
      }
    }
    throw last;
  }) as RpcTransport;
}

export const readRpc = createSolanaRpcFromTransport(failover(RPC_URLS));
