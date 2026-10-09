/**
 * What a merchant sells, read from the A2A agent card its credit file points
 * to (`Agent.uri`). Everything in a card is written by the merchant: it is used
 * to match a need and to quote a price, never to rank, and every piece of text
 * is cut short and handed on marked as self-declared.
 *
 * The URI is chosen by whoever registered the wallet, so fetching it is a
 * server-side request to an address someone else picked. Hence: http(s) only,
 * no redirects, a short timeout, a size cap, and no private or loopback
 * addresses (checked on the address actually connected to, so a DNS answer
 * cannot be swapped between the check and the connection) unless the API is
 * only listening on this machine or TESSERA_ALLOW_PRIVATE_CARDS=1.
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

export const TESSERA_EXTENSION_URI = 'https://github.com/edison9733/agentic_commerce/blob/main/docs/A2A-EXTENSION.md';

const TIMEOUT_MS = Number(process.env.TESSERA_CARD_TIMEOUT_MS ?? 1500);
const MAX_BYTES = 64 * 1024;
const TTL_MS = 5 * 60_000;
const FAIL_TTL_MS = 60_000;

export type Skill = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  /** Token units, from the Tessera extension's price list. */
  price: bigint | null;
  /** Where to ask for it over plain HTTP 402, if the card says. */
  x402: string | null;
};

export type Card = {
  name: string;
  description: string;
  /** The A2A endpoint. */
  url: string | null;
  skills: Skill[];
  /** The wallet the card's Tessera extension names, if it has one. */
  wallet: string | null;
};

export type CardResult = { card: Card } | { error: string };

const loopbackHost = (h: string) => /^(127\.|::1$|localhost$)/.test(h);
/** True when the API only listens on this machine, so the cards it can reach are this machine's own. */
export const allowPrivateCards = () =>
  process.env.TESSERA_ALLOW_PRIVATE_CARDS === '1' || (process.env.TESSERA_ALLOW_PRIVATE_CARDS !== '0' && loopbackHost(process.env.HOST ?? '127.0.0.1'));

/** Loopback, private, link-local, CGNAT, unspecified, multicast and the like. */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x.startsWith('::ffff:')) return isPrivateIp(x.slice(7));
    return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('ff');
  }
  return true;
}

/** Strip control characters, collapse whitespace, cut to `n` characters. */
export const clean = (v: unknown, n: number): string =>
  typeof v === 'string'
    ? v
        .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, n)
    : '';

function getJson(url: string, allowPrivate: boolean): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error('not a URL'));
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return reject(new Error('only http(s) cards are read'));
    if (u.username || u.password) return reject(new Error('credentials in the URL'));
    // Checked on the address the socket really connects to.
    const lookup = (host: string, opts: { all?: boolean }, cb: (e: Error | null, a: string | LookupAddress[], f?: number) => void) =>
      dnsLookup(host, { ...opts, all: true }, (e, addrs) => {
        if (e) return cb(e, '');
        const list = addrs as LookupAddress[];
        if (!list.length) return cb(new Error('the card host does not resolve'), '');
        if (!allowPrivate && list.some((x) => isPrivateIp(x.address))) return cb(new Error('the card is on a private address'), '');
        if (opts.all) cb(null, list);
        else cb(null, list[0]!.address, list[0]!.family);
      });
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && !allowPrivate && isPrivateIp(host)) return reject(new Error('the card is on a private address'));
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(u, { lookup: lookup as never, timeout: TIMEOUT_MS, headers: { accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`the card answered HTTP ${res.statusCode}`));
      }
      let size = 0;
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) {
          req.destroy(new Error('the card is larger than 64 KB'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch {
          reject(new Error('the card is not JSON'));
        }
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`no answer in ${TIMEOUT_MS} ms`)));
    req.on('error', reject);
  });
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** An A2A agent card, reduced to what matching and pricing need. Anything malformed is dropped, not guessed. */
export function parseCard(raw: unknown): Card {
  if (!isRecord(raw)) throw new Error('the card is not an object');
  const ext = (isRecord(raw.capabilities) && Array.isArray(raw.capabilities.extensions) ? raw.capabilities.extensions : []).find(
    (e: unknown) => isRecord(e) && e.uri === TESSERA_EXTENSION_URI,
  ) as Record<string, unknown> | undefined;
  const params = ext && isRecord(ext.params) ? ext.params : {};
  const prices = isRecord(params.prices) ? params.prices : {};
  const resource = typeof params.x402Resource === 'string' && /^https?:\/\//.test(params.x402Resource) ? params.x402Resource : null;
  const skills = (Array.isArray(raw.skills) ? raw.skills : []).slice(0, 32).flatMap((s: unknown): Skill[] => {
    if (!isRecord(s)) return [];
    const id = clean(s.id, 64);
    if (!id) return [];
    const p = prices[id];
    return [
      {
        id,
        name: clean(s.name, 80),
        description: clean(s.description, 200),
        tags: (Array.isArray(s.tags) ? s.tags : []).slice(0, 12).map((t) => clean(t, 32)).filter(Boolean),
        price: typeof p === 'string' && /^[0-9]{1,18}$/.test(p) ? BigInt(p) : null,
        x402: resource ? clean(resource.replace('{skill}', encodeURIComponent(id)), 200) : null,
      },
    ];
  });
  return {
    name: clean(raw.name, 64),
    description: clean(raw.description, 200),
    url: typeof raw.url === 'string' && /^https?:\/\//.test(raw.url) ? clean(raw.url, 200) : null,
    skills,
    wallet: typeof params.wallet === 'string' ? params.wallet : null,
  };
}

const cache = new Map<string, { at: number; ttl: number; value: Promise<CardResult> }>();

/** The card at `url`, cached for five minutes (a failure for one). Never throws. */
export function fetchCard(url: string, allowPrivate = allowPrivateCards()): Promise<CardResult> {
  const key = `${allowPrivate ? 'p' : 'n'}:${url}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  if (cache.size > 2_000) cache.clear();
  const entry = { at: Date.now(), ttl: TTL_MS, value: Promise.resolve<CardResult>({ error: 'pending' }) };
  entry.value = getJson(url, allowPrivate)
    .then((raw) => ({ card: parseCard(raw) }))
    .catch((e: Error) => {
      entry.ttl = FAIL_TTL_MS;
      return { error: clean(e.message, 120) };
    });
  cache.set(key, entry);
  return entry.value;
}
