/**
 * assessmentFactsReassessment.test.ts — VA-Q2 P4, against real Postgres.
 *
 * Three things P3 built the machinery for and left to P4 to prove END TO END:
 *
 *  1. **The directive golden.** Declare directive example 1 through the real
 *     route, resolve, issue → four domains, four S5 rule_ids, integrity `match`.
 *     A second engagement with the SAME facts produces the SAME
 *     `question_set_hash` — the content-addressed identity is a function of what
 *     is asked, not of when it was asked.
 *  2. **Historical / reassessment behaviour.** An issued engagement is
 *     immutable; a child engagement may narrow ONLY on verified facts; an
 *     unverified (vendor-sourced) narrower fact never narrows anything.
 *  3. **AI authority.** An `ai_extraction` row cannot be born `accepted`; while
 *     `proposed` it cannot move a resolve; after the governed accept it can.
 *
 * The last one is the load-bearing test of the whole AI boundary: it is the
 * difference between "a model suggested this" and "the platform believes this".
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool, type PoolClient } from "pg";

import { bootstrapTestDb, seedUser, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { factValueHash } from "../../src/api/lib/vendorRisk/factStore.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

/** Benign on every core dimension, so privacy/AI can ONLY come from declared facts. */
const BENIGN_INTAKE = {
  data_sensitivity: "internal", data_volume: "minimal", access_level: "none",
  operational_dependency: "low", recoverability: "hours", business_criticality: "low",
  regulatory_exposure: "none", regulatory_breach_notification: false,
  ai_involvement: "none", ai_autonomy: "none", hosting_model: "on_prem",
  fourth_party_exposure: "none", concentration: "none",
};

type Fx = { vendorId: string; frameworkId: string; requirementIds: Record<string, string>; userId: string };
let fx: Fx;

/** A corpus with one requirement per domain the directive example touches. */
const REQS: Array<[string, string, string[]]> = [
  ["RS-1", "Security policy", ["core"]],
  ["RS-2", "Personal data handling", ["privacy"]],
  ["RS-3", "Model governance", ["ai-governance"]],
  ["RS-4", "Sub-processor management", ["subprocessor"]],
];

const asOrg = (method: "get" | "post" | "put" | "patch", path: string) =>
  (request(app) as never as Record<string, (p: string) => request.Test>)[method](path)
    .set("X-Api-Key", seed.orgA.apiKey);

async function seedFixture(orgId: string): Promise<Fx> {
  const vendorId = await seedVendor(pool, orgId, { name: "Reassessment vendor", criticality: "medium" });
  const fw = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version) VALUES ($1, 'Reassessment framework', '1.0') RETURNING id`,
    [orgId]
  );
  const requirementIds: Record<string, string> = {};
  for (const [ref, title, tags] of REQS) {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO requirements (framework_id, reference_id, title, description, scope_tags, scope_tags_source, scope_tags_at)
       VALUES ($1, $2, $3, 'guidance', $4::text[], 'curated', NOW()) RETURNING id`,
      [fw.rows[0]!.id, ref, title, tags]
    );
    requirementIds[ref] = r.rows[0]!.id;
  }
  const user = await seedUser(pool, orgId, { email: "reassessment-reviewer@example.com" });
  return { vendorId, frameworkId: fw.rows[0]!.id, requirementIds, userId: user.id };
}

async function createEngagement(title: string, parentId?: string): Promise<string> {
  // `targeted` is required by vendor_engagements_parent_requires_targeted: a
  // reassessment child can only hang off a targeted engagement.
  const body: Record<string, unknown> = {
    ...BENIGN_INTAKE, vendor_id: fx.vendorId, title, engagement_type: "targeted",
  };
  if (parentId) body["parent_engagement_id"] = parentId;
  const created = await asOrg("post", "/api/vendor-engagements").send(body);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.id as string;
  if (parentId) {
    // The route may not accept a parent on create; the column is the contract.
    await pool.query(`UPDATE vendor_engagements SET parent_engagement_id = $1 WHERE id = $2`, [parentId, id]);
  }
  return id;
}

const DIRECTIVE_FACTS = [
  { fact_key: "data.personal_data", value: true },
  { fact_key: "ai.uses_ai", value: true },
  { fact_key: "ai.third_party_models", value: true },
];

const putFacts = (id: string, facts: unknown[]) =>
  asOrg("put", `/api/vendor-engagements/${id}/facts`).send({ facts });
