#!/usr/bin/env bash
set -e

echo "Checking prerequisites..."

[ -d artifacts ] || { echo "Missing artifacts/"; exit 1; }
[ -d runs ] || { echo "Missing runs/"; exit 1; }
command -v jq >/dev/null || { echo "jq missing"; exit 1; }

echo "READY"
