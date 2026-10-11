use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{transfer_checked, Mint, Token, TokenAccount, TransferChecked},
};
use tessera::score::{evaluate, Evaluation};

pub mod credit;
pub mod errors;
pub mod state;

use errors::PayLaterError;
use state::*;

declare_id!("7uM4V7H5xH6PGPEvqzw2CJ7s3EY3Qs95RUcV9kPJELDU");

/// Tessera pay-later: buy now, pay later for AI agents.
///
/// * A pool pays the merchant at once (minus a small fee) and the buyer repays
///   the full price by the due date, with no interest.
/// * The buyer's credit limit comes from its live Tessera score, read straight
///   from the escrow program's credit file. A wallet with no settled history
///   gets no credit; repaying on time raises the limit; a default freezes it.
/// * Everything is public: anyone can recompute a limit, and anyone can mark an
///   unpaid loan in default once its grace period has passed.
///
/// The escrow program is untouched: this program only reads its accounts.
#[program]
pub mod tessera_paylater {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, params: LineParams) -> Result<()> {
        require!(credit::valid(&params), PayLaterError::InvalidParams);
        let cfg = read_config(&ctx.accounts.tessera_config)?;
        require_keys_eq!(cfg.mint, ctx.accounts.mint.key(), PayLaterError::MintMismatch);
        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.mint = ctx.accounts.mint.key();
        pool.params = params;
        pool.bump = ctx.bumps.pool;
        Ok(())
    }

    pub fn update_params(ctx: Context<UpdateParams>, params: LineParams) -> Result<()> {
        require!(credit::valid(&params), PayLaterError::InvalidParams);
        ctx.accounts.pool.params = params;
        Ok(())
    }

    /// Add liquidity. Anyone may fund the pool.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let a = &ctx.accounts;
        transfer_checked(
            CpiContext::new(
                a.token_program.key(),
                TransferChecked {
                    from: a.funder_token.to_account_info(),
                    mint: a.mint.to_account_info(),
                    to: a.vault.to_account_info(),
                    authority: a.funder.to_account_info(),
                },
            ),
            amount,
            a.mint.decimals,
        )?;
        let pool = &mut ctx.accounts.pool;
        pool.deposited = pool.deposited.checked_add(amount).ok_or(PayLaterError::Overflow)?;
        Ok(())
    }

    /// Take liquidity out. Money already lent is not in the vault, so this can
    /// never touch what buyers owe.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let a = &ctx.accounts;
        pay_from_pool(&a.pool, &a.token_program, &a.vault, &a.mint, a.to.to_account_info(), amount)?;
        let pool = &mut ctx.accounts.pool;
        pool.withdrawn = pool.withdrawn.checked_add(amount).ok_or(PayLaterError::Overflow)?;
        Ok(())
    }

    /// Buy now: the pool pays the merchant, the buyer owes the full price by the
    /// due date. Only the buyer can spend its own credit.
    pub fn buy_now(ctx: Context<BuyNow>, loan_id: [u8; 32], amount: u64, request_hash: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let a = &ctx.accounts;
        let p = a.pool.params;
        require_keys_neq!(a.buyer.key(), a.merchant.key(), PayLaterError::SelfDealing);
        require!(amount >= p.min_loan, PayLaterError::AmountTooSmall);

        let cfg = read_config(&a.tessera_config)?;
        let buyer = score_of(&a.buyer_agent, &cfg.params, now)?;
        let merchant = score_of(&a.merchant_agent, &cfg.params, now)?;
        require!(merchant.tier >= p.min_merchant_tier, PayLaterError::MerchantTierTooLow);

        let line = &a.line;
        let limit = credit::limit(line, &p, buyer.tier, buyer.score);
        require!(amount <= limit.saturating_sub(line.outstanding), PayLaterError::CreditLimitExceeded);

        let fee = credit::fee_of(amount, &p);
        let to_merchant = amount - fee;
        require!(a.vault.amount >= to_merchant, PayLaterError::PoolEmpty);
        pay_from_pool(&a.pool, &a.token_program, &a.vault, &a.mint, a.merchant_token.to_account_info(), to_merchant)?;

        let line = &mut ctx.accounts.line;
        if line.wallet == Pubkey::default() {
            line.wallet = ctx.accounts.buyer.key();
            line.opened_at = now;
            line.bump = ctx.bumps.line;
        }
        line.outstanding = line.outstanding.checked_add(amount).ok_or(PayLaterError::Overflow)?;
        line.open_loans += 1;
        line.loans += 1;
        line.borrowed = line.borrowed.checked_add(amount).ok_or(PayLaterError::Overflow)?;
        line.last_loan_at = now;

        let pool = &mut ctx.accounts.pool;
        pool.outstanding = pool.outstanding.checked_add(amount).ok_or(PayLaterError::Overflow)?;
        pool.lent = pool.lent.checked_add(amount).ok_or(PayLaterError::Overflow)?;
        pool.fees_earned = pool.fees_earned.checked_add(fee).ok_or(PayLaterError::Overflow)?;
        pool.loans_opened += 1;

        let due_at = now + p.term_secs as i64;
        let loan = &mut ctx.accounts.loan;
        loan.loan_id = loan_id;
        loan.buyer = ctx.accounts.buyer.key();
        loan.merchant = ctx.accounts.merchant.key();
        loan.amount = amount;
        loan.fee = fee;
        loan.request_hash = request_hash;
        loan.state = LoanState::Open;
        loan.buyer_tier = buyer.tier;
        loan.buyer_score = buyer.score;
        loan.merchant_tier = merchant.tier;
        loan.limit_at_open = limit;
        loan.created_at = now;
        loan.due_at = due_at;
        loan.default_after = due_at + p.grace_secs as i64;
        loan.bump = ctx.bumps.loan;

        emit!(LoanOpened {
            loan: loan.key(),
            buyer: loan.buyer,
            merchant: loan.merchant,
            amount,
            fee,
            due_at,
            limit,
        });
        Ok(())
    }

    /// Pay the full price back. Anyone may pay a buyer's loan for it. Repaying
    /// on time raises the buyer's limit; repaying late or after a default
    /// clears the debt but earns nothing.
    pub fn repay(ctx: Context<Repay>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let a = &ctx.accounts;
        let amount = a.loan.amount;
        transfer_checked(
            CpiContext::new(
                a.token_program.key(),
                TransferChecked {
                    from: a.payer_token.to_account_info(),
                    mint: a.mint.to_account_info(),
                    to: a.vault.to_account_info(),
                    authority: a.payer.to_account_info(),
                },
            ),
            amount,
            a.mint.decimals,
        )?;

        let loan = &mut ctx.accounts.loan;
        let line = &mut ctx.accounts.line;
        let on_time = match loan.state {
            LoanState::Open => now <= loan.due_at,
            LoanState::Defaulted => false,
            _ => return err!(PayLaterError::InvalidState),
        };
        if loan.state == LoanState::Open {
            line.open_loans -= 1;
        }
        loan.state = if on_time { LoanState::RepaidOnTime } else { LoanState::RepaidLate };
        loan.repaid_at = now;
        if on_time {
            line.repaid_on_time += 1;
        } else {
            line.repaid_late += 1;
        }
        line.outstanding -= amount;
        line.repaid = line.repaid.checked_add(amount).ok_or(PayLaterError::Overflow)?;

        let pool = &mut ctx.accounts.pool;
        pool.outstanding -= amount;
        pool.repaid = pool.repaid.checked_add(amount).ok_or(PayLaterError::Overflow)?;

        emit!(LoanRepaid { loan: loan.key(), buyer: loan.buyer, amount, on_time });
        Ok(())
    }

    /// Anyone may mark a loan in default once its grace period has passed. The
    /// buyer's line is frozen for good; the debt stays and can still be repaid.
    pub fn mark_default(ctx: Context<MarkDefault>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let loan = &mut ctx.accounts.loan;
        require!(loan.state == LoanState::Open, PayLaterError::InvalidState);
        require!(now > loan.default_after, PayLaterError::NotOverdue);
        loan.state = LoanState::Defaulted;

        let line = &mut ctx.accounts.line;
        line.open_loans -= 1;
        line.defaults += 1;
        let pool = &mut ctx.accounts.pool;
        pool.defaulted = pool.defaulted.checked_add(loan.amount).ok_or(PayLaterError::Overflow)?;

        emit!(LoanDefaulted { loan: loan.key(), buyer: loan.buyer, amount: loan.amount });
        Ok(())
    }

    /// Return a repaid loan's rent to the buyer. The credit line keeps the record.
    pub fn close_loan(ctx: Context<CloseLoan>) -> Result<()> {
        let s = ctx.accounts.loan.state;
        require!(
            s == LoanState::RepaidOnTime || s == LoanState::RepaidLate,
            PayLaterError::InvalidState
        );
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn read_config(acc: &UncheckedAccount) -> Result<tessera::state::Config> {
    let data = acc.try_borrow_data()?;
    tessera::state::Config::try_deserialize(&mut &data[..]).map_err(|_| error!(PayLaterError::NotACreditFile))
}

/// The wallet's live Tessera score, recomputed from its credit file exactly as
/// the escrow program does, so a stale cached score is never used.
fn score_of(acc: &UncheckedAccount, params: &tessera::state::Params, now: i64) -> Result<Evaluation> {
    let data = acc.try_borrow_data()?;
    let agent =
        tessera::state::Agent::try_deserialize(&mut &data[..]).map_err(|_| error!(PayLaterError::NotACreditFile))?;
    Ok(evaluate(&agent, params, now))
}

fn pay_from_pool<'info>(
    pool: &Account<'info, Pool>,
    token_program: &Program<'info, Token>,
    vault: &Account<'info, TokenAccount>,
    mint: &Account<'info, Mint>,
    to: AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let seeds: &[&[u8]] = &[b"pool", core::slice::from_ref(&pool.bump)];
    transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to,
                authority: pool.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct LoanOpened {
    pub loan: Pubkey,
    pub buyer: Pubkey,
    pub merchant: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub due_at: i64,
    pub limit: u64,
}

#[event]
pub struct LoanRepaid {
    pub loan: Pubkey,
    pub buyer: Pubkey,
    pub amount: u64,
    pub on_time: bool,
}

#[event]
pub struct LoanDefaulted {
    pub loan: Pubkey,
    pub buyer: Pubkey,
    pub amount: u64,
}

// ---------------------------------------------------------------------------
// Account contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + Pool::INIT_SPACE, seeds = [b"pool"], bump)]
    pub pool: Box<Account<'info, Pool>>,
    /// `init_if_needed`: anyone can create ATA(mint, pool) before the pool
    /// exists, and a plain `init` would then fail forever. Anchor still checks
    /// the mint, the owner and that it is the associated account.
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = pool
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: Box<Account<'info, Mint>>,
    /// CHECK: the escrow program's config; owner and address are checked here,
    /// the contents by `read_config`.
    #[account(owner = tessera::ID, seeds = [b"config"], bump, seeds::program = tessera::ID)]
    pub tessera_config: UncheckedAccount<'info>,
    /// Only this program's upgrade authority may create the pool, so the first
    /// caller after a deployment cannot take it.
    #[account(
        constraint = program.programdata_address()? == Some(program_data.key()) @ PayLaterError::Unauthorized
    )]
    pub program: Program<'info, crate::program::TesseraPaylater>,
    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key()) @ PayLaterError::Unauthorized
    )]
    pub program_data: Account<'info, ProgramData>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateParams<'info> {
    #[account(mut, seeds = [b"pool"], bump = pool.bump, has_one = authority @ PayLaterError::Unauthorized)]
    pub pool: Box<Account<'info, Pool>>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut, seeds = [b"pool"], bump = pool.bump, has_one = mint @ PayLaterError::MintMismatch)]
    pub pool: Box<Account<'info, Pool>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = pool)]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub mint: Box<Account<'info, Mint>>,
    pub funder: Signer<'info>,
    #[account(mut, token::mint = mint, token::authority = funder)]
    pub funder_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [b"pool"],
        bump = pool.bump,
        has_one = authority @ PayLaterError::Unauthorized,
        has_one = mint @ PayLaterError::MintMismatch
    )]
    pub pool: Box<Account<'info, Pool>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = pool)]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub mint: Box<Account<'info, Mint>>,
    pub authority: Signer<'info>,
    #[account(mut, token::mint = mint)]
    pub to: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(loan_id: [u8; 32])]
