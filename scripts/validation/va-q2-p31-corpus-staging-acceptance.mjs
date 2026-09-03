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
/**
 * Resolved at run time, NOT hard-coded. The vendor id P3's instrument used no
 * longer exists on staging, which would have failed this run at engagement
 * creation with a body that says nothing about curation. Seeded tenants change;
 * the acceptance should not depend on a row id staying alive.
 */
let VENDOR_A = null;

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

/**
 * Two intakes, and the difference matters.
 *
 * `INTAKE_TIER4` is P3's all-low intake. It lands tier_4_low, whose question
 * cap is 15 — which is directive example TWO's shape ("no access, no data, no
 * AI → Security attest only, ≤15 items"), not example one's.
 *
 * `INTAKE_MODERATE` raises the tier through dimensions that have nothing to do
 * with privacy or AI — operational dependency, recoverability, criticality,
 * concentration — and deliberately KEEPS `data_sensitivity` below `confidential`
 * and `ai_involvement` at `none`. That is what preserves the meaning of the
 * proof: `S5.privacy.sensitivity` and `S5.ai.involvement` still cannot fire, so
 * the privacy and AI domains can only have been reached by the DECLARED facts.
 */
const INTAKE_TIER4 = {
  data_sensitivity: "internal", data_volume: "minimal", access_level: "none",
  operational_dependency: "low", recoverability: "hours", business_criticality: "low",
  regulatory_exposure: "none", regulatory_breach_notification: false,
  ai_involvement: "none", ai_autonomy: "none", hosting_model: "on_prem",
  fourth_party_exposure: "none", concentration: "low",
};
const INTAKE_MODERATE = {
  ...INTAKE_TIER4,
  // Every value below is a member of its declared enum in inherentRisk.ts.
  // Guessing them cost a run: `concentration: "high"` and
  // `hosting_model: "cloud"` are not values, so the engagement was rejected and
  // the resolve never happened.
  operational_dependency: "critical",   // low | moderate | high | critical
  recoverability: "none",               // hours | days | weeks | none
  business_criticality: "critical",     // low | medium | high | critical
  concentration: "single_point_of_failure", // none | low | moderate | single_point_of_failure
  data_volume: "mass",                  // minimal | moderate | large | mass
  hosting_model: "multi_tenant_saas",   // on_prem | private_cloud | saas | multi_tenant_saas
  access_level: "read_only",            // none | read_only | read_write | admin | network_access
  // UNCHANGED ON PURPOSE, and load-bearing for the proof:
  //   data_sensitivity stays `internal` (< confidential) so S5.privacy.sensitivity cannot fire
  //   ai_involvement stays `none`      (< embedded)     so S5.ai.involvement cannot fire
  // Privacy and AI can therefore only have been reached by the DECLARED facts.
};

