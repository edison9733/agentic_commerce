/** Small helpers for recording the product on camera: a visible cursor, human-paced movement, subtitles. */
import { execFileSync } from 'node:child_process';

export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs in every page before its own scripts: a large arrow that follows the
 * real mouse, a ring on every click, and an optional corner label.
 */
export function CURSOR({ tag }) {
  const install = () => {
    if (document.getElementById('__cursor')) return;
    const c = document.createElement('div');
    c.id = '__cursor';
    c.innerHTML =
      '<svg width="46" height="58" viewBox="0 0 22 28"><path d="M2 2 L2 23 L7.4 18.2 L11 26.5 L14.6 25 L11.1 17 L18.6 17 Z" fill="#14130f" stroke="#ffffff" stroke-width="1.7" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, {
      position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none',
      transform: 'translate(800px, 450px)', filter: 'drop-shadow(0 3px 6px rgba(0,0,0,.45))', transition: 'transform 16ms linear',
    });
    document.documentElement.appendChild(c);
    if (tag) {
      const t = document.createElement('div');
      t.textContent = tag;
      Object.assign(t.style, {
        position: 'fixed', right: '18px', top: '14px', zIndex: '2147483646', pointerEvents: 'none',
        font: '500 13px Inter, system-ui, sans-serif', color: '#f4f1e6', background: 'rgba(20,19,15,.78)', padding: '6px 11px', borderRadius: '999px',
      });
      document.documentElement.appendChild(t);
    }
    addEventListener('mousemove', (e) => (c.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 3}px)`), true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      Object.assign(r.style, {
        position: 'fixed', left: `${e.clientX - 26}px`, top: `${e.clientY - 26}px`, width: '52px', height: '52px', borderRadius: '50%',
        border: '4px solid #2f9e73', zIndex: '2147483646', pointerEvents: 'none', transform: 'scale(.3)', opacity: '1', transition: 'transform .45s ease-out, opacity .45s ease-out',
      });
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => Object.assign(r.style, { transform: 'scale(1.4)', opacity: '0' }));
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
  new MutationObserver(() => document.getElementById('__cursor') || install()).observe(document, { childList: true, subtree: true });
}

const pos = new WeakMap();
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Move the real mouse to an element (selector or locator), the way a hand would. */
export async function glide(page, target, ms = 520) {
  const loc = typeof target === 'string' ? page.locator(target).first() : target;
  await loc.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
  const box = await loc.boundingBox().catch(() => null);
  if (!box) return false;
  const to = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const from = pos.get(page) ?? { x: 800, y: 450 };
  const steps = Math.max(12, Math.round(ms / 16));
  for (let i = 1; i <= steps; i += 1) {
    const k = ease(i / steps);
    await page.mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
    await pause(ms / steps);
  }
  pos.set(page, to);
  await pause(140);
  return true;
}

export async function click(page) {
  await page.mouse.down();
  await pause(90);
  await page.mouse.up();
  await pause(250);
}

export async function smoothScroll(page, top) {
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), top);
  await pause(900);
}

export async function typeSlowly(page, text) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await pause(28 + Math.random() * 30);
  }
}

const stamp = (s) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

/** SubRip text from timed lines: each stays up until the next, or as long as it takes to read. */
export function srt(cues, end) {
  const sorted = [...cues].sort((a, b) => a.at - b.at);
  return sorted
    .map((c, i) => {
      const read = 1.4 + c.text.split(/\s+/).length * 0.36;
      const stop = Math.min(sorted[i + 1]?.at ?? end, c.at + Math.max(read, 2.5), end);
      return `${i + 1}\n${stamp(c.at)} --> ${stamp(stop - 0.05)}\n${wrap(c.text)}\n`;
    })
    .join('\n');
}

/** At most two lines of about 48 characters. */
function wrap(text, width = 48) {
  if (text.length <= width) return text;
  const words = text.split(' ');
  let best = text, bestDiff = Infinity;
  for (let i = 1; i < words.length; i += 1) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    const diff = Math.abs(a.length - b.length);
    if (diff < bestDiff) (bestDiff = diff), (best = `${a}\n${b}`);
  }
  return best;
}

/** Scale the 1600×900 recording to 1080p, burn the subtitles in, and encode for upload. */
export function burn(input, subtitles, output, start = 0) {
  const style = 'FontName=Inter,FontSize=15,Bold=0,PrimaryColour=&H00FFFFFF,BackColour=&H38000000,OutlineColour=&H38000000,BorderStyle=4,Outline=0,Shadow=0,MarginV=34,Alignment=2';
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(start), '-i', input, '-vf', `scale=1920:1080:flags=lanczos,subtitles='${subtitles.replace(/'/g, "\\'")}':force_style='${style}'`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', output]);
}

