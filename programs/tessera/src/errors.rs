use anchor_lang::prelude::*;

#[error_code]
pub enum TesseraError {
    #[msg("Signer is not allowed to do this")]
    Unauthorized,
    #[msg("A parameter is out of range")]
    InvalidParams,
    #[msg("The order is not in the state this instruction needs")]
    InvalidState,
    #[msg("Order amount is below the minimum")]
    AmountTooSmall,
    #[msg("Buyer and merchant must be different wallets")]
    SelfDealing,
    #[msg("The vault holds less than the order amount")]
    VaultUnderfunded,
    #[msg("Wrong token mint")]
    MintMismatch,
    #[msg("Token account has the wrong owner")]
    TokenOwnerMismatch,
    #[msg("Signer is not a party to this order")]
    NotAParty,
    #[msg("The settlement hold has not elapsed yet")]
    HoldNotElapsed,
    #[msg("The delivery deadline has passed")]
    DeliveryWindowClosed,
    #[msg("The delivery deadline has not passed yet")]
    DeliveryWindowOpen,
    #[msg("The dispute window has closed")]
    DisputeWindowClosed,
    #[msg("Too early for this action")]
    TooEarly,
    #[msg("The review window has closed")]
    ReviewWindowClosed,
    #[msg("This party already reviewed this order")]
    AlreadyReviewed,
    #[msg("Rating must be between 1 and 5")]
    InvalidRating,
    #[msg("Text is too long")]
    TextTooLong,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("The payment window has closed")]
    PaymentWindowClosed,
    #[msg("The arbiter cannot be a party to the order")]
    ArbiterIsParty,
    #[msg("The hold asked for is longer than the maximum")]
    HoldTooLong,
}
