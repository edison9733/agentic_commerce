use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{close_account, transfer_checked, CloseAccount, Mint, Token, TokenAccount, TransferChecked},
};

pub mod errors;
pub mod events;
pub mod score;
pub mod state;

use errors::TesseraError;
use events::*;
use state::*;

declare_id!("TessSeP5QV5Bxpvm73iEefdsTjgtTEokKSx7jqFn1CQ");

/// Tessera: escrow for x402 payments, where an on-chain credit score decides
/// how long the money is held.
///
/// * Funding arrives as a plain SPL `TransferChecked` into ATA(mint, order).
///   That is exactly what the x402 `exact` scheme on Solana emits, so the
///   order account can be quoted as `payTo` and no custom scheme is needed.
///   The program never takes anyone's word that payment happened:
///   `confirm_funded` reads the vault balance.
/// * Each order snapshots both parties' tiers. The hold before the merchant
///   can take the money is the longer of the two tiers' holds. A wallet
///   nobody knows waits; two wallets with proven history settle at once.
/// * The score only moves on orders that actually settled, weighted by who
///   the counterparty was, capped per counterparty, and gated by time.
#[program]
pub mod tessera {
    use super::*;

    // ------------------------------------------------------------ governance

    pub fn initialize(ctx: Context<Initialize>, fee_bps: u16, params: Params) -> Result<()> {
        validate(fee_bps, &params)?;
        let c = &mut ctx.accounts.config;
        c.authority = ctx.accounts.authority.key();
        c.pending_authority = Pubkey::default();
        c.arbiter = ctx.accounts.arbiter.key();
        c.treasury = ctx.accounts.treasury.key();
        c.mint = ctx.accounts.mint.key();
        c.fee_bps = fee_bps;
        c.params = params;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    /// Orders already open keep the fee, arbiter and hold they were opened with.
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        fee_bps: u16,
        params: Params,
        arbiter: Pubkey,
        treasury: Pubkey,
    ) -> Result<()> {
        validate(fee_bps, &params)?;
        let c = &mut ctx.accounts.config;
        // Credit files store absolute period numbers; a new period length
        // would silently move every tenure and penalty already on record.
        require!(params.period_secs == c.params.period_secs, TesseraError::InvalidParams);
        require!(
            arbiter != Pubkey::default() && treasury != Pubkey::default(),
            TesseraError::InvalidParams
        );
        c.fee_bps = fee_bps;
        c.params = params;
        c.arbiter = arbiter;
        c.treasury = treasury;
        Ok(())
    }

