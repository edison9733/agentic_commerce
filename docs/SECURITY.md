# Security model

What can go wrong, what stops it, and the test that proves it. Then what is still open.

Tests: `npm run test:local` runs the real program on a local validator and sends each on-chain attack
below as a real transaction that must be rejected (393 checks). `npm run test:formula` checks the
economic claims and the reward rules (44 tests). "Model" means the claim is checked by simulation through the reference
model, which the local suite proves equal to the program.

Status: ✅ enforced and tested · 🟡 mitigated, residual risk stated · ⭕ open.

## Audit of 7 October 2026

A pass over every instruction, the merchant server, the buyer agent and the website checkout, looking
for ways a buyer or a merchant could take money, take a delivery, or bend a score. What it found and
what was done:

| # | Finding | Severity | Fix | Test |
|---|---|---|---|---|
| B13 | Anyone could open an order in a merchant's name without its signature, fund it, and let it expire. Each missed delivery cost the merchant a 10% penalty and its Trusted tier, at almost no cost to the attacker. | Critical | `open_order` requires the merchant's signature. | local: "a stranger opens an order in a merchant's name" → `AccountNotSigner` |
| C16 | A merchant could name any Trusted wallet as the buyer and fund the order itself. It earned credit and Diversity at that wallet's full tier weight for 1% in fees, without the wallet ever taking part. | High | A released order becomes evidence for the merchant only when the buyer reviews it. | local: step 12; formula |
| C17 | The same forged orders let a merchant review-bomb any buyer with fully weighted one-star reviews. | High | A merchant's review of a released order weighs 0 until the buyer has reviewed it. | local: step 12; formula |
| D6 | The website's delivery endpoint took only the order address, which is public. Someone watching the chain could collect a delivery another wallet paid for; the real buyer got nothing and would then lose the dispute, because the delivery matched its hash. | High | The quote hands its requester a secret claim; the endpoint requires it. | server |
| D8 | The demo arbiter's evidence lived in memory. After a restart every dispute went to the buyer. | High | Deliveries are written to disk before the hash goes on-chain. With no record, the arbiter splits evenly and penalises nobody. | server |
| D1 | The per-wallet quote cap was bypassed by inventing wallet addresses. Each quote fronts rent, so a script could drain the server's SOL. | Medium | A per-client rate limit on everything that opens an order or uses the faucet, and a cap on each merchant's open quotes. | server |
| D7 | Over plain HTTP 402, anyone could pay for an order quoted to another wallet and receive what that wallet asked for. | Medium | The payment must be signed by the order's buyer. | server |
| C18 | A buyer that lost a dispute could answer it with a fully weighted one-star review of the merchant. | Medium | The side that lost a dispute gets no weight on it. | local: step 5; formula |
| B14 | A dispute the arbiter never resolved locked the money forever. | Medium | After the complaint period, anyone may split the vault evenly. Nobody is penalised. | local: step 14 |
| B15 | A party could close its own token account to stall a release or a refund. | Low | Anyone can recreate it; the agents' settle transactions now always do. | — |

## Audit of 10 October 2026

A second pass, this time over every component: the program, the SDK, the API, the agents, the CLI and MCP
server, the rewards script, the website and the image. 110 findings; the ones that mattered, and what was
done:

