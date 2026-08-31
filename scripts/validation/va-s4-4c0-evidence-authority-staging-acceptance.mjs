/**
 * va-s4-4c0-evidence-authority-staging-acceptance.mjs — S4-4C-0 on live staging.
 *
 * The claim: **an assurance document cannot become the version of record until
 * its assurance-bearing fields AND each tested control have been reviewed by a
 * named human.**
 *
 * Before this package, `approve` — the terminal assurance-eligible state, and
 * the state the S4 predicate keys on — required NO review at all, while the
 * legacy `finalize` route it replaced required a decision on every material
 * field. The newer state asserted LESS than the one it replaced. Measured on
 * staging 2026-08-31 before the change: `vendor_assurance_review_decisions` and
 * `vendor_assurance_field_overrides` were BOTH EMPTY estate-wide, and both
 * approved documents were approved with zero review.
 *
 * Proven here, against the deployed staging engine and its real database:
 *   - migration 20261072 is applied, and its two CHECKs actually refuse the
 *     rows they claim to refuse (element scope, snapshot-with-key);
 *   - approval of a fully extracted document with zero review is REFUSED, and
 *     the document does not move;
 *   - reviewing all nine assurance-bearing FIELDS is still not enough — each
 *     tested CONTROL needs its own decision. This is the grain the old gate
 *     could not express at all;
 *   - once every field and every control carries a current decision, approval
 *     succeeds and still names the approving human (#947);
 *   - an element decision is refused on any field but `controls`, and refused
 *     for a control the extraction does not contain;
 *   - `element_snapshot` records the tested control BY VALUE and survives a
 *     later override of `controls`;
 *   - the two grains are reported separately — an element decision no longer
 *     overwrites the whole-field entry;
 *   - a document with no extraction, and one whose controls carry no
 *     identifier, are both fail-closed;
 *   - reject and request-manual-review are NOT gated;
 *   - the gate is tenant-isolated at the API and at RLS;
 *   - historical approvals are untouched and no review decision was fabricated
 *     for them.
 *
 *   B64=$(gzip -9c scripts/validation/va-s4-4c0-evidence-authority-staging-acceptance.mjs | base64 -w0)
 *   render jobs create srv-d7n0rju8bjmc738jbs7g --confirm \
 *     --start-command "echo $B64 | base64 -d | gunzip > ./acc.mjs && node ./acc.mjs"
 *
 * Refuses a database named `securelogic`. Every artifact it creates is labelled
 * `[S4-4C-0 ACCEPTANCE]` and deleted at the end. Exits non-zero on any failure.
 */
import pg from "pg";
import { createHmac } from "node:crypto";

const BASE = "https://securelogic-engine-staging.onrender.com/api";
const LABEL = "[S4-4C-0 ACCEPTANCE]";

/** The nine fields an assurance determination consumes (route-side truth). */
const ASSURANCE_BEARING = [
  "report_type", "report_period_start", "report_period_end",
  "trust_services_criteria", "auditor_opinion", "controls", "exceptions",
  "subservice_method", "subservice_organizations",
];

const CTRL_KEYS = ["CC6.1", "CC7.2", "A1.2"];

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
function check(row, label, ok, detail) {
  if (ok) passes++; else fails++;
  results.push(`${ok ? "PASS" : "FAIL"}  [${row}] ${label}${detail === undefined ? "" : "  :: " + JSON.stringify(detail)}`);
}
function note(row, label, detail) {
  results.push(`NOTE  [${row}] ${label}${detail === undefined ? "" : "  :: " + JSON.stringify(detail)}`);
}
const sameSet = (a, b) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

async function api(method, path, { token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text: text.slice(0, 400) };
}

