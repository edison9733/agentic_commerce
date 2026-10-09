/**
 * Print the keys the agents server needs (its operations key, the arbiter and
 * each merchant) as one TESSERA_KEYS value, for a host's secret variables.
 * Buyer keys are left out: the server never signs for a buyer.
 *
 *   npm run keys:export
 *
 * The output controls those wallets. Paste it only into your host's secret
 * settings; never commit it or send it in a chat.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ADVERSARIES, MERCHANTS } from './cast.js';
import { REPO_ROOT } from './lib.js';

// Exactly the keys apps/agents/src/server.ts loads.
const wanted = ['server.json', 'arbiter.json', ...[...MERCHANTS, ...ADVERSARIES.filter((a) => a.role === 'merchant')].map((m) => `agents/${m.id}.json`)];
const keys: Record<string, number[]> = {};
for (const k of wanted) {
  const file = resolve(REPO_ROOT, '.keys', k);
  if (!existsSync(file)) {
    console.error(`missing .keys/${k}: run npm run setup:devnet first, or copy your keys into .keys/`);
    process.exit(1);
  }
  keys[k] = JSON.parse(readFileSync(file, 'utf8')) as number[];
}
console.error(`TESSERA_KEYS for: ${wanted.join(', ')}. Secret: paste it only into your host's variables.`);
console.log(Buffer.from(JSON.stringify(keys)).toString('base64'));
