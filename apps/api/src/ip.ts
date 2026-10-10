/**
 * IP addresses, read by hand rather than by string prefix: which ones a card
 * may be fetched from, and which client a request is counted as.
 */
import { isIP } from 'node:net';

/** An IPv4 address as an unsigned 32-bit number. */
function v4(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

/** The eight 16-bit groups of an IPv6 address, a dotted IPv4 tail included. Null for anything else. */
export function v6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase();
  if (s.includes('%')) return null; // a zone id: link-local by definition
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const n = v4(dotted[2]!);
    if (n === null) return null;
    s = `${dotted[1]}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const side = (h: string | undefined) => (h ? h.split(':') : []);
  const head = side(halves[0]);
  const tail = side(halves[1]);
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/** [network, prefix length]: everything an IPv4 card must not be on. */
const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments (192.0.0.170: NAT64 discovery)
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and broadcast
];
const V4_RANGES = V4_BLOCKED.map(([net, len]) => [v4(net)!, len] as const);
const inV4 = (n: number, net: number, len: number) => Math.floor(n / 2 ** (32 - len)) === Math.floor(net / 2 ** (32 - len));
const privateV4 = (n: number) => V4_RANGES.some(([net, len]) => inV4(n, net, len));

/**
 * True unless the address is public unicast. IPv6 counts as public only
 * inside 2000::/3, outside the special blocks there; the forms that carry an
 * IPv4 address (mapped, NAT64, 6to4) are judged by that address, and the
 * deprecated IPv4-compatible ones (::a.b.c.d) are refused outright.
 */
export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return privateV4(v4(ip) ?? 0);
  if (kind !== 6) return true;
  const g = v6Groups(ip);
  if (!g) return true;
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  const tailV4 = g[6]! * 65_536 + g[7]!;
  if (zero(0, 5) && g[5] === 0xffff) return privateV4(tailV4); // ::ffff:a.b.c.d
  if (zero(0, 6)) return true; // ::, ::1 and ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return privateV4(tailV4); // NAT64, 64:ff9b::/96
  if (g[0] === 0x2002) return privateV4(g[1]! * 65_536 + g[2]!); // 6to4, 2002::/16
  if ((g[0]! & 0xe000) !== 0x2000) return true; // not global unicast: fc00::/7, fe80::/10, ff00::/8, 100::/64, ...
  if (g[0] === 0x2001 && g[1]! < 0x200) return true; // 2001::/23: Teredo, benchmarking, ORCHID
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
  if (g[0] === 0x3fff && g[1]! < 0x1000) return true; // documentation, 3fff::/20
  return false;
}

/** This machine: 127.0.0.0/8, ::1, or 127.x.x.x mapped into IPv6. */
export function isLoopbackIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return ip.startsWith('127.');
  const g = kind === 6 ? v6Groups(ip) : null;
  if (!g || !g.slice(0, 5).every((x) => x === 0)) return false;
  return (g[5] === 0 && g[6] === 0 && g[7] === 1) || (g[5] === 0xffff && g[6]! >> 8 === 127);
}

/**
 * The key a client is counted under: its IPv4 address, or the /64 its IPv6
 * address is in (one subscriber's usual allocation, so rotating through it
 * buys nothing).
 */
export function clientKey(ip: string | undefined): string {
  const a = (ip ?? '').split('%')[0]!;
  if (isIP(a) === 4) return a;
  const g = isIP(a) === 6 ? v6Groups(a) : null;
  if (!g) return 'unknown';
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return [g[6]! >> 8, g[6]! & 0xff, g[7]! >> 8, g[7]! & 0xff].join('.');
  return `${g.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`;
}
