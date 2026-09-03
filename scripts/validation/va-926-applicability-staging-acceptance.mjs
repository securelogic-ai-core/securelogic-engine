/**
 * va-926-applicability-staging-acceptance.mjs — VA-926 on live staging.
 *
 * The claim: **questionnaire truncation must never erase applicability.**
 *
 * Staging is the only place this can be shown honestly, because the walkthrough
 * corpus is where truncation actually bites: at `tier_4_low` the assessment
 * floor is 36 `core` requirements against a nominal target of 15, so the
 * discretionary budget is ZERO and every privacy/AI/nth-party item is dropped.
 * That is the exact shape of #925, and it is the case where, before this
 * package, the stored scope recorded nothing at all about privacy having
 * applied.
 *
 * Proven here:
 *   - a tier-4 engagement whose privacy/AI/nth items are ALL truncated still
 *     records that those rules fired, on which requirements, and why;
 *   - the derived join answers "applicable but not asked" — the invisible
 *     assurance gap becomes visible;
 *   - S3 regulatory applicability is recorded with the obligation's identity
 *     AND title, and survives the obligation being deactivated;
 *   - the record reproduces after facts are superseded and requirements retagged;
 *   - re-resolving is idempotent;
 *   - rows are immutable and tenant-isolated;
 *   - a 1.0.0 engagement records applicability with no domain and no S5, and
 *     its questionnaire is unchanged.
 *
 *   B64=$(gzip -9c scripts/validation/va-926-applicability-staging-acceptance.mjs | base64 -w0)
 *   render jobs create srv-d7n0rju8bjmc738jbs7g --confirm \
 *     --start-command "echo $B64 | base64 -d | gunzip > ./acc.mjs && node ./acc.mjs"
 *
 * Refuses a database named `securelogic`. Creates engagements labelled
 * `[VA-926 ACCEPTANCE]`. Exits non-zero on any failed check.
 */
import pg from "pg";
import { createHmac, createHash } from "node:crypto";

const BASE = "https://securelogic-engine-staging.onrender.com/api";
const ORG_A = "295b989a-89d6-49ec-a7ed-deb04489d068";
const USER_A = "76cc5c29-2aa7-4b19-afd2-9dacbbe6a1e0";
const SE_A = 1;

