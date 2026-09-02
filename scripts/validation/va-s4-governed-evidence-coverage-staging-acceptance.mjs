/**
 * GOVERNED-EVIDENCE COVERAGE SURFACE — staging acceptance.
 *
 * Proves on staging, through PRODUCT ROUTES, that curated non-SOC evidence is
 * VISIBLE at requirement grain, explicitly NON-COUNTING, deterministically
 * explained, and that questionnaire depth is unchanged by all of it.
 *
 * Fixture discipline follows the D2-D14 harness: fixture rows (evidence,
 * vendor, engagement, framework, requirement) are inserted directly, because
 * upload and seeding are not what is under test. Every GOVERNED act — link,
 * confirm, curate, coverage read, scope resolve — goes through the routes.
 *
 * The six things the owner asked to see:
 *   a. current governed non-SOC evidence is visible at requirement grain
 *   b. it stays explicitly non-counting where authority is insufficient
 *   c. its reason is deterministic
 *   d. expired/stale evidence does not masquerade as current
 *   e. cross-tenant evidence cannot appear
 *   f. questionnaire depth is unchanged
 */
import pg from "pg";
import { createHmac } from "node:crypto";

const BASE = "https://securelogic-engine-staging.onrender.com/api";
const LABEL = "[GE COVERAGE ACCEPTANCE]";
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
  results.push(`${ok ? "PASS" : "FAIL"}  [${String(row).padStart(2)}] ${group.padEnd(10)} ${label}` +
    (detail === undefined ? "" : "  :: " + JSON.stringify(detail).slice(0, 240)));
};
const note = (row, group, label, detail) =>
  results.push(`NOTE  [${String(row).padStart(2)}] ${group.padEnd(10)} ${label}` +
    (detail === undefined ? "" : "  :: " + JSON.stringify(detail).slice(0, 240)));

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
const q = async (s, p = []) => (await elev.query(s, p));

const FUTURE = new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10);
const PAST = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10);

async function mkEvidence(org, title, cls, basis, validUntil) {
  const r = await q(
    `INSERT INTO evidence (organization_id, source_type, source_id, title, evidence_type,
                           assurance_class, validity_basis, valid_from, valid_until)
     VALUES ($1,'control_test',gen_random_uuid(),$2,'document',$3,$4,
             CASE WHEN $4 = 'not_established' THEN NULL ELSE CURRENT_DATE - 30 END, $5::date)
     RETURNING id`,
    [org, `${LABEL} ${title}`, cls, basis, validUntil]
  );
  return r.rows[0].id;
}

