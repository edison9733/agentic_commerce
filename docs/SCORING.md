# The Tessera score

A credit score that decides when people get paid has to be checkable by the people it decides for.
This one is integer arithmetic over public accounts. Three implementations compute it and must agree:

| Where | File | Checked by |
|---|---|---|
| The program | [`programs/tessera/src/score.rs`](../programs/tessera/src/score.rs) | `npm run test:local` compares the on-chain score with the model after every instruction |
| The SDK | [`packages/sdk/src/score.ts`](../packages/sdk/src/score.ts) | `npm run test:formula` |
| The website | imports the SDK | shows "cached on-chain" next to "recomputed here" on every credit file |

## The formula

```
score    = 1000 × Evidence × Rating × Behaviour          (0 to 1000)
Evidence = 0.45 History + 0.30 Tenure + 0.25 Diversity
```

Evidence says how much is known about a wallet. Rating and Behaviour say whether what is known is
good. They multiply, so a long history cannot paper over bad reviews or a lost dispute.

The four things a credit score for agents should look at, and where each one is:

| Input | Where it is in the score | Why it is shaped that way |
|---|---|---|
| How much money moved | **History**: settled volume, weighted by the counterparty's tier, capped per counterparty | Volume alone is free to fake by trading with yourself |
| How many transactions, over what period | **Tenure** and the tier gates count *active periods*: periods with at least one settled order | A raw count rewards splitting one order into a hundred. Fifty orders in one period count as one active period; one order in each of fifty periods counts as fifty |
| How long the agent has existed | **Tenure**: age in periods, but never more than three times the active periods | An old wallet that never traded has shown nothing |
| How it behaved | **Rating** (stars from counterparties, weighted by settled volume) and **Behaviour** (a penalty for each lost dispute or missed delivery, which only time removes) | Both multiply the rest, so no amount of history hides them |

The order count and the total volume are still stored on every credit file and shown on the site. They
are facts about a wallet, not inputs to its tier.

### History

```
History = min(1, √(credit ÷ credit_full))
```

`credit` grows when an order is **released**: the buyer's at once, the merchant's when the buyer
reviews that order. A merchant opens and funds the escrow, so it could name any wallet as its buyer
and pay itself; only the buyer's own signature shows the buyer took part. Each side earns

```
min( volume × w ,  pair_cap × w  −  credit already earned from this counterparty )
```

where `w` is the tier weight of the *other* party when the order was opened:

| Counterparty tier | New | Building | Established | Trusted |
|---|---|---|---|---|
| Weight `w` | 10% | 40% | 80% | 100% |

So trading with wallets nobody knows proves little, one counterparty can never grant more than the pair
cap, a refund or a disputed order earns nothing, and a buyer who never spoke for an order lends the
merchant nothing. The square root means the first dollars of proven volume matter most. Diversity
points and the merchant's active period follow the same rule.

### Tenure

```
Tenure = min(1, min(age, 3 × active periods) ÷ tenure_full)
```

