import { SOLANA_DEVNET } from '@tessera/sdk';

const list = (v: string | undefined, fallback: string[]) =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback;

export const config = {
  port: Number(process.env.PORT ?? 4020),
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
  /** Each open order costs rent until it settles, so cap what one wallet can leave unpaid. */
  maxUnpaidPerBuyer: Number(process.env.MAX_UNPAID_PER_BUYER ?? 3),
  /** ...and what all of a merchant's open quotes together may cost. */
  maxOpenQuotes: Number(process.env.MAX_OPEN_QUOTES ?? 40),
  /** Requests one client may make per minute that open an order on-chain. */
  quotesPerMinute: Number(process.env.QUOTES_PER_MINUTE ?? 20),
  /** Set when the server sits behind a proxy or tunnel, so limits see the real client (express `trust proxy`). */
  trustProxy: process.env.TRUST_PROXY ?? '',
  crankEveryMs: Number(process.env.CRANK_MS ?? 4000),
};

/** The a2a-x402 extension this server implements (standalone flow). */
export const X402_EXTENSION_URI = 'https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.2';
/** Tessera's own extension: escrow terms and the on-chain credit profile behind an agent. */
export const TESSERA_EXTENSION_URI = 'https://github.com/edison9733/agentic_commerce/blob/main/docs/A2A-EXTENSION.md';