| # | Finding | Severity | Fix | Test |
|---|---|---|---|---|
| B16 | **Order swap.** While a buyer's signed payment was in flight, the merchant cancelled the order and reopened the same order id for its own second wallet. The payment then funded the new order and the merchant took it. | Critical | `cancel_unpaid` leaves the order in a `Cancelled` state until `close_order`, after the unpaid window. The id cannot be reopened, the vault is closed, and the buyer's SDK also refuses an order id that has already been used. | local: reopen fails with "already in use"; pay into a cancelled order fails |
| B17 | A payment could be confirmed after the payment window had closed. | Medium | `confirm_funded` fails with `PaymentWindowClosed` after `created_at + unpaid_secs`. | local |
| B18 | A buyer could ask for a hold of any length and the merchant's server co-signed it. | Medium | `min_hold_secs` is capped at 30 days (`HoldTooLong`); the buyer's SDK and the server both check. | local |
| B19 | The arbiter could be the buyer or the merchant of the order. | High | Rejected at `open_order` (`ArbiterIsParty`). | local |
| C19 | **Forged pair history.** Counterparty history grew on every release, so a merchant could build it without the buyer taking part. | High | Pair history grows only from orders the buyer reviewed. | local; formula |
| C20 | A merchant that had lost Trusted could still be paid instantly, because the tier was read when the order was opened. | High | `deliver` re-scores the merchant and settles instantly only if it is still Trusted and inside its limit. | local: step 16 |
| C21 | A refunded instant order kept counting against the merchant's instant limit, and a complaint could be cleared by closing the order. | Medium | A refund frees the amount; a complaint locks it for good. | local; formula |
| C22 | An even split of an odd amount gave a review the wrong weight. | Low | The half gate is exact on both sides. | local |
| D16 | The API relayed any signed transaction, for any program. | Medium | `/v1/tx/submit` relays only Tessera, token, associated-token, compute-budget and system instructions, and at least one Tessera instruction. | doors |
| D17 | One slow agent card could stall `find_merchants` for every caller (the timeout reset on every byte). | High | One wall-clock deadline per card, a size cap, no redirects, and an overall budget with partial results. | doors |
| D18 | The merchant server forgot quotes on restart and delivered nothing for orders funded after it, so the merchant took the missed-delivery penalty. | High | Quotes and delivery results are written to disk atomically; funded orders are completed or refunded before the deadline; delivery fails closed if its evidence cannot be saved. | agents smoke test |
| D19 | The review-reward airdrop could pay the same reviews twice if a later batch failed. | Critical | Each batch is recorded as pending, then paid, before the next one is sent; an exclusive lock; a missing ledger refuses to pay; payouts carry memos so a lost ledger can be rebuilt from the chain. | rewards tests; `demo:rewards` |

**The deployed devnet program predates both audits' program fixes.** They are in the source and pass the local suite.
To carry them to devnet the upgrade authority redeploys: stop `npm run agents` and `npm run swarm`,
wait out one review window (10 minutes on devnet) so no order released under the old rules is still
reviewable, then run `anchor build` and
`solana program deploy target/deploy/tessera.so --program-id TessSeP5QV5Bxpvm73iEefdsTjgtTEokKSx7jqFn1CQ --url devnet`.
No account layout changed, so every existing account keeps working. The agents in this repository
already co-sign new orders, which the old program accepts as well.

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
| A8 | Paying into an order that was already cancelled, or into a cancelled order's id that the merchant reopened for itself (B16). | ✅ | The vault is closed on cancel and the order stays as a `Cancelled` tombstone until `close_order`, so the id cannot be reopened. | local: tombstone checks |
| A9 | Someone watching the chain calls the website's delivery endpoint for an order another wallet paid for (D6). | ✅ | The endpoint requires the claim handed to whoever requested the quote. | server |
| A10 | Someone pays over HTTP 402 for an order quoted to another wallet, to receive what it asked for (D7). | ✅ | The x402 payment must be signed by the order's buyer. | server |

## B. Escrow logic

