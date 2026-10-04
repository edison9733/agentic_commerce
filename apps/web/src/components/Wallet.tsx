import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useConnect, useConnectedWallet, useDisconnect, useWallets, WalletReadyGate } from '@solana/kit-plugin-wallet/react';
import { useClient } from '@solana/react';
import type { AppClient } from '../lib/client';
import { short } from '../lib/format';
import { EASE } from './ui';

/** Wallet Standard discovery: any installed Solana wallet shows up, no adapters. */
function Button({ dark }: { dark: boolean }) {
  const client = useClient<AppClient>();
  const wallets = useWallets(client);
  const connected = useConnectedWallet(client);
  const { dispatch: connect } = useConnect(client);
  const { dispatch: disconnect } = useDisconnect(client);
  const [open, setOpen] = useState(false);

  if (connected) {
    return (
      <button className={`btn ${dark ? 'btn-ghost' : 'btn-ghost'}`} onClick={() => disconnect()} title="Disconnect">
        <span style={{ width: 7, height: 7, borderRadius: 7, background: '#2f9e73' }} />
        <span className="mono text-[0.82rem]">{short(connected.account.address)}</span>
      </button>
    );
  }
  return (
    <div style={{ position: 'relative' }}>
      <button className={`btn ${dark ? 'btn-mint' : 'btn-ink'}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Connect wallet
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.25, ease: EASE }}
            style={{
              position: 'absolute',
              right: 0,
              top: 'calc(100% + 8px)',
              minWidth: 240,
              zIndex: 60,
              background: dark ? '#10120e' : '#fff',
              border: `1px solid ${dark ? '#272b21' : '#ded7c2'}`,
              borderRadius: 16,
              padding: 6,
              boxShadow: '0 18px 50px -18px rgba(0,0,0,0.35)',
              color: dark ? '#e9e6d8' : '#14130f',
            }}
          >
            {wallets.length === 0 && (
              <div className="p-3 text-[0.86rem]" style={{ opacity: 0.75 }}>
                No Solana wallet found in this browser. Install one (Phantom, Solflare, Backpack), switch it to devnet, and reload.
              </div>
            )}
            {wallets.map((w) => (
              <button
                key={w.name}
                onClick={() => {
                  connect(w);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[0.92rem] hover:bg-black/5"
                style={{ cursor: 'pointer' }}
              >
                {w.icon && <img src={w.icon} alt="" width={22} height={22} style={{ borderRadius: 6 }} />}
                {w.name}
              </button>
            ))}
            <div className="eyebrow px-3 pb-2 pt-2" style={{ opacity: 0.5 }}>
              Devnet only
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Wallet({ dark = false }: { dark?: boolean }) {
  const client = useClient<AppClient>();
  return (
    <WalletReadyGate client={client} fallback={<button className="btn btn-ghost" disabled>Wallet…</button>}>
      <Button dark={dark} />
    </WalletReadyGate>
  );
}
