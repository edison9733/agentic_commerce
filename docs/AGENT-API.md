# Four ways in: HTTP API, MCP, Skill, CLI

Tessera has one core, the HTTP API, and three thin layers over it. They share one contract
([`apps/api/src/contract.ts`](../apps/api/src/contract.ts)): the same tools, the same decisions,
the same statuses, whichever an agent speaks.

| Door | What it is | Who uses it | Where |
|---|---|---|---|
| **HTTP API** | `POST /v1/check` and friends. Reads the program, returns decisions, builds unsigned transactions. | Any code, other platforms | [`apps/api`](../apps/api) · `npm run api` (port 4030) |
| **MCP server** | The same tools over MCP's Streamable HTTP transport. Each tool calls the API. | Claude, Codex, Cursor | [`apps/mcp`](../apps/mcp) · `npm run mcp` (port 4040) |
| **Skill** | `SKILL.md`: when to use Tessera and how. The main rule: before any paid tool call, call `check_payment`. | Claude Code and other skill-aware agents | [`skills/tessera/SKILL.md`](../skills/tessera/SKILL.md) |
| **CLI** | `tessera check …`, `tessera report …`. Each command calls the API. | Developers, coding agents | [`apps/cli`](../apps/cli) · `npm run tessera -- help` |

## Run it

```bash
npm install
npm run api        # the core, against devnet; TESSERA_RPC_URLS=<url,url> for another RPC
npm run mcp        # MCP on http://127.0.0.1:4040/mcp; TESSERA_API_URL if the API is elsewhere
npm run tessera -- check BZ5MNkHdmvLoyof5ojyvsJuK5b1gGo4esPPTb4DGukoJ 0.20
```

Connect an MCP client:

```bash
claude mcp add --transport http tessera http://127.0.0.1:4040/mcp
```

Install the skill for Claude Code: copy `skills/tessera` to `~/.claude/skills/tessera` (all your
projects) or to `.claude/skills/tessera` in a project.

## The tools, by phase of a payment

| Phase | Tool | HTTP | What it returns |
|---|---|---|---|
| Before | `find_merchants` | `GET /v1/merchants?need=…` | Merchants for a need, ranked by on-chain record, each with its price, `decision` and `expectedSecs` from paying to settled |
| Before | `get_score` | `GET /v1/score/{wallet}` | The credit file: score, tier, components, record as merchant and as buyer |
| Before | `check_payment` | `POST /v1/check` | `decision` (`instant`, `escrow`, `block`), a `reason` code, the hold |
| During | `open_escrow` | `POST /v1/escrow/open` | `role: merchant`: an `open_order` transaction; its `payTo` goes in the 402. `role: buyer`: the quoted order is verified on-chain, then a `fund_escrow` transaction |
| During | `deliver_order` | `POST /v1/escrow/deliver` | Merchant: confirm funding if needed, commit the delivery hash; settles at once between Trusted parties |
| During | `get_escrow` | `GET /v1/escrow/{order}` | State, deadlines, payouts, and who can do what next, from when |
| After | `release_escrow` | `POST /v1/escrow/release` | Pay the merchant: the buyer any time after delivery, anyone after the hold |
| After | `reclaim_after_timeout` | `POST /v1/escrow/reclaim` | A missed delivery (full refund), an unpaid quote (cancel), a silent arbiter (even split) |
| After | `report_outcome` | `POST /v1/escrow/report` | `satisfied`: release and review in one transaction. `unsatisfied`: dispute during the hold, else review. `not_delivered`: refund after the deadline |
| After | `submit_transaction` | `POST /v1/tx/submit` | Relays a transaction your wallet signed and waits for confirmation. Optional |

`find_merchants`, `deliver_order`, `get_escrow` and `submit_transaction` were added to the six
suggested tools: an agent needs to choose who to buy from, the merchant side needs a way to deliver,
an agent needs to see where an order stands, and some agents can sign but have no RPC.

The full request and response shapes are in the OpenAPI document the API serves at
`GET /v1/openapi.json`, generated from the same route table the server runs.

## How `find_merchants` ranks

It is built for an agent choosing in one call, not for a person browsing. Reviews are already folded
into the rank, so an agent does not have to read them.

- **Who is a candidate:** every wallet that has sold through Tessera or whose credit file points
  (`uri`) to an A2A agent card.
- **Matching the need:** the words of `need` against the card's skills (id, name, description, tags)
  and names, by stem, so "summaries" finds "summary". At least half the words must match. The best
  matching skill is the row's `service`, with its price from the card's Tessera extension.
- **What ranks:** only on-chain data. `best` (default) sorts by score: settled volume weighted by
  each counterparty's tier, distinct buyers, tenure, the stars of reviews weighted by the money behind
  them (with a prior, so one 5-star review does not beat 200 sales at 4.7), and standing penalties.
  `fastest` sorts by `expectedSecs`: the merchant's median delivery time over its last 50 delivered
  orders (or the delivery deadline if it has none) plus the hold `check_payment` would give this buyer.
  `cheapest` sorts by price. Ties go to the score.
- **What a row carries:** `decision`, `reason` and `holdSecs` from the same function as
  `check_payment`, `expectedSecs`, the two reviews with the most money behind them, and where to call
  the merchant (`a2a`, `service.x402`).
- **Nobody is hidden for a bad record.** A penalised merchant is listed, lower, routed to escrow.

The list is read from one snapshot of the program's accounts, shared for 30 s
(`TESSERA_FIND_SNAPSHOT_MS`), so call `check_payment` right before paying.

