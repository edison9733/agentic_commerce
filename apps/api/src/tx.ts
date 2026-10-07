/**
 * Unsigned transactions. The API builds them, simulates them, and hands them
 * back; the agent's own wallet signs. A transaction that fails simulation is
 * never handed out.
 */
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
} from '@solana/kit';
import { getSetComputeUnitLimitInstruction } from '@solana-program/compute-budget';
import { rpc } from './chain.js';

export type Unsigned = {
  /** Base64 wire transaction, version 0, with empty signature slots. */
  transaction: string;
  /** Wallets that must sign, fee payer first. */
  signers: Address[];
  feePayer: Address;
  /** The transaction expires after this block height; ask again after that. */
  lastValidBlockHeight: string;
  simulation: { ok: true; unitsConsumed: number | null } | { ok: false; error: string; logs: string[] };
};

export async function buildUnsigned(feePayer: Address, instructions: Instruction[]): Promise<Unsigned> {
  const { value: latest } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
    (m) => appendTransactionMessageInstructions([getSetComputeUnitLimitInstruction({ units: 400_000 }), ...instructions], m),
  );
  const compiled = compileTransaction(message);
  const transaction = getBase64EncodedWireTransaction(compiled);
  const signers = Object.keys(compiled.signatures) as Address[];

  const sim = await rpc
    .simulateTransaction(transaction, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' })
    .send();
  const simulation: Unsigned['simulation'] = sim.value.err
    ? {
        ok: false,
        error: JSON.stringify(sim.value.err, (_, v) => (typeof v === 'bigint' ? Number(v) : v)),
        logs: (sim.value.logs ?? []).filter((l) => /Error|failed|AnchorError|Program log/.test(l)).slice(-8),
      }
    : { ok: true, unitsConsumed: sim.value.unitsConsumed === undefined ? null : Number(sim.value.unitsConsumed) };

  return { transaction, signers, feePayer, lastValidBlockHeight: latest.lastValidBlockHeight.toString(), simulation };
}
