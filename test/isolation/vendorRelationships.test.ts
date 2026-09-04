/**
 * vendorRelationships.test.ts — Vendor Onboarding 2.0 VO-6: the relationship
 * grain, factual intake, and the deterministic classification it produces.
 *
 * Pins the product behaviour, not incidental coverage: multi-relationship
 * vendors, the intake_required transition state, provenance (a classification
 * names the exact intake version that produced it), reproducibility (the
 * stored basis equals a fresh run of the engines on the stored facts),
 * policy raise-only, the append-only guard, and tenant separation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { classifyRelationship } from "../../src/api/lib/vendorRisk/relationshipClassification.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;
let vendorA: string;
let vendorB: string;
let orgBVendor: string;

const PAYMENT_PROCESSOR = {
  max_tolerable_disruption: "lt_24_hours", operational_dependency: "essential", business_reach: "enterprise_wide",
  substitutability: "replaceable_months", process_coupling: "in_critical_path", concentration: "moderate",
  data_sensitivity: "restricted", data_volume: "large", access_level: "read_write", regulatory_exposure: "high",
  regulatory_breach_notification: false, ai_involvement: "none", ai_autonomy: "none", hosting_model: "saas", fourth_party_exposure: "moderate",
};
const OFFICE_CATERING = {
  max_tolerable_disruption: "gt_1_month", operational_dependency: "incidental", business_reach: "single_team",
  substitutability: "interchangeable", process_coupling: "peripheral", concentration: "none",
  data_sensitivity: "none", data_volume: "minimal", access_level: "none", regulatory_exposure: "none",
  regulatory_breach_notification: false, ai_involvement: "none", ai_autonomy: "none", hosting_model: "saas", fourth_party_exposure: "none",
};
const MANAGED_DB = {
  ...PAYMENT_PROCESSOR, business_reach: "multi_function", access_level: "admin", hosting_model: "private_cloud", fourth_party_exposure: "low",
};

const api = (key: string) => ({
  list: (v: string) => request(app).get(`/api/vendors/${v}/relationships`).set("X-Api-Key", key),
  create: (v: string, body: Record<string, unknown>) => request(app).post(`/api/vendors/${v}/relationships`).set("X-Api-Key", key).send(body),
  get: (v: string, r: string) => request(app).get(`/api/vendors/${v}/relationships/${r}`).set("X-Api-Key", key),
  patch: (v: string, r: string, body: Record<string, unknown>) => request(app).patch(`/api/vendors/${v}/relationships/${r}`).set("X-Api-Key", key).send(body),
  intake: (v: string, r: string, body: Record<string, unknown>) => request(app).post(`/api/vendors/${v}/relationships/${r}/intake`).set("X-Api-Key", key).send(body),
  history: (v: string, r: string) => request(app).get(`/api/vendors/${v}/relationships/${r}/intake`).set("X-Api-Key", key),
});

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env.DATABASE_URL = url;
  process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED = "true";
  pool = new Pool({ connectionString: url, ssl: false });
  vendorA = await seedVendor(pool, seed.orgA.id, { name: "Acme Payments", criticality: "high" });
  vendorB = await seedVendor(pool, seed.orgA.id, { name: "Acme Catering" });
  orgBVendor = await seedVendor(pool, seed.orgB.id, { name: "Org B Supplier" });
  app = express();
  app.use(express.json());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
}, 180_000);

afterAll(async () => {
  delete process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED;
  await pool?.end();
});

describe("VO-2/6 — a vendor has relationships, and the first is the primary", () => {
  let first: string;
  let second: string;

  it("creates the first relationship as primary, in the intake_required state", async () => {
    const res = await api(seed.orgA.apiKey).create(vendorA, { name: "Card processing", service_description: "Online card acquiring" });
    expect(res.status).toBe(201);
    first = res.body.relationship.id;
    expect(res.body.relationship).toMatchObject({ name: "Card processing", is_primary: true, status: "active", classification_state: "intake_required", assessment_tier: null, criticality_band: null, inherent_band: null });
  });
  it("a second relationship is NOT primary; the vendor now has two (multi-relationship)", async () => {
    const res = await api(seed.orgA.apiKey).create(vendorA, { name: "Payroll disbursement" });
    expect(res.status).toBe(201);
    second = res.body.relationship.id;
    expect(res.body.relationship.is_primary).toBe(false);
    const list = await api(seed.orgA.apiKey).list(vendorA);
    expect(list.body.count).toBe(2);
    expect(list.body.intake_required_count).toBe(2);
  });
  it("an explicit is_primary demotes the current primary in the same transaction", async () => {
    const res = await api(seed.orgA.apiKey).patch(vendorA, second, { name: "Payroll disbursement (primary)" });
    expect(res.status).toBe(200);
    const promote = await api(seed.orgA.apiKey).create(vendorA, { name: "Treasury API", is_primary: true });
    expect(promote.status).toBe(201);
    const list = await api(seed.orgA.apiKey).list(vendorA);
    const primaries = list.body.relationships.filter((r: { is_primary: boolean }) => r.is_primary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].name).toBe("Treasury API");
    expect(list.body.relationships.find((r: { id: string }) => r.id === first).is_primary).toBe(false);
  });
  it("refuses a duplicate name for the same vendor", async () => {
    const res = await api(seed.orgA.apiKey).create(vendorA, { name: "Treasury API" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("relationship_already_exists");
  });
  it("does not manufacture a classification: nothing about the manual vendors.criticality reaches the relationship", async () => {
    const res = await api(seed.orgA.apiKey).get(vendorA, first);
    expect(res.body.relationship.classification_state).toBe("intake_required");
    expect(res.body.relationship.criticality_score).toBeNull();
  });
});

describe("VO-6 — factual intake produces the deterministic classification", () => {
  let rel: string;
  let intakeV1: string;

  beforeAll(async () => {
    const res = await api(seed.orgA.apiKey).create(vendorB, { name: "Payments (test)" });
    rel = res.body.relationship.id;
  });

  it("refuses incomplete intake and names every missing field", async () => {
    const res = await api(seed.orgA.apiKey).intake(vendorB, rel, { data_sensitivity: "restricted" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("incomplete_intake");
    expect(res.body.missing).toContain("max_tolerable_disruption");
    expect(res.body.missing).toContain("regulatory_breach_notification");
  });
  it("refuses an invalid level rather than scoring it", async () => {
    const res = await api(seed.orgA.apiKey).intake(vendorB, rel, { ...PAYMENT_PROCESSOR, substitutability: "easy" });
    expect(res.status).toBe(400);
    expect(res.body.invalid).toEqual(["substitutability"]);
  });
  it("refuses autonomy without AI involvement — a contradiction, not a fact", async () => {
    const res = await api(seed.orgA.apiKey).intake(vendorB, rel, { ...PAYMENT_PROCESSOR, ai_involvement: "none", ai_autonomy: "autonomous_consequential" });
    expect(res.status).toBe(400);
    expect(res.body.invalid).toContain("ai_autonomy");
  });
  it("Payment processor: Criticality 90/Critical, IR 70/High, tier_1 — the owner-approved scenario", async () => {
    const res = await api(seed.orgA.apiKey).intake(vendorB, rel, PAYMENT_PROCESSOR);
    expect(res.status).toBe(201);
    intakeV1 = res.body.intake.id;
    expect(res.body.intake.version).toBe(1);
    const r = res.body.relationship;
    expect(r.classification_state).toBe("classified");
    expect(r.criticality_score).toBe(90); expect(r.criticality_band).toBe("Critical");
    expect(r.criticality_basis.adjustments.map((a: { rule_id: string }) => a.rule_id)).toEqual(["CR2"]);
    expect(r.inherent_score).toBe(70); expect(r.inherent_band).toBe("High");
    expect(r.assessment_tier).toBe("tier_1_critical");
    expect(r.tier_calculated_minimum).toBe("tier_1_critical");
    expect(r.criticality_methodology_version).toBe("1.0.0");
    expect(r.inherent_methodology_version).toBe("2.0.0");
    expect(r.classification_intake_id).toBe(intakeV1);
    expect(r.classification_computed_at).not.toBeNull();
  });
  it("PROVENANCE + REPRODUCIBILITY: the stored basis equals a fresh run of the engines on the stored intake", async () => {
    const stored = await pool.query(`SELECT * FROM vendor_relationship_intake WHERE id = $1`, [intakeV1]);
    const relRow = await pool.query(`SELECT criticality_basis, inherent_basis, tier_basis, policy_minimum_tier FROM vendor_relationships WHERE id = $1`, [rel]);
    const fresh = classifyRelationship(stored.rows[0], relRow.rows[0].policy_minimum_tier);
    expect(relRow.rows[0].criticality_basis).toEqual(JSON.parse(JSON.stringify(fresh.criticality.basis)));
    expect(relRow.rows[0].inherent_basis).toEqual(JSON.parse(JSON.stringify(fresh.inherent.basis)));
    expect(relRow.rows[0].tier_basis).toEqual(JSON.parse(JSON.stringify(fresh.tier.basis)));
  });
  it("a second intake is version 2, re-classifies, and provenance moves to it", async () => {
    const res = await api(seed.orgA.apiKey).intake(vendorB, rel, OFFICE_CATERING);
    expect(res.status).toBe(201);
    expect(res.body.intake.version).toBe(2);
    expect(res.body.relationship.assessment_tier).toBe("tier_4_low");
    expect(res.body.relationship.criticality_score).toBe(10);
    expect(res.body.relationship.classification_intake_id).toBe(res.body.intake.id);
    const h = await api(seed.orgA.apiKey).history(vendorB, rel);
    expect(h.body.count).toBe(2);
    expect(h.body.current_version).toBe(2);
    expect(h.body.intake[1].id).toBe(intakeV1); // v1 is still there, untouched
  });
  it("APPEND-ONLY: the intake history cannot be rewritten or deleted (shared WORM guard)", async () => {
    await expect(pool.query(`UPDATE vendor_relationship_intake SET data_sensitivity = 'none' WHERE id = $1`, [intakeV1])).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM vendor_relationship_intake WHERE id = $1`, [intakeV1])).rejects.toThrow(/append-only/);
  });
  it("E1b fires as a TIER floor from raw facts, not from a derived band", async () => {
    const r2 = await api(seed.orgA.apiKey).create(vendorB, { name: "Managed database" });
    const res = await api(seed.orgA.apiKey).intake(vendorB, r2.body.relationship.id, MANAGED_DB);
    expect(res.status).toBe(201);
    expect(res.body.relationship.inherent_band).toBe("High");
    expect(res.body.relationship.assessment_tier).toBe("tier_1_critical");
    expect(res.body.relationship.tier_basis.adjustments.map((a: { rule_id: string }) => a.rule_id)).toContain("E1b");
  });
});

describe("VO-5/6 — customer policy raises, never lowers (M4)", () => {
  let rel: string;
  beforeAll(async () => {
    const res = await api(seed.orgA.apiKey).create(vendorB, { name: "Snacks" });
    rel = res.body.relationship.id;
    await api(seed.orgA.apiKey).intake(vendorB, rel, OFFICE_CATERING);
  });
  it("raising policy on a tier_4 relationship re-resolves ONLY the tier, from the same intake", async () => {
    const before = await api(seed.orgA.apiKey).get(vendorB, rel);
    const res = await api(seed.orgA.apiKey).patch(vendorB, rel, { policy_minimum_tier: "tier_2_high" });
    expect(res.status).toBe(200);
    const r = res.body.relationship;
    expect(r.assessment_tier).toBe("tier_2_high");
    expect(r.tier_calculated_minimum).toBe("tier_4_low");
    expect(r.tier_basis.policy).toMatchObject({ requested: "tier_2_high", applied: true });
    expect(r.classification_intake_id).toBe(before.body.relationship.classification_intake_id);
    expect(r.criticality_basis).toEqual(before.body.relationship.criticality_basis);
  });
  it("policy can never lower the calculated minimum, and the refusal is recorded", async () => {
    const strong = await api(seed.orgA.apiKey).create(vendorB, { name: "Card gateway" });
    await api(seed.orgA.apiKey).intake(vendorB, strong.body.relationship.id, PAYMENT_PROCESSOR);
    const res = await api(seed.orgA.apiKey).patch(vendorB, strong.body.relationship.id, { policy_minimum_tier: "tier_4_low" });
    expect(res.status).toBe(200);
    expect(res.body.relationship.assessment_tier).toBe("tier_1_critical");
    expect(res.body.relationship.tier_basis.policy).toMatchObject({ requested: "tier_4_low", applied: false });
    expect(res.body.relationship.tier_basis.policy.reason).toMatch(/never lower/);
  });
  it("rejects a policy value outside the tier set", async () => {
    const res = await api(seed.orgA.apiKey).patch(vendorB, rel, { policy_minimum_tier: "tier_0" });
    expect(res.status).toBe(400);
  });
});

describe("VO-6 — tenant separation", () => {
  let relA: string;
  beforeAll(async () => {
    const res = await api(seed.orgA.apiKey).create(vendorA, { name: "Cross-tenant probe target" });
    relA = res.body.relationship.id;
  });
  it("org B cannot list, read, create, patch, or intake against org A's vendor — all 404, never 403", async () => {
    const b = api(seed.orgB.apiKey);
    expect((await b.list(vendorA)).status).toBe(404);
    expect((await b.get(vendorA, relA)).status).toBe(404);
    expect((await b.create(vendorA, { name: "x" })).status).toBe(404);
    expect((await b.patch(vendorA, relA, { name: "x" })).status).toBe(404);
    expect((await b.intake(vendorA, relA, PAYMENT_PROCESSOR)).status).toBe(404);
    expect((await b.history(vendorA, relA)).status).toBe(404);
  });
  it("a relationship id under the WRONG vendor of the same org is not found (scoped to vendor, not just org)", async () => {
    expect((await api(seed.orgA.apiKey).get(vendorB, relA)).status).toBe(404);
    expect((await api(seed.orgA.apiKey).intake(vendorB, relA, PAYMENT_PROCESSOR)).status).toBe(404);
  });
  it("org B's own vendor works normally (the gate is scoping, not a block)", async () => {
    const res = await api(seed.orgB.apiKey).create(orgBVendor, { name: "B service" });
    expect(res.status).toBe(201);
  });
  it("RLS: the relationship rows are invisible without an org context on the request role", async () => {
    // Direct SQL as the request role with no app.current_org_id set sees nothing.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', '', true)");
      const r = await client.query(`SELECT count(*)::int AS n FROM vendor_relationships`);
      expect(r.rows[0].n).toBe(0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
  it("is dark in PRODUCTION posture when the flag is off — a bare 404 before auth, not a 401", async () => {
    // vendorAssuranceEnabled() is on by default outside production, so the
    // only honest way to test the production dark posture is to model
    // production: NODE_ENV=production with the flag unset. The gate is FIRST
    // in GUARDS, so the 404 returns before any auth middleware runs — which
    // is exactly the property under test (a 401 would advertise the route).
    const prevEnv = process.env.NODE_ENV;
    delete process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED;
    process.env.NODE_ENV = "production";
    try {
      const res = await request(app).get(`/api/vendors/${vendorA}/relationships`).set("X-Api-Key", seed.orgA.apiKey);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "not_found" });
    } finally {
      process.env.NODE_ENV = prevEnv;
      process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED = "true";
    }
  });
});