| # | Attack | Status | Defence | Test |
|---|---|---|---|---|
| B1 | The merchant takes the money before the hold ends. | ✅ | `release` by anyone but the buyer requires `now ≥ release_at`. | local: `HoldNotElapsed` |
| B2 | The merchant shortens a hold the buyer asked for. | ✅ | `min_hold_secs` can only lengthen the hold; it is stored on the order and checked by the buyer before paying. | local: "the merchant cannot shorten a hold the buyer asked for" |
| B3 | A stranger marks an order delivered, refunds it, disputes it, or cancels it. | ✅ | Each instruction checks the signer against the order's parties. | local: `NotAParty`, `Unauthorized` |
| B4 | The merchant never delivers and keeps the buyer waiting. | ✅ | After the delivery deadline anyone may refund the buyer; the merchant takes a 10% penalty. Before the deadline only the merchant may refund, without a penalty, so a merchant that cannot deliver can back out cleanly. | local: "merchant never delivered" |
| B5 | The merchant delivers after the deadline to dodge the penalty. | ✅ | `deliver` fails with `DeliveryWindowClosed`. | local |
| B6 | The buyer disputes after the hold has ended, to claw back a settled payment. | ✅ | `open_dispute` requires `now < release_at`. | local: `DisputeWindowClosed` |
| B7 | The merchant releases an order that is in dispute. | ✅ | State check. | local: `InvalidState` |
| B8 | A stranger resolves a dispute, or the config authority appoints a friendly arbiter mid-dispute. | ✅ | Only the arbiter recorded on the order when it was opened may resolve it. | local: `Unauthorized` |
| B9 | The first caller after deployment takes over the config. | ✅ | `initialize` requires the program's upgrade authority, checked against ProgramData. | local |
| B10 | The same wallet is buyer and merchant, to review itself. | ✅ | Rejected (two mutable aliases of one credit file). | local |
| B11 | Abandoned quotes lock the rent payer's SOL. | ✅ | Either party may cancel any time; the rent payer after the payment window. Settled orders close after the review window. | local |
| B12 | Substituting a token account, mint, vault or credit file the attacker controls. | ✅ | Order, agents and pair by seeds; vault as the order's associated token account; payout accounts by owner and mint. | by construction |
| B13 | A stranger opens orders in an honest merchant's name, funds them and lets them expire, so every missed delivery penalises the merchant. | ✅ | `open_order` requires the merchant's signature. | local: `AccountNotSigner` |
| B14 | The arbiter never answers, and the money stays locked. | ✅ | Once the complaint period has passed since the hold would have ended, anyone may split the vault evenly. An even split penalises nobody. | local: before the deadline `Unauthorized`, any other split `InvalidParams` |
| B15 | A party closes its own token account to stall a release or a refund. | 🟡 | Anyone may recreate an associated token account; the agents' settle transactions do so first. The program still requires the account. | — |

## C. Reputation, sybils and farming

