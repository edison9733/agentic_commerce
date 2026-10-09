# Try Tessera yourself: be the buyer and the merchant

There are three ways to try it, from no setup at all to doing every step of a trade yourself.

| | What you do | You need |
|---|---|---|
| **A. Look around** | Play with the score, browse the live network | A browser |
| **B. Be both sides, from a terminal** | Make two wallets; sell to yourself, pay, deliver, release, review, and get a refund | A computer with Node and the Solana CLI |
| **C. Buy on the website** | Connect a browser wallet and buy from the demo merchant agents | The agents hosted ([RAILWAY.md](RAILWAY.md)) |

Everything runs on Solana **devnet** with test money. Nothing here costs real money.

> **For the project owner, once:** the program on devnet predates the audit fixes. Redeploy it
> before others try this, using the steps in [SECURITY.md](SECURITY.md). If a command fails with a
> program error before that, this is why.

---

## A. Look around (2 minutes)

Open https://agentic-commerce-two-theta.vercel.app

1. **The score**, on the home page or under **The score** in the menu:
   - Click the example wallets, from **Brand new** to **Sells to itself**.
   - Then drag the sliders and watch the score, the tier and the hold change.
   - The **Try it** button applies the single change that adds the most points.
2. **Live network**: every order on devnet, as it happens.
3. **Agents**: every wallet's credit file, with its score, reviews, and what each review was worth.
4. **For agents**: what an AI agent sees when it asks `find_merchants` who to buy from.

---

## B. Be the buyer and the merchant, from a terminal (about 20 minutes)

You make two wallets and play both sides of a real trade, one command at a time:
- the merchant asks for payment;
- the buyer pays into escrow;
- the merchant delivers;
- the buyer releases the money and both sides review each other.

Then you see a refund when a merchant never delivers.

Every command and output below comes from a rehearsal run on a local copy of the chain, using the
devnet settings and two brand-new wallets.

> On Windows, use WSL (Ubuntu) and run everything inside it.

### Step 0. One-time: install the tools

1. Install **Node.js 22 or newer**, from https://nodejs.org.
2. Install the **Solana CLI**:
   ```bash
   sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
   ```
   Close and reopen the terminal, then check that it works with `solana --version`.
3. Get the code:
   ```bash
   git clone https://github.com/edison9733/agentic_commerce.git
   cd agentic_commerce
   npm ci
   ```

### Step 1. Make two wallets

```bash
mkdir -p ~/tessera
solana-keygen new --no-bip39-passphrase -o ~/tessera/buyer.json
solana-keygen new --no-bip39-passphrase -o ~/tessera/merchant.json

BUYER=$(solana address -k ~/tessera/buyer.json)
MERCHANT=$(solana address -k ~/tessera/merchant.json)
echo "buyer    $BUYER"
echo "merchant $MERCHANT"
```

Keep this terminal open: the later steps use `$BUYER` and `$MERCHANT`. In a new terminal, run the
last four lines again.

### Step 2. Get test money

1. **Test SOL for both wallets**, to pay network fees. The merchant also pays a small deposit to open an order.
   ```bash
   solana airdrop 1 $BUYER --url devnet
   solana airdrop 1 $MERCHANT --url devnet
   ```
   If it says you've hit the rate limit, use https://faucet.solana.com instead: paste each address and choose devnet.

2. **Test USDC for the buyer.**
   1. Go to https://faucet.circle.com.
   2. Choose **Solana Devnet**.
   3. Paste the `$BUYER` address and click **Send**.

   Check that it arrived:
   ```bash
   spl-token balance --owner $BUYER 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU --url devnet
   ```
   The merchant doesn't need any USDC. Its token account is created when it is first paid.

### Step 3. Start the Tessera API

In a **second terminal**, inside `agentic_commerce`:

```bash
npm run api
```

Leave it running. It builds transactions for you to sign. It never sees your keys: the CLI signs on
your computer.

If the API is already hosted on Railway, you can skip this step. Instead, run
`export TESSERA_API_URL=https://<your api domain>` in the first terminal.

All the commands below run in the **first terminal**.

### Step 4. As the buyer: check the merchant before paying

```bash
npm run tessera -- check $MERCHANT 0.50 --keypair ~/tessera/buyer.json
```

You see:

```
ESCROW  0.50 USDC  hold 120 s  (merchant_unknown)  [unknown_merchant]
Nobody has settled an order with this merchant. Pay only into an escrow it opens, held 120 s. If it cannot open one, do not pay.
```

The merchant is brand new, so the answer is: don't pay it directly. Pay into an escrow, and the money
is held for 2 minutes after delivery.

### Step 5. As the merchant: ask for payment

```bash
npm run tessera -- open merchant --buyer $BUYER --amount 0.50 \
  --request '{"item":"a haiku"}' --keypair ~/tessera/merchant.json --send
```

You see:

```
order 8VHSNtD3WErxoG3wXdmpJD14VTYdoRj61tZzwGiFmKAZ  vault 5pJrATPR…
confirmed: 3ADY8BJS…
```

Copy the order address into a variable. Yours will be different:

```bash
ORDER=8VHSNtD3WErxoG3wXdmpJD14VTYdoRj61tZzwGiFmKAZ
```

### Step 6. As the buyer: pay into the escrow

```bash
npm run tessera -- open buyer --merchant $MERCHANT --amount 0.50 --order $ORDER \
  --keypair ~/tessera/buyer.json --send
```

The CLI checks that the money goes into this order's escrow vault, and nowhere else, before it signs.

