#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f ".env.local" ]]; then
  echo "❌ .env.local missing"
  echo "   Create it with:"
  echo "   code .env.local"
  exit 1
fi

echo "-> Loading .env.local into current shell"
set -a
# shellcheck disable=SC1091
source ".env.local"
set +a

echo "✅ Loaded:"
echo "   SECURELOGIC_ADMIN_KEY=[SET]"
echo "   SECURELOGIC_SIGNING_SECRET=[SET]"