/**
 * va-q2-922-floor-staging-acceptance.mjs — issue #922 owner ruling, proven on
 * live staging behaviour rather than on the unit harness.
 *
 * WHAT MUST BE TRUE, per the ruling:
 *   - the SecureLogic security baseline survives truncation at tier_4_low, in
 *     every domain combination;
 *   - mandatory floors are satisfied before discretionary questions;
 *   - a nominal target never silently eliminates a mandatory floor;
 *   - when the floor exceeds the target, the floor is preserved and the
 *     overage is observable;
 *   - nominal target / mandatory / discretionary / final count / overage /
 *     truncation are all observable.
 *
 * Domain combinations exercised at tier_4_low:
 *   Security only · +Privacy · +AI · +Privacy+AI · +Nth Party · all four.
 *
 * A tier_2_high case runs alongside as the contrast: same facts, a target the
 * corpus fits inside, so `composition` is proven to be emitted whether or not
 * anything was dropped.
 *
 * ── How it runs ─────────────────────────────────────────────────────────────
 * Dependency-free of repo modules (only `pg` + node builtins):
 *
 *   B64=$(gzip -9c scripts/validation/va-q2-922-floor-staging-acceptance.mjs | base64 -w0)
 *   render jobs create srv-d7n0rju8bjmc738jbs7g --confirm \
 *     --start-command "echo $B64 | base64 -d | gunzip > ./acc.mjs && node ./acc.mjs"
 *
 * Refuses a database named `securelogic`. Creates engagements labelled
 * `[VA-Q2-922 ACCEPTANCE]`; makes no schema or corpus change.
 *
 * Exits non-zero on any failed check.
 */
import pg from "pg";
import { createHmac } from "node:crypto";

const BASE = "https://securelogic-engine-staging.onrender.com/api";
const ORG_A = "295b989a-89d6-49ec-a7ed-deb04489d068";   // [SEED] Walkthrough Org
const USER_A = "76cc5c29-2aa7-4b19-afd2-9dacbbe6a1e0";  // walkthrough-approver, admin
const SE_A = 1;

/** Every value is a member of its enum in inherentRisk.ts. */
const INTAKE_TIER4 = {
  data_sensitivity: "internal", data_volume: "minimal", access_level: "none",
  operational_dependency: "low", recoverability: "hours", business_criticality: "low",
  regulatory_exposure: "none", regulatory_breach_notification: false,
  ai_involvement: "none", ai_autonomy: "none", hosting_model: "on_prem",
  fourth_party_exposure: "none", concentration: "low",
};
/**
 * Raises the tier through OPERATIONAL dimensions only. `data_sensitivity` stays
 * below `confidential` and `ai_involvement` stays `none`, so
 * S5.privacy.sensitivity and S5.ai.involvement cannot fire and the privacy/AI
 * domains can only be reached by the DECLARED facts.
 */
const INTAKE_HIGH = {
  ...INTAKE_TIER4,
  operational_dependency: "critical", recoverability: "none",
  business_criticality: "critical", concentration: "single_point_of_failure",
  data_volume: "mass", hosting_model: "multi_tenant_saas", access_level: "read_only",
};