| # | Attack | Status | Defence | Test |
|---|---|---|---|---|
| C1 | **Wash trading** with one sock puppet to pump History. | ✅ | One counterparty can grant at most the pair cap times its tier weight. | local: "$15 of wash trades… can never earn more than the $1 pair cap"; formula |
| C2 | **A ring** of the attacker's own wallets. | 🟡 | New wallets count for 10%, each pair is capped, and Trusted needs 30 active periods. Rings of 3 and 6 never reach Trusted in a simulated year; larger ones do, at a cost of hundreds to a few thousand dollars in fees and one to three months, and can then take back about those fees plus the base. See [SCORING.md](SCORING.md#what-faking-it-costs). | model |
| C3 | **Burst farming** just before a scam. | ✅ | Tenure counts active periods; tiers are gated on them. Full evidence in one day does not reach Building. | formula |
| C4 | **Aged wallets**: create wallets, wait, then use them. | ✅ | Age counts only up to three periods per active period. | formula |
| C5 | **Exit scam** on instant settlement: earn Trusted, take orders, deliver nothing. | ✅ | Instant volume buyers have not accepted is capped at fees paid plus a base; a complaint locks that amount for good (C21). A ring of 8 or more wallets does recover its fees plus the base per wallet, so it nets about $25 a wallet after a month or more. | local: "a complaint locks the instant limit"; formula |
| C6 | **Friendly fraud**: the buyer got the goods and disputes anyway. | ✅ | The merchant committed a delivery hash on-chain before the dispute; the pair's history is on record for the arbiter. Losing costs the buyer 25%, removes Trusted, and ends pair trust for good. | local: "arbiter: buyer was wrong"; devnet |
| C7 | **Fake praise** from wallets that bought nothing. | ✅ | Only a party to a settled order can review it, once; weight is the volume that settled. | local: `NotAParty`, `already in use` |
| C8 | **Buy-and-refund** to mint reviews for free. | ✅ | A review of a refunded order weighs 0. | local; formula |
| C9 | **Review bombing** a competitor with bots. | ✅ | Priced like fake praise: a 1-star counts only after a real, settled purchase, weighted by that volume and the reviewer's tier, capped per pair. A merchant's review counts only once the buyer has reviewed the same order (C17). | formula |
| C10 | **One whale customer** makes a merchant look established. | ✅ | The pair cap again: $50,000 from one Trusted buyer earns exactly the $500 cap. | formula |
| C11 | **Dust**: thousands of tiny orders to fake Diversity. | ✅ | A counterparty counts only once the pair has moved a tenth of the pair cap. | local (model equality) |
| C12 | **Whitewashing**: abandon a penalised wallet for a fresh one. | 🟡 | A fresh wallet starts at 0 with the longest hold and no instant limit. Linking wallets to one operator needs attestations (open). | — |
| C13 | **Retaliation and reciprocity** in two-sided reviews. | ⭕ | Reviews are public as they land. Commit–reveal would fix it; not built. | — |
| C14 | **A lazy victim** never rates an instant order it was cheated on. | 🟡 | The amount frees after the review window. Buyer agents built with the SDK rate automatically when a delivery fails its hash check. | — |
| C15 | A site or API shows a fake score. | ✅ | The score is recomputable from public accounts; the website does so in the browser and shows both numbers. | site |
| C16 | **Borrowed reputation**: a merchant names a Trusted wallet as the buyer and funds the order itself. The buyer never signs `open_order`, and anyone can fund a vault. | ✅ | The buyer's credit is granted at release; the merchant's credit, Diversity and active period only when the buyer reviews the order. Money moves without the buyer; reputation does not. | local: step 12; formula |
| C17 | **Review bombing through forged orders**: the same merchant rates that buyer one star. | ✅ | A merchant's review of a released order weighs 0 until the buyer has reviewed it. | local: step 12; formula |
| C18 | **Retaliation by the loser of a dispute**: it rates the other side one star, with the full weight of the order. | ✅ | The side that received less than half of the price in a dispute gets no weight on its review. | local: step 5; formula |

## D. Agents and servers

