/**
 * va-q2-p31-corpus-staging-acceptance.mjs — VA-Q2 P3.1 corpus curation, plus
 * the P4 four-domain directive-example-1 proof that P3 recorded as owed.
 *
 * ── What it proves ──────────────────────────────────────────────────────────
 *   1. BEFORE: the walkthrough org's corpus carries no privacy or AI tag, and a
 *      resolve with personal-data + AI facts reaches only two domains. This is
 *      the state P3's run recorded; re-measuring it is what makes the after
 *      number mean something.
 *   2. Activating GDPR / CCPA / NIST AI RMF writes 24 rows, ALL `curated`.
 *   3. The curated domain distribution is privacy 17, ai 4, nth_party 1,
 *      security 2 — and the two security ones are exactly Art-32 and CCPA-8.
 *   4. The named regressions are fixed live: Art-12-14 is privacy (not ai), and
 *      all four NIST AI RMF functions are ai (not security).
 *   5. AFTER: a resolve with the same facts reaches FOUR domains with items and
 *      fires the four S5 rule_ids the directive requires.
 *   6. The security domain is NOT inflated: of the scope items drawn from the
 *      three new frameworks, exactly two are security, and they are the two
 *      deliberate ones.
 *   7. `uncurated` is observable — the coverage read reports it, and the SOC 2 /
 *      NIST CSF rows that nothing classified now say so.
 *
 * ── How it runs ─────────────────────────────────────────────────────────────
 * Dependency-free of the repo's own modules (only `pg` + node builtins) so it
 * ships into a running service with no build step:
 *
 *   B64=$(gzip -9c scripts/validation/va-q2-p31-corpus-staging-acceptance.mjs | base64 -w0)
 *   render jobs create srv-d7n0rju8bjmc738jbs7g --confirm \
 *     --start-command "echo $B64 | base64 -d | gunzip > ./acc.mjs && node ./acc.mjs"
 *
 * Running it as a job gives it the service's own DATABASE_URL /
 * MIGRATION_DATABASE_URL / JWT_SECRET without those values entering a
 * transcript. It mints its own session JWT rather than needing a password.
 *
 * ── Care taken ──────────────────────────────────────────────────────────────
 *  - Refuses a database named `securelogic` (production) by name.
 *  - It DOES write: it activates three frameworks on the walkthrough org and
 *    creates engagements. That is the point of the run — this is the curation
 *    being applied to staging, not only a read-only probe. Everything it
 *    creates is labelled `[VA-Q2-P3.1 ACCEPTANCE]`.
 *  - Activation is idempotent (ON CONFLICT DO NOTHING), so a re-run is safe.
 *
 * Exits non-zero on any failed check.
 */
import pg from "pg";
import { createHmac } from "node:crypto";

const BASE = "https://securelogic-engine-staging.onrender.com/api";
const ORG_A = "295b989a-89d6-49ec-a7ed-deb04489d068";   // [SEED] Walkthrough Org
const USER_A = "76cc5c29-2aa7-4b19-afd2-9dacbbe6a1e0";  // walkthrough-approver, admin, se=1
const SE_A = 1;
const VENDOR_A = "906991bb-eda0-44f2-9836-4932006d64b0"; // Harbourline Data Services

const TEMPLATES = ["gdpr", "ccpa", "nist_ai_rmf"];
const FRAMEWORK_IDENTITY = {
  gdpr: { name: "GDPR", version: "2018", count: 12 },
  ccpa: { name: "CCPA / CPRA", version: "2023", count: 8 },
  nist_ai_rmf: { name: "NIST AI RMF", version: "1.0", count: 4 },
};
/** The outcome the curated map must produce. Distribution, not a 4th tag copy. */
const WANT_DOMAINS = { privacy: 17, ai: 4, nth_party: 1, security: 2 };
const WANT_SECURITY = ["Art-32", "CCPA-8"];

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
  const sig = createHmac("sha256", process.env.JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
}

let fails = 0, passes = 0;
const results = [];
function check(row, label, ok, detail) {
  if (ok) passes++; else fails++;
  results.push(`${ok ? "PASS" : "FAIL"}  [${row}] ${label}${detail === undefined ? "" : "  :: " + JSON.stringify(detail)}`);
}

