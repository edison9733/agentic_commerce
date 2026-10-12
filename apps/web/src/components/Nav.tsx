import { motion, useMotionValueEvent, useScroll } from 'motion/react';
import { useEffect, useState } from 'react';
import { Link, usePath } from '../lib/router';
import { useChain } from '../lib/store';
import { Logo } from './ui';

const LINKS: [string, string][] = [
  ['/network', 'Live network'],
  ['/agents', 'Agents'],
  ['/market', 'Market'],
  ['/formula', 'The score'],
  ['/developers', 'For agents'],
];

export function Nav({ dark = false }: { dark?: boolean }) {
  const path = usePath();
  const { status } = useChain();
  const { scrollY } = useScroll();
  const [solid, setSolid] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useMotionValueEvent(scrollY, 'change', (y) => setSolid(y > 24));
  const bg = dark ? 'rgba(10,11,9,0.72)' : 'rgba(251,248,239,0.78)';
  return (
    <motion.header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        backdropFilter: solid ? 'blur(14px) saturate(1.4)' : 'none',
        WebkitBackdropFilter: solid ? 'blur(14px) saturate(1.4)' : 'none',
        background: solid ? bg : 'transparent',
        borderBottom: `1px solid ${solid ? (dark ? '#272b21' : '#ded7c2') : 'transparent'}`,
        transition: 'background 0.3s, border-color 0.3s',
        color: dark ? '#e9e6d8' : '#14130f',
      }}
    >
      <div className="wrap flex h-[68px] items-center justify-between gap-6">
        <Link to="/" className="flex items-center gap-2.5">
          <Logo invert={dark} />
          <span className="display text-[1.5rem]" style={{ letterSpacing: '-0.03em' }}>
            Tessera
          </span>
        </Link>
        <nav className="hidden items-center gap-7 whitespace-nowrap text-[0.93rem] lg:flex">
          {LINKS.map(([to, label]) => (
            <Link key={to} to={to} className="relative py-1">
              <span style={{ opacity: path.startsWith(to) ? 1 : 0.68 }}>{label}</span>
              {path.startsWith(to) && (
                <motion.span layoutId="nav-underline" style={{ position: 'absolute', left: 0, right: 0, bottom: -2, height: 1.5, background: 'currentColor' }} />
              )}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <span className="mono hidden items-center gap-2 whitespace-nowrap text-[0.72rem] sm:inline-flex" style={{ opacity: 0.75 }} title="Read straight from Solana devnet">
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 7,
                background: status === 'live' ? '#2f9e73' : status === 'error' ? '#d03b3b' : '#fab219',
                boxShadow: status === 'live' ? '0 0 0 4px rgba(47,158,115,0.18)' : 'none',
              }}
            />
            {status === 'live' ? 'devnet · live' : status === 'error' ? 'devnet · unreachable' : 'devnet · loading'}
          </span>
          <button
            className="rounded-full border px-3.5 py-2 text-[0.88rem] lg:hidden"
            style={{ borderColor: dark ? '#3a3f33' : '#cfc8b2', cursor: 'pointer' }}
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="nav-menu"
          >
            {open ? 'Close' : 'Menu'}
          </button>
        </div>
      </div>
      {open && (
        <nav id="nav-menu" className="wrap grid gap-1 pb-4 lg:hidden" style={{ background: dark ? '#0a0b09' : '#fbf8ef' }}>
          {LINKS.map(([to, label]) => (
            <Link key={to} to={to} className="rounded-xl px-3 py-3 text-[1.05rem]" style={{ background: path.startsWith(to) ? (dark ? '#272b21' : '#f1ebd8') : 'transparent' }} onClick={() => setOpen(false)}>
              {label}
            </Link>
          ))}
        </nav>
      )}
    </motion.header>
  );
}
