# Tessera

**The credit layer for agent commerce.** x402 payments land in escrow on Solana, and an on-chain
credit score decides how long the money waits. Strangers wait. Agents with a record settle at once.

> *Every payment matters.*

| | |
|---|---|
| Program (devnet) | [`TessSeP5QV5Bxpvm73iEefdsTjgtTEokKSx7jqFn1CQ`](https://explorer.solana.com/address/TessSeP5QV5Bxpvm73iEefdsTjgtTEokKSx7jqFn1CQ?cluster=devnet) |
| Config account | [`DgwhgcXkhNwpouzppHdF7KNACA14U1JWPccFH5ZGeNE2`](https://explorer.solana.com/address/DgwhgcXkhNwpouzppHdF7KNACA14U1JWPccFH5ZGeNE2?cluster=devnet) |
| Settles in | devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`), 1% protocol fee |
| Status | Devnet only. Unaudited. The traffic on devnet is this project's own agents. See [what is real](#what-is-real-and-what-is-not). |

Built for the Colosseum Crypto World's Fair hackathon (Solana track), October 2026.

---

## The problem

An x402 payment is a signed token transfer. Once a facilitator settles it, it is final: there is no
chargeback and nobody to call. Card networks answer "did I get what I paid for?" months later — Visa's
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
| `npm run test:local` | **256 / 256** | Runs the real program on a local validator. After every instruction, every account is compared field by field with a reference model, and every attack in [docs/SECURITY.md](docs/SECURITY.md) is sent as a real transaction and must fail. |
| `npm run test:formula` | **16 / 16** | The guarantees stated in the docs and on the site, as tests. |

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
npm run test:formula         # 16 formula tests, no chain needed
npm run test:local           # 256 checks on a local validator (about 3 minutes)
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
```

One purchase by one agent:

```bash
npm run buy -w @tessera/agents -- --buyer scout --merchant atlas --mode x402
```

The site reads the chain directly, so `npm run web` alone shows the live network. Only the Market page
needs `npm run agents`.

## Repository layout

```
programs/tessera/     Anchor program: escrow state machine, score, reviews, disputes
packages/sdk/         Typed client (Codama), PDA helpers, payment verification,
                      the score mirror, the reference model, attack simulations
apps/agents/          Merchant agents (A2A + x402), buyer agent, swarm, crank, arbiter
apps/web/             React + Motion site: live network, credit files, market, decks
scripts/              Devnet bootstrap and the local-validator test suite
pitch/                Video renderer; scripts are generated from the decks
docs/                 Scoring, security model, architecture, A2A extension, submission pack
deployments/          Public addresses and measured timings
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
- **Unaudited**, and the A2A endpoint is hand-rolled from the specification rather than certified.
- **It prices faking; it does not detect it.** On-chain data cannot tell a bot from a customer who
  spends the same money. See the limits in [docs/SECURITY.md](docs/SECURITY.md).

## Where the ideas come from

- [x402](https://x402.org) and [A2A](https://a2a-protocol.org) carry the payment and the conversation,
  unchanged.
- [ERC-8004, Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004) proposes identity, reputation
  and validation registries for agents. Tessera is not an implementation of it; the agent account, the
  review accounts and the delivery hash play the corresponding roles on Solana.
- [Visa Compelling Evidence 3.0](https://www.checkout.com/blog/visa-compelling-evidence-3-0): earlier
  undisputed purchases are evidence a later one is legitimate. The pair account is that evidence, kept
  by the program.
- An earlier prototype by the same author (`x402-fraud`, 22–23 September 2026, unpublished) established
  that an escrow account can be an x402 `payTo`. Tessera is a new program and codebase built on that idea.

## Licence

MIT. See [LICENSE](LICENSE).
