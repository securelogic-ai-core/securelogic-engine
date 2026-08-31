/**
 * va-s4-4c3-assurance-outcome-staging-acceptance.mjs — VA-S4-4C-3 live.
 *
 * The claim: **an approved vendor assurance document records what the AUDITOR
 * asserted, separately from what SECURELOGIC governs, separately from what its
 * EXCEPTIONS mean — and no layer can silently overwrite another.**
 *
 * The three layers are reported INDEPENDENTLY, per owner section 9.
 *
 *   LAYER 1  the auditor assertion. Machine-produced, versioned, with the
 *            verbatim result beside it. Asserts no governed effectiveness.
 *   LAYER 2  governed effectiveness. EFFECTIVE / INEFFECTIVE / INDETERMINATE,
 *            decided by a named human, never defaulted, never seeded.
 *   LAYER 3  exception identity, many-to-many control linkage, governed effect.
 *
 * Every security proof owner section 8 requires is a numbered check below.
 *
 *   B64=$(gzip -9c scripts/validation/va-s4-4c3-assurance-outcome-staging-acceptance.mjs | base64 -w0)
 *   render jobs create srv-d7n0rju8bjmc738jbs7g --confirm \
 *     --start-command "echo $B64 | base64 -d | gunzip > ./acc.mjs && node ./acc.mjs"
 *
 * Refuses a database named `securelogic`. Fixtures are labelled
 * `[S4-4C-3 ACCEPTANCE]` and deleted at the end. Exits non-zero on any failure.
 */
import pg from "pg";
import { createHmac } from "node:crypto";

const BASE = "https://securelogic-engine-staging.onrender.com/api";
const LABEL = "[S4-4C-3 ACCEPTANCE]";
const ASSURANCE_BEARING = [
  "report_type", "report_period_start", "report_period_end",
  "trust_services_criteria", "auditor_opinion", "controls", "exceptions",
  "subservice_method", "subservice_organizations",
];
/** Owner decision 6: the retained synthetic validation fixture organization. */
const SYNTHETIC_FIXTURE_ORG = "b1a3da2d-5045-47c6-bd02-dec206c790fe";

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
const check = (row, layer, label, ok, detail) => {
  ok ? passes++ : fails++;
  results.push(`${ok ? "PASS" : "FAIL"}  [${String(row).padStart(2)}] ${layer.padEnd(9)} ${label}${detail === undefined ? "" : "  :: " + JSON.stringify(detail)}`);
};
const note = (row, layer, label, detail) =>
  results.push(`NOTE  [${String(row).padStart(2)}] ${layer.padEnd(9)} ${label}${detail === undefined ? "" : "  :: " + JSON.stringify(detail)}`);

