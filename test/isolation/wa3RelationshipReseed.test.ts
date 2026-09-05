/**
 * wa3RelationshipReseed.test.ts — WA-3 / R8 (owner ruling 2026-09-05), against
 * real Postgres.
 *
 * R8: a relationship re-intake must never silently mutate the determination or
 * composition basis of an already-issued engagement. A PRE-ISSUE engagement may
 * be explicitly rebased onto the relationship's current determination, with
 * provenance.
 *
 * Three affordances, proven here end to end through the real routes:
 *
 *   R8-3  the staleness signal is DERIVED — never a stored flag — from the
 *         seventeen values that constitute the relationship-derived basis, and
 *         from nothing else. A rename must not make an assessment look stale.
 *   R8-1  the reseed is pre-issue only, writes the copied basis and nothing
 *         else, and does NOT advance the assessment: the analyst still runs the
 *         composition and sees the resulting question set before it becomes the
 *         operative scope.
 *   R8-2  every reseed leaves an append-only provenance row carrying prior
 *         basis, new basis, changed fields, reason, actor and time.
 *
 * Real Content-Type gate in front (the VA-E2E-1 rule).
 */

// Set BEFORE the route/jwt modules are imported: signJwt reads the secret at
// call time but the auth middleware refuses to build without one.
process.env["JWT_SECRET"] ??= "test-jwt-secret-for-wa3-relationship-reseed";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, seedUser, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { enforceJsonContentType } from "../../src/api/lib/contentTypeAllowlist.js";
import { signJwt } from "../../src/api/lib/jwt.js";
import { recordAllCurrentConsents } from "../../src/api/lib/legalConsent.js";
import { RELATIONSHIP_BASIS_FIELDS } from "../../src/api/lib/vendorRisk/relationshipBasis.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

/** A payments relationship: Criticality Critical x IR High -> tier_1_critical. */
const PAYMENT_PROCESSOR = {
  max_tolerable_disruption: "lt_24_hours", operational_dependency: "essential",
  business_reach: "enterprise_wide", substitutability: "replaceable_months",
  process_coupling: "in_critical_path", concentration: "moderate",
  data_sensitivity: "restricted", data_volume: "large", access_level: "read_write",
  regulatory_exposure: "high", regulatory_breach_notification: false,
  ai_involvement: "none", ai_autonomy: "none", hosting_model: "saas",
  fourth_party_exposure: "moderate",
};

/** The same relationship, de-risked. Moves facts AND the tier. */
const BENIGN = {
  max_tolerable_disruption: "gt_1_month", operational_dependency: "incidental",
  business_reach: "single_team", substitutability: "interchangeable",
  process_coupling: "peripheral", concentration: "none",
  data_sensitivity: "none", data_volume: "minimal", access_level: "none",
  regulatory_exposure: "none", regulatory_breach_notification: false,
  ai_involvement: "none", ai_autonomy: "none", hosting_model: "on_prem",
  fourth_party_exposure: "none",
  change_reason: "Scope reduced to a read-only reporting feed after the migration.",
};

/**
 * Every call carries a real user session. A reseed is recorded against the
 * PERSON who decided it, so the route refuses an API key outright — asserted
 * directly in the guards arm below.
 */
const as = (token: string) => ({
  post: (p: string, b: unknown) =>
    request(app).post(p).set("Authorization", `Bearer ${token}`).send(b as object),
  patch: (p: string, b: unknown) =>
    request(app).patch(p).set("Authorization", `Bearer ${token}`).send(b as object),
  get: (p: string) => request(app).get(p).set("Authorization", `Bearer ${token}`),
});
let A: ReturnType<typeof as>;
let B: ReturnType<typeof as>;
let orgAApiKey: string;


/** A fresh classified relationship + a draft engagement opened from it. */
async function freshEngagement(label: string): Promise<{ engagement: string; relationship: string }> {
  const vendor = await seedVendor(pool, seed.orgA.id, { name: `${label} vendor` });
  const rel = await A.post(`/api/vendors/${vendor}/relationships`, { name: `${label} service` });
  const relationshipId = rel.body.relationship.id as string;
  expect((await A.post(`/api/vendors/${vendor}/relationships/${relationshipId}/intake`, PAYMENT_PROCESSOR)).status).toBe(201);
  const eng = await A.post(`/api/vendor-engagements`, {
    vendor_id: vendor, relationship_id: relationshipId, engagement_type: "initial", title: label,
  });
  expect(eng.status, JSON.stringify(eng.body)).toBe(201);
  return { engagement: eng.body.id as string, relationship: relationshipId };
}