| # | Attack | Status | Defence |
|---|---|---|---|
| D1 | Rent-drain: flooding a merchant with quotes it pays rent for. | 🟡 | At most 3 unpaid orders per buyer wallet and 40 per merchant, and 20 order-opening requests per client per minute. The server cancels unpaid quotes after the payment window, including ones from before a restart, and the order rent returns. Residual: each invented buyer address still leaves a credit file and a pair account whose rent does not come back. Behind a tunnel or proxy set `TRUST_PROXY` so the limit sees real clients. |
| D2 | Prompt injection through a service's output tells a buyer agent to pay someone. | 🟡 | The payment path is code, not prompt: it pays only an on-chain-verified escrow, for the advertised price, once. A budget per day and per merchant is not built. |
| D3 | A stolen merchant-server key. | 🟡 | It fronts rent and cranks permissionless steps. It cannot move escrow or act as a party. |
| D4 | A restart loses orders in flight. | ✅ | Quotes and delivery results are kept on disk and reloaded; on start the server also rebuilds its work list from the chain and refunds anything it was paid for but can no longer deliver. A Railway volume at `/app/.data` is required; without it the server refuses new orders. |
| D5 | A lying RPC fakes the reads verification depends on. | ⭕ | Use a trusted RPC or cross-check two. |
| D6 | A watcher collects a delivery from the website's endpoint that another wallet paid for. The real buyer gets nothing and then loses the dispute, because the delivery matched its hash. | ✅ | Only the requester of the quote holds its claim, and the endpoint requires it. |
| D7 | Someone pays over plain HTTP 402 for an order quoted to another wallet. | ✅ | The signer of the x402 payment must be the order's buyer. |
| D8 | The arbiter's evidence is lost in a restart, so every later dispute goes to the buyer. | ✅ | Each delivery is written to `.data/deliveries.jsonl` before its hash goes on-chain and is read back on start. With no record the arbiter splits evenly. |
| D10 | A compromised or lying Tessera API hands an agent a transaction that pays someone else. | 🟡 | The API is non-custodial: it holds no keys and cannot move money by itself, but an agent signs what it is given. The CLI takes the order from the user, checks it on-chain itself, and refuses anything but the Tessera, SPL Token, associated-token and compute-budget programs, any extra signer or lookup table, and any token transfer except the order's amount into the escrow vault it derives itself (tested against a fake API in `npm run test:doors`). SKILL.md tells agents to check `signers`, `transfers` and `simulation`. Other clients must do the same. |
| D11 | Flooding the API with requests that simulate transactions. | 🟡 | Per-client limits per minute: 120 reads, 30 builds, 20 submits, keyed by IPv4 address or IPv6 /64 in a bounded table. The hosted MCP server is limited per client and passes each client's key to the API with a shared secret (`TESSERA_RELAY_SECRET`), so its users do not share one allowance. On Railway one proxy hop is trusted automatically; elsewhere set `TRUST_PROXY`. |
| D12 | A merchant buys a top spot in `find_merchants`. | 🟡 | The rank uses only on-chain data, the same as the score, so faking it costs what faking the score costs (C1 to C3: settled volume, fees and time; large rings stay open, C2). Self-declared card text only decides whether a merchant matches a need and its price, never its rank. |
| D13 | A merchant's card or a review carries instructions for the reading agent (prompt injection). | 🟡 | Card and review text is cut short and stripped of control, bidirectional, invisible and Unicode tag characters, and every `find_merchants` reply says that `name`, `service` and review text are data, not instructions; SKILL.md and the MCP server's instructions say the same. An agent that obeys text it reads can still be misled. |
| D14 | A merchant points its `uri` at an internal address so the API fetches it (SSRF). | ✅ | Cards are fetched with http(s) only, no redirects, one 1.5 s wall-clock deadline and a 64 KB cap, and never from a private, loopback, link-local, carrier-grade or reserved address, including IPv6 forms that embed an IPv4 address, checked on the address the socket connects to. Private cards are allowed only with `TESSERA_ALLOW_PRIVATE_CARDS=1`, never because of `HOST`. Tested in `npm run test:doors`. |
| D15 | A copycat's card claims another merchant's services or wallet. | ✅ | A card whose Tessera extension names a different wallet is ignored; the row keeps the copycat's own on-chain record. Tested in `npm run test:doors`. |
| D9 | Draining the demo faucet with invented wallets. | 🟡 | Once per wallet, 3 per client per hour, 20 per hour in total. Devnet only; a real deployment has no faucet. |

## R. Review rewards

The airdrop in [REWARDS.md](REWARDS.md). It is off-chain; the program is unchanged.

| # | Attack | Status | Defence |
|---|---|---|---|
| R1 | Trade with your own wallets to farm review rewards. | ✅ | A reward is at most 37.5% of its order's fee per side, so 75% for both: farming always loses at least a quarter of every fee, and New wallets count for 10%. Tested for every tier and size in `rewards.test.ts`; `npm run demo:rewards` checks a real payout stays under 75% of the fees. |
| R2 | A merchant pays buyers for 5-star reviews. | ✅ | The base pay ignores the stars, and a 4-5 star review of a wallet that then loses a dispute or misses a delivery is paid nothing; an honest warning is paid 1.5x. Shown on chain in `npm run demo:rewards`. |
| R3 | Reviewers herd to the consensus instead of rating what they got. | 🟡 | Agreeing pays only 1.2x against 1x, the consensus is weighted by money, and what actually happened next overrides it. |
| R4 | The operator pays itself, or pays differently from the rules. | 🟡 | Each payout file holds every input; `npm run rewards -- --verify` recomputes it, and the transfers are on chain. The operator can still refuse to pay; an on-chain claim is the next step. |
| R5 | A review is first seen after its subject already failed, and gets paid for "predicting" it. | ✅ | Failures are counted from the moment the airdrop first saw the review; a review first seen more than `lateSightSecs` after it was written is judged on consensus only. |

