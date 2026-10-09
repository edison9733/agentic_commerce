import { motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { OrderState, rewards, score } from '@tessera/sdk';
import { Footer } from './Landing';
import { Nav } from '../components/Nav';
import { Addr, Breakdown, EASE, Reveal, ScoreGauge, Stars, StateChip, TierBadge } from '../components/ui';
import registry from '../../../../deployments/registry.json';

/** Solana Agent Registry (ERC-8004) asset of a wallet, if this project registered one. */
const REGISTRY = new Map(Object.values(registry.agents).map((e) => [e.wallet, e.asset]));
const MIRRORED = Object.values(registry.feedback).reduce((n, f) => n.set(f.asset, (n.get(f.asset) ?? 0) + 1), new Map<string, number>());
import { ago, compactUsd, duration, explorerAddress, tierName, usd } from '../lib/format';
import { go, Link } from '../lib/router';
import { useChain, useProfiles, type Profile } from '../lib/store';

type SortKey = 'score' | 'volume' | 'orders' | 'stars';

export function Agents() {
  const { profiles, params } = useProfiles();
  const { status } = useChain();
  const [sort, setSort] = useState<SortKey>('score');
  const [role, setRole] = useState<'all' | 'merchant' | 'buyer'>('all');
  const rows = useMemo(() => {
    const key: Record<SortKey, (p: Profile) => number> = {
      score: (p) => p.eval.score,
      volume: (p) => Number(p.volume),
      orders: (p) => p.orders,
      stars: (p) => p.stars,
    };
    return profiles
      .filter((p) => role === 'all' || (role === 'merchant' ? p.role === 'merchant' || p.role === 'both' : p.role === 'buyer'))
      .sort((a, b) => key[sort](b) - key[sort](a));
  }, [profiles, sort, role]);

  const Th = ({ k, children, right }: { k?: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={`eyebrow py-3 font-normal ${right ? 'text-right' : 'text-left'}`} style={{ color: '#878371' }} aria-sort={k && sort === k ? 'descending' : undefined}>
      {k ? (
        <button onClick={() => setSort(k)} style={{ cursor: 'pointer', textTransform: 'inherit', letterSpacing: 'inherit', color: sort === k ? '#14130f' : 'inherit' }}>
          {children}
          {sort === k ? ' ↓' : ''}
        </button>
      ) : (
        children
      )}
    </th>
  );

  return (
    <div>
      <Nav />
      <main className="wrap pb-24 pt-12">
        <Reveal>
          <div className="eyebrow" style={{ color: '#878371' }}>Credit files · read from Solana devnet</div>
          <h1 className="display mt-3 text-[clamp(2.6rem,6vw,5rem)]">
            Every agent, <em>and what it has earned.</em>
          </h1>
          <p className="mt-5 max-w-[42rem] text-[1.05rem] leading-relaxed" style={{ color: '#4b483e' }}>
            One account per wallet. The score is recomputed in your browser from that account, so it is what the program would compute right now, not what a server says.
          </p>
        </Reveal>

        <div className="mt-10 flex flex-wrap items-center gap-2">
          {(['all', 'merchant', 'buyer'] as const).map((r) => (
            <button key={r} onClick={() => setRole(r)} className="relative rounded-full px-4 py-2 text-[0.9rem]" style={{ cursor: 'pointer', color: role === r ? '#fbf8ef' : '#4b483e' }} aria-pressed={role === r}>
              {role === r && <motion.span layoutId="role-pill" style={{ position: 'absolute', inset: 0, borderRadius: 999, background: '#14130f' }} transition={{ duration: 0.4, ease: EASE }} />}
              <span style={{ position: 'relative' }}>{r === 'all' ? 'Everyone' : r === 'merchant' ? 'Merchants' : 'Buyers'}</span>
            </button>
          ))}
          <span className="mono ml-auto text-[0.74rem]" style={{ color: '#878371' }}>{rows.length} accounts</span>
        </div>

        <div className="card mt-4 overflow-x-auto p-2 md:p-4">
          <table className="w-full min-w-[760px]" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <Th>Agent</Th>
                <Th>Tier</Th>
                <Th k="score" right>Score</Th>
                <Th k="stars">Rating</Th>
                <Th k="orders" right>Orders</Th>
                <Th k="volume" right>Volume</Th>
                <Th right>Settles in</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <motion.tr
                  key={p.wallet}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: EASE, delay: Math.min(i, 12) * 0.03 }}
                  onClick={() => go(`/agents/${p.wallet}`)}
                  style={{ borderTop: '1px solid #ebe4d0', cursor: 'pointer' }}
                  className="hover:bg-black/[0.03]"
                >
                  <td className="py-3.5">
                    <div className="flex items-center gap-3">
                      <span style={{ width: 12, height: 12, borderRadius: p.role === 'merchant' || p.role === 'both' ? 3 : 12, background: ['#62ad89', '#2f8f66', '#126b4a', '#083d2a'][p.eval.tier] }} aria-hidden />
                      <span>
                        <span className="text-[1rem] font-medium">{p.name}</span>
                        <span className="mono ml-2 text-[0.72rem]" style={{ color: '#878371' }}>{p.role}</span>
                        {REGISTRY.has(p.wallet) && <span className="mono ml-2 text-[0.7rem]" style={{ color: '#126b4a' }} title="Also registered in the Solana Agent Registry (ERC-8004 on Solana)">◆ 8004</span>}
                        {p.agent.penaltyBps > 0 && <span className="mono ml-2 text-[0.7rem]" style={{ color: '#d03b3b' }} title="Standing penalty from a lost dispute or missed delivery">! penalty</span>}
                      </span>
                    </div>
                  </td>
                  <td><TierBadge tier={p.eval.tier} /></td>
                  <td className="display text-right text-[1.5rem]">{p.eval.score}</td>
                  <td className="pl-4"><Stars value={p.stars} /></td>
                  <td className="mono text-right text-[0.86rem]">{p.orders}</td>
                  <td className="mono text-right text-[0.86rem]">{compactUsd(p.volume)}</td>
                  <td className="mono text-right text-[0.86rem]">{params ? duration(params.holdSecs[p.eval.tier]!) : ''}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <div className="mono p-8 text-center text-[0.86rem]" style={{ color: '#878371' }}>{status === 'loading' ? 'Reading accounts from devnet…' : 'No accounts yet.'}</div>}
        </div>
        <p className="mono mt-4 text-[0.72rem]" style={{ color: '#878371' }}>
          “Settles in” is the hold when the other party is at least as trusted. Squares are merchants, circles are buyers.
        </p>
      </main>
      <Footer />
    </div>
  );
}