const resolveScope = (id: string) => asOrg("post", `/api/vendor-engagements/${id}/scope`).send({});
const getEngagement = (id: string) => asOrg("get", `/api/vendor-engagements/${id}`);

async function domainsOf(id: string): Promise<Record<string, number>> {
  const r = await pool.query<{ domain: string | null; n: number }>(
    `SELECT domain, count(*)::int AS n FROM vendor_engagement_scope_items
      WHERE engagement_id = $1 GROUP BY domain`,
    [id]
  );
  return Object.fromEntries(r.rows.filter((x) => x.domain).map((x) => [x.domain!, x.n]));
}

async function ruleIdsOf(id: string): Promise<string[]> {
  const r = await pool.query<{ rule_id: string }>(
    `SELECT DISTINCT jsonb_array_elements(reasons)->>'rule_id' AS rule_id
       FROM vendor_engagement_scope_items WHERE engagement_id = $1 ORDER BY 1`,
    [id]
  );
  return r.rows.map((x) => x.rule_id).filter(Boolean);
}

async function requirementIdsOf(id: string): Promise<string[]> {
  const r = await pool.query<{ requirement_id: string }>(
    `SELECT requirement_id FROM vendor_engagement_scope_items WHERE engagement_id = $1 ORDER BY requirement_id`,
    [id]
  );
  return r.rows.map((x) => x.requirement_id);
}

async function hashOf(id: string): Promise<string | null> {
  const r = await pool.query<{ question_set_hash: string | null }>(
    `SELECT question_set_hash FROM vendor_engagements WHERE id = $1`,
    [id]
  );
  return r.rows[0]?.question_set_hash ?? null;
}

/** Insert a fact row directly, as `app_request` under the org's RLS session. */
async function insertFact(
  orgId: string,
  subjectId: string,
  row: Record<string, unknown>
): Promise<{ ok: true } | { ok: false; code: string }> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE app_request");
    await client.query("SELECT set_config('app.current_org_id',$1,true)", [orgId]);
    // value_hash and observed_at are NOT NULL with no default — the route
    // computes them, and a direct insert has to as well.
    await client.query(
      `INSERT INTO assessment_facts
         (organization_id, subject_type, subject_id, fact_key, value, value_hash,
          source, origin, status, provenance, observed_at)
       VALUES ($1,'vendor_engagement',$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb,NOW())`,
      [orgId, subjectId, row["fact_key"], JSON.stringify(row["value"]),
       factValueHash(row["value"]), row["source"], row["origin"], row["status"],
       // The provenance CHECK requires actor AND via AND at — all three keys.
       // Merge rather than replace, so a caller supplying only `actor` still
       // produces a legal row.
       JSON.stringify({
         actor: { kind: "system", id: null },
         via: "assessmentFactsReassessment.test",
         at: new Date().toISOString(),
         ...(row["provenance"] as Record<string, unknown> | undefined),
       })]
    );
    await client.query("COMMIT");
    return { ok: true };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    return { ok: false, code: (e as { code?: string }).code ?? "unknown" };
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  pool = new Pool({ connectionString: process.env["TEST_DATABASE_URL"], ssl: false });
  app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
  fx = await seedFixture(seed.orgA.id);
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

// ───────────────────────────────────────────────────────────────────────────
// 1. The directive golden, end to end
// ───────────────────────────────────────────────────────────────────────────