    pub fn propose_authority(ctx: Context<UpdateConfig>, new_authority: Pubkey) -> Result<()> {
        ctx.accounts.config.pending_authority = new_authority;
        Ok(())
    }

    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.authority = c.pending_authority;
        c.pending_authority = Pubkey::default();
        Ok(())
    }

    // --------------------------------------------------------------- identity

    /// Create a blank credit file for any wallet. Anyone may pay for it: a
    /// buyer agent holding only USDC still gets a profile. The clock on a
    /// blank profile is harmless, because Tenure only counts active periods.
    pub fn ensure_agent(ctx: Context<EnsureAgent>) -> Result<()> {
        let a = &mut ctx.accounts.agent;
        if a.wallet == Pubkey::default() {
            a.wallet = ctx.accounts.wallet.key();
            a.registered_at = Clock::get()?.unix_timestamp;
            a.bump = ctx.bumps.agent;
        }
        Ok(())
    }

    /// The wallet names itself and points at its A2A agent card.
    pub fn set_profile(ctx: Context<SetProfile>, name: String, uri: String, kind: u8) -> Result<()> {
        require!(name.len() <= MAX_NAME && uri.len() <= MAX_URI, TesseraError::TextTooLong);
        require!(kind <= 2, TesseraError::InvalidParams);
        let a = &mut ctx.accounts.agent;
        a.name = name;
        a.uri = uri;
        a.kind = kind;
        Ok(())
    }

    /// Permissionless: bring a cached score up to date (tenure grows and
    /// penalties decay with time alone).
    pub fn refresh_agent(ctx: Context<RefreshAgent>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let params = ctx.accounts.config.params;
        score::refresh(&mut ctx.accounts.agent, &params, now);
        Ok(())
    }

    // ----------------------------------------------------------------- orders

    /// Open an escrow and price its risk. The merchant signs: an order in its
    /// name that it never quoted could otherwise be funded and left to expire,
    /// and the missed delivery would cost it score. The buyer does not sign:
    /// a merchant agent opens the order when it quotes a 402, so the buyer
    /// needs no SOL. A buyer's client must read this account back and check
    /// every field before paying.
    ///
    /// `min_hold_secs` lets a buyer ask for more protection than the tiers
    /// call for. It can lengthen the hold, never shorten it.
    pub fn open_order(
        ctx: Context<OpenOrder>,
        order_id: [u8; 32],
        amount: u64,
        request_hash: [u8; 32],
        min_hold_secs: u32,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let buyer = ctx.accounts.buyer.key();
        let merchant = ctx.accounts.merchant.key();
        require_keys_neq!(buyer, merchant, TesseraError::SelfDealing);
        let arbiter = ctx.accounts.config.arbiter;
        require!(arbiter != buyer && arbiter != merchant, TesseraError::ArbiterIsParty);
        require!(min_hold_secs <= MAX_HOLD_SECS, TesseraError::HoldTooLong);

        let params = ctx.accounts.config.params;
        require!(amount >= params.min_order, TesseraError::AmountTooSmall);

        score::refresh(&mut ctx.accounts.buyer_agent, &params, now);
        score::refresh(&mut ctx.accounts.merchant_agent, &params, now);

        let pair = &mut ctx.accounts.pair;
        if pair.buyer == Pubkey::default() {
            pair.buyer = buyer;
            pair.merchant = merchant;
            pair.bump = ctx.bumps.pair;
        }
        // Prior undisputed purchases from this merchant are evidence the
        // buyer is who it claims to be, so the buyer-side hold is waived --
        // unless the buyer still carries a penalty from anywhere. Only orders
        // the buyer reviewed count as history (see `grant_merchant_evidence`):
        // a merchant can fund orders in any buyer's name, and must not be able
        // to waive that buyer's protection by doing so.
        let pair_trusted = pair.orders >= params.pair_history_min as u32
            && pair.disputes == 0
            && pair.first_settled_at > 0
            && now.saturating_sub(pair.first_settled_at) >= params.pair_age_secs as i64
            && ctx.accounts.buyer_agent.penalty_bps == 0;

        let buyer_tier = ctx.accounts.buyer_agent.tier;
        let merchant_tier = ctx.accounts.merchant_agent.tier;
        let buyer_effective = if pair_trusted { 3 } else { buyer_tier };
        let hold_secs = params.hold_secs[merchant_tier as usize]
            .max(params.hold_secs[buyer_effective as usize])
            .max(min_hold_secs);

        let order = &mut ctx.accounts.order;
        order.order_id = order_id;
        order.buyer = buyer;
        order.merchant = merchant;
        order.payer = ctx.accounts.payer.key();
        order.mint = ctx.accounts.mint.key();
        order.arbiter = ctx.accounts.config.arbiter;
        order.amount = amount;
        order.fee_bps = ctx.accounts.config.fee_bps;
        order.state = OrderState::AwaitingPayment;
        order.buyer_tier = buyer_tier;
        order.merchant_tier = merchant_tier;
        order.buyer_score = ctx.accounts.buyer_agent.score;
        order.merchant_score = ctx.accounts.merchant_agent.score;
        order.pair_trusted = pair_trusted;
        order.hold_secs = hold_secs;
        order.request_hash = request_hash;
        order.created_at = now;
        order.bump = ctx.bumps.order;

        let config = &mut ctx.accounts.config;
        config.orders_opened = config.orders_opened.saturating_add(1);

        emit!(OrderOpened {
            order_id,
            order: ctx.accounts.order.key(),
            vault: ctx.accounts.vault.key(),
            buyer,
            merchant,
            amount,
            hold_secs,
            buyer_tier,
            merchant_tier,
            pair_trusted,
        });
        Ok(())
    }

    /// Permissionless on purpose: the only input it trusts is the vault balance.
    pub fn confirm_funded(ctx: Context<ConfirmFunded>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let vault_balance = ctx.accounts.vault.amount;
        let deliver_secs = ctx.accounts.config.params.deliver_secs;
        let unpaid_secs = ctx.accounts.config.params.unpaid_secs as i64;
        let order = &mut ctx.accounts.order;
        require!(order.state == OrderState::AwaitingPayment, TesseraError::InvalidState);
        // A quote the merchant may already have given up on cannot turn into
        // an order it owes a delivery for; a late payment is returned by
        // `cancel_unpaid`.
        require!(
            now <= order.created_at.saturating_add(unpaid_secs),
            TesseraError::PaymentWindowClosed
        );
        require!(vault_balance >= order.amount, TesseraError::VaultUnderfunded);
        order.state = OrderState::Funded;
        order.funded_at = now;
        order.deliver_by = now.saturating_add(deliver_secs as i64);
        emit!(OrderFunded { order_id: order.order_id, vault_balance });
        Ok(())
    }

    /// Merchant asserts delivery and commits to what was delivered. The hold
    /// starts now. An order whose tiers call for no hold settles instantly
    /// only while the merchant is inside its instant limit; past it, the
    /// order waits like an Established one.
    ///
    /// The limit counts every instant order the buyer has not accepted yet,
    /// so the most a merchant can take and run with is what it already paid
    /// in fees, plus a small base.
    pub fn deliver(ctx: Context<Deliver>, delivery_hash: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let params = ctx.accounts.config.params;
        let order = &mut ctx.accounts.order;
        require!(order.state == OrderState::Funded, TesseraError::InvalidState);
        require!(now <= order.deliver_by, TesseraError::DeliveryWindowClosed);

        let mut hold = order.hold_secs;
        let mut instant = false;
        if hold == 0 {
            // The tiers were snapshotted at open. A merchant that has lost
            // Trusted since then (a lost dispute, a missed delivery) does not
            // settle instantly on the strength of the old snapshot.
            let m = &mut ctx.accounts.merchant_agent;
            score::refresh(m, &params, now);
            let exposure = m.instant_exposure.saturating_add(order.amount);
            if m.tier == 3 && exposure <= score::instant_limit(m, &params) {
                m.instant_exposure = exposure;
                instant = true;
            } else {
                hold = params.hold_secs[2].max(params.hold_secs[m.tier as usize]);
            }
        }

        order.delivery_hash = delivery_hash;
        order.delivered_at = now;
        order.release_at = now.saturating_add(hold as i64);
        order.instant = instant;
        order.state = OrderState::Delivered;
        emit!(OrderDelivered { order_id: order.order_id, release_at: order.release_at, instant });
        Ok(())
    }

    /// Pay the merchant. Anyone may crank this once the hold has elapsed; the
    /// buyer may do it earlier to confirm receipt.
    pub fn release<'info>(mut ctx: Context<'info, Settle<'info>>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        {
            let order = &ctx.accounts.order;
            require!(order.state == OrderState::Delivered, TesseraError::InvalidState);
            if ctx.accounts.authority.key() != order.buyer {
                require!(now >= order.release_at, TesseraError::HoldNotElapsed);
            }
        }
        settle(&mut ctx, BPS as u16, OrderState::Released, false)
    }

    /// Give the buyer everything back. The merchant may do it any time before
    /// release. Anyone may do it once the merchant has missed the delivery
    /// deadline, and that costs the merchant score, whoever sends it.
    pub fn refund<'info>(mut ctx: Context<'info, Settle<'info>>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let signer = ctx.accounts.authority.key();
        let expired;
        {
            let order = &ctx.accounts.order;
            match order.state {
                OrderState::Funded => {
                    expired = now > order.deliver_by;
                    if !expired {
                        require_keys_eq!(signer, order.merchant, TesseraError::DeliveryWindowOpen);
                    }
                }
                OrderState::Delivered => {
                    require_keys_eq!(signer, order.merchant, TesseraError::Unauthorized);
                    expired = false;
                }
                _ => return err!(TesseraError::InvalidState),
            }
        }
        settle(&mut ctx, 0, OrderState::Refunded, expired)
    }

    /// The buyer contests a delivery while the hold is still running. An
    /// order that settled instantly has no hold and so cannot be disputed.
    pub fn open_dispute(ctx: Context<OpenDispute>, dispute_hash: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let order = &mut ctx.accounts.order;
        require!(order.state == OrderState::Delivered, TesseraError::InvalidState);
        require!(now < order.release_at, TesseraError::DisputeWindowClosed);
        order.state = OrderState::Disputed;
        order.dispute_hash = dispute_hash;

        let b = &mut ctx.accounts.buyer_agent.as_buyer;
        b.disputes = b.disputes.saturating_add(1);
        let m = &mut ctx.accounts.merchant_agent.as_merchant;
        m.disputes = m.disputes.saturating_add(1);
        let pair = &mut ctx.accounts.pair;
        pair.disputes = pair.disputes.saturating_add(1);

        emit!(DisputeOpened { order_id: order.order_id, pair_trusted: order.pair_trusted });
        Ok(())
    }

    /// The arbiter recorded when the order was opened splits the vault.
    /// Whoever gets less than half lost, and losing costs score.
    ///
    /// An arbiter that never answers must not lock the money forever: once
    /// the complaint period has passed since the hold would have ended,
    /// anyone may split the vault evenly. An even split penalises nobody.
    pub fn resolve_dispute<'info>(
        mut ctx: Context<'info, Settle<'info>>,
        merchant_bps: u16,
    ) -> Result<()> {
        require!(merchant_bps as u64 <= BPS, TesseraError::InvalidParams);
        {
            let order = &ctx.accounts.order;
            require!(order.state == OrderState::Disputed, TesseraError::InvalidState);
            if ctx.accounts.authority.key() != order.arbiter {
                let now = Clock::get()?.unix_timestamp;
                let complaint_secs = ctx.accounts.config.params.complaint_secs as i64;
                require!(now > order.release_at.saturating_add(complaint_secs), TesseraError::Unauthorized);
                require!(merchant_bps as u64 == BPS / 2, TesseraError::InvalidParams);
            }
        }
        settle(&mut ctx, merchant_bps, OrderState::Resolved, false)
    }

    /// Abandon an order that was never confirmed as paid. Either party may,
    /// any time; the rent payer may once the payment window has passed.
    /// Anything that reached the vault goes back to the buyer and the vault's
    /// rent to the payer.
    ///
    /// The order account itself stays, marked Cancelled, until `close_order`
    /// after the payment window. Closing it at once would let the merchant
    /// reopen the same id -- the same vault address -- for another buyer,
    /// while a payment the real buyer signed for the old order is still in
    /// flight. Anyone may run this again on a Cancelled order whose vault was
    /// recreated and paid into; that money goes to the buyer too.
    pub fn cancel_unpaid(ctx: Context<CancelUnpaid>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let signer = ctx.accounts.authority.key();
        let unpaid_secs = ctx.accounts.config.params.unpaid_secs as i64;
        let order = &ctx.accounts.order;
        let cancelled = order.state == OrderState::Cancelled;
        require!(cancelled || order.state == OrderState::AwaitingPayment, TesseraError::InvalidState);
        let is_party = signer == order.buyer || signer == order.merchant;
        let payer_may = signer == order.payer && now >= order.created_at.saturating_add(unpaid_secs);
        require!(cancelled || is_party || payer_may, TesseraError::Unauthorized);

        let order_id = order.order_id;
        let bump = order.bump;
        let seeds: &[&[u8]] = &[b"order", order_id.as_ref(), core::slice::from_ref(&bump)];
        let signer_seeds: &[&[&[u8]]] = &[seeds];
        let token_program = ctx.accounts.token_program.key();
        let balance = ctx.accounts.vault.amount;
        if balance > 0 {
            let buyer_token = ctx
                .accounts
                .buyer_token
                .as_ref()
                .ok_or(TesseraError::TokenOwnerMismatch)?;
            pay_leg(
                token_program,
                ctx.accounts.vault.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                buyer_token.to_account_info(),
                ctx.accounts.order.to_account_info(),
                signer_seeds,
                balance,
                ctx.accounts.mint.decimals,
            )?;
        }
        close_account(CpiContext::new_with_signer(
            token_program,
            CloseAccount {
                account: ctx.accounts.vault.to_account_info(),
                destination: ctx.accounts.payer.to_account_info(),
                authority: ctx.accounts.order.to_account_info(),
            },
            signer_seeds,
        ))?;
        if !cancelled {
            let order = &mut ctx.accounts.order;
            order.state = OrderState::Cancelled;
            order.settled_at = now;
            order.refunded = balance;
        }
        Ok(())
    }

    // ---------------------------------------------------------------- reviews

    /// Either party rates the other, once per order. The review is stored
    /// on-chain in full. Its weight is the volume that settled, scaled by the
    /// reviewer's own tier and capped per pair; a refund weighs nothing.
    pub fn submit_review(ctx: Context<SubmitReview>, rating: u8, text: String) -> Result<()> {
        require!((1..=5).contains(&rating), TesseraError::InvalidRating);
        require!(text.len() <= MAX_REVIEW, TesseraError::TextTooLong);
        let now = Clock::get()?.unix_timestamp;
        let params = ctx.accounts.config.params;
        let reviewer = ctx.accounts.reviewer.key();

        let order = &mut ctx.accounts.order;
        require!(
            matches!(
                order.state,
                OrderState::Released | OrderState::Refunded | OrderState::Resolved
            ),
            TesseraError::InvalidState
        );
        require!(
            now <= order.settled_at.saturating_add(params.review_secs as i64),
            TesseraError::ReviewWindowClosed
        );
        let reviewer_is_buyer = if reviewer == order.buyer {
            true
        } else if reviewer == order.merchant {
            false
        } else {
            return err!(TesseraError::NotAParty);
        };
        let subject = if reviewer_is_buyer { order.merchant } else { order.buyer };
        require_keys_eq!(ctx.accounts.subject.key(), subject, TesseraError::NotAParty);
        if reviewer_is_buyer {
            require!(!order.buyer_reviewed, TesseraError::AlreadyReviewed);
            order.buyer_reviewed = true;
        } else {
            require!(!order.merchant_reviewed, TesseraError::AlreadyReviewed);
            order.merchant_reviewed = true;
        }

        // An instant order left the buyer no window to dispute, so its rating
        // decides whether the merchant gets that slice of its limit back:
        // accepted, it is freed now; complained about, it stays locked.
        let mut freed = 0u64;
        if reviewer_is_buyer && order.instant && !order.seasoned && !order.complained {
            if rating >= 3 {
                order.seasoned = true;
                freed = order.amount;
            } else {
                order.complained = true;
            }
        }

        // A review only counts when the reviewer's side of the story is on
        // record. A merchant can open and fund an order in the name of any
        // buyer, so its review of that buyer weighs nothing until the buyer
        // has spoken for the order itself. And the side that lost a dispute
        // does not get a second, weighted say on it.
        let settled = order.paid_merchant.saturating_add(order.paid_fee);
        let counts = match order.state {
            OrderState::Released => reviewer_is_buyer || order.buyer_reviewed,
            OrderState::Resolved => {
                // The same rounding `settle` used, so an even split of an odd
                // amount leaves both sides heard.
                let half = mul_bps(order.amount, (BPS / 2) as u16)?;
                if reviewer_is_buyer {
                    settled <= half
                } else {
                    settled >= half
                }
            }
            // A refund settled nothing, so its review weighs 0 regardless.
            _ => true,
        };
        // Money moves without the buyer; reputation does not. A released order
        // becomes evidence for the merchant when the buyer reviews it.
        let merchant_evidence = reviewer_is_buyer && order.state == OrderState::Released;
        let buyer_tier = order.buyer_tier;

        let q = score::tier_weight(score::evaluate(&ctx.accounts.reviewer_agent, &params, now).tier);
        let pair = &mut ctx.accounts.pair;
        let spent = if reviewer_is_buyer {
            &mut pair.rated_by_buyer
        } else {
            &mut pair.rated_by_merchant
        };
        let cap = weighted(params.pair_cap, q);
        let weight = if counts {
            weighted(settled, q).min(cap.saturating_sub(*spent))
        } else {
            0
        };
        *spent = spent.saturating_add(weight);

        let s = &mut ctx.accounts.subject_agent;
        s.instant_exposure = s.instant_exposure.saturating_sub(freed);
        s.rating_sum = s.rating_sum.saturating_add(weight as u128 * rating as u128);
        s.rating_weight = s.rating_weight.saturating_add(weight);
        s.reviews_received = s.reviews_received.saturating_add(1);
        if merchant_evidence {
            grant_merchant_evidence(s, pair, &params, buyer_tier, settled, now);
        }
        score::refresh(s, &params, now);
        let subject_score = s.score;

        let review = &mut ctx.accounts.review;
        review.order = ctx.accounts.order.key();
        review.reviewer = reviewer;
        review.subject = subject;
        review.reviewer_is_buyer = reviewer_is_buyer;
        review.rating = rating;
        review.weight = weight;
        review.created_at = now;
        review.text = text;
        review.bump = ctx.bumps.review;

        emit!(ReviewSubmitted {
            order_id: ctx.accounts.order.order_id,
            reviewer,
            subject,
            rating,
            weight,
            subject_score,
        });
        Ok(())
    }

    /// Return a settled order's rent once its review window has passed. This
    /// is also where an instant order nobody objected to stops counting
    /// against the merchant's limit. One the buyer complained about never
    /// does: its rent comes back after the complaint period, but the amount
    /// stays locked for the life of the identity, so an exit scam cannot be
    /// repeated by waiting. A cancelled order closes once its payment window
    /// has passed.
    pub fn close_order(ctx: Context<CloseOrder>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let params = ctx.accounts.config.params;
        let order = &ctx.accounts.order;
        let wait = match order.state {
            OrderState::Released | OrderState::Refunded | OrderState::Resolved => {
                if order.complained {
                    params.complaint_secs
                } else {
                    params.review_secs
                }
            }
            OrderState::Cancelled => {
                require!(ctx.accounts.vault.lamports() == 0, TesseraError::VaultStillOpen);
                params.unpaid_secs
            }
            _ => return err!(TesseraError::InvalidState),
        };
        require!(now > order.settled_at.saturating_add(wait as i64), TesseraError::TooEarly);
        if order.instant && !order.seasoned && !order.complained {
            let m = &mut ctx.accounts.merchant_agent;
            m.instant_exposure = m.instant_exposure.saturating_sub(order.amount);
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn validate(fee_bps: u16, p: &Params) -> Result<()> {
    require!(fee_bps <= 1_000, TesseraError::InvalidParams);
    require!(p.period_secs > 0 && p.min_order > 0, TesseraError::InvalidParams);
    require!(
        p.tier_score[0] <= p.tier_score[1] && p.tier_score[1] <= p.tier_score[2] && p.tier_score[2] <= 1000,
        TesseraError::InvalidParams
    );
    require!(
        p.tier_periods[0] <= p.tier_periods[1] && p.tier_periods[1] <= p.tier_periods[2],
        TesseraError::InvalidParams
    );
    // A better tier never waits longer, and only Trusted may settle at once:
    // past the instant limit an order waits like an Established one, so that
    // hold must be real.
    let h = p.hold_secs;
    require!(h[0] >= h[1] && h[1] >= h[2] && h[2] >= h[3] && h[2] > 0, TesseraError::InvalidParams);
    require!(h[0] <= MAX_HOLD_SECS, TesseraError::InvalidParams);
    // Every window has to be open for some time, and a complaint has to
    // outlast the review window it is made in.
    require!(
        p.deliver_secs > 0 && p.unpaid_secs > 0 && p.review_secs > 0 && p.complaint_secs >= p.review_secs,
        TesseraError::InvalidParams
    );
    // A zero here would hand out full marks or switch the pair cap off.
    require!(
        p.credit_full > 0 && p.pair_cap > 0 && p.tenure_full > 0 && p.diversity_full > 0,
        TesseraError::InvalidParams
    );
    require!(p.instant_fee_pct <= 100, TesseraError::InvalidParams);
    require!(
        p.penalty_dispute_bps as u64 <= BPS
            && p.penalty_expired_bps as u64 <= BPS
            && p.penalty_decay_bps as u64 <= BPS,
        TesseraError::InvalidParams
    );
    Ok(())
}

fn mul_bps(value: u64, bps: u16) -> Result<u64> {
    Ok((value as u128)
        .checked_mul(bps as u128)
        .ok_or(TesseraError::MathOverflow)?
        .checked_div(BPS as u128)
        .ok_or(TesseraError::MathOverflow)? as u64)
}

/// `value` scaled by a tier weight given in percent.
fn weighted(value: u64, pct: u64) -> u64 {
    ((value as u128) * (pct as u128) / 100) as u64
}

/// Grant credit for `volume` settled with a counterparty whose tier weight is
/// `pct`, never letting one pair grant more than the cap at that weight.
fn grant_credit(credit: &mut u64, granted: &mut u64, volume: u64, pct: u64, pair_cap: u64) {
    let room = weighted(pair_cap, pct).saturating_sub(*granted);
    let earned = weighted(volume, pct).min(room);
    *credit = credit.saturating_add(earned);
    *granted = granted.saturating_add(earned);
}

/// A counterparty counts toward Diversity at the best tier weight it has
/// held while trading with this wallet.
fn grant_points(points: &mut u32, held: &mut u16, pct: u64) {
    let pct = pct as u16;
    if pct > *held {
        *points = points.saturating_add((pct - *held) as u32);
        *held = pct;
    }
}

/// What a released order earns the merchant: credit and Diversity weighted by
/// the buyer's tier at open, and an active period. Granted when the buyer
/// reviews the order, because a merchant can name any wallet as its buyer and
/// fund the order itself; only the buyer's own signature shows the buyer took
/// part.
fn grant_merchant_evidence(m: &mut Agent, pair: &mut Pair, params: &Params, buyer_tier: u8, gross: u64, now: i64) {
    // Pair history, which can waive the buyer-side hold in `open_order`, is
    // the buyer's own word too.
    pair.orders = pair.orders.saturating_add(1);
    if pair.first_settled_at == 0 {
        pair.first_settled_at = now;
    }
    let pct = score::tier_weight(buyer_tier);
    grant_credit(&mut m.credit, &mut pair.credit_to_merchant, gross, pct, params.pair_cap);
    if pair.volume >= params.pair_cap / 10 {
        grant_points(&mut m.counterparty_points, &mut pair.points_to_merchant, pct);
    }
    score::touch_activity(m, params, now);
}

#[allow(clippy::too_many_arguments)]
fn pay_leg<'info>(
    token_program: Pubkey,
    vault: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
    decimals: u8,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    transfer_checked(
        CpiContext::new_with_signer(
            token_program,
            TransferChecked { from: vault, mint, to, authority },
            signer_seeds,
        ),
        amount,
        decimals,
    )
}

/// Move the whole vault out and close it, then update both credit files.
/// `merchant_bps`: 10000 = release, 0 = refund, between = dispute split.
/// The merchant is owed at most the price; anything paid beyond it returns
/// to the buyer. The fee is charged only on what the merchant receives.
#[inline(never)]
fn settle<'info>(
    ctx: &mut Context<'info, Settle<'info>>,
    merchant_bps: u16,
    final_state: OrderState,
    expired: bool,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let vault_balance = ctx.accounts.vault.amount;

    let order_id = ctx.accounts.order.order_id;
    let bump = ctx.accounts.order.bump;
    let fee_bps = ctx.accounts.order.fee_bps;
    let amount = ctx.accounts.order.amount;
    let merchant_tier = ctx.accounts.order.merchant_tier;
    let instant = ctx.accounts.order.instant;
    let seasoned = ctx.accounts.order.seasoned;

    let principal = vault_balance.min(amount);
    let excess = vault_balance - principal;
    let merchant_gross = mul_bps(principal, merchant_bps)?;
    let fee = mul_bps(merchant_gross, fee_bps)?;
    let to_merchant = merchant_gross.checked_sub(fee).ok_or(TesseraError::MathOverflow)?;
    let to_buyer = principal
        .checked_sub(merchant_gross)
        .and_then(|v| v.checked_add(excess))
        .ok_or(TesseraError::MathOverflow)?;

    let seeds: &[&[u8]] = &[b"order", order_id.as_ref(), core::slice::from_ref(&bump)];
    let signer_seeds: &[&[&[u8]]] = &[seeds];
    let token_program = ctx.accounts.token_program.key();
    let decimals = ctx.accounts.mint.decimals;
    let vault = ctx.accounts.vault.to_account_info();
    let mint = ctx.accounts.mint.to_account_info();
    let authority = ctx.accounts.order.to_account_info();

    pay_leg(
        token_program,
        vault.clone(),
        mint.clone(),
        ctx.accounts.merchant_token.to_account_info(),
        authority.clone(),
        signer_seeds,
        to_merchant,
        decimals,
    )?;
    pay_leg(
        token_program,
        vault.clone(),
        mint.clone(),
        ctx.accounts.treasury_token.to_account_info(),
        authority.clone(),
        signer_seeds,
        fee,
        decimals,
    )?;
    pay_leg(
        token_program,
        vault.clone(),
        mint,
        ctx.accounts.buyer_token.to_account_info(),
        authority.clone(),
        signer_seeds,
        to_buyer,
        decimals,
    )?;
    close_account(CpiContext::new_with_signer(
        token_program,
        CloseAccount {
            account: vault,
            destination: ctx.accounts.payer.to_account_info(),
            authority,
        },
        signer_seeds,
    ))?;

    {
        let order = &mut ctx.accounts.order;
        order.state = final_state;
        order.settled_at = now;
        order.paid_merchant = to_merchant;
        order.paid_fee = fee;
        order.refunded = to_buyer;
        if final_state == OrderState::Refunded && instant {
            order.seasoned = true;
        }
    }

    // Book-keeping from here on is saturating: a statistic must never be able
    // to hold escrow hostage.
    let params = ctx.accounts.config.params;
    let accounts = &mut ctx.accounts;
    let m = &mut accounts.merchant_agent;
    let b = &mut accounts.buyer_agent;
    let pair = &mut accounts.pair;
    let config = &mut accounts.config;

    match final_state {
        OrderState::Released => {
            m.as_merchant.orders = m.as_merchant.orders.saturating_add(1);
            m.as_merchant.volume = m.as_merchant.volume.saturating_add(merchant_gross);
            b.as_buyer.orders = b.as_buyer.orders.saturating_add(1);
            b.as_buyer.volume = b.as_buyer.volume.saturating_add(merchant_gross);
            if instant {
                m.as_merchant.instant = m.as_merchant.instant.saturating_add(1);
                b.as_buyer.instant = b.as_buyer.instant.saturating_add(1);
            }
            m.fees_paid = m.fees_paid.saturating_add(fee);

            // Each side earns credit weighted by the *other* side's tier at
            // open. The buyer's is granted now: the merchant opened and
            // delivered the order, so it is on record. The merchant's waits for
            // the buyer's review (see `grant_merchant_evidence`), because the
            // buyer never signed anything to get here.
            let pct_for_buyer = score::tier_weight(merchant_tier);
            grant_credit(&mut b.credit, &mut pair.credit_to_buyer, merchant_gross, pct_for_buyer, params.pair_cap);

            if pair.last_settled_at == 0 {
                m.counterparties = m.counterparties.saturating_add(1);
                b.counterparties = b.counterparties.saturating_add(1);
            }
            pair.volume = pair.volume.saturating_add(merchant_gross);
            pair.last_settled_at = now;

            // A counterparty counts toward Diversity only once the pair has
            // moved a tenth of the pair cap, so dust cannot fake a network.
            if pair.volume >= params.pair_cap / 10 {
                grant_points(&mut b.counterparty_points, &mut pair.points_to_buyer, pct_for_buyer);
            }

            score::touch_activity(b, &params, now);

            config.orders_settled = config.orders_settled.saturating_add(1);
            config.volume_settled = config.volume_settled.saturating_add(merchant_gross);
            config.fees_collected = config.fees_collected.saturating_add(fee);
        }
        OrderState::Refunded => {
            m.as_merchant.refunds = m.as_merchant.refunds.saturating_add(1);
            b.as_buyer.refunds = b.as_buyer.refunds.saturating_add(1);
            // The buyer got everything back, so an instant order refunded
            // after delivery no longer counts against the instant limit.
            if instant && !seasoned {
                m.instant_exposure = m.instant_exposure.saturating_sub(amount);
            }
            if expired {
                m.as_merchant.expired = m.as_merchant.expired.saturating_add(1);
                score::add_penalty(m, &params, now, params.penalty_expired_bps);
            }
        }
        OrderState::Resolved => {
            // What reached the merchant is volume, but a disputed order earns
            // neither side any credit.
            m.as_merchant.volume = m.as_merchant.volume.saturating_add(merchant_gross);
            b.as_buyer.volume = b.as_buyer.volume.saturating_add(merchant_gross);
            m.fees_paid = m.fees_paid.saturating_add(fee);
            let half = (BPS / 2) as u16;
            if merchant_bps < half {
                m.as_merchant.disputes_lost = m.as_merchant.disputes_lost.saturating_add(1);
                score::add_penalty(m, &params, now, params.penalty_dispute_bps);
            } else if merchant_bps > half {
                b.as_buyer.disputes_lost = b.as_buyer.disputes_lost.saturating_add(1);
                score::add_penalty(b, &params, now, params.penalty_dispute_bps);
            }
            config.volume_settled = config.volume_settled.saturating_add(merchant_gross);
            config.fees_collected = config.fees_collected.saturating_add(fee);
        }
        _ => {}
    }

    score::refresh(m, &params, now);
    score::refresh(b, &params, now);

    emit!(OrderSettled {
        order_id,
        state: final_state as u8,
        to_merchant,
        to_buyer,
        fee,
        buyer_score: b.score,
        merchant_score: m.score,
        buyer_tier: b.tier,
        merchant_tier: m.tier,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// Account contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: Box<Account<'info, Mint>>,
    /// CHECK: the wallet that resolves disputes.
    pub arbiter: UncheckedAccount<'info>,
    /// CHECK: fee recipient wallet; only its token account is ever touched.
    pub treasury: UncheckedAccount<'info>,
    /// Only the program's upgrade authority may create the singleton, so the
    /// first caller after a deployment cannot take it.
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key()) @ TesseraError::Unauthorized
    )]
    pub program: Program<'info, crate::program::Tessera>,
    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key()) @ TesseraError::Unauthorized
    )]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = authority @ TesseraError::Unauthorized)]
    pub config: Box<Account<'info, Config>>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        constraint = config.pending_authority == new_authority.key() @ TesseraError::Unauthorized
    )]
    pub config: Box<Account<'info, Config>>,
    pub new_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct EnsureAgent<'info> {
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Agent::INIT_SPACE,
        seeds = [b"agent", wallet.key().as_ref()],
        bump
    )]
    pub agent: Box<Account<'info, Agent>>,
    /// CHECK: any wallet may be given a blank profile.
    pub wallet: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetProfile<'info> {
    #[account(mut, seeds = [b"agent", wallet.key().as_ref()], bump = agent.bump)]
    pub agent: Box<Account<'info, Agent>>,
    pub wallet: Signer<'info>,
}

