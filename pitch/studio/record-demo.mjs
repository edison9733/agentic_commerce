/**
 * Records the demo video: a buyer agent finds merchants by tier from a terminal,
 * buys from the top one on the website, then a merchant agent and a buyer agent
 * trade through the API side by side. Real commands, real output, a large visible
 * cursor and English subtitles burned in. No slides and no voice.
 *
 *   node pitch/studio/record-demo.mjs                       (the local studio: pitch/studio/up.sh)
 *   node pitch/studio/record-demo.mjs --live --buyer-key ~/me.json --merchant-key ~/shop.json
 *                                                           (the live site and devnet, from your own computer)
 *
 * Options: --site URL, --api URL, --rpc URL, --out NAME, --chrome PATH.
 * Live mode signs with your own devnet keypairs: the merchant key needs a little
 * SOL, the buyer key SOL and 0.25 devnet USDC. Keys are read here and never shown.
 * Needs ffmpeg and the Solana CLI on PATH. On your own computer, `npx playwright install chromium` once.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { CURSOR, glide, click, smoothScroll, typeSlowly, srt, burn, terminalHtml, pause } from './film.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : fallback;
};
const live = argv.includes('--live');
const site = opt('site', live ? 'https://agentic-commerce-two-theta.vercel.app' : 'http://localhost:5173');
const api = opt('api', live ? process.env.TESSERA_API_URL : 'http://127.0.0.1:4030');
const rpc = opt('rpc', live ? 'https://api.devnet.solana.com' : 'http://127.0.0.1:18499');
const name = opt('out', live ? 'tessera-demo-video-live' : 'tessera-demo-video');
const outDir = join(repo, 'pitch/out');
const work = join(here, '.run/video', name);
if (live && !api) throw new Error('set TESSERA_API_URL (or --api) to your Tessera API');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// ---- run the real CLI first; the terminal scenes replay its real output on camera
function cli(args) {
  const env = { ...process.env, TESSERA_API_URL: api, TESSERA_RPC_URLS: rpc, NO_COLOR: '1' };
  try {
    return execFileSync('npx', ['tsx', 'apps/cli/src/cli.ts', ...args], { cwd: repo, env, encoding: 'utf8', timeout: 120_000 }).trimEnd();
  } catch (e) {
    return String(e.stdout ?? '').trimEnd() || `(${args[0]} failed: ${String(e.message).split('\n')[0]})`;
  }
}
/** On screen only: long signatures shortened, explorer links and the repeated order line dropped, so the output fits a pane. */
const tidy = (out, keepOrder = false) =>
  out
    .split('\n')
    .filter((l) => !l.startsWith('https://explorer.solana.com') && (keepOrder || !l.startsWith('order ')))
    .map((l) => l.replace(/^(confirmed|sent): (\w{12})\w+/, '$1: $2…').replace(/^Sign with the \w+ wallet and send\. |^Sign and send\. /, ''))
    .join('\n');
const shorten = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const pub = (p) => execFileSync('solana-keygen', ['pubkey', p], { encoding: 'utf8' }).trim();

