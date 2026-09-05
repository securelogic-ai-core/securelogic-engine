/**
 * cleanup-walkthrough-fixtures.mjs — targeted synthetic-fixture cleanup for the
 * STAGING walkthrough validation org.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Repeated deployed-staging validation journeys each create a vendor, and the
 * platform provides NO way to release monitored-entity capacity for a vendor:
 * `entityLimit.ts` counts rows in `vendors` + `ai_systems` against
 * `organizations.max_monitored_entities` and explicitly excludes `vendors.status`
 * from the count ("to stop paying for one, delete it") — but there is no
 * `DELETE /api/vendors` route anywhere in the engine. Archiving frees nothing.
 * The walkthrough org therefore fills to its cap and the next journey run dies
 * on `entity_limit_reached`.
 *
 * That is a real product defect, tracked separately in
 * `docs/backlog/FIXTURE-LIFECYCLE-1-monitored-entity-exhaustion.md`.
 * THIS SCRIPT IS NOT ITS CLOSURE. It is staging-fixture maintenance only.
 *
 * WHY IT USES DIRECT SQL
 * ──────────────────────
 * Because no application deletion path exists to use. The order below mirrors
 * the already-approved teardown in `seed-walkthrough-org.ts`, including its
 * transaction-scoped WORM-trigger disable — DDL is transactional in Postgres,
 * so a failure anywhere ROLLBACKs and restores every trigger automatically.
 * Unlike that teardown, this script is TARGETED: it never touches the org
 * wholesale, and it refuses to run against anything but the staging seed org.
 *
 * SAFETY MODEL
 * ────────────
 * Nothing is deleted unless it passes EVERY one of these, re-evaluated inside
 * the transaction and not merely at selection time:
 *   1. organization_id is exactly the staging walkthrough seed org;
 *   2. the name matches an anchored harness pattern carrying a machine
 *      timestamp (see FIXTURE_RULE) — no human types these;
 *   3. it is not on the EXCLUDED list (records cited by name in a signed-off
 *      validation document — preserved as AMBIGUOUS by owner instruction);
 *   4. it was created AFTER the WA-3 freeze provenance instant, and owns no
 *      engagement created before it, so it cannot intersect the frozen corpus;
 *   5. it carries no finding, no vendor_assessment and no vendor_review —
 *      nothing consequential hangs off it.
 * Any violation aborts the whole run. The default mode is a DRY RUN; deleting
 * requires --apply.
 *
 * Usage (as a Render job on securelogic-engine-staging, which supplies
 * MIGRATION_DATABASE_URL — table ownership is required for the trigger DDL):
 *   node cleanup-walkthrough-fixtures.mjs            # dry run, prints the plan
 *   node cleanup-walkthrough-fixtures.mjs --apply    # executes
 */
import pg from "pg";

const ORG = "295b989a-89d6-49ec-a7ed-deb04489d068"; // [SEED] Walkthrough Org, staging
const ORG_NAME = "[SEED] Walkthrough Org";

/**
 * The deterministic fixture-selection rule.
 *
 * Every alternative is a harness-generated prefix followed by a machine
 * timestamp (`YYYYMMDDTHHMMSS` from `new Date().toISOString()`, or an epoch-ms
 * integer), anchored at both ends. The prefixes are literals lifted from the
 * journey scripts themselves:
 *   wa1-response-completeness-staging-journey.mjs:66   `WA1 journey ${STAMP}`
 *   wa2-decision-transparency-staging-journey.mjs:64   `WA2 journey ${STAMP}`
 *   wa3-vendor-facing-language-staging-journey.mjs:97  `WA3 journey harness`
 *   wa3-…:118 + its draft/issued pair                  `WA3 issued|draft ${STAMP}`
 *   assessment-composition-staging-journey.mjs:41      `Walkthrough Payments ${STAMP}`
 *
 * It is deliberately NOT age-based and NOT creation-order-based. A real vendor
 * named "Stripe", "Microsoft" or "Harbourline Data Services" cannot match it,
 * and neither can a human-created vendor of any name, because the trailing
 * machine timestamp is mandatory in every alternative but the one fixed
 * harness-constant string.
 */
const FIXTURE_RULE =
  String.raw`^(WA1 journey|WA2 journey|Walkthrough Payments) [0-9]{8}T[0-9]{6}$` +
  String.raw`|^WA3 (issued|draft) [0-9]{8}T[0-9]{6}$` +
  String.raw`|^WA3 corrected-corpus [0-9]{13}$` +
  String.raw`|^WA3 journey harness$`;

/**
 * AMBIGUOUS — matched by the rule, deliberately NOT deleted.
 *
 * Each of these has an engagement whose id is cited by name in a signed-off
 * validation record. The citations are illustrative rather than load-bearing,
 * but a record named in a signed-off document is ambiguous by any reasonable
 * reading, and the owner instruction is explicit: do not delete ambiguous rows.
 */