/** All-low: lands tier_4_low, where the floor already exceeds the target. */
const INTAKE_TIER4 = {
  data_sensitivity: "internal", data_volume: "minimal", access_level: "none",
  operational_dependency: "low", recoverability: "hours", business_criticality: "low",
  regulatory_exposure: "none", regulatory_breach_notification: false,
  ai_involvement: "none", ai_autonomy: "none", hosting_model: "on_prem",
  fourth_party_exposure: "none", concentration: "low",
};

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
  const p = b64(JSON.stringify({ sub, org, role, se, type: "session", iat: now, exp: now + 604800 }));
  return `${h}.${p}.${createHmac("sha256", process.env.JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
function canonicalJson(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
}
const basisHash = (v) => createHash("sha256").update(canonicalJson(v), "utf8").digest("hex");

let fails = 0, passes = 0;
const results = [];
function check(row, label, ok, detail) {
  if (ok) passes++; else fails++;
  results.push(`${ok ? "PASS" : "FAIL"}  [${row}] ${label}${detail === undefined ? "" : "  :: " + JSON.stringify(detail)}`);
}
async function api(method, path, { token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

const elev = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  ssl: ssl(),
});
async function q(sql, params = []) {
  try { const r = await elev.query(sql, params); return { ok: true, rows: r.rows, rowCount: r.rowCount }; }
  catch (e) { return { ok: false, code: e.code, message: e.message, rows: [] }; }
}
/** Run as app_request under an org's RLS session; always rolled back. */
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

let VENDOR = null, TOKEN = null;

async function mkEngagement(title, intake = INTAKE_TIER4) {
  const r = await api("POST", "/vendor-engagements", {
    token: TOKEN,
    body: { ...intake, vendor_id: VENDOR, engagement_type: "targeted", title: `[VA-926 ACCEPTANCE] ${title}` },
  });
  return r.json?.id ?? r.json?.engagement?.id ?? null;
}
const putFacts = (id, facts) => api("PUT", `/vendor-engagements/${id}/facts`, { token: TOKEN, body: { facts } });
const resolve = (id) => api("POST", `/vendor-engagements/${id}/scope`, { token: TOKEN, body: {} });

async function applicability(id) {
  const r = await q(
    `SELECT rule_id, rule_family, domain, requirement_id, requirement_reference_id,
            basis, basis_hash, scope_rule_version, resolved_at
       FROM engagement_applicability WHERE engagement_id = $1
      ORDER BY rule_id, requirement_reference_id`, [id]);
  return r.rows ?? [];
}
async function askedIds(id) {
  const r = await q(`SELECT requirement_id FROM vendor_engagement_scope_items WHERE engagement_id=$1`, [id]);
  return new Set((r.rows ?? []).map((x) => x.requirement_id));
}

async function main() {
  const dbname = new URL(process.env.DATABASE_URL).pathname.slice(1);
  results.push(`DB: ${dbname}`);
  if (/^securelogic$/i.test(dbname)) { console.error("REFUSING PRODUCTION"); process.exit(2); }
  await elev.connect();
  TOKEN = signJwt(USER_A, ORG_A, "admin", SE_A);

  const v = await q(`SELECT id FROM vendors WHERE organization_id=$1 ORDER BY created_at LIMIT 1`, [ORG_A]);
  VENDOR = v.rows?.[0]?.id ?? null;
  check("PRE", "vendor exists", !!VENDOR, { vendor: VENDOR });
  if (!VENDOR) { await elev.end(); return; }

  const tableOk = await q(`SELECT to_regclass('public.engagement_applicability') AS t`);
  check("PRE-2", "migration 20261065 applied", tableOk.rows?.[0]?.t === "engagement_applicability", tableOk.rows?.[0]);

  // ── 1. THE CLAIM: truncation does not erase applicability ────────────────
  const e = await mkEngagement("truncated but applicable");
  await putFacts(e, [
    { fact_key: "data.personal_data", value: true },
    { fact_key: "ai.uses_ai", value: true },
    { fact_key: "ai.third_party_models", value: true },
  ]);
  const sc = await resolve(e);
  const comp = sc.json?.composition ?? null;
  const rows = await applicability(e);
  const asked = await askedIds(e);

  const ruleIds = new Set(rows.map((r) => r.rule_id));
  check("C1", "every rule that fired is recorded, including fully-truncated ones",
    ["S1.baseline", "S5.security.baseline", "S5.privacy.personal_data", "S5.ai.declared", "S5.nth.third_party_models"]
      .every((id) => ruleIds.has(id)),
    { recorded_rules: [...ruleIds].sort(), composition: comp });

  const droppedApplicable = rows.filter((r) => !asked.has(r.requirement_id));
  check("C2", "applicable-but-NOT-asked requirements are visible — the invisible gap cannot exist",
    droppedApplicable.length > 0,
    { applicable: rows.length, asked: asked.size, applicable_but_not_asked: droppedApplicable.length,
      sample: droppedApplicable.slice(0, 3).map((r) => ({ rule: r.rule_id, ref: r.requirement_reference_id, domain: r.domain })) });

  const privacyDropped = droppedApplicable.filter((r) => r.domain === "privacy");
  check("C3", "a domain with ZERO questions still records that it applied, and under which domain",
    privacyDropped.length > 0 && (comp?.discretionary ?? -1) === 0,
    { privacy_applicable_not_asked: privacyDropped.length, discretionary: comp?.discretionary });

  check("C4", "the basis is captured as VALUES, and the hash matches",
    rows.filter((r) => r.rule_id === "S5.privacy.personal_data").every(
      (r) => r.basis?.facts?.["data.personal_data"] === true && r.basis_hash === basisHash(r.basis)),
    rows.find((r) => r.rule_id === "S5.privacy.personal_data")?.basis);

  // ── 2. Idempotency ───────────────────────────────────────────────────────
  const before = rows.length;
  await resolve(e);
  const after = (await applicability(e)).length;
  check("C5", "re-resolving with unchanged inputs writes NOTHING new", before === after, { before, after });

  // ── 3. S3 regulatory applicability ───────────────────────────────────────
  const ob = await q(
    `INSERT INTO obligations (organization_id, title, status)
     VALUES ($1, '[VA-926] test obligation', 'active') RETURNING id`, [ORG_A]);
  const obligationId = ob.rows?.[0]?.id ?? null;
  let s3Row = null;
  if (obligationId) {
    const req = await q(
      `SELECT r.id FROM requirements r JOIN frameworks f ON f.id=r.framework_id
        WHERE f.organization_id=$1 ORDER BY r.reference_id LIMIT 1`, [ORG_A]);
    await q(`INSERT INTO obligation_mappings (obligation_id, requirement_id) VALUES ($1,$2)
             ON CONFLICT DO NOTHING`, [obligationId, req.rows?.[0]?.id]);

    const e3 = await mkEngagement("S3 obligation");
    await resolve(e3);
    const r3 = await applicability(e3);
    s3Row = r3.find((r) => r.rule_id === "S3.obligation") ?? null;
    check("S3-1", "S3 applicability is recorded with the obligation's id AND title",
      !!s3Row && s3Row.basis?.obligation_id === obligationId &&
      s3Row.basis?.obligation_title === "[VA-926] test obligation",
      s3Row?.basis);

    await q(`UPDATE obligations SET status='not_applicable' WHERE id=$1`, [obligationId]);
    const r3b = await applicability(e3);
    check("S3-2", "S3 applicability SURVIVES the obligation being deactivated",
      JSON.stringify(r3b) === JSON.stringify(r3),
      { unchanged: JSON.stringify(r3b) === JSON.stringify(r3), rows: r3b.length });
  }

  // ── 4. Historical reproducibility ────────────────────────────────────────
  const snapshot = await applicability(e);
  await putFacts(e, [{ fact_key: "data.personal_data", value: false }]); // supersede
  const oneReq = snapshot.find((r) => r.domain === "privacy")?.requirement_id ?? null;
  if (oneReq) {
    await q(`UPDATE requirements SET scope_tags = ARRAY['core']::text[], scope_tags_at = NOW() WHERE id=$1`, [oneReq]);
  }
  const afterMutation = await applicability(e);
  check("R1", "the record reproduces after facts superseded and requirements retagged",
    JSON.stringify(afterMutation) === JSON.stringify(snapshot),
    { rows: afterMutation.length, identical: JSON.stringify(afterMutation) === JSON.stringify(snapshot) });

  const stillAnswerable = afterMutation.find((r) => r.rule_id === "S5.privacy.personal_data");
  check("R2", "which rule, which domain, which requirement, what basis, which version, when — all still answerable",
    !!stillAnswerable && stillAnswerable.domain === "privacy" &&
    stillAnswerable.basis?.facts?.["data.personal_data"] === true &&
    stillAnswerable.scope_rule_version === "1.1.0" && !!stillAnswerable.resolved_at,
    stillAnswerable && { rule: stillAnswerable.rule_id, domain: stillAnswerable.domain,
      ref: stillAnswerable.requirement_reference_id, basis: stillAnswerable.basis,
      version: stillAnswerable.scope_rule_version });

  const liveFact = await q(
    `SELECT value FROM assessment_facts WHERE subject_id=$1 AND fact_key='data.personal_data' AND status='accepted'`, [e]);
  check("R3", "the inputs really did move — the record is not merely stale-equal",
    liveFact.rows?.[0]?.value === false, { current_fact: liveFact.rows?.[0]?.value });

  // ── 5. Immutability and isolation ────────────────────────────────────────
  const upd = await asApp(ORG_A, `UPDATE engagement_applicability SET domain='ai' WHERE engagement_id=$1`, [e]);
  const del = await asApp(ORG_A, `DELETE FROM engagement_applicability WHERE engagement_id=$1`, [e]);
  check("I1", "rows are immutable — UPDATE and DELETE are both refused",
    !upd.ok && !del.ok, { update: upd.code ?? upd.message?.slice(0, 60), delete: del.code ?? del.message?.slice(0, 60) });

  const otherOrg = await q(`SELECT id FROM organizations WHERE id <> $1 ORDER BY created_at LIMIT 1`, [ORG_A]);
  const orgB = otherOrg.rows?.[0]?.id ?? null;
  if (orgB) {
    const cross = await asApp(orgB, `SELECT id FROM engagement_applicability WHERE engagement_id=$1`, [e]);
    check("I2", "another tenant reads ZERO rows of this engagement's applicability",
      cross.ok && (cross.rows ?? []).length === 0, { org_b: orgB, rows: (cross.rows ?? []).length });

    const forged = await asApp(orgB,
      `INSERT INTO engagement_applicability
         (organization_id, engagement_id, rule_id, rule_family, domain, requirement_id,
          requirement_reference_id, basis, basis_hash, scope_rule_version)
       VALUES ($1,$2,'S1.baseline','S1',NULL,$3,'X-1','{}'::jsonb,$4,'1.1.0')`,
      [orgB, e, snapshot[0]?.requirement_id, basisHash({})]);
    check("I3", "a forged organization + engagement combination is refused",
      !forged.ok, { code: forged.code });
  }

  const badDomain = await asApp(ORG_A,
    `INSERT INTO engagement_applicability
       (organization_id, engagement_id, rule_id, rule_family, domain, requirement_id,
        requirement_reference_id, basis, basis_hash, scope_rule_version)
     VALUES ($1,$2,'S1.baseline','S1','bogus',$3,'X-1','{}'::jsonb,$4,'1.1.0')`,
    [ORG_A, e, snapshot[0]?.requirement_id, basisHash({})]);
  check("I4", "an invalid domain is refused by CHECK", badDomain.code === "23514", { code: badDomain.code });

  // ── 6. 1.0.0 compatibility ───────────────────────────────────────────────
  const legacy = await mkEngagement("legacy 1.0.0");
  await q(`UPDATE vendor_engagements SET scope_rule_version='1.0.0' WHERE id=$1`, [legacy]);
  await putFacts(legacy, [{ fact_key: "data.personal_data", value: true }]);
  await resolve(legacy);
  const legacyRows = await applicability(legacy);
  const legacyDomains = await q(
    `SELECT count(*) FILTER (WHERE domain IS NOT NULL)::int AS n FROM vendor_engagement_scope_items WHERE engagement_id=$1`, [legacy]);
  check("V1", "a 1.0.0 engagement records applicability with NO domain and no S5 rule",
    legacyRows.length > 0 && legacyRows.every((r) => r.domain === null && r.scope_rule_version === "1.0.0") &&
    !legacyRows.some((r) => r.rule_family === "S5"),
    { rows: legacyRows.length, families: [...new Set(legacyRows.map((r) => r.rule_family))] });
  check("V2", "and its questionnaire is unchanged — no domain on any scope item",
    (legacyDomains.rows?.[0]?.n ?? -1) === 0, legacyDomains.rows?.[0]);

  await elev.end();
}

main()
  .then(() => {
    console.log("\n" + results.join("\n"));
    console.log(`\nRESULT: ${fails === 0 ? "PASS" : "FAIL"} ${passes}/${passes + fails}`);
    process.exit(fails === 0 ? 0 : 1);
  })
  .catch((e) => {
    console.log("\n" + results.join("\n"));
    console.error("\nABORTED:", e?.message ?? e);
    process.exit(2);
  });