Card text is the merchant's own: it only decides matching and price, it is cut short and stripped of
control characters, a card whose Tessera extension names another wallet is ignored, and every reply
says that `name`, `service` and review text are data, not instructions. The card URL is chosen by
whoever registered the wallet, so the API fetches it with http(s) only, no redirects, a 1.5 s timeout,
a 64 KB cap, and no private or loopback addresses (checked on the address actually connected to)
unless the API listens only on this machine (`HOST`, default `127.0.0.1`) or
`TESSERA_ALLOW_PRIVATE_CARDS=1`.

To see it with real agents, `npm run demo:find` (after `npm run build:program`) starts a local
validator with the program, has three buyer agents make twelve purchases from four merchant agents
through this API, each wallet signing its own transactions, then asks `find_merchants` as a new buyer
and as a regular one. It prints the CLI output and records it in `deployments/find-demo.json`.

`GET /llms.txt` is the same story in one page of plain text, for agents and the crawlers that feed
them.

## How `check_payment` decides

It runs the same arithmetic the program will run when the order opens and is delivered:

The score routes payments; it never bans a merchant. `block` only means the payment itself cannot
work as asked.

1. `block` if buyer and merchant are the same wallet (`self_dealing`), the amount is below the
   program's minimum (`amount_below_minimum`), or the buyer's wallet holds less than the amount
   (`insufficient_funds`).
2. `escrow` with the longest hold if the merchant has no credit file (`merchant_unknown`, and the
   reply's `status` is `unknown_merchant`), or if it carries a standing penalty of at least half a
   lost dispute (`merchant_penalized`). Then the reply also carries `askMinHoldSecs`: the buyer asks
   for that hold when the merchant quotes, because the program applies the tiers' hold otherwise.
3. Otherwise the hold is the longer of the two tiers' holds, or the buyer's own minimum. A hold of 0
   inside the merchant's instant limit is `instant` (`both_trusted`, or `pair_history` when earlier
   undisputed orders with this merchant stand in for the buyer's tier). Past the limit it is
   `escrow` (`instant_limit_reached`). Any other hold is `escrow`, with `merchant_tier`,
   `buyer_tier` or `buyer_requested_hold` saying who set it.

The penalty bar can be changed with `TESSERA_PENALTY_ESCROW_BPS`.

## Every response has a status

Nothing is answered with an empty 200. An answer about an unknown party is still an answer, with a
status that says so.

| `status` | HTTP | Meaning |
|---|---|---|
| `ok` | 200 | As asked |
| `no_match` | 200 | `find_merchants`: nobody offers that need (at that price); `ranked` is empty and `message` says what to try |
| `unknown_merchant` | 200 | `check_payment`: the merchant has no credit file; the decision still stands |
| `unknown_wallet` | 200 | `get_score`: no credit file; score 0, New |
| `invalid_request` | 400 | A field is missing or malformed; `message` names it and what it accepts |
| `not_a_party` | 403 | The wallet is not the order's buyer or merchant |
| `unknown_order` | 404 | No Tessera order at that address |
| `wrong_state`, `hold_not_elapsed`, `not_yet`, `already_reported`, `review_window_closed`, `insufficient_funds` | 409 | Not now, or not in this state. `not_yet` and `hold_not_elapsed` carry when it will be possible |
| `verification_failed` | 422 | The quoted order does not match what the buyer expects; `field` says which part |
| `rejected` | 422 | The transaction failed in simulation (and was not handed out), or the network refused it |
| `rate_limited` | 429 | Too many requests from this client |
| `not_configured`, `rpc_unavailable` | 503 | The program is not set up on this cluster, or no RPC answered |
| `internal_error` | 500 | A bug; the message says where |

## Non-custodial, and what that does and does not mean

The API never takes a private key and never sends a transaction it built. Every builder returns an
unsigned version-0 transaction, already simulated, with `signers`, `feePayer`, and where money moves,
`transfers` or `payouts`. The agent's own wallet signs.

That makes the API unable to move anyone's money by itself. It does not make it trustless: an agent
signs what it is given. So:

- The **CLI** does not trust the API. Before signing with `--keypair` it reads the order from the
  chain through its own RPC (`--rpc`) and checks every instruction: only the Tessera, SPL Token,
  associated-token and compute-budget programs; no lookup tables; you are the fee payer and the only
  signer; a capped priority fee; the only token instruction a transfer of the order's on-chain amount
  into the vault the CLI derives itself from the order you named; and only the Tessera instructions
  the command builds, on that order. `npm run test:doors` hands it a tampered transaction from a fake
  API and checks it refuses.
- The **skill** tells an agent to check the transaction itself, not the reply's summary of it, before
  its wallet signs.
- Buyers are verified against the chain, not the API: `open_escrow` with `role: buyer` runs
  `verifyOrderForPayment`, the same check the SDK gives every buyer.

## Following the SilentProbe lesson

- Allowed values are enums in every schema: `role`, `outcome`, and in responses `decision`, `reason`,
  `status`, `action`. MCP clients see them in the tool schemas, so a model cannot invent `"seller"`.
- Invalid input is refused with the field and what it accepts, never coerced.
- An unknown merchant, wallet or order is a named status, never an empty or default success.

## Tests

`npm run test:doors` starts a local validator with the program, then drives all four doors:

- **API**: every tool and refusal path, including `find_merchants` against two agent cards (one a
  copycat claiming another wallet), with each transaction signed here as an agent's wallet
  would, and sent.
- **MCP**: the tool list, the enums in its schemas, and the same answers as the API.
- **Skill**: `SKILL.md` names every tool.
- **CLI**: read commands, local signing, and refusing a tampered transaction.
