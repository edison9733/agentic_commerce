/**
 * The A2A side of a merchant agent: an agent card and a JSON-RPC endpoint
 * that speaks `message/send` and `tasks/get`, with the a2a-x402 extension
 * (v0.2, standalone flow) carrying the payment.
 *
 *   client: message/send { skill, input, buyer }
 *   agent : task input-required   x402.payment.status = payment-required
 *                                 x402.payment.required = { accepts: [...] }
 *   client: message/send (taskId) x402.payment.status = payment-submitted
 *                                 x402.payment.payload = <signed payment>
 *   agent : task completed        x402.payment.status = payment-completed
 *                                 x402.payment.receipts = [...]
 *                                 artifacts = [the deliverable]
 *
 * The one thing Tessera changes is where `payTo` points: at an escrow
 * account, not at the merchant.
 */
import { randomUUID } from 'node:crypto';
import type { PaymentPayload } from '@x402/core/types';
import { fromUnits, TESSERA_PROGRAM_ADDRESS, USDC_DECIMALS } from '@tessera/sdk';
import { config, TESSERA_EXTENSION_URI, X402_EXTENSION_URI } from './config.js';
import type { Fulfilment, MerchantAgent, Quote } from './merchant.js';

export type Part = { kind: 'text'; text: string } | { kind: 'data'; data: unknown };
export type Message = {
  kind: 'message';
  role: 'user' | 'agent';
  messageId: string;
  parts: Part[];
  taskId?: string;
  contextId?: string;
  metadata?: Record<string, unknown>;
};
export type TaskState = 'submitted' | 'working' | 'input-required' | 'completed' | 'failed' | 'canceled' | 'rejected';
export type Artifact = { artifactId: string; name: string; parts: Part[]; metadata?: Record<string, unknown> };
export type Task = {
  kind: 'task';
  id: string;
  contextId: string;
  status: { state: TaskState; message?: Message; timestamp: string };
  artifacts?: Artifact[];
  history?: Message[];
};

export const K = {
  status: 'x402.payment.status',
  required: 'x402.payment.required',
  payload: 'x402.payment.payload',
  receipts: 'x402.payment.receipts',
  error: 'x402.payment.error',
  /** Tessera: the buyer funded the escrow itself instead of using a facilitator. */
  direct: 'tessera.payment.direct',
  delivery: 'tessera.delivery',
  escrow: 'tessera.escrow',
} as const;

const tasks = new Map<string, { task: Task; merchant: string; order: string }>();

export async function agentCard(m: MerchantAgent) {
  const base = `${config.publicUrl}/agents/${m.id}`;
  return {
    protocolVersion: '0.3.0',
    name: m.title.split(':')[0],
    description: m.title,
    url: `${base}/a2a`,
    preferredTransport: 'JSONRPC',
    version: '0.1.0',
    provider: { organization: 'Tessera demo network', url: config.publicUrl },
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extensions: [
        {
          uri: X402_EXTENSION_URI,
          description: 'Supports payments using the x402 protocol for on-chain settlement.',
          required: true,
        },
        {
          uri: TESSERA_EXTENSION_URI,
          description:
            'Payments go into a Tessera escrow on Solana. The hold before the merchant is paid is set by both parties\' on-chain credit scores.',
          required: false,
          params: {
            program: TESSERA_PROGRAM_ADDRESS,
            network: config.network,
            wallet: m.wallet,
            x402Resource: `${base}/x402/{skill}`,
            prices: Object.fromEntries(m.services.map((s) => [s.sku, s.price.toString()])),
            decimals: USDC_DECIMALS,
            standing: await m.standing(),
          },
        },
      ],
    },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: m.services.map((s) => ({
      id: s.sku,
      name: s.name,
      description: `${s.description} ${fromUnits(s.price)} USDC per call.`,
      tags: ['x402', 'solana', 'escrow'],
      examples: [JSON.stringify({ skill: s.sku, input: s.example, buyer: '<your wallet>' })],
    })),
  };
}

const now = () => new Date().toISOString();
const agentMessage = (taskId: string, contextId: string, text: string, metadata: Record<string, unknown>): Message => ({
  kind: 'message',
  role: 'agent',
  messageId: randomUUID(),
  taskId,
  contextId,
  parts: [{ kind: 'text', text }],
  metadata,
});

type RpcError = { code: number; message: string };
const fail = (code: number, message: string): RpcError => ({ code, message });

function requestOf(message: Message): { skill: string; input: unknown; buyer: string; minHoldSecs?: number } | null {
  for (const p of message.parts ?? []) {
    if (p.kind === 'data' && typeof p.data === 'object' && p.data !== null) {
      const d = p.data as Record<string, unknown>;
      if (typeof d.skill === 'string' && typeof d.buyer === 'string') {
        return {
          skill: d.skill,
          input: d.input ?? {},
          buyer: d.buyer,
          minHoldSecs: typeof d.minHoldSecs === 'number' ? d.minHoldSecs : undefined,
        };
      }
    }
  }
  return null;
}

