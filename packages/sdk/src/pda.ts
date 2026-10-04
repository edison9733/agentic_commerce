/**
 * Address helpers that complement the Codama-generated ones.
 *
 * Codama names a PDA after the instruction field that declared it, so the one
 * agent PDA shows up as `findAgentPda`, `findBuyerAgentPda`, ... all with the
 * same seeds. `agentPdaOf` gives it one stable name. Codama also cannot know
 * about the escrow vault, which is an associated token account, not a PDA of
 * this program.
 */
import { address, getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { TESSERA_PROGRAM_ADDRESS } from './generated/programs/tessera.js';
import { findAgentPda } from './generated/pdas/agent.js';
import { findConfigPda } from './generated/pdas/config.js';
import { findOrderPda } from './generated/pdas/order.js';
import { findPairPda } from './generated/pdas/pair.js';
import { findReviewPda } from './generated/pdas/review.js';
import type { Order } from './generated/accounts/order.js';

const BPF_LOADER_UPGRADEABLE = address('BPFLoaderUpgradeab1e11111111111111111111111');

type Opt = { programAddress?: Address };

/** ATA for any owner. Works for off-curve owners, which is what a vault's is. */
export async function findAta(owner: Address, mint: Address): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return ata;
}

export async function configPda(opt: Opt = {}): Promise<Address> {
  return (await findConfigPda(opt))[0];
}

export async function agentPdaOf(wallet: Address, opt: Opt = {}): Promise<Address> {
  return (await findAgentPda({ wallet }, opt))[0];
}

export async function pairPdaOf(buyer: Address, merchant: Address, opt: Opt = {}): Promise<Address> {
  return (await findPairPda({ buyer, merchant }, opt))[0];
}

export async function reviewPdaOf(order: Address, reviewer: Address, opt: Opt = {}): Promise<Address> {
  return (await findReviewPda({ order, reviewer }, opt))[0];
}

/**
 * The order account and its vault. The order account is what a 402 response
 * quotes as `payTo`; the vault is where the payment actually lands.
 *
 * Both follow from the order id alone, so a buyer can check for itself that
 * the payment it is about to sign goes into escrow and nowhere else.
 */
export async function orderAddresses(
  orderId: Uint8Array,
  mint: Address,
  opt: Opt = {},
): Promise<{ order: Address; vault: Address }> {
  const [order] = await findOrderPda({ orderId }, opt);
  return { order, vault: await findAta(order, mint) };
}

/** Every account `release`, `refund` and `resolve_dispute` need. */
export async function settleAccounts(
  orderAddress: Address,
  order: Pick<Order, 'buyer' | 'merchant' | 'mint' | 'payer'>,
  treasury: Address,
  opt: Opt = {},
) {
  const [config, vault, merchantToken, buyerToken, treasuryToken, merchantAgent, buyerAgent, pair] =
    await Promise.all([
      configPda(opt),
      findAta(orderAddress, order.mint),
      findAta(order.merchant, order.mint),
      findAta(order.buyer, order.mint),
      findAta(treasury, order.mint),
      agentPdaOf(order.merchant, opt),
      agentPdaOf(order.buyer, opt),
      pairPdaOf(order.buyer, order.merchant, opt),
    ]);
  return {
    config,
    order: orderAddress,
    vault,
    mint: order.mint,
    merchantToken,
    buyerToken,
    treasuryToken,
    merchantAgent,
    buyerAgent,
    pair,
    payer: order.payer,
  };
}

/** The ProgramData account that records a program's upgrade authority. */
export async function programDataAddress(
  programAddress: Address = TESSERA_PROGRAM_ADDRESS,
): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: BPF_LOADER_UPGRADEABLE,
    seeds: [getAddressEncoder().encode(programAddress)],
  });
  return pda;
}
