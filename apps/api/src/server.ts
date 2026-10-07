/**
 * The Tessera HTTP API: the core door. The MCP server and the CLI are thin
 * layers that call it; SKILL.md teaches an agent when to.
 *
 *   npm run api                        (port 4030, devnet)
 *   TESSERA_RPC_URLS=http://127.0.0.1:8899 npm run api
 *
 * Non-custodial: it reads the chain and returns unsigned transactions. It
 * never takes a private key and never sends a transaction it built itself.
 */
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { TESSERA_PROGRAM_ADDRESS } from '@tessera/sdk';
import { getConfig, NETWORK, RPC_URLS, RpcUnavailable } from './chain.js';
import { TOOLS } from './contract.js';
import { openapi } from './openapi.js';
import { ROUTES, type Route } from './routes.js';
import { check } from './validate.js';

const LIMITS: Record<Route['limit'], number> = {
  read: Number(process.env.TESSERA_READS_PER_MIN ?? 120),
  build: Number(process.env.TESSERA_BUILDS_PER_MIN ?? 30),
  submit: Number(process.env.TESSERA_SUBMITS_PER_MIN ?? 20),
};

/** A fixed one-minute window per client and kind of route. */
function limiter() {
  const hits = new Map<string, { n: number; until: number }>();
  return (kind: Route['limit'], key: string): number | null => {
    const now = Date.now();
    if (hits.size > 20_000) for (const [k, h] of hits) if (h.until < now) hits.delete(k);
    const k = `${kind}:${key}`;
    const h = hits.get(k);
    if (!h || h.until < now) {
      hits.set(k, { n: 1, until: now + 60_000 });
      return null;
    }
    if (h.n >= LIMITS[kind]) return Math.ceil((h.until - now) / 1000);
    h.n += 1;
    return null;
  };
}

const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x));

export function createApp(publicUrl = process.env.TESSERA_API_URL ?? 'http://localhost:4030') {
  const app = express();
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
  app.disable('x-powered-by');
  // Nothing here uses cookies or sessions, so any origin may call it.
  app.use(cors());
  app.use(express.json({ limit: '32kb' }));
  const limited = limiter();

  const send = (res: Response, http: number, body: Record<string, unknown>) => {
    res.status(http).type('application/json').send(json(body));
  };

  app.get('/v1', (_req, res) =>
    send(res, 200, {
      status: 'ok',
      name: 'Tessera API',
      program: TESSERA_PROGRAM_ADDRESS,
      network: NETWORK,
      custody: 'none: every transaction is returned unsigned for your own wallet to sign',
      openapi: `${publicUrl}/v1/openapi.json`,
      tools: TOOLS,
    }),
  );
  app.get('/v1/openapi.json', (_req, res) => send(res, 200, openapi(ROUTES, publicUrl)));
  app.get('/v1/health', async (_req, res) => {
    try {
      const cfg = await getConfig();
      send(res, cfg ? 200 : 503, { status: cfg ? 'ok' : 'not_configured', program: TESSERA_PROGRAM_ADDRESS, mint: cfg?.data.mint ?? null, rpc: RPC_URLS.length });
    } catch {
      send(res, 503, { status: 'rpc_unavailable', message: 'No RPC endpoint answered.' });
    }
  });

  for (const r of ROUTES) {
    const handler = async (req: Request, res: Response) => {
      const wait = limited(r.limit, req.ip ?? 'unknown');
      if (wait !== null) return send(res, 429, { status: 'rate_limited', message: `Too many requests; try again in ${wait} s.` });
      const input = { ...(r.method === 'POST' ? (req.body ?? {}) : {}), ...req.params };
      const checked = check(input, r.fields);
      if (!checked.ok) return send(res, 400, { status: 'invalid_request', tool: r.tool, message: checked.message });
      try {
        const out = await r.run(checked.values);
        send(res, out.http, { tool: r.tool, ...out.body });
      } catch (e) {
        if (e instanceof RpcUnavailable) return send(res, 503, { status: 'rpc_unavailable', tool: r.tool, message: e.message });
        console.error(`[api] ${r.tool}:`, e);
        send(res, 500, { status: 'internal_error', tool: r.tool, message: (e as Error).message.slice(0, 300) });
      }
    };
    if (r.method === 'GET') app.get(r.path, handler);
    else app.post(r.path, handler);
  }

  app.use((_req, res) =>
    send(res, 404, { status: 'invalid_request', message: 'No such endpoint.', endpoints: ROUTES.map((r) => `${r.method} ${r.path}`) }),
  );
  // A body that is not JSON, or too large.
  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    send(res, err.status ?? 400, { status: 'invalid_request', message: err.message.slice(0, 200) });
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4030);
  createApp().listen(port, () => {
    console.log(`Tessera API on http://localhost:${port}/v1  (RPC: ${RPC_URLS.join(', ')})`);
  });
}