function paymentRequired(taskId: string, contextId: string, quote: Quote, history: Message[]): Task {
  return {
    kind: 'task',
    id: taskId,
    contextId,
    status: {
      state: 'input-required',
      timestamp: now(),
      message: agentMessage(taskId, contextId, 'Payment is required. It goes into escrow, not to the merchant.', {
        [K.status]: 'payment-required',
        [K.required]: quote.required,
        [K.escrow]: quote.terms,
      }),
    },
    history,
  };
}

function completed(task: Task, f: Fulfilment, name: string): Task {
  return {
    ...task,
    status: {
      state: 'completed',
      timestamp: now(),
      message: agentMessage(task.id, task.contextId, 'Delivered. The hash of this artifact is committed on-chain.', {
        [K.status]: 'payment-completed',
        [K.receipts]: f.receipts,
        [K.delivery]: {
          order: f.order,
          deliveryHash: f.deliveryHash,
          state: f.state,
          instant: f.instant,
          releaseAt: f.releaseAt,
          deliverTx: f.deliverTx,
          timings: f.timings,
        },
      }),
    },
    artifacts: [{ artifactId: randomUUID(), name, parts: [{ kind: 'data', data: f.deliverable }] }],
  };
}

function failed(task: Task, code: string, detail: string): Task {
  return {
    ...task,
    status: {
      state: 'failed',
      timestamp: now(),
      message: agentMessage(task.id, task.contextId, detail, {
        [K.status]: 'payment-failed',
        [K.error]: code,
        [K.receipts]: [],
      }),
    },
  };
}

/** Handle one JSON-RPC call. Returns `{ result }` or `{ error }`. */
export async function handleRpc(
  m: MerchantAgent,
  body: { method?: string; params?: Record<string, unknown> },
  extensionsHeader: string | undefined,
): Promise<{ result: unknown } | { error: RpcError }> {
  if (body.method === 'tasks/get') {
    const id = body.params?.id;
    const found = typeof id === 'string' ? tasks.get(id) : undefined;
    return found && found.merchant === m.id ? { result: found.task } : { error: fail(-32001, 'Task not found') };
  }
  if (body.method !== 'message/send') return { error: fail(-32601, `Method not found: ${body.method}`) };

  // The x402 extension is required, so a client has to activate it.
  if (!(extensionsHeader ?? '').split(',').some((u) => u.trim() === X402_EXTENSION_URI)) {
    return { error: fail(-32602, `This agent requires the extension ${X402_EXTENSION_URI} (X-A2A-Extensions header)`) };
  }
  const message = body.params?.message as Message | undefined;
  if (!message || !Array.isArray(message.parts)) return { error: fail(-32602, 'params.message is required') };

  // ---- a new request: quote it
  if (!message.taskId) {
    const req = requestOf(message);
    if (!req) {
      return { error: fail(-32602, 'Send a data part: { "skill": "<id>", "input": {...}, "buyer": "<wallet>" }') };
    }
    const taskId = randomUUID();
    const contextId = message.contextId ?? randomUUID();
    try {
      const quote = await m.quote({ ...req, sku: req.skill, resourceUrl: `${config.publicUrl}/agents/${m.id}/a2a` });
      const task = paymentRequired(taskId, contextId, quote, [message]);
      tasks.set(taskId, { task, merchant: m.id, order: quote.terms.order });
      // Oldest tasks go first once the map is large: memory stays bounded.
      for (const k of tasks.keys()) {
        if (tasks.size <= 2000) break;
        tasks.delete(k);
      }
      return { result: task };
    } catch (e) {
      return { error: fail(-32000, (e as Error).message) };
    }
  }

  // ---- a follow-up on an existing task: the payment
  const entry = tasks.get(message.taskId);
  if (!entry || entry.merchant !== m.id) return { error: fail(-32001, 'Task not found') };
  if (entry.task.status.state !== 'input-required') return { result: entry.task };

  const status = message.metadata?.[K.status];
  if (status === 'payment-rejected') {
    entry.task = { ...entry.task, status: { state: 'canceled', timestamp: now() } };
    return { result: entry.task };
  }
  if (status !== 'payment-submitted') {
    return { error: fail(-32602, `Expected ${K.status} = payment-submitted`) };
  }
  const payload = message.metadata?.[K.payload] as PaymentPayload | undefined;
  const direct = message.metadata?.[K.direct];
  if (!payload && !direct) return { error: fail(-32602, `Expected ${K.payload} or ${K.direct}`) };

  const quote = m.quotes.get(entry.order);
  try {
    const f = await m.fulfil(entry.order, payload);
    const name = quote ? m.service(quote.sku).name : 'deliverable';
    entry.task = completed({ ...entry.task, history: [...(entry.task.history ?? []), message] }, f, name);
  } catch (e) {
    const detail = (e as Error).message;
    const code = /did not deliver/.test(detail)
      ? 'MERCHANT_NO_SHOW'
      : /not been funded|VaultUnderfunded/.test(detail)
        ? 'INSUFFICIENT_FUNDS'
        : /rejected by facilitator|does not match/.test(detail)
          ? 'INVALID_PAYLOAD'
          : 'SETTLEMENT_FAILED';
    entry.task = failed(entry.task, code, detail);
  }
  return { result: entry.task };
}
