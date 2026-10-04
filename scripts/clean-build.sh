#!/usr/bin/env bash
# Clean build gate.
#
# Written after a build check that reported PASS on five packages that produced no output at
# all: the check grepped for "error|failed" while the real failure printed "spawn ENOENT" and
# "ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL", and it ignored the exit code entirely. Five empty
# directories were reported as five clean builds.
#
# A build gate must assert on artifacts, not on the absence of a scary word.
#
# NOTE: this script unsets NODE_ENV. The repo's .env sets NODE_ENV=production, and if that
# leaks into the shell pnpm skips every devDependency — so typescript, eslint, vitest and
# playwright silently vanish and every subsequent build fails with "tsc: not found".
set -uo pipefail
cd "$(dirname "$0")/.."
export PATH=/root/.nvm/versions/node/v20.20.2/bin:$PATH
unset NODE_ENV

FAIL=0

echo "=== toolchain present ==="
for bin in tsc eslint; do
  if [[ -x "node_modules/.bin/$bin" ]]; then echo "  OK   $bin"; else echo "  FAIL $bin missing"; FAIL=1; fi
done
if [[ -z "${NODE_ENV:-}" ]]; then echo "  OK   NODE_ENV unset (devDependencies included)"; else echo "  FAIL NODE_ENV=${NODE_ENV} will prune devDeps"; FAIL=1; fi

# build <package> <artifact-that-must-exist>
build() {
  local pkg="$1" artifact="$2"
  local out rc
  out=$(timeout 600 pnpm --filter "@promisedecay/$pkg" build 2>&1)
  rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "  FAIL $pkg (exit $rc)"
    echo "$out" | tail -5 | sed 's/^/         /'
    FAIL=1
  elif [[ ! -e "$artifact" ]]; then
    echo "  FAIL $pkg: exit 0 but $artifact is missing"
    FAIL=1
  else
    echo "  OK   $pkg -> $artifact"
  fi
}

echo
echo "=== builds (exit code AND artifact must both be good) ==="
build domain   packages/domain/dist/index.js
build config   packages/config/dist/index.js
build api      apps/api/dist/main.js
build indexer  apps/indexer/dist/worker.js
build web      apps/web/dist/index.html

echo
echo "=== declarations required by package exports ==="
for d in apps/api/dist/indexer/sync.d.ts apps/api/dist/chain/reader.d.ts \
         packages/domain/dist/index.d.ts packages/config/dist/index.d.ts; do
  if [[ -e "$d" ]]; then echo "  OK   $d"; else echo "  FAIL $d missing"; FAIL=1; fi
done

echo
echo "=== indexer must resolve @promisedecay/api against compiled output ==="
if [[ -f apps/indexer/dist/worker.js ]]; then
  RAW=$(grep -oE 'from *"[^"]*promisedecay[^"]*"' apps/indexer/dist/worker.js | grep -c '\.ts"' || true)
  echo "  indexer imports referencing .ts source: ${RAW:-0} (must be 0)"
  [[ "${RAW:-0}" != "0" ]] && FAIL=1
  node -e "require.resolve('@promisedecay/api/indexer/sync',{paths:['apps/indexer']})" 2>/dev/null \
    && echo "  OK   @promisedecay/api/indexer/sync resolves" \
    || { echo "  FAIL @promisedecay/api/indexer/sync does not resolve"; FAIL=1; }
fi

echo
if [[ $FAIL -eq 0 ]]; then echo "CLEAN BUILD: PASS"; else echo "CLEAN BUILD: FAIL"; fi
exit $FAIL