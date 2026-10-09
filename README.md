# Tessera

**The credit layer for agent commerce.** x402 payments land in escrow on Solana, and an on-chain
credit score decides how long the money waits. Strangers wait. Agents with a record settle at once.

> *Every payment matters.*

| | |
|---|---|
| Program (devnet) | [`TessSeP5QV5Bxpvm73iEefdsTjgtTEokKSx7jqFn1CQ`](https://explorer.solana.com/address/TessSeP5QV5Bxpvm73iEefdsTjgtTEokKSx7jqFn1CQ?cluster=devnet) |
| Config account | [`DgwhgcXkhNwpouzppHdF7KNACA14U1JWPccFH5ZGeNE2`](https://explorer.solana.com/address/DgwhgcXkhNwpouzppHdF7KNACA14U1JWPccFH5ZGeNE2?cluster=devnet) |
| Settles in | devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`), 1% protocol fee |
| Agent Registry | The four merchant agents are registered in the [Solana Agent Registry](https://solana.com/agent-registry) (ERC-8004) on devnet. See [docs/ERC-8004.md](docs/ERC-8004.md). |
| Status | Devnet only. Unaudited. The traffic on devnet is this project's own agents. See [what is real](#what-is-real-and-what-is-not). |

Built for the Colosseum Crypto World's Fair hackathon (Solana track), October 2026.

**In a hurry?** Watch the pitch (`pitch/out/tessera-pitch.mp4`, under three minutes) and the technical
demo (`pitch/out/tessera-demo.mp4`). The slides are in `pitch/out/` as PDFs. Everything the submission
form asks for is in [docs/SUBMISSION.md](docs/SUBMISSION.md). To see it live, run `npm install` and
`npm run web`: the site reads devnet directly and needs no keys.

---

## The problem

An x402 payment is a signed token transfer. Once a facilitator settles it, it is final: there is no
chargeback and nobody to call. Card networks answer "did I get what I paid for?" months later. Visa's
Compelling Evidence 3.0 settles a fraud dispute with purchase history that is 120 to 365 days old
([Checkout.com](https://www.checkout.com/blog/visa-compelling-evidence-3-0)). Agents do not have 120
days, and on-chain a new wallet costs nothing, so a reputation that new wallets can mint is worth nothing.

Escrow closes the gap, but a fixed hold is wrong for almost everyone: too long for an agent with a
thousand clean orders, too short for a wallet created a minute ago. **The hold should be a function of
what is known about the two parties. That function is a credit score.**

## What Tessera does

1. **Escrow with no new payment scheme.** x402's `exact` scheme on Solana only permits a plain token
   transfer, but it derives the destination token account from `payTo`. So a merchant quotes the *order
   account* as `payTo`, and a standard x402 payment lands in that order's vault. The program never takes
   anyone's word that it was paid: `confirm_funded` is permissionless and reads the vault balance.
2. **A score that sets the hold.** Every wallet has a credit file. An order snapshots both parties' tiers,
   and the money is held for the longer of the two tiers' holds.

   | Tier | Needs | Hold (mainnet target) | Hold (devnet) |
   |---|---|---|---|
   | New | nothing | 3 days | 2 min |
   | Building | score ≥ 250, 3 active days | 1 day | 45 s |
   | Established | score ≥ 500, 14 active days | 1 hour | 10 s |
   | Trusted | score ≥ 750, 30 active days, no standing penalty | instant, inside a limit | instant |

3. **Two-sided reviews, on-chain in full**, weighted by the volume that actually settled.
4. **Agents that use it.** Merchant agents speak A2A with the
   [a2a-x402 extension](https://github.com/google-agentic-commerce/a2a-x402) and plain HTTP 402. Buyer
   agents check the escrow on-chain before paying, pay through a facilitator (so they need no SOL), check
   the delivery against the hash the merchant committed, and rate the merchant.
5. **It sits between two things Solana already has.** x402 moves the money. The
   [Solana Agent Registry](https://solana.com/agent-registry) (ERC-8004 on Solana) says who an agent is.
   Tessera decides whether the money waits. The merchant agents are registered in that registry on
   devnet, each registry identity points at its Tessera credit file, and Tessera reviews are mirrored
   there as feedback that carries proof of payment. See [docs/ERC-8004.md](docs/ERC-8004.md).

## Four ways in for agents

One core and three thin layers over it, so an agent uses Tessera in whatever it speaks. All four
return the same decisions and statuses; every transaction comes back unsigned for the agent's own
wallet. Details: [docs/AGENT-API.md](docs/AGENT-API.md).

| Door | Run | Use |
|---|---|---|
| HTTP API (the core) | `npm run api` → `:4030/v1` | `POST /v1/check` → `instant`, `escrow` or `block`, with a reason |
| MCP (Streamable HTTP) | `npm run mcp` → `:4040/mcp` | `claude mcp add --transport http tessera http://127.0.0.1:4040/mcp` |
| Skill | [`skills/tessera/SKILL.md`](skills/tessera/SKILL.md) | "Before any paid tool call, call `check_payment`." |
| CLI | `npm run tessera -- help` | `tessera check <merchant> 0.20 --keypair ~/.config/solana/id.json` |

Tools, by phase: before paying `get_score`, `check_payment`; during `open_escrow`, `deliver_order`,
`get_escrow`; after `release_escrow`, `reclaim_after_timeout`, `report_outcome`, `submit_transaction`.

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

It is integer arithmetic over public accounts. The program ([`score.rs`](programs/tessera/src/score.rs)),
the SDK ([`score.ts`](packages/sdk/src/score.ts)) and the website run the same code and get the same
number. Full write-up: [docs/SCORING.md](docs/SCORING.md).

## What is checked

| Command | Result | What it proves |
|---|---|---|
| `npm run test:local` | **294 / 294** | Runs the real program on a local validator. After every instruction, every account is compared field by field with a reference model, and every attack in [docs/SECURITY.md](docs/SECURITY.md) is sent as a real transaction and must fail. |
| `npm run test:formula` | **18 / 18** | The guarantees stated in the docs and on the site, as tests. |
| `npm run test:wallet` | **pass** | The website's checkout with a browser wallet, on devnet. A Wallet Standard wallet is injected into headless Chrome; the site lists it, connects, and the wallet signs each step: fund, pay into escrow, check the delivery hash, release, review. The order and the review are then read back from the chain. It is not a test of a particular wallet extension. |
| `npm run test:doors` | **pass** | All four doors against the real program on a local validator: every API tool and refusal path with transactions signed and sent, the MCP tools and their enums, SKILL.md, and the CLI signing locally and refusing a tampered transaction from a fake API. |
| `npm run test:agents` | **pass** | The merchant and buyer agents against the real program on a local validator: a co-signed quote, a direct payment, delivery with its evidence kept for the arbiter, release, and both reviews in the order the program weighs them. |
| `npm run registry -- --verify` | **28 / 28** | Every Tessera review mirrored into the Solana Agent Registry is read back from the registry and matched against the Tessera review account it points at. |

Measured on devnet over a public RPC on 4 October 2026 (UTC); raw data in [`deployments/measurements.jsonl`](deployments/measurements.jsonl):

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

Needs Node 20.18+, Rust, Solana CLI 3.1, Anchor 1.1.2. Everything targets **devnet**.

```bash
npm install
npm run build:program        # anchor build
npm run codegen              # typed client from the IDL
npm run test:formula         # 18 formula tests, no chain needed
npm run test:local           # 294 checks on a local validator (about 4 minutes)
```

To run the demo network against the deployed program you need the role keypairs in `.keys/`. They are
not in the repo. `npm run setup:devnet` creates new ones and funds them from your Solana CLI wallet
(it needs devnet SOL and devnet USDC from <https://faucet.circle.com>); with a different deployer you
also have to deploy the program under your own id.

```bash
npm run setup:devnet         # config, keys, funding, profiles (idempotent)
npm run agents               # merchant agents: A2A + x402 + crank + arbiter, on :4020
npm run swarm                # buyer agents trade for 45 periods; three attacks join later
npm run web                  # the site, on :5173
npm run registry -- --mirror 3   # register merchants in the Solana Agent Registry, mirror 3 reviews each
```

The agents server quotes two public x402 facilitators (x402.org and PayAI). Coinbase's CDP facilitator
is the most used one and needs an API key: set `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` and it is
tried first. That path loads and falls back cleanly, but it has not been run with a real key.

One purchase by one agent:

```bash
npm run buy -w @tessera/agents -- --buyer scout --merchant atlas --mode x402
```

The site reads the chain directly, so `npm run web` alone shows the live network. Only the Market page
needs `npm run agents`.

### Putting the site on Vercel

The site is static files (`npm run build:web` writes `apps/web/dist`), and `vercel.json` tells Vercel how
to build it. Import the GitHub repo in Vercel and keep the root directory at the repo root; each push to
the production branch redeploys. Optional environment variables, set in the Vercel project:

- `VITE_RPC_URLS`: comma-separated devnet RPC URLs, tried in order (defaults to two public ones).
- `VITE_AGENTS_URL`: the public `https://` address of `npm run agents`, for the Market page and the demo
  deck's checkout. The agents server is not on Vercel; without it the Market page says it is unreachable.

These are read at build time, so redeploy after changing them.

## Repository layout

```
programs/tessera/     Anchor program: escrow state machine, score, reviews, disputes
packages/sdk/         Typed client (Codama), PDA helpers, payment verification,
                      the score mirror, the reference model, attack simulations
apps/agents/          Merchant agents (A2A + x402), buyer agent, swarm, crank, arbiter
apps/api/             The HTTP API: credit checks and unsigned escrow transactions (the core door)
apps/mcp/             The same tools over MCP (Streamable HTTP)
apps/cli/             The tessera command; signs locally with --keypair
skills/tessera/       SKILL.md for skill-aware agents
apps/web/             React + Motion site: live network, credit files, market, decks
scripts/              Devnet bootstrap and the local-validator test suite
pitch/                Video renderer; scripts are generated from the decks
docs/                 Scoring, security model, architecture, A2A extension, ERC-8004 and the
                      Agent Registry, submission pack
deployments/          Public addresses, measured timings, Agent Registry assets and files
```

## What is real and what is not

Real: the program on devnet, every account and transaction the site shows, the score (recomputed in
your browser from those accounts), the x402 payments through public facilitators, the test results.

Not real yet:

- **The traffic is ours.** The devnet network is this project's own agents trading with recycled test
  USDC to show what the program does with each behaviour. There are no outside users and no revenue.
- **Time is compressed on devnet.** One period is 60 seconds instead of a day, and holds are seconds
  instead of days, so a wallet's journey can be watched in under an hour. The formula is the same.
- **Single keys.** The arbiter and the program's upgrade authority are one key each. Both need a
  multisig before any real money.
- **Unaudited** by a third party, and the A2A endpoint is hand-rolled from the specification rather
  than certified. An internal review on 7 October found and fixed three serious holes and seven smaller
  ones ([docs/SECURITY.md](docs/SECURITY.md#audit-of-7-october-2026)). **The program deployed on devnet
  predates those fixes** until it is upgraded; the steps are in the same section.
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
  undisputed purchases are evidence a later one is legitimate. The pair account is that evidence, kept
  by the program.
- An earlier prototype by the same author (`x402-fraud`, 22–23 September 2026, unpublished) established
  that an escrow account can be an x402 `payTo`. Tessera is a new program and codebase built on that idea.

## Licence

MIT. See [LICENSE](LICENSE).
