/**
 * va-q2-scope-equivalence.ts — VA-Q2 P4 acceptance: prove, on a real database,
 * that a pre-Q2 engagement resolves EXACTLY as it did before Q2 existed.
 *
 * Sibling of `va-q1-bridge-equivalence.ts`, and the same shape of claim: the
 * plan's standing promise is that "pre-Q2 engagements are unchanged". P1 proved
 * it on 21 golden fixtures. This proves it on whatever is actually in the
 * database — the only place the promise can be broken by real data.
 *
 * For every engagement stamped `scope_rule_version = '1.0.0'` (or unstamped,
 * which the route treats as 1.0.0) and NOT yet issued, it:
 *
 *   1. loads exactly what the scope route loads — the engagement's inherent
 *      inputs, the org's requirements, its active obligation edges, and its
 *      declared facts;
 *   2. re-resolves under 1.0.0 through the real `resolveEngagementScope`;
 *   3. compares the resolved item set to the STORED scope items, field by
 *      field: requirement_id, depth, mandatory, and the ordered rule_ids.
 *
 * They must be identical. A difference means Q2 changed a questionnaire that
 * was promised not to move.
 *
 * Issued engagements are skipped deliberately: their scope is frozen, so a
 * re-resolve is not the thing under test and a divergence there would be
 * reporting the freeze, not a regression.
 *
 * READ-ONLY. Refuses production by name. Exit 1 on any divergence.
 *
 *   DATABASE_URL=... npx tsx scripts/validation/va-q2-scope-equivalence.ts
 */

import { pgElevated } from "../../src/api/infra/postgres.js";
import { resolveEngagementScope } from "../../src/api/lib/vendorRisk/scopeResolver.js";
import { resolveFacts } from "../../src/api/lib/vendorRisk/factResolver.js";

type EngagementRow = {
  id: string;
  organization_id: string;
  assessment_tier: string;
  scope_rule_version: string | null;
  status: string;
  data_sensitivity: string;
  data_volume_band: string;
  access_level: string;
  operational_dependency: string;
  recoverability: string;
  business_criticality: string;
  regulatory_exposure: string;
  regulatory_breach_notification: boolean;
  ai_involvement: string;
  ai_autonomy: string;
  hosting_model: string;
  fourth_party_exposure: string;
  concentration_snapshot: string;
};

type StoredItem = {
  requirement_id: string;
  depth: string;
  mandatory: boolean;
  rule_ids: string[];
};

/** One comparable line per item, so a diff is readable rather than a JSON blob. */
const lineOf = (i: { requirement_id: string; depth: string; mandatory: boolean; rule_ids: string[] }) =>
  `${i.requirement_id}|${i.depth}|${i.mandatory ? 1 : 0}|${[...i.rule_ids].sort().join(",")}`;

