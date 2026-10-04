import { USDC_DECIMALS } from './constants.js';

/** "1.25" -> 1250000n. Throws on anything that is not a plain decimal. */
export function toUnits(value: string | number, decimals = USDC_DECIMALS): bigint {
  const text = typeof value === 'number' ? value.toFixed(decimals) : value.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(`not a decimal amount: ${value}`);
  const [whole, frac = ''] = text.split('.');
  if (frac.length > decimals) throw new Error(`too many decimal places: ${value}`);
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

/** 1250000n -> "1.25". Trailing zeros are trimmed down to `minDp` places. */
export function fromUnits(units: bigint, decimals = USDC_DECIMALS, minDp = 2): string {
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  let frac = (units % base).toString().padStart(decimals, '0');
  frac = frac.replace(/0+$/, '').padEnd(minDp, '0');
  return frac.length ? `${whole}.${frac}` : whole.toString();
}

export function newOrderId(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function toHex(bytes: Uint8Array | ReadonlyUint8ArrayLike): string {
  return Array.from(bytes as Uint8Array, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  if (!/^([0-9a-fA-F]{2})*$/.test(hex)) throw new Error('not a hex string');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

type ReadonlyUint8ArrayLike = { readonly length: number; readonly [n: number]: number };

/** sha256 through WebCrypto, so the same code runs in Node and in a browser. */
export async function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

export function bytesEqual(a: ReadonlyUint8ArrayLike, b: ReadonlyUint8ArrayLike): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export function shortAddress(a: string, n = 4): string {
  return a.length <= n * 2 + 1 ? a : `${a.slice(0, n)}…${a.slice(-n)}`;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * One canonical JSON encoding (object keys sorted at every level), so a
 * request or a delivery hashes to the same bytes for the merchant that
 * commits the hash and the buyer that checks it.
 */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) =>
    isPlainObject(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x,
  );
}

/** sha256 of the canonical encoding. */
export const hashJson = (v: unknown): Promise<Uint8Array> => sha256(canonicalJson(v));