const EXCLUDED = [
  // engagement 57d4d327 — docs/validation/wa3-historical-corpus-determination-2026-09-05.md:127
  "Walkthrough Payments 20260904T145113",
  // engagement 7c317105 — same line
  "Walkthrough Payments 20260904T150050",
  // engagement d7173d50 — docs/validation/assessment-composition-v1-2026-09-04.md:22 (hydration probe)
  "Walkthrough Payments 20260904T175500",
];

/** The WA-3 freeze provenance instant. Nothing older may be selected. */
const FREEZE_INSTANT = "2026-08-28T18:06:54Z";

/**
 * WORM triggers that RAISE on DELETE anywhere in the vendor spine, including on
 * FK *cascade* deletes — Postgres fires row triggers on cascades. Disabled for
 * the span of the transaction only, exactly as seed-walkthrough-org.ts does.
 *
 * This list is DERIVED, not guessed: it is every non-internal row trigger with
 * a DELETE event on any table in the FK cascade closure of `vendors` /
 * `vendor_engagements` / `vendor_relationships`, read from `pg_trigger`
 * (`tgtype & 8`) on staging. `security_audit_log` is outside that closure and
 * is carried anyway, matching the approved teardown.
 */
const WORM_TRIGGERS = [
  ["engagement_applicability", "prevent_engagement_applicability_row_mutation"],
  ["vendor_engagement_applicability_challenges", "prevent_vendor_engagement_applicability_challenges_row_mutation"],
  ["vendor_engagement_composition_snapshots", "prevent_vendor_engagement_composition_snapshots_row_mutation"],
  ["vendor_engagement_relationship_reseeds", "trg_vendor_engagement_relationship_reseeds_worm"],
  ["vendor_relationship_intake", "prevent_vendor_relationship_intake_row_mutation"],
  ["security_audit_log", "prevent_security_audit_log_row_mutation"],
];

const APPLY = process.argv.includes("--apply");
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
const pool = new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 2 });

const report = { mode: APPLY ? "apply" : "dry-run", rule: FIXTURE_RULE, excluded: EXCLUDED };
const fail = (msg) => {
  report.aborted = msg;
  console.log("CLEANUP::" + JSON.stringify(report));
  process.exit(1);
};

