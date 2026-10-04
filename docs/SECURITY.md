# Security model

What can go wrong, what stops it, and the test that proves it. Then what is still open.

Tests: `npm run test:local` runs the real program on a local validator and sends each on-chain attack
below as a real transaction that must be rejected (256 checks). `npm run test:formula` checks the
economic claims (16 tests). "Model" means the claim is checked by simulation through the reference
model, which the local suite proves equal to the program.

Status: ✅ enforced and tested · 🟡 mitigated, residual risk stated · ⭕ open.

## Principles

1. **Verify, don't trust.** A merchant's server is a convenience, never an oracle. A buyer reads the
   order from the chain before paying. The program trusts nothing a caller says about money: funding is
   proven by the vault's balance.
2. **Trust is earned from counterparties, not minted by wallets.** Evidence counts by who the
   counterparty was, is capped per counterparty, and needs time that cannot be bought in a burst.
3. **Instant settlement is collateralised by sunk cost.** A merchant can take without a hold only what
   it has already paid in fees, plus a small base.
4. **Every protection starts at the risky moment.** The hold starts at delivery, not at payment, and a
   dispute freezes it.
5. **Governance cannot reach in-flight escrow.** Fee, arbiter and hold are snapshotted per order.
6. **Nothing is locked forever.** Unpaid and settled orders give their rent back.

## A. Payment integrity

| # | Attack | Status | Defence | Test |
|---|---|---|---|---|
| A1 | The merchant server quotes an escrow whose buyer is someone else (it refunds itself later). | ✅ | `verifyOrderForPayment` reads the order on-chain and checks buyer, merchant, amount, mint, state and request hash. | local: "quote is for an order opened for a different buyer" |
| A2 | The quote's `payTo` is the merchant's wallet, or any address that is not this order's escrow. | ✅ | The buyer derives the order address from the order id and requires `payTo` to equal it. | local: "quote names an escrow that is not this order" |
| A3 | The quote is for a larger amount than advertised. | ✅ | Amount must equal the on-chain order and not exceed the price on the agent card; the x402 client's spend cap is pinned to that exact amount. | local: "quote is for a different amount" |
| A4 | A facilitator redirects or alters the payment. | ✅ | Not possible: the buyer's signature fixes recipient, amount and mint. The worst a facilitator can do is refuse. | by construction |
| A5 | A facilitator is down or censors. | 🟡 | Every quote offers one option per reachable facilitator; a wallet can also fund the vault directly. | devnet: both quoted on every order |
| A6 | Someone claims an order was paid when it was not. | ✅ | `confirm_funded` only reads the vault balance. | local: "confirming an order nobody paid" → `VaultUnderfunded` |
| A7 | Overpayment is kept by the merchant. | ✅ | The merchant is owed at most the price; any excess returns to the buyer on every outcome. | local: "an overpayment comes back with the refund" |
| A8 | Paying into an order that was already cancelled. | ✅ | The vault account is closed on cancel, so the transfer fails. | by construction |

## B. Escrow logic

| # | Attack | Status | Defence | Test |
|---|---|---|---|---|
| B1 | The merchant takes the money before the hold ends. | ✅ | `release` by anyone but the buyer requires `now ≥ release_at`. | local: `HoldNotElapsed` |
| B2 | The merchant shortens a hold the buyer asked for. | ✅ | `min_hold_secs` can only lengthen the hold; it is stored on the order and checked by the buyer before paying. | local: "the merchant cannot shorten a hold the buyer asked for" |
| B3 | A stranger marks an order delivered, refunds it, disputes it, or cancels it. | ✅ | Each instruction checks the signer against the order's parties. | local: `NotAParty`, `Unauthorized` |
| B4 | The merchant never delivers and keeps the buyer waiting. | ✅ | After the delivery deadline anyone may refund the buyer; the merchant takes a 10% penalty. | local: "merchant never delivered" |
| B5 | The merchant delivers after the deadline to dodge the penalty. | ✅ | `deliver` fails with `DeliveryWindowClosed`. | local |
| B6 | The buyer disputes after the hold has ended, to claw back a settled payment. | ✅ | `open_dispute` requires `now < release_at`. | local: `DisputeWindowClosed` |
| B7 | The merchant releases an order that is in dispute. | ✅ | State check. | local: `InvalidState` |
| B8 | A stranger resolves a dispute, or the config authority appoints a friendly arbiter mid-dispute. | ✅ | Only the arbiter recorded on the order when it was opened may resolve it. | local: `Unauthorized` |
| B9 | The first caller after deployment takes over the config. | ✅ | `initialize` requires the program's upgrade authority, checked against ProgramData. | local |
| B10 | The same wallet is buyer and merchant, to review itself. | ✅ | Rejected (two mutable aliases of one credit file). | local |
| B11 | Abandoned quotes lock the rent payer's SOL. | ✅ | Either party may cancel any time; the rent payer after the payment window. Settled orders close after the review window. | local |
| B12 | Substituting a token account, mint, vault or credit file the attacker controls. | ✅ | Order, agents and pair by seeds; vault as the order's associated token account; payout accounts by owner and mint. | by construction |

