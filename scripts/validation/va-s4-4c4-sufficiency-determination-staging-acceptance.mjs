/**
 * va-s4-4c4-sufficiency-determination-staging-acceptance.mjs - VA-S4-4C-4 live.
 *
 * The claim: **a vendor assurance candidate cannot become "sufficient" while any
 * of the twelve coverage vetoes fired or could not be evaluated - and the
 * database, not the route, is what enforces it.**
 *
 * The negative proofs are the point. A green run that only showed a
 * determination being written would prove nothing this package cares about.
 *
 *   B64=$(gzip -9c scripts/validation/va-s4-4c4-sufficiency-determination-staging-acceptance.mjs | base64 -w0)
 *   render jobs create srv-d7n0rju8bjmc738jbs7g --confirm \
 *     --start-command "echo $B64 | base64 -d | gunzip > ./acc.mjs && node ./acc.mjs"
 *
 * Refuses a database named `securelogic`. Fixtures are labelled
 * `[S4-4C-4 ACCEPTANCE]` and are removed at the end - API keys by REVOCATION,
 * because a used api_keys row can never be deleted (the security_audit_log WORM
 * guard refuses the ON DELETE SET NULL cascade). Exits non-zero on any failure.
 */
import pg from "pg";
import { createHmac, createHash, randomBytes } from "node:crypto";

const BASE = "https://securelogic-engine-staging.onrender.com/api";
const LABEL = "[S4-4C-4 ACCEPTANCE]";
const MIGRATIONS = [
  "20261078_staging_tenant_class_backfill.sql",
  "20261079_requirement_sufficiency_determination.sql",
];
const ASSURANCE_BEARING = [
  "report_type", "report_period_start", "report_period_end",
  "trust_services_criteria", "auditor_opinion", "controls", "exceptions",
  "subservice_method", "subservice_organizations",
];
const EVALUATED_VETOES = [
  "report_scope", "report_period", "report_type", "tested_control_result",
  "control_exception", "carve_out", "accepted_opinion", "contradictory_evidence",
  "open_findings", "mapping_authority",
];
/** Owner decision 6: the retained synthetic validation fixture organisation. */
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
const check = (row, group, label, ok, detail) => {
  ok ? passes++ : fails++;
  results.push(
    `${ok ? "PASS" : "FAIL"}  [${String(row).padStart(2)}] ${group.padEnd(10)} ${label}` +
    (detail === undefined ? "" : "  :: " + JSON.stringify(detail))
  );
};
const note = (row, group, label, detail) =>
  results.push(
    `NOTE  [${String(row).padStart(2)}] ${group.padEnd(10)} ${label}` +
    (detail === undefined ? "" : "  :: " + JSON.stringify(detail))
  );

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
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body is itself a result */ }
  return { status: r.status, json, text: text.slice(0, 300) };
}

const elev = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  ssl: ssl(),
});
const q = async (s, p = []) => {
  try {
    const r = await elev.query(s, p);
    return { ok: true, rows: r.rows, rowCount: r.rowCount };
  } catch (e) {
    return { ok: false, code: e.code, message: e.message, rows: [] };
  }
};

const created = { documents: [], users: [], apiKeys: [], frameworks: [] };