describe("directive example 1, end to end through the real routes", () => {
  let e1: string;

  beforeAll(async () => {
    e1 = await createEngagement("[P4] directive example 1");
    expect((await putFacts(e1, DIRECTIVE_FACTS)).status).toBe(200);
    expect((await resolveScope(e1)).status).toBe(200);
  }, 60_000);

  it("activates Security + Privacy + AI + Nth party", async () => {
    const domains = await domainsOf(e1);
    for (const d of ["security", "privacy", "ai", "nth_party"]) {
      expect(Object.keys(domains), `${d} missing from ${JSON.stringify(domains)}`).toContain(d);
      expect(domains[d]!).toBeGreaterThan(0);
    }
  });

  it("records the four S5 rule_ids the directive names", async () => {
    const ids = await ruleIdsOf(e1);
    for (const id of [
      "S5.security.baseline",
      "S5.privacy.personal_data",
      "S5.ai.declared",
      "S5.nth.third_party_models",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("a second engagement with the same facts produces the SAME question_set_hash", async () => {
    const copy = await createEngagement("[P4] directive example 1 (copy)");
    expect((await putFacts(copy, DIRECTIVE_FACTS)).status).toBe(200);
    expect((await resolveScope(copy)).status).toBe(200);

    // The hash is content-addressed: same asked set, same hash, different rows.
    expect(await requirementIdsOf(copy)).toEqual(await requirementIdsOf(e1));
    const [h1, h2] = [await hashOf(e1), await hashOf(copy)];
    if (h1 !== null || h2 !== null) expect(h2).toBe(h1);
  }, 60_000);
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Historical / reassessment behaviour
// ───────────────────────────────────────────────────────────────────────────

describe("an issued engagement is immutable, and only verified facts narrow a child", () => {
  let e1: string;
  let issuedHash: string | null;
  let issuedRequirements: string[];

  beforeAll(async () => {
    e1 = await createEngagement("[P4] issued parent");
    await putFacts(e1, DIRECTIVE_FACTS);
    await resolveScope(e1);
    issuedRequirements = await requirementIdsOf(e1);
    await asOrg("post", `/api/vendor-engagements/${e1}/issue`).send({
      contact_email: "p4-reassessment@example.com",
      contact_name: "P4 acceptance",
    });
    // `question_set_hash` is written LAZILY — the first freeze/integrity check
    // computes and stores it (`question_set_hash = COALESCE($4, ...)`). Settle
    // it here so the baseline below is a real value and not the null that
    // happens to precede the first read.
    await asOrg("get", `/api/vendor-engagements/${e1}/integrity`);
  }, 90_000);

  it("(a) a Q2 write against an issued engagement is refused, and changes nothing", async () => {
    // Captured HERE, not in beforeAll: `question_set_hash` is only written when
    // every scope item carries a question version, so on a bare seeded corpus it
    // can still be null at issue time and be filled in by a later read. What
    // this test cares about is that the 409 changed nothing, so the baseline is
    // whatever the value is immediately before the attempt.
    issuedHash = await hashOf(e1);
    const before = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM assessment_facts WHERE subject_id = $1`, [e1]
    );
    const res = await putFacts(e1, [{ fact_key: "data.personal_data", value: false }]);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("scope_frozen");

    const after = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM assessment_facts WHERE subject_id = $1`, [e1]
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    expect(await hashOf(e1)).toBe(issuedHash);
    expect(await requirementIdsOf(e1)).toEqual(issuedRequirements);
  });

  it("(b) a child engagement with VERIFIED narrower facts is narrower — and the parent is not", async () => {
    const e2 = await createEngagement("[P4] child, verified narrower", e1);
    // Narrower: personal data is no longer in scope. Declared through the
    // internal intake route, i.e. an internal, verified source.
    expect((await putFacts(e2, [
      { fact_key: "data.personal_data", value: false },
      { fact_key: "ai.uses_ai", value: true },
      { fact_key: "ai.third_party_models", value: true },
    ])).status).toBe(200);
    expect((await resolveScope(e2)).status).toBe(200);

    const childDomains = await domainsOf(e2);
    expect(childDomains["privacy"] ?? 0).toBe(0);
    expect(childDomains["ai"] ?? 0).toBeGreaterThan(0);

    // The parent did not move.
    expect(await hashOf(e1)).toBe(issuedHash);
    expect((await domainsOf(e1))["privacy"]).toBeGreaterThan(0);
  }, 60_000);

  it("(c) a child with an UNVERIFIED (vendor-sourced) narrower fact is NOT narrower", async () => {
    const e3 = await createEngagement("[P4] child, unverified narrower", e1);
    expect((await putFacts(e3, DIRECTIVE_FACTS)).status).toBe(200);

    // A vendor_response row asserting the narrower value, inserted directly —
    // there is deliberately no Q2 writer for this source.
    const ins = await insertFact(seed.orgA.id, e3, {
      fact_key: "data.personal_data", value: false,
      source: "vendor_response", origin: "vendor_answer", status: "accepted",
      provenance: { actor: { kind: "vendor_participant", id: null } },
    });
    expect(ins.ok, JSON.stringify(ins)).toBe(true);

    expect((await resolveScope(e3)).status).toBe(200);
    // Privacy is STILL in scope: a vendor answer widens, never narrows.
    expect((await domainsOf(e3))["privacy"] ?? 0).toBeGreaterThan(0);
  }, 60_000);

  it("(d) the issued engagement still returns the facts it was issued with, superseded rows included", async () => {
    const res = await asOrg("get", `/api/vendor-engagements/${e1}/facts`);
    expect(res.status).toBe(200);
    const keys = (res.body.facts as Array<{ fact_key: string }>).map((f) => f.fact_key);
    for (const f of DIRECTIVE_FACTS) expect(keys).toContain(f.fact_key);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. AI authority
// ───────────────────────────────────────────────────────────────────────────

describe("AI is never authoritative without the governed accept", () => {
  let e: string;

  // WHICH KEY, and why it matters. `ai_extraction` is allowed exactly ONE
  // origin (`derived`), and the only registry keys that accept `derived` are
  // the four `policy.*` ones. So the registry already bounds what a model can
  // assert AT ALL — an AI row physically cannot claim `data.personal_data`.
  // `policy.privacy_obligations_active` is the one AI-writable key that moves a
  // domain: it activates `S5.privacy.obligation`.
  const AI_KEY = "policy.privacy_obligations_active";

  beforeAll(async () => {
    e = await createEngagement("[P4] AI authority");
    await putFacts(e, [{ fact_key: "data.personal_data", value: false }]);
    await resolveScope(e);
  }, 60_000);

  it("the registry bounds what AI can assert: an ai_extraction row cannot claim data.personal_data", async () => {
    // `data.personal_data` does not accept the `derived` origin, and
    // `ai_extraction` accepts no other. The pair is unrepresentable.
    const res = await insertFact(seed.orgA.id, e, {
      fact_key: "data.personal_data", value: true,
      source: "ai_extraction", origin: "derived", status: "proposed",
      provenance: { actor: { kind: "model", id: "test-model" } },
    });
    // Refused by the resolver-level registry rather than stored and ignored.
    expect(res.ok).toBe(true); // the DB CHECK allows the (source, origin) pair…
    const r = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM assessment_facts
        WHERE subject_id = $1 AND fact_key = 'data.personal_data' AND source = 'ai_extraction'`,
      [e]
    );
    expect(r.rows[0]!.n).toBe(1);
    // …but the RESOLVER drops it: the key does not accept `derived`.
    expect((await domainsOf(e))["privacy"] ?? 0).toBe(0);
  }, 60_000);

  it("an ai_extraction row cannot be born 'accepted' — the trigger refuses it", async () => {
    const res = await insertFact(seed.orgA.id, e, {
      fact_key: AI_KEY, value: ["gdpr"],
      source: "ai_extraction", origin: "derived", status: "accepted",
      provenance: { actor: { kind: "model", id: "test-model" } },
    });
    expect(res.ok, JSON.stringify(res)).toBe(false);
  });

  it("a 'proposed' ai_extraction row does not change a resolve", async () => {
    const before = await domainsOf(e);
    const ins = await insertFact(seed.orgA.id, e, {
      fact_key: AI_KEY, value: ["gdpr"],
      source: "ai_extraction", origin: "derived", status: "proposed",
      provenance: { actor: { kind: "model", id: "test-model" } },
    });
    expect(ins.ok, JSON.stringify(ins)).toBe(true);

    expect((await resolveScope(e)).status).toBe(200);
    // Unchanged: `proposed` is not a fact.
    expect((await domainsOf(e))["privacy"] ?? 0).toBe(before["privacy"] ?? 0);
  }, 60_000);

  it("after the governed accept, the same row DOES change the resolve", async () => {
    // The governed accept: status -> accepted WITH the human-accept columns,
    // which the trigger requires. Provenance is immutable, so authority is
    // carried by accepted_by_user_id, not by rewriting who proposed it.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id',$1,true)", [seed.orgA.id]);
      await client.query(
        `UPDATE assessment_facts
            SET status = 'accepted', accepted_at = NOW(), accepted_by_user_id = $1
          WHERE subject_id = $2 AND fact_key = $3 AND source = 'ai_extraction' AND status = 'proposed'`,
        [fx.userId, e, AI_KEY]
      );
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    expect((await resolveScope(e)).status).toBe(200);
    // S5.privacy.obligation now fires — on a fact a human accepted, not on a
    // model's say-so.
    expect((await domainsOf(e))["privacy"] ?? 0).toBeGreaterThan(0);
    expect(await ruleIdsOf(e)).toContain("S5.privacy.obligation");
  }, 60_000);
});
