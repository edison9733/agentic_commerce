# Tessera escrow: an A2A extension

**URI:** `https://github.com/edison9733/agentic_commerce/blob/main/docs/A2A-EXTENSION.md`

This extension tells a client agent two things about a merchant agent that takes
[x402 payments over A2A](https://github.com/google-agentic-commerce/a2a-x402): that the payment goes
into a Tessera escrow rather than to the merchant, and where to find the on-chain credit profile behind
the agent. It adds metadata; it does not change the x402 extension's flow or message shapes.

## Declaration

```json
{
  "capabilities": {
    "extensions": [
      { "uri": "https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.2", "required": true },
      {
        "uri": "https://github.com/edison9733/agentic_commerce/blob/main/docs/A2A-EXTENSION.md",
        "required": false,
        "params": {
          "program": "TessSeP5QV5Bxpvm73iEefdsTjgtTEokKSx7jqFn1CQ",
          "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
          "wallet": "<the merchant's wallet>",
          "prices": { "<skill id>": "<amount in token units>" },
          "decimals": 6,
          "x402Resource": "<base>/x402/{skill}",
          "standing": { "score": 0, "tier": "New" }
        }
      }
    ]
  }
}
```

`standing` is a convenience. A client **must not** rely on it: it should read the merchant's Agent
account (`["agent", wallet]` under `program`) and recompute the score itself.

## Flow

The a2a-x402 standalone flow, with three additions.

1. **Request.** The client's data part names the wallet that will pay, because the escrow is opened for
   that wallet: `{ "skill": "<id>", "input": { ... }, "buyer": "<wallet>", "minHoldSecs": 60 }`.
   `minHoldSecs` is optional and can only lengthen the hold.
2. **Payment required.** `x402.payment.required.accepts[].payTo` is the **order account**. The escrow
   terms are repeated in `x402.payment.required.extensions.tessera` and in the metadata key
   `tessera.escrow`:

   ```json
   { "program": "...", "orderId": "<32 bytes, hex>", "order": "...", "vault": "...",
     "buyer": "...", "merchant": "...", "amount": "200000", "mint": "...",
     "holdSecs": 120, "buyerTier": "New", "merchantTier": "New", "pairTrusted": false,
     "requestHash": "<sha256 of the canonical JSON of { sku, input }>" }
   ```

   There is one `accepts` entry per facilitator the merchant can settle through; each names that
   facilitator's fee payer in `extra.feePayer`.
3. **Before paying, the client verifies on-chain** that the order account derived from `orderId` equals
   `payTo`, and that the order's buyer, merchant, amount, mint, request hash and state are what it asked
   for. `verifyOrderForPayment` in `@tessera/sdk` does this.
4. **Payment submitted.** Either the standard `x402.payment.payload`, or, when the client funded the
   vault itself, `tessera.payment.direct: { "signature": "<tx>" }`. Both are followed by the merchant
   asking the program to confirm funding from the vault balance.
5. **Completed.** The artifact is the deliverable. `tessera.delivery` in the status message carries
   `{ order, deliveryHash, state, instant, releaseAt, deliverTx }`. The client should check that the
   sha256 of the canonical JSON of the artifact equals the `delivery_hash` stored on the order, and
   dispute during the hold if it does not.

Canonical JSON here means `JSON.stringify` with object keys sorted at every level (`canonicalJson` in the SDK).

## Status

Implemented by `apps/agents` in this repository against the a2a-x402 v0.2 specification text. It has
not been run against the official A2A test kit.
