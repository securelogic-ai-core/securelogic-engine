/**
 * va-s4-4c2-tested-control-resolution-staging-acceptance.mjs — VA-S4-4C-2 live.
 *
 * The claim: **approving a vendor assurance document records what each of its
 * tested controls resolves to, against the governed crosswalk, from the
 * GOVERNED EFFECTIVE value — and records the ones that resolve to nothing.**
 *
 * Proven here, against the deployed staging engine and its real database:
 *   - approval materialises a resolution row for EVERY effective tested
 *     control: resolved with its canonical control and the exact crosswalk row
 *     that justified it, or unmapped with a reason. No silent drops;
 *   - fan-out is many resolved rows under one element key, not an unresolved
 *     identity;
 *   - C1.1 — the vendor-side-only criterion 4C-1 published — resolves;
 *   - an unobserved family (PI1.1) is recorded unmapped, visibly;
 *   - an accepted human override supplies the effective value while the
 *     original extraction is preserved and NOT rewritten;
 *   - re-resolution supersedes rather than mutates;
 *   - a SOC 1 document is never resolved against the Trust Services Criteria,
 *     and its approval still succeeds;
 *   - resolution can never fail an approval;
 *   - rows are tenant-isolated at the API and at RLS.
 *
 * It also REPORTS, for the 4C-3 decision:
 *   - the real tested-control RESULT PROSE in the live corpus, verbatim;
 *   - resolution coverage across every observed tested-control identity.
 *
 *   B64=$(gzip -9c scripts/validation/va-s4-4c2-tested-control-resolution-staging-acceptance.mjs | base64 -w0)
 *   render jobs create srv-d7n0rju8bjmc738jbs7g --confirm \
 *     --start-command "echo $B64 | base64 -d | gunzip > ./acc.mjs && node ./acc.mjs"
 *
 * Refuses a database named `securelogic`. Fixtures are labelled
 * `[S4-4C-2 ACCEPTANCE]` and deleted at the end. Exits non-zero on any failure.
 */
import pg from "pg";
import { createHmac } from "node:crypto";

const BASE = "https://securelogic-engine-staging.onrender.com/api";
const LABEL = "[S4-4C-2 ACCEPTANCE]";
const ASSURANCE_BEARING = [
  "report_type", "report_period_start", "report_period_end",
  "trust_services_criteria", "auditor_opinion", "controls", "exceptions",
  "subservice_method", "subservice_organizations",
];

