#!/usr/bin/env bash
set -e

if git diff --name-only HEAD~1 | grep "^packages/contracts/src"; then
  echo "⚠️ Contract files changed."
  echo "Ensure packages/contracts/package.json version was updated."
fi
