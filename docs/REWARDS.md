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

`feeBps` is the fee rate the review's own order paid, or the config's rate now if that is lower. Each
order keeps the rate it was opened at, and the airdrop reads it when it first sees the review. If the
order was already closed by then, the config's rate is used, but at most 1% (`PROTOCOL_FEE_BPS`), and
the row is marked `orderFeeSeen: false`.

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

The weight is at most what settled, and the fee is `settled × the order's feeBps`. The base never uses
a higher rate than the order paid, so each side's base is at most 25% of that order's fee, and at the
1.5× ceiling at most 37.5%. **Both sides together get back at most 75% of the fee their order paid.**
Raising the fee later changes nothing for orders already open, and an order opened at 0% earns nothing.
Trading with your own wallets to collect rewards always loses at least a quarter of every fee. Wallets
you just made are New and count for 10%, so in practice the ring loses nearly all of it.
`rewards.test.ts` checks this bound for every tier and order size, and for an order's rate that differs
from the config's.

The one case the airdrop cannot check is an order it never saw. An order cannot close until its review
window has passed (10 minutes on devnet, 14 days at the mainnet targets), and the airdrop is meant to
record every minute (`--watch 60`), so that needs it to have been off for a whole window. Such a review counts at most 1%,
the default rate, and is marked in its report.

## Why it does not buy good reviews

- **The base ignores the stars.** A merchant cannot make a 5★ review pay better than an honest 2★.
- **The 0× row.** A glowing review of a wallet that then fails pays nothing. Paid praise is a bad bet.
- **The 1.5× row.** An honest warning pays the most. People normally skip negative reviews, and this
  pays them not to.
- **The consensus rows** reward agreeing with what other paying buyers saw. They are weighted by money,
  so a swarm of tiny reviews cannot steer them. The outcome rows always take precedence.

## Running the airdrop

Payouts are ordinary USDC transfers, signed by the paying wallet; the program is unchanged. The
treasury (`Config.treasury`, `.keys/treasury.json` on devnet) receives the protocol fee and is the
default payer.

**Pay from a separate rewards wallet.** The airdrop keeps its key in memory for as long as it runs. If
that key is the treasury's, a bug or a compromised host reaches every fee ever collected. Instead,
make a rewards wallet, give it a USDC token account, and each epoch fund it from the treasury with the
report's `totals.paid` plus a little SOL for fees. Keep the treasury offline, ideally behind a
multisig. Then `--payer <keypair file>` pays from the rewards wallet; the treasury key never touches
the airdrop host. Key files should be readable only by their owner (`chmod 600`); the airdrop warns
when one is not.

```bash
npm run rewards                                         # preview: record new reviews, score matured ones, pay nothing
npm run rewards -- --pay --payer .keys/rewards.json     # pay from a rewards wallet (default .keys/treasury.json)
npm run rewards -- --watch 60 --pay --payer .keys/rewards.json   # record every minute, pay every hour (--epoch 3600)
npm run rewards -- --verify deployments/rewards/epoch-<time>.json
```

Options: `--params devnet|mainnet` (default devnet), `--ledger <file>`, `--out <dir>`,
`--force-unlock`, `--allow-fallback-rpc`. `--watch` and `--epoch` take a whole number of seconds;
anything else, or a `--params` that is neither `devnet` nor `mainnet`, stops the airdrop with a message.

**Record often.** A review is judged on what its subject did *after* the airdrop first saw it. If the
airdrop first sees a review more than `lateSightSecs` after it was written, its outcome part is not
judged, and only the consensus rows apply.