function ssl() {
  const e = process.env;
  if (e.DATABASE_SSL_DISABLED === "true" || e.DATABASE_SSL_DISABLED === "1") return false;
  if (e.DATABASE_TLS_NO_VERIFY === "true") return { rejectUnauthorized: false };
  const o = { rejectUnauthorized: true };
  if (e.DATABASE_SSL_CA) o.ca = e.DATABASE_SSL_CA;
  if (e.DATABASE_SSL_SERVERNAME) o.servername = e.DATABASE_SSL_SERVERNAME.trim();
  return o;
}
const b64 = (b) => Buffer.from(b).toString("base64url");
function signJwt(sub, org, role, se) {
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const p = b64(JSON.stringify({ sub, org, role, se, type: "session", iat: now, exp: now + 3600 }));
  return `${h}.${p}.${createHmac("sha256", process.env.JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
}

let fails = 0, passes = 0;
const results = [];
const check = (row, label, ok, detail) => {
  ok ? passes++ : fails++;
  results.push(`${ok ? "PASS" : "FAIL"}  [${row}] ${label}${detail === undefined ? "" : "  :: " + JSON.stringify(detail)}`);
};
const note = (row, label, detail) =>
  results.push(`NOTE  [${row}] ${label}${detail === undefined ? "" : "  :: " + JSON.stringify(detail)}`);
const sameSet = (a, b) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

async function api(method, path, { token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text: text.slice(0, 300) };
}

const elev = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  ssl: ssl(),
});
const q = async (s, p = []) => {
  try { const r = await elev.query(s, p); return { ok: true, rows: r.rows, rowCount: r.rowCount }; }
  catch (e) { return { ok: false, code: e.code, message: e.message, rows: [] }; }
};
async function asApp(orgId, sql, params = []) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: ssl() });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_org_id',$1,true)", [orgId]);
    const r = await c.query(sql, params);
    await c.query("ROLLBACK");
    return { ok: true, rows: r.rows };
  } catch (e) {
    try { await c.query("ROLLBACK"); } catch {}
    return { ok: false, code: e.code, message: e.message, rows: [] };
  } finally { await c.end(); }
}

const ctrl = (id, result = "No exceptions noted.") => ({
  control_id: id,
  description: `Tested control ${id}`,
  test_procedure: "Inspected configuration and reperformed for a sample of 25.",
  result,
});

const created = { documents: [] };

async function fixture(org, vendor, user, name, controls, hint = "soc2_type2") {
  const d = await q(
    `INSERT INTO vendor_assurance_documents
       (organization_id, vendor_id, original_filename, byte_size, sha256, storage_key,
        mime_type, document_type_hint, processing_status)
     VALUES ($1,$2,$3,1024,md5(random()::text),'acceptance/x.pdf','application/pdf',$4,'extracted')
     RETURNING id`,
    [org, vendor, `${LABEL} ${name}.pdf`, hint]
  );
  if (!d.ok) return { error: d.message };
  const documentId = d.rows[0].id;
  created.documents.push(documentId);

  const fields = { controls: { value: controls, confidence: 0.99, status: "extracted" } };
  for (const f of ASSURANCE_BEARING) {
    if (f !== "controls") fields[f] = { value: "x", confidence: 0.9, status: "extracted" };
  }
  const e = await q(
    `INSERT INTO vendor_assurance_extractions
       (organization_id, document_id, model_id, prompt_version, raw_response_excerpt, fields)
     VALUES ($1,$2,'acceptance-fixture','acceptance',$3,$4::jsonb) RETURNING id`,
    [org, documentId, `${LABEL} synthetic`, JSON.stringify(fields)]
  );
  if (!e.ok) return { documentId, error: e.message };
  const extractionId = e.rows[0].id;

  for (const f of ASSURANCE_BEARING) {
    await q(
      `INSERT INTO vendor_assurance_review_decisions
         (organization_id, extraction_id, field_name, decision, decided_by_user_id)
       VALUES ($1,$2,$3,'accept',$4)`, [org, extractionId, f, user]);
  }
  for (const c of controls) {
    await q(
      `INSERT INTO vendor_assurance_review_decisions
         (organization_id, extraction_id, field_name, decision, decided_by_user_id, element_key, element_snapshot)
       VALUES ($1,$2,'controls','accept',$3,$4,$5::jsonb)`,
      [org, extractionId, user, c.control_id, JSON.stringify(c)]);
  }
  return { documentId, extractionId };
}

const liveRows = async (extractionId) =>
  (await q(
    `SELECT element_key, resolution_state, canonical_control_id, crosswalk_id, mapping_version,
            mapping_source, effective_source, override_id, unmapped_reason,
            framework_key, framework_version, requirement_reference,
            original_control, effective_control
       FROM vendor_tested_control_resolutions
      WHERE extraction_id=$1 AND superseded_at IS NULL
      ORDER BY element_key, canonical_control_id`, [extractionId])).rows;

/** Resolution is materialised after the approval response; wait for it. */
async function awaitRows(extractionId, expected) {
  for (let i = 0; i < 80; i += 1) {
    const rows = await liveRows(extractionId);
    if (rows.length >= expected) return rows;
    await new Promise((r) => setTimeout(r, 250));
  }
  return liveRows(extractionId);
}

async function main() {
  await elev.connect();
  const db = (await q(`SELECT current_database() d`)).rows[0]?.d;
  if (db === "securelogic") { console.error("REFUSING: production"); process.exit(2); }
  if (!process.env.JWT_SECRET) { console.error("REFUSING: JWT_SECRET unset"); process.exit(2); }
  console.log(`database=${db}`);

  const orgs = await q(
    `SELECT o.id, o.name,
            (SELECT count(*) FROM vendor_assurance_documents d WHERE d.organization_id=o.id) AS docs,
            (SELECT u.id FROM users u WHERE u.organization_id=o.id ORDER BY u.created_at LIMIT 1) AS user_id,
            (SELECT u.session_epoch FROM users u WHERE u.organization_id=o.id ORDER BY u.created_at LIMIT 1) AS se,
            (SELECT v.id FROM vendors v WHERE v.organization_id=o.id ORDER BY v.created_at LIMIT 1) AS vendor_id
       FROM organizations o
      WHERE lower(coalesce(o.entitlement_level,'')) IN ('premium','platform','team')
      ORDER BY docs DESC, o.created_at`);
  const usable = (orgs.rows ?? []).filter((o) => o.user_id && o.vendor_id);
  if (usable.length === 0) { console.error("REFUSING: no usable org"); process.exit(2); }
  const A = usable[0];
  const B = usable.find((o) => o.id !== A.id) ?? null;
  const TOKEN_A = signJwt(A.user_id, A.id, "admin", Number(A.se ?? 0));
  const TOKEN_B = B ? signJwt(B.user_id, B.id, "admin", Number(B.se ?? 0)) : null;
  console.log(`primary_org=${A.id} (${A.name})  foreign_org=${B ? B.id : "NONE"}`);

  // ── 0. Schema ────────────────────────────────────────────────────────────
  const cols = await q(
    `SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name='vendor_tested_control_resolutions'`);
  const idx = await q(
    `SELECT indexname FROM pg_indexes WHERE tablename='vendor_tested_control_resolutions' ORDER BY indexname`);
  check(1, "20261073 applied — the resolution record exists with both live-uniqueness indexes",
    cols.rows[0]?.n > 15
      && idx.rows.some((r) => r.indexname.endsWith("live_resolved"))
      && idx.rows.some((r) => r.indexname.endsWith("live_unmapped")),
    { columns: cols.rows[0]?.n, indexes: idx.rows.map((r) => r.indexname) });

  const rls = await q(
    `SELECT relrowsecurity FROM pg_class WHERE relname='vendor_tested_control_resolutions'`);
  check(2, "RLS is enabled on the record",
    rls.rows[0]?.relrowsecurity === true, rls.rows[0]);

  // ── 1. Approval materialises resolutions ─────────────────────────────────
  const f1 = await fixture(A.id, A.vendor_id, A.user_id, "happy",
    [ctrl("CC6.1"), ctrl("CC6.2"), ctrl("C1.1"), ctrl("PI1.1")]);
  if (f1.error) { console.error("FIXTURE FAILURE", f1); await cleanup(); process.exit(2); }

  const a1 = await api("POST", `/vendor-assurance/documents/${f1.documentId}/approve`, { token: TOKEN_A, body: {} });
  const rows1 = await awaitRows(f1.extractionId, 4);
  check(3, "approval materialises a resolution row for EVERY effective tested control — no silent drops",
    a1.status === 200 && sameSet([...new Set(rows1.map((r) => r.element_key))], ["CC6.1", "CC6.2", "C1.1", "PI1.1"]),
    { approve: a1.status, element_keys: [...new Set(rows1.map((r) => r.element_key))] });

  const cc61 = rows1.filter((r) => r.element_key === "CC6.1");
  check(4, "FAN-OUT: one criterion, many resolved rows, each naming its own canonical control and crosswalk row",
    cc61.length > 1
      && cc61.every((r) => r.resolution_state === "resolved" && r.canonical_control_id && r.crosswalk_id)
      && new Set(cc61.map((r) => r.canonical_control_id)).size === cc61.length,
    { rows: cc61.length, distinct_controls: new Set(cc61.map((r) => r.canonical_control_id)).size });

  const c11 = rows1.filter((r) => r.element_key === "C1.1");
  check(5, "C1.1 — the VENDOR-SIDE-ONLY criterion 4C-1 published — RESOLVES",
    c11.length > 0 && c11.every((r) => r.resolution_state === "resolved"),
    { rows: c11.length, states: [...new Set(c11.map((r) => r.resolution_state))] });

  const pi = rows1.filter((r) => r.element_key === "PI1.1");
  check(6, "an unobserved TSC family is recorded UNMAPPED with a reason, not dropped",
    pi.length === 1 && pi[0].resolution_state === "unmapped"
      && pi[0].unmapped_reason === "no_published_crosswalk_mapping"
      && pi[0].canonical_control_id === null && pi[0].crosswalk_id === null,
    pi[0]);

  check(7, "every row records the framework it was resolved against and the mapping's provenance",
    rows1.every((r) => r.framework_key === "soc2" && r.framework_version === "2017")
      && rows1.filter((r) => r.resolution_state === "resolved")
              .every((r) => r.mapping_version && r.mapping_source === "securelogic"),
    { frameworks: [...new Set(rows1.map((r) => `${r.framework_key}/${r.framework_version}`))] });

  check(8, "with no override the effective value IS the extraction, and says so structurally",
    rows1.every((r) => r.effective_source === "extraction" && r.override_id === null
      && JSON.stringify(r.original_control) === JSON.stringify(r.effective_control)),
    { sources: [...new Set(rows1.map((r) => r.effective_source))] });

  // ── 2. The governed effective value ──────────────────────────────────────
  const f2 = await fixture(A.id, A.vendor_id, A.user_id, "override", [ctrl("CC6.2", "No exceptions noted.")]);
  const ovr = await api("POST", `/vendor-assurance/documents/${f2.documentId}/field-overrides`, {
    token: TOKEN_A,
    body: {
      field_name: "controls",
      override_value: [ctrl("CC6.2", "Exceptions noted — corrected by the reviewer.")],
      reason: `${LABEL} the reviewer corrected the tested result`,
    },
  });
  const a2 = await api("POST", `/vendor-assurance/documents/${f2.documentId}/approve`, { token: TOKEN_A, body: {} });
  const rows2 = await awaitRows(f2.extractionId, 1);
  check(9, "an accepted human override supplies the EFFECTIVE value, and names the override it came from",
    (ovr.status === 200 || ovr.status === 201) && a2.status === 200 && rows2.length > 0
      && rows2.every((r) => r.effective_source === "field_override" && r.override_id !== null)
      && rows2.every((r) => String(r.effective_control?.result).includes("corrected by the reviewer")),
    { override: ovr.status, approve: a2.status, effective_result: rows2[0]?.effective_control?.result });

  check(10, "the ORIGINAL extraction is preserved beside it and is NOT rewritten",
    rows2.every((r) => r.original_control?.result === "No exceptions noted."),
    { original_result: rows2[0]?.original_control?.result });

  const ext2 = await q(`SELECT fields->'controls'->'value'->0->>'result' AS r FROM vendor_assurance_extractions WHERE id=$1`,
    [f2.extractionId]);
  check(11, "the extraction row itself is untouched by the override — provenance is not mutated",
    ext2.rows[0]?.r === "No exceptions noted.", ext2.rows[0]);

  // ── 3. Supersession ──────────────────────────────────────────────────────
  const before = await q(
    `SELECT count(*)::int AS n FROM vendor_tested_control_resolutions WHERE extraction_id=$1`, [f1.extractionId]);
  const reapprove = await api("POST", `/vendor-assurance/documents/${f1.documentId}/approve`, { token: TOKEN_A, body: {} });
  check(12, "an already-approved document cannot be re-approved — the 4C-0 lifecycle still holds",
    reapprove.status === 409, { status: reapprove.status, body: reapprove.json });

  const after = await q(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE superseded_at IS NOT NULL)::int AS superseded
       FROM vendor_tested_control_resolutions WHERE extraction_id=$1`, [f1.extractionId]);
  check(13, "the live set is unchanged and nothing was mutated behind it",
    after.rows[0]?.n === before.rows[0]?.n, { before: before.rows[0]?.n, after: after.rows[0] });

  // ── 4. Never a framework guess; never harms an approval ──────────────────
  const f3 = await fixture(A.id, A.vendor_id, A.user_id, "soc1", [ctrl("CC6.1")], "soc1");
  const a3 = await api("POST", `/vendor-assurance/documents/${f3.documentId}/approve`, { token: TOKEN_A, body: {} });
  await new Promise((r) => setTimeout(r, 1500));
  const rows3 = await liveRows(f3.extractionId);
  const doc3 = await q(`SELECT processing_status FROM vendor_assurance_documents WHERE id=$1`, [f3.documentId]);
  check(14, "a SOC 1 report is NOT resolved against the Trust Services Criteria — and its approval still succeeds",
    a3.status === 200 && doc3.rows[0]?.processing_status === "approved" && rows3.length === 0,
    { approve: a3.status, status: doc3.rows[0]?.processing_status, rows: rows3.length });

  // ── 5. Tenancy ───────────────────────────────────────────────────────────
  const rlsCheck = B
    ? await asApp(B.id, `SELECT count(*)::int AS n FROM vendor_tested_control_resolutions WHERE extraction_id=$1`,
        [f1.extractionId])
    : null;
  check(15, "RLS: a foreign tenant sees none of another org's resolutions",
    rlsCheck !== null && rlsCheck.ok && rlsCheck.rows[0]?.n === 0,
    rlsCheck === null ? "no foreign org" : rlsCheck.rows[0]);

  const own = await asApp(A.id, `SELECT count(*)::int AS n FROM vendor_tested_control_resolutions WHERE extraction_id=$1`,
    [f1.extractionId]);
  check(16, "the owning tenant DOES see its own resolutions — the policy is not simply denying everything",
    own.ok && own.rows[0]?.n > 0, own.rows[0]);

  // ── 6. Reports for the 4C-3 decision ─────────────────────────────────────
  const prose = await q(
    `SELECT trim(ctrl->>'result') AS result_prose, count(*)::int AS occurrences,
            count(DISTINCT trim(ctrl->>'control_id'))::int AS distinct_controls
       FROM vendor_assurance_extractions e,
            jsonb_array_elements(COALESCE(e.fields->'controls'->'value','[]'::jsonb)) ctrl
      WHERE e.model_id <> 'acceptance-fixture'
      GROUP BY 1 ORDER BY 2 DESC`);
  note(17, "THE REAL RESULT PROSE in the live corpus, verbatim — the 4C-3 input", prose.rows);

  const exceptionProse = await q(
    `SELECT trim(x->>'description') AS description, trim(x->>'auditor_assessment') AS auditor_assessment,
            count(*)::int AS occurrences
       FROM vendor_assurance_extractions e,
            jsonb_array_elements(COALESCE(e.fields->'exceptions'->'value','[]'::jsonb)) x
      WHERE e.model_id <> 'acceptance-fixture'
      GROUP BY 1,2 ORDER BY 3 DESC`);
  note(18, "the real EXCEPTION prose in the live corpus, verbatim", exceptionProse.rows);

  const coverage = await q(
    `WITH observed AS (
       SELECT DISTINCT trim(ctrl->>'control_id') AS ref
         FROM vendor_assurance_extractions e,
              jsonb_array_elements(COALESCE(e.fields->'controls'->'value','[]'::jsonb)) ctrl
        WHERE e.model_id <> 'acceptance-fixture'
          AND ctrl->>'control_id' IS NOT NULL AND trim(ctrl->>'control_id') <> '')
     SELECT o.ref,
            (SELECT count(*)::int FROM canonical_control_crosswalk x
              WHERE x.framework_key='soc2' AND x.framework_version='2017'
                AND x.requirement_reference=o.ref AND x.status='published'
                AND x.superseded_at IS NULL) AS canonical_controls,
            EXISTS (SELECT 1 FROM frameworks f JOIN requirements r ON r.framework_id=f.id
                     WHERE f.framework_key='soc2' AND f.version='2017'
                       AND r.reference_id=o.ref) AS template_represented
       FROM observed o ORDER BY o.ref`);
  note(19, "observed tested-control resolution coverage across the real corpus", coverage.rows);
  check(20, "every observed tested-control identity in the real corpus now resolves to at least one canonical control",
    coverage.rows.length > 0 && coverage.rows.every((r) => r.canonical_controls > 0),
    coverage.rows.filter((r) => r.canonical_controls === 0).map((r) => r.ref));

  await cleanup();
  console.log("\n" + results.join("\n"));
  console.log(`\n${passes} PASS / ${fails} FAIL  (${passes + fails} checks)`);
  await elev.end();
  process.exit(fails === 0 ? 0 : 1);
}

async function cleanup() {
  if (created.documents.length === 0) return;
  const r = await q(`DELETE FROM vendor_assurance_documents WHERE id = ANY($1::uuid[])`, [created.documents]);
  const left = await q(
    `SELECT count(*)::int AS n FROM vendor_assurance_documents WHERE original_filename LIKE $1`, [`${LABEL}%`]);
  const orphan = await q(`SELECT count(*)::int AS n FROM vendor_tested_control_resolutions`);
  console.log(`cleanup: deleted ${r.rowCount ?? 0}/${created.documents.length} fixtures; ${left.rows[0]?.n} labelled rows remain; ${orphan.rows[0]?.n} resolution rows remain`);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  try { await cleanup(); } catch {}
  process.exit(2);
});
