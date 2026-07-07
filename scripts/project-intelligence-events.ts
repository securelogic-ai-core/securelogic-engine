/**
 * project-intelligence-events.ts — Intelligence Pipeline Hardening / IE.P4 (on-demand).
 *
 * Project every global (organization_id IS NULL) cyber_signal that has not yet
 * contributed to a canonical Intelligence Event into the intelligence_events
 * layer (corroboration ledger + timeline), using the canonical projection core
 * (src/api/lib/signals/intelligenceEventStore.ts). Idempotent: re-running only
 * projects signals not already recorded as a contributing source. This is both
 * the initial backfill and the operator/cron entrypoint for ongoing projection.
 *
 *   npm run intelligence-events:project
 *   npx tsx scripts/project-intelligence-events.ts
 *
 * DARK: self-gates on SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED — with the flag
 * off (the default) it does zero DB work and reports skipped. GLOBAL data; uses
 * the elevated client.
 */

import { pgElevated } from "../src/api/infra/postgres.js";
import { projectUnprojectedGlobalSignals } from "../src/api/lib/signals/intelligenceEventStore.js";

const result = await projectUnprojectedGlobalSignals();

if (result.skipped === "disabled") {
  console.log(
    "[intelligence-events:project] SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED is off — nothing projected (dark)."
  );
} else {
  console.log(
    `[intelligence-events:project] projected ${result.projected} signal(s) — ` +
      `${result.created} new event(s), ${result.corroborated} corroboration(s)`
  );
}

await pgElevated.end();