#[derive(Accounts)]
pub struct RefreshAgent<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"agent", agent.wallet.as_ref()], bump = agent.bump)]
    pub agent: Box<Account<'info, Agent>>,
}

#[derive(Accounts)]
#[instruction(order_id: [u8; 32])]
pub struct OpenOrder<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        init,
        payer = payer,
        space = 8 + Order::INIT_SPACE,
        seeds = [b"order", order_id.as_ref()],
        bump
    )]
    pub order: Box<Account<'info, Order>>,
    /// The escrow vault. Its owner, the order account, is what gets quoted as
    /// the x402 `payTo`, so a buyer can derive and check it from the order id.
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = mint,
        associated_token::authority = order
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(address = config.mint @ TesseraError::MintMismatch)]
    pub mint: Box<Account<'info, Mint>>,
    /// CHECK: recorded as the buyer; does not sign.
    pub buyer: UncheckedAccount<'info>,
    /// The merchant agrees to every order opened in its name.
    pub merchant: Signer<'info>,
    #[account(mut, seeds = [b"agent", buyer.key().as_ref()], bump = buyer_agent.bump)]
    pub buyer_agent: Box<Account<'info, Agent>>,
    #[account(mut, seeds = [b"agent", merchant.key().as_ref()], bump = merchant_agent.bump)]
    pub merchant_agent: Box<Account<'info, Agent>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Pair::INIT_SPACE,
        seeds = [b"pair", buyer.key().as_ref(), merchant.key().as_ref()],
        bump
    )]
    pub pair: Box<Account<'info, Pair>>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ConfirmFunded<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"order", order.order_id.as_ref()], bump = order.bump)]
    pub order: Box<Account<'info, Order>>,
    #[account(associated_token::mint = mint, associated_token::authority = order)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(address = order.mint @ TesseraError::MintMismatch)]
    pub mint: Box<Account<'info, Mint>>,
}

