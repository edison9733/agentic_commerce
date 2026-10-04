# Architecture

```
 buyer agent ──A2A message/send──▶ merchant agent ──open_order──▶ ┌──────────────────────┐
      │      ◀──402: payTo = order── (apps/agents)                │  Tessera program      │
      │                                                            │  (programs/tessera)   │
      ├─ read + verify the order on-chain ───────────────────────▶ │                      │
      │                                                            │  Config  Agent  Pair  │
      ├─ signed x402 payment ─▶ merchant ─▶ facilitator ─transfer─▶ │  Order ─owns─ Vault   │
      │                                    confirm_funded ───────▶ │  Review               │
      │      ◀── deliverable ───────────── deliver(hash) ────────▶ │                      │
      │                                                            └──────────┬───────────┘
      └─ check hash, dispute or review ───────────────────────────────────────┘
                                                    ▲
 website (apps/web) ── getProgramAccounts ──────────┘   no indexer, no database
```

## Accounts

| Account | Seeds | Holds |
|---|---|---|
| `Config` | `["config"]` | authority, arbiter, treasury, mint, fee, and every scoring parameter |
| `Agent` | `["agent", wallet]` | the credit file: credit, counterparties, active periods, ratings, penalties, per-role counters, instant exposure, cached score and tier, name and A2A card URL |
| `Pair` | `["pair", buyer, merchant]` | settled orders and volume between two wallets, credit and review weight already granted, disputes |
| `Order` | `["order", order_id]` | one escrow: parties, amount, the risk snapshot taken at open (tiers, scores, hold), request and delivery hashes, timestamps, payouts |
| Vault | `ATA(mint, Order)` | the money. This is what makes the order a legal x402 `payTo`. |
| `Review` | `["review", order, reviewer]` | rating, text (on-chain, sized to the text), and the weight it carried |

## Order lifecycle

```
AwaitingPayment ──confirm_funded──▶ Funded ──deliver──▶ Delivered ──release──▶ Released
      │                               │                  │   (anyone after the hold; the buyer any time;
 cancel_unpaid                     refund                │    in the same transaction if the hold is 0
 (either party; the rent      (merchant any time;        │    and the merchant is inside its instant limit)
  payer after the window)      anyone after the          │
      ▼                        delivery deadline)        ├──refund (merchant)──▶ Refunded
   closed                          ▼                     └──open_dispute (buyer, during the hold)──▶ Disputed
                                Refunded                                         resolve_dispute (arbiter) ──▶ Resolved
```

Both parties may `submit_review` once per order after it settles. `close_order` returns the order's
rent after the review window, and is where an instant order nobody objected to stops counting against
the merchant's instant limit.

## Design decisions

- **`payTo` is the order account.** The x402 `exact` scheme on Solana permits only a token transfer, and
  derives the destination from `payTo` without requiring it to be a wallet. No custom scheme, no
  self-hosted facilitator.
- **The risk is priced at open and snapshotted.** Tiers, scores and the hold are written into the order,
  so nothing that happens later (a config change, a score change) alters an order in flight.
- **Bookkeeping is saturating, money is checked.** A statistic overflowing must never be able to hold
  escrow hostage; a payout must never silently wrap.
- **The site reads the chain directly.** Four `getProgramAccounts` calls and one account read, decoded
  with the generated client, polled every six seconds.
- **Transactions are v0.** The x402 `exact` scheme and browser wallets both speak v0 today, and every
  transaction here is far below the v0 size limit.
- **Agents send over plain HTTP.** The shared client in `scripts/lib.ts` sends with preflight and polls
  the signature, through a budgeted pool of RPC endpoints with failover. Public devnet endpoints
  rate-limit connections hard, and one websocket per signer did not survive that.

## Stack

Anchor 1.1.2 · Solana CLI 3.1 · `@solana/kit` 8 with a Codama-generated client · `@x402/core` and
`@x402/svm` 2.28 · React 19, Motion 14, Tailwind 4, Vite 8.
