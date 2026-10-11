use anchor_lang::prelude::*;

#[error_code]
pub enum PayLaterError {
    #[msg("Signer is not allowed to do this")]
    Unauthorized,
    #[msg("A parameter is out of range")]
    InvalidParams,
    #[msg("The loan is not in the state this instruction needs")]
    InvalidState,
    #[msg("Purchase amount is below the minimum")]
    AmountTooSmall,
    #[msg("Buyer and merchant must be different wallets")]
    SelfDealing,
    #[msg("Wrong token mint")]
    MintMismatch,
    #[msg("Not a Tessera credit file")]
    NotACreditFile,
    #[msg("The merchant's Tessera tier is too low for pay-later")]
    MerchantTierTooLow,
    #[msg("The purchase is above the buyer's available credit")]
    CreditLimitExceeded,
    #[msg("The pool does not hold enough to pay the merchant")]
    PoolEmpty,
    #[msg("The grace period after the due date has not passed yet")]
    NotOverdue,
    #[msg("Arithmetic overflow")]
    Overflow,
}
