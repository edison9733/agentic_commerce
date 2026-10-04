/**
 * What the merchant agents sell. Each service is small and local on purpose:
 * no API keys, nothing to sign up for, and every answer is something the
 * buyer can check. They stand in for real paid APIs; the payment, escrow and
 * scoring around them are the real thing.
 */
import type { Address } from '@solana/kit';
import { agentPdaOf, canonicalJson, fetchMaybeAgent, hashJson, sha256, score, toHex, toUnits, TIER_NAMES } from '@tessera/sdk';
import { getConfig, read, type Actor } from './chain.js';
import { chainNow } from '../../../scripts/lib.js';

export type Service = {
  sku: string;
  name: string;
  description: string;
  /** Price in token units. */
  price: bigint;
  example: unknown;
  run(input: unknown, ctx: { actor: Actor }): Promise<unknown>;
  /** What the arbiter checks when a delivery is disputed. */
  valid(output: unknown): boolean;
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const text = (input: unknown, key: string, fallback: string): string =>
  isRecord(input) && typeof input[key] === 'string' ? (input[key] as string).slice(0, 4000) : fallback;

const telemetry: Service = {
  sku: 'telemetry',
  name: 'Solana network telemetry',
  description: 'Current slot, epoch progress and recent throughput, read from the cluster.',
  price: toUnits('0.20'),
  example: {},
  async run(_input, { actor }) {
    const [slot, epoch, samples] = await Promise.all([
      read(() => actor.rpc.getSlot().send()),
      read(() => actor.rpc.getEpochInfo().send()),
      read(() => actor.rpc.getRecentPerformanceSamples(1).send()),
    ]);
    const s = samples[0];
    return {
      cluster: 'devnet',
      slot: Number(slot),
      epoch: Number(epoch.epoch),
      epochProgressPct: Math.round((Number(epoch.slotIndex) / Number(epoch.slotsInEpoch)) * 1000) / 10,
      tps: s ? Math.round(Number(s.numTransactions) / s.samplePeriodSecs) : null,
      sampledAt: new Date().toISOString(),
    };
  },
  valid: (o) => isRecord(o) && typeof o.slot === 'number' && o.slot > 0,
};

const STOP = new Set('a an and are as at be by for from has have in is it its of on or that the this to was were will with not but they their there'.split(' '));

const summary: Service = {
  sku: 'summary',
  name: 'Text summary',
  description: 'The two sentences that carry the most of a text, picked by word frequency.',
  price: toUnits('0.25'),
  example: { text: 'Paste any paragraph here.' },
  async run(input) {
    const source = text(input, 'text', 'Escrow holds a payment until delivery. A credit score decides how long. Wallets with history settle at once.');
    const sentences = source.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    const freq = new Map<string, number>();
    for (const w of source.toLowerCase().match(/[a-z']+/g) ?? []) {
      if (!STOP.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
    }
    const ranked = sentences
      .map((s, i) => {
        const words = s.toLowerCase().match(/[a-z']+/g) ?? [];
        const total = words.reduce((n, w) => n + (freq.get(w) ?? 0), 0);
        return { s, i, score: words.length ? total / Math.sqrt(words.length) : 0 };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .sort((a, b) => a.i - b.i);
    return { sentences: sentences.length, summary: ranked.map((r) => r.s.trim()).join(' ') };
  },
  valid: (o) => isRecord(o) && typeof o.summary === 'string' && o.summary.length > 0,
};

const creditReport: Service = {
  sku: 'credit-report',
  name: 'Tessera credit report',
  description: 'A wallet\'s score, tier and the evidence behind it, recomputed from its on-chain account.',
  price: toUnits('0.30'),
  example: { wallet: '<any Solana address>' },
  async run(input, { actor }) {
    const wallet = text(input, 'wallet', actor.identity.address) as Address;
    const config = await getConfig(actor);
    const acct = await read(async () => fetchMaybeAgent(actor.rpc, await agentPdaOf(wallet)));
    if (!acct.exists) return { wallet, known: false, score: 0, tier: TIER_NAMES[0] };
    const e = score.evaluate(acct.data, config.params, await read(() => chainNow(actor)));
    return {
      wallet,
      known: true,
      score: e.score,
      tier: TIER_NAMES[e.tier],
      evidence: { history: e.history, tenure: e.tenure, diversity: e.diversity },
      rating: e.rating,
      behaviour: e.behaviour,
      stars: score.averageStars(acct.data, config.params),
      settledOrders: acct.data.asBuyer.orders + acct.data.asMerchant.orders,
      disputesLost: acct.data.asBuyer.disputesLost + acct.data.asMerchant.disputesLost,
    };
  },
  valid: (o) => isRecord(o) && typeof o.score === 'number' && typeof o.tier === 'string',
};

const identicon: Service = {
  sku: 'identicon',
  name: 'Generated identicon',
  description: 'A deterministic 5x5 SVG avatar for any string.',
  price: toUnits('0.15'),
  example: { seed: 'my-agent' },
  async run(input) {
    const seed = text(input, 'seed', 'tessera');
    const h = await sha256(seed);
    const hue = ((h[0]! << 8) | h[1]!) % 360;
    let cells = '';
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        if (h[2 + y * 3 + x]! & 1) {
          cells += `<rect x="${x * 20}" y="${y * 20}" width="20" height="20"/>`;
          if (x < 2) cells += `<rect x="${(4 - x) * 20}" y="${y * 20}" width="20" height="20"/>`;
        }
      }
    }
    return {
      seed,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="hsl(${hue} 70% 55%)">${cells}</svg>`,
    };
  },
  valid: (o) => isRecord(o) && typeof o.svg === 'string' && o.svg.startsWith('<svg'),
};

/** What a merchant that takes orders and delivers nothing useful would send. */
const junk: Service = {
  sku: 'anything',
  name: 'Anything you need',
  description: 'Too good to be true.',
  price: toUnits('0.30'),
  example: {},
  async run() {
    return { ok: true };
  },
  valid: () => false,
};

export const SERVICES: Record<string, Service[]> = {
  atlas: [telemetry],
  quill: [summary],
  vera: [creditReport],
  pixel: [identicon],
  mallory: [junk],
  washer: [junk],
};

/** One canonical encoding, so a request and a delivery each hash the same everywhere. */
export const canonical = canonicalJson;
export const hashOf = hashJson;
export const hexHashOf = async (v: unknown): Promise<string> => toHex(await hashOf(v));