Now look at the order:

```bash
npm run tessera -- escrow $ORDER
```

```
…  Funded  0.50 USDC  hold 120 s
buyer 75xu…7bEF  merchant HwZD…TTFn  vault holds 0.50 USDC
  next: merchant → deliver_order: deliver until …
  next: anyone → reclaim_after_timeout: refund the buyer if nothing was delivered from …
```

The money sits in the vault. Neither side can take it alone.

### Step 7. As the merchant: deliver

```bash
npm run tessera -- deliver $ORDER \
  --deliverable '{"haiku":"coins wait in escrow / the poem arrives on time / both sides sleep at night"}' \
  --keypair ~/tessera/merchant.json --send
```

A fingerprint (hash) of the deliverable is recorded on chain, so later nobody can claim something
else was delivered.

### Step 8. As the buyer: release the money

When you're happy with what you got:

```bash
npm run tessera -- release $ORDER --keypair ~/tessera/buyer.json --send
```

```
payouts: merchant 0.495 USDC, fee 0.005 USDC, buyer 0.00 USDC
```

If the buyer does nothing, anyone can release the money once the 2-minute hold ends. If the buyer
is unhappy, they can open a dispute during the hold instead.

### Step 9. Review each other

The buyer reviews the merchant:

```bash
npm run tessera -- report $ORDER --outcome satisfied --rating 5 \
  --comment "Fast and exactly what I asked for" --keypair ~/tessera/buyer.json --send
```

The merchant reviews the buyer:

```bash
npm run tessera -- report $ORDER --outcome satisfied --rating 5 \
  --comment "Paid promptly" --keypair ~/tessera/merchant.json --send
```

Each review weighs as much as the money that actually settled. A review with no purchase behind it
counts for nothing.

### Step 10. See what changed

```bash
npm run tessera -- score $MERCHANT
npm run tessera -- find
```

```
wallet   HwZD…TTFn  New 28  ★3.18
as merchant: 1 orders, 0.50 USDC, 0 disputes lost, 0 missed

 1. HwZD9vrP…    New 28 ★3.18 (1 reviews, 1 sales)
    ESCROW ~122 s to settled
    "Fast and exactly what I asked for" ★5
```

What this shows:
- One small sale moves the score a little. Trust is earned slowly, and faking it costs money.
- The stars show 3.18, not 5. Every wallet starts from 3 stars, and one 50-cent review only moves that a bit.
- Your merchant is now listed by `find`, the call AI agents make to choose who to buy from.

You can also see it on the website: open `https://agentic-commerce-two-theta.vercel.app/#/agents/<your merchant address>`.

Every `confirmed:` line came with an `explorer.solana.com` link. Open one to see the transaction on Solana.

### Step 11. The bad path: the merchant takes the order and never delivers

Open and pay a second order (steps 5 and 6), this time for `0.30`, and save its address as `ORDER2`.
Then **don't deliver**.

If the buyer tries to take the money back straight away, it is refused:

```bash
npm run tessera -- reclaim $ORDER2 --keypair ~/tessera/buyer.json --send
```

```
not_yet: The merchant still has time to deliver.
```

The merchant has 5 minutes to deliver. After that, run the same command again:

```
payouts: merchant 0.00 USDC, fee 0.00 USDC, buyer 0.30 USDC
Sign and send. The buyer gets everything back.
```

The buyer gets everything back, and the merchant's file now shows the miss:

```bash
npm run tessera -- score $MERCHANT
```

```
penalty 10%
as merchant: 1 orders, 0.50 USDC, 0 disputes lost, 1 missed
```

### Things to try next

- **Sell to more buyers.** Make a third wallet and repeat steps 4 to 9, then compare `score`. More
  different buyers counts for more than more money from the same buyer.
- **Ask like an agent.** Run `npm run tessera -- find --sort fastest`, or
  `npm run tessera -- check $MERCHANT 0.50 --keypair ~/tessera/buyer.json` again. The hold and the
  reason change as the merchant builds a record.
- **Plug in Claude.** Run `npm run mcp`, then
  `claude mcp add --transport http tessera http://127.0.0.1:4040/mcp`, and ask Claude:
  "list the best merchants on Tessera and check one before paying 0.50 USDC".

### If something goes wrong

| You see | It means | Do this |
|---|---|---|
| `insufficient_funds` | The buyer has no test USDC | Use the Circle faucet again (step 2) |
| `fetch failed` or a connection error | The CLI can't reach the API | Start `npm run api` in the second terminal (step 3) |
| `airdrop request failed` | Devnet's rate limit | Use https://faucet.solana.com |
| `not_yet` | It's too early for that step | Read the time it gives, or run `escrow $ORDER` to see what's possible next |
| `self_dealing` | The buyer and the merchant are the same wallet | Use the two different key files |

---

## C. Buy on the website with a browser wallet

This needs the merchant agents hosted ([RAILWAY.md](RAILWAY.md)) and `VITE_AGENTS_URL` set on Vercel.
Until then, the Market page can't reach a merchant.

1. Install **Phantom**, **Solflare** or **Backpack**, and switch it to **devnet**. In Phantom this is
   under Settings → Developer settings → Testnet mode.
2. Open the site and click **Connect wallet**.
3. Go to **Market** and press the test-funds button. It sends the wallet test USDC and SOL.
4. Pick a merchant and buy. The wallet asks you to approve each step:
   - pay into escrow;
   - check the delivery;
   - release;
   - review.
5. Open **Agents** and find your wallet: your purchase and review are on your credit file.
