/**
 * recompute-source-reliability.ts — Priority 4 / Phase 4B / B3 (on-demand).
 *
 * Manually recompute `sources.reliability` from the GLOBAL `feed_health`
 * snapshot using the canonical scorer (src/api/lib/signals/sourceReliability.ts).
 *
 * B3 ships this as the ONLY way reliability gets populated — there is no
 * automatic/scheduler trigger (that is deferred to B4). Intended for operator
 * use in STAGING to validate computed values. Idempotent: rerunning simply
 * recomputes and overwrites from the current snapshot.
 *
 *   npm run reliability:recompute        (sources .env.local, then runs)
 *   npx tsx scripts/recompute-source-reliability.ts
 *
 * Uses the GLOBAL elevated client (same access class as feedHealth.ts).
 */

import { pgElevated } from "../src/api/infra/postgres.js";
import { recomputeSourceReliability } from "../src/api/lib/signals/sourceReliability.js";

const result = await recomputeSourceReliability(pgElevated);

console.log(
  `[reliability:recompute] recomputed sources.reliability — ${result.updated}/${result.total} rows updated`
);

await pgElevated.end();
