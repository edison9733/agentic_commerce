import { DEVNET_PARAMS, MAINNET_TARGET_PARAMS, type Params } from '@tessera/sdk';
import { Footer } from './Landing';
import { Nav } from '../components/Nav';
import { Playground } from '../components/Playground';
import { ReviewRewards } from '../components/ReviewRewards';
import { Reveal, TierBadge } from '../components/ui';
import { duration, usd } from '../lib/format';
import { useChain } from '../lib/store';

const REPO = 'https://github.com/edison9733/agentic_commerce';

function Term({ name, math, children }: { name: string; math: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-3 py-6 md:grid-cols-[11rem_1fr]" style={{ borderTop: '1px solid #ded7c2' }}>
      <div className="display text-[1.8rem] leading-none">{name}</div>
      <div className="min-w-0">
        <pre className="mono overflow-x-auto rounded-xl px-4 py-3 text-[0.8rem]" style={{ background: '#f4efe0', margin: 0 }}>{math}</pre>
        <p className="mt-3 text-[0.98rem] leading-relaxed" style={{ color: '#4b483e' }}>{children}</p>
      </div>
    </div>
  );
}

function ParamTable({ live }: { live: Params | null }) {
  const d = live ?? DEVNET_PARAMS;
  const m = MAINNET_TARGET_PARAMS;
  const rows: [string, string, string][] = [
    ['one period', duration(d.periodSecs), duration(m.periodSecs)],
    ['hold: New / Building / Established / Trusted', d.holdSecs.map(duration).join(' / '), m.holdSecs.map(duration).join(' / ')],
    ['score needed: Building / Established / Trusted', d.tierScore.join(' / '), m.tierScore.join(' / ')],
    ['active periods needed', d.tierPeriods.join(' / '), m.tierPeriods.join(' / ')],
    ['credit at which History is full', usd(d.creditFull), usd(m.creditFull, 0)],
    ['most volume one counterparty can count for', usd(d.pairCap), usd(m.pairCap, 0)],
    ['periods at which Tenure is full', String(d.tenureFull), String(m.tenureFull)],
    ['counterparty points at which Diversity is full', (d.diversityFull / 100).toFixed(0), (m.diversityFull / 100).toFixed(0)],
    ['weight of the 3-star prior', usd(d.reviewPrior), usd(m.reviewPrior, 0)],
    ['instant limit', `${usd(d.instantBase)} + fees paid`, `${usd(m.instantBase, 0)} + fees paid`],
    ['pair history that waives the buyer hold', `${d.pairHistoryMin} orders, first ≥ ${duration(d.pairAgeSecs)} old`, `${m.pairHistoryMin} orders, first ≥ ${duration(m.pairAgeSecs)} old`],
    ['penalty: lost dispute / missed delivery', `${d.penaltyDisputeBps / 100}% / ${d.penaltyExpiredBps / 100}%`, `${m.penaltyDisputeBps / 100}% / ${m.penaltyExpiredBps / 100}%`],
    ['penalty healed per period', `${d.penaltyDecayBps / 100}%`, `${m.penaltyDecayBps / 100}%`],
    ['review window / complaint lock', `${duration(d.reviewSecs)} / ${duration(d.complaintSecs)}`, `${duration(m.reviewSecs)} / ${duration(m.complaintSecs)}`],
  ];
  return (
    <div className="card overflow-x-auto p-2 md:p-4">
      <table className="w-full min-w-[640px] text-[0.9rem]" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr className="eyebrow text-left" style={{ color: '#878371' }}>
            <th className="py-3 font-normal">Parameter</th>
            <th className="py-3 font-normal">Devnet {live ? '(read from chain)' : ''}</th>
            <th className="py-3 font-normal">Mainnet target</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, a, b]) => (
            <tr key={k} style={{ borderTop: '1px solid #ebe4d0' }}>
              <td className="py-2.5 pr-4">{k}</td>
              <td className="mono py-2.5 pr-4 text-[0.82rem]">{a}</td>
              <td className="mono py-2.5 text-[0.82rem]">{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const GUARANTEES: [string, string][] = [
  ['A wallet nobody knows scores 0 and waits the longest hold.', 'formula'],
  ['Age alone earns nothing: a wallet left idle for a year has no Tenure.', 'formula'],
  ['Full evidence bought in one day still does not reach Building.', 'formula'],
  ['One-star reviews sink any amount of history.', 'formula'],
  ['Losing a dispute costs a quarter of the score and removes Trusted until it heals.', 'formula'],
  ['One counterparty can never grant more than the pair cap, however much it spends.', 'formula + on-chain'],
  ['Splitting a purchase into many small ones earns nothing extra.', 'formula'],
  ['A refund or a lost dispute earns no credit, and a review of a refund weighs nothing.', 'formula + on-chain'],
  ['Three wallets trading with each other for a year never reach Trusted.', 'formula'],
  ['Instant settlement can net an exit scam at most the base allowance.', 'formula + on-chain'],
  ['A merchant cannot borrow the tier of a buyer who never took part, or review-bomb it.', 'formula + on-chain'],
  ['The side that lost a dispute cannot answer with a weighted review.', 'formula + on-chain'],
  ['A buyer that is not the order\'s buyer, or a quote for the wrong amount or escrow, is refused before payment.', 'on-chain'],
  ['The merchant cannot take the money before the hold ends, or shorten a hold the buyer asked for.', 'on-chain'],
];

export function Formula() {
  const { config } = useChain();
  return (
    <div>
      <Nav />
      <main className="wrap pb-24 pt-12" style={{ width: 'min(980px, 100% - 2.5rem)' }}>
        <Reveal>
          <div className="eyebrow" style={{ color: '#878371' }}>The score</div>
          <h1 className="display mt-3 text-[clamp(2.8rem,7vw,5.6rem)]">
            Every rule, <em>in the open.</em>
          </h1>
          <p className="mt-5 max-w-[44rem] text-[1.08rem] leading-relaxed" style={{ color: '#4b483e' }}>
            A credit score that decides when people get paid has to be checkable by the people it decides for. Tessera's is integer arithmetic over public accounts. The program computes it, the SDK computes it, and this page computes it, with the same code.
          </p>
        </Reveal>

        <Reveal delay={0.05}>
          <pre className="mono mt-10 overflow-x-auto rounded-2xl p-6 text-[0.9rem] leading-[1.9]" style={{ background: '#14130f', color: '#e9e6d8' }}>
{`score    = 1000 × Evidence × Rating × Behaviour
Evidence = 0.45 History + 0.30 Tenure + 0.25 Diversity

tier     = the highest tier whose score AND active-period gate are both met
           (Trusted also needs no standing penalty)
hold     = max( hold[merchant tier], hold[buyer tier] )`}
          </pre>
        </Reveal>

        <section className="mt-12">
          <Term name="History" math="min(1, √(credit ÷ credit_full))">
            Credit is settled volume, counted at 10%, 40%, 80% or 100% depending on whether the counterparty was New, Building, Established or Trusted when the order was opened, and capped per counterparty. Trading with wallets nobody knows proves little. The square root means the first dollars of proven volume matter most and size alone cannot buy the top.
          </Term>
          <Term name="Tenure" math="min(1, min(age, 3 × active periods) ÷ tenure_full)">
            Periods since the wallet registered, but never more than three for each period it actually settled an order in. A wallet left to age earns nothing, and a burst of a thousand orders in one day is one active period.
          </Term>
          <Term name="Diversity" math="min(1, Σ counterparty points ÷ diversity_full)">
            Each counterparty adds the best tier weight it has held while trading with this wallet, once the pair has moved a tenth of the pair cap. Ten sock puppets are worth one Trusted customer.
          </Term>
          <Term name="Rating" math="clamp((stars − 1.5) ÷ 3, 0, 1)    stars = (prior × 3 + Σ w·r) ÷ (prior + Σ w)">
            Stars are weighted by the volume that settled on the reviewed order, scaled by the reviewer's own tier and capped per pair, then shrunk toward a 3-star prior. No reviews means half marks. A review of a refunded order weighs nothing, so reviews cannot be minted by buying and cancelling. A merchant's review counts once the buyer has reviewed the same order, and the side that lost a dispute gets no weight.
          </Term>
          <Term name="Behaviour" math="1 − standing penalty">
            Losing a dispute adds 25%, missing a delivery deadline adds 10%. The penalty heals a little every period. While any of it stands, the wallet cannot be Trusted, so it cannot settle instantly.
          </Term>
        </section>

        <section className="mt-14">
          <Reveal>
            <h2 className="display text-[2.6rem]">What a tier buys</h2>
            <div className="mt-6 grid gap-3">
              {[0, 1, 2, 3].map((t) => (
                <div key={t} className="card grid items-center gap-4 p-5 md:grid-cols-[10rem_1fr_auto]">
                  <TierBadge tier={t} />
                  <span className="text-[0.95rem]" style={{ color: '#4b483e' }}>
                    {['Any wallet. Its orders wait the longest, and it counts for 10% as a counterparty or reviewer.', 'A few clean orders over a few periods. Counts for 40%.', 'A real record across several counterparties. Counts for 80%.', 'A long, clean, well-rated record. Counts in full, and may settle instantly inside its limit.'][t]}
                  </span>
                  <span className="mono text-[0.82rem]">
                    {duration(MAINNET_TARGET_PARAMS.holdSecs[t]!)} <span style={{ color: '#878371' }}>· devnet {duration((config?.params ?? DEVNET_PARAMS).holdSecs[t]!)}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {[
                ['History with one merchant', 'A buyer with two or more undisputed purchases from a merchant, the first of them old enough, is treated as Trusted for that merchant. This is the on-chain version of the purchase history card networks accept as evidence. One dispute between the pair ends it for good.'],
                ['The instant limit', 'A Trusted merchant may carry instant-settled volume that buyers have not accepted only up to the fees it has paid plus a small base. A buyer rating an instant order 1 or 2 stars locks that amount against the limit.'],
                ['The buyer can ask for more', 'Any order can be opened with a minimum hold. It can lengthen the hold the tiers call for, never shorten it, and the buyer verifies it on-chain before paying.'],
              ].map(([h, b]) => (
                <div key={h} className="card p-5">
                  <div className="text-[1rem] font-medium">{h}</div>
                  <p className="mt-2 text-[0.9rem] leading-relaxed" style={{ color: '#4b483e' }}>{b}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </section>

        <section className="mt-14">
          <Reveal>
            <h2 className="display text-[2.6rem]">Try it</h2>
            <div className="mt-6"><Playground /></div>
          </Reveal>
        </section>

        <section id="rewards" className="mt-14">
          <Reveal>
            <h2 className="display text-[2.6rem]">Reviews that pay</h2>
            <p className="mt-3 max-w-[44rem] text-[0.98rem] leading-relaxed" style={{ color: '#4b483e' }}>
              A share of every fee goes back to reviewers: the same for 1 star or 5, scaled by whether the review proved right. The rules are in docs/REWARDS.md and run in the browser below.
            </p>
            <div className="mt-6"><ReviewRewards /></div>
          </Reveal>
        </section>

        <section className="mt-14">
          <Reveal>
            <h2 className="display text-[2.6rem]">The numbers</h2>
            <p className="mt-3 max-w-[44rem] text-[0.98rem] leading-relaxed" style={{ color: '#4b483e' }}>
              Devnet runs the same rules with time and amounts compressed, so a wallet's whole journey can be watched in under an hour with a few test dollars. The mainnet column is a target, not a deployment.
            </p>
            <div className="mt-6"><ParamTable live={config?.params ?? null} /></div>
          </Reveal>
        </section>

        <section className="mt-14">
          <Reveal>
            <h2 className="display text-[2.6rem]">What is guaranteed</h2>
            <p className="mt-3 max-w-[44rem] text-[0.98rem] leading-relaxed" style={{ color: '#4b483e' }}>
              Each line is a test in the repository. “Formula” tests run the arithmetic; “on-chain” tests send the attack as a real transaction to the real program and require it to fail.
            </p>
            <ul className="mt-6 grid gap-2" style={{ listStyle: 'none', padding: 0 }}>
              {GUARANTEES.map(([g, where]) => (
                <li key={g} className="card grid items-center gap-x-4 gap-y-1 px-5 py-3.5 text-[0.95rem]" style={{ gridTemplateColumns: '1.4rem minmax(0, 1fr)' }}>
                  <span style={{ color: '#126b4a' }} aria-hidden>✓</span>
                  <span>{g}</span>
                  <span className="mono text-[0.7rem]" style={{ color: '#878371', gridColumn: 2, overflowWrap: 'anywhere' }}>{where}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </section>

        <section className="mt-14 grid gap-6 md:grid-cols-2">
          <Reveal>
            <h2 className="display text-[2.2rem]">What it cannot do</h2>
            <ul className="mt-4 grid gap-3 text-[0.95rem] leading-relaxed" style={{ color: '#4b483e', paddingLeft: '1.1rem' }}>
              <li>Tell a bot from a customer who spends the same money. It prices faking; it does not detect it.</li>
              <li>Stop one person running many wallets. It makes each one earn its own record, and caps what a record can take.</li>
              <li>Protect an instant order after the fact, beyond the merchant's limit and the buyer's rating. Instant means no hold to dispute in.</li>
              <li>Judge a dispute. An arbiter does, and on devnet it is a single key.</li>
            </ul>
          </Reveal>
          <Reveal delay={0.08}>
            <h2 className="display text-[2.2rem]">Where the ideas come from</h2>
            <ul className="mt-4 grid gap-3 text-[0.95rem] leading-relaxed" style={{ color: '#4b483e', paddingLeft: '1.1rem' }}>
              <li><strong>ERC-8004 (Trustless Agents)</strong> proposes identity, reputation and validation registries for agents. Tessera is not an implementation of it; the agent account, the review accounts and the delivery hash play the corresponding roles on Solana.</li>
              <li><strong>Visa Compelling Evidence 3.0</strong> treats earlier undisputed purchases as evidence a later one is legitimate. The pair account is that evidence, kept by the program.</li>
              <li><strong>x402 and A2A</strong> carry the payment and the conversation unchanged. The only thing Tessera changes is where <span className="mono text-[0.86rem]">payTo</span> points.</li>
            </ul>
            <a className="btn btn-ghost mt-6" href={`${REPO}/blob/main/docs/SCORING.md`} target="_blank" rel="noreferrer">Full write-up in the repo</a>
          </Reveal>
        </section>
      </main>
      <Footer />
    </div>
  );
}
