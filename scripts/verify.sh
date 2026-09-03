#!/usr/bin/env bash
# Compiles lib/ to plain ESM in .verify/ and runs both verifiers:
#   verify.mjs          — the engine: do the clauses hold?
#   verify-surface.mjs  — the registration layer: are absent tools really absent?
#                          (also: the stand-in against it, and the two negotiators)
#   verify-bridge.mjs   — the cross-origin bridge: does exposedTo / fromOrigins hold?
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf .verify
npx tsc lib/engine.ts lib/types.ts lib/webmcp.ts lib/tools.ts lib/scenario.ts lib/standin.ts lib/agent.ts lib/negotiate.ts \
  --outDir .verify --module esnext --target es2022 --moduleResolution bundler --skipLibCheck
sed -i -E 's|from "\./([a-z]+)"|from "./\1.js"|g' .verify/*.js
echo '{"type":"module"}' > .verify/package.json
node scripts/verify.mjs
echo
node scripts/verify-surface.mjs
echo
node scripts/verify-bridge.mjs
rm -rf .verify
