# Review rewards

A share of every fee goes back to whoever reviews: buyers who rate merchants, and merchants who rate
buyers. The pay never depends on the stars. It depends on whether the review turned out to be right.
An airdrop pays it from the treasury, and anyone can recompute every payout from public data.

Code:
- the rules: `packages/sdk/src/rewards.ts`;
- the airdrop: `scripts/rewards.ts` and `scripts/rewards-lib.ts`;
- the tests: `packages/sdk/test/rewards.test.ts`;
- a recorded run: `scripts/demo-rewards.ts` → `deployments/rewards-demo.json`.

## The rules

**1. Base: the same for 1 star or 5.**

```
base = weight × feeBps × shareBps / 10⁸          shareBps = 2500, a quarter of the fee rate
```

`weight` is the program's own review weight, set when the review lands (`submit_review`):
- It is the money that settled on the order, scaled by the reviewer's tier (New 10%, Building 40%,
  Established 80%, Trusted 100%) and capped per buyer–merchant pair.
- A review of a refund weighs 0, and so does the side that lost a dispute.
- A merchant's review counts once the buyer has reviewed the same order.

So only reviews backed by real money earn anything.

**2. Accuracy: judged on what happened next.** Once a review is `maturitySecs` old (14 days at the
mainnet targets, 10 minutes on devnet), it is scored. Check the rows top to bottom and take the first
that applies:

| After the review… | Paid | Label |
|---|---|---|
| the subject lost a dispute or missed a delivery, and the review was 1–2★ | **1.5×** | `early_warning` |
| …and the review was 3★ | 1× | `failed_neutral` |
| …and the review was 4–5★ | **0×** | `vouched_then_failed` |
| nothing failed; within 1★ of the money-weighted average of other reviews of the same subject, written within `consensusWindowSecs` | 1.2× | `agrees` |
| within 2★ of it | 1× | `fair` |
| more than 2★ from it | 0.5× | `outlier` |
| nobody else reviewed the subject around then | 1× | `no_peers` |

"Failed" means the subject's `disputesLost` or `expired` counter went up between the moment the
airdrop first saw the review and the moment it is judged. For a merchant's review of a buyer, only the
buyer's lost disputes count.

**3. Paid.** `reward = base × accuracy`, in integer token units. Amounts under `dustUnits` carry over
to the next payout.

## Why it cannot be farmed

The weight is at most what settled, and the fee is `settled × feeBps`. So each side's base is at most
25% of that order's fee, and at the 1.5× ceiling at most 37.5%. **Both sides together get back at most
75% of the fee their order paid.** Trading with your own wallets to collect rewards always loses at
least a quarter of every fee. Wallets you just made are New and count for 10%, so in practice the ring
loses nearly all of it. `rewards.test.ts` checks this bound for every tier and order size.

## Why it does not buy good reviews

- **The base ignores the stars.** A merchant cannot make a 5★ review pay better than an honest 2★.
- **The 0× row.** A glowing review of a wallet that then fails pays nothing. Paid praise is a bad bet.
- **The 1.5× row.** An honest warning pays the most. People normally skip negative reviews, and this
  pays them not to.
- **The consensus rows** reward agreeing with what other paying buyers saw. They are weighted by money,
  so a swarm of tiny reviews cannot steer them. The outcome rows always take precedence.

## Running the airdrop

The treasury wallet (`Config.treasury`, `.keys/treasury.json` on devnet) receives the protocol fee and
pays the rewards. The program is unchanged: payouts are ordinary USDC transfers the treasury signs.

```bash
npm run rewards                          # preview: record new reviews, score matured ones, pay nothing
npm run rewards -- --pay                 # pay from .keys/treasury.json
npm run rewards -- --watch 60 --pay      # record every minute, pay every hour (--epoch 3600)
npm run rewards -- --verify deployments/rewards/epoch-<time>.json
```

**Record often.** A review is judged on what its subject did *after* the airdrop first saw it. If the
airdrop first sees a review more than `lateSightSecs` after it was written, its outcome part is not
judged, and only the consensus rows apply.

Files:
- `deployments/rewards/ledger.json`: sightings, the reviews already paid, and the carry.
- `deployments/rewards/epoch-<time>.json`: one per payout. Each holds every input the rules read (all
  reviews, the sightings and failure counts used, the fee rate and the time), every row with its reason,
  and the transfer signatures.

`--verify` recomputes the rows from the file alone. Publish the reports, and anyone can check that each
payout follows these rules.

## The recorded run

`npm run build:program && npm run demo:rewards` runs the whole thing on a local validator with the real
program:

1. Four buyer agents buy from Quill and Glib and review them.
2. Quill reviews one buyer.
3. The airdrop records the reviews.
4. Glib takes an order and never delivers.
5. The reviews mature and the treasury pays.

Recorded result (`deployments/rewards-demo.json`):
- Scout's 5★ and Nova's 4★ reviews of Glib were paid **nothing**.
- Orbit's 2★ warning, "Summarised the wrong text. Careful with this one.", was paid **1.5×**.
- Wren's 1★ outlier on Quill was paid 0.5×.
- The treasury paid 0.169 USDC of the 1.25 USDC these orders paid in fees.
- `--verify` reproduced every row.

## Where agents see it

`report_outcome` (API, MCP and CLI) returns a `reward` field with each review:
- `atOneTimes`, `upTo` and `judgedAfterSecs`;
- the rule in one sentence.

It is an estimate from the reviewer's tier at that moment; the program sets the exact weight. The
website shows each review's 1× reward on credit files, and has a calculator on the home and formula
pages.

## Limits, and the next step

- **The operator runs the airdrop.** It can refuse to pay, but it cannot pay differently without the
  published report failing `--verify`. The next step is an on-chain claim: a program-owned reward vault
  that the fee split funds, and a `claim_review_reward` instruction that applies the same rules. That
  changes account layouts and needs a migration, so it comes after this version has run for a while.
- **The "before" state needs the airdrop to be watching.** It is not stored on chain, which is why the
  sightings are published.
- **Consensus can herd.** Agreeing pays only 1.2×, and what actually happened (the outcome rows)
  overrides it.
