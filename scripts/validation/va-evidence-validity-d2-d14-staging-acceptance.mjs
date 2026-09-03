/**
 * D2-D14 EVIDENCE-VALIDITY POLICY — staging acceptance.
 *
 * Proves, on staging, through PRODUCT PATHS, that the owner's 2026-09-02
 * rulings are what the running system actually does.
 *
 * Fixture discipline follows the step-5 harness: fixture rows are inserted
 * directly (evidence upload is not what is under test), and every GOVERNED act
 * — curation, customer configuration, coverage read — goes through the routes,
 * because the point is what the product does, not what a query can be made to
 * say.
 *
 * Every assertion here is adversarial. Each one attempts to make the platform
 * assert something it cannot know, slip past a ratified ceiling, or reach
 * across a tenant boundary. The expected result is a refusal with a named
 * reason, or a window narrower than the attacker asked for.
 */
import pg from "pg";
import { createHmac } from "node:crypto";

const BASE = "https://securelogic-engine-staging.onrender.com/api";
const LABEL = "[D2-D14 ACCEPTANCE]";
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
  results.push(`${ok ? "PASS" : "FAIL"}  [${String(row).padStart(2)}] ${group.padEnd(11)} ${label}` +
    (detail === undefined ? "" : "  :: " + JSON.stringify(detail)));
};
const note = (row, group, label, detail) =>
  results.push(`NOTE  [${String(row).padStart(2)}] ${group.padEnd(11)} ${label}` +
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
  const r = await elev.query(s, p);
  return { rows: r.rows, rowCount: r.rowCount };
};

/** A fixture evidence row. Curation is what is under test, not upload. */
async function mkEvidence(org, title, opts = {}) {
  const r = await q(
    `INSERT INTO evidence
       (organization_id, source_type, source_id, title, evidence_type, collected_at, engagement_id)
     VALUES ($1,$2,COALESCE($3::uuid, gen_random_uuid()),$4,'document',$5::date,$6::uuid)
     RETURNING id`,
    [org, opts.sourceType ?? "control_test", opts.sourceId ?? null,
     `${LABEL} ${title}`, opts.collectedAt ?? null, opts.engagementId ?? null]
  );
  return r.rows[0].id;
}

