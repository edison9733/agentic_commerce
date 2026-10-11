//! The credit limit. Pure integer maths over public accounts, so anyone can
//! recompute any wallet's limit. `packages/sdk/src/paylater/limit.ts` mirrors it.
//!
//!   limit = tier_limit[tier] x score / 1000 x (1 + boost)
//!   boost = min(repaid_on_time x step, max_boost)
//!
//! The tier and score are the wallet's live Tessera score, recomputed from its
//! credit file, so a limit is earned the same way a short hold is: by settled
//! trade with real counterparties over time. A brand-new wallet (tier New) gets
//! nothing, and any default freezes the line at 0.

use crate::state::*;

pub fn limit(line: &CreditLine, p: &LineParams, tier: u8, score: u16) -> u64 {
    if line.defaults > 0 {
        return 0;
    }
    let base = (p.tier_limit[(tier as usize).min(3)] as u128) * (score.min(1000) as u128) / 1000;
    let boost = ((line.repaid_on_time as u128) * (p.step_bps as u128)).min(p.max_boost_bps as u128);
    (base * (BPS as u128 + boost) / BPS as u128).min(u64::MAX as u128) as u64
}

pub fn available(line: &CreditLine, p: &LineParams, tier: u8, score: u16) -> u64 {
    limit(line, p, tier, score).saturating_sub(line.outstanding)
}

pub fn fee_of(amount: u64, p: &LineParams) -> u64 {
    ((amount as u128) * (p.fee_bps as u128) / BPS as u128) as u64
}

pub fn valid(p: &LineParams) -> bool {
    p.tier_limit[0] == 0
        && p.tier_limit.windows(2).all(|w| w[0] <= w[1])
        && p.fee_bps <= MAX_FEE_BPS
        && p.term_secs > 0
        && p.term_secs <= MAX_TERM_SECS
        && p.grace_secs <= MAX_TERM_SECS
        && p.max_boost_bps as u64 <= 4 * BPS
        && p.min_merchant_tier <= 3
        && p.min_loan > 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params() -> LineParams {
        LineParams {
            tier_limit: [0, 1_000, 5_000, 20_000],
            step_bps: 1_000,
            max_boost_bps: 10_000,
            term_secs: 60,
            grace_secs: 10,
            fee_bps: 200,
            min_merchant_tier: 1,
            min_loan: 1,
        }
    }

    fn line() -> CreditLine {
        CreditLine {
            wallet: Default::default(),
            opened_at: 0,
            outstanding: 0,
            open_loans: 0,
            loans: 0,
            borrowed: 0,
            repaid: 0,
            repaid_on_time: 0,
            repaid_late: 0,
            defaults: 0,
            last_loan_at: 0,
            bump: 0,
        }
    }

    #[test]
    fn new_wallets_get_nothing() {
        assert_eq!(limit(&line(), &params(), 0, 1000), 0);
    }

    #[test]
    fn limit_scales_with_score_and_on_time_repayments() {
        let p = params();
        let mut l = line();
        assert_eq!(limit(&l, &p, 3, 500), 10_000);
        l.repaid_on_time = 3;
        assert_eq!(limit(&l, &p, 3, 500), 13_000);
        l.repaid_on_time = 50;
        assert_eq!(limit(&l, &p, 3, 500), 20_000, "boost is capped");
        l.outstanding = 15_000;
        assert_eq!(available(&l, &p, 3, 500), 5_000);
    }

    #[test]
    fn a_default_freezes_the_line() {
        let mut l = line();
        l.repaid_on_time = 9;
        l.defaults = 1;
        assert_eq!(limit(&l, &params(), 3, 1000), 0);
    }

    #[test]
    fn params_are_checked() {
        assert!(valid(&params()));
        assert!(!valid(&LineParams { tier_limit: [1, 1, 1, 1], ..params() }));
        assert!(!valid(&LineParams { fee_bps: 1_001, ..params() }));
        assert!(!valid(&LineParams { term_secs: 0, ..params() }));
    }
}
