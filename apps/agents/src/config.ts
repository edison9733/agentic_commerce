import { SOLANA_DEVNET } from '@tessera/sdk';

const list = (v: string | undefined, fallback: string[]) =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback;

/** A numeric setting. A value that is not a number at least `min` stops the start: a typo must not switch a limit off. */
function num(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < min) throw new Error(`${name} must be a number of at least ${min}`);
  return v;
}

export const config = {
  port: num('PORT', 4020, 0),
  /** This machine only, unless a host opts in (the Dockerfile sets 0.0.0.0 behind Railway's proxy). */
  host: process.env.HOST ?? '127.0.0.1',
  /** Public base URL: what agent cards and x402 resources name. */
  publicUrl: process.env.AGENT_HOST ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:4020'),
  network: SOLANA_DEVNET,
  /**
   * x402 facilitators, in order of preference. The first is the x402
   * project's public testnet facilitator (no API key); the second is a
   * fallback so one operator being down cannot stop payments. Coinbase's
   * CDP facilitator, the most used one, needs an API key: set
   * CDP_API_KEY_ID and CDP_API_KEY_SECRET and it is tried first
   * (see facilitator.ts).
   */
  facilitators: list(process.env.FACILITATOR_URLS, [
    'https://x402.org/facilitator',
    'https://facilitator.payai.network',
  ]),
  /** Browser origins allowed to call the REST API. */
  webOrigins: list(process.env.WEB_ORIGINS, ['http://localhost:5173', 'http://127.0.0.1:5173']),
  /**
   * Each open order costs rent until it settles, so cap what one client can
   * leave unpaid for one wallet. Counted per client, so nobody can use up a
   * wallet's quota by naming it as the buyer.
   */
  maxUnpaidPerBuyer: num('MAX_UNPAID_PER_BUYER', 3, 1),
  /** ...what one client can leave unpaid at one merchant, whatever wallets it names... */
  maxUnpaidPerClient: num('MAX_UNPAID_PER_CLIENT', 5, 1),
  /** ...and what all of a merchant's open quotes together may cost. */
  maxOpenQuotes: num('MAX_OPEN_QUOTES', 40, 1),
  /** Requests one client may make per minute that open an order on-chain. */
  quotesPerMinute: num('QUOTES_PER_MINUTE', 20, 1),
  /** Requests of any kind one client may make per minute. */
  requestsPerMinute: num('REQUESTS_PER_MINUTE', 120, 1),
  /**
   * Set when the server sits behind a proxy or tunnel, so limits see the real
   * client (express `trust proxy`). On Railway it defaults to one hop, its
   * edge proxy; anywhere else X-Forwarded-For is not trusted unless set.
   */
  trustProxy: process.env.TRUST_PROXY ?? (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_ID ? '1' : ''),
  /**
   * Quotes and results are kept on disk, and a deploy that loses the disk
   * leaves paid orders that cannot be answered and disputes that cannot be
   * judged. On Railway the data directory must be a volume, or the server
   * refuses orders, unless this says it does not matter (a throwaway demo).
   */
  allowEphemeralState: process.env.TESSERA_ALLOW_EPHEMERAL_STATE === '1',
  crankEveryMs: num('CRANK_MS', 4000, 500),
};

/** The a2a-x402 extension this server implements (standalone flow). */
export const X402_EXTENSION_URI = 'https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.2';
/** Tessera's own extension: escrow terms and the on-chain credit profile behind an agent. */
export const TESSERA_EXTENSION_URI = 'https://github.com/edison9733/agentic_commerce/blob/main/docs/A2A-EXTENSION.md';
