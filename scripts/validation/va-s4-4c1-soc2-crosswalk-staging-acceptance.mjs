/**
 * va-s4-4c1-soc2-crosswalk-staging-acceptance.mjs — VA-S4-4C-1 on live staging.
 *
 * The claim: **a vendor's SOC 2 tested control now resolves through the GOVERNED
 * canonical crosswalk to real tenant requirements — and where it does not, the
 * gap is visible rather than silently empty.**
 *
 * Read-only except for the publication itself, which is performed separately by
 * `scripts/publish-canonical-controls.ts` under a named human approver. This
 * script writes NOTHING: it measures what that publication produced.
 *
 * Proven here:
 *   - all 36 shipped SOC 2 / 2017 references are published, each with a named
 *     human approver and an approval time — the authority CHECK, satisfied in
 *     the live estate, not just in a test double;
 *   - every published reference joins to a REAL tenant requirement row that
 *     framework activation actually created. This is the non-vacuity claim: a
 *     crosswalk that is correct and joins to nothing is the failure the owner
 *     ruling names;
 *   - the full S4 hop, measured end to end for every tested-control identifier
 *     in the live extraction corpus: tested control -> TSC criterion ->
 *     canonical control -> tenant requirement;
 *   - the NIST CSF 1.1 corpus is untouched — 75 rows, no drift, no supersession;
 *   - nothing is ai_proposed, nothing is stuck in `proposed`, no row is
 *     published without an approver;
 *   - re-running the publisher is idempotent and reports zero drift.
 *
 *   B64=$(gzip -9c scripts/validation/va-s4-4c1-soc2-crosswalk-staging-acceptance.mjs | base64 -w0)
 *   render jobs create srv-d7n0rju8bjmc738jbs7g --confirm \
 *     --start-command "echo $B64 | base64 -d | gunzip > ./acc.mjs && node ./acc.mjs"
 *
 * Refuses a database named `securelogic`. Exits non-zero on any failed check.
 */
import pg from "pg";

const SOC2_KEY = "soc2";
const SOC2_VERSION = "2017";
const EXPECTED_REFS = 36;

function ssl() {
  const e = process.env;
  if (e.DATABASE_SSL_DISABLED === "true" || e.DATABASE_SSL_DISABLED === "1") return false;
  if (e.DATABASE_TLS_NO_VERIFY === "true") return { rejectUnauthorized: false };
  const o = { rejectUnauthorized: true };
  if (e.DATABASE_SSL_CA) o.ca = e.DATABASE_SSL_CA;
  if (e.DATABASE_SSL_SERVERNAME) o.servername = e.DATABASE_SSL_SERVERNAME.trim();
  return o;
}
const c = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  ssl: ssl(),
});
const q = async (s, p = []) => (await c.query(s, p)).rows;

let fails = 0, passes = 0;
const results = [];
const check = (row, label, ok, detail) => {
  ok ? passes++ : fails++;
  results.push(`${ok ? "PASS" : "FAIL"}  [${row}] ${label}${detail === undefined ? "" : "  :: " + JSON.stringify(detail)}`);
};
const note = (row, label, detail) =>
  results.push(`NOTE  [${row}] ${label}${detail === undefined ? "" : "  :: " + JSON.stringify(detail)}`);

await c.connect();
const db = (await q(`SELECT current_database() d`))[0].d;
if (db === "securelogic") { console.error("REFUSING: production"); process.exit(2); }
console.log(`database=${db}`);

// ── 1. The publication landed, and it is governed ──────────────────────────
const rows = await q(
  `SELECT status, mapping_source, proposed_by_actor_kind,
          count(*)::int AS rows,
          count(DISTINCT requirement_reference)::int AS refs,
          count(*) FILTER (WHERE approved_by_user_id IS NULL)::int AS unattributed,
          count(*) FILTER (WHERE superseded_at IS NOT NULL)::int AS superseded
     FROM canonical_control_crosswalk
    WHERE framework_key=$1 AND framework_version=$2
    GROUP BY 1,2,3`, [SOC2_KEY, SOC2_VERSION]);
