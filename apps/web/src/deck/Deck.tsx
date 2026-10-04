import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { EASE } from '../components/ui';
import { useChain } from '../lib/store';

/**
 * A slide deck that is also a web page. Each slide is a React component on a
 * fixed 1600x900 stage that scales to the window, so a recording at any 16:9
 * size looks the same, and a slide can embed the live site.
 *
 *   → / space   next          n   speaker notes
 *   ←           previous      a   autoplay (each slide for its `seconds`)
 *
 * `?auto=1` starts autoplay, `?clean=1` hides the chrome, `?i=4` starts on
 * slide 5, `?t=7,13,12` overrides the seconds per slide (the recorder sizes
 * them to the narration), and `?wait=1` holds the first slide until the
 * chain has been read. With autoplay the deck sets `window.__deck.done` when
 * it ends, which is what the recorder waits for.
 */
export type Slide = {
  id: string;
  /** What to say over this slide. The same text is the video script. */
  say: string;
  /** How long autoplay stays here. Sized to the narration. */
  seconds: number;
  surface?: 'night' | 'paper';
  render: (ctx: { active: boolean }) => ReactNode;
};

const W = 1600;
const H = 900;

declare global {
  interface Window {
    __deck?: { index: number; total: number; done: boolean; startedAt?: number };
  }
}

export function Deck({ slides, title }: { slides: Slide[]; title: string }) {
  const query = useMemo(() => new URLSearchParams(window.location.hash.split('?')[1] ?? ''), []);
  const [i, setI] = useState(() => Math.min(slides.length - 1, Number(query.get('i') ?? 0)));
  const [auto, setAuto] = useState(query.get('auto') === '1');
  const [notes, setNotes] = useState(false);
  const clean = query.get('clean') === '1';
  const [scale, setScale] = useState(1);
  // Start reading the chain on slide one, so a later slide that shows live data has it.
  const { status } = useChain();
  const timings = useMemo(() => (query.get('t') ?? '').split(',').map(Number).filter((n) => n > 0), [query]);
  const secondsOf = useCallback((k: number) => timings[k] ?? slides[k]!.seconds, [timings, slides]);
  const [ready, setReady] = useState(query.get('wait') !== '1');
  useEffect(() => {
    if (ready) return;
    if (status === 'live') return void setReady(true);
    const t = setTimeout(() => setReady(true), 25_000);
    return () => clearTimeout(t);
  }, [ready, status]);
  const [startedAt, setStartedAt] = useState<number | undefined>(undefined);

  // `#/deck/pitch?i=4` jumps to slide 5, also when the deck is already open.
  useEffect(() => {
    const on = () => {
      const n = Number(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('i'));
      if (Number.isFinite(n)) setI(Math.max(0, Math.min(slides.length - 1, n)));
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [slides.length]);

  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / W, window.innerHeight / H));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const next = useCallback(() => setI((v) => Math.min(slides.length - 1, v + 1)), [slides.length]);
  const prev = useCallback(() => setI((v) => Math.max(0, v - 1)), []);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (['ArrowRight', ' ', 'PageDown'].includes(e.key)) next();
      else if (['ArrowLeft', 'PageUp'].includes(e.key)) prev();
      else if (e.key === 'n') setNotes((v) => !v);
      else if (e.key === 'a') setAuto((v) => !v);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [next, prev]);

  useEffect(() => {
    if (auto && ready && startedAt === undefined) setStartedAt(Date.now());
  }, [auto, ready, startedAt]);

  useEffect(() => {
    window.__deck = { index: i, total: slides.length, done: false, startedAt };
    if (!auto || !ready || startedAt === undefined) return;
    const t = setTimeout(() => {
      if (i < slides.length - 1) next();
      else window.__deck = { index: i, total: slides.length, done: true, startedAt };
    }, secondsOf(i) * 1000);
    return () => clearTimeout(t);
  }, [auto, ready, startedAt, i, next, slides, secondsOf]);

  const s = slides[i]!;
  const night = (s.surface ?? 'night') === 'night';
  const total = Math.round(slides.reduce((n, _x, k) => n + secondsOf(k), 0));

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', overflow: 'hidden' }} onClick={() => !clean && next()}>
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: 'center', overflow: 'hidden' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={s.id}
            className={night ? 'night gridded' : ''}
            initial={{ opacity: 0, scale: 1.015 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.55, ease: EASE }}
            style={{ position: 'absolute', inset: 0, background: night ? undefined : '#fbf8ef', color: night ? '#c9c6b6' : '#14130f' }}
          >
            {s.render({ active: true })}
          </motion.div>
        </AnimatePresence>
        {!clean && (
          <div className="mono" style={{ position: 'absolute', left: 28, bottom: 18, fontSize: 13, color: night ? '#5d5c52' : '#878371' }}>
            {title} · {i + 1} / {slides.length} · {auto ? 'autoplay' : '→ next · n notes · a autoplay'} · {Math.floor(total / 60)}:{String(total % 60).padStart(2, '0')} total
          </div>
        )}
        <div style={{ position: 'absolute', left: 0, bottom: 0, height: 3, width: `${((i + 1) / slides.length) * 100}%`, background: night ? '#4fd19a' : '#126b4a', transition: 'width 0.5s' }} />
        {notes && (
          <div style={{ position: 'absolute', left: 60, right: 60, bottom: 54, padding: '18px 24px', borderRadius: 16, background: 'rgba(10,11,9,0.92)', color: '#f1eee2', fontSize: 24, lineHeight: 1.45, border: '1px solid #272b21' }}>
            {s.say}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- building blocks every slide shares

export const Frame = ({ children, center = false, pad = 96 }: { children: ReactNode; center?: boolean; pad?: number }) => (
  <div style={{ position: 'absolute', inset: 0, padding: pad, display: 'flex', flexDirection: 'column', justifyContent: center ? 'center' : 'flex-start', alignItems: center ? 'center' : 'stretch', textAlign: center ? 'center' : 'left' }}>
    {children}
  </div>
);

export const Kicker = ({ children, color }: { children: ReactNode; color?: string }) => (
  <motion.div className="eyebrow" style={{ fontSize: 17, color: color ?? '#8b8a7c' }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE }}>
    {children}
  </motion.div>
);

export const Big = ({ children, size = 112, delay = 0.1, color, max }: { children: ReactNode; size?: number; delay?: number; color?: string; max?: string }) => (
  <motion.h1 className="display" style={{ fontSize: size, margin: '18px 0 0', color, maxWidth: max }} initial={{ opacity: 0, y: 34 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, ease: EASE, delay }}>
    {children}
  </motion.h1>
);

export const Body = ({ children, delay = 0.5, size = 34, max = '34ch', color }: { children: ReactNode; delay?: number; size?: number; max?: string; color?: string }) => (
  <motion.p style={{ fontSize: size, lineHeight: 1.35, margin: '36px 0 0', maxWidth: max, color }} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE, delay }}>
    {children}
  </motion.p>
);

/** Where a number came from. Every external figure on a slide carries one. */
export const Source = ({ children, dark = true }: { children: ReactNode; dark?: boolean }) => (
  <motion.div className="mono" style={{ position: 'absolute', left: 96, bottom: 58, fontSize: 15, color: dark ? '#5d5c52' : '#878371' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1, duration: 0.8 }}>
    {children}
  </motion.div>
);

export const Rise = ({ children, delay = 0, y = 26, style }: { children: ReactNode; delay?: number; y?: number; style?: React.CSSProperties }) => (
  <motion.div style={style} initial={{ opacity: 0, y }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE, delay }}>
    {children}
  </motion.div>
);