async function main() {
  await elev.connect();
  const db = (await elev.query("SELECT current_database() d")).rows[0].d;
  if (db === "securelogic") {
    console.error("REFUSING to run against the production database.");
    process.exit(2);
  }
  note(0, "env", "database", db);

  /* ── 0. the migrations are actually applied ─────────────────────────── */
  // Named explicitly, one row each. A LIKE pattern with a character class
  // matches NOTHING in Postgres and would give an always-red check.
  const applied = await q(
    `SELECT filename, applied_at FROM schema_migrations WHERE filename = ANY($1) ORDER BY filename`,
    [MIGRATIONS]
  );
  check(0, "migration", "20261078 and 20261079 are applied",
    applied.rows.length === MIGRATIONS.length,
    applied.rows.map((r) => `${r.filename} @ ${r.applied_at}`));

  const table = await q(
    `SELECT relrowsecurity FROM pg_class WHERE relname = 'vendor_requirement_sufficiency_determinations'`
  );
  check(1, "migration", "the determination table exists with RLS enabled",
    table.rows[0]?.relrowsecurity === true, table.rows[0] ?? null);

  const trig = await q(
    `SELECT tgname FROM pg_trigger WHERE tgname = 'trg_vendor_assurance_require_human_determiner'`
  );
  check(2, "migration", "the human-attribution trigger exists", trig.rows.length === 1);

  const noOverride = await q(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'vendor_requirement_sufficiency_determinations'
        AND (column_name ILIKE '%override%' OR column_name ILIKE '%waive%' OR column_name ILIKE '%force%')`
  );
  // The owner ruling, as an absence: there is no column through which a human
  // could wave past a veto that did not pass.
  check(3, "migration", "NO override / waiver column exists", noOverride.rows.length === 0,
    noOverride.rows.map((r) => r.column_name));

  /* ── 1. the tenant_class decision landed, and ONLY where provenance said ── */
  const cls = await q(
    `SELECT name, tenant_class FROM organizations
      WHERE id = 'a0755951-0809-4481-a733-38334b5df85f'::uuid`
  );
  check(4, "tenant", "the provenance-established org is now synthetic_fixture",
    cls.rows[0]?.tenant_class === "synthetic_fixture", cls.rows[0] ?? null);

  const stagingInc = await q(
    `SELECT tenant_class FROM organizations
      WHERE id = 'fe2ede61-e1f3-499f-b2b3-3ce530f4fc06'::uuid`
  );
  // Deliberate: name similarity is not provenance, so the corpus organisation
  // was left alone and the historical REAL/SYNTHETIC split still stands.
  check(5, "tenant", "the corpus org was NOT reclassified on its name",
    stagingInc.rows[0]?.tenant_class === "customer", stagingInc.rows[0] ?? null);

  const census = await q(`SELECT tenant_class, COUNT(*)::int n FROM organizations GROUP BY 1 ORDER BY 1`);
  note(6, "tenant", "tenant_class census", census.rows);

  /* ── 2. build the chain: an approved document that resolves ──────────── */
  const org = SYNTHETIC_FIXTURE_ORG;
  const owner = await q(`SELECT id FROM users WHERE organization_id = $1 AND status = 'active' LIMIT 1`, [org]);
  const ownerId = owner.rows[0]?.id ?? null;
  check(7, "fixture", "the fixture organisation has an active user", ownerId !== null);
  if (ownerId === null) return;

  const epoch = await q(`SELECT session_epoch FROM users WHERE id = $1`, [ownerId]);
  const jwt = signJwt(ownerId, org, "admin", epoch.rows[0]?.session_epoch ?? 0);

  const vendor = await q(`SELECT id FROM vendors WHERE organization_id = $1 LIMIT 1`, [org]);
  const vendorId = vendor.rows[0]?.id ?? null;
  check(8, "fixture", "the fixture organisation has a vendor", vendorId !== null);
  if (vendorId === null) return;

  // The organisation must hold a framework the published crosswalk reaches, or
  // there are no candidates at all. Discovered, never assumed.
  const target = await q(
    `SELECT framework_key, framework_version, COUNT(*)::int n
       FROM canonical_control_crosswalk
      WHERE status = 'published' AND superseded_at IS NULL AND framework_key <> 'soc2'
      GROUP BY 1,2 ORDER BY n DESC LIMIT 1`
  );
  const fw = target.rows[0] ?? null;
  check(9, "fixture", "a published non-SOC2 crosswalk target exists", fw !== null, fw);
  if (fw === null) return;

  let orgFw = await q(
    `SELECT id FROM frameworks WHERE organization_id = $1 AND framework_key = $2 AND version = $3 LIMIT 1`,
    [org, fw.framework_key, fw.framework_version]
  );
  if (orgFw.rows.length === 0) {
    const ins = await q(
      `INSERT INTO frameworks (organization_id, name, framework_key, version)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [org, `${LABEL} ${fw.framework_key}`, fw.framework_key, fw.framework_version]
    );
    orgFw = ins;
    if (ins.rows[0]) created.frameworks.push(ins.rows[0].id);
    const refs = await q(
      `SELECT DISTINCT requirement_reference r FROM canonical_control_crosswalk
        WHERE framework_key = $1 AND framework_version = $2 AND status = 'published'
          AND superseded_at IS NULL`,
      [fw.framework_key, fw.framework_version]
    );
    for (const row of refs.rows) {
      await q(
        `INSERT INTO requirements (framework_id, reference_id, title, description)
         VALUES ($1,$2,$3,$3) ON CONFLICT DO NOTHING`,
        [ins.rows[0].id, row.r, `${LABEL} requirement ${row.r}`]
      );
    }
  }
  note(10, "fixture", "organisation framework in use",
    { framework_key: fw.framework_key, version: fw.framework_version, id: orgFw.rows[0]?.id });

  const sha = createHash("sha256").update(`4c4-${Date.now()}`).digest("hex");
  const controls = [{
    control_id: "CC6.1",
    description: "Logical access provisioning is approved before access is granted.",
    test_procedure: "Inspected the approval record for a sample of 25 provisioning events.",
    result: "No exceptions noted.",
  }];
  const fields = {
    controls: { value: controls, confidence: 0.99, status: "extracted" },
    exceptions: { value: [], confidence: 0.9, status: "extracted" },
    management_responses: { value: [], confidence: 0.9, status: "extracted" },
    report_type: { value: "SOC 2 Type II", confidence: 0.99, status: "extracted" },
    report_period_start: { value: "2025-01-01", confidence: 0.99, status: "extracted" },
    report_period_end: { value: "2025-12-31", confidence: 0.99, status: "extracted" },
    trust_services_criteria: { value: ["Security", "Availability"], confidence: 0.99, status: "extracted" },
    subservice_method: { value: "Inclusive", confidence: 0.99, status: "extracted" },
  };
  for (const f of ASSURANCE_BEARING) {
    if (!(f in fields)) fields[f] = { value: "x", confidence: 0.9, status: "extracted" };
  }

  const docIns = await q(
    `INSERT INTO vendor_assurance_documents
       (organization_id, vendor_id, uploaded_by_user_id, original_filename, byte_size, sha256,
        storage_key, mime_type, document_type_hint, processing_status)
     VALUES ($1,$2,$3,$4,1024,$5,$6,'application/pdf','soc2_type2','extracted') RETURNING id`,
    [org, vendorId, ownerId, `${LABEL} candidate.pdf`, sha, `org/${org}/${sha}.pdf`]
  );
  const documentId = docIns.rows[0]?.id ?? null;
  if (documentId) created.documents.push(documentId);
  check(11, "fixture", "an extracted document was created", documentId !== null);
  if (documentId === null) return;

  const exIns = await q(
    `INSERT INTO vendor_assurance_extractions
       (organization_id, document_id, model_id, prompt_version, fields)
     VALUES ($1,$2,'acceptance-model','soc-extraction-v3',$3::jsonb) RETURNING id`,
    [org, documentId, JSON.stringify(fields)]
  );
  const extractionId = exIns.rows[0]?.id ?? null;

  for (const f of ASSURANCE_BEARING) {
    await q(
      `INSERT INTO vendor_assurance_review_decisions
         (organization_id, extraction_id, field_name, decision, decided_by_user_id)
       VALUES ($1,$2,$3,'accept',$4)`,
      [org, extractionId, f, ownerId]
    );
  }
  for (const c of controls) {
    await q(
      `INSERT INTO vendor_assurance_review_decisions
         (organization_id, extraction_id, field_name, decision, decided_by_user_id,
          element_key, element_snapshot)
       VALUES ($1,$2,'controls','accept',$3,$4,$5::jsonb)`,
      [org, extractionId, ownerId, c.control_id, JSON.stringify(c)]
    );
  }

  const approve = await api("POST", `/vendor-assurance/documents/${documentId}/approve`, { token: jwt, body: {} });
  check(12, "chain", "the document approves under governed review at both grains",
    approve.status === 200, { status: approve.status, body: approve.json ?? approve.text });

  let resolutions = [];
  for (let i = 0; i < 60; i += 1) {
    const r = await q(
      `SELECT id, element_key, canonical_control_id FROM vendor_tested_control_resolutions
        WHERE extraction_id = $1 AND superseded_at IS NULL AND resolution_state = 'resolved'`,
      [extractionId]
    );
    if (r.rows.length > 0) { resolutions = r.rows; break; }
    await new Promise((res) => setTimeout(res, 500));
  }
  check(13, "chain", "4C-2 materialised resolved tested-control resolutions",
    resolutions.length > 0, { resolutions: resolutions.length });

  /* ── 3. the twelve-veto evaluation, live ────────────────────────────── */
  const cand = await api("GET", `/vendor-assurance/documents/${documentId}/sufficiency-candidates`, { token: jwt });
  check(14, "vetoes", "the candidate surface responds", cand.status === 200, { status: cand.status });
  const candidates = cand.json?.candidates ?? [];
  check(15, "vetoes", "at least one candidate exists", candidates.length > 0, { candidates: candidates.length });
  if (candidates.length === 0) return;

  check(16, "vetoes", "the surface denies coverage on every response",
    cand.json?.establishes_requirement_coverage === false);

  const first = candidates[0];
  const vetoNames = (first.vetoes ?? []).map((v) => v.veto).sort();
  check(17, "vetoes", "every candidate carries all TEN evaluated vetoes",
    candidates.every((c) => (c.vetoes ?? []).length === EVALUATED_VETOES.length),
    { seen: vetoNames });

  check(18, "vetoes", "no veto state outside PASSED / FIRED / NOT_EVALUABLE",
    candidates.every((c) => c.vetoes.every((v) => ["PASSED", "FIRED", "NOT_EVALUABLE"].includes(v.state))));

  const contradictory = first.vetoes.find((v) => v.veto === "contradictory_evidence");
  check(19, "vetoes", "contradictory_evidence is NOT_EVALUABLE - ADR-0012 is unbuilt",
    contradictory?.state === "NOT_EVALUABLE" && contradictory?.reason === "no_evidence_link_substrate",
    contradictory);

  const period = first.vetoes.find((v) => v.veto === "report_period");
  check(20, "vetoes", "report_period is NOT_EVALUABLE - no ratified validity policy",
    period?.state === "NOT_EVALUABLE", period);
  note(21, "vetoes", "measured report staleness", period?.observed ?? null);

  const findings = first.vetoes.find((v) => v.veto === "open_findings");
  // The trap: framework_control_id is unpopulated estate-wide, so a zero count
  // must NOT read as "this control is clean".
  check(22, "vetoes", "open_findings does not pass vacuously on an unpopulated dimension",
    findings?.state !== "PASSED" || findings?.reason === "no_open_finding_on_canonical_control",
    findings);

  const scope = first.vetoes.find((v) => v.veto === "report_scope");
  check(23, "vetoes", "report_scope resolves CC6.1 through the CATEGORY grain",
    scope?.state === "PASSED" && scope?.reason === "in_scope_by_category", scope);

  const fanout = new Map();
  for (const c of candidates) fanout.set(c.element_key, (fanout.get(c.element_key) ?? 0) + 1);
  note(24, "vetoes", "candidate fan-out per tested control (Ruling 6: stays visible)",
    Object.fromEntries(fanout));

  /* ── 4. fail-closed, through the route AND under it ─────────────────── */
  const reqBody = {
    requirement_framework_key: first.requirement_framework_key,
    requirement_framework_version: first.requirement_framework_version,
    requirement_reference: first.requirement_reference,
  };
  const sufficient = await api(
    "POST", `/vendor-assurance/documents/${documentId}/candidates/${first.resolution_id}/sufficiency`,
    { token: jwt, body: { ...reqBody, determination: "SUFFICIENT" } }
  );
  check(25, "failclosed", "SUFFICIENT is refused while a veto is unresolved",
    sufficient.status === 409 && sufficient.json?.error === "sufficiency_blocked_by_vetoes",
    { status: sufficient.status, blocking: (sufficient.json?.blocking ?? []).map((b) => b.veto) });

  check(26, "failclosed", "the refusal names contradictory_evidence as blocking",
    (sufficient.json?.blocking ?? []).some((b) => b.veto === "contradictory_evidence"));

  // Under the route: an adversary with direct SQL still cannot store it.
  const goodBasis = {
    evaluator_version: "adversary",
    establishes_requirement_coverage: false,
    vetoes: [...EVALUATED_VETOES, "human_acceptance", "decision_basis"].map((v, i) => ({
      veto: v, state: i === 0 ? "NOT_EVALUABLE" : "PASSED", reason: "x",
    })),
    counts: { passed: 11, fired: 0, not_evaluable: 1 },
  };
  const direct = await q(
    `INSERT INTO vendor_requirement_sufficiency_determinations
       (organization_id, document_id, extraction_id, resolution_id, element_key,
        canonical_control_id, requirement_framework_key, requirement_framework_version,
        requirement_reference, determination, determined_by_user_id, basis, evaluator_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'SUFFICIENT',$10,$11::jsonb,'adversary')`,
    [org, documentId, extractionId, first.resolution_id, first.element_key,
     first.canonical_control_id, first.requirement_framework_key,
     first.requirement_framework_version, "ADVERSARY-1", ownerId, JSON.stringify(goodBasis)]
  );
  check(27, "failclosed", "direct SQL cannot store SUFFICIENT over a NOT_EVALUABLE basis",
    direct.ok === false && /fail_closed/i.test(direct.message ?? ""), direct.message ?? null);

  // The strongest adversary: twelve vetoes, one FIRED, and a counts block that
  // lies about it. The constraint reads the STATES, not the summary.
  const lyingBasis = {
    evaluator_version: "adversary",
    establishes_requirement_coverage: false,
    vetoes: [...EVALUATED_VETOES, "human_acceptance", "decision_basis"].map((v, i) => ({
      veto: v, state: i === 0 ? "FIRED" : "PASSED", reason: "x",
    })),
    counts: { passed: 12, fired: 0, not_evaluable: 0 },
  };
  const lying = await q(
    `INSERT INTO vendor_requirement_sufficiency_determinations
       (organization_id, document_id, extraction_id, resolution_id, element_key,
        canonical_control_id, requirement_framework_key, requirement_framework_version,
        requirement_reference, determination, determined_by_user_id, basis, evaluator_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'SUFFICIENT',$10,$11::jsonb,'adversary')`,
    [org, documentId, extractionId, first.resolution_id, first.element_key,
     first.canonical_control_id, first.requirement_framework_key,
     first.requirement_framework_version, "ADVERSARY-4", ownerId, JSON.stringify(lyingBasis)]
  );
  check(28, "failclosed", "SUFFICIENT is refused when the basis COUNTS LIE about the states",
    lying.ok === false && /fail_closed/i.test(lying.message ?? ""), lying.message ?? null);

  // The NULL dodge: `#>> '{counts,fired}' = 0` is NULL when the key is absent,
  // and a CHECK evaluating to NULL PASSES. This proves the hole is closed.
  const noCounts = { ...goodBasis };
  delete noCounts.counts;
  noCounts.vetoes = noCounts.vetoes.map((v) => ({ ...v, state: "PASSED" }));
  const dodge = await q(
    `INSERT INTO vendor_requirement_sufficiency_determinations
       (organization_id, document_id, extraction_id, resolution_id, element_key,
        canonical_control_id, requirement_framework_key, requirement_framework_version,
        requirement_reference, determination, determined_by_user_id, basis, evaluator_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'SUFFICIENT',$10,$11::jsonb,'adversary')`,
    [org, documentId, extractionId, first.resolution_id, first.element_key,
     first.canonical_control_id, first.requirement_framework_key,
     first.requirement_framework_version, "ADVERSARY-5", ownerId, JSON.stringify(noCounts)]
  );
  check(29, "failclosed", "a basis with NO counts key is refused, not NULL-dodged",
    dodge.ok === false && /counts_present/i.test(dodge.message ?? ""), dodge.message ?? null);

  const partial = await q(
    `INSERT INTO vendor_requirement_sufficiency_determinations
       (organization_id, document_id, extraction_id, resolution_id, element_key,
        canonical_control_id, requirement_framework_key, requirement_framework_version,
        requirement_reference, determination, determined_by_user_id, basis, evaluator_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'INSUFFICIENT',$10,
             '{"vetoes":[],"counts":{"passed":0,"fired":0,"not_evaluable":0},"establishes_requirement_coverage":false}'::jsonb,'adversary')`,
    [org, documentId, extractionId, first.resolution_id, first.element_key,
     first.canonical_control_id, first.requirement_framework_key,
     first.requirement_framework_version, "ADVERSARY-2", ownerId]
  );
  check(30, "failclosed", "direct SQL cannot store a PARTIAL twelve-veto basis",
    partial.ok === false && /basis_completeness/i.test(partial.message ?? ""), partial.message ?? null);

  const unattributed = await q(
    `INSERT INTO vendor_requirement_sufficiency_determinations
       (organization_id, document_id, extraction_id, resolution_id, element_key,
        canonical_control_id, requirement_framework_key, requirement_framework_version,
        requirement_reference, determination, indeterminate_reason, determined_by_user_id,
        basis, evaluator_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'INDETERMINATE','veto_not_evaluable',NULL,$10::jsonb,'adversary')`,
    [org, documentId, extractionId, first.resolution_id, first.element_key,
     first.canonical_control_id, first.requirement_framework_key,
     first.requirement_framework_version, "ADVERSARY-3", JSON.stringify(goodBasis)]
  );
  check(31, "failclosed", "direct SQL cannot store an UNATTRIBUTED determination",
    unattributed.ok === false && /no attributed human reviewer/i.test(unattributed.message ?? ""),
    unattributed.message ?? null);

  /* ── 5. what IS recordable, and what it does not touch ──────────────── */
  const before = await q(
    `SELECT
       (SELECT COUNT(*)::int FROM vendor_tested_control_assertions WHERE extraction_id = $1) a,
       (SELECT COUNT(*)::int FROM vendor_tested_control_effectiveness WHERE extraction_id = $1) e,
       (SELECT COUNT(*)::int FROM vendor_assurance_exceptions WHERE extraction_id = $1) x`,
    [extractionId]
  );
  const indet = await api(
    "POST", `/vendor-assurance/documents/${documentId}/candidates/${first.resolution_id}/sufficiency`,
    { token: jwt, body: { ...reqBody, determination: "INDETERMINATE",
      indeterminate_reason: "veto_not_evaluable",
      reviewer_note: `${LABEL} cannot conclude until evidence linkage exists.` } }
  );
  check(32, "record", "INDETERMINATE is recordable on exactly the blocked basis",
    indet.status === 200, { status: indet.status, body: indet.json ?? indet.text });

  const after = await q(
    `SELECT
       (SELECT COUNT(*)::int FROM vendor_tested_control_assertions WHERE extraction_id = $1) a,
       (SELECT COUNT(*)::int FROM vendor_tested_control_effectiveness WHERE extraction_id = $1) e,
       (SELECT COUNT(*)::int FROM vendor_assurance_exceptions WHERE extraction_id = $1) x`,
    [extractionId]
  );
  check(33, "record", "a determination writes NO Layer-1/2/3 row",
    JSON.stringify(before.rows[0]) === JSON.stringify(after.rows[0]),
    { before: before.rows[0], after: after.rows[0] });

  const stored = await q(
    `SELECT determination, determined_by_user_id, evaluator_version,
            jsonb_array_length(basis->'vetoes')::int veto_count,
            basis->'counts' counts,
            basis->>'establishes_requirement_coverage' coverage
       FROM vendor_requirement_sufficiency_determinations
      WHERE document_id = $1 AND superseded_at IS NULL`,
    [documentId]
  );
  check(34, "record", "the stored basis carries all TWELVE vetoes",
    stored.rows.every((r) => r.veto_count === 12), stored.rows.map((r) => r.veto_count));
  check(35, "record", "the determination is attributed to the deciding human",
    stored.rows.every((r) => r.determined_by_user_id === ownerId));
  check(36, "record", "every stored row denies coverage",
    stored.rows.every((r) => r.coverage === "false"));
  note(37, "record", "stored veto counts", stored.rows.map((r) => r.counts));

  const supersede = await api(
    "POST", `/vendor-assurance/documents/${documentId}/candidates/${first.resolution_id}/sufficiency`,
    { token: jwt, body: { ...reqBody, determination: "INSUFFICIENT" } }
  );
  check(38, "record", "a silent re-decision is refused",
    supersede.status === 409 && supersede.json?.error === "sufficiency_determination_already_recorded",
    { status: supersede.status });

  const superseded = await api(
    "POST", `/vendor-assurance/documents/${documentId}/candidates/${first.resolution_id}/sufficiency`,
    { token: jwt, body: { ...reqBody, determination: "INSUFFICIENT", supersede: true } }
  );
  check(39, "record", "an explicit supersede succeeds and retains the prior row",
    superseded.status === 200, { status: superseded.status });
  const history = await q(
    `SELECT determination, superseded_at IS NOT NULL AS superseded
       FROM vendor_requirement_sufficiency_determinations
      WHERE resolution_id = $1 AND requirement_reference = $2 ORDER BY determined_at`,
    [first.resolution_id, first.requirement_reference]
  );
  check(40, "record", "history is append-only: the superseded decision is still there",
    history.rows.length === 2 && history.rows[0].superseded === true && history.rows[1].superseded === false,
    history.rows);

  /* ── 6. authority: three orthogonal axes ────────────────────────────── */
  // A REAL, active, premium API key - proven to work on a read first, so the
  // refusal below is demonstrably about humanity and not about auth.
  const rawKey = `sl_${randomBytes(24).toString("hex")}`;
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  // The column is `label`, not `name`, and there is no `key_prefix`. The first
  // run of this harness got that wrong, the INSERT failed silently through the
  // error-swallowing `q()`, and the two proofs below degraded to 401s.
  const keyIns = await q(
    `INSERT INTO api_keys (organization_id, label, key_hash, entitlement_level, status)
     VALUES ($1,$2,$3,'premium','active') RETURNING id`,
    [org, `${LABEL} machine adversary`, keyHash]
  );
  if (keyIns.rows[0]) created.apiKeys.push(keyIns.rows[0].id);
  // A fixture that failed to build is a FAILED PROOF, not a skipped one. Assert
  // it before relying on it, or every check downstream reports on nothing.
  check(41, "authority", "the adversary API key fixture was actually created",
    keyIns.ok === true && keyIns.rows.length === 1, keyIns.message ?? null);

  const keyRead = await api("GET", `/vendor-assurance/documents/${documentId}/sufficiency-candidates`,
    { apiKey: rawKey });
  check(42, "authority", "the machine adversary IS authenticated and entitled (200 on a read)",
    keyRead.status === 200, { status: keyRead.status });

  const keyWrite = await api(
    "POST", `/vendor-assurance/documents/${documentId}/candidates/${first.resolution_id}/sufficiency`,
    { apiKey: rawKey, body: { ...reqBody, determination: "INSUFFICIENT", supersede: true } }
  );
  check(43, "authority", "an API key holding the capability is STILL refused as non-human",
    keyWrite.status === 403 && keyWrite.json?.error === "human_reviewer_required",
    { status: keyWrite.status, error: keyWrite.json?.error });
  // GATED on the read above. On the first run this passed while the key was
  // invalid: the error was `invalid_api_key`, which is neither of the two values
  // it excluded, so a refusal for entirely the wrong reason read as a proof.
  // That is the defect class #963 fixed for 4C-3, reproduced here. An auth
  // failure must FAIL this check, never satisfy it.
  check(44, "authority", "and the refusal is not an auth, consent or capability failure wearing its clothes",
    keyRead.status === 200
      && keyWrite.json?.error !== "invalid_api_key"
      && keyWrite.json?.error !== "no_active_api_key"
      && keyWrite.json?.error !== "consent_required"
      && keyWrite.json?.error !== "capability_required",
    { read: keyRead.status, write_error: keyWrite.json?.error });

  /* ── 7. tenant isolation ────────────────────────────────────────────── */
  const other = await q(
    `SELECT u.id, u.session_epoch, u.organization_id FROM users u
      WHERE u.organization_id <> $1 AND u.status = 'active'
        AND EXISTS (SELECT 1 FROM organizations o WHERE o.id = u.organization_id
                      AND o.entitlement_level = 'premium')
      LIMIT 1`,
    [org]
  );
  if (other.rows[0]) {
    const otherJwt = signJwt(other.rows[0].id, other.rows[0].organization_id, "admin",
      other.rows[0].session_epoch ?? 0);
    const cross = await api("GET", `/vendor-assurance/documents/${documentId}/sufficiency-candidates`,
      { token: otherJwt });
    check(45, "isolation", "another tenant cannot read these candidates",
      cross.status === 404, { status: cross.status });
    const crossWrite = await api(
      "POST", `/vendor-assurance/documents/${documentId}/candidates/${first.resolution_id}/sufficiency`,
      { token: otherJwt, body: { ...reqBody, determination: "INSUFFICIENT" } }
    );
    check(46, "isolation", "another tenant cannot determine on this candidate",
      crossWrite.status === 404, { status: crossWrite.status });
  } else {
    note(45, "isolation", "no second premium tenant available on this database - NOT PROVEN HERE");
  }

  /* ── 8. corpus notes, REAL and SYNTHETIC reported separately ────────── */
  const corpus = await q(
    `SELECT o.tenant_class, COUNT(DISTINCT e.id)::int extractions
       FROM organizations o
       JOIN vendor_assurance_documents d ON d.organization_id = o.id
       JOIN vendor_assurance_extractions e ON e.document_id = d.id
      GROUP BY 1 ORDER BY 1`
  );
  note(47, "corpus", "extractions by tenant class", corpus.rows);

  const determinations = await q(
    `SELECT determination, COUNT(*)::int n
       FROM vendor_requirement_sufficiency_determinations
      WHERE superseded_at IS NULL GROUP BY 1 ORDER BY 1`
  );
  note(48, "corpus", "live determinations estate-wide", determinations.rows);

  const anySufficient = await q(
    `SELECT COUNT(*)::int n FROM vendor_requirement_sufficiency_determinations
      WHERE determination = 'SUFFICIENT'`
  );
  check(49, "corpus", "ZERO SUFFICIENT determinations exist - the expected, ruled state",
    anySufficient.rows[0]?.n === 0, anySufficient.rows[0] ?? null);
}