**Which RPC it believes.** What gets paid depends on what the RPC says, so the airdrop reads only from
`SOLANA_RPC_URL` (devnet's public endpoint by default) and never from the third-party fallbacks the
other scripts use. `--allow-fallback-rpc` turns those back on. `--params mainnet` needs
`SOLANA_RPC_URL` set, and on a cluster whose genesis hash is mainnet's the airdrop refuses any other
params.

**Recipients need their own USDC token account.** The payer never creates one: a recipient that closed
its account after every payout would take the rent each time. A wallet with no usable account
(missing, frozen, or no longer its own) is listed under `withheld` in the report, and its amount is
carried until it has one.

### Nothing is paid twice

- **One run at a time.** A run takes `ledger.json.lock`, created exclusively and holding its pid, host
  and start time, and removes it when it exits. A paying run will not start while the lock exists; a
  preview still runs but records nothing. A lock left by a run that was killed is never reused
  silently: the airdrop says whose it is, and `--force-unlock` clears it once you have checked that run
  is gone.
- **Each batch is recorded as it lands.** Before a transaction is sent, the ledger marks its batch
  pending; as soon as it confirms, its reviews are marked paid with the signature, before the next one
  is sent. The ledger and the report are written atomically (a temporary file, flushed, then renamed),
  and a report is never overwritten.
- **Every payout names its reviews on chain.** Each transaction carries an SPL Memo,
  `tessera-rewards 1 <epoch>/<run>.<batch> <review>,<review>,…`, listing every review it pays, carried ones
  included. Before paying, the airdrop reads the payer's and the treasury's recent transactions back to
  the oldest unpaid review and skips every review a memo already names. Only memos in transactions the
  payer or the treasury paid for count, so nobody else can mark a review paid. A batch still pending
  from a run that stopped mid-send is settled the same way, by the tag only it carries: on chain, it is
  marked paid; not on chain and three minutes old by both the local clock and the chain's (its
  blockhash has expired), it is dropped; otherwise the airdrop waits.
- **A lost ledger is refused.** If `ledger.json` is missing while payout reports sit next to it, or it
  cannot be parsed, the airdrop stops instead of starting empty. A fresh checkout with no reports at all
  starts empty, and the memo scan still keeps it from paying anything twice, except payouts made
  before the memo existed.
- **A preview never touches what was paid.** Without `--pay` the airdrop only adds new sightings to the
  ledger on disk.
- **A payout error stops the watcher.** `--watch` exits when a payout fails, rather than retry on its
  own. Start it again once the cause is fixed; the next run settles what was sent.

Files:
- `deployments/rewards/ledger.json`: sightings (with each order's fee rate), the reviews already paid
  and the signature that paid each, the carry and the reviews it came from, and any pending batch.
- `deployments/rewards/epoch-<time>.json`: one per payout. Each holds every input the rules read (all
  reviews, the sightings and failure counts used, the fee rate and the time), the network's genesis
  hash and which documented params set it used (`custom` flags any other), the carry it started from,
  every row with its reason, every transfer with its signature, what was withheld, and the carry it
  leaves.

`--verify` recomputes the whole report from the file alone and lists every mismatch:
- every row: reviewer, weight, fee rate, base, reward and label, with no review listed twice and none
  left out;
- every wallet: what it was paid plus what it carries out equals what it carried in plus its rows, and
  amounts under `dustUnits` are carried, not paid;
- every transfer: its amount and the reviews its memo names, and none above the fee bound of its
  reviews' orders plus its carry;
- the params: the documented devnet or mainnet set, or flagged `custom` (mainnet must use the mainnet
  set), and `shareBps` never above 2500;
- the totals.

The inputs themselves are chain data anyone can check: each review is a Tessera account, and each
transfer is on chain under its signature. `carryIn` must equal the previous report's `carried`. The
sightings are the airdrop's own record, which is why they are published.

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

The recorded file predates the payout memo, the withheld list and the carry fields in the report;
rerun the demo to record it in the current format.

## Where agents see it

`report_outcome` (API, MCP and CLI) returns a `reward` field with each review:
- `atOneTimes`, `upTo` and `judgedAfterSecs`;
- the rule in one sentence.

It is an estimate from the reviewer's tier at that moment; the program sets the exact weight. The
website shows each review's 1× reward on credit files, and has a calculator on the home and formula
pages.

## Limits, and the next step

- **The operator runs the airdrop.** It can refuse to pay, or withhold a payout, but every transfer has
  to match the report's own inputs or `--verify` fails, and those inputs are public chain data except
  the sightings. The next step is an on-chain claim: a program-owned reward vault
  that the fee split funds, and a `claim_review_reward` instruction that applies the same rules. That
  changes account layouts and needs a migration, so it comes after this version has run for a while.
- **The "before" state needs the airdrop to be watching.** It is not stored on chain, which is why the
  sightings are published.
- **Consensus can herd.** Agreeing pays only 1.2×, and what actually happened (the outcome rows)
  overrides it.
