use anchor_lang::prelude::*;

#[event]
pub struct OrderOpened {
    pub order_id: [u8; 32],
    pub order: Pubkey,
    pub vault: Pubkey,
    pub buyer: Pubkey,
    pub merchant: Pubkey,
    pub amount: u64,
    pub hold_secs: u32,
    pub buyer_tier: u8,
    pub merchant_tier: u8,
    pub pair_trusted: bool,
}

#[event]
pub struct OrderFunded {
    pub order_id: [u8; 32],
    pub vault_balance: u64,
}

#[event]
pub struct OrderDelivered {
    pub order_id: [u8; 32],
    pub release_at: i64,
    pub instant: bool,
}

#[event]
pub struct OrderSettled {
    pub order_id: [u8; 32],
    pub state: u8,
    pub to_merchant: u64,
    pub to_buyer: u64,
    pub fee: u64,
    pub buyer_score: u16,
    pub merchant_score: u16,
    pub buyer_tier: u8,
    pub merchant_tier: u8,
}

#[event]
pub struct DisputeOpened {
    pub order_id: [u8; 32],
    pub pair_trusted: bool,
}

#[event]
pub struct ReviewSubmitted {
    pub order_id: [u8; 32],
    pub reviewer: Pubkey,
    pub subject: Pubkey,
    pub rating: u8,
    pub weight: u64,
    pub subject_score: u16,
}
