/**
 * x402 facilitators, with failover.
 *
 * A facilitator verifies a signed payment and submits it to the chain, paying
 * the network fee, so a buyer holding only USDC can pay. It cannot move the
 * money anywhere else: the buyer's signature fixes the recipient, amount and
 * mint. The worst it can do is refuse, which is why there is a second one.
 */
import { HTTPFacilitatorClient } from '@x402/core/server';
import type { PaymentPayload, PaymentRequirements, SettleResponse } from '@x402/core/types';
import { config } from './config.js';

type Known = { url: string; client: HTTPFacilitatorClient; feePayer: string };

let known: Promise<Known[]> | undefined;

/**
 * Coinbase's CDP facilitator, the most used one. It needs an API key, which
 * only the operator can create, so it is used when `CDP_API_KEY_ID` and
 * `CDP_API_KEY_SECRET` are set and skipped otherwise. This path has not been
 * exercised with a real key: see the README.
 */
async function cdp(): Promise<{ url: string; client: HTTPFacilitatorClient } | null> {
  const id = process.env.CDP_API_KEY_ID;
  const secret = process.env.CDP_API_KEY_SECRET;
  if (!id || !secret) return null;
  try {
    const { createFacilitatorConfig } = await import('@coinbase/x402');
    const cfg = createFacilitatorConfig(id, secret);
    return { url: cfg.url ?? 'https://api.cdp.coinbase.com', client: new HTTPFacilitatorClient(cfg) };
  } catch (e) {
    console.warn(`[x402] CDP keys are set but @coinbase/x402 could not be loaded (${(e as Error).message.slice(0, 80)}). Run: npm i @coinbase/x402 -w @tessera/agents`);
    return null;
  }
}

async function probe(): Promise<Known[]> {
  const out: Known[] = [];
  const first = await cdp();
  const candidates = [...(first ? [first] : []), ...config.facilitators.map((url) => ({ url, client: new HTTPFacilitatorClient({ url }) }))];
  for (const { url, client } of candidates) {
    try {
      const supported = await client.getSupported();
      const kind = supported.kinds.find(
        (k) => k.x402Version === 2 && k.scheme === 'exact' && k.network === config.network,
      );
      const feePayer = kind?.extra?.feePayer;
      if (typeof feePayer === 'string') out.push({ url, client, feePayer });
      else console.warn(`[x402] ${url} does not offer exact on ${config.network}`);
    } catch (e) {
      console.warn(`[x402] ${url} is unreachable: ${(e as Error).message}`);
    }
  }
  return out;
}

export function facilitators(): Promise<Known[]> {
  known ??= probe();
  return known;
}

/** The facilitator a new quote should name as fee payer. */
export async function primaryFacilitator(): Promise<Known> {
  const all = await facilitators();
  if (!all[0]) {
    known = undefined;
    throw new Error('no x402 facilitator is reachable for Solana devnet');
  }
  return all[0];
}

export type Settled = { response: SettleResponse; facilitator: string; verifyMs: number; settleMs: number };

/**
 * Verify, then settle. The payment names one facilitator as fee payer, so it
 * goes to that one; a quote for another facilitator is a fresh quote.
 */
export async function verifyAndSettle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<Settled> {
  const feePayer = requirements.extra?.feePayer;
  const all = await facilitators();
  const f = all.find((k) => k.feePayer === feePayer) ?? all[0];
  if (!f) throw new Error('no x402 facilitator is reachable');

  const t0 = Date.now();
  const verified = await f.client.verify(payload, requirements);
  if (!verified.isValid) {
    throw new Error(`payment rejected by facilitator: ${verified.invalidReason ?? 'unknown'} ${verified.invalidMessage ?? ''}`);
  }
  const t1 = Date.now();
  const response = await f.client.settle(payload, requirements);
  if (!response.success) {
    throw new Error(`settlement failed: ${response.errorReason ?? 'unknown'} ${response.errorMessage ?? ''}`);
  }
  return { response, facilitator: f.url, verifyMs: t1 - t0, settleMs: Date.now() - t1 };
}
