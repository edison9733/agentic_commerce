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
await pause(1500);
const start = (Date.now() - t0) / 1000;

// 1. the live network
say('This is Tessera. The page reads the Solana chain directly in my browser.');
await glide(page, 'a[href="#/network"]');
await click(page);
await pause(2000);
say('Squares are merchant agents, and circles are buyers.');
await page.mouse.move(700, 420, { steps: 30 });
await pause(3000);
say('A coin on a line is money held in escrow.');
await page.mouse.move(1000, 520, { steps: 30 });
await pause(3000);

// 2. a credit file
say('Every wallet has a public credit file.');
await glide(page, 'a[href="#/agents"]');
await click(page);
await pause(3500);
await glide(page, page.getByRole('button', { name: 'Merchants', exact: true }));
await click(page);
await pause(1200);
await glide(page, page.locator('tbody tr').first());
say('Here is the top merchant, and what its score is made of.');
await click(page);
await pause(3000);
await smoothScroll(page, 650);
say('Every review shows the weight it carried. Each one needed a real settled order.');
await pause(3000);
await smoothScroll(page, 1300);
await pause(2500);

// 3. a purchase on the Market
say('Now the Market. I get test funds for this browser’s test wallet.');
await go('#/market', 3500);
const funds = page.getByRole('button', { name: /Get test funds/ });
if (await funds.isVisible().catch(() => false)) {
  await glide(page, funds);
  await click(page);
  await page.getByText(/Sent .* test USDC|already funded|once per wallet/i).first().waitFor({ timeout: 30_000 }).catch(() => {});
}
await pause(2500);
say('I pick a merchant and press Buy.');
const buy = page.getByRole('button', { name: /^Buy$/ }).first();
await glide(page, buy);
await click(page);
await pause(2500);
const payBtn = page.getByRole('button', { name: /^Pay \$/ });
await glide(page, payBtn);
say('The page checks the order on-chain before it pays, and pays into the escrow, not to the merchant.');
await click(page);
await page.getByText(/In escrow|Settled instantly|Released early/).first().waitFor({ timeout: 120_000 }).catch(() => {});
say('The merchant delivers, and the page checks the delivery against the hash the merchant committed.');
await pause(4500);
if (await page.getByRole('button', { name: 'Release now' }).isVisible().catch(() => false)) {
  say('This is a fresh wallet, so the money is held. I confirm receipt, and the merchant is paid.');
  await pause(2500);
  await glide(page, page.getByRole('button', { name: 'Release now' }));
  await click(page);
  await page.getByText(/Released early|Settled after/).first().waitFor({ timeout: 90_000 }).catch(() => {});
}
await pause(2000);
say('Then I leave a review. It is stored on-chain, with the weight of the money behind it.');
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
await pause(2500);

// 4. the score
say('The score is integer arithmetic over public accounts, the same code the program runs.');
await go('#/formula', 3000);
const preset = (label) => page.getByRole('button', { name: new RegExp(`^${label}`) }).first();
await preset('Brand new').scrollIntoViewIfNeeded().catch(() => {});
await pause(1500);
await glide(page, preset('Brand new'));
await click(page);
await pause(2500);
say('A wallet that only sells to itself stays low.');
await glide(page, preset('Sells to itself'));
await click(page);
await pause(4000);
say('A busy wallet with real customers climbs, and its hold shrinks.');
await glide(page, preset('Busy and well reviewed'));
await click(page);
await pause(4500);

// 5. an agent, from a terminal
say('An agent does the same from a terminal, with no website.');
await page.setContent(terminalHtml(terminal));
await page.mouse.move(1400, 820, { steps: 10 });
await page.waitForFunction(() => window.__typed === true, null, { timeout: 120_000 }).catch(() => {});
await pause(1000);
cues.push({ at: (Date.now() - t0) / 1000 - 6, text: 'One call ranks merchants by reviews that each cost a real sale.' });
await pause(4000);

// 6. close
say(live ? 'Recorded live on Solana devnet with test money.' : 'Recorded on a local Solana validator running the real Tessera program.');
await page.setContent(`<body style="margin:0;height:100vh;display:grid;place-items:center;background:#0b0c0a;color:#f4f1e6;font:500 40px Inter,system-ui">
  <div style="text-align:center;line-height:1.5">Tessera<div style="font-size:26px;color:#b9f8da;margin-top:10px">github.com/edison9733/agentic_commerce</div>
  <div style="font-size:22px;color:#8b8a7c;margin-top:18px">Devnet only · test money · one arbiter key · no third-party audit</div></div></body>`);
await pause(3500);
say('Devnet only, test money, one arbiter key, no third-party audit.');
await pause(3500);
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