pub struct BuyNow<'info> {
    #[account(mut, seeds = [b"pool"], bump = pool.bump, has_one = mint @ PayLaterError::MintMismatch)]
    pub pool: Box<Account<'info, Pool>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = pool)]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + CreditLine::INIT_SPACE,
        seeds = [b"line", buyer.key().as_ref()],
        bump
    )]
    pub line: Box<Account<'info, CreditLine>>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Loan::INIT_SPACE,
        seeds = [b"loan", buyer.key().as_ref(), loan_id.as_ref()],
        bump
    )]
    pub loan: Box<Account<'info, Loan>>,
    /// The buyer signs and pays the rent: nobody can borrow in its name.
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: any wallet; its Tessera tier is checked from `merchant_agent`.
    pub merchant: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = merchant
    )]
    pub merchant_token: Box<Account<'info, TokenAccount>>,
    /// CHECK: the escrow program's config (the score parameters).
    #[account(owner = tessera::ID, seeds = [b"config"], bump, seeds::program = tessera::ID)]
    pub tessera_config: UncheckedAccount<'info>,
    /// CHECK: the buyer's Tessera credit file.
    #[account(owner = tessera::ID, seeds = [b"agent", buyer.key().as_ref()], bump, seeds::program = tessera::ID)]
    pub buyer_agent: UncheckedAccount<'info>,
    /// CHECK: the merchant's Tessera credit file.
    #[account(owner = tessera::ID, seeds = [b"agent", merchant.key().as_ref()], bump, seeds::program = tessera::ID)]
    pub merchant_agent: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(mut, seeds = [b"pool"], bump = pool.bump, has_one = mint @ PayLaterError::MintMismatch)]
    pub pool: Box<Account<'info, Pool>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = pool)]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [b"loan", loan.buyer.as_ref(), loan.loan_id.as_ref()], bump = loan.bump)]
    pub loan: Box<Account<'info, Loan>>,
    #[account(mut, seeds = [b"line", loan.buyer.as_ref()], bump = line.bump)]
    pub line: Box<Account<'info, CreditLine>>,
    pub payer: Signer<'info>,
    #[account(mut, token::mint = mint, token::authority = payer)]
    pub payer_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct MarkDefault<'info> {
    #[account(mut, seeds = [b"pool"], bump = pool.bump)]
    pub pool: Box<Account<'info, Pool>>,
    #[account(mut, seeds = [b"loan", loan.buyer.as_ref(), loan.loan_id.as_ref()], bump = loan.bump)]
    pub loan: Box<Account<'info, Loan>>,
    #[account(mut, seeds = [b"line", loan.buyer.as_ref()], bump = line.bump)]
    pub line: Box<Account<'info, CreditLine>>,
}

#[derive(Accounts)]
pub struct CloseLoan<'info> {
    #[account(
        mut,
        close = buyer,
        seeds = [b"loan", loan.buyer.as_ref(), loan.loan_id.as_ref()],
        bump = loan.bump,
        has_one = buyer @ PayLaterError::Unauthorized
    )]
    pub loan: Box<Account<'info, Loan>>,
    /// CHECK: receives the rent; must be the loan's buyer.
    #[account(mut)]
    pub buyer: UncheckedAccount<'info>,
}
