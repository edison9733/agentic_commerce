/**
 * Every endpoint, once: its path, its inputs and the core function behind it.
 * The server mounts these and the OpenAPI document is generated from them, so
 * the two cannot drift apart.
 */
import type { Address } from '@solana/kit';
import { MAX_COMMENT_BYTES, MAX_MIN_HOLD_SECS, OUTCOMES, ROLES, type Outcome, type ToolName } from './contract.js';
import {
  checkPayment,
  deliverOrder,
  getEscrow,
  getScore,
  openAsBuyer,
  openAsMerchant,
  reclaim,
  releaseEscrow,
  reportOutcome,
  submit,
  type Reply,
} from './core.js';
import type { Field } from './validate.js';

export type Route = {
  tool: ToolName;
  method: 'GET' | 'POST';
  /** Express-style path, e.g. /v1/score/:wallet */
  path: string;
  fields: Field[];
  /** Read routes are cheap; build routes simulate a transaction; submit sends one. */
  limit: 'read' | 'build' | 'submit';
  run: (v: Record<string, unknown>) => Promise<Reply>;
};

const invalid = (message: string): Reply => ({ http: 400, body: { status: 'invalid_request', message } });

const minHold: Field = { name: 'minHoldSecs', kind: 'int', min: 0, max: MAX_MIN_HOLD_SECS };

export const ROUTES: Route[] = [
  {
    tool: 'get_score',
    method: 'GET',
    path: '/v1/score/:wallet',
    fields: [{ name: 'wallet', kind: 'address', required: true }],
    limit: 'read',
    run: (v) => getScore(v.wallet as Address),
  },
  {
    tool: 'check_payment',
    method: 'POST',
    path: '/v1/check',
    fields: [
      { name: 'merchant', kind: 'address', required: true },
      { name: 'buyer', kind: 'address' },
      { name: 'amount', kind: 'amount', required: true },
      minHold,
    ],
    limit: 'read',
    run: (v) => checkPayment(v as Parameters<typeof checkPayment>[0]),
  },
  {
    tool: 'open_escrow',
    method: 'POST',
    path: '/v1/escrow/open',
    fields: [
      { name: 'role', kind: 'enum', values: ROLES, required: true },
      { name: 'merchant', kind: 'address', required: true },
      { name: 'buyer', kind: 'address', required: true },
      { name: 'amount', kind: 'amount', required: true },
      { name: 'order', kind: 'address' },
      { name: 'orderId', kind: 'hex32' },
      { name: 'requestHash', kind: 'hex32' },
      { name: 'request', kind: 'json' },
      minHold,
    ],
    limit: 'build',
    run: async (v) => {
      if (v.role === 'merchant') return openAsMerchant(v as Parameters<typeof openAsMerchant>[0]);
      if (!v.order && !v.orderId) return invalid('role buyer needs the order address (the x402 payTo) or its orderId');
      return openAsBuyer(v as Parameters<typeof openAsBuyer>[0]);
    },
  },
  {
    tool: 'deliver_order',
    method: 'POST',
    path: '/v1/escrow/deliver',
    fields: [
      { name: 'order', kind: 'address', required: true },
      { name: 'merchant', kind: 'address', required: true },
      { name: 'deliverable', kind: 'json' },
      { name: 'deliveryHash', kind: 'hex32' },
    ],
    limit: 'build',
    run: async (v) => {
      if (v.deliverable === undefined && !v.deliveryHash) return invalid('send the deliverable (any JSON) or its deliveryHash');
      return deliverOrder(v as Parameters<typeof deliverOrder>[0]);
    },
  },
  {
    tool: 'get_escrow',
    method: 'GET',
    path: '/v1/escrow/:order',
    fields: [{ name: 'order', kind: 'address', required: true }],
    limit: 'read',
    run: (v) => getEscrow(v.order as Address),
  },
  {
    tool: 'release_escrow',
    method: 'POST',
    path: '/v1/escrow/release',
    fields: [
      { name: 'order', kind: 'address', required: true },
      { name: 'signer', kind: 'address', required: true },
    ],
    limit: 'build',
    run: (v) => releaseEscrow(v as Parameters<typeof releaseEscrow>[0]),
  },
  {
    tool: 'reclaim_after_timeout',
    method: 'POST',
    path: '/v1/escrow/reclaim',
    fields: [
      { name: 'order', kind: 'address', required: true },
      { name: 'signer', kind: 'address', required: true },
    ],
    limit: 'build',
    run: (v) => reclaim(v as Parameters<typeof reclaim>[0]),
  },
  {
    tool: 'report_outcome',
    method: 'POST',
    path: '/v1/escrow/report',
    fields: [
      { name: 'order', kind: 'address', required: true },
      { name: 'reporter', kind: 'address', required: true },
      { name: 'outcome', kind: 'enum', values: OUTCOMES, required: true },
      { name: 'rating', kind: 'int', min: 1, max: 5 },
      { name: 'comment', kind: 'text', maxBytes: MAX_COMMENT_BYTES },
    ],
    limit: 'build',
    run: (v) => reportOutcome(v as { order: Address; reporter: Address; outcome: Outcome; rating?: number; comment?: string }),
  },
  {
    tool: 'submit_transaction',
    method: 'POST',
    path: '/v1/tx/submit',
    fields: [{ name: 'transaction', kind: 'base64', required: true }],
    limit: 'submit',
    run: (v) => submit(v as { transaction: string }),
  },
];
