#!/usr/bin/env bash
set -e

echo "==> Building securelogic-api"

npm install
npm run build
