# Pitch and demo

The three decks are pages of the website, so they can show the live network and drive the real site.

| | Deck | Rendered video | Script |
|---|---|---|---|
| Pitch (the why) | `http://localhost:5173/#/deck/pitch` | `out/tessera-pitch.mp4` | `out/pitch-script.md` |
| Technical demo (the how) | `http://localhost:5173/#/deck/demo` | `out/tessera-demo.mp4` | `out/demo-script.md` |
| Weekly update (one minute) | `http://localhost:5173/#/deck/update` | `out/tessera-update.mp4` | `out/update-script.md` |

Also in `out/`: every slide as a PNG (`pitch-slides/`, `demo-slides/`) and each deck as a PDF.

Two PowerPoint decks in a looser, meme-heavy style, with speaker notes on every slide:

| File | What it covers |
|---|---|
| `out/tessera-zk-sybil.pptx` | How zk proofs and nullifiers (Semaphore) would close the open sybil holes C2 and C12 in [SECURITY.md](../docs/SECURITY.md). A design, not built. |
| `out/tessera-buyer-seller-guide.pptx` | Step by step from `git clone` to a live purchase on devnet, as the seller and as the buyer (browser and x402 agent), letting an agent pick the seller with `find_merchants`, and where to watch each transaction. |

`out/how-it-works.png` is a one-slide "how to use it" mindmap (your agent finds the best-reviewed seller,
pays, gets it, rates, comes back) in the colours of the Canva deck; its source is `how-it-works.html`
(1920x1080).

`out/screenshots/` has the find slides and the site's developer section, llms.txt and proof section,
taken from the production build.

In `assets/`: the logo (SVG and 1024 px PNG) and a cover image.

The pitch gained two slides after the videos were rendered: on 7 October slide 10, `zk` (proof of
personhood as the next step), and on 9 October slide 8, `find` (reviews as search for agents: one call
to `find_merchants`); on 9 October the demo gained slide 6, `find`, and its stack slide lists the
four ways in for agents. Both find slides show a real recording: `npm run demo:find` runs twelve
purchases between agents on a local validator with the real program, then asks `find_merchants`, and
writes `deployments/find-demo.json`, which the slides and the site's developer section read. The slide PNGs and
the PDFs in `out/` include these, but the rendered videos and the generated scripts in `out/` predate
them: render again on a Mac, or record your own voice from the deck as `docs/SUBMISSION.md` suggests.

## Presenting

Open a deck in a browser. `→` or space moves on, `←` goes back, `n` shows the narration for the slide,
`a` plays it by itself. `#/deck/pitch?i=4` opens on slide 5.

The demo deck's "network", "checkout" and "profile" slides are the live site in a frame. The checkout
slide performs a real purchase on devnet with the site's built-in test wallet, so `npm run agents` has to
be running.

Those slides need devnet when they are captured, so two of the demo stills in `out/` come from
elsewhere. `demo-slides/08.png` (checkout) is a frame of the devnet purchase recorded in
`tessera-demo.mp4`. `demo-slides/09.png` (profile) is the real profile page, read from a local
validator holding the `npm run demo:find` merchants. When presented live, both slides read devnet.

## Rendering

```bash
npm run web                      # terminal 1
npm run agents                   # terminal 2
node pitch/render.mjs pitch      # narrated video, about 3 minutes to render
node pitch/render.mjs demo
node pitch/render.mjs update     # the one-minute weekly update
node pitch/stills.mjs            # slide PNGs, PDFs, logo PNG, cover image
```

`render.mjs` reads each slide's narration from the deck source, speaks it with the macOS `say` voice,
sizes each slide to its audio, records the deck in headless Chrome, and puts the two together with
ffmpeg. `--voice Samantha` picks another voice; `--no-voice` renders a silent video at the slides'
declared lengths, for you to talk over.

Needs macOS, ffmpeg and Google Chrome. Do not run `npm run swarm` while rendering: the public devnet
RPC rate-limits, and the live slides need it.

## Changing what is said

Edit the `say` text of a slide in `apps/web/src/deck/pitch.tsx` or `demo.tsx` and render again. The
scripts in `out/` are generated; editing them changes nothing.

The pitch and the demo have to stay at or under three minutes for the Colosseum submission, and the
weekly update under one. The renderer prints the total and warns if it is over. The narration is also
kept short enough to read aloud at a normal pace: 429 words for the pitch, 407 for the demo.

After a render, look at the checkout slide of the demo video before using it. That slide performs a
real purchase; if the agents server or the faucet was down, the video will show the failure.

## A note on the voice

The rendered videos use a computer voice so that the package is complete. For the submission, record
your own: judges assess how the founder communicates. See `docs/SUBMISSION.md`.
