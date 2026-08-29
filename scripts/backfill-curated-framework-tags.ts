/**
 * Backfill: apply curated scope tags to framework rows that already exist, and
 * mark genuinely unclassified rows 'uncurated'.
 *
 * Run:  npx tsx scripts/backfill-curated-framework-tags.ts [--apply]
 *
 * Dry run by default — it prints the exact row changes and writes nothing.
 * Pass --apply to commit them.
 *
 * ── Why a script and not SQL in the migration ────────────────────────────────
 * Deciding whether a historical row was a genuine heuristic match or the `core`
 * fallback requires re-deriving it through the SAME patterns the application
 * uses. Encoding those regexes in a migration would be their THIRD copy (after
 * the module and the 20260926 backfill), and the failure mode of a drifted copy
 * is silent: two different questionnaires for one corpus. This script imports
 * the module, so it cannot drift from it.
 *
 * ── What it does, in order ───────────────────────────────────────────────────
 *   1. CURATE — for every framework row matching a curated template's canonical
 *      (name, version), set the curated tags + source='curated' on each
 *      requirement whose reference_id appears in the curated map.
 *   2. RECLASSIFY — for every remaining row still stamped 'heuristic', re-derive
 *      its tags; if nothing matched and it holds `core` by fallback alone, stamp
 *      it 'uncurated'. Tags are NOT changed by this step, only the claim about
 *      where they came from.
 *
 * ── What it will not do ──────────────────────────────────────────────────────
 *   - It never overwrites a row already stamped 'curated'. A human's decision
 *     outranks this file, always.
 *   - It never edits tags in step 2. Reclassification is about provenance.
 *   - It does not touch the SOC 2 / NIST CSF corpus beyond step 2's provenance
 *     stamp. Re-curating those tags changes what existing security
 *     questionnaires ask on re-resolve and needs its own regression analysis.
 *
 * Idempotent: a second run reports zero changes.
 */

import pg from "pg";

import { FRAMEWORK_TEMPLATES } from "../src/api/lib/frameworkTemplates.js";
import { resolvePgSsl } from "../src/api/infra/pgSsl.js";
import {
  CURATED_FRAMEWORK_TAGS,
  CURATED_TEMPLATE_KEYS,
} from "../src/api/lib/vendorRisk/curatedFrameworkTags.js";
import { deriveScopeTags } from "../src/api/lib/vendorRisk/requirementScopeTags.js";

const APPLY = process.argv.includes("--apply");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: resolvePgSsl() });

const sameTags = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

async function main(): Promise<void> {
  const client = await pool.connect();
  let curated = 0;
  let reclassified = 0;
  /**
   * Rows step 1 claims. Step 2 must skip them EVEN IN DRY RUN: on a real apply
   * they are already 'curated' by the time step 2 queries, so counting them as
   * "would reclassify" would make the preview describe work the apply never
   * does.
   */
  const claimedByCuration = new Set<string>();

  try {
    console.log(APPLY ? "MODE: apply (writes)" : "MODE: dry run (no writes)");

    // ── 1. Curate the shipped regulatory templates ──────────────────────────
    for (const key of CURATED_TEMPLATE_KEYS) {
      const template = FRAMEWORK_TEMPLATES[key];
      if (!template) {
        console.error(`  [BUG] curated template key '${key}' is not in FRAMEWORK_TEMPLATES`);
        process.exitCode = 1;
        continue;
      }
      const entries = CURATED_FRAMEWORK_TAGS[key]!;

      // Frameworks are identified by their canonical (name, version) — the same
      // pair frameworkActivation upserts on. Many orgs may hold one each.
      const frameworks = await client.query<{ id: string; organization_id: string }>(
        `SELECT id, organization_id FROM frameworks WHERE name = $1 AND version = $2`,
        [template.name, template.version]
      );

      if (frameworks.rowCount === 0) {
        console.log(`  [SKIP] ${key} (${template.name} ${template.version}) — not activated anywhere`);
        continue;
      }

      for (const fw of frameworks.rows) {
        for (const [referenceId, entry] of Object.entries(entries)) {
          const existing = await client.query<{
            id: string;
            scope_tags: string[];
            scope_tags_source: string | null;
          }>(
            `SELECT id, COALESCE(scope_tags,'{}') AS scope_tags, scope_tags_source
               FROM requirements
              WHERE framework_id = $1 AND reference_id = $2`,
            [fw.id, referenceId]
          );

          const row = existing.rows[0];
          if (!row) continue; // requirement not instantiated in this org

          if (
            row.scope_tags_source === "curated" &&
            sameTags(row.scope_tags, entry.tags)
          ) {
            continue; // already exactly what we would write
          }

          if (row.scope_tags_source === "curated") {
            // Someone curated this row by hand to something else. Their call wins.
            console.log(
              `  [KEEP]  ${key}/${referenceId} org=${fw.organization_id} — hand-curated to [${row.scope_tags}], leaving it`
            );
            continue;
          }

          console.log(
            `  [CURATE] ${key}/${referenceId} org=${fw.organization_id} ` +
              `[${row.scope_tags}] (${row.scope_tags_source}) -> [${entry.tags}] (curated, domain=${entry.domain})`
          );
          curated++;
          claimedByCuration.add(row.id);

          if (APPLY) {
            await client.query(
              `UPDATE requirements
                  SET scope_tags = $1, scope_tags_source = 'curated', scope_tags_at = NOW()
                WHERE id = $2`,
              [[...entry.tags], row.id]
            );
          }
        }
      }
    }

    // ── 2. Reclassify fallback rows as 'uncurated' ──────────────────────────
    const heuristicRows = await client.query<{
      id: string;
      reference_id: string;
      title: string;
      scope_tags: string[];
    }>(
      `SELECT id, reference_id, title, COALESCE(scope_tags,'{}') AS scope_tags
         FROM requirements
        WHERE scope_tags_source = 'heuristic'`
    );

    for (const row of heuristicRows.rows) {
      if (claimedByCuration.has(row.id)) continue;
      const derived = deriveScopeTags({
        reference_id: row.reference_id,
        title: row.title,
      });
      if (!derived.fallback_applied) continue;

      reclassified++;
      if (APPLY) {
        await client.query(
          `UPDATE requirements SET scope_tags_source = 'uncurated' WHERE id = $1`,
          [row.id]
        );
      }
    }

    console.log(
      `\n${APPLY ? "APPLIED" : "WOULD APPLY"}: ${curated} curated, ${reclassified} reclassified as uncurated ` +
        `(of ${heuristicRows.rowCount} heuristic rows examined)`
    );
    if (!APPLY) console.log("Re-run with --apply to write.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
