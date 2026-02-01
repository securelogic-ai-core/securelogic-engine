#!/usr/bin/env bash
set -euo pipefail

echo "==> Building securelogic-api only"
cd securelogic-api
npm ci
npm run build
