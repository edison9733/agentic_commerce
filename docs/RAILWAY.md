# Hosting the API and the agents on Railway

The website is static and stays on Vercel. Railway runs the servers. All three use one image, from the
`Dockerfile`, and each service picks what to run with its own config file:

| Service | Config file | What it is | Health check |
|---|---|---|---|
| `api` | `railway/api.json` | The Tessera API: `find_merchants`, `check_payment`, escrow transactions | `/v1` |
| `agents` | `railway/agents.json` | The demo merchant agents (A2A, x402, crank, arbiter) the Market page buys from | `/healthz` |
| `mcp` (optional) | `railway/mcp.json` | The same tools over MCP, for Claude and other MCP clients | `/health` |

Each service works out its own public address from Railway's `RAILWAY_PUBLIC_DOMAIN`, so links in
`llms.txt`, agent cards and x402 resources are right without setting them.

## 1. The API

1. In Railway: **New Project → Deploy from GitHub repo →** `edison9733/agentic_commerce`.
2. Open the new service. **Settings**:
   - Rename it to `api`.
   - Set **Config as code → Railway config file** to `railway/api.json`.
3. **Settings → Networking → Generate Domain.**
4. **Variables**: `TRUST_PROXY` is set to one proxy hop automatically on Railway, so it needs no setting.
   If you also run the MCP service, set `TESSERA_RELAY_SECRET` to a long random string (printable
   characters, no spaces) and set the same value on the MCP service, so each MCP user gets their own
   rate limit instead of sharing one.
5. Optional: `TESSERA_RPC_URLS` = your own devnet RPC URL. The public one rate-limits. A URL with an API
   key belongs here, never in `VITE_RPC_URLS`: anything starting with `VITE_` is compiled into the
   public website.

Check: `https://<api domain>/v1/merchants?need=text%20summary` answers with a `status`.

## 2. The agents

The agents sign as the merchants, the operations wallet and the arbiter, so they need those keys.
Railway has no `.keys/` folder; the keys go in one secret variable instead.

1. On your computer, in the project with your `.keys/` folder:
   ```bash
   npm run keys:export
   ```
   It prints one long line. It controls those wallets. Paste it only into Railway; never commit it
   or send it in a chat.
2. In the same Railway project: **New → GitHub Repo →** the same repo. Then set up the service:
   - Rename it to `agents`.
   - Set its config file to `railway/agents.json`.
   - **Generate Domain**.
3. **Variables**:
   - `TESSERA_KEYS` = the line from step 1
   - `WEB_ORIGINS` = `https://agentic-commerce-two-theta.vercel.app` (add other site addresses, comma-separated)
   - Recommended: `SOLANA_RPC_URL` = your own devnet RPC URL
   - `TRUST_PROXY` is one hop automatically on Railway; set it only for another number of proxies.
4. **New → Volume**, mounted at `/app/.data`. This is required: the server keeps its quotes, delivery
   results and the arbiter's evidence there, and without a volume it refuses new orders
   (`TESSERA_ALLOW_EPHEMERAL_STATE=1` overrides that for a throwaway test). The image runs as the
   non-root `node` user; if Railway mounts the volume as root and the server cannot write to it, set
   `RAILWAY_RUN_UID` = `0` on the service.
5. Optional limits: `QUOTES_PER_MINUTE` (20), `MAX_UNPAID_PER_BUYER` (3), `MAX_UNPAID_PER_CLIENT` (5),
   `MAX_OPEN_QUOTES` (40), `REQUESTS_PER_MINUTE` (120), `RPC_TIMEOUT_MS` (8000).

Check: `https://<agents domain>/health` lists the facilitators, and
`https://<agents domain>/agents` lists the merchants.

## 3. Point the merchants' credit files at the hosted cards

`find_merchants` reads each merchant's A2A card from the address in its on-chain profile. That address
still says `localhost`. On your computer, with `.keys/`:

```bash
AGENT_HOST=https://<agents domain> npm run setup:devnet
```

It is idempotent: it only rewrites the profiles whose address changed.

## 4. The website

In Vercel: **Settings → Environment Variables**: `VITE_AGENTS_URL` = `https://<agents domain>`. Then
**Deployments → Redeploy**. The Market page and the demo deck's checkout slide then buy from the
hosted agents.

## 5. MCP (optional)

1. **New → GitHub Repo →** the same repo. Then set up the service:
   - Rename it to `mcp`.
   - Set its config file to `railway/mcp.json`.
   - **Generate Domain**.
2. **Variables**: `TESSERA_API_URL` = `https://${{api.RAILWAY_PUBLIC_DOMAIN}}`. This is a Railway
   reference to the API service. Also `TESSERA_RELAY_SECRET` = the same value as on the API. Optional:
   `TESSERA_MCP_PER_MIN` (default 120 requests per client per minute).
3. Connect a client:
   ```bash
   claude mcp add --transport http tessera https://<mcp domain>/mcp
   ```

Only its own domain is answered (DNS-rebinding protection). Add more host names with `ALLOWED_HOSTS`.

## Things to know

- **Devnet only.** These servers move test USDC. The deployed program still predates the audit
  fixes: redeploy it first (see [SECURITY.md](SECURITY.md)).
- **The arbiter key is on the agents server.** That is fine for a demo. For real money the arbiter
  should be a separate, better-guarded service.
- **Cards on private addresses are not read** unless `TESSERA_ALLOW_PRIVATE_CARDS=1` is set. That's on
  purpose; see D14 in [SECURITY.md](SECURITY.md). The hosted agents' cards are public, so this does not get in the way.
- **What was tested before this was written:**
  - The image's contents were installed and each server started the way Railway starts it.
  - The API served `/v1` and `llms.txt` with its public domain.
  - MCP listed its 10 tools on its domain, answered Railway's health checker and refused other hosts.
  - The agents read every key from `TESSERA_KEYS` and started.
  - Reaching devnet was the one step the test machine could not do.
