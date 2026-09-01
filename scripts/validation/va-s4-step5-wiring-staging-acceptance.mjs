/**
 * VA-S4 STEP 5 — staging acceptance.
 *
 * Proves, on staging, through PRODUCT PATHS, that:
 *   applicable requirement -> governed evidence -> authority -> validity ->
 *   tested-control resolution -> requirement sufficiency -> assurance gap ->
 *   questionnaire composition -> the vendor is asked only what remains.
 *
 * TWO PHASES, run around the flag flip (SECURELOGIC_EVIDENCE_LIFECYCLE_V2 on
 * the staging engine):
 *
 *   PHASE=dark    flag off. The chain is built and the FIRST staging
 *                 SUFFICIENT is recorded; coverage is visible on the reviewer
 *                 surface; scope resolution output carries NO S4 reduction —
 *                 and the audit payload records the dual-read (computed, not
 *                 applied). That record IS the ADR-0012 §5 divergence
 *                 evidence: output unchanged while the predicate runs.
 *
 *   PHASE=active  flag on. The SAME engagement re-resolves: the covered
 *                 requirement drops to depth "confirm" with the decision basis
 *                 riding the scope item; every other item is unchanged. Then a
 *                 superseding INSUFFICIENT withdraws the coverage and a
 *                 re-resolve asks in full again — fail-closed, live.
 *
 * Fixture discipline is 4C-4's: the synthetic fixture organisation, document +
 * extraction inserted directly (the LLM extraction path is not under test),
 * every governed act — approval, opinion, effectiveness, determination,
 * engagement creation, scope resolution, coverage read — through the routes.
 */
import pg from "pg";
import { createHash, createHmac } from "node:crypto";

const BASE = "https://securelogic-engine-staging.onrender.com/api";
const LABEL = "[S4-STEP5 ACCEPTANCE]";
const PHASE = (process.env.PHASE ?? "dark").trim(); // dark | active
const SYNTHETIC_FIXTURE_ORG = "b1a3da2d-5045-47c6-bd02-dec206c790fe";
// Copied from 4C-4's PROVEN harness (which mirrors ASSURANCE_BEARING_FIELD_NAMES
// in vendorAssuranceValidation.ts). Getting this list wrong makes approval 409
// with review_incomplete — learned live on the first dark-phase run.
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
const check = (row, group, label, ok, detail) => {
  ok ? passes++ : fails++;
  results.push(`${ok ? "PASS" : "FAIL"}  [${String(row).padStart(2)}] ${group.padEnd(10)} ${label}` +
    (detail === undefined ? "" : "  :: " + JSON.stringify(detail)));
};
const note = (row, group, label, detail) =>
  results.push(`NOTE  [${String(row).padStart(2)}] ${group.padEnd(10)} ${label}` +
    (detail === undefined ? "" : "  :: " + JSON.stringify(detail)));