const client = await pool.connect();
try {
  const org = await client.query(`SELECT name, max_monitored_entities AS cap FROM organizations WHERE id = $1`, [ORG]);
  if (org.rowCount !== 1 || org.rows[0].name !== ORG_NAME) {
    fail(`refusing: org ${ORG} is not "${ORG_NAME}" (found ${org.rows[0]?.name ?? "nothing"})`);
  }
  report.cap = org.rows[0].cap;

  const countBoth = async () => (await client.query(
    `SELECT (SELECT COUNT(*)::int FROM vendors WHERE organization_id=$1) AS vendors,
            (SELECT COUNT(*)::int FROM ai_systems WHERE organization_id=$1) AS ai_systems`, [ORG])).rows[0];
  report.before = await countBoth();

  await client.query("BEGIN");

  // ── Selection, inside the transaction ────────────────────────────────────
  const sel = await client.query(
    `SELECT id, name, status, created_at FROM vendors
      WHERE organization_id = $1 AND name ~ $2 AND NOT (name = ANY($3::text[]))
      ORDER BY created_at`,
    [ORG, FIXTURE_RULE, EXCLUDED]
  );
  const ids = sel.rows.map((r) => r.id);
  report.selected = sel.rows.map((r) => ({ id: r.id, name: r.name, status: r.status }));
  report.selected_count = ids.length;

  const preserved = await client.query(
    `SELECT name FROM vendors WHERE organization_id=$1 AND NOT (name ~ $2) ORDER BY created_at`, [ORG, FIXTURE_RULE]);
  report.preserved_not_matching_rule = preserved.rows.map((r) => r.name);

  if (ids.length === 0) fail("selection is empty — nothing to do");

  // ── Guards, re-proved on the selected ids themselves ─────────────────────
  const guard = async (name, sql) => {
    const n = (await client.query(sql, [ORG, ids])).rows[0].violations;
    report[`guard_${name}`] = n;
    if (n !== 0) fail(`guard ${name} tripped: ${n} violation(s)`);
  };
  await guard("wrong_org", `SELECT COUNT(*)::int AS violations FROM vendors WHERE id = ANY($2::uuid[]) AND organization_id <> $1`);
  await guard("predates_freeze", `
    SELECT COUNT(*)::int AS violations FROM vendors v
     WHERE v.organization_id=$1 AND v.id = ANY($2::uuid[])
       AND (v.created_at < TIMESTAMPTZ '${FREEZE_INSTANT}'
         OR EXISTS (SELECT 1 FROM vendor_engagements e WHERE e.vendor_id=v.id
                     AND e.created_at < TIMESTAMPTZ '${FREEZE_INSTANT}'))`);
  await guard("consequential", `
    SELECT COUNT(*)::int AS violations FROM vendors v
     WHERE v.organization_id=$1 AND v.id = ANY($2::uuid[])
       AND (EXISTS (SELECT 1 FROM vendor_assessments a WHERE a.vendor_id=v.id)
         OR EXISTS (SELECT 1 FROM vendor_reviews  w WHERE w.vendor_id=v.id)
         OR EXISTS (SELECT 1 FROM findings f JOIN vendor_engagements e ON e.id::text=f.source_id::text
                     WHERE f.organization_id=v.organization_id
                       AND f.source_type='vendor_engagement' AND e.vendor_id=v.id))`);

  // ── What comes with them ─────────────────────────────────────────────────
  const cascade = await client.query(
    `SELECT (SELECT COUNT(*)::int FROM vendor_engagements   WHERE vendor_id = ANY($1::uuid[])) AS engagements,
            (SELECT COUNT(*)::int FROM vendor_relationships WHERE vendor_id = ANY($1::uuid[])) AS relationships,
            (SELECT COUNT(*)::int FROM vendor_contacts      WHERE vendor_id = ANY($1::uuid[])) AS contacts,
            (SELECT COUNT(*)::int FROM vendor_engagement_scope_items si
               JOIN vendor_engagements e ON e.id=si.engagement_id WHERE e.vendor_id = ANY($1::uuid[])) AS scope_items,
            (SELECT COUNT(*)::int FROM requirement_responses rr
               JOIN vendor_engagements e ON e.id=rr.engagement_id WHERE e.vendor_id = ANY($1::uuid[])) AS responses`,
    [ids]
  );
  report.cascades = cascade.rows[0];

  if (!APPLY) {
    await client.query("ROLLBACK");
    report.after = report.before;
    report.note = "DRY RUN — transaction rolled back, nothing deleted";
    console.log("CLEANUP::" + JSON.stringify(report));
    process.exit(0);
  }

  // ── Delete, FK order mirroring seed-walkthrough-org.ts:teardown ──────────
  for (const [t, trg] of WORM_TRIGGERS) await client.query(`ALTER TABLE ${t} DISABLE TRIGGER ${trg}`);

  const deleted = {};
  const del = async (k, sql, params) => { deleted[k] = (await client.query(sql, params)).rowCount ?? 0; };

  // Engagements first: RESTRICT on vendors.vendor_id and on relationships.
  // Their children (scope items, responses, evidence, snapshots, challenges,
  // reseeds, invites, portal sessions, comments) are all ON DELETE CASCADE.
  await del("engagements", `DELETE FROM vendor_engagements WHERE vendor_id = ANY($1::uuid[])`, [ids]);

  // Relationships. The intake rows go with them via
  // `vendor_relationship_intake.relationship_id ON DELETE CASCADE`, and that is
  // the ONLY correct order: `vendor_relationships.classification_intake_id` is
  // RESTRICT, so the intake cannot be removed while its relationship still
  // exists — and the pointer cannot be NULLed out of the way first either,
  // because CHECK `vendor_relationships_classification_provenance` requires a
  // classified relationship to name the intake it was classified from.
  await del("relationships", `DELETE FROM vendor_relationships WHERE vendor_id = ANY($1::uuid[])`, [ids]);

  // Remaining vendor children that do not cascade cleanly on their own.
  await del("assurance_documents", `DELETE FROM vendor_assurance_documents WHERE vendor_id = ANY($1::uuid[])`, [ids]);
  await del("contacts", `DELETE FROM vendor_contacts WHERE vendor_id = ANY($1::uuid[])`, [ids]);
  await del("signal_links", `DELETE FROM signal_vendor_links WHERE vendor_id = ANY($1::uuid[])`, [ids]);
  await del("ai_dependencies", `DELETE FROM ai_system_vendor_dependencies WHERE vendor_id = ANY($1::uuid[])`, [ids]);

  await del("vendors", `DELETE FROM vendors WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [ORG, ids]);
  report.deleted = deleted;

  if (deleted.vendors !== ids.length) fail(`deleted ${deleted.vendors} vendors but selected ${ids.length}`);

  // Post-condition: the survivors are exactly the ones we said we would keep.
  const left = await client.query(`SELECT COUNT(*)::int AS n FROM vendors WHERE organization_id=$1`, [ORG]);
  report.after_vendors = left.rows[0].n;
  if (report.after_vendors !== report.before.vendors - ids.length) {
    fail(`post-condition: expected ${report.before.vendors - ids.length} vendors, found ${report.after_vendors}`);
  }

  for (const [t, trg] of WORM_TRIGGERS) await client.query(`ALTER TABLE ${t} ENABLE TRIGGER ${trg}`);
  await client.query("COMMIT");

  report.after = await countBoth();
  report.remaining_capacity = report.cap - (report.after.vendors + report.after.ai_systems);
  console.log("CLEANUP::" + JSON.stringify(report));
} catch (err) {
  try { await client.query("ROLLBACK"); } catch { /* ignore */ }
  report.error = String(err.message).slice(0, 500);
  console.log("CLEANUP::" + JSON.stringify(report));
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