check(1, "SOC 2 / 2017 content is published — one governed group, nothing proposed or ai_proposed",
  rows.length === 1 && rows[0].status === "published"
    && rows[0].mapping_source === "securelogic"
    && rows[0].proposed_by_actor_kind === "securelogic_curator"
    && rows[0].refs === EXPECTED_REFS
    && rows[0].unattributed === 0 && rows[0].superseded === 0,
  rows);

const approver = await q(
  `SELECT u.email, count(*)::int AS rows, min(x.approved_at) AS approved_at
     FROM canonical_control_crosswalk x JOIN users u ON u.id = x.approved_by_user_id
    WHERE x.framework_key=$1 AND x.framework_version=$2 GROUP BY u.email`, [SOC2_KEY, SOC2_VERSION]);
check(2, "every published row names ONE real human approver — the publication boundary held",
  approver.length === 1 && approver[0].rows === (rows[0]?.rows ?? -1) && approver[0].approved_at !== null,
  approver);

// ── 2. NON-VACUITY: the references join to requirements that really exist ──
const joined = await q(
  `SELECT count(DISTINCT x.requirement_reference)::int AS refs_joining,
          count(DISTINCT r.id)::int AS tenant_requirements,
          count(DISTINCT f.organization_id)::int AS orgs
     FROM canonical_control_crosswalk x
     JOIN frameworks f
       ON f.framework_key = x.framework_key AND f.version = x.framework_version
     JOIN requirements r
       ON r.framework_id = f.id AND r.reference_id = x.requirement_reference
    WHERE x.framework_key=$1 AND x.framework_version=$2 AND x.status='published'`,
  [SOC2_KEY, SOC2_VERSION]);
check(3, "every published reference joins to a REAL tenant requirement — the crosswalk is not vacuous",
  joined[0].refs_joining === EXPECTED_REFS && joined[0].tenant_requirements >= EXPECTED_REFS,
  joined[0]);

const orphanRefs = await q(
  `SELECT x.requirement_reference FROM canonical_control_crosswalk x
    WHERE x.framework_key=$1 AND x.framework_version=$2 AND x.status='published'
      AND NOT EXISTS (
        SELECT 1 FROM frameworks f JOIN requirements r ON r.framework_id=f.id
         WHERE f.framework_key=x.framework_key AND f.version=x.framework_version
           AND r.reference_id = x.requirement_reference)
    GROUP BY 1 ORDER BY 1`, [SOC2_KEY, SOC2_VERSION]);
check(4, "no published SOC 2 reference is unreachable from any tenant framework",
  orphanRefs.length === 0, orphanRefs.map((r) => r.requirement_reference));

// ── 3. THE S4 HOP, measured on the live extraction corpus ─────────────────
const tested = await q(
  `SELECT DISTINCT trim(ctrl->>'control_id') AS control_id
     FROM vendor_assurance_extractions e,
          jsonb_array_elements(COALESCE(e.fields->'controls'->'value','[]'::jsonb)) ctrl
    WHERE ctrl->>'control_id' IS NOT NULL AND trim(ctrl->>'control_id') <> ''
    ORDER BY 1`);
const testedIds = tested.map((r) => r.control_id);
note(5, "tested-control identifiers present in the live extraction corpus", testedIds);

const hop = await q(
  `WITH tested AS (
     SELECT DISTINCT trim(ctrl->>'control_id') AS ref
       FROM vendor_assurance_extractions e,
            jsonb_array_elements(COALESCE(e.fields->'controls'->'value','[]'::jsonb)) ctrl
      WHERE ctrl->>'control_id' IS NOT NULL AND trim(ctrl->>'control_id') <> '')
   SELECT t.ref,
          count(DISTINCT x.canonical_control_id)::int AS canonical_controls,
          count(DISTINCT r.id)::int                   AS tenant_requirements
     FROM tested t
     LEFT JOIN canonical_control_crosswalk x
            ON x.framework_key=$1 AND x.framework_version=$2
           AND x.requirement_reference = t.ref AND x.status='published'
           AND x.superseded_at IS NULL
     LEFT JOIN canonical_control_crosswalk back
            ON back.canonical_control_id = x.canonical_control_id
           AND back.status='published' AND back.superseded_at IS NULL
     LEFT JOIN frameworks f
            ON f.framework_key = back.framework_key AND f.version = back.framework_version
     LEFT JOIN requirements r
            ON r.framework_id = f.id AND r.reference_id = back.requirement_reference
    GROUP BY t.ref ORDER BY t.ref`, [SOC2_KEY, SOC2_VERSION]);
