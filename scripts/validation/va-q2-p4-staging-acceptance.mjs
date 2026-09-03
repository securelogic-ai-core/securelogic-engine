/**
 * va-q2-p4-staging-acceptance.mjs — VA-Q2 P4 on live staging.
 *
 * The isolation suite already proves P4's behaviours against real Postgres in
 * CI. This proves the things only staging can show:
 *
 *   - the three S2-from-facts triggers fire against the REAL curated corpus and
 *     pull real requirements (the harness uses a 4-row fixture);
 *   - the version gate holds on real data: a 1.0.0 engagement declaring the same
 *     facts fires none of them;
 *   - reassessment: an issued engagement refuses a Q2 write; a child with
 *     verified narrower facts is narrower; a child with a vendor-sourced
 *     narrower fact is not;
 *   - AI authority: an ai_extraction row cannot be born accepted; proposed does
 *     not move a resolve; the governed accept does.
 *
 * The 1.0.0 EQUIVALENCE proof is deliberately NOT here — it is
 * `scripts/validation/va-q2-scope-equivalence.ts`, run directly on the service
 * (`npx tsx`), because it needs the real resolver and the whole engagement
 * population rather than a fixture.
 *
 *   B64=$(gzip -9c scripts/validation/va-q2-p4-staging-acceptance.mjs | base64 -w0)
 *   render jobs create srv-d7n0rju8bjmc738jbs7g --confirm \
 *     --start-command "echo $B64 | base64 -d | gunzip > ./acc.mjs && node ./acc.mjs"
 *
 * Refuses a database named `securelogic`. Creates engagements labelled
 * `[VA-Q2-P4 ACCEPTANCE]`. Exits non-zero on any failed check.
 */
import pg from "pg";
import { createHmac, createHash } from "node:crypto";

const BASE = "https://securelogic-engine-staging.onrender.com/api";
const ORG_A = "295b989a-89d6-49ec-a7ed-deb04489d068";
const USER_A = "76cc5c29-2aa7-4b19-afd2-9dacbbe6a1e0";
const SE_A = 1;

/**
 * TIER MATTERS, and getting it wrong wastes a run.
 *
 * At `tier_4_low` the staging corpus's assessment floor is 36 `core`
 * requirements against a nominal target of 15, so the DISCRETIONARY budget is
 * zero and every S5/S2-fact item is dropped. That is #925 starvation — known,
 * ruled on, and not what P4 is trying to demonstrate. Proving P4's behaviours
 * needs a tier whose target the corpus fits inside.
 *
 * Raised through OPERATIONAL dimensions only: `data_sensitivity` stays below
 * `confidential` and `ai_involvement` stays `none`, so S5.privacy.sensitivity
 * and S5.ai.involvement still cannot fire and the privacy/AI domains can only
 * be reached by the DECLARED facts under test.
 */
