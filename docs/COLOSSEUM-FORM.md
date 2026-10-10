brief (500): 398
building (1000): 992
why now (1000): 997
technologies: 355
how chains (500): 475
others: 314
else (500): 469
# Colosseum project form: ready-to-paste answers

Every answer is checked against its character limit and against the repository. Paste each block as is.

## Short fields

| Field | Answer |
|---|---|
| Project name (Public) | agentic_commerce (or Tessera, if you rename it) |
| Project website (Public) | https://agentic-commerce-two-theta.vercel.app |
| Which chains | **Solana only.** Tessera uses no other chain, so tick nothing else. |
| Category (Public) | The first of Payments, Infrastructure or AI Agents that the list offers; DeFi only if none exists |
| Mobile-focused dApp? | No (leave unticked) |
| Where is your team based | Confirm: ZJU-UIUC Institute is in Haining, Zhejiang, so China, if you live there |
| Team Telegram contact | Yours; I do not have it |

## Long answers

### Brief description (Public, max 500)

Tessera is the credit layer for agent commerce. Every x402 payment between AI agents lands in its own escrow on Solana, with no change to the x402 standard. An on-chain credit score, computed only from orders that really settled, sets how long the money waits: a stranger waits days, an agent with a record settles instantly. Both sides rate each other on-chain, and anyone can recompute the score.

*398 characters*

### What are you building, and who is it for? (max 1000)

We are building the missing safety layer for agents that pay each other. Today an x402 payment is final the moment it settles, so agents only dare to move cents. Tessera makes larger payments safe.

How it works: the seller's 402 response names a per-order escrow account as the payee. The buyer checks that order on-chain, then pays through an x402 facilitator and never needs SOL. A credit score computed by the program decides the hold: a stranger waits, two wallets with a record settle in the same transaction as delivery. Faking the score costs real fees and weeks of time, and an exit scam on instant settlement nets only a small fixed base.

Who it is for: sellers of paid APIs, data and compute who want to charge dollars, not cents, to unknown agents, and buyer agents that want recourse. A seller adds one function; a buyer adds one check. It runs today on Solana devnet with merchant and buyer agents, a typed SDK, an MCP server, a CLI and a website that reads the chain directly.

*992 characters*

### Why did you decide to build this, and why build it now? (max 1000)

The gap shows in the numbers: x402 has carried about 200 million payments, yet on one recent day the average was 7 cents (x402scan, 5 Oct 2026). Cards solve trust with months of history and chargebacks. On-chain there are no chargebacks and new wallets are free, so naive reputation is free to fake.

Security research is my interest, so I started from the threat model: who steals what, at what cost? Every protection exists because an attack would otherwise pay. The score counts only settled volume, caps each counterparty, and gates tiers on time that cannot be bought. In simulation, rings of 3 and 6 wallets never reach Trusted; larger ones pay hundreds to thousands of dollars and one to three months first.

Why now: agents are starting to pay each other, and the two layers Tessera sits between already exist on Solana: x402 for payment, the Agent Registry for identity. No new standard is needed. McKinsey sees $3 to 5 trillion of agent commerce by 2030; that needs trusted payments.

*993 characters*

### What technologies are you using or integrating?

Anchor 1.1.2 (Rust program), @solana/kit 8, Codama-generated TypeScript client, SPL Token (USDC), x402 v2 exact scheme (x402.org and PayAI facilitators), A2A with the a2a-x402 extension, Solana Agent Registry (8004-solana SDK), MCP server, Node/Express, React 19, Vite, Tailwind, Vercel. Built with Claude Code, with Playwright for headless browser tests.

*355 characters*

### How does your product use these chains? (max 500)

Solana only. An Anchor program holds each order as a PDA with a vault that is the order's associated token account, so an unmodified x402 exact payment can fund it. USDC moves with SPL Token transfers. The score, tiers, per-pair history and reviews are program accounts anyone can read and recompute. Merchants are registered in the Solana Agent Registry, and each review is mirrored there with proof of payment. Program TessSeP5QV5Bxpvm73iEefdsTjgtTEokKSx7jqFn1CQ on devnet.

*475 characters*

### Did anyone not listed on the team do meaningful work? (max 600)

Not listed: Claude Code (Anthropic) was the build engine. I set the requirements, the threat model and the direction, and I review and verify the results; the code, tests and deployment were produced in Claude Code sessions and are all in the public repository. No other person did meaningful work on this project.

*314 characters*

### Anything else judges should know? (max 500)

Honest status: devnet only, no outside users or revenue yet, and no third-party audit. Evidence: 251 orders and 435 on-chain reviews from our own agents, with three scripted attacks (wash ring, exit scam, dispute) played out and failing. Hundreds of automated checks run the real program on a local validator and compare every account with a reference model. A prior prototype is disclosed in docs/SUBMISSION.md. Everything is open and reproducible from the repository.

*469 characters*

