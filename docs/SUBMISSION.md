# Submission pack: Colosseum Crypto World's Fair

Everything the submission form asks for, in the order it asks. Copy from here.

**Deadline: 12 October 2026** (source: colosseum.com/worldsfair, read 5 October 2026). Track: Solana Ecosystem.

The list of required fields below is from the hackathon FAQ at colosseum.com/hackathon, read on the same
day. The form itself may differ in wording: check each field against it.

---

## Before you submit: seven things only you can do

1. **Record the two videos in your own voice.** The rendered videos in `pitch/out/` use a computer
   voice. Colosseum's own guidance says the pitch video "should include a concise explanation of the
   team's background" and that judges assess founder communication, so your voice (and ideally your
   face for the first and last ten seconds) matters. Fastest way: open the deck, press `n` for notes,
   and record your screen while you read. See [Recording](#recording-the-videos).
2. **Upload both videos** (YouTube unlisted or Loom) and paste the links below.
3. **Fill in the team fields** marked ✍️ below. I only know what is in your profile.
4. **Make sure the GitHub repo is public**, or grant access to `hackathon@colosseum.com`.
5. **Disclose prior work.** The form asks for it. Text is provided [below](#prior-work-disclosure).
6. **Check the University Prize.** The hackathon lists a $5,000 University Prize. You are a student; I
   could not find its eligibility rules, so check the form or ask in the Colosseum Discord.
7. **Decide the name.** "Tessera" is my working name. I did not check trademarks or whether another
   project in this hackathon uses it. Renaming is a find-and-replace in the site, deck and docs; the
   program id and account layout do not depend on it.

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
integer arithmetic anyone can recompute. Merchant agents speak A2A with the x402 payment extension;
buyer agents check the escrow on-chain before paying and need no SOL.

### Longer description (if the form has room)

The problem is the gap between how fast agents can pay and how long it takes to learn whether the other
side was honest. Card networks close that gap after the fact, with chargebacks and purchase history
measured in months. On-chain there are no chargebacks, and a new wallet is free, so naive reputation is
free to fake.

Tessera's answer is to make the settlement delay a function of what is known about the two parties:

- **Evidence** (history, tenure, diversity) counts only settled volume, weighted by who the counterparty
  was, capped per counterparty, and gated by time that cannot be bought in a burst.
- **Rating and behaviour** multiply it, so a long history cannot hide bad reviews or a lost dispute.
- **Instant settlement** is capped at the protocol fees a merchant has already paid, plus a small base,
  so an exit scam nets at most that base.

What exists: an Anchor program on devnet (17 instructions), a typed SDK with a line-for-line mirror of
the score, merchant and buyer agents (A2A + x402, two facilitators), a demo network of 16 agents,
six of them acting out three scripted attacks, and a website that reads the chain directly. 256 on-chain checks
and 16 formula tests pass.

### Blockchains and tools integrated

- **Solana** (devnet): Anchor 1.1.2 program, `@solana/kit` 8, Codama-generated client, SPL Token (USDC devnet)
- **x402** v2, `exact` scheme on Solana, through the public x402.org facilitator with the PayAI facilitator as a second option
- **A2A** (Agent2Agent) JSON-RPC with the a2a-x402 extension v0.2
- React 19, Motion, Tailwind, Vite

### Links

| | |
|---|---|
| GitHub | https://github.com/edison9733/agentic_commerce |
| Program (devnet) | https://explorer.solana.com/address/TessSeP5QV5Bxpvm73iEefdsTjgtTEokKSx7jqFn1CQ?cluster=devnet |
| Presentation video | ✍️ paste after upload |
| Technical demo video | ✍️ paste after upload |
| Live site | ✍️ optional. See [Hosting the site](#hosting-the-site) |

### Team

✍️ Confirm or correct every line. This is from your saved profile, not from anything I verified.

- **Edison Liu**, solo founder. B.Eng. Electronic and Computer Engineering at the ZJU-UIUC Institute
  (Zhejiang University / University of Illinois Urbana-Champaign), 2025 to present.
- Background: builds working systems end to end, from embedded hardware (Arduino, MOSFET drive chains,
  digital logic from NAND gates) to software. Completed Harvard's CS50x and the Stanford/Coursera
  Machine Learning Specialization. Personal interest in Web3 and security research.
- Built Tessera with Claude Code as the build engine: Edison set the requirements and direction; the
  code, tests and deployment were produced in a Claude Code session and are in the repository.
- GitHub: https://github.com/edison9733 · Site: https://edison9733.xyz

**Location:** ✍️ I do not know where you are based. Fill this in.

### Logo / graphic

`pitch/assets/tessera-logo.png` (1024×1024), `pitch/assets/tessera-logo.svg`, and
`pitch/assets/tessera-cover.png` (the site's hero).

### Go-to-market

Who pays: sellers of paid APIs and agent services that already take x402, through a 1% fee on what is
released to them. Buyers pay nothing extra and need no SOL.

1. **Wedge: x402 sellers who are being cheated or are afraid to raise prices.** Seven-cent calls do not
   need escrow. A $20 dataset or a $200 compute job does, and those are the payments x402 sellers
   cannot safely take from unknown agents today. One function (`quote()`) puts an escrow behind an
   existing endpoint.
2. **Distribution through the rails that already exist**: the x402 and A2A ecosystems. A facilitator or
   an agent framework that offers "escrowed" as a payment option brings every seller on it.
3. **The score as its own product.** Any wallet can be scored by anyone from public accounts. A demo
   agent in this repo already sells credit reports over x402.

### Demand validation

✍️ Be straight here; judges check. What is true today:

- No users outside this project. No revenue. The devnet traffic is generated by the project's own agents.
- Evidence the problem is real, from others: x402 carried 118,341 payments in the 24 hours to
  5 October 2026, averaging about 7 cents (x402scan.com). A July 2026 study of 15 x402 facilitators
  found security rule violations in all of them (arXiv 2607.19545). Visa's own fraud rule relies on
  purchase history 120 to 365 days old (Checkout.com, October 2025).
- If you talk to even three x402 sellers or agent builders before the deadline and write down what they
  said, put that here instead. It is worth more than any of the above.

### Why Solana

Sub-second, sub-cent transactions make it reasonable to open an on-chain escrow for a 15-cent purchase,
and the account model makes each order, each pair and each wallet a separate account that can be read
directly. x402's `exact` scheme on Solana derives the destination token account from `payTo`, which is
the one property that lets an escrow account be paid by an unmodified x402 client.

### Prior work disclosure

On 22–23 September 2026, during this hackathon's window, I built an unpublished prototype called
`x402-fraud`: an escrow marketplace that established that an escrow account can be an x402 `payTo`. It
was never committed or published. Tessera is a new program, a new codebase and a new design (the credit
score, tiers, pair history, the instant limit, A2A agents and the website were all written on
5 October 2026). Open-source dependencies are listed in `package.json` and `Cargo.toml`.

✍️ If any of that is not how you would describe it, change it. The form warns that misrepresenting
development history can disqualify a team.

---

## How the submission maps to the judging criteria

Criteria are quoted from colosseum.com/hackathon.

| Criterion | What to point at |
|---|---|
| Founder + market fit | ✍️ Yours to make. Your security-research interest is the honest link: the product is a threat model with a program attached. |
| Insight | The settlement delay should be a function of what is known about both parties; and x402 already allows an escrow account as `payTo`, so no new standard is needed. |
| Product + execution | Deployed program, 256 on-chain checks, live demo network, working checkout on the site. |
| Potential market size | ✍️ I did not find a market-size figure I could verify, so there is none in the deck. If you cite one, cite its source. |
| Founder communication | The two videos. Record them yourself. |
| Viability | 1% of released volume; cost base is rent that is returned. |
| Traction | None yet. Say so. |

---

## Recording the videos

Rendered drafts (computer voice):

```bash
npm run web          # terminal 1
npm run agents       # terminal 2 (the demo deck performs a real purchase)
node pitch/render.mjs pitch     # -> pitch/out/tessera-pitch.mp4
node pitch/render.mjs demo      # -> pitch/out/tessera-demo.mp4
```

In your own voice, the simple way:

1. Open `http://localhost:5173/#/deck/pitch`. Press `n` to show the narration under each slide.
2. Start a screen recording with your microphone (QuickTime: File → New Screen Recording).
3. Read each slide's note, press → to advance. Keep it under three minutes; the script is about 2:47
   at the rendered pace, and the demo about 2:58.
4. Same for `#/deck/demo`. That deck's slides drive the real site, including a real devnet purchase,
   so start `npm run agents` first and let each live slide finish.

The written scripts are generated into `pitch/out/pitch-script.md` and `pitch/out/demo-script.md`.
Change the words in `apps/web/src/deck/pitch.tsx` and `demo.tsx` (the `say` field), not in those files.

Colosseum's guidance (blog.colosseum.com, "Perfecting your hackathon submission") is that the pitch
video should be no more than three minutes, and warns against "overly flashy visuals with little
substance". The deck is deliberately one idea and one sourced number per slide.

## Hosting the site

The site is static and reads the chain directly, so any static host works:

```bash
npm run build:web     # output in apps/web/dist
```

Everything except the Market page works with no backend. The Market page needs `npm run agents`
reachable at the URL in `VITE_AGENTS_URL`, and the role keys in `.keys/`, which are not in the repo.
Without a hosted agents server, say in the submission that the market is shown in the demo video.

## Numbers used in the pitch, and where each came from

| Claim | Source |
|---|---|
| 118,341 x402 payments and $8.01K volume in 24 hours; 85,832 through Coinbase's facilitator | x402scan.com/facilitators, read 5 Oct 2026 |
| Visa CE 3.0 needs two prior undisputed transactions, 120–365 days old | checkout.com/blog/visa-compelling-evidence-3-0 (30 Oct 2025) |
| 2.9% + 30¢ per successful domestic card transaction | stripe.com/pricing, read 5 Oct 2026 |
| 5,000 lamports per signature | Solana base fee |
| Violations found in all 15 x402 facilitators tested | arXiv 2607.19545 (21 Jul 2026) |
| Every Tessera number (settlement time, counts, scores, attack costs) | this repo: `deployments/`, `npm run test:formula`, `npm run test:local`, and the chain |