#[derive(Accounts)]
pub struct Deliver<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        seeds = [b"order", order.order_id.as_ref()],
        bump = order.bump,
        has_one = merchant @ TesseraError::NotAParty
    )]
    pub order: Box<Account<'info, Order>>,
    #[account(mut, seeds = [b"agent", merchant.key().as_ref()], bump = merchant_agent.bump)]
    pub merchant_agent: Box<Account<'info, Agent>>,
    pub merchant: Signer<'info>,
}

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"order", order.order_id.as_ref()], bump = order.bump)]
    pub order: Box<Account<'info, Order>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = order)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(address = order.mint @ TesseraError::MintMismatch)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        dup,
        constraint = merchant_token.owner == order.merchant @ TesseraError::TokenOwnerMismatch,
        constraint = merchant_token.mint == order.mint @ TesseraError::MintMismatch
    )]
    pub merchant_token: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        dup,
        constraint = buyer_token.owner == order.buyer @ TesseraError::TokenOwnerMismatch,
        constraint = buyer_token.mint == order.mint @ TesseraError::MintMismatch
    )]
    pub buyer_token: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        dup,
        constraint = treasury_token.owner == config.treasury @ TesseraError::TokenOwnerMismatch,
        constraint = treasury_token.mint == order.mint @ TesseraError::MintMismatch
    )]
    pub treasury_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [b"agent", order.merchant.as_ref()], bump = merchant_agent.bump)]
    pub merchant_agent: Box<Account<'info, Agent>>,
    #[account(mut, seeds = [b"agent", order.buyer.as_ref()], bump = buyer_agent.bump)]
    pub buyer_agent: Box<Account<'info, Agent>>,
    #[account(
        mut,
        seeds = [b"pair", order.buyer.as_ref(), order.merchant.as_ref()],
        bump = pair.bump
    )]
    pub pair: Box<Account<'info, Pair>>,
    /// CHECK: receives the vault's rent; pinned to the order's recorded payer.
    #[account(mut, address = order.payer @ TesseraError::Unauthorized)]
    pub payer: UncheckedAccount<'info>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct OpenDispute<'info> {
    #[account(
        mut,
        seeds = [b"order", order.order_id.as_ref()],
        bump = order.bump,
        has_one = buyer @ TesseraError::NotAParty
    )]
    pub order: Box<Account<'info, Order>>,
    #[account(mut, seeds = [b"agent", order.buyer.as_ref()], bump = buyer_agent.bump)]
    pub buyer_agent: Box<Account<'info, Agent>>,
    #[account(mut, seeds = [b"agent", order.merchant.as_ref()], bump = merchant_agent.bump)]
    pub merchant_agent: Box<Account<'info, Agent>>,
    #[account(
        mut,
        seeds = [b"pair", order.buyer.as_ref(), order.merchant.as_ref()],
        bump = pair.bump
    )]
    pub pair: Box<Account<'info, Pair>>,
    pub buyer: Signer<'info>,
}

