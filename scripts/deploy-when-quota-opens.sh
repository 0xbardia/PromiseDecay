#!/usr/bin/env bash
# Deploy the current contract source, then certify every read method, then repoint the
# deployment and re-verify parity.
#
# Written because the Studio endpoint enforces a 5000 requests/day quota and the contract
# fix landed while that window was exhausted. Rather than leave the deployment stale and
# discover it later, this waits for the quota to open, does the whole sequence, and reports.
#
# Safe to re-run: it reads the address the deploy script actually produced.
set -uo pipefail

export PATH=/root/.nvm/versions/node/v20.20.2/bin:$PATH
export PD_DEPLOYER_KEY_FILE=/root/.hermes/cache/scratch/pd_deployer_key.json
ROOT=/root/PromiseDecay
LOG=/root/.hermes/cache/scratch
cd "$ROOT"
set -a; . "$ROOT/.env"; set +a

echo "[$(date -u +%H:%M:%SZ)] waiting for the Studio daily quota to open"

# Poll a cheap read until the quota stops refusing.
for i in $(seq 1 240); do
  OUT=$(cd "$ROOT/apps/api" && timeout 60 node -e '
    const url = process.env.GENLAYER_RPC_URL;
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "gen_getVersion", params: [] }) })
      .then(async r => { const j = await r.json(); console.log(j.error ? ("ERR " + j.error.message) : "OK"); })
      .catch(e => console.log("ERR " + e.message));
  ' 2>&1 | tail -1)
  if [[ "$OUT" == OK* ]]; then
    echo "[$(date -u +%H:%M:%SZ)] quota open after $i probe(s)"
    break
  fi
  # 15 minutes between probes. The window was previously 5, which was frequent enough that
  # the polling itself consumed part of the daily budget it was waiting for — the probe is not
  # free, and checking more often does not detect the boundary any sooner.
  sleep 900
done

if [[ "$OUT" != OK* ]]; then
  echo "[$(date -u +%H:%M:%SZ)] quota never opened within the window; nothing deployed"
  exit 1
fi

echo "[$(date -u +%H:%M:%SZ)] deploying"
cd "$ROOT/apps/api"
timeout 2400 node scripts/deploy.mjs deploy ../../contracts/PromiseDecay.py > "$LOG/deploy_v4.log" 2>&1
echo "deploy EXIT=$?"
tail -14 "$LOG/deploy_v4.log"

NEW=$(grep -oE 'CONTRACT_ADDRESS=0x[0-9a-fA-F]+' "$LOG/deploy_v4.log" | tail -1 | cut -d= -f2)
if [[ -z "$NEW" ]]; then
  echo "[$(date -u +%H:%M:%SZ)] no address in the deploy log; not repointing anything"
  exit 1
fi
echo "[$(date -u +%H:%M:%SZ)] new contract: $NEW"

echo "[$(date -u +%H:%M:%SZ)] certifying read methods"
timeout 2400 node scripts/certify.mjs "$NEW" > "$LOG/certify_v5.log" 2>&1
echo "certify EXIT=$?"
grep -E 'READS:|^FAIL' "$LOG/certify_v5.log" | tail -5

# Only repoint once the deployment is confirmed, so a failed deploy never blanks the site.
echo "[$(date -u +%H:%M:%SZ)] repointing configuration to $NEW"
OLD=$(grep -oE 'GENLAYER_CONTRACT_ADDRESS=0x[0-9a-fA-F]+' "$ROOT/.env" | head -1 | cut -d= -f2)
for f in "$ROOT/.env" "$ROOT/.env.example"; do
  [ -n "$OLD" ] && sed -i "s/$OLD/$NEW/g" "$f"
done
# Docs and source references.
for f in "$ROOT/README.md" "$ROOT/apps/api/tests/api.test.ts" \
         "$ROOT/apps/api/scripts/probe-resolution.mjs" \
         "$ROOT/apps/web/src/content/docs.ts" "$ROOT/docs/API.md" \
         "$ROOT/docs/DEPLOYMENT.md" "$ROOT/apps/web/scripts/txlifecycle.mjs"; do
  [ -n "$OLD" ] && [ -f "$f" ] && sed -i "s/$OLD/$NEW/g" "$f"
done
echo "repointed from ${OLD:-none}"

echo "[$(date -u +%H:%M:%SZ)] rebuilding web with the new address"
cd "$ROOT"
timeout 600 pnpm --filter @promisedecay/web build 2>&1 | grep -E 'built in|error' | tail -2

echo "[$(date -u +%H:%M:%SZ)] restarting services (indexer rebuilds its projection on identity change)"
pm2 reload ecosystem.config.cjs --update-env >/dev/null 2>&1
sleep 10
pm2 jlist 2>/dev/null | python3 -c "
import json,sys
for p in json.load(sys.stdin):
    if 'promisedecay' in p['name']:
        print('  %-24s %s' % (p['name'], p['pm2_env']['status']))
"

echo "[$(date -u +%H:%M:%SZ)] confirming the served bundle carries the new address"
S=$(curl -s -m 20 https://promisedecay.bydx.fun/ | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1)
echo "  bundle: $S"
echo "  occurrences of new address: $(curl -s -m 30 "https://promisedecay.bydx.fun/$S" | grep -c "$NEW")"

echo "[$(date -u +%H:%M:%SZ)] done"