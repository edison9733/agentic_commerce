/**
 * Records the demo video: the real website and the real CLI, driven like a
 * person would drive them, with a large visible cursor and English subtitles
 * burned in. No slides and no voice.
 *
 *   node pitch/studio/record-demo.mjs                       (the local studio: pitch/studio/up.sh)
 *   node pitch/studio/record-demo.mjs --live                (the live site and devnet, from your own computer)
 *
 * Options: --site URL, --api URL, --rpc URL, --out NAME, --chrome PATH.
 * Needs ffmpeg on PATH. On your own computer, `npx playwright install chromium` once.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// ---- the terminal scene: run the real CLI first, replay its real output on camera
function cli(args) {
  const env = { ...process.env, ...(api ? { TESSERA_API_URL: api } : {}), TESSERA_RPC_URLS: rpc, NO_COLOR: '1' };
  try {
    return execFileSync('npx', ['tsx', 'apps/cli/src/cli.ts', ...args], { cwd: repo, env, encoding: 'utf8', timeout: 90_000 }).trimEnd();
  } catch (e) {
    return String(e.stdout ?? '').trimEnd() || `(${args[0]} failed: ${String(e.message).split('\n')[0]})`;
  }
}
const found = cli(['find', 'text', 'summary', '--limit', '3']);
const top = /\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/.exec(found)?.[1];
const checked = top ? cli(['check', top, '5']) : '';
const terminal = [
  { cmd: 'npm run tessera -- find text summary --limit 3', out: found },
  ...(top ? [{ cmd: `npm run tessera -- check ${top.slice(0, 4)}… 5`, out: checked }] : []),
];

// ---- record
const browser = await chromium.launch({
  headless: true,
  executablePath: opt('chrome', existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined),
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  recordVideo: { dir: work, size: { width: 1920, height: 1080 } },
});
await context.addInitScript(CURSOR, { tag: live ? '' : 'Local Solana validator · the real Tessera program' });
const page = await context.newPage();
const t0 = Date.now();
const cues = [];
const say = (text) => cues.push({ at: (Date.now() - t0) / 1000, text });
const go = async (hash, wait = 2500) => {
  await page.evaluate((h) => (window.location.hash = h), hash).catch(() => page.goto(`${site}/${hash}`));
  await pause(wait);
};

await page.goto(`${site}/#/`);
await page.mouse.move(800, 450);
// Start the film once the page has read the chain, not on a blank page.
await page.waitForFunction(() => document.body.innerText.length > 600, null, { timeout: 30_000 }).catch(() => {});
await pause(800);
const start = (Date.now() - t0) / 1000;

// 1. the live network
say('Tessera. This page reads Solana directly. Squares are merchant agents, circles are buyers.');
await glide(page, 'a[href="#/network"]');
await click(page);
await page.mouse.move(760, 440, { steps: 18 });
await pause(1800);
say('A coin on a line is money held in escrow.');
await page.mouse.move(1000, 520, { steps: 18 });
await pause(1600);

// 2. a credit file
say('Every wallet has a public credit file.');
await glide(page, 'a[href="#/agents"]');
await click(page);
await pause(1600);
await glide(page, page.getByRole('button', { name: 'Merchants', exact: true }));
await click(page);
await pause(600);
await glide(page, page.locator('tbody tr').first());
await click(page);
await pause(1600);
say('Each review shows its weight, and each one needed a real settled order.');
await smoothScroll(page, 700);
await pause(1700);

// 3. a purchase on the Market
say('Now I buy something. First, test funds for this browser’s wallet.');
await go('#/market', 1800);
const funds = page.getByRole('button', { name: /Get test funds/ });
if (await funds.isVisible().catch(() => false)) {
  await glide(page, funds);
  await click(page);
  await page.getByText(/Sent .* test USDC|already funded|once per wallet/i).first().waitFor({ timeout: 30_000 }).catch(() => {});
}
await pause(800);
const buy = page.getByRole('button', { name: /^Buy$/ }).first();
await glide(page, buy);
await click(page);
await pause(1200);
const payBtn = page.getByRole('button', { name: /^Pay \$/ });
await glide(page, payBtn);
say('The money goes into escrow, not to the merchant.');
await click(page);
await page.getByText(/In escrow|Settled instantly|Released early/).first().waitFor({ timeout: 120_000 }).catch(() => {});
say('The page checks the delivery against the hash the merchant committed.');
await pause(2200);
if (await page.getByRole('button', { name: 'Release now' }).isVisible().catch(() => false)) {
  say('A fresh wallet’s money is held. I confirm receipt, and the merchant is paid.');
  await glide(page, page.getByRole('button', { name: 'Release now' }));
  await click(page);
  await page.getByText(/Released early|Settled after/).first().waitFor({ timeout: 90_000 }).catch(() => {});
  await pause(1200);
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
await pause(1300);

// 4. the score
say('The score is public maths, the same code the program runs.');
await go('#/formula', 1800);
const preset = (label) => page.getByRole('button', { name: new RegExp(`^${label}`) }).first();
await preset('Sells to itself').scrollIntoViewIfNeeded().catch(() => {});
await pause(600);
say('A wallet that only sells to itself stays low.');
await glide(page, preset('Sells to itself'));
await click(page);
await pause(2600);
say('Real customers and reviews make it climb, and the hold shrinks.');
await glide(page, preset('Busy and well reviewed'));
await click(page);
await pause(2800);

// 5. an agent, from a terminal
say('An agent does the same from a terminal. One call ranks merchants by reviews that each cost a real sale.');
await page.setContent(terminalHtml(terminal));
await page.mouse.move(1400, 820, { steps: 8 });
await page.waitForFunction(() => window.__typed === true, null, { timeout: 120_000 }).catch(() => {});
await pause(600);

// 6. close
await page.setContent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0b0c0a;color:#f4f1e6;font:500 40px Inter,system-ui">
  <div style="text-align:center;line-height:1.5">Tessera<div style="font-size:26px;color:#b9f8da;margin-top:10px">github.com/edison9733/agentic_commerce</div>
  <div style="font-size:22px;color:#8b8a7c;margin-top:18px">Devnet only · test money · one arbiter key · no third-party audit</div></div></body>`);
say(live ? 'Recorded live on Solana devnet with test money.' : 'Recorded on a local Solana validator running the real Tessera program.');
await pause(3200);
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