const elev = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  ssl: ssl(),
});
async function q(sql, params = []) {
  try { const r = await elev.query(sql, params); return { ok: true, rows: r.rows, rowCount: r.rowCount }; }
  catch (e) { return { ok: false, code: e.code, message: e.message, rows: [] }; }
}
/** Run as the tenant-scoped app role; always rolled back. */
async function asApp(orgId, sql, params = []) {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: ssl() });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('app.current_org_id',$1,true)", [orgId]);
    const r = await c.query(sql, params);
    await c.query("ROLLBACK");
    return { ok: true, rows: r.rows, rowCount: r.rowCount };
  } catch (e) {
    try { await c.query("ROLLBACK"); } catch {}
    return { ok: false, code: e.code, message: e.message, rows: [] };
  } finally { await c.end(); }
}

/** A complete, legal extraction. `controls` carries `n` identified controls. */
function extractionFields(controls) {
  const f = (value, confidence = 0.95) => ({ value, confidence, status: "extracted" });
  return {
    vendor_name: f("Acceptance Vendor"),
    report_type: f("SOC 2 Type II"),
    report_period_start: f("2025-01-01"),
    report_period_end: f("2025-12-31"),
    report_issued_date: f("2026-02-14"),
    auditor_name: f("Acceptance Assurance LLP"),
    auditor_opinion: f("unqualified"),
    trust_services_criteria: f(["Security", "Availability", "Confidentiality"]),
    subservice_method: f("Carve-out"),
    subservice_organizations: f(["Acceptance Hosting Inc"]),
    cuecs: f(["The user entity is responsible for provisioning its own users."]),
    controls: f(controls),
    exceptions: f([{ control_id: "CC7.2", description: "One deviation noted.", auditor_assessment: "Isolated." }]),
    management_responses: f([{ control_id: "CC7.2", description: "Remediated 2025-11.", auditor_assessment: null }]),
  };
}
const mkControl = (id) => ({
  control_id: id,
  description: `Tested control ${id ?? "(unidentified)"}`,
  test_procedure: "Inspected configuration and reperformed for a sample of 25.",
  result: "No exceptions noted.",
});

const created = { documents: [] };

async function mkDocument(orgId, vendorId, userId, { withExtraction = true, controls = CTRL_KEYS.map(mkControl), name }) {
  const d = await q(
    `INSERT INTO vendor_assurance_documents
       (organization_id, vendor_id, uploaded_by_user_id, original_filename, byte_size,
        sha256, storage_key, mime_type, document_type_hint, processing_status)
     VALUES ($1,$2,$3,$4,1024,
             md5(random()::text), 'acceptance/placeholder.pdf', 'application/pdf', 'soc2_type2', 'extracted')
     RETURNING id`,
    [orgId, vendorId, userId, `${LABEL} ${name}.pdf`]
  );
  if (!d.ok) return { error: d.message };
  const documentId = d.rows[0].id;
  created.documents.push(documentId);
  if (!withExtraction) return { documentId, extractionId: null };
  const e = await q(
    `INSERT INTO vendor_assurance_extractions
       (organization_id, document_id, model_id, prompt_version, raw_response_excerpt, fields)
     VALUES ($1,$2,'acceptance-fixture','acceptance','${LABEL} synthetic extraction', $3::jsonb)
     RETURNING id`,
    [orgId, documentId, JSON.stringify(extractionFields(controls))]
  );
  if (!e.ok) return { documentId, error: e.message };
  return { documentId, extractionId: e.rows[0].id };
}

const decide = (token, extractionId, decisions) =>
  api("POST", `/vendor-assurance/extractions/${extractionId}/review-decisions`, { token, body: { decisions } });