async function cleanup() {
  // Documents cascade to extractions, review decisions, resolutions, layers and
  // determinations. Frameworks created here cascade to their requirements.
  for (const id of created.documents) {
    await q(`DELETE FROM vendor_assurance_documents WHERE id = $1 AND original_filename LIKE $2`,
      [id, `${LABEL}%`]);
  }
  for (const id of created.frameworks) {
    await q(`DELETE FROM requirements WHERE framework_id = $1`, [id]);
    await q(`DELETE FROM frameworks WHERE id = $1 AND name LIKE $2`, [id, `${LABEL}%`]);
  }
  // A USED api_keys row can never be DELETEd: security_audit_log's WORM guard
  // refuses the ON DELETE SET NULL cascade. Revocation is the product's own
  // disposal mechanism and the only one available.
  for (const id of created.apiKeys) {
    await q(`UPDATE api_keys SET status = 'revoked', revoked_at = NOW() WHERE id = $1`, [id]);
  }
  // Queried by `label`. The first run asked for a column that does not exist, so
  // the query errored, `rows[0]` was undefined, and the check reported FAIL with
  // a null detail — right answer, wrong reason. `ok` is asserted too, so a broken
  // query can never be mistaken for a clean estate.
  const stillActive = await q(
    `SELECT COUNT(*)::int n FROM api_keys WHERE label LIKE $1 AND status = 'active'`, [`${LABEL}%`]
  );
  check(50, "cleanup", "no acceptance API key is left active",
    stillActive.ok === true && stillActive.rows[0]?.n === 0,
    stillActive.ok ? stillActive.rows[0] : stillActive.message);

  const leftovers = await q(
    `SELECT COUNT(*)::int n FROM vendor_assurance_documents WHERE original_filename LIKE $1`,
    [`${LABEL}%`]
  );
  check(51, "cleanup", "no acceptance document remains", leftovers.rows[0]?.n === 0,
    leftovers.rows[0] ?? null);
}

try {
  await main();
} catch (e) {
  fails += 1;
  results.push(`FAIL  [--] harness    threw :: ${e?.message ?? String(e)}`);
} finally {
  try { await cleanup(); } catch (e) {
    fails += 1;
    results.push(`FAIL  [--] cleanup    threw :: ${e?.message ?? String(e)}`);
  }
  console.log(results.join("\n"));
  console.log(`\n${passes} PASS / ${fails} FAIL`);
  await elev.end().catch(() => {});
  process.exit(fails === 0 ? 0 : 1);
}