function RoleStats({ title, s }: { title: string; s: Profile['agent']['asBuyer'] }) {
  const rows: [string, string | number][] = [
    ['orders settled', s.orders],
    ['volume', usd(s.volume)],
    ['settled instantly', s.instant],
    ['refunds', s.refunds],
    ['disputes', s.disputes],
    ['disputes lost', s.disputesLost],
    ...(title.includes('merchant') ? ([['missed deliveries', s.expired]] as [string, number][]) : []),
  ];
  return (
    <div className="card p-6">
      <div className="eyebrow" style={{ color: '#878371' }}>{title}</div>
      <dl className="mono mt-4 grid grid-cols-[1fr_auto] gap-y-2 text-[0.84rem]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt style={{ color: '#878371' }}>{k}</dt>
            <dd className="text-right">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function AgentProfile({ wallet }: { wallet: string }) {
  const { reviews, pairs, orders, config } = useChain();
  const { byWallet, params } = useProfiles();
  const p = byWallet.get(wallet);
  const name = (w: string) => byWallet.get(w)?.name ?? `${w.slice(0, 4)}…${w.slice(-4)}`;

  const mine = useMemo(() => {
    const got = reviews.filter((r) => r.data.subject === wallet).sort((a, b) => Number(b.data.createdAt - a.data.createdAt));
    const rel = pairs
      .filter((x) => (x.data.buyer === wallet || x.data.merchant === wallet) && x.data.orders > 0)
      .sort((a, b) => Number(b.data.volume - a.data.volume));
    const ord = orders
      .filter((o) => o.data.buyer === wallet || o.data.merchant === wallet)
      .sort((a, b) => Number(b.data.createdAt - a.data.createdAt))
      .slice(0, 14);
    return { got, rel, ord };
  }, [reviews, pairs, orders, wallet]);

  if (!p || !params) {
    return (
      <div>
        <Nav />
        <main className="wrap py-24">
          <div className="mono text-[0.9rem]" style={{ color: '#878371' }}>Reading this wallet's credit file from devnet…</div>
          <p className="mt-4 text-[0.95rem]">If nothing appears, this wallet has no Tessera account yet: it scores 0 and is New.</p>
        </main>
      </div>
    );
  }
  const a = p.agent;
  const limit = score.instantLimit(a, params);
  const kind = ['wallet', 'human', 'AI agent'][a.kind] ?? 'wallet';
  const states = ['opened', 'funded', 'delivered', 'released', 'refunded', 'disputed', 'resolved'];

  return (
    <div>
      <Nav />
      <main className="wrap pb-24 pt-10">
        <Link to="/agents" className="mono link text-[0.78rem]" >← all agents</Link>
        <div className="mt-6 grid gap-8 lg:grid-cols-[1.1fr_1fr]">
          <Reveal>
            <div className="flex flex-wrap items-center gap-3">
              <TierBadge tier={p.eval.tier} />
              <span className="mono text-[0.76rem]" style={{ color: '#878371' }}>{p.role} · {kind} · registered {ago(Number(a.registeredAt))}</span>
            </div>
            <h1 className="display mt-3 text-[clamp(3rem,7vw,5.6rem)]">{p.name}</h1>
            <div className="mono mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[0.8rem]" style={{ color: '#4b483e' }}>
              <span>wallet <Addr a={p.wallet} n={6} /></span>
              <span>credit file <Addr a={p.address} n={6} /></span>
              {a.uri && <a className="link" href={a.uri} target="_blank" rel="noreferrer">A2A agent card</a>}
              {REGISTRY.has(p.wallet) && (
                <span title={`This agent is also registered in the Solana Agent Registry (ERC-8004 on Solana). ${MIRRORED.get(REGISTRY.get(p.wallet)!) ?? 0} of its Tessera reviews are mirrored there as feedback, each pointing at the escrow review account.`}>
                  Agent Registry (ERC-8004) <Addr a={REGISTRY.get(p.wallet)!} n={6} />
                </span>
              )}
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                ['settles in', duration(params.holdSecs[p.eval.tier]!), 'with a party at least as trusted'],
                ['rating', p.stars.toFixed(2), `${a.reviewsReceived} reviews, volume-weighted`],
                ['counterparties', String(a.counterparties), `${a.activePeriods} active periods`],
              ].map(([k, v, hint]) => (
                <div key={k} className="card p-5">
                  <div className="display text-[2.3rem] leading-none">{v}</div>
                  <div className="eyebrow mt-2.5" style={{ color: '#878371' }}>{k}</div>
                  <div className="mt-1 text-[0.78rem]" style={{ color: '#878371' }}>{hint}</div>
                </div>
              ))}
            </div>
            {a.penaltyBps > 0 && (
              <div className="mt-4 rounded-2xl p-4 text-[0.9rem]" style={{ background: '#fdecea', border: '1px solid #f3c4bf', color: '#7a1f1f' }}>
                <strong>Standing penalty:</strong> {(a.penaltyBps / 100).toFixed(0)}% off the score from a lost dispute or missed delivery. It heals by {(params.penaltyDecayBps / 100).toFixed(2)}% per period, and blocks {tierName(3)} until it is gone.
              </div>
            )}
          </Reveal>
          <Reveal delay={0.1}>
            <div className="card grid gap-6 p-6 sm:grid-cols-[auto_1fr] sm:items-center">
              <div className="justify-self-center"><ScoreGauge e={p.eval} size={230} thresholds={params.tierScore} /></div>
              <div>
                <Breakdown e={p.eval} />
                <p className="mono mt-4 text-[0.7rem] leading-relaxed" style={{ color: '#878371' }}>
                  score = 1000 × ({(p.eval.evidence / 1000).toFixed(3)} evidence) × ({(p.eval.rating / 1000).toFixed(3)} rating) × ({(p.eval.behaviour / 10000).toFixed(2)} behaviour) = {p.eval.score}
                  <br />
                  cached on-chain: {a.score} · recomputed here just now
                </p>
              </div>
            </div>
          </Reveal>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <RoleStats title="As a merchant" s={a.asMerchant} />
          <RoleStats title="As a buyer" s={a.asBuyer} />
          <div className="card p-6">
            <div className="eyebrow" style={{ color: '#878371' }}>Instant settlement</div>
            <dl className="mono mt-4 grid grid-cols-[1fr_auto] gap-y-2 text-[0.84rem]">
              <dt style={{ color: '#878371' }}>protocol fees paid</dt>
              <dd className="text-right">{usd(a.feesPaid, 4)}</dd>
              <dt style={{ color: '#878371' }}>limit (base + fees)</dt>
              <dd className="text-right">{usd(limit, 4)}</dd>
              <dt style={{ color: '#878371' }}>not yet accepted by buyers</dt>
              <dd className="text-right">{usd(a.instantExposure, 4)}</dd>
              <dt style={{ color: '#878371' }}>eligible</dt>
              <dd className="text-right">{p.eval.tier === 3 ? 'yes' : `no, needs ${tierName(3)}`}</dd>
            </dl>
            <p className="mt-4 text-[0.78rem] leading-relaxed" style={{ color: '#878371' }}>
              A merchant can take instantly only what it has already paid in fees, plus a small base. That is what bounds an exit scam.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="card p-6">
            <div className="flex items-baseline justify-between">
              <div className="eyebrow" style={{ color: '#878371' }}>Reviews received</div>
              <span className="mono text-[0.72rem]" style={{ color: '#878371' }}>{mine.got.length} on-chain</span>
            </div>
            <ul className="mt-3 grid" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {mine.got.slice(0, 12).map((r) => (
                <li key={r.address} className="grid gap-1 py-3.5" style={{ borderTop: '1px solid #ebe4d0' }}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Stars value={r.data.rating} />
                    <Link to={`/agents/${r.data.reviewer}`} className="link text-[0.9rem] font-medium">{name(r.data.reviewer)}</Link>
                    <span className="mono text-[0.72rem]" style={{ color: '#878371' }}>
                      {r.data.reviewerIsBuyer ? 'bought from them' : 'sold to them'} · weight {usd(r.data.weight, 4)}
                      {config && r.data.weight > 0n ? ` · earns ${usd(rewards.baseReward(r.data.weight, config.feeBps, rewards.DEVNET_REWARD_PARAMS), 4)} at 1×` : ''} · {ago(Number(r.data.createdAt))}
                    </span>
                  </div>
                  <div className="text-[0.95rem]" style={{ color: '#4b483e' }}>{r.data.text || <em style={{ color: '#878371' }}>no text</em>}</div>
                  <a className="mono link text-[0.7rem]" style={{ color: '#878371' }} href={explorerAddress(r.address)} target="_blank" rel="noreferrer">review account {r.address.slice(0, 8)}…</a>
                </li>
              ))}
              {mine.got.length === 0 && <li className="mono py-6 text-[0.84rem]" style={{ color: '#878371' }}>No reviews yet. An unreviewed wallet is treated as 3 stars.</li>}
            </ul>
            <p className="mt-3 text-[0.78rem] leading-relaxed" style={{ color: '#878371' }}>
              A review's weight is the volume that settled on that order, scaled by the reviewer's own tier and capped per pair. A review of a refunded order weighs nothing, a merchant's review counts once the buyer has reviewed the same order, and the side that lost a dispute gets no weight. Each review earns a share of the fee in the <Link to="/formula" className="link">review-reward airdrop</Link>: the same for any stars, then scaled by whether it proved right.
            </p>
          </div>

          <div className="grid content-start gap-4">
            <div className="card p-6">
              <div className="eyebrow" style={{ color: '#878371' }}>Relationships</div>
              <ul className="mt-3 grid" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {mine.rel.slice(0, 8).map((x) => {
                  const other = x.data.buyer === wallet ? x.data.merchant : x.data.buyer;
                  const trusted = x.data.orders >= params.pairHistoryMin && x.data.disputes === 0;
                  return (
                    <li key={x.address} className="grid items-center gap-3 py-2.5 text-[0.88rem]" style={{ borderTop: '1px solid #ebe4d0', gridTemplateColumns: '1fr auto' }}>
                      <span>
                        <Link to={`/agents/${other}`} className="link font-medium">{name(other)}</Link>
                        <span className="mono ml-2 text-[0.72rem]" style={{ color: '#878371' }}>{x.data.buyer === wallet ? 'buys from' : 'sells to'}</span>
                        {x.data.disputes > 0 && <span className="mono ml-2 text-[0.7rem]" style={{ color: '#d03b3b' }}>! {x.data.disputes} dispute{x.data.disputes > 1 ? 's' : ''}</span>}
                        {trusted && <span className="mono ml-2 text-[0.7rem]" style={{ color: '#126b4a' }}>✓ history on record</span>}
                      </span>
                      <span className="mono text-[0.78rem]" style={{ color: '#4b483e' }}>{x.data.orders} orders · {usd(x.data.volume)}</span>
                    </li>
                  );
                })}
                {mine.rel.length === 0 && <li className="mono py-4 text-[0.84rem]" style={{ color: '#878371' }}>No settled orders yet.</li>}
              </ul>
            </div>
            <div className="card p-6">
              <div className="eyebrow" style={{ color: '#878371' }}>Recent orders</div>
              <ul className="mt-3 grid" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {mine.ord.map((o) => (
                  <li key={o.address}>
                    <a href={explorerAddress(o.address)} target="_blank" rel="noreferrer" className="grid items-center gap-3 py-2 text-[0.82rem]" style={{ borderTop: '1px solid #ebe4d0', gridTemplateColumns: '5.4rem 1fr auto' }}>
                      <StateChip kind={o.data.state === OrderState.Released && o.data.instant ? 'instant' : states[o.data.state]!} />
                      <span className="mono truncate">{name(o.data.buyer)} → {name(o.data.merchant)} · {usd(o.data.amount)}</span>
                      <span className="mono text-[0.72rem]" style={{ color: '#878371' }}>hold {duration(o.data.holdSecs)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