async function main() {
  await elev.connect();

  const dbName = (await q(`SELECT current_database() AS d`)).rows[0]?.d;
  if (dbName === "securelogic") {
    console.error("REFUSING: current_database() is 'securelogic' (production).");
    process.exit(2);
  }
  console.log(`database=${dbName}  base=${BASE}`);
  if (!process.env.JWT_SECRET) { console.error("REFUSING: JWT_SECRET unset."); process.exit(2); }

  // ── Pick the tenants ───────────────────────────────────────────────────────
  // PRIMARY is an org that already owns assurance documents: it is demonstrably
  // past the premium entitlement gate. FOREIGN is any other premium org with a
  // user, for the isolation arm.
  const orgs = await q(
    `SELECT o.id, o.name, o.entitlement_level,
            (SELECT count(*) FROM vendor_assurance_documents d WHERE d.organization_id = o.id) AS docs,
            (SELECT u.id FROM users u WHERE u.organization_id = o.id ORDER BY u.created_at LIMIT 1) AS user_id,
            (SELECT u.session_epoch FROM users u WHERE u.organization_id = o.id ORDER BY u.created_at LIMIT 1) AS se,
            (SELECT v.id FROM vendors v WHERE v.organization_id = o.id ORDER BY v.created_at LIMIT 1) AS vendor_id
       FROM organizations o
      WHERE lower(coalesce(o.entitlement_level,'')) IN ('premium','platform','team')
      ORDER BY docs DESC, o.created_at`
  );
  const usable = (orgs.rows ?? []).filter((o) => o.user_id && o.vendor_id);
  if (usable.length === 0) { console.error("REFUSING: no premium org with a user and a vendor."); process.exit(2); }
  const A = usable[0];
  const B = usable.find((o) => o.id !== A.id) ?? null;
  const TOKEN_A = signJwt(A.user_id, A.id, "admin", Number(A.se ?? 0));
  const TOKEN_B = B ? signJwt(B.user_id, B.id, "admin", Number(B.se ?? 0)) : null;
  console.log(`primary_org=${A.id} (${A.name}) docs=${A.docs}  foreign_org=${B ? B.id : "NONE"}`);

  // The estate as it stands BEFORE this run — for the history arm.
  const historical = await q(
    `SELECT d.id, d.approved_by_user_id,
            (SELECT count(*) FROM vendor_assurance_review_decisions r
               JOIN vendor_assurance_extractions e ON e.id = r.extraction_id
              WHERE e.document_id = d.id) AS decisions
       FROM vendor_assurance_documents d
      WHERE d.processing_status = 'approved'`
  );
  const historicalIds = (historical.rows ?? []).map((r) => r.id);
  /** Pre-run decision count per approved document — the baseline check 22 compares against. */
  const historicalDecisions = new Map((historical.rows ?? []).map((r) => [r.id, Number(r.decisions)]));

  // ── A. The migration is applied, and its CHECKs bite ──────────────────────
  const cols = await q(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_name='vendor_assurance_review_decisions'
        AND column_name IN ('element_key','element_snapshot') ORDER BY column_name`
  );
  check(1, "20261072 applied: element_key TEXT NULL + element_snapshot JSONB NULL",
    cols.rows.length === 2
      && cols.rows[0].column_name === "element_key" && cols.rows[0].data_type === "text"
      && cols.rows[1].column_name === "element_snapshot" && cols.rows[1].data_type === "jsonb"
      && cols.rows.every((r) => r.is_nullable === "YES"),
    cols.rows);

  const idx = await q(
    `SELECT indexname FROM pg_indexes
      WHERE tablename='vendor_assurance_review_decisions'
        AND indexname='idx_vendor_assurance_review_decisions_element_projection'`
  );
  check(2, "the (field_name, element_key) projection index exists", idx.rows.length === 1, idx.rows);

  // Fixture documents.
  const doc1 = await mkDocument(A.id, A.vendor_id, A.user_id, { name: "D1 full extraction" });
  const doc2 = await mkDocument(A.id, A.vendor_id, A.user_id, { name: "D2 no extraction", withExtraction: false });
  const doc3 = await mkDocument(A.id, A.vendor_id, A.user_id, {
    name: "D3 unidentified control",
    controls: [mkControl("CC6.1"), { ...mkControl(null), control_id: null }],
  });
  const doc4 = await mkDocument(A.id, A.vendor_id, A.user_id, { name: "D4 manual review" });
  const doc5 = await mkDocument(A.id, A.vendor_id, A.user_id, { name: "D5 snapshot provenance" });
  if (doc1.error || doc2.error || doc3.error || doc4.error || doc5.error) {
    console.error("FIXTURE FAILURE", { doc1, doc2, doc3, doc4, doc5 });
    await cleanup(); process.exit(2);
  }

  const scope = await q(
    `INSERT INTO vendor_assurance_review_decisions
       (organization_id, extraction_id, field_name, decision, element_key, element_snapshot)
     VALUES ($1,$2,'exceptions','accept','CC6.1','{}'::jsonb) RETURNING id`,
    [A.id, doc1.extractionId]
  );
  check(3, "CHECK refuses an element decision on any field but `controls`",
    !scope.ok && scope.code === "23514", { code: scope.code, message: scope.message?.slice(0, 120) });

  const snap = await q(
    `INSERT INTO vendor_assurance_review_decisions
       (organization_id, extraction_id, field_name, decision, element_key, element_snapshot)
     VALUES ($1,$2,'controls','accept','CC6.1',NULL) RETURNING id`,
    [A.id, doc1.extractionId]
  );
  check(4, "CHECK refuses an element decision that snapshots nothing",
    !snap.ok && snap.code === "23514", { code: snap.code, message: snap.message?.slice(0, 120) });

  // ── B. The regression is closed ───────────────────────────────────────────
  const a0 = await api("POST", `/vendor-assurance/documents/${doc1.documentId}/approve`, { token: TOKEN_A, body: {} });
  check(5, "approve with ZERO review is refused, naming every unmet field and control",
    a0.status === 409
      && a0.json?.error === "vendor_assurance_approval_review_incomplete"
      && a0.json?.reason === "review_incomplete"
      && sameSet(a0.json?.missing_field_names ?? [], ASSURANCE_BEARING)
      && sameSet(a0.json?.unreviewed_control_keys ?? [], CTRL_KEYS),
    { status: a0.status, body: a0.json ?? a0.text });

  const after0 = await q(
    `SELECT processing_status, approved_at, approved_by_user_id FROM vendor_assurance_documents WHERE id=$1`,
    [doc1.documentId]);
  check(6, "the refused document did not move: still `extracted`, never approved",
    after0.rows[0]?.processing_status === "extracted"
      && after0.rows[0]?.approved_at === null
      && after0.rows[0]?.approved_by_user_id === null,
    after0.rows[0]);

  const fieldDec = await decide(TOKEN_A, doc1.extractionId,
    ASSURANCE_BEARING.map((f) => ({ field_name: f, decision: "accept", reviewer_note: `${LABEL} field review` })));
  const a1 = await api("POST", `/vendor-assurance/documents/${doc1.documentId}/approve`, { token: TOKEN_A, body: {} });
  check(7, "reviewing all NINE assurance-bearing FIELDS is still not enough — each tested control needs its own decision",
    fieldDec.status === 201 || fieldDec.status === 200
      ? a1.status === 409
        && (a1.json?.missing_field_names ?? []).length === 0
        && sameSet(a1.json?.unreviewed_control_keys ?? [], CTRL_KEYS)
      : false,
    { record: fieldDec.status, approve: a1.status, body: a1.json ?? a1.text });

  const two = await decide(TOKEN_A, doc1.extractionId, CTRL_KEYS.slice(0, 2).map((k) => ({
    field_name: "controls", decision: "accept", element_key: k, reviewer_note: `${LABEL} control review`,
  })));
  const a2 = await api("POST", `/vendor-assurance/documents/${doc1.documentId}/approve`, { token: TOKEN_A, body: {} });
  check(8, "two of three controls reviewed: approval still refused, naming exactly the third",
    (two.status === 201 || two.status === 200)
      && a2.status === 409
      && sameSet(a2.json?.unreviewed_control_keys ?? [], [CTRL_KEYS[2]]),
    { record: two.status, approve: a2.status, unreviewed: a2.json?.unreviewed_control_keys });

  const third = await decide(TOKEN_A, doc1.extractionId, [{
    field_name: "controls", decision: "accept", element_key: CTRL_KEYS[2], reviewer_note: `${LABEL} control review`,
  }]);
  const a3 = await api("POST", `/vendor-assurance/documents/${doc1.documentId}/approve`, { token: TOKEN_A, body: {} });
  const after3 = await q(
    `SELECT processing_status, approved_at, approved_by_user_id FROM vendor_assurance_documents WHERE id=$1`,
    [doc1.documentId]);
  check(9, "with every field and every control reviewed, approval succeeds and still names the approving human (#947)",
    (third.status === 201 || third.status === 200)
      && a3.status === 200
      && after3.rows[0]?.processing_status === "approved"
      && after3.rows[0]?.approved_by_user_id === A.user_id
      && after3.rows[0]?.approved_at !== null,
    { record: third.status, approve: a3.status, row: after3.rows[0] });

  // ── C. Element-grain integrity ────────────────────────────────────────────
  const wrongField = await decide(TOKEN_A, doc5.extractionId, [{
    field_name: "exceptions", decision: "accept", element_key: "CC6.1",
  }]);
  check(10, "the API refuses an element decision on any field but `controls`",
    wrongField.status === 400 && wrongField.json?.error === "element_key_not_supported_for_field",
    { status: wrongField.status, body: wrongField.json });

  const ghost = await decide(TOKEN_A, doc5.extractionId, [{
    field_name: "controls", decision: "accept", element_key: "ZZ9.9",
  }]);
  check(11, "a decision about a control the extraction does not contain is refused, and the real keys are named",
    ghost.status === 409
      && ghost.json?.error === "tested_control_not_in_extraction"
      && ghost.json?.element_key === "ZZ9.9"
      && sameSet(ghost.json?.available ?? [], CTRL_KEYS),
    { status: ghost.status, body: ghost.json });

  const snapRow = await q(
    `SELECT element_key, element_snapshot, decided_by_user_id, field_name
       FROM vendor_assurance_review_decisions
      WHERE extraction_id=$1 AND element_key=$2 ORDER BY decided_at DESC LIMIT 1`,
    [doc1.extractionId, CTRL_KEYS[0]]);
  const stored = snapRow.rows[0]?.element_snapshot;
  check(12, "the decision snapshots the tested control BY VALUE and names the decider",
    stored != null
      && stored.control_id === CTRL_KEYS[0]
      && stored.test_procedure === mkControl(CTRL_KEYS[0]).test_procedure
      && stored.result === mkControl(CTRL_KEYS[0]).result
      && snapRow.rows[0]?.decided_by_user_id === A.user_id,
    snapRow.rows[0]);

  const ext = await api("GET", `/vendor-assurance/documents/${doc1.documentId}/extraction`, { token: TOKEN_A });
  const cd = ext.json?.current_decisions ?? {};
  const ccd = ext.json?.current_control_decisions ?? {};
  check(13, "the two grains are reported SEPARATELY — an element decision no longer overwrites the whole-field entry",
    ext.status === 200
      && cd["controls"]?.decision === "accept"
      && sameSet(Object.keys(ccd), CTRL_KEYS)
      && CTRL_KEYS.every((k) => ccd[k]?.decision === "accept"),
    { status: ext.status, field_keys: Object.keys(cd), control_keys: Object.keys(ccd) });

  // ── D. Fail-closed edges ──────────────────────────────────────────────────
  const noExt = await api("POST", `/vendor-assurance/documents/${doc2.documentId}/approve`, { token: TOKEN_A, body: {} });
  check(14, "a document with NO extraction cannot be approved — there is nothing to have reviewed",
    noExt.status === 409
      && noExt.json?.error === "vendor_assurance_approval_review_incomplete"
      && noExt.json?.reason === "no_extraction",
    { status: noExt.status, body: noExt.json });

  const unid = await api("POST", `/vendor-assurance/documents/${doc3.documentId}/approve`, { token: TOKEN_A, body: {} });
  check(15, "an unidentifiable tested control blocks approval — the gate is not satisfiable by producing one",
    unid.status === 409
      && unid.json?.reason === "unidentified_tested_controls"
      && unid.json?.unidentified_tested_control_count === 1,
    { status: unid.status, body: unid.json });

  const rej = await api("POST", `/vendor-assurance/documents/${doc3.documentId}/reject`,
    { token: TOKEN_A, body: { reason: `${LABEL} rejected with zero review` } });
  const rejRow = await q(`SELECT processing_status FROM vendor_assurance_documents WHERE id=$1`, [doc3.documentId]);
  check(16, "REJECT is not gated — the workflow for dealing with a bad extraction still works with zero review",
    rej.status === 200 && rejRow.rows[0]?.processing_status === "rejected",
    { status: rej.status, row: rejRow.rows[0] });

  const mr = await api("POST", `/vendor-assurance/documents/${doc4.documentId}/request-manual-review`,
    { token: TOKEN_A, body: { comment: `${LABEL} manual review with zero review` } });
  const mrRow = await q(`SELECT processing_status FROM vendor_assurance_documents WHERE id=$1`, [doc4.documentId]);
  check(17, "REQUEST-MANUAL-REVIEW is not gated either — neither state claims assurance eligibility",
    mr.status === 200 && mrRow.rows[0]?.processing_status === "manual_review_requested",
    { status: mr.status, row: mrRow.rows[0] });

  // ── E. Provenance survives mutation ───────────────────────────────────────
  const d5 = await decide(TOKEN_A, doc5.extractionId, [{
    field_name: "controls", decision: "accept", element_key: CTRL_KEYS[0], reviewer_note: `${LABEL} before override`,
  }]);
  const before = await q(
    `SELECT element_snapshot FROM vendor_assurance_review_decisions
      WHERE extraction_id=$1 AND element_key=$2 ORDER BY decided_at DESC LIMIT 1`,
    [doc5.extractionId, CTRL_KEYS[0]]);
  const ovr = await api("POST", `/vendor-assurance/documents/${doc5.documentId}/field-overrides`, {
    token: TOKEN_A,
    body: {
      field_name: "controls",
      override_value: [{ ...mkControl(CTRL_KEYS[0]), description: "REWRITTEN by override", result: "Exceptions noted." }],
      reason: `${LABEL} mutate the extraction under a recorded decision`,
    },
  });
  const after = await q(
    `SELECT element_snapshot FROM vendor_assurance_review_decisions
      WHERE extraction_id=$1 AND element_key=$2 ORDER BY decided_at DESC LIMIT 1`,
    [doc5.extractionId, CTRL_KEYS[0]]);
  check(18, "a governance decision stays explainable against what the reviewer saw — the snapshot is unchanged by a later `controls` override",
    (d5.status === 201 || d5.status === 200)
      && (ovr.status === 200 || ovr.status === 201)
      && JSON.stringify(before.rows[0]?.element_snapshot) === JSON.stringify(after.rows[0]?.element_snapshot)
      && after.rows[0]?.element_snapshot?.description === mkControl(CTRL_KEYS[0]).description,
    { decision: d5.status, override: ovr.status, snapshot_description: after.rows[0]?.element_snapshot?.description });

  const gateAfterOverride = await api("POST", `/vendor-assurance/documents/${doc5.documentId}/approve`, { token: TOKEN_A, body: {} });
  note(18.1, "MEASURED, not asserted: field overrides are append-only beside the extraction and do not rewrite `fields`, so the gate's required control keys after an override are",
    { unreviewed_control_keys: gateAfterOverride.json?.unreviewed_control_keys, status: gateAfterOverride.status });

  // ── F. Tenancy ────────────────────────────────────────────────────────────
  if (TOKEN_B) {
    const fDecide = await decide(TOKEN_B, doc5.extractionId, [{
      field_name: "controls", decision: "accept", element_key: CTRL_KEYS[1],
    }]);
    check(19, "a foreign tenant cannot record an element decision on another org's extraction",
      fDecide.status === 404 && fDecide.json?.error === "vendor_assurance_extraction_not_found",
      { status: fDecide.status, body: fDecide.json });
    const fApprove = await api("POST", `/vendor-assurance/documents/${doc5.documentId}/approve`, { token: TOKEN_B, body: {} });
    check(20, "a foreign tenant cannot approve another org's document",
      fApprove.status === 404 && fApprove.json?.error === "vendor_assurance_document_not_found",
      { status: fApprove.status, body: fApprove.json });
  } else {
    note(19, "SKIPPED: no second premium org on this database — API isolation arm not run");
    note(20, "SKIPPED: no second premium org on this database — API isolation arm not run");
  }

  const rls = B
    ? await asApp(B.id, `SELECT count(*)::int AS n FROM vendor_assurance_review_decisions WHERE extraction_id=$1`, [doc1.extractionId])
    : null;
  check(21, "RLS: under a foreign org's tenant scope the element decisions are not visible at all",
    rls === null ? false : rls.ok && rls.rows[0]?.n === 0,
    rls === null ? "no foreign org" : rls.rows[0]);

  // ── G. History is untouched ───────────────────────────────────────────────
  const hist = historicalIds.length === 0 ? { rows: [] } : await q(
    `SELECT d.id, d.processing_status,
            (SELECT count(*)::int FROM vendor_assurance_review_decisions r
               JOIN vendor_assurance_extractions e ON e.id = r.extraction_id
              WHERE e.document_id = d.id) AS decisions
       FROM vendor_assurance_documents d WHERE d.id = ANY($1::uuid[])`,
    [historicalIds]);
  check(22, "the gate guards the TRANSITION, not the state: every pre-existing approval still stands, with exactly the review it had before this run",
    hist.rows.length === historicalIds.length
      && hist.rows.every((r) => r.processing_status === "approved"
        && r.decisions === historicalDecisions.get(r.id)),
    { historical: historicalIds.length,
      rows: hist.rows.map((r) => ({ id: r.id, status: r.processing_status, before: historicalDecisions.get(r.id), after: r.decisions })) });

  // The corpus moved since the 2026-08-31 pre-build measurement (review decisions
  // were EMPTY estate-wide then). Report what actually stands now, at both grains,
  // rather than restating a stale number.
  const estate = await q(
    `SELECT d.id, d.approved_at,
            count(r.id) FILTER (WHERE r.element_key IS NULL)     ::int AS field_decisions,
            count(r.id) FILTER (WHERE r.element_key IS NOT NULL) ::int AS element_decisions
       FROM vendor_assurance_documents d
       LEFT JOIN vendor_assurance_extractions e ON e.document_id = d.id
       LEFT JOIN vendor_assurance_review_decisions r ON r.extraction_id = e.id
      WHERE d.processing_status = 'approved'
      GROUP BY d.id, d.approved_at ORDER BY d.approved_at`);
  note(22.1, "MEASURED: every approved document in the estate, with its review at both grains",
    estate.rows);

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
    `SELECT count(*)::int AS n FROM vendor_assurance_documents WHERE original_filename LIKE $1`,
    [`${LABEL}%`]);
  console.log(`cleanup: deleted ${r.rowCount ?? 0}/${created.documents.length} fixture documents; ${left.rows[0]?.n ?? "?"} labelled rows remain`);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  try { await cleanup(); } catch {}
  process.exit(2);
});
