#!/usr/bin/env bash
# The whole product on one machine, for recording: a local validator running the
# real Tessera program, the demo cast and their trades, the agents server, the
# API and the website. Throwaway keys only; `down.sh` removes everything.
#
#   SOLANA_BIN=/path/to/solana-release/bin bash pitch/studio/up.sh [periods]
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO=$PWD
RUN=$REPO/pitch/studio/.run
PERIODS=${1:-30}
PORT=18499
LOCAL=http://127.0.0.1:$PORT
[ -n "${SOLANA_BIN:-}" ] && export PATH=$SOLANA_BIN:$PATH
mkdir -p "$RUN/logs"
[ -e .keys ] && { echo ".keys/ already exists; refusing to mix the studio's throwaway keys with real ones"; exit 1; }
rm -rf "$RUN/deployments.bak"; cp -r deployments "$RUN/deployments.bak"

solana-keygen new --no-bip39-passphrase --silent --force -o "$RUN/deployer.json"
DEPLOYER=$(solana-keygen pubkey "$RUN/deployer.json")
node pitch/studio/mint-account.mjs "$DEPLOYER" "$RUN/usdc-mint.json"

solana-test-validator --reset --quiet --ledger "$RUN/ledger" --rpc-port $PORT --faucet-port $((PORT + 1001)) \
  --account 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU "$RUN/usdc-mint.json" \
  --upgradeable-program TessSeP5QV5Bxpvm73iEefdsTjgtTEokKSx7jqFn1CQ target/deploy/tessera.so "$DEPLOYER" \
  --mint "$DEPLOYER" > "$RUN/logs/validator.log" 2>&1 &
echo $! > "$RUN/validator.pid"
until solana -u $LOCAL cluster-version >/dev/null 2>&1; do sleep 1; done
sleep 3

spl-token -u $LOCAL create-account 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU --owner "$DEPLOYER" --fee-payer "$RUN/deployer.json" >/dev/null
ATA=$(spl-token -u $LOCAL address --token 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU --owner "$DEPLOYER" --verbose | awk '/Associated token address/ {print $4}')
spl-token -u $LOCAL mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU 100000 "$ATA" --mint-authority "$RUN/deployer.json" --fee-payer "$RUN/deployer.json" >/dev/null

export SOLANA_RPC_URL=$LOCAL SOLANA_RPC_FALLBACKS= RPC_BUDGET_PER_10S=100000 AGENT_HOST=http://localhost:4020
DEPLOYER_KEYPAIR="$RUN/deployer.json" npx tsx scripts/setup-devnet.ts > "$RUN/logs/setup.log" 2>&1
cp "$RUN/deployments.bak/devnet.json" deployments/devnet.json

node pitch/studio/facilitator-stub.mjs "$DEPLOYER" 4099 > "$RUN/logs/facilitator.log" 2>&1 & echo $! > "$RUN/facilitator.pid"
FACILITATOR_URLS=http://127.0.0.1:4099 TESSERA_DATA_DIR="$RUN/data" TESSERA_ALLOW_EPHEMERAL_STATE=1 REQUESTS_PER_MINUTE=100000 QUOTES_PER_MINUTE=10000 \
  npm run agents > "$RUN/logs/agents.log" 2>&1 & echo $! > "$RUN/agents.pid"
TESSERA_RPC_URLS=$LOCAL TESSERA_ALLOW_PRIVATE_CARDS=1 TESSERA_READS_PER_MIN=100000 TESSERA_BUILDS_PER_MIN=100000 TESSERA_SUBMITS_PER_MIN=100000 \
  TESSERA_EXPLORER_CLUSTER="custom&customUrl=$(node -e "console.log(encodeURIComponent('$LOCAL'))")" \
  npm run api > "$RUN/logs/api.log" 2>&1 & echo $! > "$RUN/api.pid"
VITE_RPC_URLS=$LOCAL VITE_AGENTS_URL=http://localhost:4020 npm run web > "$RUN/logs/web.log" 2>&1 & echo $! > "$RUN/web.pid"
until curl -sf http://127.0.0.1:4020/health >/dev/null; do sleep 2; done

(cd apps/agents && FACILITATOR_URLS=http://127.0.0.1:4099 exec npx tsx src/swarm.ts --x402-every 0 --periods "$PERIODS") > "$RUN/logs/swarm.log" 2>&1 & echo $! > "$RUN/swarm.pid"
echo "studio up: rpc $LOCAL, site http://localhost:5173, agents :4020, api :4030; swarm running $PERIODS periods"
