# Recording the two videos for the Colosseum form

The form asks for two separate videos. Both are links to YouTube, Loom or Vimeo.

| Field | Rule on the form | Target |
|---|---|---|
| Demo video | Up to 3 minutes. Shows the live product, **not a slide deck, not a code walkthrough**. | 2:30 |
| Pitch video | Up to 2 minutes. Separate from the demo. Introduce yourself, say what you are building, and why you are the one to build it. Nothing fancy: they want to see how you think and communicate. | 1:45 |

The rendered `.mp4` files in `pitch/out/` (computer voice, built from the slide decks) do **not** meet the demo
rule, and the pitch one is 3 minutes long. Record both again yourself with the scripts below.

## Before you record (10 minutes)

1. Open https://agentic-commerce-two-theta.vercel.app and hard-refresh (Ctrl or Cmd + Shift + R). The "Connect
   wallet" button should be gone from the menu.
2. On **Market**, press the test-funds button and do one full purchase **off camera**. That funds the built-in
   test wallet and warms the connection. Public devnet endpoints throttle, so a first purchase can be slow.
3. Browser zoom 125%, bookmarks bar hidden, other tabs closed, notifications off, quiet room.
4. Read each script aloud twice with a timer. Speak at a normal pace; about 140 words a minute.

## Demo video: screen recording, your voice, no slides

Record only the browser. No code editor, no slide deck. Scripted words: 273. A full purchase takes about 25
seconds on screen, so the video lands near 2:30.

| About | On screen | Say |
|---|---|---|
| 0:00 | Home page, the **Live network** | Paragraph 1 |
| 0:20 | **Agents**, open a merchant with a high score | Paragraph 2 |
| 0:40 | **Market**: test-funds button, pick a merchant, buy, confirm, review | Paragraph 3 (talk while the steps tick) |
| 1:50 | **The score**: click "Sells to itself", then a busy wallet | Paragraph 4 |
| 2:15 | **For agents** | Paragraph 5 |
| 2:30 | Back to the **Live network** | Paragraph 6 |

### Script

This is Tessera, running live on Solana devnet. This page reads the chain directly in my browser: no database, no server in between. Squares are merchant agents, circles are buyers, and a coin on a line is money held in escrow.

Every wallet has a public credit file. Here is a merchant with a high score. I can see what the score is made of, and every review, with the weight it carried. Each review counts only because a real order settled.

Now the Market. I press the test-funds button, which sends this browser's test wallet some devnet USDC. I pick a merchant and press buy. The page checks the order on-chain before it pays. It pays into the escrow, not to the merchant. The merchant delivers, and the page checks what arrived against the hash the merchant committed. This is a fresh wallet, so the money is held for a while. When I am satisfied, I confirm, the merchant is paid, and I leave a review.

Here is the score itself. It is integer arithmetic over public accounts, and this page runs the same code as the program. I pick a wallet that only sells to itself, and the score stays low. I pick a busy wallet with real customers, and it climbs, and the hold shrinks.

For agents, there is no website at all. An agent asks one question, find merchants, and gets a ranked answer built from reviews that each cost a real sale.

This is devnet with test money. There is one arbiter key, and it has not been audited. The code and the tests are in the public repository.

If a step stalls on the take, stop and record that part again. Do not edit in anything that is not the live site.

## Pitch video: you on camera, 2 minutes at most

Look at the camera, not the script. Scripted words: 229, about 1:40 at a normal pace. Say it in your own words if
that is easier: keep the facts, drop the exact sentences.

### Script

Hi, I'm Edison Liu. I study electronic and computer engineering at the ZJU-UIUC Institute, and I build working systems from start to finish, from Arduino hardware to software.

AI agents are starting to pay each other with x402. Once an x402 payment settles, there is no chargeback, so agents mostly move small amounts.

Tessera puts each payment in an escrow on Solana. An on-chain credit score decides how long the money waits. A fresh wallet waits. Two Trusted-tier wallets can settle instantly. The score comes only from orders that really settled, so faking it costs real fees and time.

Security research is my interest, so I started from the threat model: who steals what, and at what cost. I audited my own work twice. The second time I found a critical bug: a merchant could cancel and reopen an order to take a buyer's payment. I fixed it and wrote a test that proves it.

I build with Claude Code. I set the requirements and the threat model, and I check the results. The code and the tests are in the public repository.

It runs on devnet with test money. There are no outside users yet, and it is not audited. Next, I want to talk to x402 sellers who would charge more than cents. I intend to keep building it. Thank you.

Every claim above is true today: devnet, test money, no outside users, no outside audit, built with Claude Code
under your direction. Do not add traction, revenue or "audited". If a judge asks, the honest answers are in the
roast prep sheet.

## How to record

**Loom (easiest).** Install the Loom app or extension. Demo: choose **Screen only** (or Screen and Camera with the
bubble small), full screen of the browser, microphone on. Pitch: choose **Camera only**. Record, trim the ends,
press **Share**, set access to **Anyone with the link**, copy the link.

**YouTube instead.** Record with QuickTime (Mac: File, New Screen Recording) or the Windows Game Bar (Win + G),
upload to YouTube, set visibility to **Unlisted**, copy the link.

## After recording

1. Check the length: the demo is under 3:00 and the pitch under 2:00.
2. Open both links in a private browser window and confirm they play without logging in.
3. Paste the demo link into **Please submit a demo video** and the pitch link into **Pitch video**.

## Ready-made versions of both videos

Two videos made from the real product are in `pitch/out/`, each with English subtitles burned in and a
separate `.srt` file. Neither has a voice, and neither pretends to be you.

| File | What it is |
|---|---|
| `tessera-demo-video.mp4` | The demo, driven like a person would drive it: a large cursor, real clicks, a real purchase, and real terminal output from the CLI. Recorded on a local Solana validator running the real Tessera program, and labelled so on screen. |
| `tessera-pitch-rehearsal.mp4` | The pitch script as large subtitles over the real site, with a frame where your camera goes. Practise with it, then record yourself. |

To record the same demo against the **live site and devnet** from your own computer:

```bash
npx playwright install chromium     # once
TESSERA_API_URL=https://<your api domain> npm run video:demo
```

It writes `pitch/out/tessera-demo-video-live.mp4` and `.srt`. It needs `ffmpeg` on your computer. The
recordings in this repository were made with `pitch/studio/up.sh` (the whole product on a local validator),
`pitch/studio/record-demo.mjs` and `pitch/studio/record-pitch.mjs`; `pitch/studio/down.sh` cleans up.
