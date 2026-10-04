//! The Tessera score. Pure integer maths over public account state, so anyone
//! can recompute any wallet's score and get the same number the program did.
//! `packages/sdk/src/score.ts` mirrors this file line for line.
//!
//!   score    = 1000 x Evidence x Rating x Behaviour
//!   Evidence = 0.45 History + 0.30 Tenure + 0.25 Diversity
//!
//! Evidence says how much is known about a wallet; Rating and Behaviour say
//! whether what is known is good. They multiply, so a long history cannot
//! paper over bad reviews or lost disputes.

use crate::state::*;

/// Share of a settled order that counts as evidence, by the *counterparty's*
/// tier (percent). Trading with wallets nobody knows proves little.
pub const TIER_WEIGHT: [u64; 4] = [10, 40, 80, 100];

pub const W_HISTORY: u64 = 450;
pub const W_TENURE: u64 = 300;
pub const W_DIVERSITY: u64 = 250;

/// Calendar age counts toward Tenure only up to this multiple of the periods
/// the wallet was actually active in. A wallet left to age earns nothing.
pub const AGE_PER_ACTIVE: u64 = 3;

/// Bayesian prior: every wallet starts as if rated 3.0 stars.
pub const PRIOR_MILLI_STARS: u128 = 3_000;
/// 1.5 stars maps to a Rating of 0, 4.5 stars and above to 1.
pub const RATING_FLOOR_MILLI: u128 = 1_500;
pub const RATING_SPAN_MILLI: u128 = 3_000;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Evaluation {
    /// Each component is in thousandths (0..=1000).
    pub history: u16,
    pub tenure: u16,
    pub diversity: u16,
    pub evidence: u16,
    pub rating: u16,
    /// 0..=10000 (bps).
    pub behaviour: u16,
    pub score: u16,
    pub tier: u8,
}

/// Floor of the square root, by Newton's method from an upper bound.
pub fn isqrt(n: u128) -> u128 {
    if n < 2 {
        return n;
    }
    let bits = 128 - n.leading_zeros();
    let mut x: u128 = 1u128 << ((bits + 1) / 2);
    loop {
        let y = (x + n / x) / 2;
        if y >= x {
            return x;
        }
        x = y;
    }
}

pub fn period_of(now: i64, p: &Params) -> u64 {
    (now.max(0) as u64) / (p.period_secs.max(1) as u64)
}

/// The penalty still standing at `now`: it decays every period.
pub fn current_penalty(a: &Agent, p: &Params, now: i64) -> u16 {
    let elapsed = period_of(now, p).saturating_sub(a.penalty_period);
    let decay = elapsed.saturating_mul(p.penalty_decay_bps as u64);
    (a.penalty_bps as u64).saturating_sub(decay) as u16
}

pub fn evaluate(a: &Agent, p: &Params, now: i64) -> Evaluation {
    // History: square root of credit, so the first dollars of proven volume
    // matter most and a whale cannot buy the top with size alone.
    let history = if p.credit_full == 0 {
        1000
    } else {
        isqrt((a.credit as u128) * 1_000_000 / (p.credit_full as u128)).min(1000) as u64
    };

    // Tenure: periods since registration, but never more than three per
    // period the wallet actually settled an order in.
    let age_periods = ((now - a.registered_at).max(0) as u64) / (p.period_secs.max(1) as u64);
    let effective = age_periods.min((a.active_periods as u64).saturating_mul(AGE_PER_ACTIVE));
    let tenure = if p.tenure_full == 0 {
        1000
    } else {
        (effective.saturating_mul(1000) / p.tenure_full as u64).min(1000)
    };

    // Diversity: counterparties, each weighted by the best tier it held when
    // it traded with this wallet.
    let diversity = if p.diversity_full == 0 {
        1000
    } else {
        ((a.counterparty_points as u64) * 1000 / p.diversity_full as u64).min(1000)
    };

    let evidence = (W_HISTORY * history + W_TENURE * tenure + W_DIVERSITY * diversity) / 1000;

    // Rating: volume-weighted stars shrunk toward a 3-star prior.
    let prior = p.review_prior as u128;
    let denom = prior + a.rating_weight as u128;
    let avg_milli = if denom == 0 {
        PRIOR_MILLI_STARS
    } else {
        (prior * PRIOR_MILLI_STARS + a.rating_sum.saturating_mul(1000)) / denom
    };
    let rating =
        (avg_milli.saturating_sub(RATING_FLOOR_MILLI) * 1000 / RATING_SPAN_MILLI).min(1000) as u64;

    let behaviour = BPS.saturating_sub(current_penalty(a, p, now) as u64);

    let score = evidence * rating * behaviour / (1000 * BPS);

    // A tier needs the score and the time. Trusted also needs a clean record:
    // while any penalty is still standing, a wallet cannot settle instantly.
    let mut tier = 0u8;
    for i in 0..3 {
        let clean = i < 2 || behaviour == BPS;
        if score >= p.tier_score[i] as u64 && a.active_periods >= p.tier_periods[i] as u32 && clean {
            tier = (i + 1) as u8;
        } else {
            break;
        }
    }

    Evaluation {
        history: history as u16,
        tenure: tenure as u16,
        diversity: diversity as u16,
        evidence: evidence as u16,
        rating: rating as u16,
        behaviour: behaviour as u16,
        score: score as u16,
        tier,
    }
}

/// Bring the cached score, tier and penalty up to date.
pub fn refresh(a: &mut Agent, p: &Params, now: i64) {
    a.penalty_bps = current_penalty(a, p, now);
    a.penalty_period = period_of(now, p);
    let e = evaluate(a, p, now);
    a.score = e.score;
    a.tier = e.tier;
    a.score_updated_at = now;
}

pub fn add_penalty(a: &mut Agent, p: &Params, now: i64, bps: u16) {
    let standing = current_penalty(a, p, now) as u64;
    a.penalty_bps = standing.saturating_add(bps as u64).min(BPS) as u16;
    a.penalty_period = period_of(now, p);
}

/// Count this period as active, once.
pub fn touch_activity(a: &mut Agent, p: &Params, now: i64) {
    let period = period_of(now, p);
    if a.active_periods == 0 || period > a.last_active_period {
        a.active_periods = a.active_periods.saturating_add(1);
        a.last_active_period = period;
    }
}

/// Instant-settled volume a merchant may carry that buyers have not accepted
/// yet: a small base plus a share of the protocol fees it has already paid.
/// Fees are sunk, so an exit scam can take at most what the scammer already
/// burned, plus the base.
pub fn instant_limit(a: &Agent, p: &Params) -> u64 {
    let from_fees = (a.fees_paid as u128) * (p.instant_fee_pct as u128) / 100;
    p.instant_base.saturating_add(from_fees.min(u64::MAX as u128) as u64)
}

pub fn tier_weight(tier: u8) -> u64 {
    TIER_WEIGHT[(tier as usize).min(3)]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isqrt_is_exact_floor() {
        for n in [0u128, 1, 2, 3, 4, 15, 16, 17, 999_999, 1_000_000, 1_000_001, u64::MAX as u128] {
            let r = isqrt(n);
            assert!(r * r <= n, "{n}");
            assert!((r + 1) * (r + 1) > n, "{n}");
        }
    }
}
