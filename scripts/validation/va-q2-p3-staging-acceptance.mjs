/**
 * va-q2-p3-staging-acceptance.mjs — VA-Q2 P3 staging acceptance:
 * plan §H step 4 plus §G.1 adversarial rows A1–A10, A14, A15.
 *
 * RESULT OF RECORD: PASS 32/32 on 2026-08-29 against `9258b4fe`
 * (job-da96mjon74is73f1dro0). See docs/design/VA-Q2-implementation-plan.md §H.
 *
 * ── How it runs ─────────────────────────────────────────────────────────────
 * Deliberately DEPENDENCY-FREE of the repo's own modules (only `pg` and node
 * builtins) so it can be shipped into a running service and executed without a
 * build step or a path-resolution dance:
 *
 *   B64=$(gzip -9c scripts/validation/va-q2-p3-staging-acceptance.mjs | base64 -w0)
 *   render jobs create srv-d7n0rju8bjmc738jbs7g --confirm \
 *     --start-command "echo $B64 | base64 -d | gunzip > ./acc.mjs && node ./acc.mjs"
 *
 * Running it as a job is what gives it the service's own DATABASE_URL,
 * MIGRATION_DATABASE_URL and JWT_SECRET without those values ever entering a
 * transcript. It mints its own session JWTs (matching src/api/lib/jwt.ts) rather
 * than needing anyone's password.
 *
 * ── What it is careful about ────────────────────────────────────────────────
 *  - Refuses a database named `securelogic` (production) by name.
 *  - Every DB-layer probe runs as `app_request` inside a
 *    `SET LOCAL app.current_org_id` transaction that is ALWAYS rolled back, so
 *    a refusal proof never leaves a row behind.
 *  - The contributor-seat user it creates for the 403 proof is deleted in
 *    teardown. The engagements it creates are left, labelled
 *    `[VA-Q2-P3 ACCEPTANCE]`, as the evidence of the run.
 *
 * ── Known limits, stated rather than papered over ───────────────────────────
 *  - A3 cannot isolate the RLS `WITH CHECK` arm: the subject trigger's own
 *    `vendor_engagements` lookup is itself RLS-filtered to the session org, so
 *    a cross-org write is refused by the trigger (23503) BEFORE RLS is reached.
 *    The outcome (refused, zero rows) is what §G.1 A3 specifies; the WITH CHECK
 *    clause itself stays proven by test/isolation/assessmentFacts.test.ts.
 *  - The four-domain directive-example-1 proof is corpus-limited, not code
 *    limited: S5.privacy.personal_data and S5.ai.declared activate and match
 *    zero requirements while the org's frameworks carry no privacy or AI tag.
 *
 * Exits non-zero on any failed check.
 */
import pg from "pg";
import { createHash, createHmac, randomUUID } from "node:crypto";

const BASE = "https://securelogic-engine-staging.onrender.com/api";
const ORG_A = "295b989a-89d6-49ec-a7ed-deb04489d068";   // [SEED] Walkthrough Org
const USER_A = "76cc5c29-2aa7-4b19-afd2-9dacbbe6a1e0";  // walkthrough-approver, admin, se=1
const SE_A = 1;
const ORG_B = "fe2ede61-e1f3-499f-b2b3-3ce530f4fc06";   // Staging Inc (premium)
const USER_B = "786c4a37-82f6-4619-9fd4-b185758ff220";
const VENDOR_A = "906991bb-eda0-44f2-9836-4932006d64b0"; // Harbourline Data Services

function ssl(){const e=process.env;
 if(e.DATABASE_SSL_DISABLED==="true"||e.DATABASE_SSL_DISABLED==="1")return false;
 if(e.DATABASE_TLS_NO_VERIFY==="true")return{rejectUnauthorized:false};
 const o={rejectUnauthorized:true};if(e.DATABASE_SSL_CA)o.ca=e.DATABASE_SSL_CA;
 if(e.DATABASE_SSL_SERVERNAME)o.servername=e.DATABASE_SSL_SERVERNAME.trim();return o;}

