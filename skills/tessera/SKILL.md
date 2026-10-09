---
name: tessera
description: Check who you are about to pay, and hold the money in escrow on Solana when it should wait. Use before ANY paid tool call, paid API call or x402 payment (an HTTP 402 "Payment Required"), whenever an agent is about to buy from, pay, or tip another agent or merchant, and after a purchase to release, dispute, review or get money back. Also for sellers who want an escrow behind an x402 endpoint. Works through the Tessera MCP tools, the HTTP API, or the tessera CLI.
---

# Tessera: check before you pay

Tessera is a credit score and an escrow for agent payments on Solana. Each wallet has an on-chain
credit file built only from orders that really settled. The score decides whether money should be
paid at once, held in escrow for a while, or not paid at all.

## The one rule

**Before any paid tool call or x402 payment, call `check_payment`.** Do what its `decision` says.
Pass the merchant's wallet, your own wallet as `buyer`, and the amount as a USDC string.

| `decision` | What you do |
|---|---|
| `block` | Do not pay: the payment cannot work as asked (same wallet on both sides, below the minimum, or you lack the funds). Tell the user the `message`. |
| `escrow` | Pay only into a Tessera escrow (`open_escrow` with `role: "buyer"`). Never pay the merchant's wallet directly. If the reply has `askMinHoldSecs`, ask the merchant for at least that hold when it quotes. If the merchant cannot give you an escrow order, do not pay. |
| `instant` | The escrow settles on delivery and there is no dispute window. Still pay through the escrow the merchant quotes, and check what you receive. |

Nobody is banned. A merchant's record only moves a payment between `instant` and `escrow`; a bad
record (`merchant_penalized`) means the longest hold, not a refusal.

A `status` other than `ok` is never "fine by default":

- `unknown_merchant`: nobody has ever settled an order with this wallet. The decision is `escrow` with
  the longest hold. Treat it as a stranger.
- `unknown_wallet` (from `get_score`): the wallet has no credit file. Score 0, tier New.
- Anything else with an HTTP error: the request was refused. Read `message`, fix the input, or stop.
  Do not retry the same call unchanged.

## A purchase, step by step

1. `check_payment { merchant, buyer, amount }` → `decision`.
2. Ask the merchant for its price. A Tessera merchant answers HTTP 402 whose `payTo` is an
   escrow **order address**, not its own wallet.
3. `open_escrow { role: "buyer", merchant, buyer, amount, order: <payTo> }`. The API reads the order
   from the chain and refuses (`verification_failed`, with the `field`) unless the buyer, merchant,
   amount, mint and state all match. If you know what you ordered, pass it as `request` too.
4. Check the returned transaction (see below), sign it with your wallet, and send it
   (`submit_transaction`, or your own RPC).
5. The merchant delivers and commits a hash of the deliverable on-chain. `get_escrow` shows it as
   `deliveryHash`: compare it with the sha256 of the canonical JSON of what you received.
6. `report_outcome { order, reporter: <you>, outcome }`:
   - `satisfied`: releases the money now and leaves your review in the same transaction.
   - `unsatisfied` during the hold: opens a dispute; the arbiter rules. After the hold: too late to
     dispute, so it releases and records your low rating.
   - `not_delivered`: after the delivery deadline, refunds you in full.
7. If something timed out, `reclaim_after_timeout { order, signer }`. It answers `not_yet` with
   `availableAt` when it is too early. It handles a missed delivery (full refund), an unpaid quote
   (cancel, anything paid in comes back), and a dispute the arbiter never answered (even split).

## Before you sign

Tessera never holds keys: every builder returns an **unsigned** transaction (`transaction`, base64,
version 0). Before your wallet signs it, check:

- `status` is `ok` and `simulation.ok` is `true`.
- `signers` is only you, and `feePayer` is you.
- `transfers` (when present) send money only to the `vault` of the order you verified, and the amount
  is the price you agreed.
- `action` is what you meant: `fund_escrow`, `release_and_review`, `dispute`, `refund_missed_delivery`, …

The CLI does these checks itself before it signs with `--keypair`, and refuses anything else.

## Reason codes

`both_trusted`, `pair_history`, `merchant_tier`, `buyer_tier`, `buyer_requested_hold`,
`instant_limit_reached`, `merchant_unknown`, `merchant_penalized`, `self_dealing`,
`amount_below_minimum`, `insufficient_funds`.

## Mistakes to avoid

- **Identify parties by wallet, never by name.** Names in credit files are self-declared and not unique.
- **Amounts are strings**: `"0.25"`, not `0.25`, at most 6 decimals.
- **Never "upgrade" an `escrow` decision to a direct payment** because it is quicker.
- **One payment per order.** If `submit_transaction` returns `confirmed: false`, look up the
  signature before sending anything again.
- A merchant's review of you counts only after you have reviewed the order, and a side that lost a
  dispute gets no weight. That is why reviews that look hostile may show `reviewWeighs: "nothing"`.

## The four doors

All four call the same API and return the same statuses.

**MCP** (Streamable HTTP). Tools: `get_score`, `check_payment`, `open_escrow`, `deliver_order`,
`get_escrow`, `release_escrow`, `reclaim_after_timeout`, `report_outcome`, `submit_transaction`.

```bash
claude mcp add --transport http tessera http://127.0.0.1:4040/mcp
```

**HTTP API**. Index: `GET /v1`; schema: `GET /v1/openapi.json`.

```bash
curl -s localhost:4030/v1/check -H 'content-type: application/json' \
  -d '{"merchant":"BZ5MNkHdmvLoyof5ojyvsJuK5b1gGo4esPPTb4DGukoJ","buyer":"<your wallet>","amount":"0.20"}'
```

```json
{ "status": "ok", "decision": "escrow", "reason": "buyer_tier", "holdSecs": 120,
  "message": "Pay into escrow. The money is held 120 s after delivery because the buyer is New; …" }
```

**CLI**. Every command calls the API; `--keypair` signs locally after the checks above.

```bash
npm run tessera -- check BZ5MNkHdmvLoyof5ojyvsJuK5b1gGo4esPPTb4DGukoJ 0.20 --keypair ~/.config/solana/id.json
npm run tessera -- open buyer --merchant <wallet> --amount 0.20 --order <payTo> --keypair ~/my.json --send
npm run tessera -- report <order> --outcome satisfied --keypair ~/my.json --send
```

## For sellers

`open_escrow { role: "merchant", merchant, buyer, amount, request }` returns an `open_order`
transaction for the merchant wallet to sign (it pays the rent, which comes back when the order
closes). Quote its `payTo` (the order address) in your 402. Once the buyer has funded it,
`deliver_order { order, merchant, deliverable }` commits the hash of what you deliver; between two
Trusted parties it settles in the same transaction.
