/**
 * What a merchant sells, read from the A2A agent card its credit file points
 * to (`Agent.uri`). Everything in a card is written by the merchant: it is used
 * to match a need and to quote a price, never to rank, and every piece of text
 * is cut short and handed on marked as self-declared.
 *
 * The URI is chosen by whoever registered the wallet, so fetching it is a
 * server-side request to an address someone else picked. Hence: http(s) only,
 * no redirects, one deadline for the whole fetch (DNS, connect and body), a
 * size cap, and no private, loopback or otherwise non-public address (checked
 * on the address actually connected to, so a DNS answer cannot be swapped
 * between the check and the connection) unless TESSERA_ALLOW_PRIVATE_CARDS=1.
 */
import { promises as dns, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { isPrivateIp } from './ip.js';

export { isPrivateIp };

export const TESSERA_EXTENSION_URI = 'https://github.com/edison9733/agentic_commerce/blob/main/docs/A2A-EXTENSION.md';

const envMs = (v: string | undefined, fallback: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);
/** From the first DNS query to the last byte: a card that drips slowly is cut off here, not kept alive by each byte. */
const TIMEOUT_MS = envMs(process.env.TESSERA_CARD_TIMEOUT_MS, 1500);
const MAX_BYTES = 64 * 1024;
const TTL_MS = 5 * 60_000;
const FAIL_TTL_MS = 60_000;
const MAX_CACHED = 2_000;
/** Cards fetched at once, and how many may wait for a turn. Past that a card is reported busy and tried again on a later call. */
const MAX_PARALLEL = 32;
const MAX_WAITING = 512;
/**
 * Asks the DNS servers directly (c-ares) instead of getaddrinfo, which runs on
 * libuv's four shared threads: a card domain that answers slowly must not hold
 * a thread the rest of the API needs. It does not read /etc/hosts.
 */
const resolver = new dns.Resolver({ timeout: Math.min(1000, TIMEOUT_MS), tries: 1 });

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

/**
 * Cards on private addresses are only for running everything on one machine,
 * and only when asked for. Listening on loopback is not enough: a tunnel or a
 * reverse proxy in front makes such an API public.
 */
export const allowPrivateCards = () => process.env.TESSERA_ALLOW_PRIVATE_CARDS === '1';

/**
 * Text written by someone else, made safe to hand to an agent: control
 * characters become spaces; invisible ones are dropped (format characters
 * such as zero-width, soft hyphen, BOM and bidirectional controls, the
 * Unicode tag characters that can spell out hidden text, private-use,
 * unassigned and lone surrogates, Hangul fillers, and variation selectors
 * beyond the first). Whitespace is collapsed and the result cut to `n`
 * characters, never in the middle of one.
 */
export const clean = (v: unknown, n: number): string =>
  typeof v === 'string'
    ? Array.from(
        v
          .replace(/\p{Cc}/gu, ' ')
          .replace(/[\p{Cf}\p{Co}\p{Cn}\p{Cs}\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}\u034f\u115f\u1160\u3164\uffa0]/gu, '')
          .replace(/([\ufe00-\ufe0f])[\ufe00-\ufe0f]+/gu, '$1')
          .replace(/\s+/g, ' ')
          .trim(),
      )
        .slice(0, n)
        .join('')
        .trim()
    : '';

/** Every address `host` resolves to, IPv4 first. `localhost` is this machine, as RFC 6761 has it. */
async function resolveHost(host: string): Promise<LookupAddress[]> {
  if (host === 'localhost' || host.endsWith('.localhost')) return [{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }];
  const [a, aaaa] = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]);
  return [
    ...(a.status === 'fulfilled' ? a.value.map((address) => ({ address, family: 4 })) : []),
    ...(aaaa.status === 'fulfilled' ? aaaa.value.map((address) => ({ address, family: 6 })) : []),
  ];
}