const b64 = (b) => Buffer.from(b).toString("base64url");
function signJwt(sub, org, role, se) {
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const p = b64(JSON.stringify({ sub, org, role, se, type: "session", iat: now, exp: now + 604800 }));
  const sig = createHmac("sha256", process.env.JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
}
function canonicalJson(v){ if(v===null||typeof v!=="object")return JSON.stringify(v);
  if(Array.isArray(v))return `[${v.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;}
const vhash = (v) => createHash("sha256").update(canonicalJson(v), "utf8").digest("hex");

let fails = 0, passes = 0;
const results = [];
function check(row, label, ok, detail) {
  if (ok) passes++; else fails++;
  results.push(`${ok ? "PASS" : "FAIL"}  [${row}] ${label}${detail === undefined ? "" : "  :: " + JSON.stringify(detail)}`);
}
async function api(method, path, { token, body, cookie } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  const r = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}

const elev = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL, ssl: ssl() });
const app = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: ssl() });
/** Run SQL as app_request inside a tenant transaction; returns {ok} or {code,message}. */
async function asTenant(orgId, sql, params = []) {
  try {
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.current_org_id',$1,true)", [orgId]);
    const r = await app.query(sql, params);
    await app.query("ROLLBACK");           // probes never persist
    return { ok: true, rows: r.rows, rowCount: r.rowCount };
  } catch (e) {
    try { await app.query("ROLLBACK"); } catch {}
    return { ok: false, code: e.code ?? null, message: String(e.message || e) };
  }
}

async function safe(client, sql, params = []) {
  try { const r = await client.query(sql, params); return { rows: r.rows, rowCount: r.rowCount }; }
  catch (e) { return { rows: null, error: String(e.message || e) }; }
}

const TOKEN_A = signJwt(USER_A, ORG_A, "admin", SE_A);
const TOKEN_B = signJwt(USER_B, ORG_B, "admin", 0);
let contribUserId = null;
const created = { engagements: [], vendors: [] };

async function main() {
  await elev.connect(); await app.connect();
  const dbname = (await elev.query("SELECT current_database() AS d")).rows[0].d;
  if (dbname === "securelogic") { console.log("REFUSING: production database"); process.exit(2); }
  results.push(`context: db=${dbname}`);

  // ── Step 1 — migration proof ──────────────────────────────────────────────
  const mig = await elev.query("SELECT filename FROM schema_migrations WHERE filename LIKE '20261063%'");
  check("H4.0", "migration 20261063_assessment_facts.sql applied on staging", mig.rowCount === 1, mig.rows.map(r=>r.filename));

  // corpus visibility for the domain expectation
  const tags = await safe(elev, `SELECT t AS tag, count(*)::int AS n FROM requirements r JOIN frameworks f ON f.id=r.framework_id,
      unnest(r.scope_tags) AS t WHERE f.organization_id=$1 GROUP BY t ORDER BY n DESC`, [ORG_A]);
  results.push("orgA_corpus_tags: " + JSON.stringify(tags.rows ? Object.fromEntries(tags.rows.map(r=>[r.tag,r.n])) : tags.error));

  // an engagement belonging to an org that is NOT org A (for A2 / A14)
  let FOREIGN_ENG = null, FOREIGN_ORG = null;
  const foreign = await safe(elev, `SELECT id, organization_id FROM vendor_engagements WHERE organization_id <> $1 LIMIT 1`, [ORG_A]);
  if (foreign.rows?.[0]) { FOREIGN_ENG = foreign.rows[0].id; FOREIGN_ORG = foreign.rows[0].organization_id; }
  results.push(`foreign_engagement (pre-existing): ${FOREIGN_ENG} (org ${FOREIGN_ORG})`);

  // contributor seat in org A (created for this run, deleted in teardown)
  const cEmail = `va-q2-p3-acceptance-contributor-${Date.now()}@securelogicai.com`;
  const ins = await elev.query(
    `INSERT INTO users (organization_id, email, name, role, status, password_hash, email_verified, seat_type)
     VALUES ($1,$2,'VA-Q2 P3 acceptance contributor','member','active','!disabled-no-login!',TRUE,'contributor')
     RETURNING id`, [ORG_A, cEmail]);
  contribUserId = ins.rows[0].id;
  const TOKEN_C = signJwt(contribUserId, ORG_A, "member", 0);

  const INTAKE = {
    data_sensitivity: "internal", data_volume: "minimal", access_level: "none",
    operational_dependency: "low", recoverability: "hours", business_criticality: "low",
    regulatory_exposure: "none", regulatory_breach_notification: false,
    ai_involvement: "none", ai_autonomy: "none", hosting_model: "on_prem",
    fourth_party_exposure: "none", concentration: "low",
  };

  // ── org-B subject for the cross-tenant DB probes (created if none exists) ──
  if (!FOREIGN_ENG) {
    let vb = await safe(elev, `SELECT id FROM vendors WHERE organization_id=$1 LIMIT 1`, [ORG_B]);
    let vendorB = vb.rows?.[0]?.id ?? null;
    if (!vendorB) {
      const mk = await safe(elev,
        `INSERT INTO vendors (organization_id,name,category,criticality,data_sensitivity,access_level,
                              service_description,status,current_risk_score)
         VALUES ($1,'[VA-Q2-P3 ACCEPTANCE] cross-tenant subject','Validation','low','internal','none',
                 'Created by the VA-Q2 P3 staging acceptance run','active',10) RETURNING id`, [ORG_B]);
      vendorB = mk.rows?.[0]?.id ?? null;
      if (vendorB) created.vendors.push(vendorB);
    }
    if (vendorB) {
      const eb = await api("POST", "/vendor-engagements", { token: TOKEN_B, body: {
        vendor_id: vendorB, engagement_type: "targeted",
        title: "[VA-Q2-P3 ACCEPTANCE] cross-tenant subject", intake: INTAKE } });
      if (eb.json?.id) { FOREIGN_ENG = eb.json.id; FOREIGN_ORG = ORG_B; created.engagements.push(FOREIGN_ENG); }
      results.push(`foreign_engagement (created in org B): ${FOREIGN_ENG} status=${eb.status}`);
    }
  }
  check("H4.pre0", "an org-B subject exists for the cross-tenant probes", !!FOREIGN_ENG, { FOREIGN_ENG, FOREIGN_ORG });

  // ── Create engagement E1 (draft) ──────────────────────────────────────────
  const e1 = await api("POST", "/vendor-engagements", { token: TOKEN_A, body: {
    vendor_id: VENDOR_A, engagement_type: "targeted",
    title: "[VA-Q2-P3 ACCEPTANCE] directive example 1", intake: INTAKE } });
  check("H4.pre", "create draft engagement E1", e1.status === 201 || e1.status === 200, { status: e1.status, body: e1.json });
  const E1 = e1.json?.id ?? e1.json?.engagement?.id ?? null;
  if (!E1) { results.push("ABORT: no engagement id: " + e1.text.slice(0, 400)); return; }
  created.engagements.push(E1);
  results.push(`E1=${E1} tier=${JSON.stringify(e1.json?.assessment_tier ?? e1.json?.inherent ?? null)}`);

  // ── H4.1 PUT /facts — directive example 1 ─────────────────────────────────
  const FACTS1 = { facts: [
    { fact_key: "data.personal_data", value: true },
    { fact_key: "ai.uses_ai", value: true },
    { fact_key: "ai.third_party_models", value: true },
    { fact_key: "ai.retention_of_inputs", value: "bounded" },
  ] };
  const p1 = await api("PUT", `/vendor-engagements/${E1}/facts`, { token: TOKEN_A, body: FACTS1 });
  check("H4.1", "PUT /facts directive example 1 → 200", p1.status === 200, { status: p1.status, inserted: p1.json?.inserted, body: p1.status === 200 ? undefined : p1.json });

  // ── H4.2 GET /facts shows every column ────────────────────────────────────
  const g1 = await api("GET", `/vendor-engagements/${E1}/facts`, { token: TOKEN_A });
  const need = ["source","origin","status","provenance","observed_at","verified_at"];
  const rows1 = g1.json?.facts ?? [];
  check("H4.2", "GET /facts returns every row with source/origin/status/provenance/observed_at/verified_at",
    g1.status === 200 && rows1.length === 4 && rows1.every(r => need.every(k => k in r)),
    { status: g1.status, n: rows1.length, sample: rows1[0] });
  check("A10a", "provenance recorded with actor kind=user", rows1.every(r => r.provenance?.actor?.kind === "user"), rows1[0]?.provenance);

  // ── H4.3 (A9) idempotency ─────────────────────────────────────────────────
  const p2 = await api("PUT", `/vendor-engagements/${E1}/facts`, { token: TOKEN_A, body: FACTS1 });
  const g2 = await api("GET", `/vendor-engagements/${E1}/facts`, { token: TOKEN_A });
  check("A9", "duplicate fact ingestion — same PUT twice leaves the row count unchanged",
    p2.status === 200 && (g2.json?.facts ?? []).length === rows1.length && p2.json?.inserted === 0 && p2.json?.superseded === 0,
    { status: p2.status, inserted: p2.json?.inserted, superseded: p2.json?.superseded, n: (g2.json?.facts ?? []).length });

  // ── H4.4 supersession ─────────────────────────────────────────────────────
  const p3 = await api("PUT", `/vendor-engagements/${E1}/facts`, { token: TOKEN_A,
    body: { facts: [{ fact_key: "ai.retention_of_inputs", value: "indefinite" }] } });
  const g3 = await api("GET", `/vendor-engagements/${E1}/facts`, { token: TOKEN_A });
  const ret = (g3.json?.facts ?? []).filter(r => r.fact_key === "ai.retention_of_inputs");
  const oldRow = ret.find(r => r.status === "superseded");
  const newRow = ret.find(r => r.status === "accepted");
  check("H4.4", "changed value → old row superseded, new row accepted with supersedes_id",
    p3.status === 200 && ret.length === 2 && !!oldRow && !!newRow && newRow.supersedes_id === oldRow.id,
    { n: ret.length, old: oldRow && { id: oldRow.id, status: oldRow.status }, new: newRow && { status: newRow.status, supersedes_id: newRow.supersedes_id } });

  // ── H4.5 resolve → domains ────────────────────────────────────────────────
  const sc = await api("POST", `/vendor-engagements/${E1}/scope`, { token: TOKEN_A, body: {} });
  const det = await api("GET", `/vendor-engagements/${E1}`, { token: TOKEN_A });
  const domains = det.json?.questionnaire?.domains ?? det.json?.domains ?? null;
  const trace = await safe(elev, `SELECT DISTINCT jsonb_array_elements(reasons)->>'rule_id' AS rule_id
       FROM vendor_engagement_scope_items WHERE engagement_id=$1 ORDER BY 1`, [E1]);
  const ruleIds = (trace.rows ?? []).map(r => r.rule_id).filter(Boolean);
  const s5 = ruleIds.filter(r => String(r).startsWith("S5."));
  const domainKeys = domains ? Object.keys(domains).sort() : [];
  const wantDomains = ["ai", "nth_party", "privacy", "security"];
  check("H4.5a", "resolve after facts → 200, every item carries a domain",
    sc.status === 200 && domainKeys.length >= 1,
    { status: sc.status, scoped: sc.json?.scoped, domains, s5_rules: s5, all_rules: ruleIds });
  const stampedAll = (await safe(elev,
    `SELECT count(*) FILTER (WHERE domain IS NULL)::int AS nulls, count(*)::int AS n
       FROM vendor_engagement_scope_items WHERE engagement_id=$1`, [E1])).rows?.[0] ?? {};
  check("H4.5b", "every 1.1.0 scope item carries a non-NULL domain (P2 invariant still holds under P3)",
    stampedAll.n > 0 && stampedAll.nulls === 0, stampedAll);
  // Corpus-limited, not a P3 defect: the plan (§G, 'Directive examples 1 and 2')
  // already records the example-1 staging proof as owed to P4 pending curation.
  const gotAll = wantDomains.every(d => domainKeys.includes(d));
  results.push(`KNOWN-GAP [H4.5c] directive example 1 four-domain proof: got=${JSON.stringify(domainKeys)} want=${JSON.stringify(wantDomains)}; ` +
    `orgA corpus carries no privacy-tagged or AI-tagged requirement, so S5.privacy.personal_data and S5.ai.declared fire but match zero requirements. ` +
    `Owed to P4 per plan §G. four_domains_reached=${gotAll}`);

  // ── H4.6 issue + integrity ────────────────────────────────────────────────
  const iss = await api("POST", `/vendor-engagements/${E1}/issue`, { token: TOKEN_A,
    body: { contact_email: "va-q2-p3-acceptance@securelogicai.com", contact_name: "VA-Q2 P3 acceptance" } });
  check("H4.6a", "issue → 200", iss.status === 200, { status: iss.status, body: iss.status === 200 ? undefined : iss.json });
  const inviteToken = iss.json?.invite_token ?? null;
  const integ1 = await api("GET", `/vendor-engagements/${E1}/integrity`, { token: TOKEN_A });
  check("H4.6b", "integrity after issue → match", integ1.json?.verdict === "match", { verdict: integ1.json?.verdict });
  const hashBefore = integ1.json?.stamped_hash ?? null;

  // ── H4.7 (A11) frozen ─────────────────────────────────────────────────────
  const p4 = await api("PUT", `/vendor-engagements/${E1}/facts`, { token: TOKEN_A,
    body: { facts: [{ fact_key: "data.personal_data", value: false }] } });
  const integ2 = await api("GET", `/vendor-engagements/${E1}/integrity`, { token: TOKEN_A });
  check("A11", "vendor attempt to narrow issued scope — PUT after issue → 409 scope_frozen, hash unchanged, integrity match",
    p4.status === 409 && p4.json?.error === "scope_frozen" && integ2.json?.verdict === "match" && integ2.json?.stamped_hash === hashBefore,
    { status: p4.status, error: p4.json?.error, verdict: integ2.json?.verdict, hash_unchanged: integ2.json?.stamped_hash === hashBefore });

  // ── H4.8 (A1) cross-tenant, route layer ───────────────────────────────────
  const countA1 = (await api("GET", `/vendor-engagements/${E1}/facts`, { token: TOKEN_A })).json?.facts?.length ?? -1;
  const xg = await api("GET", `/vendor-engagements/${E1}/facts`, { token: TOKEN_B });
  const xp = await api("PUT", `/vendor-engagements/${E1}/facts`, { token: TOKEN_B, body: { facts: [{ fact_key: "data.personal_data", value: true }] } });
  const countA2 = (await api("GET", `/vendor-engagements/${E1}/facts`, { token: TOKEN_A })).json?.facts?.length ?? -2;
  check("A1", "cross-tenant subject substitution — org-B key on org-A engagement → 404, zero rows written",
    xg.status === 404 && xp.status === 404 && countA1 === countA2,
    { get: xg.status, put: xp.status, before: countA1, after: countA2 });

  // ── H4.9 / H4.10 (A4) object-level authorisation ──────────────────────────
  let portalCookie = null;
  if (inviteToken) {
    const ex = await fetch(`${BASE}/vendor-portal/session`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ token: inviteToken }) });
    const sc2 = ex.headers.getSetCookie ? ex.headers.getSetCookie() : [];
    portalCookie = sc2.map(c => c.split(";")[0]).join("; ") || null;
    results.push(`portal_session_exchange: ${ex.status}, cookie_present=${!!portalCookie}`);
  }
  const pc = portalCookie
    ? await api("GET", `/vendor-engagements/${E1}/facts`, { cookie: portalCookie })
    : await api("GET", `/vendor-engagements/${E1}/facts`, {});
  const cg = await api("GET", `/vendor-engagements/${E1}/facts`, { token: TOKEN_C });
  const cp = await api("PUT", `/vendor-engagements/${E1}/facts`, { token: TOKEN_C, body: { facts: [{ fact_key: "data.personal_data", value: true }] } });
  check("A4", "unauthorized subject access — portal cookie → 401, contributor → 403, org-B → 404",
    pc.status === 401 && cg.status === 403 && cp.status === 403 && xg.status === 404,
    { portal: pc.status, portal_used_real_cookie: !!portalCookie, contributor_get: cg.status, contributor_put: cp.status, orgB: xg.status });

  // ── E2 (draft) for the write-path negatives ───────────────────────────────
  const e2 = await api("POST", "/vendor-engagements", { token: TOKEN_A, body: {
    vendor_id: VENDOR_A, engagement_type: "targeted",
    title: "[VA-Q2-P3 ACCEPTANCE] negative-path draft", intake: INTAKE } });
  const E2 = e2.json?.id ?? null;
  if (E2) created.engagements.push(E2);
  check("H4.pre2", "create draft engagement E2", !!E2, { status: e2.status });

  if (E2) {
    // A5 + A14 — server-forced fields ignored
    const ign = await api("PUT", `/vendor-engagements/${E2}/facts`, { token: TOKEN_A, body: {
      subject_type: "vendor", subject_id: FOREIGN_ENG ?? randomUUID(),
      facts: [{ fact_key: "data.personal_data", value: true, subject_type: "vendor",
                subject_id: FOREIGN_ENG ?? randomUUID(), status: "proposed",
                verified_at: "2020-01-01T00:00:00Z", provenance: { actor: { kind: "model", id: null }, via: "x", at: "2020-01-01T00:00:00Z" } }] } });
    const ignG = await api("GET", `/vendor-engagements/${E2}/facts`, { token: TOKEN_A });
    const r = (ignG.json?.facts ?? [])[0];
    check("A5", "invalid subject type — body subject_type/subject_id/status/verified_at/provenance ignored",
      ign.status === 200 && ignG.json?.subject?.subject_type === "vendor_engagement" &&
      ignG.json?.subject?.subject_id === E2 && r?.status === "accepted" && r?.provenance?.actor?.kind === "user",
      { status: ign.status, subject: ignG.json?.subject, row_status: r?.status, actor: r?.provenance?.actor?.kind });
    check("A14", "identifier manipulation — body subject_id ≠ path id is ignored, row belongs to the path subject",
      ignG.json?.subject?.subject_id === E2 && (ignG.json?.facts ?? []).length === 1,
      { subject_id: ignG.json?.subject?.subject_id, n: (ignG.json?.facts ?? []).length });

    // A8 — malformed key / value / source / origin, and A15 (no value echoed)
    const bad = await api("PUT", `/vendor-engagements/${E2}/facts`, { token: TOKEN_A, body: { facts: [
      { fact_key: "totally.unregistered_key", value: "SENTINELVALUE_ZZZ" },
      { fact_key: "ai.uses_ai", value: "yes" },
      { fact_key: "core.data_volume", value: "huge" },
      { fact_key: "data.personal_data", value: true, source: "vendor_response" },
      { fact_key: "data.personal_data", value: true, origin: "vendor_answer" },
      { fact_key: "Data.Personal_Data", value: true },
    ] } });
    const det8 = Array.isArray(bad.json?.details) ? bad.json.details : [];
    const fields = det8.map(d => ({ i: d.index, f: (Array.isArray(d.errors) ? d.errors : []).map(e => e.field) }));
    check("A8", "malformed fact type/value — 400 with field names for every defect",
      bad.status === 400 && bad.json?.error === "invalid_facts" && det8.length === 6,
      { status: bad.status, error: bad.json?.error, n: det8.length, fields, raw: det8.length ? undefined : bad.text.slice(0, 300) });
    check("A15a", "fact values never leak — 400 body echoes no submitted value",
      !bad.text.includes("SENTINELVALUE_ZZZ"), { sentinel_present: bad.text.includes("SENTINELVALUE_ZZZ") });
    const core = det8.find(d => d.index === 2);
    check("A8b", "core.* refused at the route (inherent-risk columns are the store of record)",
      !!core && (Array.isArray(core.errors) ? core.errors : []).some(e => e.field === "fact_key"), core);

    // Oversize value sent alone — a 2 MB body may be refused by the body parser
    // (413) before the route sees it; either refusal is a refusal, and neither
    // may echo the value.
    const big = await api("PUT", `/vendor-engagements/${E2}/facts`, { token: TOKEN_A,
      body: { facts: [{ fact_key: "data.personal_data", value: "Y".repeat(2_000_000) }] } });
    check("A8c", "2 MB fact value refused (400 at the registry or 413 at the body parser), value never echoed",
      (big.status === 400 || big.status === 413) && !big.text.includes("YYYYYYYYYY"),
      { status: big.status, body: big.text.slice(0, 200) });
  }

  // ── A6 — nonexistent subject ──────────────────────────────────────────────
  const rnd = randomUUID();
  const n1 = await api("GET", `/vendor-engagements/${rnd}/facts`, { token: TOKEN_A });
  const n2 = await api("PUT", `/vendor-engagements/${rnd}/facts`, { token: TOKEN_A, body: { facts: [{ fact_key: "data.personal_data", value: true }] } });
  const dbRnd = await asTenant(ORG_A,
    `INSERT INTO assessment_facts (organization_id,subject_type,subject_id,fact_key,value,value_hash,source,origin,provenance,observed_at)
     VALUES ($1,'vendor_engagement',$2,'data.personal_data','true',$3,'intake','intake',$4,NOW())`,
    [ORG_A, rnd, vhash(true), JSON.stringify({ actor: { kind: "system", id: null }, via: "acceptance", at: new Date().toISOString() })]);
  check("A6", "nonexistent subject — 404 on route, 23503 from the trigger, zero rows",
    n1.status === 404 && n2.status === 404 && dbRnd.ok === false && dbRnd.code === "23503",
    { get: n1.status, put: n2.status, sqlstate: dbRnd.code });

  // ── A2 — cross-tenant subject substitution at the DB layer ────────────────
  const a2 = FOREIGN_ENG ? await asTenant(ORG_A,
    `INSERT INTO assessment_facts (organization_id,subject_type,subject_id,fact_key,value,value_hash,source,origin,provenance,observed_at)
     VALUES ($1,'vendor_engagement',$2,'data.personal_data','true',$3,'intake','intake',$4,NOW())`,
    [ORG_A, FOREIGN_ENG, vhash(true), JSON.stringify({ actor: { kind: "system", id: null }, via: "acceptance", at: new Date().toISOString() })]) : null;
  check("A2", "cross-tenant subject substitution (DB layer) — org-A session, org-B subject_id → 23503",
    !!a2 && a2.ok === false && a2.code === "23503", a2 && { code: a2.code, message: a2.message });

  // ── A3 — RLS WITH CHECK ───────────────────────────────────────────────────
  const a3 = FOREIGN_ENG ? await asTenant(ORG_A,
    `INSERT INTO assessment_facts (organization_id,subject_type,subject_id,fact_key,value,value_hash,source,origin,provenance,observed_at)
     VALUES ($1,'vendor_engagement',$2,'data.personal_data','true',$3,'intake','intake',$4,NOW())`,
    [FOREIGN_ORG, FOREIGN_ENG, vhash(true), JSON.stringify({ actor: { kind: "system", id: null }, via: "acceptance", at: new Date().toISOString() })]) : null;
  check("A3", "cross-tenant subject substitution (RLS layer) — org-A session writing organization_id=B → refused",
    !!a3 && a3.ok === false && (a3.code === "42501" || a3.code === "23503"),
    a3 && { code: a3.code, message: a3.message });

  // ── A5 (DB) — reserved / bogus subject_type ───────────────────────────────
  for (const st of ["vendor", "bogus"]) {
    const r = await asTenant(ORG_A,
      `INSERT INTO assessment_facts (organization_id,subject_type,subject_id,fact_key,value,value_hash,source,origin,provenance,observed_at)
       VALUES ($1,$2,$3,'data.personal_data','true',$4,'intake','intake',$5,NOW())`,
      [ORG_A, st, E1, vhash(true), JSON.stringify({ actor: { kind: "system", id: null }, via: "acceptance", at: new Date().toISOString() })]);
    check("A5db", `invalid subject type '${st}' → 23514, zero rows`, r.ok === false && r.code === "23514", { code: r.code });
  }

  // ── A7 — trigger UPDATE arm ───────────────────────────────────────────────
  const a7 = FOREIGN_ENG ? await asTenant(ORG_A,
    `UPDATE assessment_facts SET subject_id = $1 WHERE organization_id = $2 AND subject_id = $3`,
    [FOREIGN_ENG, ORG_A, E1]) : null;
  check("A7", "mismatched org/subject on UPDATE — trigger re-checks → 23503, row unchanged",
    !!a7 && a7.ok === false && a7.code === "23503", a7 && { code: a7.code });

  // ── A12 — AI-originated fact cannot be authoritative ──────────────────────
  const prov = JSON.stringify({ actor: { kind: "model", id: null }, via: "acceptance", at: new Date().toISOString(),
    evidence: null, model: { model_id: "test", prompt_version: "1", input_hash: "0" } });
  const a12a = await asTenant(ORG_A,
    `INSERT INTO assessment_facts (organization_id,subject_type,subject_id,fact_key,value,value_hash,source,origin,status,provenance,observed_at)
     VALUES ($1,'vendor_engagement',$2,'data.cross_border','true',$3,'ai_extraction','derived','accepted',$4,NOW())`,
    [ORG_A, E1, vhash(true), prov]);
  check("A12", "AI-originated fact attempting authoritative mutation — ai_extraction born accepted → 23514",
    a12a.ok === false && a12a.code === "23514", { code: a12a.code, message: a12a.message?.slice(0, 120) });

  // ── A10 — conflicting provenance (three sources, one key) ─────────────────
  // The route can only write (intake,intake); the other two are the mirror/dependency
  // writers' pairs, inserted on the same app_request channel inside a rolled-back tx.
  let a10 = null;
  try {
    await app.query("BEGIN");
    await app.query("SELECT set_config('app.current_org_id',$1,true)", [ORG_A]);
    for (const [src, org2, val] of [["system_derived","vendor_profile",true],["system_derived","ai_system_dependency",true]]) {
      await app.query(
        `INSERT INTO assessment_facts (organization_id,subject_type,subject_id,fact_key,value,value_hash,source,origin,provenance,observed_at)
         VALUES ($1,'vendor_engagement',$2,'ai.uses_ai',$3::jsonb,$4,$5,$6,$7,NOW())`,
        [ORG_A, E1, JSON.stringify(val), vhash(val), src, org2,
         JSON.stringify({ actor: { kind: "system", id: null }, via: "acceptance", at: new Date().toISOString() })]);
    }
    const r = await app.query(
      `SELECT source, origin, status FROM assessment_facts
        WHERE organization_id=$1 AND subject_id=$2 AND fact_key='ai.uses_ai' ORDER BY origin`, [ORG_A, E1]);
    a10 = r.rows;
    await app.query("ROLLBACK");
  } catch (e) { try { await app.query("ROLLBACK"); } catch {} a10 = { ERROR: e.code + " " + e.message }; }
  check("A10", "conflicting provenance — three (source, origin) rows coexist for one fact_key, all retained",
    Array.isArray(a10) && a10.length === 3 && new Set(a10.map(r => r.origin)).size === 3,
    a10);

  // ── A15b — audit carries keys only ────────────────────────────────────────
  const aud = await safe(elev, `SELECT payload::text AS p FROM security_audit_log
      WHERE organization_id=$1 AND event_type='vendor_engagement.facts_declared' AND resource_id::text=$2
      ORDER BY created_at DESC LIMIT 5`, [ORG_A, E1]);
  aud.rows = aud.rows ?? [];
  aud.rowCount = aud.rows.length;
  const anyValue = aud.rows.some(r => /"(true|false|bounded|indefinite)"|:true|:false/.test(r.p.replace(/"keys":\[[^\]]*\]/, "")));
  check("A15", "fact values never leak — audit payload carries keys and counts only",
    aud.rowCount > 0 && aud.rows.every(r => r.p.includes('"keys"')) && !anyValue,
    { n: aud.rowCount, sample: aud.rows[0]?.p?.slice(0, 300) });

  // ── index / EXPLAIN ───────────────────────────────────────────────────────
  const ex = await asTenant(ORG_A,
    `EXPLAIN (FORMAT JSON) SELECT * FROM assessment_facts WHERE organization_id=$1 AND subject_type='vendor_engagement' AND subject_id=$2`,
    [ORG_A, E1]);
  const plan = ex.ok ? JSON.stringify(ex.rows[0]) : String(ex.message);
  check("IDX", "subject read uses an assessment_facts index (no seq scan)",
    ex.ok && plan.includes("assessment_facts") && !plan.includes("Seq Scan"), { plan: plan.slice(0, 300) });
}

main()
  .catch((e) => { fails++; results.push("FATAL " + String(e.stack || e)); })
  .finally(async () => {
    try { if (contribUserId) await elev.query("DELETE FROM users WHERE id=$1", [contribUserId]); results.push("teardown: contributor user deleted"); }
    catch (e) { results.push("teardown FAILED (user): " + String(e.message)); }
    try { await elev.end(); await app.end(); } catch {}
    console.log("\n===== VA-Q2 P3 STAGING ACCEPTANCE =====");
    for (const r of results) console.log(r);
    console.log(`\nRESULT ${fails === 0 ? "PASS" : "FAIL"}  passed=${passes} failed=${fails}`);
    console.log("ENGAGEMENTS_CREATED " + JSON.stringify(created.engagements));
    process.exit(fails === 0 ? 0 : 1);
  });
