#!/usr/bin/env bash
# Jules environment setup for DocGuard.
#
# In Jules: this repository → Configuration → Initial Setup, enter
#     bash .jules/setup.sh
# and click "Run and Snapshot". Every later task starts from that snapshot.
#
# It fails, and so leaves no snapshot, unless the suite and guard are green
# here. The script it replaces ran `npm test || echo …`, so a red suite still
# became the baseline of every task: the agent then "fixes" failures CI never
# sees. It sets no credentials: nothing in DocGuard or its tests reads one.
#
# @implements docguard.jules-policy#FR-011
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "== toolchain"
node -v
npm -v
git --version
node -e 'const major = Number(process.versions.node.split(".")[0]); if (major < 18) { console.error("Node >= 18 required, found " + process.version); process.exit(1); }'

echo "== full history, as CI checks out (the freshness validator reads it)"
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  git fetch --unshallow --quiet origin
fi

echo "== dependencies, from the lockfile only (npm ci never rewrites it)"
npm ci --no-audit --no-fund

echo "== the suite must be green here before any routine runs"
npm test

echo "== guard on this repository: 0 (pass) or 2 (warnings), as CI accepts"
status=0
node cli/docguard.mjs guard > /dev/null || status=$?
if [ "$status" -ne 0 ] && [ "$status" -ne 2 ]; then
  echo "docguard guard exited $status" >&2
  exit 1
fi

echo "== leave the tree exactly as cloned (Jules refuses a dirty tree)"
git reset --hard --quiet HEAD
git clean -fd --quiet
test -z "$(git status --porcelain)"
echo "ready"