function localWallets() {
  const dir = join(here, '.run/wallets');
  mkdirSync(dir, { recursive: true });
  const k = { buyer: join(dir, 'buyer.json'), merchant: join(dir, 'merchant.json') };
  for (const p of Object.values(k)) {
    execFileSync('solana-keygen', ['new', '--no-bip39-passphrase', '--silent', '--force', '-o', p]);
    execFileSync('solana', ['-u', rpc, 'airdrop', '5', pub(p)]);
  }
  const deployer = join(here, '.run/deployer.json');
  execFileSync('spl-token', ['-u', rpc, 'transfer', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', '5', pub(k.buyer), '--fund-recipient', '--owner', deployer, '--fee-payer', deployer]);
  return k;
}

// Act 1: a buyer agent looks for a merchant.
const found = cli(['find', 'text', 'summary', '--limit', '3']);
const top = /\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/.exec(found)?.[1];
const checked = top ? cli(['check', top, '0.25']) : '';
const act1 = [
  { cmd: `export TESSERA_API_URL=${api}`, out: '# the Tessera API. My wallet key stays on this machine.', after: 900 },
  { cmd: 'tessera find text summary --limit 3', out: found, after: 3200 },
  ...(top ? [{ cmd: `tessera check ${top} 0.25`, out: checked, after: 2600 }] : []),
];

// Act 3: a merchant agent and a buyer agent trade through the API.
const keys = live
  ? { buyer: opt('buyer-key', '').replace(/^~/, homedir()), merchant: opt('merchant-key', '').replace(/^~/, homedir()) }
  : localWallets();
if (!existsSync(keys.buyer) || !existsSync(keys.merchant)) throw new Error('live mode needs --buyer-key and --merchant-key (funded devnet keypairs)');
const BUYER = pub(keys.buyer);
const SHOP = pub(keys.merchant);
const REQ = '{"service":"summary","text":"Q3 sales rose 12% on new accounts."}';
const RESULT = '{"summary":"Sales grew 12% in Q3, led by new accounts."}';
const quote = cli(['open', 'merchant', '--buyer', BUYER, '--amount', '0.25', '--request', REQ, '--keypair', keys.merchant, '--send']);
const ORDER = /^order (\w+)/m.exec(quote)?.[1];
if (!ORDER) throw new Error(`the merchant's open failed:\n${quote}`);
const act3 = [
  { pane: 0, cmd: `tessera open merchant --buyer ${shorten(BUYER)} --amount 0.25 --request "$REQ" --keypair shop.json --send`, out: tidy(quote, true) },
  { pane: 1, cmd: `tessera check ${shorten(SHOP)} 0.25`, out: cli(['check', SHOP, '0.25', '--buyer', BUYER]) },
  { pane: 1, cmd: `tessera open buyer --merchant ${shorten(SHOP)} --order ${shorten(ORDER)} --amount 0.25 --request "$REQ" --keypair me.json --send`, out: tidy(cli(['open', 'buyer', '--merchant', SHOP, '--order', ORDER, '--amount', '0.25', '--request', REQ, '--keypair', keys.buyer, '--send'])) },
  { pane: 0, cmd: `tessera deliver ${shorten(ORDER)} --deliverable "$RESULT" --keypair shop.json --send`, out: tidy(cli(['deliver', ORDER, '--deliverable', RESULT, '--keypair', keys.merchant, '--send'])) },
  { pane: 1, cmd: `tessera release ${shorten(ORDER)} --keypair me.json --send`, out: tidy(cli(['release', ORDER, '--keypair', keys.buyer, '--send'])) },
  { pane: 1, cmd: `tessera report ${shorten(ORDER)} --outcome satisfied --rating 5 --comment "Fast and accurate." --keypair me.json --send`, out: tidy(cli(['report', ORDER, '--outcome', 'satisfied', '--rating', '5', '--comment', 'Fast and accurate.', '--keypair', keys.buyer, '--send'])) },
  { pane: 0, cmd: `tessera score ${shorten(SHOP)}`, out: cli(['score', SHOP]), after: 3200 },
].map((e) => ({ after: 2000, ...e }));
writeFileSync(join(work, 'entries.json'), JSON.stringify({ act1, act3 }, null, 2));
if (argv.includes('--plan-only')) process.exit(0);
const act3Says = [
  'Now both sides, through the API. On the left, my merchant agent quotes an order with its own escrow.',
  'On the right, a buyer agent checks the merchant first. It is new, so the money will be held.',
  'The buyer pays into the escrow, not to the merchant.',
  'The merchant delivers and commits a hash of what it sent.',
  'The buyer confirms receipt, and the merchant is paid, less a 1% fee.',
  'The buyer leaves a review. It counts because a real order settled.',
  'The merchant now has one sale and one review on its credit file.',
];

// ---- record
const browser = await chromium.launch({
  headless: true,
  executablePath: opt('chrome', existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined),
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  recordVideo: { dir: work, size: { width: 1600, height: 900 } },
});
await context.addInitScript(CURSOR, { tag: live ? '' : 'Local Solana validator · the real Tessera program' });
const page = await context.newPage();
page.on('pageerror', (e) => console.error(`page error: ${e.message}`));
const t0 = Date.now();
const cues = [];
const say = (text) => cues.push({ at: (Date.now() - t0) / 1000, text });
/** Load a page of the site fresh: after a terminal scene, a goto that only changes the hash would keep the terminal on screen. */
async function open(hash) {
  await page.goto('about:blank');
  await page.goto(`${site}/${hash}`);
  await page.waitForFunction(() => document.body.innerText.length > 600, null, { timeout: 30_000 }).catch(() => {});
}
/** Play a terminal scene, with one subtitle as each command starts. */
async function terminal(entries, says, titles) {
  await page.setContent(terminalHtml(entries, { titles }));
  await page.mouse.move(1500, 860, { steps: 6 });
  for (const [i, text] of says.entries()) {
    await page.waitForFunction((n) => window.__step >= n, i, { timeout: 120_000 }).catch(() => {});
    say(text);
  }
  await page.waitForFunction(() => window.__typed === true, null, { timeout: 180_000 }).catch(() => {});
}

await page.goto(`${site}/#/network`);
await page.mouse.move(800, 450);
// Start the film once the page has read the chain, not on a blank page.
await page.waitForFunction(() => document.body.innerText.length > 600, null, { timeout: 30_000 }).catch(() => {});
await pause(1200);
const start = (Date.now() - t0) / 1000;

// 0. the network, briefly
say('Tessera: escrow and credit scores for AI agents that pay each other on Solana.');
await page.mouse.move(760, 440, { steps: 18 });
await pause(2600);
say('Squares are merchant agents, circles are buyers, and each coin is money held in escrow.');
await page.mouse.move(1000, 520, { steps: 18 });
await pause(2800);

// 1. a buyer agent finds merchants, ranked with their tier
await terminal(act1, [
  'I use the Tessera API from my terminal. My wallet key never leaves my machine.',
  'One call finds merchants for a need, ranked by their on-chain record, with each tier listed.',
  'Then I check the top one: how long would my money be held?',
]);
await pause(400);

// 2. buy from the top merchant on the website
say('Now I buy from that same merchant on the website.');
await open('#/market');
await pause(1200);
const funds = page.getByRole('button', { name: /Get test funds/ });
if (await funds.isVisible().catch(() => false)) {
  await glide(page, funds);
  await click(page);
  await page.getByText(/Sent .* test USDC|already funded|once per wallet/i).first().waitFor({ timeout: 30_000 }).catch(() => {});
}
await pause(600);
const card = top ? page.locator('div', { has: page.locator(`a[href="#/agents/${top}"]`) }).filter({ has: page.getByRole('button', { name: /^Buy$/ }) }).last() : null;
const buy = card && (await card.count()) ? card.getByRole('button', { name: /^Buy$/ }).first() : page.getByRole('button', { name: /^Buy$/ }).first();
await glide(page, buy);
await click(page);
await pause(1100);
const payBtn = page.getByRole('button', { name: /^Pay \$/ });
await glide(page, payBtn);
say('The page checks the order on-chain, then pays into the escrow.');
await click(page);
await page.getByText(/In escrow|Settled instantly|Released early/).first().waitFor({ timeout: 120_000 }).catch(() => {});
say('It checks the delivery against the hash the merchant committed.');
await pause(2400);
if (await page.getByRole('button', { name: 'Release now' }).isVisible().catch(() => false)) {
  say('My wallet is fresh, so the money is held. I confirm receipt, and the merchant is paid.');
  await glide(page, page.getByRole('button', { name: 'Release now' }));
  await click(page);
  await page.getByText(/Released early|Settled after/).first().waitFor({ timeout: 90_000 }).catch(() => {});
  await pause(1400);
}
say('My review goes on-chain, weighted by the money behind it.');
const five = page.getByRole('radio', { name: '5 stars' });
if (await five.isVisible().catch(() => false)) {
  await glide(page, five);
  await click(page);
  await glide(page, page.locator('textarea').last());
  await click(page);
  await typeSlowly(page, 'Fast and exactly what I asked for.');
  await glide(page, page.getByRole('button', { name: 'Post review on-chain' }));
  await click(page);
  await page.getByText(/Your review is on-chain/).waitFor({ timeout: 60_000 }).catch(() => {});
}
await pause(1400);

// 3. both sides, through the API
await terminal(act3, act3Says, ['Merchant agent · my shop', 'Buyer agent']);
await pause(300);

// 4. the merchant's credit file on the website
say('The same credit file is public on the website, for any buyer to check.');
await open(`#/agents/${SHOP}`);
await pause(1800);
await smoothScroll(page, 650);
await pause(2200);

// 5. close
await page.setContent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0b0c0a;color:#f4f1e6;font:500 40px Inter,system-ui">
  <div style="text-align:center;line-height:1.5">Tessera<div style="font-size:26px;color:#b9f8da;margin-top:10px">github.com/edison9733/agentic_commerce</div>
  <div style="font-size:22px;color:#8b8a7c;margin-top:18px">Devnet only · test money · one arbiter key · no third-party audit</div></div></body>`);
say(live ? 'Recorded live on Solana devnet with test money.' : 'Recorded on a local Solana validator running the real Tessera program.');
await pause(3400);
const end = (Date.now() - t0) / 1000;

await page.close();
await context.close();
await browser.close();

const raw = readdirSync(work).find((f) => f.endsWith('.webm'));
renameSync(join(work, raw), join(work, 'raw.webm'));
const shifted = cues.map((c) => ({ ...c, at: Math.max(0, c.at - start) }));
writeFileSync(join(outDir, `${name}.srt`), srt(shifted, end - start));
burn(join(work, 'raw.webm'), join(outDir, `${name}.srt`), join(outDir, `${name}.mp4`), start);
console.log(`${name}: ${(end - start).toFixed(1)} s, ${cues.length} subtitles -> pitch/out/${name}.mp4`);
