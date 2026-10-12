/**
 * Client for the pay-later program: generated instructions and decoders, plus
 * one stable name per address and the credit-limit formula.
 */
import { getBase58Decoder, getBase64Encoder, type Address, type GetProgramAccountsApi, type Rpc } from '@solana/kit';
import type { ProgramAccountsRpc } from '../chain.js';
import { findAta } from '../pda.js';
import { getLoanDecoder, LOAN_DISCRIMINATOR, LoanState, type Loan } from './generated/index.js';
import { findLinePda } from './generated/pdas/line.js';
import { findLoanPda } from './generated/pdas/loan.js';
import { findPoolPda } from './generated/pdas/pool.js';
import { TESSERA_PAYLATER_PROGRAM_ADDRESS } from './generated/programs/tesseraPaylater.js';

export * from './generated/index.js';
export * from './limit.js';

/** Where `buyer` sits in a Loan account: after the discriminator and the 32-byte loan id. */
const LOAN_BUYER_OFFSET = 8n + 32n;

/** Every loan a wallet has taken, settled or not, newest first. */
export async function fetchLoansOf(rpc: Rpc<GetProgramAccountsApi>, buyer: Address): Promise<{ address: Address; data: Loan }[]> {
  // Kit brands the filter bytes; the structural slice in chain.ts takes plain strings.
  const rows = (await (rpc as unknown as ProgramAccountsRpc)
    .getProgramAccounts(TESSERA_PAYLATER_PROGRAM_ADDRESS, {
      encoding: 'base64',
      filters: [
        { memcmp: { offset: 0n, bytes: getBase58Decoder().decode(LOAN_DISCRIMINATOR), encoding: 'base58' } },
        { memcmp: { offset: LOAN_BUYER_OFFSET, bytes: buyer, encoding: 'base58' } },
      ],
    })
    .send()) as { pubkey: Address; account: { data: [string, string] } }[];
  const decoder = getLoanDecoder();
  const out: { address: Address; data: Loan }[] = [];
  for (const row of rows) {
    try {
      out.push({ address: row.pubkey, data: decoder.decode(getBase64Encoder().encode(row.account.data[0])) });
    } catch {
      // An account this client cannot decode is skipped rather than trusted.
    }
  }
  return out.sort((a, b) => Number(b.data.createdAt - a.data.createdAt));
}

/** The loans a wallet still owes: open ones, and defaulted ones whose debt was never cleared. */
export const owed = (loans: { address: Address; data: Loan }[]) =>
  loans.filter((l) => l.data.state === LoanState.Open || l.data.state === LoanState.Defaulted);

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
