# One image for the Tessera servers: the API, the merchant agents and the MCP
# server. Each Railway service picks what to run (railway/*.json). The website
# is not in here; it is static and lives on Vercel.
FROM node:22-slim
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund
# Listen on every interface: the host's proxy is in front.
ENV HOST=0.0.0.0
CMD ["npm", "run", "api"]