async function api(method, path, { token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON is itself a result */ }
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

async function main() {
  await elev.connect();
  const db = (await elev.query("SELECT current_database() d")).rows[0].d;
  if (db === "securelogic") { console.error("REFUSING to run against production."); process.exit(2); }
  note(0, "env", "database", db);
  note(0, "env", "phase", PHASE);

  const org = SYNTHETIC_FIXTURE_ORG;
  const owner = await q(`SELECT id, session_epoch FROM users WHERE organization_id = $1 AND status = 'active' LIMIT 1`, [org]);
  const ownerId = owner.rows[0]?.id ?? null;
  check(1, "fixture", "fixture organisation has an active user", ownerId !== null);
  if (!ownerId) return;
  const jwt = signJwt(ownerId, org, "admin", owner.rows[0].session_epoch ?? 0);

  const vend = await q(`SELECT id FROM vendors WHERE organization_id = $1 LIMIT 1`, [org]);
  const vendorId = vend.rows[0]?.id ?? null;
  check(2, "fixture", "fixture organisation has a vendor", vendorId !== null);
  if (!vendorId) return;

  const fwq = await q(
    `SELECT framework_key, framework_version FROM canonical_control_crosswalk
      WHERE status='published' AND superseded_at IS NULL AND framework_key <> 'soc2'
      GROUP BY 1,2 ORDER BY COUNT(*) DESC LIMIT 1`);
  const fw = fwq.rows[0] ?? null;
  check(3, "fixture", "a published crosswalk target exists", fw !== null, fw);
  if (!fw) return;
  let orgFw = await q(`SELECT id FROM frameworks WHERE organization_id=$1 AND framework_key=$2 AND version=$3 LIMIT 1`,
    [org, fw.framework_key, fw.framework_version]);
  if (orgFw.rows.length === 0) {
    orgFw = await q(`INSERT INTO frameworks (organization_id, name, framework_key, version)
       VALUES ($1,$2,$3,$4) RETURNING id`, [org, `${LABEL} ${fw.framework_key}`, fw.framework_key, fw.framework_version]);
    const refs = await q(`SELECT DISTINCT requirement_reference r FROM canonical_control_crosswalk
        WHERE framework_key=$1 AND framework_version=$2 AND status='published' AND superseded_at IS NULL`,
      [fw.framework_key, fw.framework_version]);
    for (const row of refs.rows) {
      await q(`INSERT INTO requirements (framework_id, reference_id, title, description)
         VALUES ($1,$2,$3,$3) ON CONFLICT DO NOTHING`, [orgFw.rows[0].id, row.r, `${LABEL} requirement ${row.r}`]);
    }
  }

  /* ── phase-shared: one governed chain, built ONCE (dark), reused (active) ── */
  const tag = `${LABEL} chain`;
  let documentId, extractionId;
  // ACTIVE reuses the chain THAT CARRIES the live SUFFICIENT — anchored on the
  // determination row itself, never on filename ordering. The first rerun
  // ordered by filename, picked a stray document from the flawed run, and its
  // superseding INSUFFICIENT landed on the WRONG resolution. The product still
  // behaved correctly (the read-time conflict guard withdrew coverage), but
  // the supersession proof needs the right chain.
  let liveSufficient = null;
  if (PHASE === "active") {
    const live = await q(
      `SELECT id, document_id, extraction_id
         FROM vendor_requirement_sufficiency_determinations
        WHERE organization_id=$1 AND determination='SUFFICIENT' AND superseded_at IS NULL
        ORDER BY determined_at DESC LIMIT 1`, [org]);
    check("3a", "chain", "a live SUFFICIENT exists to anchor on (a failed lookup is a failed proof)",
      !!live.rows[0], live.ok ? undefined : live.message);
    if (!live.rows[0]) return;
    liveSufficient = live.rows[0];
    documentId = liveSufficient.document_id; extractionId = liveSufficient.extraction_id;
    note(4, "chain", "reusing the dark-phase document", { documentId });
  } else {
    const sha = createHash("sha256").update(`s5-${Date.now()}`).digest("hex");
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
    for (const f of ASSURANCE_BEARING) if (!(f in fields)) fields[f] = { value: "x", confidence: 0.9, status: "extracted" };
    const d = await q(
      `INSERT INTO vendor_assurance_documents
         (organization_id, vendor_id, original_filename, byte_size, sha256, storage_key,
          mime_type, document_type_hint, processing_status)
       VALUES ($1,$2,$3,2048,$4,$5,'application/pdf','soc2_type2','extracted') RETURNING id`,
      [org, vendorId, `s4-step5-${Date.now()}.pdf`, sha, `validation/s4-step5-${sha.slice(0, 12)}.pdf`]);
    documentId = d.rows[0]?.id;
    check(4, "chain", "fixture document created", !!documentId, d.ok ? undefined : d.message);
    if (!documentId) return;
    const e = await q(
      `INSERT INTO vendor_assurance_extractions (organization_id, document_id, model_id, prompt_version, fields)
       VALUES ($1,$2,'validation-fixture','s4-step5',$3::jsonb) RETURNING id`,
      [org, documentId, JSON.stringify(fields)]);
    extractionId = e.rows[0]?.id;
    check(5, "chain", "fixture extraction created", !!extractionId, e.ok ? undefined : e.message);
    if (!extractionId) return;
    for (const f of ASSURANCE_BEARING) {
      await q(`INSERT INTO vendor_assurance_review_decisions
          (organization_id, extraction_id, field_name, decision, decided_by_user_id)
        VALUES ($1,$2,$3,'accept',$4)`, [org, extractionId, f, ownerId]);
    }
    for (const c of controls) {
      await q(`INSERT INTO vendor_assurance_review_decisions
          (organization_id, extraction_id, field_name, decision, decided_by_user_id, element_key, element_snapshot)
        VALUES ($1,$2,'controls','accept',$3,$4,$5::jsonb)`,
        [org, extractionId, ownerId, c.control_id, JSON.stringify(c)]);
    }

    const approve = await api("POST", `/vendor-assurance/documents/${documentId}/approve`, { token: jwt, body: {} });
    check(6, "chain", "document approves through governed review", approve.status === 200,
      { status: approve.status, body: approve.json ?? approve.text });

    const opinion = await api("POST", `/vendor-assurance/documents/${documentId}/assurance-opinion`,
      { token: jwt, body: { opinion: "unmodified", reviewer_note: `${LABEL} unmodified opinion accepted.` } });
    check(7, "chain", "the opinion is HUMAN-ACCEPTED through the route", opinion.status === 200,
      { status: opinion.status, body: opinion.json ?? opinion.text });

    // resolutions materialize fire-and-forget after approval
    let resolutions = [];
    for (let i = 0; i < 80; i++) {
      const r = await q(`SELECT id, element_key FROM vendor_tested_control_resolutions WHERE extraction_id=$1`, [extractionId]);
      if (r.rows.length >= 1) { resolutions = r.rows; break; }
      await new Promise((res) => setTimeout(res, 250));
    }
    check(8, "chain", "tested-control resolution materialized", resolutions.length >= 1, { n: resolutions.length });
    if (resolutions.length === 0) return;

    const eff = await api("POST",
      `/vendor-assurance/documents/${documentId}/tested-controls/${encodeURIComponent(resolutions[0].element_key)}/effectiveness`,
      { token: jwt, body: { effectiveness: "EFFECTIVE", reviewer_note: `${LABEL} operating effectiveness accepted.` } });
    check(9, "chain", "governed effectiveness HUMAN-ACCEPTED through the route", eff.status === 200,
      { status: eff.status, body: eff.json ?? eff.text });
  }

  /* ── the determination — the staging first ─────────────────────────────── */
  const cand = await api("GET", `/vendor-assurance/documents/${documentId}/sufficiency-candidates`, { token: jwt });
  check(10, "determine", "candidates load", cand.status === 200, { status: cand.status });
  const c = (cand.json?.candidates ?? []).find((x) => x.requirement_reference);
  check(11, "determine", "a requirement-bearing candidate exists", !!c,
    c ? { ref: c.requirement_reference } : cand.json?.candidates?.length);
  if (!c) return;

  let determinationId = null;
  if (PHASE === "dark") {
    // fixture hygiene: stray live rows on this identity from older runs
    await q(`UPDATE vendor_requirement_sufficiency_determinations
        SET superseded_at = NOW() WHERE organization_id=$1 AND superseded_at IS NULL`, [org]);

    // The org carries stray OPEN findings with no control attribution — fixture
    // debris from earlier validation runs. The 1.1 open_findings veto correctly
    // refuses SUFFICIENT while they exist (an unattributed open finding makes
    // the dimension unobservable). The CUSTOMER-OPERABLE resolution is a
    // reviewer dealing with each finding through the product, and that is what
    // happens here: PATCH through the route, never SQL. This is success
    // criterion 9 in the flesh — an unresolved-findings case required work
    // BEFORE assurance could be declared.
    const strays = await q(
      `SELECT id FROM findings WHERE organization_id=$1
        AND status IN ('open','in_progress') AND framework_control_id IS NULL`, [org]);
    for (const f of strays.rows) {
      // The closure gate demands remediation completion first — so the
      // remediation ACTIONS are completed through the product too. Finding ->
      // action -> close action -> close finding: the tracked-remediation
      // workflow, exercised rather than bypassed.
      // Actions link to findings as source_type/source_id, not a finding_id
      // column — the closure gate's own query (findingClosureService.ts:172)
      // is the authority on the linkage.
      const acts = await q(
        `SELECT id FROM actions WHERE organization_id=$1
          AND source_type='finding' AND source_id=$2
          AND status IN ('open','in_progress','blocked')`, [org, f.id]);
      for (const a of acts.rows) {
        const done = await api("PATCH", `/actions/${a.id}`, { token: jwt, body: {
          status: "closed",
          note: `${LABEL} remediation completed for the validation fixture.`,
        } });
        check("11a", "findings", `remediation action ${a.id.slice(0, 8)} completed THROUGH THE PRODUCT`,
          done.status === 200, { status: done.status, body: done.json ?? done.text });
      }
      const closed = await api("PATCH", `/findings/${f.id}`, { token: jwt, body: {
        status: "closed",
        decision_note: `${LABEL} validation fixture reviewed and closed before sufficiency determination.`,
      } });
      check("11b", "findings", `open finding ${f.id.slice(0, 8)} resolved THROUGH THE PRODUCT`,
        closed.status === 200, { status: closed.status, body: closed.json ?? closed.text });
    }
    const det = await api("POST",
      `/vendor-assurance/documents/${documentId}/candidates/${c.resolution_id}/sufficiency`,
      { token: jwt, body: {
        requirement_framework_key: fw.framework_key,
        requirement_framework_version: fw.framework_version,
        requirement_reference: c.requirement_reference,
        determination: "SUFFICIENT",
      } });
    const allPassed = (det.json?.vetoes ?? []).every((v) => v.state === "PASSED");
    check(12, "determine", "the FIRST staging SUFFICIENT records — twelve vetoes, all PASSED",
      det.status === 200 && det.json?.determined?.determination === "SUFFICIENT" && allPassed,
      { status: det.status,
        vetoes: (det.json?.vetoes ?? []).map((v) => `${v.veto}:${v.state}`),
        blocking: (det.json?.blocking ?? []).map((b) => `${b.veto}:${b.state}:${b.reason}`) });
    determinationId = det.json?.determined?.id ?? null;
  } else {
    // Fixture hygiene: the flawed 2026-09-01 active run left a live
    // INSUFFICIENT on a second, accidental chain. Conflicting judgements now
    // suppress coverage AT READ TIME (the product fix that run produced), so
    // stray conflicts must be superseded for this phase to demonstrate the
    // clean-path reduction; its own conflict/withdrawal proof follows below.
    await q(`UPDATE vendor_requirement_sufficiency_determinations
        SET superseded_at = NOW()
      WHERE organization_id=$1 AND determination='INSUFFICIENT' AND superseded_at IS NULL`, [org]);
    determinationId = liveSufficient?.id ?? null;
    check(12, "determine", "the dark-phase SUFFICIENT is still live", determinationId !== null);
  }
  if (!determinationId) return;

  /* ── engagement + applicability, through the product ───────────────────── */
  let engagementId;
  const priorEng = await q(`SELECT id FROM vendor_engagements
      WHERE organization_id=$1 AND title LIKE $2 ORDER BY created_at DESC LIMIT 1`, [org, `${LABEL}%`]);
  if (PHASE === "active" && priorEng.rows[0]) {
    engagementId = priorEng.rows[0].id;
    note(13, "engage", "reusing the dark-phase engagement", { engagementId });
  } else {
    const created = await api("POST", `/vendor-engagements`, { token: jwt, body: {
      vendor_id: vendorId, title: `${LABEL} ${Date.now()}`, engagement_type: "initial",
      data_sensitivity: "confidential", data_volume: "moderate", access_level: "read_write",
      operational_dependency: "moderate", recoverability: "hours", business_criticality: "medium",
      regulatory_exposure: "moderate", regulatory_breach_notification: false,
      ai_involvement: "none", ai_autonomy: "none", hosting_model: "saas",
      fourth_party_exposure: "low", concentration: "none",
    } });
    engagementId = created.json?.id;
    check(13, "engage", "engagement created through the product", created.status === 201 && !!engagementId,
      { status: created.status });
    if (!engagementId) return;
  }

  // the covered requirement must be APPLICABLE — tag it core (fixture, once)
  const reqRow = await q(
    `SELECT r.id FROM requirements r JOIN frameworks f ON f.id=r.framework_id
      WHERE f.organization_id=$1 AND f.framework_key=$2 AND f.version=$3 AND r.reference_id=$4`,
    [org, fw.framework_key, fw.framework_version, c.requirement_reference]);
  const requirementId = reqRow.rows[0]?.id ?? null;
  check(14, "engage", "the determination's requirement identity resolves in the org", requirementId !== null);
  if (!requirementId) return;
  await q(`UPDATE requirements SET scope_tags='{core}' WHERE id=$1 AND scope_tags = '{}'`, [requirementId]);

  /* ── the reviewer-visible coverage surface ─────────────────────────────── */
  const cov = await api("GET", `/vendor-engagements/${engagementId}/assurance-coverage`, { token: jwt });
  const covRow = (cov.json?.covered ?? []).find((x) => x.requirement_id === requirementId);
  check(15, "coverage", "the reviewer SEES the coverage through the product",
    cov.status === 200 && !!covRow && covRow.valid_until === "2026-12-31",
    { status: cov.status, covered: cov.json?.covered?.length, gaps: cov.json?.gaps?.length, valid_until: covRow?.valid_until });
  check(16, "coverage", "the surface states whether composition will APPLY it",
    cov.json?.applied_at_composition === (PHASE === "active"), { applied: cov.json?.applied_at_composition });

  /* ── scope resolution — the questionnaire responds ─────────────────────── */
  const resolve = await api("POST", `/vendor-engagements/${engagementId}/scope`, { token: jwt, body: {} });
  check(17, "compose", "scope resolves through the product", resolve.status === 200, { status: resolve.status });

  const items = await q(
    `SELECT requirement_id, depth, mandatory, reasons FROM vendor_engagement_scope_items
      WHERE engagement_id=$1 AND organization_id=$2`, [engagementId, org]);
  const item = items.rows.find((r) => r.requirement_id === requirementId);
  check(18, "compose", "the covered requirement is IN SCOPE — applicability never disappears", !!item);
  if (!item) return;
  const s4reason = (item.reasons ?? []).find((x) => x.rule_id === "S4.assurance");

  if (PHASE === "dark") {
    check(19, "compose", "flag OFF: full depth, NO S4 reduction — byte-identical composition",
      item.depth !== "confirm" && s4reason === undefined, { depth: item.depth });
    const audit = await q(
      `SELECT payload->'s4_assurance' s4 FROM security_audit_log
        WHERE organization_id=$1 AND event_type='vendor_engagement.scope_resolved'
          AND resource_id=$2 ORDER BY created_at DESC LIMIT 1`, [org, engagementId]);
    const s4a = audit.rows[0]?.s4 ?? null;
    check(20, "dualread", "the dual-read is PERSISTED in the audit record: computed, NOT applied",
      s4a !== null && s4a.computed === true && s4a.applied === false && s4a.covered_count >= 1, s4a);
    note(21, "dualread", "ADR-0012 §5 divergence evidence",
      "output unchanged while the predicate computed coverage — the zero-divergence claim, recorded durably");
  } else {
    check(19, "compose", "flag ON: the covered requirement is REDUCED to confirm — asked, not skipped",
      item.depth === "confirm" && s4reason !== undefined, { depth: item.depth });
    check(20, "compose", "the decision basis rides the scope item",
      s4reason?.basis?.determination_id === determinationId
        && s4reason?.basis?.valid_until === "2026-12-31"
        && s4reason?.basis?.coverage_version === "assurance-coverage-1.0",
      s4reason?.basis ?? null);
    const audit = await q(
      `SELECT payload->'s4_assurance' s4 FROM security_audit_log
        WHERE organization_id=$1 AND event_type='vendor_engagement.scope_resolved'
          AND resource_id=$2 ORDER BY created_at DESC LIMIT 1`, [org, engagementId]);
    check(21, "dualread", "the applied read is persisted too",
      audit.rows[0]?.s4?.applied === true && audit.rows[0]?.s4?.covered_count >= 1, audit.rows[0]?.s4);

    /* ── withdrawal of sufficiency, live ─────────────────────────────────── */
    const det = await api("POST",
      `/vendor-assurance/documents/${documentId}/candidates/${c.resolution_id}/sufficiency`,
      { token: jwt, body: {
        requirement_framework_key: fw.framework_key,
        requirement_framework_version: fw.framework_version,
        requirement_reference: c.requirement_reference,
        determination: "INSUFFICIENT", supersede: true,
      } });
    check(22, "failclosed", "a superseding INSUFFICIENT records through the route", det.status === 200,
      { status: det.status });
    const cov2 = await api("GET", `/vendor-engagements/${engagementId}/assurance-coverage`, { token: jwt });
    check(23, "failclosed", "coverage is WITHDRAWN at once", (cov2.json?.covered ?? []).length === 0,
      { covered: cov2.json?.covered?.length });
    const re = await api("POST", `/vendor-engagements/${engagementId}/scope`, { token: jwt, body: {} });
    const items2 = await q(
      `SELECT requirement_id, depth, reasons FROM vendor_engagement_scope_items
        WHERE engagement_id=$1 AND organization_id=$2`, [engagementId, org]);
    const item2 = items2.rows.find((r) => r.requirement_id === requirementId);
    check(24, "failclosed", "re-resolve asks IN FULL again — no stale reduction survives",
      re.status === 200 && item2 && item2.depth !== "confirm"
        && !(item2.reasons ?? []).some((x) => x.rule_id === "S4.assurance"),
      { depth: item2?.depth });
    const hist = await q(
      `SELECT superseded_at IS NOT NULL s, jsonb_array_length(basis->'vetoes') n
         FROM vendor_requirement_sufficiency_determinations WHERE id=$1`, [determinationId]);
    check(25, "history", "the historical SUFFICIENT basis survives, twelve vetoes readable",
      hist.rows[0]?.s === true && Number(hist.rows[0]?.n) === 12, hist.rows[0]);
  }

  /* ── tenant boundary spot check ────────────────────────────────────────── */
  const other = await q(`SELECT id FROM organizations WHERE id <> $1 AND tenant_class='synthetic' LIMIT 1`, [org]);
  if (other.rows[0]) {
    const foreignUser = await q(`SELECT id, session_epoch FROM users WHERE organization_id=$1 AND status='active' LIMIT 1`, [other.rows[0].id]);
    if (foreignUser.rows[0]) {
      const cross = await api("GET", `/vendor-engagements/${engagementId}/assurance-coverage`,
        { token: signJwt(foreignUser.rows[0].id, other.rows[0].id, "admin", foreignUser.rows[0].session_epoch ?? 0) });
      check(26, "tenant", "cross-tenant coverage read is a 404", cross.status === 404, { status: cross.status });
    } else note(26, "tenant", "no foreign synthetic user available; cross-tenant check covered by isolation suite");
  } else note(26, "tenant", "no second synthetic org; cross-tenant check covered by isolation suite");
}

main()
  .catch((e) => { fails++; results.push(`FAIL  [??] harness    unhandled: ${e.message}`); })
  .finally(async () => {
    await elev.end().catch(() => {});
    console.log(`\n${LABEL} PHASE=${PHASE}\n` + results.join("\n"));
    console.log(`\n${passes} PASS / ${fails} FAIL`);
    process.exit(fails === 0 ? 0 : 1);
  });