`age` is periods since the wallet's credit file was created. For a buyer, an active period is one in
which it had at least one order released; for a merchant, one in which a buyer reviewed one of its
released orders (the buyer's review is what shows the buyer took part). A wallet left to age earns
nothing; a thousand orders in one day are one active period.

### Diversity

```
Diversity = min(1, Σ points ÷ diversity_full)
```

Each counterparty contributes the best tier weight it has held while trading with this wallet, and only
once the pair has moved a tenth of the pair cap. Ten sock puppets are worth one Trusted customer.

### Rating

```
stars  = (prior × 3 + Σ wᵢ·rᵢ) ÷ (prior + Σ wᵢ)
Rating = clamp((stars − 1.5) ÷ 3, 0, 1)
```

A review's weight `wᵢ` is the volume that settled on the reviewed order, times the reviewer's tier
weight, capped per pair. A review of a refunded order weighs 0. A merchant's review of a released
order weighs 0 until the buyer has reviewed it too, and the side that lost a dispute gets no weight
on it (it already had its say before the arbiter). With no reviews a wallet sits at 3 stars, which
is a Rating of 0.5; it takes 4.5 stars for a Rating of 1.

### Behaviour

```
Behaviour = 1 − standing penalty
```

| Event | Penalty |
|---|---|
| Losing a dispute (either side) | +25% |
| Merchant missed the delivery deadline | +10% |
| Each period that passes | −0.25% |

### Tiers

A tier needs its score **and** its number of active periods. Trusted also needs no standing penalty.

| Tier | Score | Active periods (mainnet target / devnet) |
|---|---|---|
| New | any | any |
| Building | ≥ 250 | 3 / 2 |
| Established | ≥ 500 | 14 / 8 |
| Trusted | ≥ 750 | 30 / 20, and penalty = 0 |

## What a tier buys

**The hold.** `hold = max(hold[merchant tier], hold[buyer tier], hold the buyer asked for)`.

**Pair history.** A buyer with at least 2 released, undisputed orders from a merchant that it reviewed
itself, the first of them at least `pair_age` old, and no standing penalty, is treated as Trusted *for
that merchant*. Only reviewed orders count: a merchant can open and fund orders in any buyer's name, and
must not be able to waive that buyer's protection that way. This is
the on-chain form of what Visa's Compelling Evidence 3.0 accepts in a card dispute: earlier undisputed
purchases as evidence that the next one is legitimate. One dispute between the pair ends it for good.

**Instant settlement.** When the hold is 0 the merchant may take the money in the same transaction as
delivery, but only while

```
instant volume buyers have not accepted yet  ≤  instant_base + protocol fees the merchant has paid
```

A buyer rating an instant order 3 stars or more frees that amount at once, and so does a refund. An
order nobody rates frees when its review window ends. An order rated 1 or 2 stars never frees: its rent
comes back after the complaint period, but the amount stays locked for the life of the identity, so an
exit scam cannot be repeated by waiting. Past the limit, an order waits like an Established one, and so
does an order whose merchant has lost Trusted since the order was opened.

## Parameters

Every parameter is in the on-chain `Config` account. Devnet runs the same rules with time and amounts
compressed so a whole journey can be watched in under an hour.

| Parameter | Devnet (deployed) | Mainnet target (not deployed) |
|---|---|---|
| One period | 60 s | 1 day |
| Hold: New / Building / Established / Trusted | 120 s / 45 s / 10 s / 0 | 3 d / 1 d / 1 h / 0 |
| `credit_full` | 5 USDC | 10,000 USDC |
| `pair_cap` | 1 USDC | 500 USDC |
| `tenure_full` | 30 periods | 90 periods |
| `diversity_full` | 5 full-weight counterparties | 20 |
| Review prior | 0.5 USDC at 3 stars | 250 USDC at 3 stars |
| Instant base | 0.25 USDC | 25 USDC |
| Pair history | 2 orders, first ≥ 5 min old | 2 orders, first ≥ 30 days old |
| Review window / complaint period (rent of a complained-about order) | 10 min / 30 min | 14 days / 90 days |
| Protocol fee | 1% | 1% |

## What it guarantees

Each of these is a test in [`packages/sdk/test/score.test.ts`](../packages/sdk/test/score.test.ts); the
ones marked on-chain are also sent to the real program in [`scripts/test-local.ts`](../scripts/test-local.ts).

1. A wallet nobody knows scores 0, is New, and waits the longest hold.
2. Age alone earns nothing: a wallet left idle for a year has no Tenure.
3. Full evidence bought in one day does not even reach Building.
4. One-star reviews sink any amount of history.
5. Losing a dispute costs a quarter of the score and removes Trusted until it heals (100 periods).
6. One counterparty can never grant more than the pair cap. *(on-chain)*
7. Splitting a purchase into many small ones earns nothing extra.
8. A refund or a lost dispute earns no credit; a review of a refund weighs nothing. *(on-chain)*
9. Three wallets trading only with each other for a year never reach Trusted.
10. Instant settlement can net an exit scam at most the base allowance. *(on-chain)*
11. A merchant cannot borrow the tier of a buyer who never took part, or review-bomb it. *(on-chain)*
12. The side that lost a dispute cannot answer with a weighted review. *(on-chain)*

## What faking it costs

A ring is one operator running several wallets that only trade with each other and rate each other 5
stars. It is the cheapest way to farm a score, so it is the attack to price. Simulated at the mainnet
target parameters with the same arithmetic the program runs (`npm run test:formula` prints the table;
the one-year figures come from `attacks.simulateRing`):

| Wallets in the ring | Reaches Trusted | Fees burned | Can then take instantly, all wallets together | Net of taking it |
|---|---|---|---|---|
| 3 | never (one year simulated) | $53 over the year | $0 | −$53 |
| 6 | never (one year simulated) | $338 over the year | $0 | −$338 |
| 8 | day 83 | $686 | $886 | $200 ($25 per wallet) |
| 12 | day 33 | $1,617 | $1,917 | $300 ($25 per wallet) |
| 21 | day 30 | $4,868 | $5,393 | $525 ($25 per wallet) |

The ring trades as cheaply as it can: each order is only as large as it needs to be to fill what the
pair can still grant (credit and review weight are capped per pair at the counterparty's tier weight,
and Diversity needs a tenth of the pair cap), and never less than the minimum order, which keeps every
period active.

An honest merchant with 25 Trusted customers reaches Trusted on day 30, where the only wait is the
time gate. The same merchant with 25 customers nobody knows never does.

Read this honestly: a large enough ring that is willing to burn hundreds to a few thousand dollars in
fees over one to three months does reach Trusted. What it buys is instant settlement of roughly the fees it burned. The score
does not stop reputation from being bought; it sets the price, and the instant limit makes what was
bought worth about nothing for theft.

One more caveat: the table assumes the fees a ring burns stay burned. If the review-reward airdrop ([REWARDS.md](REWARDS.md)) is running, a ring can earn back part of its fees as reviewer rewards (at most 75% of the fee of an order that settled), so a ring's cost is lower than shown by up to that share. The airdrop is off-chain and optional, and the on-chain instant limit does not account for it.