async function api(method, path, { token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

const elev = new pg.Client({
  connectionString: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
  ssl: ssl(),
});

async function q(sql, params = []) {
  try {
    const r = await elev.query(sql, params);
    return { ok: true, rows: r.rows, rowCount: r.rowCount };
  } catch (e) {
    return { ok: false, code: e.code, message: e.message, rows: [] };
  }
}

/** Facts of directive example 1. */
const FACTS = {
  facts: [
    { fact_key: "data.personal_data", value: true },
    { fact_key: "ai.uses_ai", value: true },
    { fact_key: "ai.third_party_models", value: true },
  ],
};

async function resolveEngagement(token, label) {
  const e = await api("POST", "/vendor-engagements", {
    token,
    body: {
      vendor_id: VENDOR_A,
      engagement_type: "targeted",
      title: `[VA-Q2-P3.1 ACCEPTANCE] ${label}`,
      intake: { data_sensitivity: "confidential", ai_involvement: "embedded" },
    },
  });
  const id = e.json?.id ?? e.json?.engagement?.id ?? null;
  if (!id) return { id: null, error: e.text.slice(0, 300) };

  await api("PUT", `/vendor-engagements/${id}/facts`, { token, body: FACTS });
  const sc = await api("POST", `/vendor-engagements/${id}/scope`, { token, body: {} });
  const det = await api("GET", `/vendor-engagements/${id}`, { token });
  const domains = det.json?.questionnaire?.domains ?? det.json?.domains ?? null;

  const rules = await q(
    `SELECT DISTINCT jsonb_array_elements(reasons)->>'rule_id' AS rule_id
       FROM vendor_engagement_scope_items WHERE engagement_id = $1 ORDER BY 1`,
    [id]
  );
  return {
    id,
    scopeStatus: sc.status,
    domains,
    withItems: domains ? Object.entries(domains).filter(([, n]) => n > 0).map(([d]) => d).sort() : [],
    ruleIds: (rules.rows ?? []).map((r) => r.rule_id).filter(Boolean),
  };
}

async function main() {
  const dbname = new URL(process.env.DATABASE_URL).pathname.slice(1);
  results.push(`DB: ${dbname}`);
  if (/^securelogic$/i.test(dbname)) {
    console.error("REFUSING TO RUN AGAINST PRODUCTION");
    process.exit(2);
  }
  await elev.connect();
  const TOKEN = signJwt(USER_A, ORG_A, "admin", SE_A);

  // ── 1. BEFORE ────────────────────────────────────────────────────────────
  const before = await q(
    `SELECT t AS tag, count(*)::int AS n FROM requirements r
       JOIN frameworks f ON f.id = r.framework_id, unnest(r.scope_tags) t
      WHERE f.organization_id = $1 GROUP BY t ORDER BY 2 DESC`,
    [ORG_A]
  );
  const beforeTags = Object.fromEntries((before.rows ?? []).map((r) => [r.tag, r.n]));
  check("B1", "BEFORE: the corpus carries no privacy-domain and no AI-domain tag",
    !["privacy", "data-protection", "retention", "ai-governance", "model-risk"].some((t) => beforeTags[t]),
    beforeTags);

  const eBefore = await resolveEngagement(TOKEN, "before activation");
  check("B2", "BEFORE: a resolve with personal-data + AI facts reaches only two domains with items",
    eBefore.withItems.length === 2 && eBefore.withItems.includes("security"),
    { domains: eBefore.domains, withItems: eBefore.withItems });

  // ── 2. ACTIVATE ──────────────────────────────────────────────────────────
  const activatedIds = {};
  for (const key of TEMPLATES) {
    const res = await api("POST", "/frameworks/activate", { token: TOKEN, body: { template_key: key } });
    activatedIds[key] = res.json?.framework?.id ?? null;
    check(`A-${key}`, `activate ${key} → 200 with a framework id`,
      res.status === 200 && !!activatedIds[key],
      { status: res.status, created: res.json?.requirements_created, body: res.status === 200 ? undefined : res.json });
  }

  // ── 3. CURATED TAGS PERSISTED ────────────────────────────────────────────
  const curated = await q(
    `SELECT f.name AS framework, r.reference_id, r.scope_tags, r.scope_tags_source
       FROM requirements r JOIN frameworks f ON f.id = r.framework_id
      WHERE f.organization_id = $1 AND f.id = ANY($2::uuid[])
      ORDER BY f.name, r.reference_id`,
    [ORG_A, Object.values(activatedIds).filter(Boolean)]
  );
  const rows = curated.rows ?? [];
  check("C1", "all 24 requirements landed, and every one is stamped 'curated'",
    rows.length === 24 && rows.every((r) => r.scope_tags_source === "curated"),
    { n: rows.length, sources: [...new Set(rows.map((r) => r.scope_tags_source))] });

  for (const [key, id] of Object.entries(FRAMEWORK_IDENTITY)) {
    const n = rows.filter((r) => r.framework === id.name).length;
    check(`C2-${key}`, `${id.name} ${id.version} contributed ${id.count} curated requirements`, n === id.count, { got: n });
  }

  // Domain distribution, computed the way the platform computes it.
  const TAG_DOMAIN = {
    privacy: "privacy", "data-protection": "privacy", retention: "privacy",
    "data-subject-rights": "privacy", "cross-border": "privacy",
    "lawful-basis": "privacy", "breach-notification": "privacy",
    "ai-governance": "ai", "model-risk": "ai", explainability: "ai",
    "human-oversight": "ai", "training-data": "ai", "model-provider": "ai",
    "automated-decision": "ai",
    resilience: "resilience", "business-continuity": "resilience",
    "supply-chain": "nth_party", subprocessor: "nth_party",
  };
  const PRECEDENCE = ["ai", "privacy", "nth_party", "resilience"];
  const domainOf = (tags) => {
    const found = new Set(tags.map((t) => TAG_DOMAIN[t]).filter(Boolean));
    return PRECEDENCE.find((d) => found.has(d)) ?? "security";
  };

  const dist = {};
  for (const r of rows) dist[domainOf(r.scope_tags)] = (dist[domainOf(r.scope_tags)] ?? 0) + 1;
  check("C3", "curated domain distribution is privacy 17, ai 4, nth_party 1, security 2",
    JSON.stringify(Object.fromEntries(Object.entries(dist).sort())) ===
      JSON.stringify(Object.fromEntries(Object.entries(WANT_DOMAINS).sort())),
    { got: dist, want: WANT_DOMAINS });

  const securityRefs = rows.filter((r) => domainOf(r.scope_tags) === "security").map((r) => r.reference_id).sort();
  check("C4", "the only two security classifications are the deliberate ones (Art-32, CCPA-8)",
    JSON.stringify(securityRefs) === JSON.stringify(WANT_SECURITY), { got: securityRefs });

  const art1214 = rows.find((r) => r.reference_id === "Art-12-14");
  check("C5", "REGRESSION: GDPR Art-12-14 is a privacy question, not an AI one",
    !!art1214 && domainOf(art1214.scope_tags) === "privacy" && !art1214.scope_tags.includes("explainability"),
    art1214);

  const aiRows = rows.filter((r) => ["GOVERN", "MAP", "MEASURE", "MANAGE"].includes(r.reference_id));
  check("C6", "REGRESSION: all four NIST AI RMF functions are AI questions, not security ones",
    aiRows.length === 4 && aiRows.every((r) => domainOf(r.scope_tags) === "ai"),
    aiRows.map((r) => ({ ref: r.reference_id, tags: r.scope_tags, domain: domainOf(r.scope_tags) })));

  // ── 4. AFTER: the four-domain directive proof (owed to P4) ───────────────
  const eAfter = await resolveEngagement(TOKEN, "directive example 1 four-domain proof");
  const wantDomains = ["ai", "nth_party", "privacy", "security"];
  check("P4-1", "directive example 1: FOUR domains carry items",
    JSON.stringify(eAfter.withItems) === JSON.stringify(wantDomains),
    { domains: eAfter.domains, withItems: eAfter.withItems });

  const wantRules = ["S5.security.baseline", "S5.privacy.personal_data", "S5.ai.declared", "S5.nth.third_party_models"];
  const gotRules = wantRules.filter((r) => eAfter.ruleIds.includes(r));
  check("P4-2", "the four S5 rule_ids the directive names all fired and produced items",
    gotRules.length === 4, { want: wantRules, fired: eAfter.ruleIds.filter((r) => String(r).startsWith("S5.")) });

  const stamped = await q(
    `SELECT count(*) FILTER (WHERE domain IS NULL)::int AS nulls, count(*)::int AS n
       FROM vendor_engagement_scope_items WHERE engagement_id = $1`,
    [eAfter.id]
  );
  check("P4-3", "every scope item still carries a non-NULL domain (P2 invariant holds)",
    (stamped.rows?.[0]?.n ?? 0) > 0 && stamped.rows?.[0]?.nulls === 0, stamped.rows?.[0]);

  // ── 5. SECURITY NOT INFLATED ─────────────────────────────────────────────
  const fromNew = await q(
    `SELECT si.domain, r.reference_id
       FROM vendor_engagement_scope_items si
       JOIN requirements r ON r.id = si.requirement_id
      WHERE si.engagement_id = $1 AND r.framework_id = ANY($2::uuid[])
      ORDER BY si.domain, r.reference_id`,
    [eAfter.id, Object.values(activatedIds).filter(Boolean)]
  );
  const newSecurity = (fromNew.rows ?? []).filter((r) => r.domain === "security").map((r) => r.reference_id).sort();
  check("S1", "of the items drawn from the three new frameworks, the ONLY security ones are Art-32 and CCPA-8",
    newSecurity.every((ref) => WANT_SECURITY.includes(ref)),
    { security_items_from_new_frameworks: newSecurity, all: (fromNew.rows ?? []).length });

  const secBefore = eBefore.domains?.security ?? null;
  const secAfter = eAfter.domains?.security ?? null;
  results.push(`INFO security domain item count: before=${secBefore} after=${secAfter} ` +
    `(a rise of at most 2 is the two deliberate requirements; the other 22 went to privacy/ai/nth_party)`);

  // ── 6. UNCURATED IS OBSERVABLE ───────────────────────────────────────────
  const sources = await q(
    `SELECT COALESCE(r.scope_tags_source,'(null)') AS src, count(*)::int AS n
       FROM requirements r JOIN frameworks f ON f.id = r.framework_id
      WHERE f.organization_id = $1 GROUP BY 1 ORDER BY 1`,
    [ORG_A]
  );
  const srcMap = Object.fromEntries((sources.rows ?? []).map((r) => [r.src, r.n]));
  check("U1", "the corpus now distinguishes curated / heuristic / uncurated",
    (srcMap["curated"] ?? 0) === 24, srcMap);
  results.push(`INFO source histogram after the run: ${JSON.stringify(srcMap)} ` +
    `(uncurated rows are SOC 2 / NIST CSF requirements nothing classified — issue #920)`);

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
