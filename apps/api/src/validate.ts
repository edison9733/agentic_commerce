/**
 * Input checks for every route. A request that does not fit is refused with
 * `invalid_request` and a message naming the field and what it accepts, so an
 * agent can correct itself instead of guessing.
 */
import { isAddress } from '@solana/kit';
import { ADDRESS_PATTERN, AMOUNT_PATTERN, HEX32_PATTERN } from './contract.js';

export type Field =
  | { name: string; kind: 'address' | 'amount' | 'hex32' | 'base64'; required?: boolean }
  | { name: string; kind: 'enum'; values: readonly string[]; required?: boolean }
  | { name: string; kind: 'int'; min: number; max: number; required?: boolean }
  | { name: string; kind: 'text'; maxBytes: number; required?: boolean }
  | { name: string; kind: 'json'; required?: boolean };

export type Checked = { ok: true; values: Record<string, unknown> } | { ok: false; message: string };

/** Deepest nesting a `json` field may have. It is hashed recursively, so this bounds the work before any of it. */
const MAX_JSON_DEPTH = 32;
const tooDeep = (v: unknown, depth = 0): boolean =>
  depth > MAX_JSON_DEPTH || (typeof v === 'object' && v !== null && Object.values(v).some((x) => tooDeep(x, depth + 1)));

const addressRe = new RegExp(ADDRESS_PATTERN);
const amountRe = new RegExp(AMOUNT_PATTERN);
const hexRe = new RegExp(HEX32_PATTERN);

export function check(input: unknown, fields: Field[]): Checked {
  const src = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const values: Record<string, unknown> = {};
  for (const f of fields) {
    const v = src[f.name];
    if (v === undefined || v === null || v === '') {
      if (f.required) return { ok: false, message: `${f.name} is required` };
      continue;
    }
    switch (f.kind) {
      case 'address':
        if (typeof v !== 'string' || !addressRe.test(v) || !isAddress(v)) return { ok: false, message: `${f.name} must be a base58 Solana address` };
        break;
      case 'amount':
        if (typeof v !== 'string' || !amountRe.test(v)) return { ok: false, message: `${f.name} must be USDC as a decimal string with at most 6 decimals, e.g. "0.25"` };
        break;
      case 'hex32':
        if (typeof v !== 'string' || !hexRe.test(v)) return { ok: false, message: `${f.name} must be 32 bytes as 64 lowercase hex characters` };
        break;
      case 'base64':
        if (typeof v !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(v) || v.length > 2_000) return { ok: false, message: `${f.name} must be a base64 transaction` };
        break;
      case 'enum':
        if (typeof v !== 'string' || !f.values.includes(v)) return { ok: false, message: `${f.name} must be one of: ${f.values.join(', ')}` };
        break;
      case 'int':
        if (typeof v !== 'number' || !Number.isInteger(v) || v < f.min || v > f.max) return { ok: false, message: `${f.name} must be an integer from ${f.min} to ${f.max}` };
        break;
      case 'text':
        if (typeof v !== 'string' || Buffer.byteLength(v, 'utf8') > f.maxBytes) return { ok: false, message: `${f.name} must be text of at most ${f.maxBytes} bytes` };
        break;
      case 'json':
        if (tooDeep(v)) return { ok: false, message: `${f.name} must be JSON nested at most ${MAX_JSON_DEPTH} levels deep` };
        break;
    }
    values[f.name] = v;
  }
  return { ok: true, values };
}
