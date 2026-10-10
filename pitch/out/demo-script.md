# Tessera demo video: script

Generated from `apps/web/src/deck/demo.tsx` (slide lengths as declared there). Total 3:00. The recorded .mp4 files are older than this script.
Edit the `say` text in the deck, not this file.

| # | Starts | Slide | Say |
|---|---|---|---|
| 1 | 0:00 | title | This is how Tessera works, in under three minutes. |
| 2 | 0:04 | accounts | One Anchor program, five kinds of account. Config holds the rules. Each wallet has an Agent account, its credit file. Each buyer and merchant pair has a Pair account. Each purchase is an Order, which owns the vault. Each rating is a Review, stored on-chain in full. |
| 3 | 0:22 | trick | The x402 exact scheme on Solana allows only a plain token transfer, so an escrow instruction has nowhere to go. But the destination is derived from pay-to. So the merchant quotes the order account as pay-to, and the money lands in the vault. The program reads the vault balance. It trusts nobody's word. |
| 4 | 0:41 | network | This is the network, read from devnet in the browser. No indexer, no database. Squares are merchants, circles are buyers. A coin on a line is money in escrow. Bright nodes are Trusted. The small cluster on its own is a wash-trading ring. |
| 5 | 1:00 | terminal | Here one agent buys from another. It reads the merchant's A2A card, gets a 402, checks the escrow on-chain, and pays through the facilitator. The merchant delivers and commits a hash, and the buyer checks it. Two unknown wallets, so the money was held. |
| 6 | 1:20 | find | Before buying, an agent asks who to buy from. One call ranks merchants by reviews that cost real sales. The one that missed a delivery ranks last, and a regular customer settles instantly. |
| 7 | 1:33 | rewards | Reviews are paid by an airdrop from the fees. Three buyers reviewed Glib, then Glib failed a delivery. The honest warning earned the most; the glowing reviews earned nothing. |
| 8 | 1:45 | score | The score is integer arithmetic over those accounts, written once in Rust and once in TypeScript. A test suite runs the real program on a local validator and compares every account with the model after every instruction. Two hundred and ninety-four checks, attacks included. |
| 9 | 2:03 | checkout | A person can buy from the same agents with a wallet. The merchant opens the escrow. The browser checks it on-chain before paying. The payment goes into the vault. The merchant delivers, and the hash of what arrived matches the one on-chain. This buyer is new, so the money is held. Here it confirms receipt, and the merchant is paid. |
| 10 | 2:34 | profile | Every wallet has a credit file anyone can read: the score and what it is made of, and every review with the weight it carried. Its reviews are mirrored to Solana's Agent Registry with proof of payment. |
| 11 | 2:47 | stack | The stack: Anchor, Solana Kit and Codama, x402, A2A, and the Solana Agent Registry. Agents call it over an API, MCP, a skill or a CLI. It is devnet only, with one arbiter key and no audit. |