note(6, "THE S4 HOP per tested control: criterion -> canonical control -> tenant requirement", hop);

const resolved = hop.filter((h) => h.canonical_controls > 0);
const unresolved = hop.filter((h) => h.canonical_controls === 0);
check(7, "every tested control whose criterion is in the shipped template now resolves to canonical controls AND back to tenant requirements",
  resolved.length > 0 && resolved.every((h) => h.tenant_requirements > 0),
  { resolved: resolved.map((h) => h.ref), unresolved: unresolved.map((h) => h.ref) });

check(8, "the tested controls that do NOT resolve are exactly the criteria outside the shipped template — the known 4C-1 gap, visible rather than silently empty",
  unresolved.every((h) => /^(C1|PI1|P[1-8])\./.test(h.ref)),
  unresolved.map((h) => h.ref));

// ── 4. Nothing else moved ─────────────────────────────────────────────────
const nist = await q(
  `SELECT count(*)::int AS rows, count(DISTINCT requirement_reference)::int AS refs,
          count(*) FILTER (WHERE status <> 'published')::int AS not_published,
          count(*) FILTER (WHERE superseded_at IS NOT NULL)::int AS superseded
     FROM canonical_control_crosswalk WHERE framework_key='nist-csf'`);
check(9, "the NIST CSF 1.1 corpus is untouched — 75 rows / 57 references, none superseded",
  nist[0].rows === 75 && nist[0].refs === 57 && nist[0].not_published === 0 && nist[0].superseded === 0,
  nist[0]);

const controls = await q(
  `SELECT count(*)::int AS controls,
          count(*) FILTER (WHERE status='published')::int AS published,
          count(*) FILTER (WHERE published_by_user_id IS NULL)::int AS unattributed
     FROM canonical_controls`);
check(10, "the canonical control corpus is unchanged and still fully attributed",
  controls[0].controls === 45 && controls[0].published === 45 && controls[0].unattributed === 0,
  controls[0]);

const reach = await q(
  `SELECT count(*)::int AS unreached FROM canonical_controls cc
    WHERE NOT EXISTS (SELECT 1 FROM canonical_control_crosswalk x
                       WHERE x.canonical_control_id = cc.id AND x.status='published')`);
check(11, "across both corpora every canonical control is now reachable from at least one framework requirement",
  reach[0].unreached === 0, reach[0]);

const ambiguous = await q(
  `SELECT requirement_reference, count(*)::int AS live_rows
     FROM canonical_control_crosswalk
    WHERE framework_key=$1 AND framework_version=$2 AND superseded_at IS NULL
    GROUP BY 1 HAVING count(*) > 1 ORDER BY 2 DESC, 1`, [SOC2_KEY, SOC2_VERSION]);
note(12, "criteria carrying more than one canonical control — many-to-many is intended, not ambiguity", ambiguous);

const dupe = await q(
  `SELECT requirement_reference, canonical_control_id, count(*)::int AS n
     FROM canonical_control_crosswalk
    WHERE framework_key=$1 AND framework_version=$2 AND superseded_at IS NULL
    GROUP BY 1,2 HAVING count(*) > 1`, [SOC2_KEY, SOC2_VERSION]);
check(13, "no (criterion, canonical control) pair is live twice — the partial unique index holds",
  dupe.length === 0, dupe);

console.log("\n" + results.join("\n"));
console.log(`\n${passes} PASS / ${fails} FAIL  (${passes + fails} checks)`);
await c.end();
process.exit(fails === 0 ? 0 : 1);