/**
 * A terminal window that types each command, then prints its real output line by line.
 * Entries with `pane: 1` go to a second pane on the right (`titles` names both panes).
 * `window.__step` is the index of the entry being typed, so subtitles can follow it.
 */
export function terminalHtml(entries, { titles } = {}) {
  const split = Boolean(titles);
  const panes = split ? titles : ['tessera — terminal'];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;height:100vh;background:#e9e4d6;display:flex;gap:22px;align-items:flex-start;justify-content:center;padding-top:${split ? 34 : 50}px;box-sizing:border-box;font-family:Inter,system-ui}
  .win{width:${split ? 760 : 1440}px;height:${split ? 700 : 690}px;background:#0f110d;border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.35);overflow:hidden;display:flex;flex-direction:column}
  .bar{height:44px;background:#1c1f19;display:flex;align-items:center;gap:9px;padding:0 18px;color:#c9c6b6;font-size:15px}
  .dot{width:13px;height:13px;border-radius:50%}
  pre{margin:0;padding:${split ? '20px 22px' : '26px 30px'};color:#e8e4d4;font:${split ? '15.5px/1.5' : '20px/1.55'} "DejaVu Sans Mono",monospace;white-space:pre-wrap;overflow-wrap:anywhere;overflow:hidden;flex:1}
  .p{color:#b9f8da}.c{color:#ffffff}.k{color:#8b8a7c}.caret{display:inline-block;width:10px;height:19px;background:#b9f8da;vertical-align:-4px;animation:b 1s steps(1) infinite}
  @keyframes b{50%{opacity:0}}
  </style></head><body>${panes.map((t, i) => `<div class="win"><div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span style="margin-left:12px">${t}</span></div><pre id="t${i}"></pre></div>`).join('')}
  <script>
  const entries = ${JSON.stringify(entries.map((e) => ({ pane: e.pane ?? 0, cmd: e.cmd, out: e.out ? e.out.split("\n") : [], after: e.after })))};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pre = (i) => document.getElementById('t' + i);
  const add = (i, html) => { const t = pre(i); t.querySelector('.caret')?.remove(); t.insertAdjacentHTML('beforeend', html); t.scrollTop = t.scrollHeight; };
  const prompt = (i) => add(i, '<span class="p">edison@tessera ~ $ </span>');
  window.__step = -1;
  (async () => {
    for (let i = 0; i < ${panes.length}; i += 1) { prompt(i); add(i, '<span class="caret"></span>'); }
    await wait(500);
    for (const [n, e] of entries.entries()) {
      window.__step = n;
      add(e.pane, '<span class="c"></span>');
      const c = pre(e.pane).querySelectorAll('.c'); const cmd = c[c.length - 1];
      for (const ch of e.cmd) { cmd.textContent += ch; await wait(16 + Math.random() * 18); }
      add(e.pane, '\\n'); await wait(350);
      for (const line of e.out) { add(e.pane, (line.startsWith('#') ? '<span class="k">' : '<span>') + line.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</span>\\n'); await wait(45); }
      add(e.pane, '\\n'); prompt(e.pane); add(e.pane, '<span class="caret"></span>'); await wait(e.after ?? 1500);
    }
    window.__typed = true;
  })();
  </script></body></html>`;
}
