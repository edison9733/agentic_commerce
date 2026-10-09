/**
 * The contract every door shares: the HTTP API returns these values, the MCP
 * server puts them in its tool schemas as enums, the CLI validates against
 * them, and SKILL.md teaches them. Nothing here talks to a network.
 */

/**
 * What `check_payment` tells an agent to do with a payment. The score routes,
 * it never bans: a merchant's record only ever moves a payment between
 * `instant` and `escrow`. `block` means the payment itself cannot work as
 * asked (the same wallet on both sides, below the minimum, not enough money).
 */
export const DECISIONS = ['instant', 'escrow', 'block'] as const;
export type Decision = (typeof DECISIONS)[number];

/** Why. Every decision carries exactly one of these. */
export const REASONS = [
  /** Both parties are Trusted and the merchant is inside its instant limit. */
  'both_trusted',
  /** The buyer has undisputed history with this merchant, and the merchant is Trusted. */
  'pair_history',
  /** The merchant's tier sets the hold. */
  'merchant_tier',
  /** The buyer's own tier sets the hold. */
  'buyer_tier',
  /** The buyer asked for a longer hold than the tiers call for. */
  'buyer_requested_hold',
  /** Trusted, but the merchant has used up its instant limit, so the order waits. */
  'instant_limit_reached',
  /** The merchant has no Tessera credit file: nobody has settled an order with it. */
  'merchant_unknown',
  /** The merchant carries a standing penalty from lost disputes or missed deliveries: escrow with the longest hold. Never a ban. */
  'merchant_penalized',
  /** Buyer and merchant are the same wallet. */
  'self_dealing',
  /** Below the smallest order the program accepts. */
  'amount_below_minimum',
  /** The buyer's wallet holds less than the amount. */
  'insufficient_funds',
] as const;
export type Reason = (typeof REASONS)[number];

/** Every response has a `status`. `ok` is the only one that means "as asked". */
export const STATUSES = [
  'ok',
  'no_match',
  'unknown_merchant',
  'unknown_wallet',
  'unknown_order',
  'invalid_request',
  'verification_failed',
  'wrong_state',
  'hold_not_elapsed',
  'not_yet',
  'not_a_party',
  'already_reported',
  'review_window_closed',
  'insufficient_funds',
  'rejected',
  'rate_limited',
  'not_configured',
  'rpc_unavailable',
  'internal_error',
] as const;
export type Status = (typeof STATUSES)[number];

/** The HTTP code each status is sent with. An answer about an unknown party is still an answer. */
export const HTTP_CODE: Record<Status, number> = {
  ok: 200,
  no_match: 200,
  unknown_merchant: 200,
  unknown_wallet: 200,
  unknown_order: 404,
  invalid_request: 400,
  verification_failed: 422,
  wrong_state: 409,
  hold_not_elapsed: 409,
  not_yet: 409,
  not_a_party: 403,
  already_reported: 409,
  review_window_closed: 409,
  insufficient_funds: 409,
  rejected: 422,
  rate_limited: 429,
  not_configured: 503,
  rpc_unavailable: 503,
  internal_error: 500,
};

/** Who is asking `open_escrow` for a transaction. */
export const ROLES = ['buyer', 'merchant'] as const;
export type Role = (typeof ROLES)[number];

/**
 * How `find_merchants` orders what it finds. `best`: the score, which already
 * weighs reviews by the money behind them. `fastest`: least time from paying
 * to settled (delivery plus hold, for this buyer). `cheapest`: lowest price.
 */
export const SORTS = ['best', 'fastest', 'cheapest'] as const;
export type Sort = (typeof SORTS)[number];
/** Longest search text `find_merchants` takes. */
export const MAX_NEED_CHARS = 120;
/** Most merchants `find_merchants` returns. */
export const MAX_FIND_LIMIT = 20;

