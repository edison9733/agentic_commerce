/**
 * Read every account of one kind straight from the chain. This is all the
 * website needs: there is no indexer or database between it and the program.
 */
import {
  getBase58Decoder,
  getBase64Encoder,
  type Address,
  type Decoder,
  type ReadonlyUint8Array,
} from '@solana/kit';
import { AGENT_DISCRIMINATOR, getAgentDecoder, type Agent } from './generated/accounts/agent.js';
import { CONFIG_DISCRIMINATOR, getConfigDecoder, type Config } from './generated/accounts/config.js';
import { ORDER_DISCRIMINATOR, getOrderDecoder, type Order } from './generated/accounts/order.js';
import { PAIR_DISCRIMINATOR, getPairDecoder, type Pair } from './generated/accounts/pair.js';
import { REVIEW_DISCRIMINATOR, getReviewDecoder, type Review } from './generated/accounts/review.js';
import { TESSERA_PROGRAM_ADDRESS } from './generated/programs/tessera.js';

export type Decoded<T> = { address: Address; data: T };

/** The slice of the Kit RPC this module uses, so any Kit client's `rpc` fits. */
export type ProgramAccountsRpc = {
  getProgramAccounts(
    program: Address,
    config: {
      encoding: 'base64';
      filters: { memcmp: { offset: bigint; bytes: string; encoding: 'base58' } }[];
    },
  ): { send(): Promise<unknown> };
};

type RawAccount = { pubkey: Address; account: { data: [string, string] } };

async function fetchAll<T>(
  rpc: ProgramAccountsRpc,
  discriminator: ReadonlyUint8Array,
  decoder: Decoder<T>,
  programAddress: Address,
): Promise<Decoded<T>[]> {
  const rows = (await rpc
    .getProgramAccounts(programAddress, {
      encoding: 'base64',
      filters: [
        { memcmp: { offset: 0n, bytes: getBase58Decoder().decode(discriminator), encoding: 'base58' } },
      ],
    })
    .send()) as RawAccount[];
  const out: Decoded<T>[] = [];
  for (const row of rows) {
    try {
      const bytes = getBase64Encoder().encode(row.account.data[0]);
      out.push({ address: row.pubkey, data: decoder.decode(bytes) });
    } catch {
      // An account this client cannot decode is skipped rather than trusted.
    }
  }
  return out;
}

type Opt = { programAddress?: Address };
const pid = (o: Opt) => o.programAddress ?? TESSERA_PROGRAM_ADDRESS;

export const fetchAllAgents = (rpc: ProgramAccountsRpc, o: Opt = {}) =>
  fetchAll<Agent>(rpc, AGENT_DISCRIMINATOR, getAgentDecoder(), pid(o));
export const fetchAllOrders = (rpc: ProgramAccountsRpc, o: Opt = {}) =>
  fetchAll<Order>(rpc, ORDER_DISCRIMINATOR, getOrderDecoder(), pid(o));
export const fetchAllPairs = (rpc: ProgramAccountsRpc, o: Opt = {}) =>
  fetchAll<Pair>(rpc, PAIR_DISCRIMINATOR, getPairDecoder(), pid(o));
export const fetchAllReviews = (rpc: ProgramAccountsRpc, o: Opt = {}) =>
  fetchAll<Review>(rpc, REVIEW_DISCRIMINATOR, getReviewDecoder(), pid(o));
export const fetchAllConfigs = (rpc: ProgramAccountsRpc, o: Opt = {}) =>
  fetchAll<Config>(rpc, CONFIG_DISCRIMINATOR, getConfigDecoder(), pid(o));