async function main() {
  await elev.connect();
  const db = (await elev.query("SELECT current_database() d")).rows[0].d;
  if (db === "securelogic") { console.error("REFUSING to run against production."); process.exit(2); }
  note(0, "env", "database", db);

  const org = SYNTHETIC_FIXTURE_ORG;
  const owner = await q(
    `SELECT id, session_epoch FROM users WHERE organization_id = $1 AND status = 'active' LIMIT 1`, [org]);
  const ownerId = owner.rows[0]?.id ?? null;
  check(1, "fixture", "fixture organisation has an active user", ownerId !== null);
  if (!ownerId) return;
  const jwt = signJwt(ownerId, org, "admin", owner.rows[0].session_epoch ?? 0);

  const cure = (evidenceId, body) =>
    api("POST", `/evidence/${evidenceId}/assurance`, { token: jwt, body });

  /* ── 1. the ratified policy IS what is live ───────────────────────────── */
  const live = await q(
    `SELECT assurance_class, version, default_duration_months d, min_duration_months mn,
            max_duration_months mx, anchor, requires_artifact_end rae,
            artifact_basis_permitted abp, bridge_required_above_months bridge, no_window_reason nwr
       FROM evidence_validity_policy WHERE superseded_at IS NULL ORDER BY assurance_class`);
  const classes = live.rows.map((r) => r.assurance_class);
  check(2, "policy", "exactly the thirteen ratified classes are live",
    JSON.stringify(classes) === JSON.stringify([
      "ai_evaluation", "bcp_dr_test", "iso_certification", "pen_test",
      "policy_document", "privacy_agreement", "soc1", "soc2_type1",
      "soc2_type2", "subprocessor_list", "technical_configuration",
      "vendor_attestation", "vulnerability_scan"]), classes);
  check(3, "policy", "D13/D14 carry NO policy row",
    !classes.includes("contract") && !classes.includes("other_assurance_report"));
  const soc2 = live.rows.find((r) => r.assurance_class === "soc2_type2");
  check(4, "policy", "D2 preserved the 15-month ceiling and stored the bridge condition",
    soc2?.d === 12 && soc2?.mx === 15 && soc2?.bridge === 12, soc2);
  const iso = live.rows.find((r) => r.assurance_class === "iso_certification");
  check(5, "policy", "D3 requires the certificate's own end", iso?.rae === true && iso?.mx === 36, iso);
  const ai = live.rows.find((r) => r.assurance_class === "ai_evaluation");
  check(6, "policy", "D12 establishes no window and says why",
    ai?.d === null && ai?.nwr === "model_version_identity_required", ai);
  const superseded = await q(
    `SELECT count(*)::int n FROM evidence_validity_policy WHERE superseded_at IS NOT NULL`);
  check(7, "policy", "the amended SOC rows were SUPERSEDED, not edited",
    superseded.rows[0].n >= 3, superseded.rows[0]);

  /* ── 2. D9 — a caller cannot manufacture freshness ────────────────────── */
  const ev1 = await mkEvidence(org, "d9 bound", { collectedAt: "2026-07-01" });
  const r1 = await cure(ev1, {
    assurance_class: "technical_configuration",
    anchor_date: "2026-09-02", // the lie: "this was observed today"
  });
  check(8, "D9", "the route IGNORES a caller anchor and uses collected_at",
    r1.status === 200 && r1.json?.valid_until === "2026-10-01", r1.json ?? r1.text);

  const ev2 = await mkEvidence(org, "d9 no date", { collectedAt: null });
  const r2 = await cure(ev2, { assurance_class: "technical_configuration", anchor_date: "2026-09-02" });
  check(9, "D9", "no observation date means NO window — uploaded_at never substitutes",
    r2.status === 200 && r2.json?.reason === "collected_at_required"
      && r2.json?.counts_toward_assurance === false, r2.json ?? r2.text);

  const ev3 = await mkEvidence(org, "d6 stale scan", { collectedAt: "2025-01-01" });
  const r3 = await cure(ev3, { assurance_class: "vulnerability_scan" });
  check(10, "D6", "a stale scan expires on its OWN dates",
    r3.status === 200 && r3.json?.valid_until === "2025-04-01", r3.json ?? r3.text);

  /* ── 3. D10 — the ceiling outranks any cadence a customer sets ────────── */
  const vend = await q(`SELECT id FROM vendors WHERE organization_id = $1 LIMIT 1`, [org]);
  const vendorId = vend.rows[0]?.id ?? null;
  check(11, "fixture", "fixture organisation has a vendor", vendorId !== null);
  if (!vendorId) { await report(); return; }

  const mkEng = async (decidedAt, nextDue) => (await q(
    `INSERT INTO vendor_engagements
       (organization_id, vendor_id, engagement_type, status, methodology_version,
        scope_rule_version, decision, decision_rationale, decided_at, next_review_due)
     VALUES ($1,$2,'periodic','decided','1.0','1.0','approved',$3,$4::timestamptz,$5::date)
     RETURNING id`, [org, vendorId, `${LABEL} fixture`, decidedAt, nextDue])).rows[0].id;

  const engShort = await mkEng("2026-01-01", "2026-07-01");
  const ev4 = await mkEvidence(org, "d10 short cadence", {
    sourceType: "vendor_engagement", sourceId: engShort, engagementId: engShort });
  const r4 = await cure(ev4, { assurance_class: "vendor_attestation" });
  check(12, "D10", "a SHORTER governed cadence binds",
    r4.status === 200 && r4.json?.valid_until === "2026-07-01", r4.json ?? r4.text);

  const engLong = await mkEng("2026-01-01", "2036-01-01");
  const ev5 = await mkEvidence(org, "d10 120-month cadence", {
    sourceType: "vendor_engagement", sourceId: engLong, engagementId: engLong });
  const r5 = await cure(ev5, { assurance_class: "vendor_attestation" });
  check(13, "D10", "a 120-month cadence CANNOT outlive the 24-month ceiling",
    r5.status === 200 && r5.json?.valid_until === "2028-01-01", r5.json ?? r5.text);

  const ev6 = await mkEvidence(org, "d10 unlinked");
  const r6 = await cure(ev6, { assurance_class: "vendor_attestation", anchor_date: "2026-01-01" });
  check(14, "D10", "an attestation with no engagement establishes nothing",
    r6.status === 200 && r6.json?.reason === "no_linked_object_cadence", r6.json ?? r6.text);

  /* ── 4. D7 — the linked policy object's own cadence ───────────────────── */
  const mkPolicy = async (last, next) => (await q(
    `INSERT INTO policies (organization_id, name, status, last_reviewed_at, next_review_at)
     VALUES ($1,$2,'active',$3::date,$4::date) RETURNING id`,
    [org, `${LABEL} policy ${Date.now()}${Math.random()}`, last, next])).rows[0].id;

  const polA = await mkPolicy("2026-03-01", "2027-03-01");
  const ev7 = await mkEvidence(org, "d7 linked", { sourceType: "policy_review", sourceId: polA });
  const r7 = await cure(ev7, { assurance_class: "policy_document" });
  check(15, "D7", "follows the linked policy's own next review date",
    r7.status === 200 && r7.json?.valid_until === "2027-03-01", r7.json ?? r7.text);

  const polB = await mkPolicy("2026-03-01", "2030-03-01");
  const ev8 = await mkEvidence(org, "d7 long cadence", { sourceType: "policy_review", sourceId: polB });
  const r8 = await cure(ev8, { assurance_class: "policy_document" });
  check(16, "D7", "a cadence beyond 24 months is capped at the ceiling",
    r8.status === 200 && r8.json?.valid_until === "2028-03-01", r8.json ?? r8.text);

  const ev9 = await mkEvidence(org, "d7 unlinked");
  const r9 = await cure(ev9, { assurance_class: "policy_document", anchor_date: "2026-03-01" });
  check(17, "D7", "an UNLINKED policy document establishes nothing",
    r9.status === 200 && r9.json?.reason === "no_linked_object_cadence", r9.json ?? r9.text);

  /* ── 5. CROSS-TENANT — another org's object supplies nothing ──────────── */
  const other = await q(
    `SELECT id FROM organizations WHERE id <> $1 ORDER BY created_at LIMIT 1`, [org]);
  const otherOrg = other.rows[0]?.id ?? null;
  check(18, "fixture", "a second organisation exists for the cross-tenant probe", otherOrg !== null);
  if (otherOrg) {
    const polX = (await q(
      `INSERT INTO policies (organization_id, name, status, last_reviewed_at, next_review_at)
       VALUES ($1,$2,'active','2026-03-01','2027-03-01') RETURNING id`,
      [otherOrg, `${LABEL} foreign policy ${Date.now()}`])).rows[0].id;
    const ev10 = await mkEvidence(org, "xt policy", { sourceType: "policy_review", sourceId: polX });
    const r10 = await cure(ev10, { assurance_class: "policy_document" });
    check(19, "isolation", "org A cannot borrow another org's policy cadence",
      r10.status === 200 && r10.json?.reason === "no_linked_object_cadence"
        && r10.json?.valid_until === null, r10.json ?? r10.text);

    const evForeign = await mkEvidence(otherOrg, "xt evidence", { collectedAt: "2026-07-01" });
    const r11 = await cure(evForeign, { assurance_class: "technical_configuration" });
    check(20, "isolation", "curating another org's evidence is refused",
      r11.status === 404, { status: r11.status, body: r11.json ?? r11.text });
  }

  /* ── 6. D13 / D14 — the human-committed artifact basis ────────────────── */
  const ev12 = await mkEvidence(org, "d13 fixed term");
  const r12 = await cure(ev12, {
    assurance_class: "contract", basis: "artifact_dates",
    anchor_date: "2026-01-01", artifact_asserted_until: "2029-01-01" });
  check(21, "D13", "a contract takes the term the ARTIFACT states",
    r12.status === 200 && r12.json?.validity_basis === "artifact_dates"
      && r12.json?.valid_until === "2029-01-01", r12.json ?? r12.text);

  const ev13 = await mkEvidence(org, "d13 bare perpetual");
  const r13 = await cure(ev13, {
    assurance_class: "contract", basis: "perpetual", anchor_date: "2026-01-01" });
  check(22, "D13", "perpetual is REFUSED without an explicit assertion",
    r13.status === 400 && r13.json?.error === "perpetual_requires_assertion", r13.json ?? r13.text);

  const ev14 = await mkEvidence(org, "d13 asserted perpetual");
  const r14 = await cure(ev14, {
    assurance_class: "contract", basis: "perpetual", anchor_date: "2026-01-01",
    perpetual_assertion: "Clause 14: continues until terminated on 90 days notice." });
  check(23, "D13", "an explicit perpetual assertion is accepted",
    r14.status === 200 && r14.json?.validity_basis === "perpetual"
      && r14.json?.valid_until === null, r14.json ?? r14.text);

  const ev15 = await mkEvidence(org, "d14 no term");
  const r15 = await cure(ev15, { assurance_class: "other_assurance_report", anchor_date: "2026-02-01" });
  check(24, "D14", "a residual artifact with no term establishes nothing",
    r15.status === 200 && r15.json?.reason === "no_ratified_policy"
      && r15.json?.counts_toward_assurance === false, r15.json ?? r15.text);

  const ev16 = await mkEvidence(org, "d11 escape attempt");
  const r16 = await cure(ev16, {
    assurance_class: "privacy_agreement", basis: "perpetual",
    anchor_date: "2020-01-01", perpetual_assertion: "evergreen DPA" });
  check(25, "D11", "a governed class REFUSES the artifact basis — no route around the window",
    r16.status === 409 && r16.json?.error === "artifact_basis_not_permitted", r16.json ?? r16.text);

  /* ── 7. D3 — a required certificate expiry fails closed ───────────────── */
  const ev17 = await mkEvidence(org, "d3 no expiry");
  const r17 = await cure(ev17, { assurance_class: "iso_certification", anchor_date: "2026-01-15" });
  check(26, "D3", "a certificate with no recorded expiry establishes nothing",
    r17.status === 200 && r17.json?.reason === "artifact_end_required", r17.json ?? r17.text);

  const ev18 = await mkEvidence(org, "d3 in term");
  const r18 = await cure(ev18, {
    assurance_class: "iso_certification", anchor_date: "2026-01-15",
    artifact_asserted_until: "2029-01-14" });
  check(27, "D4", "annual re-evidence binds INSIDE a three-year term",
    r18.status === 200 && r18.json?.valid_until === "2027-01-15", r18.json ?? r18.text);

  const ev19 = await mkEvidence(org, "d3 short term");
  const r19 = await cure(ev19, {
    assurance_class: "iso_certification", anchor_date: "2026-01-15",
    artifact_asserted_until: "2026-06-30" });
  check(28, "D3", "the certificate's expiry caps the window absolutely",
    r19.status === 200 && r19.json?.valid_until === "2026-06-30", r19.json ?? r19.text);

  /* ── 8. D2 / D15 — the customer layer, through the product route ──────── */
  const before = await api("GET", "/organization/evidence-validity-settings", { token: jwt });
  note(29, "D15", "settings surface reachable", { status: before.status });

  const tighten = await api("PUT", "/organization/evidence-validity-settings/soc2_type2",
    { token: jwt, body: { duration_months: 9, reason: `${LABEL} tighten` } });
  check(30, "D15", "a customer may TIGHTEN freely", tighten.status === 200,
    { status: tighten.status, body: tighten.json ?? tighten.text });

  const loosen = await api("PUT", "/organization/evidence-validity-settings/soc2_type2",
    { token: jwt, body: { duration_months: 16, reason: `${LABEL} over ceiling` } });
  check(31, "D15", "loosening PAST the ratified ceiling is refused",
    loosen.status >= 400, { status: loosen.status, body: loosen.json ?? loosen.text });

  // Clean up so the fixture org's SOC coverage is not left tightened.
  await q(`UPDATE organization_evidence_validity_settings SET superseded_at = NOW()
            WHERE organization_id = $1 AND assurance_class = 'soc2_type2' AND superseded_at IS NULL`, [org]);

  /* ── 9. S4 regression — the step-5 chain still counts ─────────────────── */
  const cov = await q(
    `SELECT id FROM vendor_engagements WHERE organization_id = $1
       AND decision IS NOT NULL ORDER BY created_at DESC LIMIT 1`, [org]);
  if (cov.rows[0]) {
    const c = await api("GET", `/vendor-engagements/${cov.rows[0].id}/assurance-coverage`, { token: jwt });
    check(32, "S4", "the coverage surface answers with the new version",
      // The route names the field coverage_version (vendorEngagements.ts:2548).
      c.status === 200 && c.json?.coverage_version === "assurance-coverage-1.1",
      { status: c.status, coverage_version: c.json?.coverage_version });
  } else {
    note(32, "S4", "no decided engagement to read coverage from");
  }

  await report();
}

async function report() {
  console.log("\n" + results.join("\n"));
  console.log(`\n${passes} PASS / ${fails} FAIL`);
  await elev.end().catch(() => {});
  process.exit(fails === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("HARNESS ERROR", e);
  await elev.end().catch(() => {});
  process.exit(3);
});
