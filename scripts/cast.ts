/**
 * The demo network's cast. Every one of these is a real devnet wallet with
 * its own keypair in `.keys/agents/`, and everything the site shows about
 * them was earned on-chain by `npm run swarm`.
 */
export type CastMember = {
  /** Keypair file name and on-chain profile name. */
  id: string;
  role: 'merchant' | 'buyer';
  /** What it is, for the on-chain profile and the agent card. */
  title: string;
  /** Honest agents trade normally; the others each act out one attack. */
  behaviour: 'honest' | 'no-show' | 'friendly-fraud' | 'ring-merchant' | 'ring-buyer';
};

export const MERCHANTS: CastMember[] = [
  { id: 'atlas', role: 'merchant', title: 'Atlas: Solana network telemetry', behaviour: 'honest' },
  { id: 'quill', role: 'merchant', title: 'Quill: text summaries', behaviour: 'honest' },
  { id: 'vera', role: 'merchant', title: 'Vera: Tessera credit reports', behaviour: 'honest' },
  { id: 'pixel', role: 'merchant', title: 'Pixel: generated identicons', behaviour: 'honest' },
];

export const BUYERS: CastMember[] = [
  { id: 'scout', role: 'buyer', title: 'Scout: research agent', behaviour: 'honest' },
  { id: 'nova', role: 'buyer', title: 'Nova: trading agent', behaviour: 'honest' },
  { id: 'orbit', role: 'buyer', title: 'Orbit: monitoring agent', behaviour: 'honest' },
  { id: 'lumen', role: 'buyer', title: 'Lumen: content agent', behaviour: 'honest' },
  { id: 'drift', role: 'buyer', title: 'Drift: data agent', behaviour: 'honest' },
  { id: 'echo', role: 'buyer', title: 'Echo: support agent', behaviour: 'honest' },
];

/** The attackers. They join later, so the network they attack is established. */
export const ADVERSARIES: CastMember[] = [
  { id: 'mallory', role: 'merchant', title: 'Mallory: takes orders, never delivers', behaviour: 'no-show' },
  { id: 'charlie', role: 'buyer', title: 'Charlie: disputes what it received', behaviour: 'friendly-fraud' },
  { id: 'washer', role: 'merchant', title: 'Washer: wash-trades with its own wallets', behaviour: 'ring-merchant' },
  { id: 'sock-1', role: 'buyer', title: 'Sock puppet 1', behaviour: 'ring-buyer' },
  { id: 'sock-2', role: 'buyer', title: 'Sock puppet 2', behaviour: 'ring-buyer' },
  { id: 'sock-3', role: 'buyer', title: 'Sock puppet 3', behaviour: 'ring-buyer' },
];

export const CAST: CastMember[] = [...MERCHANTS, ...BUYERS, ...ADVERSARIES];

export const keyPath = (id: string) => `.keys/agents/${id}.json`;

/** Where each merchant's A2A agent card is served by `npm run agents`. */
/** On Railway, the service's own public domain unless AGENT_HOST says otherwise. */
export const AGENT_HOST = process.env.AGENT_HOST ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:4020');
export const agentCardUrl = (id: string) => `${AGENT_HOST}/agents/${id}/.well-known/agent-card.json`;
