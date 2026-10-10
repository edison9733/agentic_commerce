use anchor_lang::prelude::*;

pub const BPS: u64 = 10_000;
pub const MAX_NAME: usize = 32;
pub const MAX_URI: usize = 128;
pub const MAX_REVIEW: usize = 200;
/// The longest hold a buyer may ask for. A disputed order's fallback is keyed
/// on the end of the hold, so an unbounded hold could lock money for decades.
pub const MAX_HOLD_SECS: u32 = 30 * 86_400;

/// Every tunable lives on-chain so anyone can read the rules a score was
/// computed under. Devnet runs with compressed time and amounts (see
/// docs/SCORING.md); the formula is identical on every cluster.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Debug, PartialEq, Eq)]
pub struct Params {
    /// Length of one activity period in seconds (mainnet target: one day).
    pub period_secs: u32,
    /// Settlement hold per tier: New, Building, Established, Trusted.
    pub hold_secs: [u32; 4],
    /// Minimum score for tiers 1..=3.
    pub tier_score: [u16; 3],
    /// Minimum active periods for tiers 1..=3. Time cannot be bought in a burst.
    pub tier_periods: [u16; 3],
    /// Credit at which the History component saturates.
    pub credit_full: u64,
    /// Most volume from one counterparty that can ever earn credit.
    pub pair_cap: u64,
    /// Effective periods at which the Tenure component saturates.
    pub tenure_full: u16,
    /// Counterparty points (x100) at which the Diversity component saturates.
    pub diversity_full: u16,
    /// Weight of the Bayesian prior (3 stars) behind every rating.
    pub review_prior: u64,
    /// Smallest order the program accepts.
    pub min_order: u64,
    /// Merchant must deliver within this many seconds of funding.
    pub deliver_secs: u32,
    /// The rent payer may cancel an unpaid order after this many seconds.
    pub unpaid_secs: u32,
    /// Reviews are accepted for this long after settlement.
    pub review_secs: u32,
    /// An instant order the buyer rated 1 or 2 stars keeps its amount locked
    /// against the merchant's instant limit for this long.
    pub complaint_secs: u32,
    /// Instant exposure every Trusted merchant may carry.
    pub instant_base: u64,
    /// Extra instant exposure as a percentage of protocol fees the merchant has paid.
    pub instant_fee_pct: u16,
    /// Prior undisputed settled orders that waive the buyer-side hold.
    pub pair_history_min: u16,
    /// ...the first of which must be at least this old.
    pub pair_age_secs: u32,
    /// Penalty (bps of score) for losing a dispute.
    pub penalty_dispute_bps: u16,
    /// Penalty (bps of score) for failing to deliver before the deadline.
    pub penalty_expired_bps: u16,
    /// Penalty forgiven per period of clean behaviour.
    pub penalty_decay_bps: u16,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub pending_authority: Pubkey,
    /// Resolves disputes. Snapshotted per order, so changing it cannot reach
    /// disputes that are already open.
    pub arbiter: Pubkey,
    /// Wallet whose token account receives protocol fees.
    pub treasury: Pubkey,
    /// The one settlement mint (classic SPL token).
    pub mint: Pubkey,
    pub fee_bps: u16,
    pub params: Params,
    pub orders_opened: u64,
    pub orders_settled: u64,
    pub volume_settled: u64,
    pub fees_collected: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Default, Debug)]
pub struct RoleStats {
    /// Orders released to the merchant.
    pub orders: u32,
    /// Volume released to the merchant (gross of fee).
    pub volume: u64,
    pub refunds: u32,
    /// Disputes opened (buyer role) or received (merchant role).
    pub disputes: u32,
    pub disputes_lost: u32,
    /// Merchant role only: orders never delivered before the deadline.
    pub expired: u32,
    /// Orders that settled instantly.
    pub instant: u32,
}

/// One wallet's identity and credit file. Role-agnostic: the same account
/// tracks behaviour as a buyer and as a merchant.
#[account]
#[derive(InitSpace)]
pub struct Agent {
    pub wallet: Pubkey,
    pub registered_at: i64,
    /// Self-declared: 0 unset, 1 human, 2 AI agent.
    pub kind: u8,
    #[max_len(MAX_NAME)]
    pub name: String,
    /// Where the A2A agent card lives.
    #[max_len(MAX_URI)]
    pub uri: String,

