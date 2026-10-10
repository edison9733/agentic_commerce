/**
 * A throwaway devnet wallet kept in this browser's local storage, so the
 * market can be tried without installing anything. Its key is readable by
 * any script on this origin (the site's Content-Security-Policy allows only
 * its own scripts), so it must only ever hold test funds from the demo
 * faucet. A real wallet (the Connect button) works the same way and is what
 * anyone should use beyond a demo.
 */
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type KeyPairSigner,
  type TransactionSigner,
} from '@solana/kit';
import { fromHex, toHex } from '@tessera/sdk';
import { readRpc } from './client';

const KEY = 'tessera.devnet.burner';

export async function loadBurner(): Promise<KeyPairSigner> {
  let hex: string | null = null;
  try {
    hex = localStorage.getItem(KEY);
  } catch {
    // storage blocked: fall through to an in-memory key
  }
  if (!hex) {
    hex = toHex(crypto.getRandomValues(new Uint8Array(32)));
    try {
      localStorage.setItem(KEY, hex);
    } catch {
      // not persisted; the wallet lasts until the tab closes
    }
  }
  return createKeyPairSignerFromPrivateKeyBytes(fromHex(hex));
}

/** Send with plain HTTP: preflight, then poll the signature. */
export async function sendWith(payer: TransactionSigner, instructions: Instruction[]): Promise<string> {
  const { value: latest } = await readRpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latest, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  const wire = getBase64EncodedWireTransaction(signed);
  await readRpc.sendTransaction(wire, { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 900));
    const { value } = await readRpc.getSignatureStatuses([signature]).send();
    const st = value[0];
    if (st?.err) throw new Error('The transaction failed on-chain.');
    if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return signature;
    if (Date.now() - started > 60_000) throw new Error('The transaction was not confirmed within a minute.');
  }
}