/** Re-declare the relationship's facts, which reclassifies it. */
async function reIntake(vendorPath: string, relationshipId: string, facts: Record<string, unknown>): Promise<void> {
  const res = await A.post(`/api/vendors/${vendorPath}/relationships/${relationshipId}/intake`, facts);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

const determinationOf = async (engagementId: string) =>
  (await A.get(`/api/vendor-engagements/${engagementId}`)).body.relationship_determination;

const setStatus = (engagementId: string, status: string) =>
  pool.query(`UPDATE vendor_engagements SET status = $2 WHERE id = $1`, [engagementId, status]);

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env.DATABASE_URL = url;
  process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED = "true";
  pool = new Pool({ connectionString: url, ssl: false });
  app = express();
  app.use(express.json());
  app.use(enforceJsonContentType);
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));

  orgAApiKey = seed.orgA.apiKey;
  const uA = await seedUser(pool, seed.orgA.id, { email: "wa3-r8-a@example.com" });
  const uB = await seedUser(pool, seed.orgB.id, { email: "wa3-r8-b@example.com" });
  await recordAllCurrentConsents(pool, { userId: uA.id, organizationId: seed.orgA.id, consentMethod: "admin_recorded" });
  await recordAllCurrentConsents(pool, { userId: uB.id, organizationId: seed.orgB.id, consentMethod: "admin_recorded" });
  A = as(signJwt(uA.id, seed.orgA.id, "admin"));
  B = as(signJwt(uB.id, seed.orgB.id, "admin"));

  // Something for the resolver to place, so a composition is non-empty.
  const fw = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version) VALUES ($1, 'R8 fw', '1.0') RETURNING id`,
    [seed.orgA.id]
  );
  await pool.query(
    `INSERT INTO requirements (framework_id, reference_id, title, description, scope_tags, scope_tags_source, scope_tags_at)
     VALUES ($1, 'R8-1', 'Security policy', 'guidance', ARRAY['core']::text[], 'curated', NOW())`,
    [fw.rows[0]!.id]
  );

}, 180_000);

afterAll(async () => {
  delete process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED;
  await pool?.end();
});

/* ═══════════════════════════════════════════════════════════════════════════
   R8-3 — the derived staleness signal
   ═══════════════════════════════════════════════════════════════════════════ */
describe("R8-3 — staleness is derived from the basis, and only from the basis", () => {
  it("(1) an engagement whose relationship has not moved is NOT stale", async () => {
    const { engagement } = await freshEngagement("r8-fresh");
    const d = await determinationOf(engagement);
    expect(d).not.toBeNull();
    expect(d.stale).toBe(false);
    expect(d.changed_fields).toEqual([]);
  });

  it("(4) renaming the relationship does NOT make the engagement stale", async () => {
    const { engagement, relationship: rel } = await freshEngagement("r8-rename");
    // Non-basis metadata, reachable through the very same comparison path.
    await pool.query(
      `UPDATE vendor_relationships SET name = $2, service_description = 'Rewritten description.' WHERE id = $1`,
      [rel, "Renamed after the reorganization"]
    );
    const d = await determinationOf(engagement);
    expect(d.stale).toBe(false);
    expect(d.changed_fields).toEqual([]);
  });

  it("(2)(3) a real fact change makes it stale and names the fields, tier included", async () => {
    const vendor = await seedVendor(pool, seed.orgA.id, { name: "r8-stale vendor" });
    const rel = await A.post(`/api/vendors/${vendor}/relationships`, { name: "r8-stale service" });
    const relId = rel.body.relationship.id as string;
    await reIntake(vendor, relId, PAYMENT_PROCESSOR);
    const eng = await A.post(`/api/vendor-engagements`, {
      vendor_id: vendor, relationship_id: relId, engagement_type: "initial", title: "r8-stale",
    });
    const engagement = eng.body.id as string;

    await reIntake(vendor, relId, BENIGN);

    const d = await determinationOf(engagement);
    expect(d.stale).toBe(true);
    const fields = d.changed_fields.map((c: { field: string }) => c.field);
    // Facts moved...
    expect(fields).toContain("data_sensitivity");
    expect(fields).toContain("access_level");
    // ...and so did the determination the tier rides on.
    expect(fields).toContain("assessment_tier");
    const tier = d.changed_fields.find((c: { field: string }) => c.field === "assessment_tier");
    expect(tier.engagement_value).toBe("tier_1_critical");
    expect(tier.relationship_value).not.toBe("tier_1_critical");
    // Every named field is one of the seventeen and nothing else.
    for (const f of fields) expect(RELATIONSHIP_BASIS_FIELDS).toContain(f);
  });

  it("the comparison inventory is exactly seventeen fields, and excludes the derived envelope", () => {
    expect(RELATIONSHIP_BASIS_FIELDS).toHaveLength(17);
    expect(RELATIONSHIP_BASIS_FIELDS).not.toContain("inherent_basis");
    expect(RELATIONSHIP_BASIS_FIELDS).not.toContain("relationship_id");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   R8-1 — the reseed
   ═══════════════════════════════════════════════════════════════════════════ */
describe("R8-1 — reseed is pre-issue only, and changes only the copied basis", () => {
  it("(9) refuses a reason shorter than ten characters", async () => {
    const { engagement, relationship: rel } = await freshEngagement("r8-reason");
    await reIntake((await pool.query(`SELECT vendor_id FROM vendor_relationships WHERE id=$1`, [rel])).rows[0].vendor_id, rel, BENIGN);
    const res = await A.post(`/api/vendor-engagements/${engagement}/reseed-from-relationship`, { reason: "too short" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("reason_required");
    // Nothing recorded, nothing moved.
    const n = await pool.query(`SELECT COUNT(*)::int AS n FROM vendor_engagement_relationship_reseeds WHERE engagement_id = $1`, [engagement]);
    expect(n.rows[0].n).toBe(0);
    expect((await determinationOf(engagement)).stale).toBe(true);
  });

  it("(5) is allowed in every scope-mutable state", async () => {
    for (const status of ["draft", "scoping", "scoped"]) {
      const { engagement, relationship: rel } = await freshEngagement(`r8-mutable-${status}`);
      const vendorId = (await pool.query(`SELECT vendor_id FROM vendor_relationships WHERE id=$1`, [rel])).rows[0].vendor_id;
      await reIntake(vendorId, rel, BENIGN);
      await setStatus(engagement, status);
      const res = await A.post(`/api/vendor-engagements/${engagement}/reseed-from-relationship`, {
        reason: `Rebasing a ${status} engagement onto the corrected facts.`,
      });
      expect(res.status, `${status}: ${JSON.stringify(res.body)}`).toBe(200);
    }
  });

  it("(6) is refused once the engagement has been issued, and says what to do instead", async () => {
    for (const status of ["issued", "in_progress", "submitted", "analysis_complete", "decided", "closed"]) {
      const { engagement, relationship: rel } = await freshEngagement(`r8-locked-${status}`);
      const vendorId = (await pool.query(`SELECT vendor_id FROM vendor_relationships WHERE id=$1`, [rel])).rows[0].vendor_id;
      await reIntake(vendorId, rel, BENIGN);
      const before = (await pool.query(`SELECT assessment_tier, data_sensitivity FROM vendor_engagements WHERE id=$1`, [engagement])).rows[0];
      await setStatus(engagement, status);

      const res = await A.post(`/api/vendor-engagements/${engagement}/reseed-from-relationship`, {
        reason: "Attempting to rebase an engagement that is already under way.",
      });
      expect(res.status, `${status} must refuse`).toBe(409);
      expect(res.body.error).toBe("engagement_basis_locked");
      expect(res.body.message).toMatch(/open a new engagement/i);

      // The historical basis is untouched.
      const after = (await pool.query(`SELECT assessment_tier, data_sensitivity FROM vendor_engagements WHERE id=$1`, [engagement])).rows[0];
      expect(after).toEqual(before);
      const n = await pool.query(`SELECT COUNT(*)::int AS n FROM vendor_engagement_relationship_reseeds WHERE engagement_id = $1`, [engagement]);
      expect(n.rows[0].n).toBe(0);
    }
  });

  it("(7)(8)(10)(11) applies the basis, records provenance, and does NOT resolve scope", async () => {
    const { engagement, relationship: rel } = await freshEngagement("r8-apply");
    const vendorId = (await pool.query(`SELECT vendor_id FROM vendor_relationships WHERE id=$1`, [rel])).rows[0].vendor_id;

    // Give it a composition first, so we can prove the reseed leaves it alone.
    expect((await A.post(`/api/vendor-engagements/${engagement}/scope`, {})).status).toBe(200);
    const scopeBefore = (await pool.query(
      `SELECT id, requirement_id, depth, mandatory FROM vendor_engagement_scope_items WHERE engagement_id=$1 ORDER BY id`,
      [engagement]
    )).rows;
    expect(scopeBefore.length).toBeGreaterThan(0);

    await reIntake(vendorId, rel, BENIGN);
    // Composing moved it draft -> scoped. The reseed must leave it exactly
    // there: rebasing the basis is not an advancement of the assessment.
    const statusBefore = (await pool.query(`SELECT status FROM vendor_engagements WHERE id=$1`, [engagement])).rows[0].status;
    expect(statusBefore).toBe("scoped");

    const reason = "Rebasing onto the reduced scope agreed with the service owner.";
    const res = await A.post(`/api/vendor-engagements/${engagement}/reseed-from-relationship`, { reason });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // (7) the copied basis moved to the relationship's current determination
    const e = (await pool.query(`SELECT * FROM vendor_engagements WHERE id=$1`, [engagement])).rows[0];
    expect(e.data_sensitivity).toBe("none");
    expect(e.access_level).toBe("none");
    expect(e.assessment_tier).not.toBe("tier_1_critical");
    expect(e.status).toBe(statusBefore);        // (8) lifecycle not advanced

    // (8) the composition is NOT re-run: the analyst does that, and sees it first
    const scopeAfter = (await pool.query(
      `SELECT id, requirement_id, depth, mandatory FROM vendor_engagement_scope_items WHERE engagement_id=$1 ORDER BY id`,
      [engagement]
    )).rows;
    expect(scopeAfter).toEqual(scopeBefore);
    expect(res.body.next_step.action).toBe("resolve_scope");

    // (11) provenance carries all six required elements
    const p = (await pool.query(`SELECT * FROM vendor_engagement_relationship_reseeds WHERE engagement_id=$1`, [engagement])).rows;
    expect(p).toHaveLength(1);
    expect(p[0].prior_basis.assessment_tier).toBe("tier_1_critical");
    expect(p[0].new_basis.assessment_tier).toBe(e.assessment_tier);
    expect(p[0].changed_fields).toContain("assessment_tier");
    expect(p[0].changed_fields).toContain("data_sensitivity");
    expect(p[0].reason).toBe(reason);
    expect(p[0].reseeded_by_user_id).not.toBeNull();
    expect(p[0].created_at).toBeInstanceOf(Date);
    expect(p[0].relationship_id).toBe(rel);

    // (17) after the reseed the analyst can review the resulting composition
    // BEFORE it becomes operative: the preview is the ordinary scope call, and
    // it is the analyst's act, not a side effect of the reseed.
    const recomposed = await A.post(`/api/vendor-engagements/${engagement}/scope`, {});
    expect(recomposed.status).toBe(200);
    expect((await determinationOf(engagement)).stale).toBe(false);
  });

  it("refuses a reseed that would change nothing, so provenance never records a no-op", async () => {
    const { engagement } = await freshEngagement("r8-noop");
    const res = await A.post(`/api/vendor-engagements/${engagement}/reseed-from-relationship`, {
      reason: "Nothing has actually changed on this relationship.",
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("basis_current");
    const n = await pool.query(`SELECT COUNT(*)::int AS n FROM vendor_engagement_relationship_reseeds WHERE engagement_id=$1`, [engagement]);
    expect(n.rows[0].n).toBe(0);
  });

  it("(15) leaves vendor responses, evidence and findings untouched", async () => {
    const { engagement, relationship: rel } = await freshEngagement("r8-preserve");
    const vendorId = (await pool.query(`SELECT vendor_id FROM vendor_relationships WHERE id=$1`, [rel])).rows[0].vendor_id;
    expect((await A.post(`/api/vendor-engagements/${engagement}/scope`, {})).status).toBe(200);
    const requirementId = (await pool.query(
      `SELECT requirement_id FROM vendor_engagement_scope_items WHERE engagement_id=$1 LIMIT 1`, [engagement]
    )).rows[0].requirement_id;

    // A response cannot exist on a scope-mutable engagement through the product
    // path — SCOPE_MUTABLE_STATES and PORTAL_WRITABLE_STATES are disjoint. It is
    // written directly here anyway, so the assertion is about the UPDATE's blast
    // radius rather than about a reachable state.
    const resp = await pool.query<{ id: string }>(
      `INSERT INTO requirement_responses
         (organization_id, requirement_id, assessment_type, subject_id, status, engagement_id, notes)
       VALUES ($1, $2, 'vendor', $3, 'partial', $4, 'Vendor statement.') RETURNING id`,
      [seed.orgA.id, requirementId, vendorId, engagement]
    );

    await reIntake(vendorId, rel, BENIGN);
    expect((await A.post(`/api/vendor-engagements/${engagement}/reseed-from-relationship`, {
      reason: "Rebasing while an answer already exists on the row.",
    })).status).toBe(200);

    const after = (await pool.query(`SELECT status, notes FROM requirement_responses WHERE id=$1`, [resp.rows[0]!.id])).rows[0];
    expect(after.status).toBe("partial");
    expect(after.notes).toBe("Vendor statement.");
  });
});

describe("R8-1 — a reseed names a human", () => {
  it("refuses an API key outright: an anonymous rebase is worse than no record", async () => {
    const { engagement, relationship: rel } = await freshEngagement("r8-apikey");
    const vendorId = (await pool.query(`SELECT vendor_id FROM vendor_relationships WHERE id=$1`, [rel])).rows[0].vendor_id;
    await reIntake(vendorId, rel, BENIGN);

    const res = await request(app)
      .post(`/api/vendor-engagements/${engagement}/reseed-from-relationship`)
      .set("X-Api-Key", orgAApiKey)
      .send({ reason: "An integration attempting to rebase without a person." });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("human_actor_required");
    const n = await pool.query(
      `SELECT COUNT(*)::int AS n FROM vendor_engagement_relationship_reseeds WHERE engagement_id = $1`,
      [engagement]
    );
    expect(n.rows[0].n).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   R8-2 — provenance security model
   ═══════════════════════════════════════════════════════════════════════════ */
describe("R8-2 — provenance is tenant-scoped and append-only", () => {
  it("(12)(13) org B can neither read nor write org A's provenance", async () => {
    const { engagement, relationship: rel } = await freshEngagement("r8-tenant");
    const vendorId = (await pool.query(`SELECT vendor_id FROM vendor_relationships WHERE id=$1`, [rel])).rows[0].vendor_id;
    await reIntake(vendorId, rel, BENIGN);
    expect((await A.post(`/api/vendor-engagements/${engagement}/reseed-from-relationship`, {
      reason: "Rebasing for the tenant-isolation proof.",
    })).status).toBe(200);

    // Read: org B cannot even see the engagement.
    const read = await B.get(`/api/vendor-engagements/${engagement}`);
    expect([403, 404]).toContain(read.status);

    // Write: org B cannot reseed it either.
    const write = await B.post(`/api/vendor-engagements/${engagement}/reseed-from-relationship`, {
      reason: "Attempting to rebase another tenant's engagement.",
    });
    expect([403, 404]).toContain(write.status);

    // And no row of org A's leaked into org B.
    const leak = await pool.query(
      `SELECT COUNT(*)::int AS n FROM vendor_engagement_relationship_reseeds
        WHERE engagement_id = $1 AND organization_id <> $2`,
      [engagement, seed.orgA.id]
    );
    expect(leak.rows[0].n).toBe(0);
  });

  it("(14) an existing provenance row cannot be updated or deleted", async () => {
    const { engagement, relationship: rel } = await freshEngagement("r8-worm");
    const vendorId = (await pool.query(`SELECT vendor_id FROM vendor_relationships WHERE id=$1`, [rel])).rows[0].vendor_id;
    await reIntake(vendorId, rel, BENIGN);
    expect((await A.post(`/api/vendor-engagements/${engagement}/reseed-from-relationship`, {
      reason: "Rebasing for the append-only proof.",
    })).status).toBe(200);

    const id = (await pool.query(`SELECT id FROM vendor_engagement_relationship_reseeds WHERE engagement_id=$1`, [engagement])).rows[0].id;

    // Wall 1 — the shared WORM guard refuses regardless of role.
    await expect(
      pool.query(`UPDATE vendor_engagement_relationship_reseeds SET reason = 'rewritten' WHERE id = $1`, [id])
    ).rejects.toThrow();
    await expect(
      pool.query(`DELETE FROM vendor_engagement_relationship_reseeds WHERE id = $1`, [id])
    ).rejects.toThrow();

    // Wall 2 — the application role was never granted the privilege at all, so
    // an attempt fails as permission-denied before the trigger runs.
    const grants = await pool.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_name = 'vendor_engagement_relationship_reseeds' AND grantee = 'app_request'`
    );
    const held = grants.rows.map((r) => r.privilege_type).sort();
    expect(held).toEqual(["INSERT", "SELECT"]);

    // The row is still exactly what it was.
    const still = (await pool.query(`SELECT reason FROM vendor_engagement_relationship_reseeds WHERE id=$1`, [id])).rows[0];
    expect(still.reason).toBe("Rebasing for the append-only proof.");
  });
});
