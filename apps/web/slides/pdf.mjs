/**
 * The PDF of a deck: every slide screenshotted at 1600x900 once its
 * animations have settled, then printed one slide per page.
 *
 *   npm run slides && npm run slides:pdf            # the pitch
 *   node apps/web/slides/pdf.mjs demo               # another deck
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2] ?? 'pitch';
const html = resolve(here, 'dist', `tessera-${name}-slides.html`);
const out = resolve(here, '../public/decks', `tessera-${name}-deck.pdf`);
const shots = mkdtempSync(join(tmpdir(), 'tessera-deck-'));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`file://${html}#1`);
await page.addStyleTag({ content: '#hint, #fallback { display: none !important; }' });
const n = await page.evaluate(() => document.querySelectorAll('section[data-document-role="page"]').length);
const files = [];
for (let i = 1; i <= n; i++) {
  await page.evaluate((i) => { location.hash = `#${i}`; }, i);
  await page.waitForTimeout(3200);
  const file = join(shots, `slide-${String(i).padStart(2, '0')}.png`);
  await page.screenshot({ path: file });
  files.push(file);
}
await page.setContent(
  `<style>@page { size: 1600px 900px; margin: 0 } body { margin: 0 } img { display: block; width: 1600px; height: 900px; break-after: page }</style>` +
    files.map((f) => `<img src="file://${f}">`).join(''),
  { waitUntil: 'load' },
);
await page.pdf({ path: out, width: '1600px', height: '900px', printBackground: true, preferCSSPageSize: true });
await browser.close();
rmSync(shots, { recursive: true, force: true });
console.log(`${name}: ${n} slides -> ${out}`);
