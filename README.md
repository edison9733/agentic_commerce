# Tessera

**The credit layer for agent commerce.** x402 payments land in escrow on Solana, and an on-chain
credit score decides how long the money waits. Strangers wait. Agents with a record settle at once.

> *Every payment matters.*

## See it

- **Live site (devnet):** <https://agentic-commerce-two-theta.vercel.app>. There is no wallet login: the Market page pays with a built-in devnet test wallet.
- **Click-through decks:** [the pitch](https://agentic-commerce-two-theta.vercel.app/decks/tessera-pitch-slides.html) and [the technical demo](https://agentic-commerce-two-theta.vercel.app/decks/tessera-demo-slides.html). Click or press → for the next slide.
- **In-site decks:** [/#/deck/pitch](https://agentic-commerce-two-theta.vercel.app/#/deck/pitch) and [/#/deck/demo](https://agentic-commerce-two-theta.vercel.app/#/deck/demo).
- **Demo videos:** [the terminal demo with voice-over and pay later (2:42)](https://agentic-commerce-two-theta.vercel.app/videos/tessera-demo-paylater.mp4): finding and checking merchants, buyer and merchant trading side by side, a refund when a merchant never delivers, and from 1:55 pay later (a new wallet refused, a buyer repaying on time, a default freezing a line). The [earlier cut without pay later (2:03)](https://agentic-commerce-two-theta.vercel.app/videos/tessera-demo-voiceover.mp4) and [the website walkthrough (1:41)](https://agentic-commerce-two-theta.vercel.app/videos/tessera-demo.mp4) are still up. All were recorded on a local Solana validator running the real programs.
- **Run the site yourself:** `npm install`, then `npm run web`. It reads devnet directly and needs no keys.
- **Try a whole trade:** [docs/TRY-IT.md](docs/TRY-IT.md) walks through one step by step, as buyer and merchant with two wallets of your own, including a refund when a merchant never delivers.

| | |
|---|---|
| Program (devnet) | [`TessSeP5QV5Bxpvm73iEefdsTjgtTEokKSx7jqFn1CQ`](https://explorer.solana.com/address/TessSeP5QV5Bxpvm73iEefdsTjgtTEokKSx7jqFn1CQ?cluster=devnet) |
| Config account (devnet) | [`DgwhgcXkhNwpouzppHdF7KNACA14U1JWPccFH5ZGeNE2`](https://explorer.solana.com/address/DgwhgcXkhNwpouzppHdF7KNACA14U1JWPccFH5ZGeNE2?cluster=devnet) |
| Settles in | devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`), 1% protocol fee |
| Agent Registry | The four honest merchant agents (atlas, quill, vera, pixel) are registered in the [Solana Agent Registry](https://solana.com/agent-registry) (ERC-8004) on devnet. See [docs/ERC-8004.md](docs/ERC-8004.md). |
| Status | Devnet only. Unaudited by a third party. The traffic on devnet is this project's own agents. See [what is real](#what-is-real-and-what-is-not). |

Built for the Colosseum Crypto World's Fair hackathon (Solana track), October 2026.

---

## The problem

An x402 payment is a signed token transfer. Once a facilitator settles it, it is final. There is no
chargeback and nobody to call.

Card networks answer "did I get what I paid for?" months later. Visa's Compelling Evidence 3.0 settles
a fraud dispute with purchase history that is 120 to 365 days old
([Checkout.com](https://www.checkout.com/blog/visa-compelling-evidence-3-0)). Agents do not have 120
days. On-chain, a new wallet costs nothing, so a reputation that new wallets can mint is worth nothing.

Escrow closes the gap, but a fixed hold is wrong for almost everyone. It is too long for an agent with
a thousand clean orders and too short for a wallet created a minute ago. **The hold should be a function of
what is known about the two parties. That function is a credit score.**

## What Tessera does

1. **Escrow with no new payment scheme.** x402's `exact` scheme on Solana only permits a plain token
   transfer, but it derives the destination token account from `payTo`. So a merchant quotes the *order
   account* as `payTo`, and a standard x402 payment lands in that order's vault. The program never takes
   anyone's word that it was paid: `confirm_funded` is permissionless and reads the vault balance.
2. **A score that sets the hold.** Every wallet has a credit file. An order snapshots both parties' tiers,
   and the money is held for the longer of the two tiers' holds.

   | Tier | Needs (mainnet target) | Needs (devnet) | Hold (mainnet target) | Hold (devnet) |
   |---|---|---|---|---|
   | New | nothing | nothing | 3 days | 2 min |
   | Building | score ≥ 250, 3 active days | score ≥ 250, 2 active periods | 1 day | 45 s |
   | Established | score ≥ 500, 14 active days | score ≥ 500, 8 active periods | 1 hour | 10 s |
   | Trusted | score ≥ 750, 30 active days, no standing penalty | score ≥ 750, 20 active periods, no standing penalty | instant, inside a limit | instant |

   On devnet one period is 60 seconds. The numbers are in [`packages/sdk/src/constants.ts`](packages/sdk/src/constants.ts).
3. **Two-sided reviews, stored on-chain in full**, weighted by the volume that actually settled.
4. **Agents that use it.** Merchant agents speak A2A with the
   [a2a-x402 extension](https://github.com/google-agentic-commerce/a2a-x402) and plain HTTP 402. Buyer
   agents check the escrow on-chain before paying, pay through a facilitator (so they need no SOL), check
   the delivery against the hash the merchant committed, and rate the merchant.
5. **It sits between two things Solana already has.** x402 moves the money. The
   [Solana Agent Registry](https://solana.com/agent-registry) (ERC-8004 on Solana) says who an agent is.
   Tessera decides whether the money waits. On devnet, the merchant agents are registered in that
   registry, each registry identity points at its Tessera credit file, and 28 Tessera reviews (7 per
   merchant) are mirrored there as feedback that carries proof of payment. See
   [docs/ERC-8004.md](docs/ERC-8004.md).

## Four ways in for agents

There is one core and three thin layers over it, so an agent can use Tessera in whatever it speaks.
All four return the same decisions and statuses. Every transaction comes back unsigned, for the
agent's own wallet to sign. Details: [docs/AGENT-API.md](docs/AGENT-API.md).

| Door | Run | Use |
|---|---|---|
| HTTP API (the core) | `npm run api` → `:4030/v1` | `GET /v1/merchants?need=…` returns the best merchants, ranked. `POST /v1/check` returns `instant`, `escrow` or `block`, with a reason. |
| MCP (Streamable HTTP) | `npm run mcp` → `:4040/mcp` | `claude mcp add --transport http tessera http://127.0.0.1:4040/mcp` |
| Skill | [`skills/tessera/SKILL.md`](skills/tessera/SKILL.md) | "Before any paid tool call, call `check_payment`." |
| CLI | `npm run tessera -- help` | `npm run tessera -- find text summary --sort fastest`, or a read-only check: `npm run tessera -- check <merchant> 0.20 --buyer <your devnet address>` |

The MCP server and the CLI both call the HTTP API, so `npm run api` must be running.

Tools, by phase:
- **Before paying:** `find_merchants`, `get_score`, `check_payment`.
- **During:** `open_escrow`, `deliver_order`, `get_escrow`.
- **After:** `release_escrow`, `reclaim_after_timeout`, `report_outcome`, `submit_transaction`.

**Reviews as search, for agents.** `find_merchants` answers "who is best for this, what does it cost,
and how many seconds until it is settled" in one call. The rank uses only on-chain data. Every review
behind it needed a real settled order, so a top spot costs real sales to fake. It is written for
agents, not people: compact JSON, enums, and a plain-text summary at `/llms.txt` on both the API and
the website.

## Reviews that pay

A share of every fee goes back to whoever reviews. Three rules:
- **The pay never depends on the stars.** Every review that counted earns a quarter of the fee rate on the money behind it.
- **Accuracy scales it.** An honest warning about a wallet that then fails is paid 1.5×. Praising one that then fails is paid nothing.
- **Farming loses money.** Both sides of an order get back at most 75% of its fee, so trading with yourself to collect rewards always costs more than it pays.

The payout is an off-chain airdrop that the operator runs from the treasury. `npm run rewards` previews
it and pays nothing; `npm run rewards -- --pay` pays. Every payout file can be recomputed with
`--verify`. It has run end to end on a local validator with the real program (`npm run demo:rewards`),
but not yet on devnet. Rules and a recorded run: [docs/REWARDS.md](docs/REWARDS.md).

## Pay later (preview)

The same score that shortens the hold can set a credit line. A second program,
[`programs/tessera-paylater`](programs/tessera-paylater), lets an agent buy now and pay later:
- **Buy now.** A pool pays the merchant at once, minus a 2% fee.
- **Pay later.** The buyer repays the full price by the due date, with no interest. Each on-time
  repayment raises its limit.
- **Or default.** Anyone can mark an unpaid loan in default once its grace period ends, and the line
  freezes at zero.

The limit is `tier limit × score ÷ 1000 × on-time boost`, read live from the buyer's Tessera credit
file. A New wallet gets nothing. The escrow program is unchanged; pay-later only reads its accounts.
**It runs on a local validator only and is not deployed to devnet.** Rules, checks and limits:
[docs/PAYLATER.md](docs/PAYLATER.md).

## The score

```
score    = 1000 × Evidence × Rating × Behaviour
Evidence = 0.45 History + 0.30 Tenure + 0.25 Diversity
```

- **History**: settled volume, counted at 10% / 40% / 80% / 100% by the counterparty's tier, capped per pair.
- **Tenure**: time since registration, but only up to three periods per period actually active.
- **Diversity**: distinct counterparties, each at the best tier weight it has held.
- **Rating**: volume-weighted stars from counterparties, shrunk toward 3 stars.
- **Behaviour**: falls 25% for a lost dispute and 10% for a missed delivery, and heals over time.

It is integer arithmetic over public accounts. There are two implementations: the program's
([`score.rs`](programs/tessera/src/score.rs)) and the SDK's ([`score.ts`](packages/sdk/src/score.ts)),
which the website uses. They run the same integer arithmetic, and `npm run test:local` checks that they
agree. Full write-up: [docs/SCORING.md](docs/SCORING.md).

## What is checked

| Command | Result | What it proves |
|---|---|---|
| `npm run test:local` | **395 / 395** | Runs the real program on a local validator. After every instruction, every account is compared field by field with a reference model. Every attack in [docs/SECURITY.md](docs/SECURITY.md) is sent as a real transaction and must fail. |
| `npm run test:paylater` | **48 / 48** | The pay-later program next to the real escrow program on a local validator: limits from live Tessera scores matched against the off-chain formula, buy, on-time repayment, default and freeze, pool accounting, and the main refusal paths as real transactions. |
| `npm run test:formula` | **44 / 44** | The guarantees stated in the docs and on the site, as tests, including the review-reward rules. |
| `npm run demo:rewards` | **pass** | The review-reward airdrop on a local validator with the real program: real purchases and reviews, a merchant that then misses a delivery, and a real payout from the treasury. It checks each reward and label, the on-chain balances, the 75%-of-fees bound, and that `--verify` recomputes the payout. |
| `npm run test:doors` | **pass** (94 checks) | All four doors against the real program on a local validator: every API tool and refusal path with transactions signed and sent, `find_merchants` against real and copycat agent cards, the MCP tools and their enums, SKILL.md, and the CLI signing locally and refusing a tampered transaction from a fake API. |
| `npm run test:agents` | **pass** | The merchant and buyer agents against the real program on a local validator: a co-signed quote, a direct payment, delivery with its evidence kept for the arbiter, release, and both reviews in the order the program weighs them. |
| `npm run registry -- --verify` | **28 / 28** | Every Tessera review mirrored into the Solana Agent Registry on devnet is read back from the registry and matched against the Tessera review account it points at. |

The timings in the snapshot below were measured on devnet over a public RPC on 4 October 2026 (UTC). Raw data is in [`deployments/measurements.jsonl`](deployments/measurements.jsonl).

<!-- snapshot:start -->
Snapshot of the demo network at 2026-10-04T19:11:10.000Z (`deployments/snapshot.json`):

| | |
|---|---|
| Orders settled through escrow | 234 of 251 opened, 56.95 USDC, 0.5695 USDC in fees |
| Settled instantly / after a hold | 44 / 190 |
| Refunded / disputes resolved by the arbiter | 3 / 2 |
| Credit files | 17: 2 New, 4 Building, 1 Established, 10 Trusted |
| Reviews stored on-chain | 435 |
| Purchases timed | 230, of which 51 paid through an x402 facilitator |
| Facilitator verify / settle, median | 934 ms / 1222 ms |
| Whole purchase as the buyer sees it, median | 27.7 s via facilitator, 23.2 s direct |

The whole-purchase time is five sequential transactions on a rate-limited public RPC shared with
the rest of the demo. It measures this prototype on that endpoint, not Solana.

| Agent | Role | Tier | Score | Orders | Stars | Note |
|---|---|---|---|---|---|---|
| quill | merchant | Trusted | 1000 | 42 | 4.83 |  |
| vera | merchant | Trusted | 1000 | 43 | 4.85 |  |
| atlas | merchant | Trusted | 992 | 54 | 4.82 |  |
| pixel | merchant | Trusted | 914 | 41 | 4.72 |  |
| orbit | buyer | Trusted | 872 | 27 | 4.75 |  |
| lumen | buyer | Trusted | 867 | 28 | 4.74 |  |
| scout | buyer | Trusted | 866 | 29 | 4.75 |  |
| nova | buyer | Trusted | 861 | 29 | 4.75 |  |
| drift | buyer | Trusted | 859 | 27 | 4.74 |  |
| echo | buyer | Trusted | 842 | 25 | 4.73 |  |
| washer | merchant | Established | 562 | 54 | 4.41 |  |
| sock-3 | buyer | Building | 473 | 18 | 4.23 |  |
| sock-2 | buyer | Building | 473 | 18 | 4.23 |  |
| sock-1 | buyer | Building | 473 | 18 | 4.23 |  |
| charlie | buyer | Building | 278 | 14 | 4.33 | 2 dispute(s) lost, 46% penalty |
| Fukg… | buyer | New | 102 | 1 | 3.46 |  |
| mallory | merchant | New | 0 | 0 | 3 | 3 missed deliveries, 28% penalty |
<!-- snapshot:end -->

## Run it

Needs Node 20.18 or newer (22 recommended), Rust, Solana CLI 3.1 and Anchor 1.1.2. Everything targets **devnet**.

```bash
npm install
npm run build:program        # anchor build
npm run codegen              # typed client from the IDL
npm run test:formula         # 44 formula and reward tests, no chain needed
npm run test:local           # 395 checks on a local validator (about 4 minutes)
npm run test:paylater        # 48 pay-later checks on a local validator
npm run paylater:local       # a local pay-later world to try the CLI by hand (docs/PAYLATER.md)
```

To run the demo network against the deployed program you need the role keypairs in `.keys/`. They are
not in the repo. `npm run setup:devnet` creates new ones and funds them from your Solana CLI wallet. It
needs devnet SOL and devnet USDC from <https://faucet.circle.com>. With a different deployer you also
have to deploy the program under your own id.

```bash
npm run setup:devnet         # config, keys, funding, profiles (idempotent)
npm run agents               # merchant agents: A2A + x402 + crank + arbiter, on :4020
npm run swarm                # buyer agents trade for 45 periods; three attacks join later
npm run web                  # the site, on :5173
npm run registry -- --mirror 7   # register merchants in the Solana Agent Registry, mirror 7 reviews each
```

The agents server quotes two public x402 facilitators (x402.org and PayAI). Coinbase's CDP facilitator
needs an API key: set `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` and it is tried first. That path loads
and falls back cleanly, but it has not been run with a real key.

One purchase by one agent:

```bash
npm run buy -w @tessera/agents -- --buyer scout --merchant atlas --mode x402
```

The site reads the chain directly, so `npm run web` alone shows the live network. Only the Market page
needs `npm run agents`.

[`.env.example`](.env.example) lists the names of every environment variable used. Values are never
committed.

### Hosting the API and the agents (Railway)

[docs/RAILWAY.md](docs/RAILWAY.md): one `Dockerfile`, a config per service in `railway/`, and the
merchants' keys passed as one secret variable (`npm run keys:export`).

### Putting the site on Vercel

The site is static files: `npm run build -w @tessera/web` writes `apps/web/dist`. In Vercel, import the
GitHub repo and choose the **web** app ("Import single project"): Root Directory `apps/web`, framework
Vite, default build and output settings. Each push to `main` redeploys.

Do not add a `vercel.json` at the repo root. Vercel applies it to the `apps/web` project too, and its
paths would be wrong there. `apps/web/vercel.json` is fine: it only sets security headers (a strict
Content-Security-Policy, framing and referrer rules).

Optional environment variables, set in the Vercel project:

- `VITE_RPC_URLS`: comma-separated devnet RPC URLs, tried in order (defaults to two public ones). This is public, because it is compiled into the site, so never put a URL with an API key here.
- `VITE_AGENTS_URL`: the public `https://` address of `npm run agents`, for the Market page and the demo
  deck's checkout. The agents server is not on Vercel. Without it, the Market page says it is unreachable.

These are read at build time, so redeploy after changing them.

## Repository layout

```
programs/tessera/     Anchor program: escrow state machine, score, reviews, disputes
programs/tessera-paylater/  Pay-later preview: credit lines from the Tessera score (reads the escrow's accounts)
packages/sdk/         Typed client (Codama), PDA helpers, payment verification,
                      the score mirror, the reference model, attack simulations
apps/agents/          Merchant agents (A2A + x402), buyer agent, swarm, crank, arbiter
apps/api/             The HTTP API: credit checks and unsigned escrow transactions (the core door)
apps/mcp/             The same tools over MCP (Streamable HTTP)
apps/cli/             The tessera command; signs locally with --keypair
skills/tessera/       SKILL.md for skill-aware agents
apps/web/             React + Motion site: live network, credit files, market, decks
apps/web/slides/      Source of the click-through slide decks (npm run slides)
scripts/              Devnet bootstrap and the local-validator test suite
docs/                 Scoring, security model, architecture, A2A extension, agent API, rewards,
                      ERC-8004 and the Agent Registry, Railway hosting, try-it guide
deployments/          Public addresses, measured timings, Agent Registry assets and files
```

## What is real and what is not

**Real:** the program on devnet, every account and transaction the site shows, the score (recomputed
in your browser from those accounts), the x402 payments through public facilitators, and the test
results.

**Not real yet:**

- **The traffic is ours.** The devnet network is this project's own agents trading with recycled test
  USDC, to show what the program does with each behaviour. There are no outside users and no revenue.
- **Time is compressed on devnet.** One period is 60 seconds instead of a day, and holds are seconds
  instead of days, so a wallet's journey can be watched in under an hour. The formula is the same.
- **Single keys.** The arbiter and the program's upgrade authority are one key each. Both need a
  multisig before any real money.
- **Unaudited** by a third party, and the A2A endpoint is hand-rolled from the specification rather
  than certified. Two internal reviews found and fixed holes: ten on 7 October, and a wider pass on
  10 October that included a critical order-swap in the escrow
  ([7 October](docs/SECURITY.md#audit-of-7-october-2026), [10 October](docs/SECURITY.md#audit-of-10-october-2026)).
  The fixes from both reviews are deployed on devnet.
- **Pay later is a local preview.** The pay-later program is tested on a local validator and not
  deployed to devnet. A default freezes the pay-later line but does not lower the Tessera score. See
  [docs/PAYLATER.md](docs/PAYLATER.md).
- **It prices faking; it does not detect it.** On-chain data cannot tell a bot from a customer who
  spends the same money. See the limits in [docs/SECURITY.md](docs/SECURITY.md).

## Where the ideas come from

- [x402](https://x402.org) and [A2A](https://a2a-protocol.org) carry the payment and the conversation,
  unchanged.
- [ERC-8004, Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004) proposes identity, reputation
  and validation registries for agents, and says "payments are orthogonal to this protocol". The
  [Solana Agent Registry](https://solana.com/agent-registry) is that standard on Solana. Tessera is the
  payment side, and is bridged to the registry on devnet: [docs/ERC-8004.md](docs/ERC-8004.md).
- [Visa Compelling Evidence 3.0](https://www.checkout.com/blog/visa-compelling-evidence-3-0): earlier
  undisputed purchases are evidence that a later one is legitimate. The pair account is that evidence,
  kept by the program.
- An earlier prototype by the same author (`x402-fraud`, 22 to 23 September 2026, unpublished) showed
  that an escrow account can be an x402 `payTo`. Tessera is a new program and codebase built on that idea.

## Licence

MIT. See [LICENSE](LICENSE).
