/**
 * assessmentComposition.test.ts — Assessment Composition v1 through the
 * product routes, over real Postgres (scope-rule 1.2.0).
 *
 * Proven:
 *   - the Core Assurance Set is provisioned into the tenant's library at
 *     composition, idempotently, with curated tags and a canonical identity;
 *   - composition writes an IMMUTABLE snapshot that explains every Core
 *     objective (asked / not applicable + facts), the additional requirements
 *     and the tier target; GET /composition reads it back;
 *   - re-resolving from unchanged inputs reproduces the same hash and appends
 *     history rather than rewriting it;
 *   - a legacy `core`-tagged framework requirement is no longer unconditional
 *     baseline below tier 1, and is explained as such;
 *   - a NOMINAL relationship legitimately composes to no questionnaire, and
 *     issuing it is refused;
 *   - tenant isolation on the snapshot table (RLS) and the route (404).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool, type PoolClient } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { CORE_ASSURANCE_REFERENCES } from "../../src/api/lib/vendorRisk/coreAssuranceSet.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;
let vendorA: string;
let vendorB: string;
let legacyCoreId: string;
let legacyAclId: string;

const asA = (m: "get" | "post", p: string) => request(app)[m](p).set("X-Api-Key", seed.orgA.apiKey);
const asB = (m: "get" | "post", p: string) => request(app)[m](p).set("X-Api-Key", seed.orgB.apiKey);

const NOMINAL = {
  engagement_type: "initial",
  data_sensitivity: "none", data_volume: "minimal", access_level: "none",
  operational_dependency: "low", recoverability: "hours", business_criticality: "low",
  regulatory_exposure: "none", regulatory_breach_notification: false,
  ai_involvement: "none", ai_autonomy: "none", hosting_model: "on_prem",
  fourth_party_exposure: "none", concentration: "none",
};
const SAAS = {
  ...NOMINAL,
  data_sensitivity: "confidential", data_volume: "moderate", access_level: "read_write",
  operational_dependency: "moderate", business_criticality: "medium", hosting_model: "multi_tenant_saas",
};

async function createEngagement(who: typeof asA, vendorId: string, intake: Record<string, unknown>, title: string): Promise<string> {
  const r = await who("post", "/api/vendor-engagements").send({ ...intake, vendor_id: vendorId, title });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}

async function asAppRequest<T>(orgId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE app_request");
    await client.query("SELECT set_config('app.current_org_id',$1,true)", [orgId]);
    const out = await fn(client);
    await client.query("ROLLBACK");
    return out;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env.DATABASE_URL = url;
  process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED = "true";
  pool = new Pool({ connectionString: url, ssl: false });
  app = express();
  app.use(express.json());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));

  vendorA = await seedVendor(pool, seed.orgA.id, { name: "Composition vendor A" });
  vendorB = await seedVendor(pool, seed.orgB.id, { name: "Composition vendor B" });

  // A legacy activated framework: one heuristic `core` row, one access-control row.
  const fw = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version) VALUES ($1, 'Legacy fw', '1.0') RETURNING id`,
    [seed.orgA.id]
  );
  const core = await pool.query<{ id: string }>(
    `INSERT INTO requirements (framework_id, reference_id, title, description, scope_tags, scope_tags_source, scope_tags_at)
     VALUES ($1, 'LEG-CORE', 'Legacy core policy', 'guidance', ARRAY['core']::text[], 'heuristic', NOW()) RETURNING id`,
    [fw.rows[0]!.id]
  );
  legacyCoreId = core.rows[0]!.id;
  const acl = await pool.query<{ id: string }>(
    `INSERT INTO requirements (framework_id, reference_id, title, description, scope_tags, scope_tags_source, scope_tags_at)
     VALUES ($1, 'LEG-ACL', 'Legacy access control', 'guidance', ARRAY['access-control']::text[], 'curated', NOW()) RETURNING id`,
    [fw.rows[0]!.id]
  );
  legacyAclId = acl.rows[0]!.id;
}, 180_000);

afterAll(async () => {
  delete process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED;
  await pool?.end();
});

describe("composition through the product route", () => {
  let engagement: string;
  let firstHash: string;
  let tier: string;

  it("stamps 1.2.0, provisions the Core Assurance Set into the library, and composes with a snapshot", async () => {
    engagement = await createEngagement(asA, vendorA, SAAS, "[composition] saas");
    const r = await asA("post", `/api/vendor-engagements/${engagement}/scope`).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.scope_rule_version).toBe("1.2.0");
    expect(r.body.composition_snapshot.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.body.composition_snapshot.summary.core_applicable + r.body.composition_snapshot.summary.core_not_applicable).toBe(16);
    expect(r.body.composition_snapshot.summary.core_missing).toBe(0);
    firstHash = r.body.composition_snapshot.hash;
    tier = r.body.tier;

    const fw = await pool.query<{ id: string; framework_key: string | null; n: string; curated: string }>(
      `SELECT f.id, f.framework_key,
              (SELECT COUNT(*)::text FROM requirements q WHERE q.framework_id = f.id) AS n,
              (SELECT COUNT(*)::text FROM requirements q WHERE q.framework_id = f.id AND q.scope_tags_source = 'curated') AS curated
         FROM frameworks f WHERE f.organization_id = $1 AND f.name = 'SecureLogic Core Assurance Set' AND f.version = '1.0'`,
      [seed.orgA.id]
    );
    expect(fw.rowCount).toBe(1);
    expect(fw.rows[0]!.framework_key).toBe("securelogic-core-assurance");
    expect(fw.rows[0]!.n).toBe("16");
    expect(fw.rows[0]!.curated).toBe("16");
    // org B's library is untouched
    const b = await pool.query(`SELECT 1 FROM frameworks WHERE organization_id = $1 AND framework_key = 'securelogic-core-assurance'`, [seed.orgB.id]);
    expect(b.rowCount).toBe(0);
  });

  it("GET /composition explains every objective and the additional requirements, without scoring internals", async () => {
    const r = await asA("get", `/api/vendor-engagements/${engagement}/composition`);
    expect(r.status).toBe(200);
    expect(r.body.history_count).toBe(1);
    const c = r.body.composition;
    expect(c.hash).toBe(firstHash);
    expect(c.snapshot_version).toBe("composition-snapshot-1.0");
    expect(c.core_assurance.objectives.map((o: { reference: string }) => o.reference)).toEqual([...CORE_ASSURANCE_REFERENCES]);
    for (const o of c.core_assurance.objectives) {
      expect(["asked", "evidence_satisfied", "not_applicable"]).toContain(o.outcome);
      expect(o.rationale.length).toBeGreaterThan(20);
      expect(o.title.length).toBeGreaterThan(10);
      if (o.outcome === "not_applicable") {
        expect(o.basis.signals).toBeDefined();
        expect(o.depth).toBeNull();
      } else {
        expect(o.depth).toBeTruthy();
        expect(o.reasons.some((x: { rule_id: string }) => x.rule_id.startsWith("S1.core."))).toBe(true);
      }
    }
    // SaaS with confidential data + read_write access: fourth parties are not declared
    const cas11 = c.core_assurance.objectives.find((o: { reference: string }) => o.reference === "CAS-11");
    expect(cas11.outcome).toBe("not_applicable");
    const cas06 = c.core_assurance.objectives.find((o: { reference: string }) => o.reference === "CAS-06");
    expect(cas06.outcome).toBe("asked");
    expect(cas06.domain).toBe("security");
    // the legacy access-control row rides in through S2/tier tags
    expect(c.additional.some((a: { requirement_id: string }) => a.requirement_id === legacyAclId)).toBe(true);
    expect(JSON.stringify(c)).not.toMatch(/"weight"|"contribution"/);
    expect(c.summary.no_questionnaire_required).toBe(false);
    expect(c.coverage.computed).toBe(true);
  });

  it("a legacy `core` requirement is baseline only at tier 1 — otherwise excluded and explained", async () => {
    const items = await pool.query<{ requirement_id: string }>(
      `SELECT requirement_id FROM vendor_engagement_scope_items WHERE engagement_id = $1`,
      [engagement]
    );
    const inScope = items.rows.some((r) => r.requirement_id === legacyCoreId);
    if (tier === "tier_1_critical") {
      expect(inScope).toBe(true);
    } else {
      expect(inScope).toBe(false);
    }
  });

  it("re-resolving from unchanged inputs reproduces the same hash and appends history; rows are immutable", async () => {
    const again = await asA("post", `/api/vendor-engagements/${engagement}/scope`).send({});
    expect(again.status).toBe(200);
    expect(again.body.composition_snapshot.hash).toBe(firstHash);
    const r = await asA("get", `/api/vendor-engagements/${engagement}/composition`);
    expect(r.body.history_count).toBe(2);
    // provisioning was idempotent
    const n = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM requirements q JOIN frameworks f ON f.id = q.framework_id
        WHERE f.organization_id = $1 AND f.framework_key = 'securelogic-core-assurance'`,
      [seed.orgA.id]
    );
    expect(n.rows[0]!.n).toBe("16");

    const rows = await pool.query<{ id: string }>(
      `SELECT id FROM vendor_engagement_composition_snapshots WHERE engagement_id = $1`,
      [engagement]
    );
    expect(rows.rowCount).toBe(2);
    await expect(
      pool.query(`UPDATE vendor_engagement_composition_snapshots SET snapshot_hash = repeat('0', 64) WHERE id = $1`, [rows.rows[0]!.id])
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query(`DELETE FROM vendor_engagement_composition_snapshots WHERE id = $1`, [rows.rows[0]!.id])
    ).rejects.toThrow(/append-only/);
  });

  it("tenant isolation: org B gets 404 on the route and zero rows under RLS", async () => {
    const r = await asB("get", `/api/vendor-engagements/${engagement}/composition`);
    expect(r.status).toBe(404);
    const leak = await asAppRequest(seed.orgB.id, (c) =>
      c.query<{ n: number }>(`SELECT count(*)::int AS n FROM vendor_engagement_composition_snapshots WHERE engagement_id = $1`, [engagement])
    );
    expect(leak.rows[0]!.n).toBe(0);
    const own = await asAppRequest(seed.orgA.id, (c) =>
      c.query<{ n: number }>(`SELECT count(*)::int AS n FROM vendor_engagement_composition_snapshots WHERE engagement_id = $1`, [engagement])
    );
    expect(own.rows[0]!.n).toBe(2);
    // a forged org/engagement pairing is refused by the integrity trigger
    await expect(
      pool.query(
        `INSERT INTO vendor_engagement_composition_snapshots
           (organization_id, engagement_id, snapshot_version, scope_rule_version, assessment_tier, snapshot, snapshot_hash,
            asked_count, evidence_satisfied_count, not_applicable_count)
         VALUES ($1, $2, 'x', '1.2.0', 'tier_4_low', '{}'::jsonb, repeat('a', 64), 0, 0, 0)`,
        [seed.orgB.id, engagement]
      )
    ).rejects.toThrow(/does not exist in this organization/);
  });
});

describe("the nominal relationship", () => {
  it("composes to no questionnaire — every objective not applicable with its reason — and cannot be issued", async () => {
    const e = await createEngagement(asA, vendorA, NOMINAL, "[composition] nominal");
    const r = await asA("post", `/api/vendor-engagements/${e}/scope`).send({});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.scoped).toBe(0);
    expect(r.body.composition_snapshot.summary.no_questionnaire_required).toBe(true);
    expect(r.body.composition_snapshot.summary.core_not_applicable).toBe(16);

    const c = (await asA("get", `/api/vendor-engagements/${e}/composition`)).body.composition;
    expect(c.core_assurance.objectives.every((o: { outcome: string }) => o.outcome === "not_applicable")).toBe(true);
    const cas01 = c.core_assurance.objectives.find((o: { reference: string }) => o.reference === "CAS-01");
    expect(cas01.rationale).toMatch(/no customer or sensitive information, no access to your systems/);
    expect(cas01.basis.facts["core.data_sensitivity"]).toBe("none");

    // Nothing to send: the lifecycle refuses an empty questionnaire.
    const issued = await asA("post", `/api/vendor-engagements/${e}/issue`).send({ contact_email: "x@vendor.example" });
    expect(issued.status).toBe(422);
    expect(issued.body.error).toBe("empty_scope");
  });

  it("org B composes independently and gets its own provisioned set", async () => {
    const e = await createEngagement(asB, vendorB, SAAS, "[composition] org B");
    const r = await asB("post", `/api/vendor-engagements/${e}/scope`).send({});
    expect(r.status).toBe(200);
    expect(r.body.composition_snapshot.summary.core_applicable).toBeGreaterThan(0);
    const b = await pool.query(`SELECT 1 FROM frameworks WHERE organization_id = $1 AND framework_key = 'securelogic-core-assurance'`, [seed.orgB.id]);
    expect(b.rowCount).toBe(1);
  });
});