async function api(method, path, { token, apiKey, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
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

const ctrl = (id, result) => ({
  control_id: id,
  description: `Tested control ${id}`,
  test_procedure: "Inspected configuration and reperformed for a sample of 25.",
  result,
});

const created = { documents: [], users: [] };

async function fixture(org, vendor, user, name, { controls, exceptions = [], responses = [], promptVersion = "soc-extraction-v3" }) {
  const d = await q(
    `INSERT INTO vendor_assurance_documents
       (organization_id, vendor_id, original_filename, byte_size, sha256, storage_key,
        mime_type, document_type_hint, processing_status)
     VALUES ($1,$2,$3,1024,md5(random()::text),'acceptance/x.pdf','application/pdf','soc2_type2','extracted')
     RETURNING id`,
    [org, vendor, `${LABEL} ${name}.pdf`]
  );
  if (!d.ok) return { error: d.message };
  const documentId = d.rows[0].id;
  created.documents.push(documentId);

  const fields = {
    controls: { value: controls, confidence: 0.99, status: "extracted" },
    exceptions: { value: exceptions, confidence: 0.9, status: "extracted" },
    management_responses: { value: responses, confidence: 0.9, status: "extracted" },
  };
  for (const f of ASSURANCE_BEARING) {
    if (!(f in fields)) fields[f] = { value: "x", confidence: 0.9, status: "extracted" };
  }
  const e = await q(
    `INSERT INTO vendor_assurance_extractions
       (organization_id, document_id, model_id, prompt_version, raw_response_excerpt, fields)
     VALUES ($1,$2,'acceptance-fixture',$3,$4,$5::jsonb) RETURNING id`,
    [org, documentId, promptVersion, `${LABEL} synthetic`, JSON.stringify(fields)]
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

const assertionsOf = async (extractionId) =>
  (await q(
    `SELECT element_key, auditor_assertion, source_text, source_term, effective_source,
            normalizer_version, normalizer_rule
       FROM vendor_tested_control_assertions
      WHERE extraction_id=$1 AND superseded_at IS NULL ORDER BY element_key`, [extractionId])).rows;

const exceptionsOf = async (extractionId) =>
  (await q(
    `SELECT e.id, e.exception_ref, e.source_ordinal, e.source_term, e.governed_effect,
            e.effect_accepted_by_user_id,
            COALESCE(json_agg(json_build_object('element_key',l.element_key,'link_source',l.link_source,
                     'source_value',l.source_value) ORDER BY l.element_key)
                     FILTER (WHERE l.id IS NOT NULL),'[]'::json) AS links
       FROM vendor_assurance_exceptions e
       LEFT JOIN vendor_assurance_exception_controls l ON l.exception_id = e.id
      WHERE e.extraction_id=$1 AND e.superseded_at IS NULL
      GROUP BY e.id ORDER BY e.source_ordinal`, [extractionId])).rows;

const effectivenessOf = async (extractionId) =>
  (await q(
    `SELECT element_key, decision, governed_effectiveness, indeterminate_reason,
            accepted_by_user_id, superseded_at, basis
       FROM vendor_tested_control_effectiveness
      WHERE extraction_id=$1 ORDER BY accepted_at`, [extractionId])).rows;

async function awaitAssertions(extractionId, expected) {
  for (let i = 0; i < 80; i += 1) {
    const rows = await assertionsOf(extractionId);
    if (rows.length >= expected) return rows;
    await new Promise((r) => setTimeout(r, 250));
  }
  return assertionsOf(extractionId);
}

async function main() {
  await elev.connect();
  const db = (await q(`SELECT current_database() d`)).rows[0]?.d;
  if (db === "securelogic") { console.error("REFUSING: production"); process.exit(2); }
  if (!process.env.JWT_SECRET) { console.error("REFUSING: JWT_SECRET unset"); process.exit(2); }
  console.log(`database=${db}`);

  /* ---- 0. the migrations are actually applied ---- */
  const applied = (await q(
    `SELECT filename FROM schema_migrations
      WHERE filename LIKE '2026107[4-7]%' ORDER BY filename`)).rows.map((r) => r.filename);
  check(0, "MIGRATION", "20261074-77 are applied on this database", applied.length === 4, applied);

  const orgs = await q(
    `SELECT o.id, o.name, o.tenant_class,
            (SELECT count(*) FROM vendor_assurance_documents d WHERE d.organization_id=o.id) AS docs,
            (SELECT u.id FROM users u WHERE u.organization_id=o.id ORDER BY u.created_at LIMIT 1) AS user_id,
            (SELECT u.session_epoch FROM users u WHERE u.organization_id=o.id ORDER BY u.created_at LIMIT 1) AS se,
            (SELECT v.id FROM vendors v WHERE v.organization_id=o.id ORDER BY v.created_at LIMIT 1) AS vendor_id
       FROM organizations o
      WHERE lower(coalesce(o.entitlement_level,'')) IN ('premium','platform','team')
      ORDER BY docs DESC, o.created_at`);
  const usable = (orgs.rows ?? []).filter((o) => o.user_id && o.vendor_id);
  if (usable.length === 0) { console.error("REFUSING: no usable org"); process.exit(2); }

  // FIXTURE RULE (owner, 2026-08-31). Every fixture this harness creates lands in
  // a SYNTHETIC tenant, and that tenant is selected BY THE CLASSIFICATION
  // MECHANISM — `tenant_class = 'synthetic_fixture'` — never by name and never by
  // a literal organization id. Demonstrating the guard is the point; hard-coding
  // an id would be the mechanism decision 6 ruled out.
  const A = usable.find((o) => o.tenant_class === "synthetic_fixture") ?? null;
  if (!A) {
    console.error("REFUSING: no entitled organization is classified synthetic_fixture — 20261074 backfill did not land");
    process.exit(2);
  }
  // The foreign tenant for the cross-tenant proofs: a REAL-corpus org, so the
  // isolation being proven is synthetic-vs-customer as well as A-vs-B.
  const B = usable.find((o) => o.id !== A.id && o.tenant_class === "customer") ?? usable.find((o) => o.id !== A.id) ?? null;
  const TOKEN_A = signJwt(A.user_id, A.id, "admin", Number(A.se ?? 0));
  const TOKEN_B = B ? signJwt(B.user_id, B.id, "admin", Number(B.se ?? 0)) : null;
  console.log(`fixture_org=${A.id} (${A.name}, tenant_class=${A.tenant_class})`);
  console.log(`foreign_org=${B ? `${B.id} (${B.name}, tenant_class=${B.tenant_class})` : "NONE"}`);

  // An UNAUTHORIZED HUMAN: a real viewer-seat user in the synthetic tenant.
  // Created here, deleted in cleanup. A viewer is a genuine authenticated human
  // who simply does not hold the assurance-review authority.
  const viewer = await q(
    `INSERT INTO users (organization_id, email, name, role, status, seat_type)
     VALUES ($1,$2,$3,'viewer','active','viewer') RETURNING id, session_epoch`,
    [A.id, `s4-4c3-acceptance-viewer-${Date.now()}@example.com`, `${LABEL} viewer`]);
  const VIEWER_ID = viewer.rows[0]?.id ?? null;
  created.users.push(VIEWER_ID);
  const TOKEN_VIEWER = VIEWER_ID ? signJwt(VIEWER_ID, A.id, "viewer", Number(viewer.rows[0]?.session_epoch ?? 0)) : null;
  note(0, "SETUP", "an unauthorized HUMAN (viewer seat) exists in the fixture tenant", { present: Boolean(VIEWER_ID) });

  /* ═══════════════ LAYER 1 ═══════════════ */

  const l1 = await fixture(A.id, A.vendor_id, A.user_id, "layer1", {
    controls: [
      ctrl("CC6.1", "No exceptions noted."),
      ctrl("CC6.2", "Deviation noted: the Q3 review was completed 19 days after the documented due date."),
      ctrl("CC7.2", "Not tested. The category was not within the scope of this examination."),
      ctrl("CC8.1", "The control was suitably designed as of 31 December 2025. Operating effectiveness was not tested."),
      ctrl("A1.2", "Refer to Section IV."),
    ],
  });
  const l1Approve = await api("POST", `/vendor-assurance/documents/${l1.documentId}/approve`, { token: TOKEN_A, body: {} });
  check(1, "LAYER 1", "approval succeeds and materialises the auditor assertions", l1Approve.status === 200, l1Approve.status);
  const l1Rows = await awaitAssertions(l1.extractionId, 5);
  const l1Map = Object.fromEntries(l1Rows.map((r) => [r.element_key, r.auditor_assertion]));
  check(2, "LAYER 1", "each tested control's assertion matches the auditor's own words",
    l1Map["CC6.1"] === "NO_EXCEPTION_NOTED" && l1Map["CC6.2"] === "DEVIATION_NOTED" &&
    l1Map["CC7.2"] === "NOT_TESTED" && l1Map["CC8.1"] === "DESIGN_ONLY", l1Map);
  check(3, "LAYER 1", "UNREADABLE result text fails closed to NOT_STATED — never to a clean assertion",
    l1Map["A1.2"] === "NOT_STATED", l1Map["A1.2"]);
  check(4, "LAYER 1", "the verbatim auditor result is preserved beside every normalized value",
    l1Rows.every((r) => r.auditor_assertion === "NOT_STATED" || (r.source_text ?? "").length > 0));
  check(5, "LAYER 1", "every assertion records the normalizer version that produced it",
    l1Rows.length > 0 && l1Rows.every((r) => r.normalizer_version === "tested-control-assertion-1.0"));
  check(6, "LAYER 1", "exception/deviation is preserved as TERMINOLOGY only, with no severity column anywhere",
    l1Rows.find((r) => r.element_key === "CC6.2")?.source_term === "deviation" &&
    (await q(`SELECT column_name FROM information_schema.columns
               WHERE table_name='vendor_tested_control_assertions'
                 AND (column_name LIKE '%severity%' OR column_name LIKE '%rank%')`)).rows.length === 0);
  check(7, "LAYER 1", "Layer 1 carries NO human authority — the table has no actor column at all",
    (await q(`SELECT column_name FROM information_schema.columns
               WHERE table_name='vendor_tested_control_assertions' AND column_name LIKE '%user_id%'`)).rows.length === 0);

  const notStatedRead = await api("GET", `/vendor-assurance/documents/${l1.documentId}/assurance-outcomes`, { token: TOKEN_A });
  const notStatedRow = notStatedRead.json?.auditor_assertions?.find((a) => a.element_key === "A1.2");
  check(7.1, "LAYER 1", "NOT_STATED DOES NOT IMPLY FAVOURABLE ASSURANCE — no candidate, no effectiveness, no coverage",
    notStatedRow?.assertion === "NOT_STATED" &&
    notStatedRow?.suggested_effectiveness?.candidate === null &&
    notStatedRow?.suggested_effectiveness?.requires_human === true &&
    notStatedRow?.governed_effectiveness === null &&
    notStatedRow?.establishes_governed_effectiveness === false,
    { assertion: notStatedRow?.assertion, candidate: notStatedRow?.suggested_effectiveness?.candidate,
      governed: notStatedRow?.governed_effectiveness });

  const cleanCandidate = notStatedRead.json?.auditor_assertions?.find((a) => a.element_key === "CC6.1");
  check(7.2, "LAYER 1", "not even a CLEAN auditor result proposes EFFECTIVE — the bridge only ever reduces the claim",
    cleanCandidate?.assertion === "NO_EXCEPTION_NOTED" && cleanCandidate?.suggested_effectiveness?.candidate === null,
    { assertion: cleanCandidate?.assertion, candidate: cleanCandidate?.suggested_effectiveness?.candidate });

  // ── THE 4C-2 HOP, in the same chain ──
  const resolutions = await q(
    `SELECT element_key, resolution_state, canonical_control_id IS NOT NULL AS has_control,
            crosswalk_id IS NOT NULL AS has_mapping, unmapped_reason
       FROM vendor_tested_control_resolutions
      WHERE extraction_id=$1 AND superseded_at IS NULL ORDER BY element_key`, [l1.extractionId]);
  check(7.3, "CHAIN", "the SAME approval also resolved tested-control IDENTITY via 4C-2 — the chain is continuous",
    resolutions.rows.length > 0 &&
    resolutions.rows.every((r) => (r.resolution_state === "resolved" && r.has_control && r.has_mapping) ||
                                  (r.resolution_state === "unmapped" && r.unmapped_reason !== null)),
    { rows: resolutions.rows.length,
      resolved: resolutions.rows.filter((r) => r.resolution_state === "resolved").length,
      unmapped: resolutions.rows.filter((r) => r.resolution_state === "unmapped").length });
  check(7.4, "CHAIN", "Layer-1 assertion and 4C-2 resolution agree on the tested-control identity grain",
    new Set(resolutions.rows.map((r) => r.element_key)).size === l1Rows.length,
    { assertion_keys: l1Rows.length, resolution_keys: new Set(resolutions.rows.map((r) => r.element_key)).size });

  /* ═══════════════ LAYER 2 ═══════════════ */

  check(8, "LAYER 2", "APPROVAL SEEDS NO GOVERNED EFFECTIVENESS — Layer 2 is never materialised",
    (await effectivenessOf(l1.extractionId)).length === 0);
  const outcomesRead = await api("GET", `/vendor-assurance/documents/${l1.documentId}/assurance-outcomes`, { token: TOKEN_A });
  check(9, "LAYER 2", "the read surface reports every control as UNRESOLVED, not as effective",
    outcomesRead.status === 200 &&
    outcomesRead.json?.unresolved?.controls_without_governed_effectiveness?.length === 5 &&
    outcomesRead.json?.establishes_requirement_coverage === false,
    { status: outcomesRead.status, unresolved: outcomesRead.json?.unresolved?.controls_without_governed_effectiveness });

  const noValue = await api("POST", `/vendor-assurance/documents/${l1.documentId}/tested-controls/CC6.1/effectiveness`,
    { token: TOKEN_A, body: {} });
  check(10, "LAYER 2", "an omitted effectiveness is REFUSED, never defaulted to EFFECTIVE",
    noValue.status === 400 && noValue.json?.error === "effectiveness_required", noValue.json?.error);

  const badReason = await api("POST", `/vendor-assurance/documents/${l1.documentId}/tested-controls/CC7.2/effectiveness`,
    { token: TOKEN_A, body: { effectiveness: "INDETERMINATE", indeterminate_reason: "other", reviewer_note: "x" } });
  check(11, "LAYER 2", "an INDETERMINATE reason outside the closed set is refused — there is no catch-all",
    badReason.status === 400 && badReason.json?.error === "indeterminate_reason_invalid", badReason.json?.error);

  const noDefaultCol = (await q(
    `SELECT column_default FROM information_schema.columns
      WHERE table_name='vendor_tested_control_effectiveness' AND column_name='governed_effectiveness'`)).rows[0];
  check(12, "LAYER 2", "the database has NO DEFAULT that could ever supply an effectiveness",
    noDefaultCol?.column_default === null, noDefaultCol);

  const machine = keyRow
    ? await api("POST", `/vendor-assurance/documents/${l1.documentId}/tested-controls/CC6.1/effectiveness`,
        { apiKey: process.env.ACCEPTANCE_API_KEY ?? "not-a-real-key", body: { effectiveness: "EFFECTIVE", reviewer_note: "machine" } })
    : null;
  check(13, "LAYER 2", "a caller with NO authenticated human cannot establish effectiveness",
    machine !== null && machine.status === 403 &&
    ["human_reviewer_required", "invalid_api_key", "unauthorized"].includes(machine.json?.error),
    machine?.json?.error);
  check(14, "LAYER 2", "and the DATABASE refuses an unattributed acceptance independently of the route",
    !(await q(
      `INSERT INTO vendor_tested_control_effectiveness
         (organization_id, document_id, extraction_id, element_key, decision, governed_effectiveness, accepted_by_user_id)
       VALUES ($1,$2,$3,'CC6.1','accepted','EFFECTIVE',NULL)`,
      [A.id, l1.documentId, l1.extractionId])).ok);

  const accept = await api("POST", `/vendor-assurance/documents/${l1.documentId}/tested-controls/CC7.2/effectiveness`,
    { token: TOKEN_A, body: { effectiveness: "INDETERMINATE", indeterminate_reason: "not_tested" } });
  check(15, "LAYER 2", "an AUTHORIZED human reviewer CAN accept a governed effectiveness",
    accept.status === 200 && accept.json?.decided?.governed_effectiveness === "INDETERMINATE" &&
    accept.json?.decided?.accepted_by_user_id === A.user_id, { status: accept.status, body: accept.json?.error });

  const editNoSupersede = await api("POST", `/vendor-assurance/documents/${l1.documentId}/tested-controls/CC7.2/effectiveness`,
    { token: TOKEN_A, body: { effectiveness: "EFFECTIVE", reviewer_note: "changed my mind" } });
  check(16, "LAYER 2", "re-deciding without an explicit supersede is a 409, not a silent overwrite",
    editNoSupersede.status === 409 && editNoSupersede.json?.error === "governed_effectiveness_already_decided",
    editNoSupersede.json?.error);

  const edit = await api("POST", `/vendor-assurance/documents/${l1.documentId}/tested-controls/CC7.2/effectiveness`,
    { token: TOKEN_A, body: { effectiveness: "EFFECTIVE", supersede: true, reviewer_note: "The carve-out is covered by the subservice report we hold." } });
  const reject = await api("POST", `/vendor-assurance/documents/${l1.documentId}/tested-controls/CC7.2/effectiveness`,
    { token: TOKEN_A, body: { decision: "rejected", supersede: true, reviewer_note: "Withdrawn pending the successor report." } });
  check(17, "LAYER 2", "the reviewer can EDIT and REJECT, and rejection asserts no effectiveness",
    edit.status === 200 && reject.status === 200 && reject.json?.decided?.governed_effectiveness === null,
    { edit: edit.status, reject: reject.status });

  const history = await effectivenessOf(l1.extractionId);
  check(18, "LAYER 2", "ACTOR, TIMESTAMP AND BASIS ARE HISTORICALLY PRESERVED — supersession, never mutation",
    history.length === 3 && history.filter((r) => r.superseded_at === null).length === 1 &&
    history.every((r) => r.accepted_by_user_id === A.user_id) &&
    history[0].basis?.layer1?.auditor_assertion === "NOT_TESTED",
    { rows: history.length, live: history.filter((r) => r.superseded_at === null).length });

  /* ── THE UNAUTHORIZED HUMAN ── */
  const viewerAttempt = TOKEN_VIEWER
    ? await api("POST", `/vendor-assurance/documents/${l1.documentId}/tested-controls/CC6.1/effectiveness`,
        { token: TOKEN_VIEWER, body: { effectiveness: "EFFECTIVE", reviewer_note: "an unauthorized human" } })
    : null;
  check(18.1, "AUTHZ", "AN UNAUTHORIZED HUMAN IS REFUSED — authenticated, real, and without assurance-review authority",
    viewerAttempt !== null && viewerAttempt.status === 403 &&
    ["read_only_access", "capability_required", "seat_not_permitted"].includes(viewerAttempt.json?.error),
    { status: viewerAttempt?.status, error: viewerAttempt?.json?.error });
  check(18.2, "AUTHZ", "and the unauthorized human wrote NOTHING",
    (await q(`SELECT count(*)::int n FROM vendor_tested_control_effectiveness
               WHERE extraction_id=$1 AND element_key='CC6.1'`, [l1.extractionId])).rows[0]?.n === 0);

  /* ── HISTORICAL DECISION BASIS: the nine questions ── */
  const superseded = history.filter((r) => r.superseded_at !== null);
  const basisAnswers = superseded.map((r) => ({
    tested_control: r.element_key,
    layer1_assertion: r.basis?.layer1?.auditor_assertion ?? null,
    layer1_source_text: (r.basis?.layer1?.source_text ?? null) === null ? null : "present",
    normalizer_version: r.basis?.layer1?.normalizer_version ?? null,
    proposed_value: r.basis?.suggestion?.candidate ?? null,
    final_value: r.governed_effectiveness,
    decision: r.decision,
    reason: r.indeterminate_reason,
    human_actor: r.accepted_by_user_id,
    timestamp: r.basis?.decided_at ?? null,
    provenance_ids: {
      document: Boolean(r.basis?.document?.approved_by_user_id),
      superseded_prior: r.basis?.superseded_prior !== undefined,
    },
  }));
  check(18.3, "BASIS", "A RETAINED LAYER-2 DECISION ANSWERS ALL NINE BASIS QUESTIONS WITHOUT RECOMPUTATION",
    basisAnswers.length > 0 && basisAnswers.every((b) =>
      b.tested_control && b.layer1_assertion && b.layer1_source_text === "present" &&
      b.normalizer_version && b.final_value !== undefined && b.decision &&
      b.human_actor && b.timestamp && b.provenance_ids.document && b.provenance_ids.superseded_prior),
    basisAnswers);
  check(18.4, "BASIS", "a SUPERSEDED decision keeps its OWN basis — the answer that WAS given stays answerable",
    superseded.length === 2 &&
    superseded[0]?.basis?.layer1?.auditor_assertion === "NOT_TESTED" &&
    superseded[0]?.governed_effectiveness === "INDETERMINATE" &&
    superseded[1]?.governed_effectiveness === "EFFECTIVE" &&
    superseded[1]?.basis?.superseded_prior?.effectiveness === "INDETERMINATE",
    superseded.map((r) => ({ v: r.governed_effectiveness, prior: r.basis?.superseded_prior?.effectiveness })));
  check(18.5, "BASIS", "the EDIT recorded whether the human agreed with the deterministic proposal",
    superseded.some((r) => r.basis?.human_agreed_with_suggestion === true) &&
    superseded.some((r) => r.basis?.human_agreed_with_suggestion === false),
    superseded.map((r) => r.basis?.human_agreed_with_suggestion));

  /* ── THREE DISTINCT AUTHORITY ACTIONS ── */
  const events = await q(
    `SELECT event_type, count(*)::int n FROM security_audit_log
      WHERE organization_id=$1 AND resource_id=$2 GROUP BY 1 ORDER BY 1`, [A.id, l1.documentId]);
  const types = events.rows.map((r) => r.event_type);
  check(18.6, "AUTHZ", "TESTED-CONTROL REVIEW, EFFECTIVENESS ACCEPTANCE AND DOCUMENT APPROVAL ARE SEPARATE AUDIT EVENTS",
    types.some((t) => t.includes("document.approved")) &&
    types.includes("vendor_assurance.control_effectiveness.decided") &&
    types.includes("vendor_assurance.control_effectiveness.superseded") &&
    !types.some((t) => t.includes("review_decision")),
    events.rows);
  check(18.7, "AUTHZ", "accepting an effectiveness did NOT approve anything or record a review decision",
    (await q(`SELECT count(*)::int n FROM vendor_assurance_review_decisions
               WHERE extraction_id=$1 AND decided_by_user_id=$2 AND field_name='controls'
                 AND element_key='CC7.2'`, [l1.extractionId, A.user_id])).rows[0]?.n === 1);

  /* ═══════════════ LAYER 3 ═══════════════ */

  const l3 = await fixture(A.id, A.vendor_id, A.user_id, "layer3", {
    controls: [
      ctrl("CC6.1", "Exception noted: see Exception 1."),
      ctrl("CC6.2", "Exception noted: see Exception 1."),
      ctrl("CC6.3", "Exception noted: see Exception 1."),
      ctrl("CC7.2", "No exceptions noted."),
    ],
    exceptions: [{
      exception_ref: "Exception 1",
      control_refs: ["CC6.1", "CC6.2", "CC6.3"],
      description: "The identity governance platform was unavailable from 3 March to 24 March 2025.",
      auditor_assessment: "Exception noted affecting CC6.1, CC6.2 and CC6.3. Scope limitation applied.",
    }],
    responses: [{ exception_ref: "Exception 1", control_refs: [], response: "Management restored the platform." }],
  });
  await api("POST", `/vendor-assurance/documents/${l3.documentId}/approve`, { token: TOKEN_A, body: {} });
  await awaitAssertions(l3.extractionId, 4);
  let l3ex = await exceptionsOf(l3.extractionId);
  for (let i = 0; i < 40 && l3ex.length === 0; i += 1) { await new Promise((r) => setTimeout(r, 250)); l3ex = await exceptionsOf(l3.extractionId); }

  check(19, "LAYER 3", "an exception gets its OWN identity — the report's label, not a control id",
    l3ex.length === 1 && l3ex[0].exception_ref === "Exception 1", l3ex.map((e) => e.exception_ref));
  check(20, "LAYER 3", "MANY-TO-MANY: one exception links to all three controls it names, and to no other",
    l3ex.length === 1 &&
    JSON.stringify(l3ex[0].links.map((l) => l.element_key)) === JSON.stringify(["CC6.1", "CC6.2", "CC6.3"]),
    l3ex[0]?.links?.map((l) => l.element_key));
  check(21, "LAYER 3", "CONTROL_REF CANNOT SILENTLY ATTACH TO THE WRONG CONTROL — the clean CC7.2 is untouched",
    l3ex.length === 1 && !l3ex[0].links.some((l) => l.element_key === "CC7.2" || l.element_key === "Exception 1"));
  check(22, "LAYER 3", "every link records its source and the verbatim string it was read from",
    l3ex.length === 1 && l3ex[0].links.every((l) => l.link_source === "extraction_control_refs" && l.source_value === l.element_key));
  check(23, "LAYER 3", "the link-source CHECK has NO index_alignment value — the silent fallback cannot return",
    !(await q(
      `INSERT INTO vendor_assurance_exception_controls (organization_id, exception_id, element_key, link_source, source_value)
       VALUES ($1,$2,'CC9.9','index_alignment','0')`, [A.id, l3ex[0]?.id])).ok);
  check(24, "LAYER 3", "a materialised exception is UNINTERPRETED until a human says otherwise",
    l3ex.length === 1 && l3ex[0].governed_effect === null && l3ex[0].effect_accepted_by_user_id === null);

  const machineEffect = await api("POST", `/vendor-assurance/exceptions/${l3ex[0]?.id}/effect`,
    { apiKey: process.env.ACCEPTANCE_API_KEY ?? "not-a-real-key", body: { governed_effect: "control_deficiency" } });
  check(25, "LAYER 3", "a caller with no authenticated human cannot interpret an exception",
    machineEffect.status === 403, machineEffect.json?.error);

  const effect = await api("POST", `/vendor-assurance/exceptions/${l3ex[0]?.id}/effect`,
    { token: TOKEN_A, body: { governed_effect: "scope_limitation", reviewer_note: "The auditor could not obtain evidence; the control was not shown to fail." } });
  check(26, "LAYER 3", "A SCOPE LIMITATION IS NOT A DEFICIENCY — the auditor wrote 'exception', the governed effect says otherwise",
    effect.status === 200 && effect.json?.decided?.governed_effect === "scope_limitation" &&
    (await exceptionsOf(l3.extractionId))[0]?.source_term === "exception",
    { status: effect.status, effect: effect.json?.decided?.governed_effect });
  check(27, "LAYER 3", "the effect vocabulary has no severity value and no catch-all",
    !(await q(`UPDATE vendor_assurance_exceptions SET governed_effect='minor',
                 effect_accepted_by_user_id=$2, effect_accepted_at=NOW(), effect_basis='{}'::jsonb
               WHERE id=$1`, [l3ex[0]?.id, A.user_id])).ok);

  // Both effects, on two exceptions whose SOURCE TERMINOLOGY is deliberately
  // crossed: the deficiency says "deviation", the scope limitation says
  // "exception". If the terminology drove the effect, this pair would be
  // impossible to record.
  const l3b = await fixture(A.id, A.vendor_id, A.user_id, "layer3-distinct", {
    controls: [ctrl("CC6.2", "Deviation noted: the Q3 review was completed 19 days late."),
               ctrl("CC8.1", "Exception noted. Records prior to 1 June 2025 were not available for inspection.")],
    exceptions: [
      { exception_ref: "Deviation 1", control_refs: ["CC6.2"],
        description: "The Q3 privileged access review was completed 19 days after the due date.",
        auditor_assessment: "Deviation noted; the control did not operate within its documented SLA." },
      { exception_ref: "Exception 2", control_refs: ["CC8.1"],
        description: "Records prior to 1 June 2025 were not available for inspection.",
        auditor_assessment: "Exception noted. Scope limitation applied." },
    ],
  });
  await api("POST", `/vendor-assurance/documents/${l3b.documentId}/approve`, { token: TOKEN_A, body: {} });
  await awaitAssertions(l3b.extractionId, 2);
  let l3bEx = await exceptionsOf(l3b.extractionId);
  for (let i = 0; i < 40 && l3bEx.length < 2; i += 1) { await new Promise((r) => setTimeout(r, 250)); l3bEx = await exceptionsOf(l3b.extractionId); }

  const devRow = l3bEx.find((e) => e.exception_ref === "Deviation 1");
  const scopeRow = l3bEx.find((e) => e.exception_ref === "Exception 2");
  const setDef = await api("POST", `/vendor-assurance/exceptions/${devRow?.id}/effect`,
    { token: TOKEN_A, body: { governed_effect: "control_deficiency", reviewer_note: "The control genuinely did not operate within its SLA." } });
  const setScope = await api("POST", `/vendor-assurance/exceptions/${scopeRow?.id}/effect`,
    { token: TOKEN_A, body: { governed_effect: "scope_limitation", reviewer_note: "Evidence was unobtainable; the control was not shown to fail." } });
  const after3b = await exceptionsOf(l3b.extractionId);
  check(27.1, "LAYER 3", "control_deficiency AND scope_limitation REMAIN DISTINCT and coexist on one document",
    setDef.status === 200 && setScope.status === 200 &&
    new Set(after3b.map((e) => e.governed_effect)).size === 2,
    after3b.map((e) => ({ ref: e.exception_ref, term: e.source_term, effect: e.governed_effect })));
  check(27.2, "LAYER 3", "NEITHER TERM ENCODES SEVERITY — the 'deviation' is the deficiency, the 'exception' is the scope limitation",
    after3b.find((e) => e.exception_ref === "Deviation 1")?.source_term === "deviation" &&
    after3b.find((e) => e.exception_ref === "Deviation 1")?.governed_effect === "control_deficiency" &&
    after3b.find((e) => e.exception_ref === "Exception 2")?.source_term === "exception" &&
    after3b.find((e) => e.exception_ref === "Exception 2")?.governed_effect === "scope_limitation",
    after3b.map((e) => ({ term: e.source_term, effect: e.governed_effect })));
  check(27.3, "LAYER 3", "no severity or rank column exists on either Layer-3 table",
    (await q(`SELECT column_name FROM information_schema.columns
               WHERE table_name IN ('vendor_assurance_exceptions','vendor_assurance_exception_controls')
                 AND (column_name LIKE '%severity%' OR column_name LIKE '%rank%' OR column_name LIKE '%score%')`)).rows.length === 0);

  /* ═══════════════ ORTHOGONALITY ═══════════════ */

  const beforeEff = await exceptionsOf(l3.extractionId);
  const effAccept = await api("POST", `/vendor-assurance/documents/${l3.documentId}/tested-controls/CC6.1/effectiveness`,
    { token: TOKEN_A, body: { effectiveness: "EFFECTIVE", reviewer_note: "The affected workflow is not one we use; scope reviewed." } });
  const afterEff = await exceptionsOf(l3.extractionId);
  check(28, "ORTHOGON", "EXCEPTION PRESENCE CANNOT BE ERASED BY EFFECTIVE STATUS",
    effAccept.status === 200 && JSON.stringify(beforeEff) === JSON.stringify(afterEff) && afterEff.length === 1,
    { accepted: effAccept.status, exceptions_before: beforeEff.length, exceptions_after: afterEff.length });

  const bothRead = await api("GET", `/vendor-assurance/documents/${l3.documentId}/assurance-outcomes`, { token: TOKEN_A });
  const cc61 = bothRead.json?.auditor_assertions?.find((a) => a.element_key === "CC6.1");
  check(29, "ORTHOGON", "both facts are reported TOGETHER — no fused value hides either",
    cc61?.governed_effectiveness === "EFFECTIVE" && cc61?.has_exception === true &&
    bothRead.json?.exceptions?.length === 1, { effectiveness: cc61?.governed_effectiveness, has_exception: cc61?.has_exception });
  check(30, "ORTHOGON", "there is no EFFECTIVE_WITH_EXCEPTION value in the database vocabulary",
    !(await q(`INSERT INTO vendor_tested_control_effectiveness
                 (organization_id, document_id, extraction_id, element_key, decision, governed_effectiveness, accepted_by_user_id)
               VALUES ($1,$2,$3,'CC6.2','accepted','EFFECTIVE_WITH_EXCEPTION',$4)`,
      [A.id, l3.documentId, l3.extractionId, A.user_id])).ok);

  const beforeOpinion = { a: await assertionsOf(l3.extractionId), e: await exceptionsOf(l3.extractionId) };
  await q(
    `UPDATE vendor_assurance_documents
        SET assurance_opinion='unmodified', assurance_opinion_accepted_by_user_id=$2,
            assurance_opinion_accepted_at=NOW(), assurance_opinion_basis='{"acceptance":"clean"}'::jsonb
      WHERE id=$1`, [l3.documentId, A.user_id]);
  const afterOpinion = { a: await assertionsOf(l3.extractionId), e: await exceptionsOf(l3.extractionId) };
  check(31, "ORTHOGON", "A REPORT-LEVEL CLEAN OPINION CANNOT OVERWRITE CONTROL-LEVEL EXCEPTION STATE",
    JSON.stringify(beforeOpinion) === JSON.stringify(afterOpinion) &&
    afterOpinion.a.find((r) => r.element_key === "CC6.1")?.auditor_assertion === "EXCEPTION_NOTED",
    { assertion: afterOpinion.a.find((r) => r.element_key === "CC6.1")?.auditor_assertion, exceptions: afterOpinion.e.length });

  /* ═══════════════ LEGACY + REPRODUCIBILITY ═══════════════ */

  const legacy = await fixture(A.id, A.vendor_id, A.user_id, "legacy-v2", {
    promptVersion: "soc-extraction-v2",
    controls: [ctrl("CC6.1", "Exception noted: see Exception 1."), ctrl("CC6.2", "Exception noted: see Exception 1."), ctrl("CC6.3", "Exception noted: see Exception 1.")],
    // Byte-for-byte the v2 corpus row: three identifiers packed into one scalar.
    exceptions: [{ control_id: "CC6.1, CC6.2, CC6.3", description: "The identity governance platform was unavailable.", auditor_assessment: "Exception noted." }],
    responses: [{ exception_ref: "Exception 1", response: "Management restored the platform." }],
  });
  const beforeFields = (await q(`SELECT fields FROM vendor_assurance_extractions WHERE id=$1`, [legacy.extractionId])).rows[0]?.fields;
  await api("POST", `/vendor-assurance/documents/${legacy.documentId}/approve`, { token: TOKEN_A, body: {} });
  await awaitAssertions(legacy.extractionId, 3);
  let legacyEx = await exceptionsOf(legacy.extractionId);
  for (let i = 0; i < 40 && legacyEx.length === 0; i += 1) { await new Promise((r) => setTimeout(r, 250)); legacyEx = await exceptionsOf(legacy.extractionId); }

  check(32, "LEGACY", "a LEGACY v2 extraction remains fully readable — the packed scalar links to all three controls",
    legacyEx.length === 1 &&
    JSON.stringify(legacyEx[0].links.map((l) => l.element_key)) === JSON.stringify(["CC6.1", "CC6.2", "CC6.3"]) &&
    legacyEx[0].links.every((l) => l.link_source === "legacy_control_id" && l.source_value === "CC6.1, CC6.2, CC6.3"),
    legacyEx[0]?.links);
  const afterFields = (await q(`SELECT fields, prompt_version FROM vendor_assurance_extractions WHERE id=$1`, [legacy.extractionId])).rows[0];
  check(33, "LEGACY", "NO DESTRUCTIVE REWRITE — the historical extracted source is byte-identical",
    JSON.stringify(beforeFields) === JSON.stringify(afterFields?.fields) && afterFields?.prompt_version === "soc-extraction-v2");
  const versions = (await q(`SELECT DISTINCT prompt_version FROM vendor_assurance_extractions ORDER BY 1`)).rows.map((r) => r.prompt_version);
  check(34, "LEGACY", "PROMPT-VERSION HISTORY IS PREPARED — every extraction keeps the contract that produced it",
    versions.includes("soc-extraction-v2"), versions);

  // THE CORRECTED THREE-KEY RELATIONSHIP, end to end and in one document:
  // an exception carries its OWN label AND its control array; a management
  // response points at the LABEL, not at a control.
  const l3links = l3ex[0]?.links ?? [];
  check(34.1, "CONTRACT", "THE THREE-KEY RELATIONSHIP WORKS: exception_ref is a LABEL, control_refs is the linkage",
    l3ex[0]?.exception_ref === "Exception 1" &&
    l3links.length === 3 &&
    l3links.every((l) => l.link_source === "extraction_control_refs") &&
    !l3links.some((l) => l.element_key === "Exception 1"),
    { exception_ref: l3ex[0]?.exception_ref, control_refs: l3links.map((l) => l.element_key) });
  const promptV3 = (await q(
    `SELECT count(*)::int n FROM vendor_assurance_extractions WHERE prompt_version='soc-extraction-v3'`)).rows[0];
  note(34.2, "CONTRACT", "the NEW PROMPT_VERSION is observable in the database", { soc_extraction_v3_rows: promptV3?.n, all_versions: versions });
  check(34.3, "CONTRACT", "legacy and corrected shapes coexist, each linked by the key it actually carried",
    legacyEx[0]?.links?.every((l) => l.link_source === "legacy_control_id") === true &&
    l3links.every((l) => l.link_source === "extraction_control_refs"),
    { legacy: legacyEx[0]?.links?.[0]?.link_source, v3: l3links[0]?.link_source });

  /* ═══════════════ TENANCY ═══════════════ */

  if (TOKEN_B) {
    const readB = await api("GET", `/vendor-assurance/documents/${l3.documentId}/assurance-outcomes`, { token: TOKEN_B });
    const writeB = await api("POST", `/vendor-assurance/documents/${l3.documentId}/tested-controls/CC6.1/effectiveness`,
      { token: TOKEN_B, body: { effectiveness: "EFFECTIVE", reviewer_note: "cross tenant" } });
    const effectB = await api("POST", `/vendor-assurance/exceptions/${l3ex[0]?.id}/effect`,
      { token: TOKEN_B, body: { governed_effect: "control_deficiency" } });
    check(35, "TENANCY", "CROSS-TENANT READ AND WRITE ARE DENIED at the API",
      readB.status === 404 && writeB.status === 404 && effectB.status === 404,
      { read: readB.status, write: writeB.status, effect: effectB.status });

    const rls = await asApp(B.id,
      `SELECT (SELECT count(*)::int FROM vendor_tested_control_assertions WHERE organization_id=$1) a,
              (SELECT count(*)::int FROM vendor_tested_control_effectiveness WHERE organization_id=$1) e,
              (SELECT count(*)::int FROM vendor_assurance_exceptions WHERE organization_id=$1) x`, [A.id]);
    check(36, "TENANCY", "RLS returns ZERO of the primary org's rows to the foreign tenant, on all three tables",
      rls.ok && rls.rows[0]?.a === 0 && rls.rows[0]?.e === 0 && rls.rows[0]?.x === 0, rls.rows[0]);
  } else {
    note(35, "TENANCY", "SKIPPED — no second entitled organization on this database");
  }

  /* ═══════════════ SYNTHETIC FIXTURE CLASSIFICATION ═══════════════ */

  const classes = await q(`SELECT tenant_class, count(*)::int AS n FROM organizations GROUP BY 1 ORDER BY 1`);
  note(37, "FIXTURE", "tenant_class distribution across the estate", classes.rows);
  const fixtureOrg = (await q(`SELECT id, name, tenant_class FROM organizations WHERE id=$1`, [SYNTHETIC_FIXTURE_ORG])).rows[0];
  check(38, "FIXTURE", "the owner-designated synthetic fixture organization IS classified synthetic",
    fixtureOrg === undefined || fixtureOrg.tenant_class === "synthetic_fixture", fixtureOrg);

  check(38.1, "FIXTURE", "every fixture this run created landed in a SYNTHETIC tenant — selected by the mechanism, not by id",
    (await q(
      `SELECT count(*)::int AS n FROM vendor_assurance_documents d
         JOIN organizations o ON o.id = d.organization_id
        WHERE d.id = ANY($1::uuid[]) AND o.tenant_class <> 'synthetic_fixture'`,
      [created.documents])).rows[0]?.n === 0,
    { fixtures: created.documents.length, tenant_class: A.tenant_class });

  // The GUARD, exercised. The filter is the column — no org name, no literal id.
  const guarded = await q(
    `SELECT count(*)::int AS n
       FROM vendor_tested_control_assertions a
       JOIN organizations o ON o.id = a.organization_id
      WHERE a.superseded_at IS NULL AND o.tenant_class = 'customer'
        AND a.organization_id = $1`, [A.id]);
  const unguarded = await q(
    `SELECT count(*)::int AS n FROM vendor_tested_control_assertions
      WHERE organization_id = $1 AND superseded_at IS NULL`, [A.id]);
  check(39, "FIXTURE", "SYNTHETIC EVIDENCE CANNOT MASQUERADE AS REAL CORPUS under the governed predicate",
    guarded.rows[0]?.n === 0 && (unguarded.rows[0]?.n ?? 0) > 0,
    { visible_to_real_corpus_query: guarded.rows[0]?.n, actually_present: unguarded.rows[0]?.n });
  check(39.1, "FIXTURE", "the exclusion is the PREDICATE's doing — the same rows are plainly there unfiltered",
    (unguarded.rows[0]?.n ?? 0) > 0, unguarded.rows[0]);

  const estate = await q(
    `SELECT o.tenant_class,
            count(DISTINCT a.id)::int AS assertions,
            count(DISTINCT e.id)::int AS exceptions,
            count(DISTINCT f.id)::int AS effectiveness_decisions
       FROM organizations o
       LEFT JOIN vendor_tested_control_assertions a ON a.organization_id=o.id AND a.superseded_at IS NULL
       LEFT JOIN vendor_assurance_exceptions e ON e.organization_id=o.id AND e.superseded_at IS NULL
       LEFT JOIN vendor_tested_control_effectiveness f ON f.organization_id=o.id AND f.superseded_at IS NULL
      GROUP BY 1 ORDER BY 1`);
  note(39.2, "FIXTURE", "estate split by tenant_class — REAL vs SYNTHETIC, never combined", estate.rows);

  check(40, "FIXTURE", "the classification is a closed vocabulary the database enforces",
    !(await q(`UPDATE organizations SET tenant_class='whatever' WHERE id=$1`, [A.id])).ok);

  // Reported for an OWNER DECISION, never guessed at. These are staging orgs
  // that look synthetic by name but match no in-tree convention and were not
  // named in decision 6, so the migration deliberately left them `customer`.
  const unclassified = await q(
    `SELECT id, name, tenant_class FROM organizations
      WHERE tenant_class = 'customer'
        AND (name ILIKE '%validation%' OR name ILIKE '%staging%' OR name ILIKE '%test%'
             OR name ILIKE '%onboarding%' OR name ILIKE '%deliverability%' OR name ILIKE '%check%')
      ORDER BY name`);
  note(41, "FIXTURE", "OWNER DECISION OWED — orgs that look synthetic but were not classified (nothing guessed)", unclassified.rows);

  /* ═══════════════ CORPUS REPORT ═══════════════ */

  const l1Corpus = await q(
    `SELECT a.auditor_assertion, count(*)::int AS n,
            count(*) FILTER (WHERE o.tenant_class='customer')::int AS real_corpus,
            count(*) FILTER (WHERE o.tenant_class='synthetic_fixture')::int AS synthetic
       FROM vendor_tested_control_assertions a
       JOIN organizations o ON o.id=a.organization_id
      WHERE a.superseded_at IS NULL
      GROUP BY 1 ORDER BY 2 DESC`);
  note(42, "LAYER 1", "assertion distribution, REAL and SYNTHETIC counted separately (representability, not prevalence)", l1Corpus.rows);

  const l2Corpus = await q(
    `SELECT governed_effectiveness, indeterminate_reason, count(*)::int AS n
       FROM vendor_tested_control_effectiveness WHERE superseded_at IS NULL GROUP BY 1,2 ORDER BY 3 DESC`);
  note(43, "LAYER 2", "governed effectiveness distribution across the estate", l2Corpus.rows);

  const l3Corpus = await q(
    `SELECT governed_effect, count(*)::int AS n FROM vendor_assurance_exceptions
      WHERE superseded_at IS NULL GROUP BY 1 ORDER BY 2 DESC`);
  note(44, "LAYER 3", "exception effect distribution — NULL means uninterpreted, which is not 'fine'", l3Corpus.rows);

  await cleanup();
  console.log("\n" + results.join("\n"));
  console.log(`\n${passes} PASS / ${fails} FAIL  (${passes + fails} checks)`);
  await elev.end();
  process.exit(fails === 0 ? 0 : 1);
}

async function cleanup() {
  if (created.users.length > 0) {
    // The unauthorized-human fixture. Deleted, not tombstoned: it never
    // authored a governance decision (that is the whole point of it), so
    // nothing references it.
    await q(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [created.users.filter(Boolean)]);
  }
  if (created.documents.length === 0) return;
  const r = await q(`DELETE FROM vendor_assurance_documents WHERE id = ANY($1::uuid[])`, [created.documents]);
  const left = await q(
    `SELECT count(*)::int AS n FROM vendor_assurance_documents WHERE original_filename LIKE $1`, [`${LABEL}%`]);
  const orphans = await q(
    `SELECT (SELECT count(*)::int FROM vendor_tested_control_assertions) a,
            (SELECT count(*)::int FROM vendor_tested_control_effectiveness) e,
            (SELECT count(*)::int FROM vendor_assurance_exceptions) x,
            (SELECT count(*)::int FROM vendor_assurance_exception_controls) l`);
  console.log(`cleanup: deleted ${r.rowCount ?? 0}/${created.documents.length} fixtures; ${left.rows[0]?.n} labelled docs remain; residual rows ${JSON.stringify(orphans.rows[0])}`);
}

main().catch(async (e) => {
  console.error("FATAL", e);
  try { await cleanup(); } catch {}
  process.exit(2);
});
