/** The OpenAPI 3.1 document, generated from the routes and the contract. */
import {
  ACTIONS,
  ADDRESS_PATTERN,
  AMOUNT_PATTERN,
  DECISIONS,
  HEX32_PATTERN,
  ORDER_STATES,
  REASONS,
  STATUSES,
  TIERS,
  TOOLS,
} from './contract.js';
import type { Route } from './routes.js';
import type { Field } from './validate.js';

function schemaOf(f: Field): Record<string, unknown> {
  switch (f.kind) {
    case 'address':
      return { type: 'string', pattern: ADDRESS_PATTERN, description: 'Solana address (base58)' };
    case 'amount':
      return { type: 'string', pattern: AMOUNT_PATTERN, description: 'USDC as a decimal string', examples: ['0.25'] };
    case 'hex32':
      return { type: 'string', pattern: HEX32_PATTERN };
    case 'base64':
      return { type: 'string', contentEncoding: 'base64', description: 'A signed wire transaction' };
    case 'enum':
      return { type: 'string', enum: [...f.values] };
    case 'int':
      return { type: 'integer', minimum: f.min, maximum: f.max };
    case 'text':
      return { type: 'string', description: `At most ${f.maxBytes} bytes of UTF-8` };
    case 'json':
      return { description: 'Any JSON value. It is hashed (sha256 of canonical JSON), never stored.' };
  }
}

export function openapi(routes: Route[], serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const path = r.path.replace(/:(\w+)/g, '{$1}');
    const inPath = [...r.path.matchAll(/:(\w+)/g)].map((m) => m[1]!);
    const body = r.fields.filter((f) => !inPath.includes(f.name));
    paths[path] = {
      ...(paths[path] ?? {}),
      [r.method.toLowerCase()]: {
        operationId: r.tool,
        summary: TOOLS[r.tool].summary,
        tags: [TOOLS[r.tool].phase === 'before' ? 'Before payment' : TOOLS[r.tool].phase === 'during' ? 'During payment' : 'After payment'],
        parameters: r.fields.filter((f) => inPath.includes(f.name)).map((f) => ({ name: f.name, in: 'path', required: true, schema: schemaOf(f) })),
        ...(r.method === 'POST'
          ? {
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      additionalProperties: false,
                      required: body.filter((f) => f.required).map((f) => f.name),
                      properties: Object.fromEntries(body.map((f) => [f.name, schemaOf(f)])),
                    },
                  },
                },
              },
            }
          : {}),
        responses: {
          default: {
            description: 'Every response carries a `status`. HTTP codes follow it; see the Status schema.',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Reply' } } },
          },
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Tessera API',
      version: '0.1.0',
      description:
        'Credit checks and non-custodial escrow for agent payments on Solana. Every transaction is returned unsigned for the caller’s own wallet to sign; the API never holds a key.',
    },
    servers: [{ url: serverUrl }],
    paths,
    components: {
      schemas: {
        Status: { type: 'string', enum: [...STATUSES] },
        Decision: { type: 'string', enum: [...DECISIONS] },
        Reason: { type: 'string', enum: [...REASONS] },
        Action: { type: 'string', enum: [...ACTIONS] },
        Tier: { type: 'string', enum: [...TIERS] },
        OrderState: { type: 'string', enum: [...ORDER_STATES] },
        Reply: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { $ref: '#/components/schemas/Status' },
            message: { type: 'string' },
            decision: { $ref: '#/components/schemas/Decision' },
            reason: { $ref: '#/components/schemas/Reason' },
            action: { $ref: '#/components/schemas/Action' },
            transaction: { type: 'string', description: 'Unsigned base64 wire transaction (version 0)' },
            signers: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: true,
        },
      },
    },
  };
}