## C. Reputation, sybils and farming

| # | Attack | Status | Defence | Test |
|---|---|---|---|---|
| C1 | **Wash trading** with one sock puppet to pump History. | ✅ | One counterparty can grant at most the pair cap times its tier weight. | local: "$15 of wash trades… can never earn more than the $1 pair cap"; formula |
| C2 | **A ring** of the attacker's own wallets. | 🟡 | New wallets count for 10%, each pair is capped, and Trusted needs 30 active periods. Rings of 3 and 6 never reach Trusted in a simulated year; larger ones do, at a cost of thousands in fees and one to three months. See [SCORING.md](SCORING.md#what-faking-it-costs). | model |
| C3 | **Burst farming** just before a scam. | ✅ | Tenure counts active periods; tiers are gated on them. Full evidence in one day does not reach Building. | formula |
| C4 | **Aged wallets**: create wallets, wait, then use them. | ✅ | Age counts only up to three periods per active period. | formula |
| C5 | **Exit scam** on instant settlement: earn Trusted, take orders, deliver nothing. | ✅ | Instant volume buyers have not accepted is capped at fees paid plus a base; a 1–2 star rating locks that amount. Net of the scam is at most the base per identity. | local: "a complaint locks the instant limit"; formula |
| C6 | **Friendly fraud**: the buyer got the goods and disputes anyway. | ✅ | The merchant committed a delivery hash on-chain before the dispute; the pair's history is on record for the arbiter. Losing costs the buyer 25%, removes Trusted, and ends pair trust for good. | local: "arbiter: buyer was wrong"; devnet |
| C7 | **Fake praise** from wallets that bought nothing. | ✅ | Only a party to a settled order can review it, once; weight is the volume that settled. | local: `NotAParty`, `already in use` |
| C8 | **Buy-and-refund** to mint reviews for free. | ✅ | A review of a refunded order weighs 0. | local; formula |
| C9 | **Review bombing** a competitor with bots. | ✅ | Priced like fake praise: a 1-star counts only after a real, settled purchase, weighted by that volume and the reviewer's tier, capped per pair. | formula |
| C10 | **One whale customer** makes a merchant look established. | ✅ | The pair cap again: $50,000 from one Trusted buyer earns exactly the $500 cap. | formula |
| C11 | **Dust**: thousands of tiny orders to fake Diversity. | ✅ | A counterparty counts only once the pair has moved a tenth of the pair cap. | local (model equality) |
| C12 | **Whitewashing**: abandon a penalised wallet for a fresh one. | 🟡 | A fresh wallet starts at 0 with the longest hold and no instant limit. Linking wallets to one operator needs attestations (open). | — |
| C13 | **Retaliation and reciprocity** in two-sided reviews. | ⭕ | Reviews are public as they land. Commit–reveal would fix it; not built. | — |
| C14 | **A lazy victim** never rates an instant order it was cheated on. | 🟡 | The amount frees after the review window. Buyer agents built with the SDK rate automatically when a delivery fails its hash check. | — |
| C15 | A site or API shows a fake score. | ✅ | The score is recomputable from public accounts; the website does so in the browser and shows both numbers. | site |

## D. Agents and servers

| # | Attack | Status | Defence |
|---|---|---|---|
| D1 | Rent-drain: flooding a merchant with quotes it pays rent for. | 🟡 | At most 3 unpaid orders per buyer wallet; rent returns after the payment window. Per-IP limits are not built. |
| D2 | Prompt injection through a service's output tells a buyer agent to pay someone. | 🟡 | The payment path is code, not prompt: it pays only an on-chain-verified escrow, for the advertised price, once. A budget per day and per merchant is not built. |
| D3 | A stolen merchant-server key. | 🟡 | It fronts rent and cranks permissionless steps. It cannot move escrow or act as a party. |
| D4 | A restart loses orders in flight. | ✅ | On start the server rebuilds its work list from the chain and refunds anything it was paid for but can no longer deliver. |
| D5 | A lying RPC fakes the reads verification depends on. | ⭕ | Use a trusted RPC or cross-check two. |

## Still open before any real money

- The **upgrade authority** is one key. Whoever holds it can replace the program and drain every vault.
  It needs a multisig with a timelock, and after an audit, possibly no authority at all.
- The **arbiter** is one key and, in the demo, a bot that checks a hash. It needs a real process:
  a multisig or juror set, a response deadline, and a fallback if it goes silent.
- **No audit.** The test suite is thorough for a hackathon and is not a substitute.
- **Commit–reveal reviews** (C13), **operator attestations** against whitewashing and large rings
  (C2, C12), and **agent spend budgets** (D2).
- The devnet **parameters** are compressed and have not been tuned against real traffic.