#[derive(Accounts)]
pub struct CancelUnpaid<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"order", order.order_id.as_ref()], bump = order.bump)]
    pub order: Box<Account<'info, Order>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = order)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(address = order.mint @ TesseraError::MintMismatch)]
    pub mint: Box<Account<'info, Mint>>,
    /// Only needed if something reached the vault.
    #[account(
        mut,
        constraint = buyer_token.owner == order.buyer @ TesseraError::TokenOwnerMismatch,
        constraint = buyer_token.mint == order.mint @ TesseraError::MintMismatch
    )]
    pub buyer_token: Option<Box<Account<'info, TokenAccount>>>,
    /// CHECK: receives the vault's rent; pinned to the recorded payer.
    #[account(mut, address = order.payer @ TesseraError::Unauthorized)]
    pub payer: UncheckedAccount<'info>,
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(rating: u8, text: String)]
pub struct SubmitReview<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [b"order", order.order_id.as_ref()], bump = order.bump)]
    pub order: Box<Account<'info, Order>>,
    // Sized to the text actually written, so a short review costs less rent.
    #[account(
        init,
        payer = payer,
        space = 8 + Review::INIT_SPACE - MAX_REVIEW + text.len().min(MAX_REVIEW),
        seeds = [b"review", order.key().as_ref(), reviewer.key().as_ref()],
        bump
    )]
    pub review: Box<Account<'info, Review>>,
    /// CHECK: the counterparty being rated; the handler proves it is the
    /// other party to this order before any score moves.
    pub subject: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"agent", subject.key().as_ref()], bump = subject_agent.bump)]
    pub subject_agent: Box<Account<'info, Agent>>,
    #[account(seeds = [b"agent", reviewer.key().as_ref()], bump = reviewer_agent.bump)]
    pub reviewer_agent: Box<Account<'info, Agent>>,
    #[account(
        mut,
        seeds = [b"pair", order.buyer.as_ref(), order.merchant.as_ref()],
        bump = pair.bump
    )]
    pub pair: Box<Account<'info, Pair>>,
    pub reviewer: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseOrder<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(
        mut,
        close = payer,
        seeds = [b"order", order.order_id.as_ref()],
        bump = order.bump,
        has_one = payer @ TesseraError::Unauthorized
    )]
    pub order: Box<Account<'info, Order>>,
    #[account(mut, seeds = [b"agent", order.merchant.as_ref()], bump = merchant_agent.bump)]
    pub merchant_agent: Box<Account<'info, Agent>>,
    /// CHECK: the order's vault. A cancelled order is only closed once its vault is gone, so a payment
    /// that reached a cancelled order late is refunded first and its id cannot be reused with the money in it.
    #[account(address = anchor_spl::associated_token::get_associated_token_address(&order.key(), &order.mint))]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: receives the order account's rent; pinned by `has_one`.
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,
}
