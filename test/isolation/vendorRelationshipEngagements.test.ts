/**
 * vendorRelationshipEngagements.test.ts — VO-7: an engagement opened FROM a
 * classified relationship inherits its v2 classification and JOINT tier, is
 * stamped "2.0.0", is never rescored by v1, and scopes through the existing
 * resolver via the bridged v1-vocabulary facts. The v1 path is unchanged.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import { bootstrapTestDb, seedVendor, seedUser, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";

let seed: TestDbSeed; let pool: Pool; let app: express.Express;
let vendorA: string; let vendorA2: string; let orgBVendor: string;
let classified: string; let unclassified: string; let orgBRel: string;

const V1_INTAKE = {
  data_sensitivity: "internal", data_volume: "minimal", access_level: "none",
  operational_dependency: "low", recoverability: "hours", business_criticality: "low",
  regulatory_exposure: "none", regulatory_breach_notification: false,
  ai_involvement: "none", ai_autonomy: "none", hosting_model: "on_prem",
  fourth_party_exposure: "none", concentration: "none",
};
const PAYMENT_PROCESSOR = {
  max_tolerable_disruption: "lt_24_hours", operational_dependency: "essential", business_reach: "enterprise_wide",
  substitutability: "replaceable_months", process_coupling: "in_critical_path", concentration: "moderate",
  data_sensitivity: "restricted", data_volume: "large", access_level: "read_write", regulatory_exposure: "high",
  regulatory_breach_notification: false, ai_involvement: "none", ai_autonomy: "none", hosting_model: "saas", fourth_party_exposure: "moderate",
};

const as = (key: string) => ({
  post: (p: string, b: unknown) => request(app).post(p).set("X-Api-Key", key).send(b as object),
  get: (p: string) => request(app).get(p).set("X-Api-Key", key),
});

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL; if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env.DATABASE_URL = url; process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED = "true";
  pool = new Pool({ connectionString: url, ssl: false });
  app = express(); app.use(express.json()); app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));

  vendorA = await seedVendor(pool, seed.orgA.id, { name: "VO7 Payments" });
  vendorA2 = await seedVendor(pool, seed.orgA.id, { name: "VO7 Other vendor" });
  orgBVendor = await seedVendor(pool, seed.orgB.id, { name: "VO7 Org B vendor" });
  await seedUser(pool, seed.orgA.id, { email: "vo7-a@example.com" });

  // A framework with a core requirement so scoping has something to place.
  const fw = await pool.query<{ id: string }>(`INSERT INTO frameworks (organization_id, name, version) VALUES ($1, 'VO7 fw', '1.0') RETURNING id`, [seed.orgA.id]);
  await pool.query(
    `INSERT INTO requirements (framework_id, reference_id, title, description, scope_tags, scope_tags_source, scope_tags_at)
     VALUES ($1, 'VO7-1', 'Security policy', 'guidance', ARRAY['core']::text[], 'curated', NOW())`, [fw.rows[0]!.id]);

  const A = as(seed.orgA.apiKey);
  const r1 = await A.post(`/api/vendors/${vendorA}/relationships`, { name: "Card processing" });
  classified = r1.body.relationship.id;
  expect((await A.post(`/api/vendors/${vendorA}/relationships/${classified}/intake`, PAYMENT_PROCESSOR)).status).toBe(201);
  const r2 = await A.post(`/api/vendors/${vendorA}/relationships`, { name: "Not yet assessed" });
  unclassified = r2.body.relationship.id;
  const rb = await as(seed.orgB.apiKey).post(`/api/vendors/${orgBVendor}/relationships`, { name: "B rel" });
  orgBRel = rb.body.relationship.id;
}, 180_000);

afterAll(async () => { delete process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED; await pool?.end(); });

describe("VO-7 — an engagement from a classified relationship", () => {
  let engagement: string;

  it("inherits the v2 classification and the JOINT tier, stamped 2.0.0, without asking the intake again", async () => {
    const res = await as(seed.orgA.apiKey).post(`/api/vendor-engagements`, { vendor_id: vendorA, relationship_id: classified, engagement_type: "initial", title: "From relationship" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    engagement = res.body.id;
    const row = await pool.query(`SELECT * FROM vendor_engagements WHERE id = $1`, [engagement]);
    const e = row.rows[0];
    expect(e.relationship_id).toBe(classified);
    expect(e.methodology_version).toBe("2.0.0");
    expect(e.inherent_score).toBe(70); expect(e.inherent_rating).toBe("High");
    // The JOINT tier: Criticality Critical x IR High = tier_1. v1's
    // inherent-only tierForBand(High) would have said tier_2 — this is the
    // proof the peer model flowed into the engagement.
    expect(e.assessment_tier).toBe("tier_1_critical");
    expect(e.inherent_basis.method).toBe("vendor_inherent_v2");
  });
  it("populates the v1-vocabulary fact columns through the bridge (scoping, not scoring)", async () => {
    const e = (await pool.query(`SELECT operational_dependency, business_criticality, recoverability, concentration_snapshot, data_sensitivity FROM vendor_engagements WHERE id = $1`, [engagement])).rows[0];
    expect(e.operational_dependency).toBe("critical");   // essential -> critical
    expect(e.business_criticality).toBe("critical");     // derived band Critical -> critical
    expect(e.recoverability).toBe("none");               // lt_24_hours -> none
    expect(e.concentration_snapshot).toBe("moderate");
    expect(e.data_sensitivity).toBe("restricted");
  });
  it("scopes through the EXISTING resolver unchanged and produces scope items", async () => {
    const res = await as(seed.orgA.apiKey).post(`/api/vendor-engagements/${engagement}/scope`, {});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = await pool.query(`SELECT count(*)::int AS n FROM vendor_engagement_scope_items WHERE engagement_id = $1`, [engagement]);
    expect(items.rows[0].n).toBeGreaterThan(0);
    const e = (await pool.query(`SELECT assessment_tier, methodology_version, inherent_score FROM vendor_engagements WHERE id = $1`, [engagement])).rows[0];
    expect(e.assessment_tier).toBe("tier_1_critical");   // scoping did not rescore or re-tier
    expect(e.methodology_version).toBe("2.0.0");
    expect(e.inherent_score).toBe(70);
  });
  it("the engagement read surfaces relationship_id beside the manual vendor criticality", async () => {
    const res = await as(seed.orgA.apiKey).get(`/api/vendor-engagements/${engagement}`);
    expect(res.status).toBe(200);
    expect(res.body.relationship_id ?? res.body.engagement?.relationship_id).toBe(classified);
  });
  it("VO-11: the engagement read carries the relationship's STORED classification — read, not recalculated", async () => {
    const res = await as(seed.orgA.apiKey).get(`/api/vendor-engagements/${engagement}`);
    expect(res.status).toBe(200);
    const stored = (await pool.query(`SELECT * FROM vendor_relationships WHERE id = $1`, [classified])).rows[0];
    const r = res.body.relationship;
    expect(r).not.toBeNull();
    expect(r).toMatchObject({
      id: classified, name: "Card processing", is_primary: true,
      criticality_score: stored.criticality_score, criticality_band: stored.criticality_band,
      inherent_score: stored.inherent_score, inherent_band: stored.inherent_band,
      assessment_tier: stored.assessment_tier, tier_calculated_minimum: stored.tier_calculated_minimum,
      criticality_methodology_version: "1.0.0", inherent_methodology_version: "2.0.0",
    });
    // A customer can tell which relationship this engagement assesses without the API.
    expect(r.classification_computed_at).not.toBeNull();
    // No basis JSON here — the vendor page owns the full "Why?"; this is context.
    expect(r.criticality_basis).toBeUndefined();
  });
});

describe("VO-7 — refusals", () => {
  it("an intake_required relationship cannot open an engagement — nothing is manufactured", async () => {
    const res = await as(seed.orgA.apiKey).post(`/api/vendor-engagements`, { vendor_id: vendorA, relationship_id: unclassified, engagement_type: "initial" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("intake_required");
  });
  it("a relationship under a DIFFERENT vendor of the same org is not found", async () => {
    const res = await as(seed.orgA.apiKey).post(`/api/vendor-engagements`, { vendor_id: vendorA2, relationship_id: classified, engagement_type: "initial" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("relationship_not_found");
  });
  it("org B's relationship is not addressable from org A, and vice versa", async () => {
    expect((await as(seed.orgA.apiKey).post(`/api/vendor-engagements`, { vendor_id: vendorA, relationship_id: orgBRel, engagement_type: "initial" })).status).toBe(404);
    expect((await as(seed.orgB.apiKey).post(`/api/vendor-engagements`, { vendor_id: orgBVendor, relationship_id: classified, engagement_type: "initial" })).status).toBe(404);
  });
});

describe("VO-7 — the v1 path is unchanged", () => {
  it("a flat twelve-field intake still opens a 1.0.0 engagement scored by v1, with no relationship", async () => {
    const res = await as(seed.orgA.apiKey).post(`/api/vendor-engagements`, { ...V1_INTAKE, vendor_id: vendorA, engagement_type: "initial", title: "v1 path" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const e = (await pool.query(`SELECT relationship_id, methodology_version, inherent_basis FROM vendor_engagements WHERE id = $1`, [res.body.id])).rows[0];
    expect(e.relationship_id).toBeNull();
    expect(e.methodology_version).toBe("1.0.0");
    expect(e.inherent_basis.method).toBe("vendor_inherent_v1");
    // VO-11: a pre-2.0 engagement is honestly unlinked — relationship is null, never invented.
    const read = await as(seed.orgA.apiKey).get(`/api/vendor-engagements/${res.body.id}`);
    expect(read.body.relationship).toBeNull();
  });
});