    // ---- evidence
    /// Settled volume, weighted by counterparty tier and capped per pair.
    pub credit: u64,
    /// Sum over counterparties of the best tier weight seen (x100).
    pub counterparty_points: u32,
    pub counterparties: u32,
    /// Distinct periods with at least one settled order.
    pub active_periods: u32,
    pub last_active_period: u64,
    /// Protocol fees paid on this wallet's sales. Sunk cost: this is what
    /// bounds instant settlement.
    pub fees_paid: u64,

    // ---- behaviour
    pub penalty_bps: u16,
    /// Period in which `penalty_bps` was last brought up to date.
    pub penalty_period: u64,

    // ---- reviews received
    /// Sum of weight x rating.
    pub rating_sum: u128,
    pub rating_weight: u64,
    pub reviews_received: u32,

    pub as_buyer: RoleStats,
    pub as_merchant: RoleStats,

    /// Instant-settled volume that buyers have not accepted yet. It can never
    /// exceed `score::instant_limit`, which is what bounds an exit scam.
    pub instant_exposure: u64,

    // ---- cached result of score::evaluate
    pub score: u16,
    pub tier: u8,
    pub score_updated_at: i64,

    pub bump: u8,
}

/// History between one buyer and one merchant. This is the on-chain version
/// of a card network's "historical footprint": prior undisputed purchases are
/// evidence that the next one is legitimate.
#[account]
#[derive(InitSpace)]
pub struct Pair {
    pub buyer: Pubkey,
    pub merchant: Pubkey,
    pub orders: u32,
    pub volume: u64,
    /// Credit this pair has granted to each side, so the cap is per side.
    pub credit_to_buyer: u64,
    pub credit_to_merchant: u64,
    /// Best tier weight (x100) each side has earned from this relationship.
    pub points_to_buyer: u16,
    pub points_to_merchant: u16,
    /// Review weight each side has already spent on the other.
    pub rated_by_buyer: u64,
    pub rated_by_merchant: u64,
    pub first_settled_at: i64,
    pub last_settled_at: i64,
    pub disputes: u32,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum OrderState {
    AwaitingPayment,
    Funded,
    Delivered,
    Released,
    Refunded,
    Disputed,
    Resolved,
    /// Abandoned before payment. The account stays for the payment window, so
    /// the same order id cannot be reopened, for anyone, while a payment
    /// signed for the old order could still land in its vault.
    Cancelled,
}

/// One escrow. The order account is also the vault's authority, and the
/// vault is simply ATA(mint, order) -- a legal x402 `payTo`.
#[account]
#[derive(InitSpace)]
pub struct Order {
    pub order_id: [u8; 32],
    pub buyer: Pubkey,
    pub merchant: Pubkey,
    /// Paid the rent; gets it back.
    pub payer: Pubkey,
    pub mint: Pubkey,
    pub arbiter: Pubkey,
    pub amount: u64,
    pub fee_bps: u16,
    pub state: OrderState,

    // ---- risk snapshot taken when the order was opened
    pub buyer_tier: u8,
    pub merchant_tier: u8,
    pub buyer_score: u16,
    pub merchant_score: u16,
    /// Buyer had enough undisputed history with this merchant.
    pub pair_trusted: bool,
    /// Hold the tiers called for at open.
    pub hold_secs: u32,
    /// Set at delivery if the order settled without a hold.
    pub instant: bool,
    /// An instant order stops counting against the merchant's limit once the
    /// buyer accepts it (3 stars or more) or its review window passes.
    pub seasoned: bool,
    /// The buyer rated an instant order 1 or 2 stars.
    pub complained: bool,

    /// Hash of what was ordered (the A2A task or the x402 resource).
    pub request_hash: [u8; 32],
    /// Hash of what was delivered.
    pub delivery_hash: [u8; 32],
    pub dispute_hash: [u8; 32],

    pub created_at: i64,
    pub funded_at: i64,
    pub deliver_by: i64,
    pub delivered_at: i64,
    pub release_at: i64,
    pub settled_at: i64,

    pub paid_merchant: u64,
    pub paid_fee: u64,
    pub refunded: u64,

    pub buyer_reviewed: bool,
    pub merchant_reviewed: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Review {
    pub order: Pubkey,
    pub reviewer: Pubkey,
    pub subject: Pubkey,
    pub reviewer_is_buyer: bool,
    pub rating: u8,
    /// What this review counted for: settled volume x reviewer tier weight,
    /// capped per pair. A refunded order weighs 0.
    pub weight: u64,
    pub created_at: i64,
    #[max_len(MAX_REVIEW)]
    pub text: String,
    pub bump: u8,
}