const FACTS = {
  none: [],
  privacy: [{ fact_key: "data.personal_data", value: true }],
  ai: [{ fact_key: "ai.uses_ai", value: true }],
  privacy_ai: [
    { fact_key: "data.personal_data", value: true },
    { fact_key: "ai.uses_ai", value: true },
  ],
  nth: [{ fact_key: "ai.third_party_models", value: true }],
  all: [
    { fact_key: "data.personal_data", value: true },
    { fact_key: "ai.uses_ai", value: true },
    { fact_key: "ai.third_party_models", value: true },
  ],
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
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
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

let VENDOR = null;

/** Create → declare facts → resolve. Returns the live composition and domains. */
async function scenario(token, label, intake, facts) {
  const e = await api("POST", "/vendor-engagements", {
    token,
    body: {
      vendor_id: VENDOR,
      engagement_type: "targeted",
      title: `[VA-Q2-922 ACCEPTANCE] ${label}`,
      intake,
    },
  });
  const id = e.json?.id ?? e.json?.engagement?.id ?? null;
  if (!id) {
    check(`CREATE:${label}`, "engagement created", false, { status: e.status, body: e.text.slice(0, 260) });
    return null;
  }
  if (facts.length > 0) {
    const p = await api("PUT", `/vendor-engagements/${id}/facts`, { token, body: { facts } });
    if (p.status !== 200) {
      check(`FACTS:${label}`, "facts declared", false, { status: p.status, body: p.text.slice(0, 260) });
      return null;
    }
  }
  const sc = await api("POST", `/vendor-engagements/${id}/scope`, { token, body: {} });
  const det = await api("GET", `/vendor-engagements/${id}`, { token });

  const tierRow = await q(`SELECT assessment_tier FROM vendor_engagements WHERE id = $1`, [id]);
  // Floor membership read from the STORED reasons, not from the response shape.
  const floorRow = await q(
    `SELECT
       count(*) FILTER (WHERE reasons @> '[{"rule_id":"S1.baseline"}]'
                          OR reasons @> '[{"rule_id":"S5.security.baseline"}]')::int AS floor_items,
       count(*) FILTER (WHERE reasons @> '[{"rule_id":"S5.security.baseline"}]')::int AS security_baseline_items,
       count(*)::int AS total
     FROM vendor_engagement_scope_items WHERE engagement_id = $1`,
    [id]
  );

  return {
    id,
    label,
    tier: tierRow.rows?.[0]?.assessment_tier ?? null,
    scopeStatus: sc.status,
    composition: sc.json?.composition ?? null,
    truncated: sc.json?.truncated ?? null,
    scoped: sc.json?.scoped ?? null,
    domains: det.json?.questionnaire?.domains ?? det.json?.domains ?? null,
    floorItems: floorRow.rows?.[0]?.floor_items ?? null,
    securityBaselineItems: floorRow.rows?.[0]?.security_baseline_items ?? null,
    storedTotal: floorRow.rows?.[0]?.total ?? null,
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
  VENDOR = v.rows?.[0]?.id ?? null;
  check("PRE", "a vendor exists in the walkthrough org", !!VENDOR, { vendor: VENDOR });
  if (!VENDOR) { await elev.end(); return; }

  const corpus = await q(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE 'core' = ANY(r.scope_tags))::int AS core
       FROM requirements r JOIN frameworks f ON f.id = r.framework_id
      WHERE f.organization_id = $1`,
    [ORG_A]
  );
  results.push(`INFO corpus: ${JSON.stringify(corpus.rows?.[0])} (the tier-4 baseline is the \`core\` set)`);

  const CASES = [
    ["Security only", FACTS.none],
    ["Security + Privacy", FACTS.privacy],
    ["Security + AI", FACTS.ai],
    ["Security + Privacy + AI", FACTS.privacy_ai],
    ["Security + Nth Party", FACTS.nth],
    ["Security + Privacy + AI + Nth Party", FACTS.all],
  ];

  const t4 = [];
  for (const [label, facts] of CASES) {
    const r = await scenario(TOKEN, `t4 ${label}`, INTAKE_TIER4, facts);
    if (!r) continue;
    t4.push(r);

    check(`T4-TIER:${label}`, "resolved at tier_4_low", r.tier === "tier_4_low", { tier: r.tier });

    // THE RULING, in one assertion per case.
    check(`T4-FLOOR:${label}`, "the security baseline SURVIVES — it is not zero",
      (r.securityBaselineItems ?? 0) > 0 && (r.domains?.security ?? 0) > 0,
      { security_baseline_items: r.securityBaselineItems, security_domain_items: r.domains?.security });

    check(`T4-ORDER:${label}`, "the floor was satisfied before any discretionary item",
      // #925 added a SECOND protected class, so the identity is now three-term.
      // `compliance_protected` is 0 on these fixtures (no active obligation),
      // but the assertion must not silently assume that.
      r.composition !== null && r.composition.mandatory === r.floorItems &&
      r.composition.mandatory + (r.composition.compliance_protected ?? 0) +
        r.composition.discretionary === r.composition.total,
      { composition: r.composition, floor_items_in_db: r.floorItems });

    check(`T4-OBS:${label}`, "nominal target, mandatory, discretionary, total, overage and truncation are all observable",
      r.composition !== null &&
      typeof r.composition.nominal_target === "number" &&
      typeof r.composition.mandatory === "number" &&
      typeof r.composition.discretionary === "number" &&
      typeof r.composition.total === "number" &&
      typeof r.composition.mandatory_overage === "number" &&
      (r.truncated === null || typeof r.truncated.cap === "number"),
      { composition: r.composition, truncated: r.truncated === null ? null : { cap: r.truncated.cap, dropped: r.truncated.dropped_requirement_ids.length } });

    check(`T4-NOSILENT:${label}`, "the nominal target is never claimed when it was exceeded",
      r.composition !== null &&
      (r.composition.total > r.composition.nominal_target
        ? r.composition.mandatory_overage > 0
        : r.composition.mandatory_overage === 0),
      { total: r.composition?.total, nominal_target: r.composition?.nominal_target, overage: r.composition?.mandatory_overage });

    check(`T4-STORED:${label}`, "the stored scope equals what composition reported",
      r.composition !== null && r.storedTotal === r.composition.total,
      { stored: r.storedTotal, reported: r.composition?.total });
  }

  // ── floor exceeds the nominal target ────────────────────────────────────
  const over = t4.filter((r) => r.composition && r.composition.mandatory > r.composition.nominal_target);
  check("FLOOR-OVER", "a floor larger than the nominal target is PRESERVED, with the overage recorded",
    over.length === t4.length && over.every((r) =>
      r.composition.total === r.composition.mandatory &&
      r.composition.discretionary === 0 &&
      r.composition.mandatory_overage === r.composition.mandatory - r.composition.nominal_target),
    over.map((r) => ({ case: r.label, composition: r.composition })).slice(0, 2));

  check("FLOOR-DROP", "no floor item is ever named in dropped_requirement_ids",
    await (async () => {
      for (const r of t4) {
        const dropped = r.truncated?.dropped_requirement_ids ?? [];
        if (dropped.length === 0) continue;
        const clash = await q(
          `SELECT count(*)::int AS n FROM vendor_engagement_scope_items
            WHERE engagement_id = $1 AND requirement_id = ANY($2::uuid[])`,
          [r.id, dropped]
        );
        if ((clash.rows?.[0]?.n ?? 0) !== 0) return false;
      }
      return true;
    })(),
    { cases_with_drops: t4.filter((r) => (r.truncated?.dropped_requirement_ids ?? []).length > 0).length });

  // ── the contrast: a tier whose target the corpus fits inside ────────────
  const high = await scenario(TOKEN, "high all four domains", INTAKE_HIGH, FACTS.all);
  if (high) {
    check("HIGH-TIER", "resolved above tier 4", high.tier !== "tier_4_low", { tier: high.tier });
    check("HIGH-COMP", "composition is emitted even when nothing is dropped",
      high.composition !== null && high.composition.mandatory_overage === 0 && high.truncated === null,
      { tier: high.tier, composition: high.composition, truncated: high.truncated });
    check("HIGH-FLOOR", "the security baseline survives there too",
      (high.securityBaselineItems ?? 0) > 0 && (high.domains?.security ?? 0) > 0,
      { security_domain_items: high.domains?.security, domains: high.domains });
  }

  // ── the two preserved findings, OBSERVED not asserted ───────────────────
  const starved = t4.filter((r) => {
    const d = r.domains ?? {};
    return (d.privacy ?? 0) === 0 && (r.truncated?.dropped_requirement_ids ?? []).length > 0;
  });
  results.push(`FINDING(starvation) ${starved.length}/${t4.length} tier-4 cases activated a discretionary domain that ` +
    `received ZERO items. Composition on those: ${JSON.stringify(starved[0]?.composition ?? null)}. Tracked separately — do not fix here.`);
  results.push(`FINDING(provenance) a rule whose every item was truncated leaves NO trace in the stored scope items; ` +
    `activation survives only in the transient POST /scope 'truncated.dropped_requirement_ids'. Tracked separately.`);

  for (const r of [...t4, high].filter(Boolean)) {
    results.push(`DATA ${r.label}: tier=${r.tier} domains=${JSON.stringify(r.domains)} ` +
      `composition=${JSON.stringify(r.composition)} truncated=${r.truncated ? `{cap:${r.truncated.cap},dropped:${r.truncated.dropped_requirement_ids.length}}` : "null"}`);
  }

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