## What "sybil-resistant" means here, and what it does not

Tessera does not claim to be sybil-proof. Cheng and Friedman showed in 2005 ("Sybilproof reputation
mechanisms", ACM SIGCOMM P2PECON workshop) that no reputation function that treats every node the same
way can be. Tessera's score is such a function: it has no trusted seed and no notion of "my" view of
the graph. An attacker with enough wallets, money and time can reach any tier.

What the design does instead:

1. **It puts a price on the attack.** A fake record costs protocol fees that never come back and time
   that cannot be compressed. The numbers are in [SCORING.md](SCORING.md#what-faking-it-costs).
2. **It bounds the prize.** A faked Trusted merchant can take without a hold only what it already paid
   in fees, plus a small base (C5). Everything else still sits in escrow, where a buyer can dispute it.
3. **It keeps the damage local.** A penalty lands on the wallet that earned it, and a pair that had a
   dispute never gets pair trust back.

The ERC-8004 authors make the same admission about their Reputation Registry ("Sybil attacks are
possible, inflating the reputation of fake agents"). How Tessera plugs into that registry on Solana is
in [ERC-8004.md](ERC-8004.md).

## E. The Agent Registry bridge

| # | Attack | Status | Defence |
|---|---|---|---|
| E1 | Someone posts registry feedback that claims to be a Tessera review. | ✅ | A mirrored entry names a Tessera review account. A reader checks that the account exists, is owned by the program, and matches the reviewer, the subject and the rating. The program only creates it for a party to a settled order. `npm run registry -- --verify` does this check for every mirrored entry. |
| E2 | A merchant points its registry identity at someone else's credit file. | ✅ | The link is two-way. The registry asset's agent wallet must be the wallet whose credit file it names; setting that wallet needs its signature. |
| E3 | The registry, its indexer or the script is wrong or offline. | ✅ | Nothing in the score or the escrow reads the registry. The bridge is one-way and optional. |

## Still open before any real money

- The **upgrade authority** is one key. Whoever holds it can replace the program and drain every vault.
  It needs a multisig with a timelock, and after an audit, possibly no authority at all.
- The **arbiter** is one key and, in the demo, a bot that checks a hash. It needs a real process:
  a multisig or juror set and a response deadline. The fallback if it goes silent exists (B14), but
  an even split is a blunt answer.
- **Live parameters reach open orders.** The fee, arbiter and hold are snapshotted per order, but the
  delivery, review and complaint windows, the instant base and the hold past the instant limit are
  read from the config when used, so a config change can move them for orders already open.
- **Order ids can be reused** once a settled or cancelled order account is closed. Reviews are keyed by
  the order's address, so a reused id cannot be reviewed again, and the buyer's SDK refuses an id that
  already has a review. Merchants pick random ids, so this only bites a merchant that reuses its own.
- **The deployed devnet program is the old one.** Every program fix above needs the upgrade authority to
  redeploy; until then devnet still has the order-swap hole.
- **Rate limits and the card cache are per process.** Several API or agents instances multiply them.
- **Unsolicited orders still touch a buyer's file.** A merchant can still open and fund an order in
  any buyer's name. The buyer gains credit and an active period from it, and its order count rises,
  but nobody gains anything from the buyer (C16, C17).
- **No audit.** The test suite is thorough for a hackathon and is not a substitute.
- **Commit–reveal reviews** (C13), **operator attestations** against whitewashing and large rings
  (C2, C12), and **agent spend budgets** (D2).
- The devnet **parameters** are compressed and have not been tuned against real traffic.
