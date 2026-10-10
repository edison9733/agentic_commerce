# Submission pack: Colosseum Crypto World's Fair

Everything the submission portal asks for, in the order it asks. Copy from here.

- **Deadline: 12 October 2026.** The hackathon runs 14 September to 12 October 2026.
- **Track: Solana Ecosystem.** $100,000 track pool: 10 projects receive $10,000 each. Track prizes are
  on top of the main awards ($30,000 grand prize, $15,000 each for the next 20, a $5,000 Public Good
  Prize and a $5,000 University Prize).

Sources: colosseum.com/worldsfair and the FAQ at colosseum.com/hackathon, both read on 5 October 2026.
The portal itself is behind a login, so its exact field names were not seen. Check each field against it.

---

## What Colosseum asks for, and where it is

The FAQ lists nine things. All nine are covered below.

| Colosseum asks for | Status | Where |
|---|---|---|
| Product name and a brief description | Ready | [Form fields](#form-fields) |
| Which blockchains and tools are integrated | Ready | [Form fields](#blockchains-and-tools-integrated) |
| All teammates, with backgrounds | ✍️ Confirm | [Team](#team) |
| Where the team is located | ✍️ You fill in | [Team](#team) |
| A product logo or graphic | Ready | `pitch/assets/` |
| A GitHub repository link | Ready, public | https://github.com/edison9733/agentic_commerce |
| A pitch video (up to 2 minutes) | ✍️ record yourself: [VIDEO-GUIDE.md](VIDEO-GUIDE.md) | script in the guide |
| A product-demo video of no more than three minutes | ✍️ record the live site yourself: [VIDEO-GUIDE.md](VIDEO-GUIDE.md) | script in the guide |
| Go-to-market, demand validation, distribution plans | Ready, ✍️ add real conversations | [Go-to-market](#go-to-market) |

Also recommended by Colosseum, not strictly required: a **one-minute weekly update video**. A draft is
ready (0:56): `pitch/out/tessera-update.mp4`.

---

## Before you submit: what only you can do

1. **Create a Colosseum account and join the hackathon.** The FAQ says the portal opens from the
   platform dashboard after you join: colosseum.com/signup. I cannot create accounts.
2. **Record the two videos in your own voice.** The rendered ones use a computer voice. The FAQ calls
   the presentation video "one of the first resources judges review", and one judging criterion is
   founder communication. Fastest way: open the deck, press `n` for notes, record your screen while
   you read. See [Recording](#recording-the-videos).
3. **Upload both videos** (YouTube unlisted or Loom) and paste the links.
4. **Post the weekly update.** One minute. Same method. The script is in `pitch/out/update-script.md`.
5. **Fill in the team fields** marked ✍️. They come from your saved profile, not from anything verified.
6. **Disclose prior work.** The form asks for it. Text is [below](#prior-work-disclosure).
7. **Talk to three x402 sellers or agent builders before the deadline.** There is no traction yet, and
   "Traction" is a judging criterion. A message and five questions are in
   [Demand validation](#demand-validation).
8. **Go to the Solana Foundation office hours** if you can: 5 October 2026, 10 AM Pacific, on the
   Colosseum Discord (listed on colosseum.com/worldsfair). Ask them one thing: does the Agent Registry
   team want payment-backed feedback mirrored the way [ERC-8004.md](ERC-8004.md) does it?
9. **Check the University Prize.** You are a student. Its eligibility rules are not on the public
   pages, so ask in the Colosseum Discord.
10. **Decide the name.** "Tessera" is a working name. Trademarks and other hackathon entries were not
    checked. Renaming is a find-and-replace; the program id and accounts do not depend on it.
11. **Optional: a Coinbase CDP API key.** Coinbase's facilitator is the most used one. The agents
    server uses it first if `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` are set. Only you can create
    the key (portal.cdp.coinbase.com). This path loads and fails safe, but has not been run with a
    real key.

---

## Form fields

### Product name

Tessera

### One-line description

The credit layer for agent commerce: x402 payments land in escrow on Solana, and an on-chain credit
score decides how long the money waits.

### Brief description

AI agents now pay each other over x402, and an x402 payment is final the moment it settles. Tessera
puts each payment into a per-order escrow on Solana without changing the x402 standard: the 402 response
names the escrow account as `payTo`. An on-chain credit score, built only from orders that actually
settled, then sets how long the money is held. A wallet nobody knows waits; two wallets with a record
settle in the same transaction as delivery. Both sides rate each other on-chain, and the score is
integer arithmetic anyone can recompute. Merchant agents speak A2A with the x402 payment extension and
are registered in the Solana Agent Registry; buyer agents check the escrow on-chain before paying and
need no SOL.

### Longer description (if the form has room)

The problem is the gap between how fast agents can pay and how long it takes to learn whether the other
side was honest. Card networks close that gap after the fact, with chargebacks and purchase history
measured in months. On-chain there are no chargebacks, and a new wallet is free, so naive reputation is
free to fake. We think that is why x402 payments are still small: on one recent day the average was
seven cents.

Tessera's answer is to make the settlement delay a function of what is known about the two parties:

- **Evidence** (history, tenure, diversity) counts only settled volume, weighted by who the counterparty
  was, capped per counterparty, and gated by time that cannot be bought in a burst.
- **Rating and behaviour** multiply it, so a long history cannot hide bad reviews or a lost dispute.
- **Instant settlement** is capped at the protocol fees a merchant has already paid, plus a small base,
  so an exit scam nets at most that base.

What exists: an Anchor program on devnet (17 instructions), a typed SDK with a line-for-line mirror of
the score, merchant and buyer agents (A2A + x402, two public facilitators), a demo network of 16 agents,
six of them acting out three scripted attacks, a bridge to the Solana Agent Registry (ERC-8004), and a
website that reads the chain directly. 395 on-chain checks and 44 formula and reward tests pass.

### Blockchains and tools integrated

- **Solana** (devnet): Anchor 1.1.2 program, `@solana/kit` 8, Codama-generated client, SPL Token (USDC devnet)
- **x402** v2, `exact` scheme on Solana, through the public x402.org facilitator with the PayAI
  facilitator as a second option; Coinbase's CDP facilitator when an API key is set
- **A2A** (Agent2Agent) JSON-RPC with the a2a-x402 extension v0.2
- **Solana Agent Registry** (ERC-8004 on Solana) through the `8004-solana` SDK: four merchant agents
  registered on devnet, reviews mirrored as feedback with proof of payment
- React 19, Motion, Tailwind, Vite

### Links

| | |
|---|---|
| GitHub | https://github.com/edison9733/agentic_commerce |
| Program (devnet) | https://explorer.solana.com/address/TessSeP5QV5Bxpvm73iEefdsTjgtTEokKSx7jqFn1CQ?cluster=devnet |
| Agent Registry asset of one merchant (devnet) | https://explorer.solana.com/address/6eLc6GgNDUpXCfSqMNd2qEm7oAzfPRSbzvyPDSPSrzJh?cluster=devnet |
| Presentation video | ✍️ paste after upload |
| Technical demo video | ✍️ paste after upload |
| Live site | ✍️ optional. See [Hosting the site](#hosting-the-site) |

### Team

✍️ Confirm or correct every line. This is from your saved profile, not from anything verified.

- **Edison Liu**, solo founder. B.Eng. Electronic and Computer Engineering at the ZJU-UIUC Institute
  (Zhejiang University / University of Illinois Urbana-Champaign), 2025 to present.
- Background: builds working systems end to end, from embedded hardware (Arduino, MOSFET drive chains,
  digital logic from NAND gates) to software. Completed Harvard's CS50x and the Stanford/Coursera
  Machine Learning Specialization. Personal interest in Web3 and security research.
- Built Tessera with Claude Code as the build engine: Edison set the requirements and direction; the
  code, tests and deployment were produced in Claude Code sessions and are in the repository.
- GitHub: https://github.com/edison9733 · Site: https://edison9733.xyz

**Location:** ✍️ Not known. Fill this in.

### Logo / graphic

`pitch/assets/tessera-logo.png` (1024×1024), `pitch/assets/tessera-logo.svg`, and
`pitch/assets/tessera-cover.png` (the site's hero).

### Go-to-market

Who pays: sellers of paid APIs and agent services that already take x402, through a 1% fee on what is
released to them. Buyers pay nothing extra and need no SOL.

1. **Wedge: x402 sellers who want to charge more than cents.** Seven-cent calls do not need escrow. A
   $20 dataset or a $200 compute job does, and those are the payments x402 sellers cannot safely take
   from unknown agents today. One function (`quote()`) puts an escrow behind an existing endpoint.
2. **Distribution through the rails that already exist**: x402 facilitators, A2A agent frameworks and
   the Solana Agent Registry. A facilitator or framework that offers "escrowed" as a payment option
   brings every seller on it. Registry feedback that carries proof of payment is a reason for the
   registry's own users to care.
3. **The score as its own product.** Any wallet can be scored by anyone from public accounts. A demo
   agent in this repo already sells credit reports over x402.

### Market size

Figures from others, with the source for each:

- McKinsey estimates that by 2030 agentic commerce could orchestrate up to $1 trillion of US retail
  revenue, and $3 trillion to $5 trillion globally (McKinsey, "The agentic commerce opportunity").
- x402 has carried "roughly 200 million transactions" across "about 150,000 merchant endpoints", and
  "most transactions are under 50 cents" (Solana Foundation, "Webinar recap: Giving AI agents a native
  way to pay with x402", 5 August 2026).
- On one day, x402scan showed 118,341 payments worth $8.01K: about 7 cents each (x402scan.com,
  24 hours to 5 October 2026).

What follows is an illustration, not a forecast. If 1% of McKinsey's low global estimate were paid
through escrow, that is $30 billion a year, and a 1% fee on it is $300 million a year. Nothing in this
repository shows that share is reachable. Today's x402 volume is tiny by comparison ($8K a day), and
that gap is the bet: payments stay small until there is recourse.

### Competition

Stated plainly: escrow for agent payments is not a new idea, and several teams are building it. None
of the projects below were tested for this document. Each line is the project's own description, or a
description from the cited list, and nothing more is claimed about them.

| Project | What it says it does | Source |
|---|---|---|
| x402 alone | Payment that is final on settlement. No refund, no dispute. | x402 `exact` scheme |
| ERC-8004 / Solana Agent Registry | Identity, feedback and validation registries. "Payments are orthogonal to this protocol and not covered here." | ERC-8004 text; solana.com/agent-registry |
| PayCrow | "Trust scoring from 4 on-chain sources + USDC escrow with dispute resolution on Base." | awesome-x402 list (github.com/RipperMercs/awesome-x402-xpaysh) |
| Arbitova | "Escrow + transparent AI arbitration ... for agent-to-agent payments." | same list |
| AgentBond | Performance bonds: "Agents lock their own USDC before accepting work." | ERC-8004 thread, post 136 |
| Q402, AgentPay, others | Escrow with lock, release, refund and dispute around x402-style flows. | their own pages, found by search on 5 Oct 2026 |

What Tessera does that this document can show working:

1. **An unmodified x402 `exact` payment lands in escrow on Solana.** The 402 response names the escrow
   account as `payTo`. No new scheme, no custom client. Verified through two public facilitators.
2. **The hold is a function of an on-chain score.** A stranger waits; two Trusted wallets settle in the
   same transaction as delivery. The score is computed by the program, not by an off-chain service.
3. **The score counts only settled escrow orders**, weighted and capped so that faking it has a price,
   and instant settlement is bounded by fees already paid. The costs are computed and tested.
4. **It plugs into the Solana Agent Registry** instead of competing with it. See [ERC-8004.md](ERC-8004.md).

### Demand validation

✍️ Be straight here; judges check. What is true today:

- No users outside this project. No revenue. The devnet traffic is generated by the project's own agents.
- Evidence the problem is real, from others: the ERC-8004 authors write that "Sybil attacks are
  possible, inflating the reputation of fake agents", and a builder on their forum writes "There's no
  financial cost to having a bad reputation" (post 136, 21 April 2026). A July 2026 study of 15 x402
  facilitators found security rule violations in all of them (arXiv 2607.19545). Visa's own fraud rule
  relies on purchase history 120 to 365 days old (Checkout.com, October 2025).

**Do this before the deadline.** Three real conversations are worth more than everything above.

Who to ask: sellers listed on x402scan.com and in the x402 Bazaar, builders in the Colosseum Discord
and the Solana Foundation's agentic-payments channels, and anyone who posted in the ERC-8004 thread
about payments.

A message you can send:

> Hi, I'm Edison, a student building for the Colosseum hackathon. You sell over x402. I built an escrow
> that an ordinary x402 payment can land in, where the hold shrinks as the two sides build a record.
> Could I ask you five short questions? No pitch.

Five questions:

1. What is the largest single x402 payment you have received? What stops it being larger?
2. Have you been paid for something and then had the buyer complain, or delivered and wished you had
   been paid first?
3. Would you accept a hold of a few days on a first order from an unknown wallet, if repeat buyers
   settled at once?
4. What would you pay for that: 1% of what settles?
5. Do you use any agent registry or reputation score today? Do you trust it?

Write down what they say, with their permission, and paste it here.

### Why Solana

Sub-second, sub-cent transactions make it reasonable to open an on-chain escrow for a 15-cent purchase,
and the account model makes each order, each pair and each wallet a separate account that can be read
directly. x402's `exact` scheme on Solana derives the destination token account from `payTo`, which is
the one property that lets an escrow account be paid by an unmodified x402 client. And Solana already
has the two layers Tessera sits between: x402 for payment and the Agent Registry for identity.

### Prior work disclosure

On 22–23 September 2026, during this hackathon's window, I built an unpublished prototype called
`x402-fraud`: an escrow marketplace that established that an escrow account can be an x402 `payTo`. It
was never committed or published. Tessera is a new program, a new codebase and a new design (the credit
score, tiers, pair history, the instant limit, A2A agents, the Agent Registry bridge and the website
were all written on 5 October 2026). Open-source dependencies are listed in `package.json` and
`Cargo.toml`.

✍️ If any of that is not how you would describe it, change it. The FAQ warns that misrepresenting
development history can disqualify a team.

---

## How the submission maps to the judging criteria

Criteria are quoted from colosseum.com/hackathon.

| Criterion | What to point at |
|---|---|
| Founder + market fit | ✍️ Yours to make. Your security-research interest is the honest link: the product is a threat model with a program attached. |
| Insight | x402 payments stay small because they are final with no recourse. The settlement delay should be a function of what is known about both parties, and x402 already allows an escrow account as `payTo`, so no new standard is needed. |
| Product + execution | Deployed program, 395 on-chain checks, live demo network, working checkout, Agent Registry bridge. For "how does it stack up against the competition", see [Competition](#competition). |
| Potential market size | [Market size](#market-size): McKinsey's $3 trillion to $5 trillion by 2030, against $8K a day through x402 now. |
| Founder communication | The two videos. Record them yourself. |
| Viability | 1% of released volume; cost base is rent that is returned. |
| Traction | None yet. Say so, and add the conversations from [Demand validation](#demand-validation). |

---

## Recording the videos

The portal wants two separate videos (YouTube, Loom or Vimeo): a **demo** of the live product, up to three
minutes, that is not a slide deck or a code walkthrough, and a **pitch**, up to two minutes, in which you
introduce yourself, say what you are building and why you are the one to build it.

The rendered drafts in `pitch/out/` (`tessera-demo.mp4`, `tessera-pitch.mp4`, computer voice, built from the
decks) do not meet either rule. Record both yourself. Scripts, a shot list and a checklist are in
[VIDEO-GUIDE.md](VIDEO-GUIDE.md). The weekly update video, if you make one, can still come from
`node pitch/render.mjs update`.

## Hosting the site

The site is static and reads the chain directly, so any static host works:

```bash
npm run build:web     # output in apps/web/dist
```

A ready GitHub Pages workflow is in [`docs/deploy/github-pages.yml`](deploy/github-pages.yml). It is
not active: the session that wrote it could not add workflows to the repository. The three steps to
switch it on are at the top of that file.

Everything except the Market page works with no backend. The Market page needs `npm run agents`
reachable at the URL in `VITE_AGENTS_URL`, and the role keys in `.keys/`, which are not in the repo.
Without a hosted agents server the Market page says so and points at the demo video.

## Numbers used in the pitch, and where each came from

| Claim | Source |
|---|---|
| About 200 million x402 transactions; about 150,000 merchant endpoints; most under 50 cents | Solana Foundation, "Webinar recap: Giving AI agents a native way to pay with x402", solana.com/news, 5 Aug 2026 |
| 118,341 x402 payments and $8.01K volume in 24 hours (7 cents average) | x402scan.com/facilitators, read 5 Oct 2026 |
| Visa CE 3.0 needs two prior undisputed transactions, 120–365 days old | checkout.com/blog/visa-compelling-evidence-3-0 (30 Oct 2025) |
| One on-chain review costs about $0.001; registering an agent about 0.009 SOL | solana.com/agent-registry, read 5 Oct 2026 |
| 2.9% + 30¢ per successful domestic card transaction | stripe.com/pricing, read 5 Oct 2026 |
| Standard chargeback time limit of 120 days | Stripe, "Chargeback time limits in the UK" (stripe.com/resources) |
| $3 trillion to $5 trillion of agentic commerce globally by 2030 | McKinsey, "The agentic commerce opportunity" (mckinsey.com) |
| "Payments are orthogonal to this protocol"; "Sybil attacks are possible" | ERC-8004 text, github.com/ethereum/ERCs, read 5 Oct 2026 |
| No symmetric reputation function is sybil-proof | Cheng and Friedman, "Sybilproof reputation mechanisms", P2PECON 2005 |
| Violations found in all 15 x402 facilitators tested | arXiv 2607.19545 (21 Jul 2026) |
| Every Tessera number (settlement time, counts, scores, attack costs) | this repo: `deployments/`, `npm run test:formula`, `npm run test:local`, and the chain |

One number was left out on purpose. The Solana Foundation article also says x402 has carried "$50 billion
in volume". That does not fit with "most transactions are under 50 cents" or with x402scan's $8K a
day, so it is not used.
