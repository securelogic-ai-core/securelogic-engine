/**
 * backfill-brief-title-quality.ts — W0 (Brief content integrity).
 *
 * Repairs STORED brief item titles damaged by the legacy 77-char mid-word cap
 * (IQP Q4 defect #1), re-deriving each from its source signal with the
 * quality contract forced ON. Updates intelligence_brief_items.title and
 * keeps the brief's content_json / content_markdown snapshots consistent.
 * Items whose source signal was deleted are reported and left untouched —
 * their text is unrecoverable.
 *
 * DRY-RUN BY DEFAULT — prints what would change and writes nothing:
 *   npx tsx scripts/backfill-brief-title-quality.ts
 * Apply:
 *   npx tsx scripts/backfill-brief-title-quality.ts --apply
 *
 * Operator-owned; run on staging first (same discipline as the Q4 flag flip,
 * docs/validation/iqp-operator-ledger.md). Idempotent: repaired titles no
 * longer match the damage signature. Org-spanning maintenance pass; uses the
 * elevated client (same class as backfill-cluster-key.ts).
 */

import { pgElevated } from "../src/api/infra/postgres.js";
import { backfillBriefTitles } from "../src/api/lib/briefTitleBackfill.js";
import { signalSanitizeEnabled } from "../src/api/lib/signalSanitizeFeatureFlag.js";

const apply = process.argv.includes("--apply");

const result = await backfillBriefTitles(pgElevated, {
  apply,
  sanitizeEnabled: signalSanitizeEnabled(),
});

const mode = apply ? "APPLY" : "DRY-RUN";
console.log(
  `[brief-title:backfill] ${mode} — ${result.scanned} damaged titles scanned: ` +
    `${result.repairable} repairable, ${result.skippedNoSignal} skipped (source signal gone), ` +
    `${result.unchanged} unchanged after re-derivation`
);
if (apply) {
  console.log(
    `[brief-title:backfill] wrote ${result.itemsUpdated} item titles across ${result.briefsPatched} patched briefs`
  );
}
for (const s of result.sample) {
  console.log(`  brief ${s.briefId}\n    - ${s.oldTitle}\n    + ${s.newTitle}`);
}

await pgElevated.end();