async function resolveEngagement(token, label, intake) {
  const e = await api("POST", "/vendor-engagements", {
    token,
    body: {
      vendor_id: VENDOR_A,
      engagement_type: "targeted",
      title: `[VA-Q2-P3.1 ACCEPTANCE] ${label}`,
      intake,
    },
  });
  const id = e.json?.id ?? e.json?.engagement?.id ?? null;
  if (!id) {
    // A rejected intake used to abort the whole run three checks later with
    // "cannot read properties of undefined". Fail HERE, where the body says why.
    check(`CREATE:${label}`, "engagement created", false, { status: e.status, body: e.text.slice(0, 300) });
    return { id: null, tier: null, truncated: null, domains: null, withItems: [], ruleIds: [] };
  }

  await api("PUT", `/vendor-engagements/${id}/facts`, { token, body: FACTS });
  const sc = await api("POST", `/vendor-engagements/${id}/scope`, { token, body: {} });
  const det = await api("GET", `/vendor-engagements/${id}`, { token });
  const domains = det.json?.questionnaire?.domains ?? det.json?.domains ?? null;
  // The tier cap reports its overflow instead of shrinking the scope quietly.
  // Reading it is not optional: a scope that lost its security baseline to the
  // cap looks identical to one that never activated security, and only this
  // field tells them apart.
  const truncated = sc.json?.truncated ?? null;
  // The tier is NOT on either response body under this name — reading it there
  // returned null and made the tier assertion pass vacuously. `assessment_tier`
  // is a column; read the column.
  const tierRow = await q(`SELECT assessment_tier FROM vendor_engagements WHERE id = $1`, [id]);
  const tier = tierRow.rows?.[0]?.assessment_tier ?? null;

  const rules = await q(
    `SELECT DISTINCT jsonb_array_elements(reasons)->>'rule_id' AS rule_id
       FROM vendor_engagement_scope_items WHERE engagement_id = $1 ORDER BY 1`,
    [id]
  );
  return {
    id,
    scopeStatus: sc.status,
    tier,
    truncated,
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

  const v = await q(`SELECT id, name FROM vendors WHERE organization_id = $1 ORDER BY created_at LIMIT 1`, [ORG_A]);
  VENDOR_A = v.rows?.[0]?.id ?? null;
  if (!VENDOR_A) {
    const made = await q(
      `INSERT INTO vendors (organization_id, name) VALUES ($1, '[VA-Q2-P3.1 ACCEPTANCE] vendor') RETURNING id`,
      [ORG_A]
    );
    VENDOR_A = made.rows?.[0]?.id ?? null;
  }
  check("PRE", "a vendor exists in the walkthrough org to hang the engagements on", !!VENDOR_A,
    { vendor: VENDOR_A, name: v.rows?.[0]?.name ?? "(created)" });
  if (!VENDOR_A) { await elev.end(); return; }

  // ── 1. BEFORE ────────────────────────────────────────────────────────────
  const before = await q(
    `SELECT t AS tag, count(*)::int AS n FROM requirements r
       JOIN frameworks f ON f.id = r.framework_id, unnest(r.scope_tags) t
      WHERE f.organization_id = $1 GROUP BY t ORDER BY 2 DESC`,
    [ORG_A]
  );
  const beforeTags = Object.fromEntries((before.rows ?? []).map((r) => [r.tag, r.n]));

  // Is this a first run, or a re-run against an already-curated corpus? The
  // BEFORE assertions are only meaningful once. Re-measuring them after
  // activation would fail for the RIGHT reason, which is the worst kind of red.
  const already = await q(
    `SELECT count(*)::int AS n FROM requirements r JOIN frameworks f ON f.id = r.framework_id
      WHERE f.organization_id = $1 AND r.scope_tags_source = 'curated'`,
    [ORG_A]
  );
  const firstRun = (already.rows?.[0]?.n ?? 0) === 0;
  let eBefore = null;

  if (firstRun) {
    check("B1", "BEFORE: the corpus carries no privacy-domain and no AI-domain tag",
      !["privacy", "data-protection", "retention", "ai-governance", "model-risk"].some((t) => beforeTags[t]),
      beforeTags);
    eBefore = await resolveEngagement(TOKEN, "before activation", INTAKE_MODERATE);
    check("B2", "BEFORE: a resolve with personal-data + AI facts reaches neither privacy nor AI",
      !eBefore.withItems.includes("privacy") && !eBefore.withItems.includes("ai"),
      { tier: eBefore.tier, domains: eBefore.domains, withItems: eBefore.withItems });
  } else {
    results.push(`INFO BEFORE state not re-measured: the corpus already holds ${already.rows[0].n} curated ` +
      `requirements, so this is a re-run. The BEFORE evidence is run 1 (job-da9c4fpf2nfc73f25pb0): ` +
      `tags {core 34, business-continuity 2, access-control 1, incident-response 1, resilience 1, supply-chain 1} ` +
      `— no privacy tag, no AI tag — and a resolve with the same facts reached security 14 / nth_party 1, ` +
      `privacy 0 / ai 0.`);
  }

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
  const eAfter = await resolveEngagement(TOKEN, "directive example 1 four-domain proof", INTAKE_MODERATE);
  const wantDomains = ["ai", "nth_party", "privacy", "security"];

  // The canonical definition of directive example 1 (vendorScopeResolver.test.ts
  // "VA-Q2 — directive example 1: LLM + customer PII") resolves at
  // tier_3_moderate. Tier 4's question cap is 15, and the ordering puts `full`
  // depth ahead of `attest`; the security baseline is `attest`. So at tier 4 a
  // rich multi-domain corpus pushes security out entirely — which is example
  // TWO's shape, not example one's. Assert the tier rather than hope for it.
  check("P4-0", "the engagement resolved above tier 4, as directive example 1 requires",
    // `!= null` catches undefined too — the previous form passed vacuously on an
    // engagement that was never created.
    typeof eAfter.tier === "string" && eAfter.tier !== "tier_4_low", { tier: eAfter.tier ?? null });

  // "Contains the four", not "is exactly the four": raising the tier through
  // operational dimensions legitimately activates resilience too, and the
  // directive asks that Security+Privacy+AI+Nth activate — not that nothing
  // else does.
  check("P4-1", "directive example 1: Security + Privacy + AI + Nth party all carry items",
    wantDomains.every((d) => eAfter.withItems.includes(d)),
    { tier: eAfter.tier, domains: eAfter.domains, withItems: eAfter.withItems, truncated: eAfter.truncated });

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
  const newByDomain = {};
  for (const r of fromNew.rows ?? []) newByDomain[r.domain] = (newByDomain[r.domain] ?? 0) + 1;
  check("S1", "of the items drawn from the three new frameworks, the ONLY security ones are Art-32 and CCPA-8",
    // Non-vacuous by construction: the new frameworks must have contributed
    // items at all, otherwise "security was not inflated" would pass simply
    // because nothing was included.
    (fromNew.rows ?? []).length > 0 && newSecurity.every((ref) => WANT_SECURITY.includes(ref)),
    { security_items_from_new_frameworks: newSecurity, by_domain: newByDomain, total: (fromNew.rows ?? []).length });

  const secBefore = eBefore?.domains?.security ?? "(not re-measured)";
  const secAfter = eAfter.domains?.security ?? null;
  results.push(`INFO security domain item count: before=${secBefore} after=${secAfter} ` +
    `(the new frameworks contributed ${newByDomain["security"] ?? 0} security items — the two deliberate ` +
    `ones are only included when the tier's cap leaves room; the other 22 went to privacy/ai/nth_party)`);

  // ── 5b. The tier-4 cap, observed deliberately rather than stumbled into ──
  // A tier-4 engagement over the SAME facts is directive example 2's shape. With
  // a curated multi-domain corpus its 15-question cap now binds, and because the
  // cap sorts `full` depth ahead of `attest` — and the security baseline is
  // `attest` — the security domain can be squeezed to ZERO. The overflow is
  // RECORDED (`truncated`), so this is the documented no-silent-caps behaviour,
  // not a silent shrink. It is still a product question: a low-risk vendor that
  // declares PII and AI gets a questionnaire with no security questions in it.
  const eTier4 = await resolveEngagement(TOKEN, "tier-4 cap observation", INTAKE_TIER4);
  check("CAP-1", "the tier-4 cap REPORTS its overflow rather than shrinking the scope silently",
    eTier4.truncated === null || (typeof eTier4.truncated?.cap === "number" &&
      Array.isArray(eTier4.truncated?.dropped_requirement_ids)),
    { tier: eTier4.tier, domains: eTier4.domains, truncated: eTier4.truncated });
  results.push(`FINDING tier-4 over the same facts: tier=${eTier4.tier} domains=${JSON.stringify(eTier4.domains)} ` +
    `truncated=${JSON.stringify(eTier4.truncated)}. If security is 0 here, the cap dropped the whole ` +
    `attest-depth security baseline in favour of full-depth privacy/AI items. Recorded, not silent — ` +
    `but a ruling is owed on whether the security baseline should be cap-exempt.`);

  // ── 6. UNCURATED IS OBSERVABLE ───────────────────────────────────────────
  const sources = await q(
    `SELECT COALESCE(r.scope_tags_source,'(null)') AS src, count(*)::int AS n
       FROM requirements r JOIN frameworks f ON f.id = r.framework_id
      WHERE f.organization_id = $1 GROUP BY 1 ORDER BY 1`,
    [ORG_A]
  );
  const srcMap = Object.fromEntries((sources.rows ?? []).map((r) => [r.src, r.n]));
  check("U1", "the corpus now distinguishes curated / heuristic / uncurated",
    // All three must be REPRESENTED. Asserting only the curated count let a
    // corpus with zero 'uncurated' rows pass, which is the state before the
    // backfill runs — i.e. the observability this package promises, unproven.
    (srcMap["curated"] ?? 0) === 24 && (srcMap["uncurated"] ?? 0) > 0,
    srcMap);
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
