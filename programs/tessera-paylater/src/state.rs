use anchor_lang::prelude::*;

pub const BPS: u64 = 10_000;
/// The pool keeps at most this share of each purchase as its fee.
pub const MAX_FEE_BPS: u16 = 1_000;
/// The longest a buyer may be given to repay.
pub const MAX_TERM_SECS: u32 = 90 * 86_400;

/// Every rule a credit limit is computed under, stored on-chain so anyone can
/// recompute any wallet's limit.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Debug, PartialEq, Eq)]
pub struct LineParams {
    /// Credit limit at a perfect score, per Tessera tier: New, Building,
    /// Established, Trusted. New must be 0: a wallet with no history gets no credit.
    pub tier_limit: [u64; 4],
    /// Each purchase repaid on time raises the limit by this share of it (bps)...
    pub step_bps: u16,
    /// ...up to this much in total (bps). 10000 lets the limit double.
    pub max_boost_bps: u16,
    /// Time the buyer has to repay, from the purchase.
    pub term_secs: u32,
    /// After the due date, how long before anyone may mark the loan in default.
    pub grace_secs: u32,
    /// Share of each purchase the pool keeps; the merchant gets the rest at once.
    /// The buyer repays the full price and pays no interest.
    pub fee_bps: u16,
    /// The pool only pays merchants that have earned at least this Tessera tier.
    pub min_merchant_tier: u8,
    /// Smallest purchase the pool finances.
    pub min_loan: u64,
}

/// The lending pool. Its token account, ATA(mint, pool), holds the liquidity.
#[account]
#[derive(InitSpace)]
pub struct Pool {
    pub authority: Pubkey,
    /// The settlement mint, the same one the escrow program uses.
    pub mint: Pubkey,
    pub params: LineParams,
    /// Principal lent and not yet repaid, defaulted loans included.
    pub outstanding: u64,
    pub deposited: u64,
    pub withdrawn: u64,
    pub lent: u64,
    pub repaid: u64,
    /// Principal of loans that went past their grace period unpaid.
    pub defaulted: u64,
    pub fees_earned: u64,
    pub loans_opened: u64,
    pub bump: u8,
}

/// One wallet's pay-later record. Public, like its Tessera credit file.
#[account]
#[derive(InitSpace)]
pub struct CreditLine {
    pub wallet: Pubkey,
    pub opened_at: i64,
    pub outstanding: u64,
    pub open_loans: u32,
    pub loans: u32,
    pub borrowed: u64,
    pub repaid: u64,
    pub repaid_on_time: u32,
    pub repaid_late: u32,
    /// Loans marked in default. Any default freezes the line for good.
    pub defaults: u32,
    pub last_loan_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum LoanState {
    Open,
    RepaidOnTime,
    RepaidLate,
    Defaulted,
}

/// One purchase financed by the pool.
#[account]
#[derive(InitSpace)]
pub struct Loan {
    pub loan_id: [u8; 32],
    pub buyer: Pubkey,
    pub merchant: Pubkey,
    /// What the buyer owes: the full price.
    pub amount: u64,
    /// What the pool kept; the merchant received `amount - fee`.
    pub fee: u64,
    /// Hash of what was bought (the A2A task or the x402 resource).
    pub request_hash: [u8; 32],
    pub state: LoanState,
    // ---- snapshot taken at purchase
    pub buyer_tier: u8,
    pub buyer_score: u16,
    pub merchant_tier: u8,
    pub limit_at_open: u64,
    pub created_at: i64,
    pub due_at: i64,
    pub repaid_at: i64,
    pub bump: u8,
}