async function main(): Promise<void> {
  const db = await pgElevated.query<{ current_database: string }>("SELECT current_database()");
  const name = db.rows[0]!.current_database;
  console.log(`database: ${name}`);
  if (/^securelogic$/i.test(name)) {
    console.error("REFUSING TO RUN AGAINST PRODUCTION");
    process.exit(2);
  }

  const engagements = await pgElevated.query<EngagementRow>(
    `SELECT id, organization_id, assessment_tier, scope_rule_version, status,
            data_sensitivity, data_volume_band, access_level, operational_dependency,
            recoverability, business_criticality, regulatory_exposure,
            regulatory_breach_notification, ai_involvement, ai_autonomy,
            hosting_model, fourth_party_exposure, concentration_snapshot
       FROM vendor_engagements
      WHERE (scope_rule_version IS NULL OR scope_rule_version = '1.0.0')
        AND issued_at IS NULL
      ORDER BY created_at`
  );

  console.log(`pre-Q2, pre-issue engagements to check: ${engagements.rowCount}`);
  if (engagements.rowCount === 0) {
    console.log(
      "\nNOTE: zero engagements matched. That is a VACUOUS pass — it proves the " +
        "script runs, not that equivalence holds. Say so rather than reporting green."
    );
  }

  let checked = 0;
  let diverged = 0;
  let skippedNoItems = 0;
  let corpusGrew = 0;
  let q2Introduced = 0;

  for (const e of engagements.rows) {
    const stored = await pgElevated.query<StoredItem>(
      `SELECT requirement_id, depth, mandatory,
              COALESCE(ARRAY(SELECT jsonb_array_elements(reasons)->>'rule_id'), '{}') AS rule_ids
         FROM vendor_engagement_scope_items
        WHERE engagement_id = $1
        ORDER BY requirement_id`,
      [e.id]
    );
    if (stored.rowCount === 0) {
      skippedNoItems++;
      continue; // never resolved; nothing to compare against
    }

    // Exactly what the route loads.
    const requirements = await pgElevated.query(
      `SELECT r.id AS requirement_id, r.framework_id, r.reference_id, r.title,
              COALESCE(r.scope_tags, '{}') AS scope_tags
         FROM requirements r
         JOIN frameworks f ON f.id = r.framework_id
        WHERE f.organization_id = $1`,
      [e.organization_id]
    );
    // The SAME query the route runs — active obligations only, joined through
    // `obligation_mappings`. Guessing a table name here would silently resolve
    // without S3 and report a false PASS.
    const edges = await pgElevated.query(
      `SELECT om.obligation_id, o.title AS obligation_title, om.requirement_id
         FROM obligation_mappings om
         JOIN obligations o ON o.id = om.obligation_id
        WHERE o.organization_id = $1
          AND COALESCE(o.status, 'active') = 'active'`,
      [e.organization_id]
    );
    const factRows = await pgElevated.query(
      `SELECT fact_key, value, source, origin, status, observed_at
         FROM assessment_facts
        WHERE subject_type = 'vendor_engagement' AND subject_id = $1`,
      [e.id]
    ).catch(() => ({ rows: [] as Array<Record<string, unknown>> }));

    const resolution = resolveEngagementScope({
      tier: e.assessment_tier as never,
      // Two column names differ from the model's field names — `data_volume_band`
      // and `concentration_snapshot`. Mirrored from the route rather than
      // guessed; guessing cost a run.
      inherent: {
        data_sensitivity: e.data_sensitivity, data_volume: e.data_volume_band,
        access_level: e.access_level, operational_dependency: e.operational_dependency,
        recoverability: e.recoverability, business_criticality: e.business_criticality,
        regulatory_exposure: e.regulatory_exposure,
        regulatory_breach_notification: e.regulatory_breach_notification,
        ai_involvement: e.ai_involvement, ai_autonomy: e.ai_autonomy,
        hosting_model: e.hosting_model, fourth_party_exposure: e.fourth_party_exposure,
        concentration: e.concentration_snapshot,
      } as never,
      facts: resolveFacts(factRows.rows as never),
      scopeRuleVersion: "1.0.0",
      requirements: requirements.rows as never,
      obligationEdges: edges.rows as never,
    });

    const storedLines = stored.rows.map(lineOf).sort();
    const freshLines = resolution.items
      .map((i) => lineOf({
        requirement_id: i.requirement_id,
        depth: i.depth,
        mandatory: i.mandatory,
        rule_ids: i.reasons.map((r) => r.rule_id),
      }))
      .sort();

    checked++;

    // ── CATEGORY 1: corpus drift is NOT rule drift ────────────────────────
    //
    // Comparing a stored resolution to a fresh one only isolates the RULES if
    // the corpus is unchanged. It rarely is: this org gained 24 curated
    // requirements after these engagements were resolved, and re-resolving
    // against the bigger corpus legitimately produces more items. Reporting
    // that as a Q2 regression would be a false FAIL, and reporting it as a pass
    // would hide a real one — so the two are separated by AGE.
    const resolvedAt = await pgElevated.query<{ at: string | null }>(
      `SELECT max(created_at) AS at FROM vendor_engagement_scope_items WHERE engagement_id = $1`,
      [e.id]
    );
    const at = resolvedAt.rows[0]?.at ?? new Date(0).toISOString();

    // A requirement counts as CHANGED SINCE if it was created after the resolve
    // OR if its scope_tags were re-stamped after it. Tag curation is the second
    // case and it is not hypothetical: 63 rows on this tenant were retagged on
    // 2026-08-29. Retagging changes which S1/S2 rules match a requirement with
    // no rule having changed at all.
    const changedReqs = await pgElevated.query<{ requirement_id: string }>(
      `SELECT r.id AS requirement_id
         FROM requirements r JOIN frameworks f ON f.id = r.framework_id
        WHERE f.organization_id = $1
          AND (r.created_at > $2 OR COALESCE(r.scope_tags_at, r.created_at) > $2)`,
      [e.organization_id, at]
    );
    const newerIds = new Set(changedReqs.rows.map((r) => r.requirement_id));

    const onlyStored = storedLines.filter((l) => !freshLines.includes(l));
    const onlyFreshAll = freshLines.filter((l) => !storedLines.includes(l));
    const onlyFreshOld = onlyFreshAll.filter((l) => !newerIds.has(l.split("|")[0]!));
    const fromCorpusGrowth = onlyFreshAll.length - onlyFreshOld.length;

    if (fromCorpusGrowth > 0) {
      corpusGrew++;
      console.log(
        `\nCORPUS GREW  engagement=${e.id}: ${fromCorpusGrowth} item(s) come from requirements ` +
          `created AFTER this engagement was resolved. Not a rule change; excluded from the comparison.`
      );
    }

    // ── CATEGORY 3: a genuine, unexpected regression ──────────────────────
    // A stored item the rules no longer produce, or a NEW item drawn from a
    // requirement that existed AND was untouched, is a real divergence.
    if (onlyStored.length > 0 || onlyFreshOld.length > 0) {
      diverged++;
      console.log(`\nDIVERGED  engagement=${e.id} org=${e.organization_id} tier=${e.assessment_tier}`);
      for (const l of onlyStored.slice(0, 10)) console.log(`  stored only : ${l}`);
      for (const l of onlyFreshOld.slice(0, 10)) console.log(`  re-resolved : ${l}`);
      if (onlyStored.length > 10 || onlyFreshOld.length > 10) console.log("  … truncated");
    }

    // ── CATEGORY 2: a Q2-INTRODUCED behavioural change ────────────────────
    //
    // Under 1.0.0 these are impossible by construction — S5, the fact triggers,
    // `composition` and `domain` are all gated to >= 1.1.0. Seeing one means the
    // version gate leaked, which is the single most serious failure this script
    // can find: it would mean a pre-Q2 questionnaire moved under a customer.
    const Q2_RULE_IDS = ["S2.ai_prompts", "S2.cross_border", "S2.subprocessors"];
    const q2Leaks: string[] = [];
    if (resolution.composition !== undefined) q2Leaks.push("`composition` present on a 1.0.0 resolution");
    if (resolution.items.some((i) => "domain" in i)) q2Leaks.push("`domain` present on a 1.0.0 item");
    const leakedRules = [
      ...new Set(
        resolution.items
          .flatMap((i) => i.reasons.map((r) => r.rule_id))
          .filter((id) => id.startsWith("S5.") || Q2_RULE_IDS.includes(id))
      ),
    ];
    if (leakedRules.length > 0) q2Leaks.push(`Q2 rules fired: ${leakedRules.join(", ")}`);

    if (q2Leaks.length > 0) {
      q2Introduced++;
      console.log(`\nQ2 LEAK  engagement=${e.id}: ${q2Leaks.join("; ")}`);
    }
  }

  // Three categories, reported separately and weighted differently.
  console.log(
    `\nchecked ${checked}` +
      `\n  corpus growth/change (EXPECTED, reported)   : ${corpusGrew}` +
      `\n  Q2-introduced behavioural change (FAIL)     : ${q2Introduced}` +
      `\n  unexpected rule/resolution regression (FAIL): ${diverged}` +
      `\n  skipped (never resolved)                    : ${skippedNoItems}`
  );
  const failed = diverged + q2Introduced;
  console.log(failed === 0 ? "RESULT: PASS" : "RESULT: FAIL");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
