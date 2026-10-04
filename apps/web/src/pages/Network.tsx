import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { OrderState } from '@tessera/sdk';
import { Feed } from '../components/Feed';
import { Graph, GraphLegend } from '../components/Graph';
import { Nav } from '../components/Nav';
import { Breakdown, Counter, EASE, ScoreGauge, Stars, TierBadge } from '../components/ui';
import { compactUsd, duration, explorerAddress, short, tierName } from '../lib/format';
import { Link } from '../lib/router';
import { useChain, useProfiles } from '../lib/store';

export function Network() {
  const { pairs, orders, feed, config, status, error } = useChain();
  const { profiles, byWallet, params } = useProfiles();
  const [picked, setPicked] = useState<string | null>(null);
  const sel = picked ? byWallet.get(picked) ?? null : null;

  const stats = useMemo(() => {
    const held = orders.filter((o) => o.data.state === OrderState.Delivered || o.data.state === OrderState.Funded);
    const settled = orders.filter((o) => o.data.state === OrderState.Released);
    return {
      inEscrow: held.reduce((s, o) => s + o.data.amount, 0n),
      heldCount: held.length,
      instant: settled.filter((o) => o.data.instant).length,
      settled: settled.length,
      disputes: orders.filter((o) => o.data.state === OrderState.Disputed || o.data.state === OrderState.Resolved).length,
    };
  }, [orders]);

  return (
    <div className="night gridded" style={{ minHeight: '100dvh' }}>
      <Nav dark />
      <div className="wrap" style={{ width: 'min(1480px, 100% - 2rem)' }}>
        <div className="flex flex-wrap items-end justify-between gap-6 pb-5 pt-6">
          <div>
            <div className="eyebrow" style={{ color: '#8b8a7c' }}>
              Solana devnet · program <a className="link" href={explorerAddress('TessSeP5QV5Bxpvm73iEefdsTjgtTEokKSx7jqFn1CQ')} target="_blank" rel="noreferrer">TessSe…1CQ</a>
            </div>
            <h1 className="display mt-2 text-[clamp(2.2rem,4.4vw,3.6rem)]" style={{ color: '#f1eee2' }}>
              The network, <em>as the chain sees it.</em>
            </h1>
          </div>
          <div className="mono grid grid-cols-2 gap-x-9 gap-y-3 text-[0.78rem] sm:grid-cols-5" style={{ color: '#8b8a7c' }}>
            {[
              ['agents', profiles.length, (n: number) => String(Math.round(n))],
              ['orders settled', Number(config?.ordersSettled ?? 0n), (n: number) => String(Math.round(n))],
              ['volume', Number(config?.volumeSettled ?? 0n), (n: number) => compactUsd(BigInt(Math.round(n)))],
              ['in escrow now', Number(stats.inEscrow), (n: number) => compactUsd(BigInt(Math.round(n)))],
              ['settled instantly', stats.instant, (n: number) => String(Math.round(n))],
            ].map(([label, value, fmt]) => (
              <div key={label as string}>
                <div className="display text-[1.9rem] leading-none" style={{ color: '#f1eee2' }}>
                  <Counter value={value as number} format={fmt as (n: number) => string} />
                </div>
                <div className="mt-1.5">{label as string}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 pb-10 lg:grid-cols-[1fr_380px]">
          <div className="card-night" style={{ position: 'relative', overflow: 'hidden' }}>
            {status === 'error' && (
              <div className="mono p-6 text-[0.85rem]" style={{ color: '#ec835a' }}>
                Could not reach Solana devnet: {error}. The public RPC rate-limits; this page retries every few seconds.
              </div>
            )}
            <Graph profiles={profiles} pairs={pairs} orders={orders} feed={feed} height="min(72dvh, 760px)" onPick={(w) => setPicked((p) => (p === w ? null : w))} selected={picked} />
            <div style={{ position: 'absolute', left: 18, bottom: 14, right: 18 }}>
              <GraphLegend />
            </div>
            <div className="mono" style={{ position: 'absolute', right: 18, top: 14, fontSize: '0.7rem', color: '#5d5c52', textAlign: 'right' }}>
              node size = settled volume · click a node
              <br />
              every node, edge and coin is an account you can open in Explorer
            </div>
          </div>

          <div className="grid content-start gap-4">
            <motion.div layout className="card-night p-5" transition={{ duration: 0.5, ease: EASE }}>
              {sel && params ? (
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="display text-[1.9rem] leading-none" style={{ color: '#f1eee2' }}>{sel.name}</div>
                      <div className="mono mt-1.5 text-[0.72rem]" style={{ color: '#8b8a7c' }}>
                        {sel.role} · <a className="link" href={explorerAddress(sel.wallet)} target="_blank" rel="noreferrer">{short(sel.wallet, 5)}</a>
                      </div>
                    </div>
                    <TierBadge tier={sel.eval.tier} dark />
                  </div>
                  <div className="grid place-items-center pt-2">
                    <ScoreGauge e={sel.eval} dark size={210} thresholds={params.tierScore} />
                  </div>
                  <Breakdown e={sel.eval} dark />
                  <div className="mono mt-4 grid grid-cols-2 gap-y-2 text-[0.76rem]" style={{ color: '#8b8a7c' }}>
                    <span>rating</span>
                    <span className="text-right"><Stars value={sel.stars} dark /></span>
                    <span>settles with a Trusted party</span>
                    <span className="text-right" style={{ color: '#e9e6d8' }}>{duration(params.holdSecs[sel.eval.tier]!)}</span>
                    <span>orders settled</span>
                    <span className="text-right" style={{ color: '#e9e6d8' }}>{sel.orders}</span>
                    <span>disputes lost</span>
                    <span className="text-right" style={{ color: '#e9e6d8' }}>{sel.agent.asBuyer.disputesLost + sel.agent.asMerchant.disputesLost}</span>
                  </div>
                  <Link to={`/agents/${sel.wallet}`} className="btn btn-ghost mt-5 w-full justify-center">
                    Full credit file →
                  </Link>
                </div>
              ) : (
                <div>
                  <div className="eyebrow" style={{ color: '#8b8a7c' }}>Tiers right now</div>
                  <div className="mt-4 grid gap-3">
                    {[3, 2, 1, 0].map((t) => {
                      const n = profiles.filter((p) => p.eval.tier === t).length;
                      return (
                        <div key={t} className="grid items-center gap-3" style={{ gridTemplateColumns: '7.5rem 1fr 4.5rem' }}>
                          <TierBadge tier={t} dark />
                          <span style={{ height: 6, borderRadius: 6, background: '#1c1f18', overflow: 'hidden' }}>
                            <motion.span
                              style={{ display: 'block', height: '100%', background: ['#35705a', '#2f9e73', '#4fd19a', '#b9f8da'][t], borderRadius: 6 }}
                              animate={{ width: `${profiles.length ? (n / profiles.length) * 100 : 0}%` }}
                              transition={{ duration: 0.8, ease: EASE }}
                            />
                          </span>
                          <span className="mono text-right text-[0.74rem]" style={{ color: '#8b8a7c' }}>
                            {n} · {params ? duration(params.holdSecs[t]!) : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-4 text-[0.82rem] leading-relaxed" style={{ color: '#8b8a7c' }}>
                    The hold on an order is the longer of the two parties' holds. {tierName(0)} wallets wait {params ? duration(params.holdSecs[0]!) : ''};
                    two {tierName(3)} wallets settle in the same transaction as delivery.
                  </p>
                </div>
              )}
            </motion.div>

            <div className="card-night p-5">
              <div className="flex items-center justify-between">
                <div className="eyebrow" style={{ color: '#8b8a7c' }}>On-chain, just now</div>
                <span className="mono text-[0.68rem]" style={{ color: '#5d5c52' }}>{stats.heldCount} in escrow</span>
              </div>
              <div className="mt-2" style={{ maxHeight: 340, overflow: 'auto' }}>
                <Feed events={feed} byWallet={byWallet} limit={16} />
              </div>
            </div>
          </div>
        </div>
        <p className="mono pb-10 text-[0.72rem] leading-relaxed" style={{ color: '#5d5c52', maxWidth: 900 }}>
          This is a demo network on devnet. The traffic is generated by this project's own agents with recycled test USDC, and time is compressed
          (one period is {params?.periodSecs ?? 60} seconds here; the target for mainnet is one day). What is real: every account, every transaction, and every score, which this page recomputes in your browser from the accounts themselves.
        </p>
      </div>
    </div>
  );
}
