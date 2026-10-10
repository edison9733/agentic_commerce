#!/usr/bin/env bash
# Stop the studio and remove its throwaway keys, ledger and state.
cd "$(dirname "$0")/../.."
RUN=pitch/studio/.run
for p in swarm web api agents facilitator validator; do
  [ -f "$RUN/$p.pid" ] && kill "$(cat "$RUN/$p.pid")" 2>/dev/null
done
for port in 5173 4020 4030 4099 18499; do fuser -k $port/tcp >/dev/null 2>&1; done
[ -d "$RUN/deployments.bak" ] && { rm -rf deployments; cp -r "$RUN/deployments.bak" deployments; }
rm -rf .keys "$RUN"
echo "studio down"
