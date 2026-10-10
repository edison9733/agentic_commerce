# One image for the Tessera servers: the API, the merchant agents and the MCP
# server. Each Railway service picks what to run (railway/*.json). The website
# is not in here; it is static and lives on Vercel.
FROM node:22-slim
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
COPY --chown=node:node . .
# Installed before NODE_ENV=production, which would make npm skip the dev
# dependencies the servers run with (tsx).
RUN npm ci --no-audit --no-fund && mkdir -p .data && chown node:node .data && chmod 700 .data
# Listen on every interface: the host's proxy is in front.
ENV NODE_ENV=production HOST=0.0.0.0
# Never run as root. A Railway volume mounts as root: see docs/RAILWAY.md.
USER node
CMD ["npm", "run", "api"]