/** What `report_outcome` reports. */
export const OUTCOMES = ['satisfied', 'unsatisfied', 'not_delivered'] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** What a returned transaction does once signed. */
export const ACTIONS = [
  'open_order',
  'fund_escrow',
  'deliver',
  'deliver_and_release',
  'release',
  'release_and_review',
  'dispute',
  'review',
  'refund',
  'refund_missed_delivery',
  'cancel_unpaid',
  'split_silent_dispute',
] as const;
export type Action = (typeof ACTIONS)[number];

export const TIERS = ['New', 'Building', 'Established', 'Trusted'] as const;
export const ORDER_STATES = ['AwaitingPayment', 'Funded', 'Delivered', 'Released', 'Refunded', 'Disputed', 'Resolved'] as const;

/** Base58, 32 to 44 characters. The API also checks it decodes to 32 bytes. */
export const ADDRESS_PATTERN = '^[1-9A-HJ-NP-Za-km-z]{32,44}$';
/** USDC as a decimal string, at most 6 decimal places: "0.2", "15", "0.000001". */
export const AMOUNT_PATTERN = '^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,6})?$';
/** 32 bytes as lowercase hex. */
export const HEX32_PATTERN = '^[0-9a-f]{64}$';
/** Longest review text the program stores, in bytes. */
export const MAX_COMMENT_BYTES = 200;
/** Longest hold a buyer may ask for: 90 days. */
export const MAX_MIN_HOLD_SECS = 90 * 86_400;

/**
 * The tools, as the MCP server and the docs describe them. Grouped by the
 * phase of a payment they belong to.
 */
export const TOOLS = {
  find_merchants: {
    phase: 'before',
    method: 'GET',
    path: '/v1/merchants',
    summary:
      'Ranks merchants for a need by their on-chain record: reviews weighted by the money behind them, settled sales, penalties. Each row says what paying would take (instant or escrow) and how many seconds from paying to settled.',
  },
  get_score: {
    phase: 'before',
    method: 'GET',
    path: '/v1/score/{wallet}',
    summary: "A wallet's Tessera credit file: score 0-1000, tier, what the score is made of, and its record as merchant and buyer.",
  },
  check_payment: {
    phase: 'before',
    method: 'POST',
    path: '/v1/check',
    summary:
      'Call before any paid tool call or x402 payment. Returns decision instant, escrow or block, a reason code, and the hold the escrow would apply.',
  },
  open_escrow: {
    phase: 'during',
    method: 'POST',
    path: '/v1/escrow/open',
    summary:
      'Builds an unsigned transaction. role merchant: open an escrow order for a buyer (its address is the x402 payTo). role buyer: verify a quoted order on-chain, then fund it.',
  },
  deliver_order: {
    phase: 'during',
    method: 'POST',
    path: '/v1/escrow/deliver',
    summary:
      'Merchant side. Builds an unsigned transaction that confirms the vault is funded (if needed) and commits the hash of what was delivered; between two Trusted parties it also settles at once.',
  },
  get_escrow: {
    phase: 'during',
    method: 'GET',
    path: '/v1/escrow/{order}',
    summary: 'The state of one escrow order: amounts, deadlines, and what each party can do next.',
  },
  release_escrow: {
    phase: 'after',
    method: 'POST',
    path: '/v1/escrow/release',
    summary: 'Builds an unsigned transaction that pays the merchant: the buyer at any time after delivery, anyone once the hold has ended.',
  },
  reclaim_after_timeout: {
    phase: 'after',
    method: 'POST',
    path: '/v1/escrow/reclaim',
    summary:
      'Builds an unsigned transaction that returns money when the other side timed out: a missed delivery, an unpaid quote, or a dispute the arbiter never answered.',
  },
  report_outcome: {
    phase: 'after',
    method: 'POST',
    path: '/v1/escrow/report',
    summary:
      'Builds an unsigned transaction for what happened: satisfied (release and review), unsatisfied (dispute during the hold, else review), not_delivered (refund after the deadline).',
  },
  submit_transaction: {
    phase: 'after',
    method: 'POST',
    path: '/v1/tx/submit',
    summary: 'Relays a transaction your own wallet has signed, and waits for confirmation. Optional: any RPC will do.',
  },
} as const;
export type ToolName = keyof typeof TOOLS;
