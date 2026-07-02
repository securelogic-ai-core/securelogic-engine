/**
 * backfill-cluster-key.ts — Priority 4 / Phase 4C / C2 (on-demand).
 *
 * Populate cyber_signals.cluster_key for existing rows using the canonical C1
 * function (src/api/lib/signals/clusterKey.ts). C2 does not stamp cluster_key at
 * the INSERT sites, so this is how the column is filled. Idempotent: re-running
 * only touches rows still NULL.
 *
 *   npm run cluster-key:backfill
 *   npx tsx scripts/backfill-cluster-key.ts
 *
 * GLOBAL data; uses the elevated client (same class as feedHealth.ts / the B3
 * reliability backfill).
 */

import { pgElevated } from "../src/api/infra/postgres.js";
import { backfillClusterKeys } from "../src/api/lib/signals/clusterKeyBackfill.js";

const result = await backfillClusterKeys(pgElevated);

console.log(
  `[cluster-key:backfill] scanned ${result.scanned} NULL rows — stamped ${result.stamped} with a cluster_key`
);

await pgElevated.end();
