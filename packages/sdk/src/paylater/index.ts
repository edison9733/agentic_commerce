/**
 * Client for the pay-later program: generated instructions and decoders, plus
 * one stable name per address and the credit-limit formula.
 */
import { type Address } from '@solana/kit';
import { findAta } from '../pda.js';
import { findLinePda } from './generated/pdas/line.js';
import { findLoanPda } from './generated/pdas/loan.js';
import { findPoolPda } from './generated/pdas/pool.js';

export * from './generated/index.js';
export * from './limit.js';

export async function poolPda(): Promise<Address> {
  return (await findPoolPda())[0];
}

export async function poolVault(mint: Address): Promise<Address> {
  return findAta(await poolPda(), mint);
}

export async function linePdaOf(buyer: Address): Promise<Address> {
  return (await findLinePda({ buyer }))[0];
}

export async function loanPdaOf(buyer: Address, loanId: Uint8Array): Promise<Address> {
  return (await findLoanPda({ buyer, loanId }))[0];
}
