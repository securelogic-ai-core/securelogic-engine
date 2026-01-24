#!/usr/bin/env bash
set -euo pipefail

bad=$(grep -R 'import type { EngineInput } from ".*RunnerEngine\.js"' -n src/engine src/index.ts || true)

if [ -n "$bad" ]; then
  echo "❌ Forbidden import: EngineInput must come from contracts, not RunnerEngine"
  echo "$bad"
  exit 1
fi

echo "✅ Import guard passed"
