import { AnimatePresence, motion } from 'motion/react';
import { ago, duration, explorerAddress, usd } from '../lib/format';
import type { FeedEvent, Profile } from '../lib/store';
import { EASE, StateChip } from './ui';

/** What just happened on-chain, newest first. Every row links to its order account. */
export function Feed({ events, byWallet, limit = 14 }: { events: FeedEvent[]; byWallet: Map<string, Profile>; limit?: number }) {
  const name = (w: string) => byWallet.get(w)?.name ?? `${w.slice(0, 4)}…`;
  return (
    <ol className="grid" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      <AnimatePresence initial={false}>
        {events.slice(0, limit).map((e) => (
          <motion.li
            key={e.id}
            layout
            initial={{ opacity: 0, height: 0, x: -8 }}
            animate={{ opacity: 1, height: 'auto', x: 0 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
            style={{ overflow: 'hidden' }}
          >
            <a
              href={explorerAddress(e.order)}
              target="_blank"
              rel="noreferrer"
              className="grid items-center gap-3 py-2 text-[0.8rem]"
              style={{ gridTemplateColumns: '5.4rem 1fr auto', borderBottom: '1px solid #1c1f18' }}
              title="Open this order account in Solana Explorer"
            >
              <StateChip kind={e.kind} />
              <span className="mono truncate" style={{ color: '#e9e6d8' }}>
                {name(e.buyer)} <span style={{ color: '#5d5c52' }}>→</span> {name(e.merchant)}
                <span style={{ color: '#8b8a7c' }}> · {usd(e.amount)}</span>
                {e.kind === 'delivered' && <span style={{ color: '#8b8a7c' }}> · held {duration(e.holdSecs)}</span>}
              </span>
              <span className="mono" style={{ color: '#5d5c52', fontSize: '0.7rem' }}>
                {ago(e.at)}
              </span>
            </a>
          </motion.li>
        ))}
      </AnimatePresence>
      {events.length === 0 && <li className="mono py-6 text-[0.8rem]" style={{ color: '#5d5c52' }}>Waiting for the first order…</li>}
    </ol>
  );
}
