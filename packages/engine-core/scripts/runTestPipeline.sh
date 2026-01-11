#!/usr/bin/env bash
set -e

rm -rf policy-bundles decision-lineage artifacts

npx tsx scripts/snapshotDefaultPolicy.ts
npx tsx scripts/createTestArtifact.ts
npx tsx scripts/replayDecision.ts decision-lineage/*.lineage.json
