# Pay later for agents (preview)

A second Solana program, [`programs/tessera-paylater`](../programs/tessera-paylater), lets an agent buy
now and pay later. Its credit limit comes from the agent's Tessera score. The escrow program is not
changed: pay-later only reads its accounts, and its built binary is identical with or without this
program in the workspace.

**Status: preview.** It runs and is tested on a local validator next to the real escrow program. It
is not deployed to devnet.

## How it works

1. **Buy now.** The buyer agent signs `buy_now`. A pool pays the merchant at once, minus a fee (2% in
   the preview rules). The buyer owes the full price by the due date and pays no interest.
2. **Pay later.** `repay` moves the full price back into the pool. Anyone may repay for the buyer.
   Repaying on time raises the limit.
3. **Or default.** Once the due date and a grace period have passed, anyone may call `mark_default`.
   The line freezes at 0 for good. The debt stays on the record and can still be repaid, as late.

## The limit

```
limit = tier_limit[tier] × score ÷ 1000 × (1 + boost)
boost = min(on-time repayments × step, max boost)
```

- `tier` and `score` are the buyer's **live** Tessera tier and score, recomputed by the program from
  the buyer's credit file with the escrow's own formula ([`score.rs`](../programs/tessera/src/score.rs)).
  A stale cached score is never used.
- A **New** wallet gets nothing: the program refuses rules where `tier_limit[New]` is not 0.
- Any default sets the limit to 0.
- What the buyer still owes counts against the limit.
- The program ([`credit.rs`](../programs/tessera-paylater/src/credit.rs)) and the SDK
  ([`limit.ts`](../packages/sdk/src/paylater/limit.ts)) compute the same number. The test checks they agree.

Preview rules (`PREVIEW_LINE_PARAMS`), in test USDC:

| | New | Building | Established | Trusted |
|---|---|---|---|---|
| Limit at a perfect score | 0 | 2 | 5 | 10 |

Each on-time repayment adds 25%, up to double. The loan term is 60 seconds and the grace period 5 seconds, so a whole cycle can be watched.
The pool only pays merchants at **Building** or above.

## Checks

`npm run test:paylater` (**40 / 40**) starts a local validator with both programs. Wallets earn their
tiers through real escrow orders, then:

- a New wallet, a wallet with no credit file, a New merchant, self-dealing and an amount below the minimum are all refused;
- a tiered buyer buys, the merchant is paid at once minus the fee, the loan snapshot matches the buyer's live score, and the limit matches the off-chain formula;
- spending past the limit, repaying twice, marking a default early or during the grace period, and a stranger taking a repaid loan's rent are all refused;
- an on-time repayment raises the limit by exactly 25%;
- a buyer who never repays is marked in default by a stranger, the line freezes, and a late repayment clears the debt but not the default;
- the pool's balance equals deposits minus withdrawals minus what merchants were paid, plus repayments;
- only the authority can create the pool, change its rules or withdraw, and an empty pool refuses purchases.

## Try it

```bash
npm run build:program
npm run paylater:local       # validator, both programs, tiered wallets, a funded pool; prints keypair paths
npm run tessera -- credit <alice> --rpc http://127.0.0.1:18999
npm run tessera -- buy-later <shop> 1.5 --keypair <alice.json> --rpc http://127.0.0.1:18999 --send
npm run tessera -- repay <loan> --keypair <alice.json> --rpc http://127.0.0.1:18999 --send
npm run tessera -- mark-default <loan> --keypair <stranger.json> --rpc http://127.0.0.1:18999 --send
```

## Limits

- **A default does not lower the Tessera score.** The escrow program does not know about pay-later.
  A defaulter's line freezes, but its escrow tier stays. Feeding defaults back into the score needs a
  change to the escrow program, which this preview deliberately does not make.
- **Collusion.** A buyer and a merchant working together can take up to the buyer's limit once,
  then the buyer's line freezes. The limit is only worth having after real settled trade with
  independent counterparties (see the farming costs in [SECURITY.md](SECURITY.md)), so the preview
  limits are kept small next to what a tier costs to earn.
- **One lender.** The pool's authority funds it and alone can withdraw. There are no outside lenders,
  shares or interest for depositors.
- **No instalments.** A loan is repaid in one payment.
- **Unaudited**, like the rest of the project.
