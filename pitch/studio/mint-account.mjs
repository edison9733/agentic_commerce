// A USDC-devnet-shaped mint for a local validator: same address, 6 decimals,
// and a mint authority we hold, so the local copy of the product can be funded.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const [, , authority, out] = process.argv;
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58decode(s) {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(ALPHABET.indexOf(c));
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of s) { if (c !== '1') break; bytes.unshift(0); }
  return Buffer.from(bytes.length < 32 ? [...new Array(32 - bytes.length).fill(0), ...bytes] : bytes);
}
const data = Buffer.alloc(82);
data.writeUInt32LE(1, 0);               // mint authority: Some
b58decode(authority).copy(data, 4);     // mint authority
data.writeBigUInt64LE(0n, 36);          // supply
data.writeUInt8(6, 44);                 // decimals
data.writeUInt8(1, 45);                 // initialized
data.writeUInt32LE(0, 46);              // freeze authority: None
const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
writeFileSync(out, JSON.stringify({
  pubkey: USDC_DEVNET,
  account: { lamports: 1461600, data: [data.toString('base64'), 'base64'], owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', executable: false, rentEpoch: 0, space: 82 },
}));
void require;