const BENIGN_INTAKE = {
  data_sensitivity: "internal", data_volume: "mass", access_level: "read_only",
  operational_dependency: "critical", recoverability: "none", business_criticality: "critical",
  regulatory_exposure: "none", regulatory_breach_notification: false,
  ai_involvement: "none", ai_autonomy: "none", hosting_model: "multi_tenant_saas",
  fourth_party_exposure: "none", concentration: "single_point_of_failure",
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
const valueHash = (v) => createHash("sha256").update(canonicalJson(v), "utf8").digest("hex");

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

let VENDOR = null;
let TOKEN = null;

async function mkEngagement(title, extra = {}) {
  const r = await api("POST", "/vendor-engagements", {
    token: TOKEN,
    body: { ...BENIGN_INTAKE, vendor_id: VENDOR, engagement_type: "targeted", title: `[VA-Q2-P4 ACCEPTANCE] ${title}`, ...extra },
  });
  return r.json?.id ?? r.json?.engagement?.id ?? null;
}
const putFacts = (id, facts) => api("PUT", `/vendor-engagements/${id}/facts`, { token: TOKEN, body: { facts } });
async function resolve(id) {
  const r = await api("POST", `/vendor-engagements/${id}/scope`, { token: TOKEN, body: {} });
  // `composition` is returned by the route and persisted nowhere. Not capturing
  // it is what made the previous run's numbers unexplainable.
  lastComposition = r.json?.composition ?? null;
  lastTruncated = r.json?.truncated ? { cap: r.json.truncated.cap, dropped: r.json.truncated.dropped_requirement_ids.length } : null;
  return r;
}
let lastComposition = null;
let lastTruncated = null;

async function ruleIds(id) {
  const r = await q(
    `SELECT DISTINCT jsonb_array_elements(reasons)->>'rule_id' AS rule_id
       FROM vendor_engagement_scope_items WHERE engagement_id=$1 ORDER BY 1`, [id]);
  return (r.rows ?? []).map((x) => x.rule_id).filter(Boolean);
}
async function domains(id) {
  const r = await q(
    `SELECT domain, count(*)::int AS n FROM vendor_engagement_scope_items
      WHERE engagement_id=$1 AND domain IS NOT NULL GROUP BY domain`, [id]);
  return Object.fromEntries((r.rows ?? []).map((x) => [x.domain, x.n]));
}
async function insertFact(subjectId, row) {
  const app = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: ssl() });
  await app.connect();
  try {
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.current_org_id',$1,true)", [ORG_A]);
    await app.query(
      `INSERT INTO assessment_facts
         (organization_id, subject_type, subject_id, fact_key, value, value_hash,
          source, origin, status, provenance, observed_at)
       VALUES ($1,'vendor_engagement',$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb,NOW())`,
      [ORG_A, subjectId, row.fact_key, JSON.stringify(row.value), valueHash(row.value),
       row.source, row.origin, row.status,
       JSON.stringify({ actor: { kind: "system", id: null }, via: "p4-acceptance", at: new Date().toISOString(), ...(row.provenance ?? {}) })]
    );
    await app.query("COMMIT");
    return { ok: true };
  } catch (e) {
    try { await app.query("ROLLBACK"); } catch {}
    return { ok: false, code: e.code, message: e.message };
  } finally { await app.end(); }
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

  // ── 1. S2-from-facts, against the real curated corpus ────────────────────
  const CASES = [
    ["S2.ai_prompts", "ai.customer_data_in_prompts"],
    ["S2.cross_border", "data.cross_border"],
    ["S2.subprocessors", "nth.subprocessors_declared"],
  ];
  for (const [ruleId, factKey] of CASES) {
    const id = await mkEngagement(`S2 ${ruleId}`);
    if (!id) { check(`S2:${ruleId}`, "engagement created", false); continue; }
    const p = await putFacts(id, [{ fact_key: factKey, value: true }]);
    if (p.status !== 200) { check(`S2:${ruleId}`, "facts declared", false, { status: p.status, body: p.text.slice(0, 200) }); continue; }
    await resolve(id);
    const ids = await ruleIds(id);
    check(`S2:${ruleId}`, `${ruleId} fires on ${factKey} against the real corpus`,
      ids.includes(ruleId),
      { fired_s2: ids.filter((r) => r.startsWith("S2.")), domains: await domains(id),
        composition: lastComposition, truncated: lastTruncated });
  }

  // Version gate on real data.
  const legacy = await mkEngagement("S2 version gate 1.0.0");
  if (legacy) {
    await q(`UPDATE vendor_engagements SET scope_rule_version='1.0.0' WHERE id=$1`, [legacy]);
    await putFacts(legacy, [{ fact_key: "data.cross_border", value: true }]);
    await resolve(legacy);
    const ids = await ruleIds(legacy);
    check("S2-GATE", "a 1.0.0 engagement fires NO fact trigger and carries no domain",
      !ids.some((r) => ["S2.ai_prompts", "S2.cross_border", "S2.subprocessors"].includes(r)) &&
      Object.keys(await domains(legacy)).length === 0,
      { fired: ids.filter((r) => r.startsWith("S2.")), domains: await domains(legacy) });
  }

  // ── 2. Reassessment ──────────────────────────────────────────────────────
  const e1 = await mkEngagement("reassessment parent");
  await putFacts(e1, [
    { fact_key: "data.personal_data", value: true },
    { fact_key: "ai.uses_ai", value: true },
  ]);
  await resolve(e1);
  const parentDomains = await domains(e1);
  await api("POST", `/vendor-engagements/${e1}/issue`, {
    token: TOKEN, body: { contact_email: "p4-staging@securelogicai.com", contact_name: "P4 acceptance" },
  });
  await api("GET", `/vendor-engagements/${e1}/integrity`, { token: TOKEN });
  const hashBefore = (await q(`SELECT question_set_hash h FROM vendor_engagements WHERE id=$1`, [e1])).rows?.[0]?.h ?? null;

  const frozen = await putFacts(e1, [{ fact_key: "data.personal_data", value: false }]);
  const hashAfter = (await q(`SELECT question_set_hash h FROM vendor_engagements WHERE id=$1`, [e1])).rows?.[0]?.h ?? null;
  check("RA-a", "a Q2 write against an ISSUED engagement is refused and moves nothing",
    frozen.status === 409 && hashAfter === hashBefore,
    { status: frozen.status, error: frozen.json?.error, hash_unchanged: hashAfter === hashBefore });

  const e2 = await mkEngagement("reassessment child (verified narrower)", { parent_engagement_id: e1 });
  if (e2) {
    await q(`UPDATE vendor_engagements SET parent_engagement_id=$1 WHERE id=$2`, [e1, e2]);
    await putFacts(e2, [{ fact_key: "data.personal_data", value: false }, { fact_key: "ai.uses_ai", value: true }]);
    await resolve(e2);
    const d2 = await domains(e2);
    const parentNow = await domains(e1);
    // NARROWER means fewer privacy items than the parent — not zero. The org's
    // active privacy obligations mirror into `policy.privacy_obligations_active`,
    // so `S5.privacy.obligation` fires whatever `data.personal_data` says. A
    // hard-coded `=== 0` asserted a floor that does not exist.
    check("RA-b", "a child with VERIFIED narrower facts is narrower, and the parent did not move",
      (d2.privacy ?? 0) < (parentDomains.privacy ?? 0) &&
      (d2.ai ?? 0) > 0 &&
      (parentNow.privacy ?? 0) === (parentDomains.privacy ?? 0),
      { child: d2, parent_before: parentDomains, parent_now: parentNow,
        composition: lastComposition, truncated: lastTruncated });
  }

  const e3 = await mkEngagement("reassessment child (unverified narrower)", { parent_engagement_id: e1 });
  if (e3) {
    await q(`UPDATE vendor_engagements SET parent_engagement_id=$1 WHERE id=$2`, [e1, e3]);
    await putFacts(e3, [{ fact_key: "data.personal_data", value: true }, { fact_key: "ai.uses_ai", value: true }]);
    const ins = await insertFact(e3, {
      fact_key: "data.personal_data", value: false,
      source: "vendor_response", origin: "vendor_answer", status: "accepted",
      provenance: { actor: { kind: "vendor_participant", id: null } },
    });
    await resolve(e3);
    const d3 = await domains(e3);
    check("RA-c", "a vendor-sourced narrower fact does NOT narrow — vendor answers widen only",
      ins.ok && (d3.privacy ?? 0) > 0, { inserted: ins.ok, domains: d3, composition: lastComposition });
  }

  // ── 3. AI authority ──────────────────────────────────────────────────────
  const ai = await mkEngagement("AI authority");
  await putFacts(ai, [{ fact_key: "data.personal_data", value: false }]);
  await resolve(ai);
  const AI_KEY = "policy.privacy_obligations_active";

  const born = await insertFact(ai, {
    fact_key: AI_KEY, value: ["gdpr"], source: "ai_extraction", origin: "derived", status: "accepted",
    provenance: { actor: { kind: "model", id: "p4-acceptance" } },
  });
  check("AI-1", "an ai_extraction row cannot be born 'accepted'", born.ok === false, { code: born.code });

  // Baseline BEFORE the model's row exists. Asserting "privacy === 0" was wrong:
  // the org's active privacy obligations already put privacy items in scope.
  // What must hold is that the proposed row changes NOTHING.
  const baseline = await domains(ai);
  const proposed = await insertFact(ai, {
    fact_key: AI_KEY, value: ["gdpr"], source: "ai_extraction", origin: "derived", status: "proposed",
    provenance: { actor: { kind: "model", id: "p4-acceptance" } },
  });
  await resolve(ai);
  const beforeAccept = await domains(ai);
  check("AI-2", "a 'proposed' ai_extraction row does not change a resolve",
    proposed.ok && JSON.stringify(beforeAccept) === JSON.stringify(baseline),
    { inserted: proposed.ok, baseline, after_proposed: beforeAccept, composition: lastComposition });

  await q(`UPDATE assessment_facts SET status='accepted', accepted_at=NOW(), accepted_by_user_id=$1
            WHERE subject_id=$2 AND fact_key=$3 AND source='ai_extraction' AND status='proposed'`,
          [USER_A, ai, AI_KEY]);
  await resolve(ai);
  const afterAccept = await domains(ai);
  check("AI-3", "after the governed accept, the same row DOES change the resolve",
    (afterAccept.privacy ?? 0) > (beforeAccept.privacy ?? 0) &&
    (await ruleIds(ai)).includes("S5.privacy.obligation"),
    { domains: afterAccept, composition: lastComposition, rules: (await ruleIds(ai)).filter((r) => r.startsWith("S5.privacy")) });

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