function getJson(url: string, allowPrivate: boolean): Promise<unknown> {
  return new Promise((settle, fail) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return fail(new Error('not a URL'));
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return fail(new Error('only http(s) cards are read'));
    if (u.username || u.password) return fail(new Error('credentials in the URL'));
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && !allowPrivate && isPrivateIp(host)) return fail(new Error('the card is on a private address'));
    // One deadline for everything, armed once: unlike a socket timeout, data arriving does not push it back.
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), TIMEOUT_MS);
    // The request is destroyed on abort, but a half-read body need not report it: settle here too (a second settle is a no-op).
    deadline.signal.addEventListener('abort', () => fail(new Error(`no answer in ${TIMEOUT_MS} ms`)), { once: true });
    const resolve = (v: unknown) => {
      clearTimeout(timer);
      settle(v);
    };
    const reject = (e: Error) => {
      clearTimeout(timer);
      fail(deadline.signal.aborted ? new Error(`no answer in ${TIMEOUT_MS} ms`) : e);
    };
    // Checked on the address the socket really connects to: the socket is only ever given addresses that passed.
    const lookup = (name: string, opts: { all?: boolean; family?: number }, cb: (e: Error | null, a: string | LookupAddress[], f?: number) => void) =>
      void resolveHost(name).then(
        (found) => {
          const list = found.filter((x) => !opts.family || x.family === opts.family);
          if (!list.length) return cb(new Error('the card host does not resolve'), '');
          if (!allowPrivate && list.some((x) => isPrivateIp(x.address))) return cb(new Error('the card is on a private address'), '');
          if (opts.all) cb(null, list);
          else cb(null, list[0]!.address, list[0]!.family);
        },
        (e: Error) => cb(e, ''),
      );
    const mod = u.protocol === 'https:' ? https : http;
    // http(s).get never follows a redirect: a 3xx is just another status that is not 200.
    const req = mod.get(u, { lookup: lookup as never, signal: deadline.signal, headers: { accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) {
        req.destroy();
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

let running = 0;
const waiting: (() => void)[] = [];
/** Runs `job` once fewer than MAX_PARALLEL others are running. Null if too many are already waiting. */
function inTurn<T>(job: () => Promise<T>): Promise<T> | null {
  if (running >= MAX_PARALLEL && waiting.length >= MAX_WAITING) return null;
  // A finishing job hands its place straight to the next waiting one, so the count never exceeds MAX_PARALLEL.
  const run = async () => {
    try {
      return await job();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running -= 1;
    }
  };
  if (running < MAX_PARALLEL) {
    running += 1;
    return run();
  }
  return new Promise<void>((turn) => waiting.push(turn)).then(run);
}

/** Least recently used first: a Map keeps insertion order, and a hit is moved to the end. */
const cache = new Map<string, { at: number; ttl: number; value: Promise<CardResult> }>();

/**
 * The card at `url`, cached for five minutes (a failure for one). Never
 * throws, and settles within TIMEOUT_MS of the first call, so callers sharing
 * a fetch in flight wait no longer than its deadline.
 */
export function fetchCard(url: string, allowPrivate = allowPrivateCards()): Promise<CardResult> {
  const key = `${allowPrivate ? 'p' : 'n'}:${url}`;
  const hit = cache.get(key);
  cache.delete(key);
  if (hit && Date.now() - hit.at < hit.ttl) {
    cache.set(key, hit);
    return hit.value;
  }
  while (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
  const turn = inTurn(() => getJson(url, allowPrivate));
  if (!turn) return Promise.resolve({ error: 'too many cards are being fetched; try again shortly' });
  const entry = { at: Date.now(), ttl: TTL_MS, value: Promise.resolve<CardResult>({ error: 'pending' }) };
  entry.value = turn
    .then((raw) => ({ card: parseCard(raw) }))
    .catch((e: Error) => {
      entry.ttl = FAIL_TTL_MS;
      return { error: clean(e.message, 120) };
    });
  cache.set(key, entry);
  return entry.value;
}