async function main() {
  await elev.connect();
  const db = (await q("SELECT current_database() d")).rows[0].d;
  if (db === "securelogic") { console.error("REFUSING to run against production."); process.exit(2); }
  note(0, "env", "database", db);
  note(0, "env", "lifecycle flag", process.env.SECURELOGIC_EVIDENCE_LIFECYCLE_V2 ?? "(unset)");

  const org = SYNTHETIC_FIXTURE_ORG;
  const owner = await q(
    `SELECT id, session_epoch FROM users WHERE organization_id = $1 AND status='active' LIMIT 1`, [org]);
  const ownerId = owner.rows[0]?.id ?? null;
  check(1, "fixture", "fixture organisation has an active user", ownerId !== null);
  if (!ownerId) { console.log(results.join("\n")); process.exit(1); }
  const jwt = signJwt(ownerId, org, "admin", owner.rows[0].session_epoch ?? 0);

  // Fixture: vendor -> engagement, framework -> two requirements.
  const vend = await q(
    `INSERT INTO vendors (organization_id, name, status, criticality)
     VALUES ($1,$2,'active','high') RETURNING id`, [org, `${LABEL} vendor ${Date.now()}`]);
  const eng = await q(
    `INSERT INTO vendor_engagements
       (organization_id, vendor_id, engagement_type, status, methodology_version, scope_rule_version)
     VALUES ($1,$2,'initial','draft','harness-1','harness-1') RETURNING id`, [org, vend.rows[0].id]);
  const engagementId = eng.rows[0].id;
  const fw = await q(
    `INSERT INTO frameworks (organization_id, name, version) VALUES ($1,$2,'1.0') RETURNING id`,
    [org, `${LABEL} framework ${Date.now()}`]);
  const r1 = await q(
    `INSERT INTO requirements (framework_id, reference_id, title) VALUES ($1,'GE-A','Governed A') RETURNING id`,
    [fw.rows[0].id]);
  const r2 = await q(
    `INSERT INTO requirements (framework_id, reference_id, title) VALUES ($1,'GE-B','Governed B') RETURNING id`,
    [fw.rows[0].id]);
  const reqA = r1.rows[0].id, reqB = r2.rows[0].id;
  note(2, "fixture", "engagement", engagementId);

  /** Link + confirm through the ROUTES. Returns the link id, or null. */
  async function linkAndConfirm(evidenceId, requirementId) {
    const l = await api("POST", `/evidence/${evidenceId}/links`, {
      token: jwt,
      body: { target_type: "vendor_engagement", target_id: engagementId,
              target_requirement_id: requirementId, link_kind: "origin" },
    });
    if (l.status !== 201) return { linkId: null, link: l };
    const c = await api("POST", `/evidence/links/${l.json.link_id}/confirm`, {
      token: jwt, body: { note: "harness: this artifact assures this requirement" } });
    return { linkId: l.json.link_id, link: l, confirm: c };
  }

  const coverage = () => api("GET", `/vendor-engagements/${engagementId}/assurance-coverage`, { token: jwt });
  const scope = () => api("POST", `/vendor-engagements/${engagementId}/scope`, { token: jwt, body: {} });

  /* ── f (baseline). Depth BEFORE any governed evidence exists ──────────── */
  const scopeBefore = await scope();
  const depthBefore = (scopeBefore.json?.requirements ?? []).length;
  const coveredIdsBefore = scopeBefore.json?.assuranceCoveredRequirementIds ?? [];
  check(3, "depth", "baseline scope resolves", scopeBefore.status === 200, { depthBefore });
  note(4, "depth", "baseline covered ids", coveredIdsBefore);

  /* ── a. current governed non-SOC evidence is VISIBLE ──────────────────── */
  const evPen = await mkEvidence(org, "pen test current", "pen_test", "policy_default", FUTURE);
  const penLink = await linkAndConfirm(evPen, reqA);
  check(5, "a-visible", "link + confirm succeed through the routes",
    penLink.linkId !== null && penLink.confirm?.status === 200,
    { link: penLink.link.status, confirm: penLink.confirm?.status });

  let cov = await coverage();
  check(6, "a-visible", "coverage route returns the governed_evidence array",
    cov.status === 200 && Array.isArray(cov.json?.governed_evidence), cov.json?.governed_evidence?.length);
  const penRow = (cov.json?.governed_evidence ?? []).find((g) => g.link_id === penLink.linkId);
  check(7, "a-visible", "the pen test is visible AT REQUIREMENT GRAIN",
    penRow !== undefined && penRow.requirement_id === reqA && penRow.requirement_reference === "GE-A", penRow);
  check(8, "a-visible", "the surface names its own version",
    cov.json?.governed_evidence_version === "governed-evidence-surface-1.0",
    cov.json?.governed_evidence_version);

  /* ── b + c. NON-COUNTING with a DETERMINISTIC reason ──────────────────── */
  check(9, "b-noncount", "the pen test does NOT count", penRow?.counts === false, penRow?.counts);
  check(10, "c-reason", "and says exactly why: no_tested_control_authority",
    penRow?.reason === "no_tested_control_authority", penRow?.reason);

  const evIso = await mkEvidence(org, "iso current", "iso_certification", "policy_default", FUTURE);
  const isoLink = await linkAndConfirm(evIso, reqB);
  const evDpa = await mkEvidence(org, "dpa current", "privacy_agreement", "policy_default", FUTURE);
  const dpaLink = await linkAndConfirm(evDpa, reqB);
  cov = await coverage();
  const ge = cov.json?.governed_evidence ?? [];
  const isoRow = ge.find((g) => g.link_id === isoLink.linkId);
  const dpaRow = ge.find((g) => g.link_id === dpaLink.linkId);
  check(11, "c-reason", "iso_certification is non-counting for the same named reason",
    isoRow?.counts === false && isoRow?.reason === "no_tested_control_authority", isoRow);
  check(12, "c-reason", "privacy_agreement is non-counting for the same named reason",
    dpaRow?.counts === false && dpaRow?.reason === "no_tested_control_authority", dpaRow);
  check(13, "b-noncount", "EVERY row on the surface has counts === false",
    ge.length > 0 && ge.every((g) => g.counts === false), ge.length);

  // A tested-control-capable class must NOT be mislabelled as lacking authority.
  const evSoc = await mkEvidence(org, "soc2t2 current", "soc2_type2", "policy_default", FUTURE);
  const socLink = await linkAndConfirm(evSoc, reqA);
  cov = await coverage();
  const socRow = (cov.json?.governed_evidence ?? []).find((g) => g.link_id === socLink.linkId);
  check(14, "c-reason", "soc2_type2 is NOT mislabelled — it awaits a determination, it does not lack authority",
    socRow?.counts === false && socRow?.reason === "awaiting_sufficiency_determination", socRow);

  // Determinism: two consecutive reads agree exactly.
  const cov2 = await coverage();
  const sig = (c) => (c.json?.governed_evidence ?? []).map((g) => `${g.link_id}:${g.reason}:${g.counts}`).sort().join("|");
  check(15, "c-reason", "repeated reads are byte-identical — the reason is a pure function",
    sig(cov) === sig(cov2));

  /* ── d. expired / unestablished / unconfirmed never look current ──────── */
  const evExp = await mkEvidence(org, "pen test EXPIRED", "pen_test", "artifact_dates", PAST);
  const expLink = await linkAndConfirm(evExp, reqA);
  const evNot = await mkEvidence(org, "unestablished", "unclassified", "not_established", null);
  const notLink = await linkAndConfirm(evNot, reqB);
  const evUnc = await mkEvidence(org, "never confirmed", "bcp_dr_test", "policy_default", FUTURE);
  const uncLink = await api("POST", `/evidence/${evUnc}/links`, {
    token: jwt, body: { target_type: "vendor_engagement", target_id: engagementId,
                        target_requirement_id: reqB, link_kind: "origin" } });

  cov = await coverage();
  const ids = new Set((cov.json?.governed_evidence ?? []).map((g) => g.link_id));
  check(16, "d-stale", "an EXPIRED artifact is absent — it cannot masquerade as current",
    expLink.linkId !== null && !ids.has(expLink.linkId), { linkId: expLink.linkId });
  check(17, "d-stale", "a not_established artifact is absent — unknown is not valid",
    notLink.linkId !== null && !ids.has(notLink.linkId));
  check(18, "d-stale", "an UNCONFIRMED link is absent — attaching is not confirming",
    uncLink.status === 201 && !ids.has(uncLink.json.link_id));

  // Detach the pen test through the route: it must leave the surface.
  const det = await api("POST", `/evidence/links/${penLink.linkId}/detach`, {
    token: jwt, body: { reason: "no_longer_relevant" } });
  const covAfterDetach = await coverage();
  const idsAfter = new Set((covAfterDetach.json?.governed_evidence ?? []).map((g) => g.link_id));
  check(19, "d-stale", "a DETACHED link leaves the surface",
    det.status === 200 && !idsAfter.has(penLink.linkId), { detach: det.status });

  /* ── e. cross-tenant evidence cannot appear ───────────────────────────── */
  const other = await q(
    `SELECT id FROM organizations WHERE id <> $1 ORDER BY created_at LIMIT 1`, [org]);
  if (other.rows[0]) {
    const otherOrg = other.rows[0].id;
    const otherUser = await q(
      `SELECT id, session_epoch FROM users WHERE organization_id=$1 AND status='active' LIMIT 1`, [otherOrg]);
    check(20, "e-tenant", "a second organisation with an active user exists to test against",
      otherUser.rows[0] !== undefined, { otherOrg });
    if (otherUser.rows[0]) {
      const otherJwt = signJwt(otherUser.rows[0].id, otherOrg, "admin", otherUser.rows[0].session_epoch ?? 0);
      const foreign = await api("GET", `/vendor-engagements/${engagementId}/assurance-coverage`,
        { token: otherJwt });
      check(21, "e-tenant", "another tenant reading THIS engagement is refused, never served rows",
        foreign.status === 404 || foreign.status === 403,
        { status: foreign.status, body: foreign.json });
      check(22, "e-tenant", "and no governed_evidence leaked in that response",
        (foreign.json?.governed_evidence ?? []).length === 0);
    }
  } else {
    note(20, "e-tenant", "no second organisation on staging — cross-tenant arm skipped");
  }
  const anon = await api("GET", `/vendor-engagements/${engagementId}/assurance-coverage`);
  check(23, "e-tenant", "an unauthenticated read is refused", anon.status === 401 || anon.status === 404,
    anon.status);

  /* ── f. questionnaire depth is UNCHANGED ──────────────────────────────── */
  const scopeAfter = await scope();
  const depthAfter = (scopeAfter.json?.requirements ?? []).length;
  const coveredIdsAfter = scopeAfter.json?.assuranceCoveredRequirementIds ?? [];
  check(24, "f-depth", "scope still resolves after all the governed evidence",
    scopeAfter.status === 200);
  check(25, "f-depth", "QUESTION DEPTH IS IDENTICAL before and after",
    depthBefore === depthAfter, { depthBefore, depthAfter });
  check(26, "f-depth", "the covered-requirement set is IDENTICAL — nothing new counts",
    JSON.stringify([...coveredIdsBefore].sort()) === JSON.stringify([...coveredIdsAfter].sort()),
    { before: coveredIdsBefore, after: coveredIdsAfter });
  const covFinal = await coverage();
  check(27, "f-depth", "covered[] on the coverage surface gained nothing from governed evidence",
    (covFinal.json?.covered ?? []).length === coveredIdsBefore.length,
    { covered: (covFinal.json?.covered ?? []).length });
  check(28, "f-depth", "the COUNTING-rule version is unchanged — counting did not change",
    covFinal.json?.coverage_version === "assurance-coverage-1.1", covFinal.json?.coverage_version);
  const geIds = new Set((covFinal.json?.governed_evidence ?? []).map((g) => g.requirement_id));
  const covIds = new Set((covFinal.json?.covered ?? []).map((c) => c.requirement_id));
  check(29, "f-depth", "no governed-evidence requirement id appears in covered[]",
    [...geIds].every((i) => !covIds.has(i)), { geIds: [...geIds], covIds: [...covIds] });

  /* ── the dark-surface gate, as far as staging can show it ─────────────── */
  // The flag is ON here, so the flag-off 404 cannot be observed on staging; the
  // unit suite owns that proof. What staging CAN show is that the routes are
  // live and still refuse an anonymous caller.
  const darkProbe = await api("POST", `/evidence/${evPen}/links`);
  check(30, "gate", "with the flag ON the surface is live and still refuses anonymous callers",
    darkProbe.status === 401, darkProbe.status);

  console.log(results.join("\n"));
  console.log(`\nGE-COVERAGE-ACCEPTANCE ${passes} PASS / ${fails} FAIL`);
  await elev.end();
  process.exit(fails === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("HARNESS ERROR", e);
  try { await elev.end(); } catch { /* already closed */ }
  process.exit(3);
});
