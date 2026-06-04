/**
 * vendorAssessmentsTenantWrap.test.ts — A04-G1 PR γ.3: end-to-end proof that
 * wrapping the three `vendorAssessments` routes in asTenant() (a) keeps the
 * routes working when the engine connects as the non-owner `app_request` role,
 * (b) preserves the explicit-transaction shape of POST /vendor-assessments (a
 * multi-table tx: vendors lock + vendor_assessments INSERT + findings INSERT,
 * now nested as a SAVEPOINT inside the request tx), (c) proves the §2.1
 * fire-and-forget fix — the setImmediate risk-score recompute now runs in its
 * OWN withTenant(orgId) scope, so it still updates vendors.current_risk_score
 * after the response without touching the released request client, and (d) keeps
 * cross-org reads/writes scoped — via the handler's WHERE clauses.
 *
 * WHY THIS FILE DOES NOT PROVE RLS ISOLATION (read this before adding asserts)
 * ---------------------------------------------------------------------------
 * The β2 findings wrap tests prove RLS isolation ONLY because the `findings`
 * table carries the phase-2 pilot RLS policy (20260619_findings_rls_pilot.sql).
 * `vendor_assessments` has NO policy yet — phase-3 Batch C — and `vendors` has
 * none either (Batch A). So under `app_request` here an unscoped SELECT/INSERT
 * on those tables would see/persist all rows. This file separates the two
 * certification axes (design §4.0):
 *   - TRANSACTION-SHAPE (savepoint safety across the multi-table tx,
 *     commit-before-respond, in-tx error atomicity, dispatch survival,
 *     setImmediate-recompute survival) — certified HERE by γ.3.
 *   - RLS ISOLATION (policy-enforced cross-org visibility, NULLIF fail-closed)
 *     — certified LATER by the Batch C (vendor_assessments) / Batch A (vendors)
 *     migrations, NOT by γ.3.
 * The cross-org tests below are WHERE-CLAUSE tripwires: they pass today because
 * the handler filters `organization_id = $n`, NOT because the database enforces
 * a policy. When the policies land, upgrade them to real RLS proofs (and add a
 * fail-closed NULLIF test), mirroring findingsTenantWrap's β2 block.
 *
 * NOTE on the findings sub-write: the POST also INSERTs into `findings`, which
 * DOES carry the pilot policy. Wrapping the route is what supplies the
 * `app.current_org_id` GUC the findings WITH CHECK needs — so the functional
 * POST test (which reads the finding back) doubles as a check that the wrap sets
 * the GUC correctly. Post-flip, an UNWRAPPED POST would fail the findings INSERT.
 *
 * Simulating the post-flip role split
 * -----------------------------------
 * Identical device to risksTenantWrap / postureTenantWrap: the app's request
 * pool reads DATABASE_URL with a libpq `options=-c role=app_request` GUC so every
 * session assumes the non-owner role at startup, while pgElevated is pinned to
 * the owner via MIGRATION_DATABASE_URL. The seeding pool stays the owner.
 */

import crypto from "crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import {
  bootstrapTestDb,
  seedVendor,
  seedWebhookEndpoint,
  type TestDbSeed,
} from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let ownerPool: Pool; // seeds + verifies as owner — not the app_request pool
let vendorA: string;
let vendorB: string;
let originalDatabaseUrl: string | undefined;
let originalMigrationUrl: string | undefined;

/** Poll until the count query's first column reaches `atLeast`, or time out. */
async function waitForCount(
  pool: Pool,
  sql: string,
  params: unknown[],
  atLeast: number,
  timeoutMs = 4000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  while (Date.now() < deadline) {
    const r = await pool.query<{ n: number }>(sql, params);
    last = r.rows[0]?.n ?? 0;
    if (last >= atLeast) return last;
    await new Promise((res) => setTimeout(res, 20));
  }
  return last;
}

/** sha256 hex of the raw key — matches requireApiKey's lookup (mirrors testDb). */
function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Seed a fresh org + active premium API key inline (testDb.seedOrg is not
 * exported). Used by the savepoint-nesting atomicity test, which needs an org
 * with NO prior assessment so a rolled-back create leaves ZERO rows.
 */
async function seedFreshOrg(pool: Pool, slug: string): Promise<{ id: string; apiKey: string }> {
  const orgRes = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, status, entitlement_level)
     VALUES ($1, $2, 'active', 'premium')
     RETURNING id`,
    [`Harness ${slug}`, slug],
  );
  const orgId = orgRes.rows[0].id;
  const rawKey = crypto.randomBytes(24).toString("hex");
  await pool.query(
    `INSERT INTO api_keys (organization_id, label, key_hash, entitlement_level, status)
     VALUES ($1, $2, $3, 'premium', 'active')`,
    [orgId, `harness-${slug}`, hashApiKey(rawKey)],
  );
  return { id: orgId, apiKey: rawKey };
}

const VALID_BODY = (vendorId: string) => ({
  vendor_id: vendorId,
  assessment_type: "security",
  overall_severity: "High",
});

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set for the vendorAssessments wrap test.");
  }

  ownerPool = new Pool({ connectionString: url, ssl: false });
  // Active vendor per org so the POST's `SELECT … FOR UPDATE WHERE status='active'`
  // precheck passes; criticality set so the recompute yields a non-null score.
  vendorA = await seedVendor(ownerPool, seed.orgA.id, { name: "Vendor A", criticality: "high" });
  vendorB = await seedVendor(ownerPool, seed.orgB.id, { name: "Vendor B", criticality: "high" });
  // Active endpoint for org A so the POST exercises dispatchWebhookEvent
  // (pgElevated since β1). Loopback URL → SSRF guard rejects the network call,
  // but the delivery row is still INSERTed.
  await seedWebhookEndpoint(ownerPool, seed.orgA.id);

  originalDatabaseUrl = process.env.DATABASE_URL;
  originalMigrationUrl = process.env.MIGRATION_DATABASE_URL;
  process.env.DATABASE_URL =
    url +
    (url.includes("?") ? "&" : "?") +
    "options=" +
    encodeURIComponent("-c role=app_request");
  process.env.MIGRATION_DATABASE_URL = url;

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 120_000);

afterAll(async () => {
  await ownerPool?.end();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalMigrationUrl === undefined) delete process.env.MIGRATION_DATABASE_URL;
  else process.env.MIGRATION_DATABASE_URL = originalMigrationUrl;
});

// ===========================================================================
// Harness control + functional CRUD under app_request
// ===========================================================================

describe("A04-G1 PR γ.3 — vendorAssessments wrap: functional under app_request", () => {
  it("harness control: the app request pool really runs as app_request", async () => {
    const { pg } = await import("../../src/api/infra/postgres.js");
    const r = await pg.query<{ current_user: string }>("SELECT current_user");
    expect(r.rows[0]?.current_user).toBe("app_request");
  });

  it("POST /vendor-assessments → 201; the assessment AND its findings row persist (multi-table tx commits under the wrap, findings GUC set), and the vendor.assessed webhook delivery lands", async () => {
    const before = await ownerPool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM webhook_deliveries WHERE organization_id = $1 AND event_type = 'vendor.assessed'",
      [seed.orgA.id],
    );

    const res = await request(app)
      .post("/api/vendor-assessments")
      .set("X-Api-Key", seed.orgA.apiKey)
      .send(VALID_BODY(vendorA));

    expect(
      res.status,
      "POST /vendor-assessments failed under app_request — the wrap broke the create, " +
        "the findings WITH CHECK rejected the sub-write (GUC not set), or app_request " +
        "is missing a Tier-A grant",
    ).toBe(201);
    const assessmentId = res.body?.assessment?.id as string;
    expect(assessmentId).toBeTruthy();
    expect(res.body?.assessment?.organization_id).toBe(seed.orgA.id);
    expect(res.body?.finding?.id).toBeTruthy();
    expect(res.body?.finding?.source_id).toBe(assessmentId);

    // Both the assessment row AND its linked finding must persist — proving the
    // multi-table explicit tx (vendors lock + vendor_assessments INSERT +
    // findings INSERT) committed as part of the wrapped request (one connection,
    // one outer COMMIT, savepoint-nested).
    const assessmentPersisted = await waitForCount(
      ownerPool,
      "SELECT count(*)::int AS n FROM vendor_assessments WHERE id = $1 AND organization_id = $2",
      [assessmentId, seed.orgA.id],
      1,
    );
    expect(assessmentPersisted, "assessment did not persist after the wrapped COMMIT").toBeGreaterThanOrEqual(1);

    const findingPersisted = await waitForCount(
      ownerPool,
      "SELECT count(*)::int AS n FROM findings WHERE source_type = 'vendor_review' AND source_id = $1::uuid AND organization_id = $2",
      [assessmentId, seed.orgA.id],
      1,
    );
    expect(
      findingPersisted,
      "linked finding did not persist with the assessment — the multi-table savepoint tx " +
        "did not fold into the request tx (or the findings policy rejected it)",
    ).toBeGreaterThanOrEqual(1);

    // dispatchWebhookEvent is fire-and-forget on pgElevated; poll for the row.
    const reached = await waitForCount(
      ownerPool,
      "SELECT count(*)::int AS n FROM webhook_deliveries WHERE organization_id = $1 AND event_type = 'vendor.assessed'",
      [seed.orgA.id],
      before.rows[0].n + 1,
    );
    expect(
      reached,
      "vendor.assessed delivery row did not land after a wrapped POST — β1 pgElevated " +
        "insulation is not holding under the asTenant wrap",
    ).toBeGreaterThanOrEqual(before.rows[0].n + 1);
  });

  it("GET /vendor-assessments → 200 lists the caller org's assessments", async () => {
    const res = await request(app)
      .get("/api/vendor-assessments")
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    expect(res.body?.organizationId).toBe(seed.orgA.id);
    expect(Array.isArray(res.body?.assessments)).toBe(true);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });

  it("GET /vendor-assessments/:id → 200 with the assessment and its finding", async () => {
    const created = await request(app)
      .post("/api/vendor-assessments")
      .set("X-Api-Key", seed.orgA.apiKey)
      .send(VALID_BODY(vendorA));
    expect(created.status).toBe(201);
    const id = created.body.assessment.id as string;

    const res = await request(app)
      .get(`/api/vendor-assessments/${id}`)
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    expect(res.body?.assessment?.id).toBe(id);
    expect(res.body?.finding?.source_id).toBe(id);
  });
});

// ===========================================================================
// Transaction-shape — the explicit multi-table tx + the setImmediate fix.
// ===========================================================================

describe("A04-G1 PR γ.3 — vendorAssessments wrap: setImmediate recompute survives the wrap (§2.1 fix)", () => {
  it("after the POST response returns, the background risk-score recompute still completes (vendors.current_risk_score updated) — proving the recompute runs in its own withTenant scope, not on the released request client", async () => {
    // Fresh vendor with a NULL current_risk_score so the post-recompute non-null
    // assertion is unambiguous.
    const vendor = await seedVendor(ownerPool, seed.orgA.id, {
      name: `recompute-target-${Date.now()}`,
      criticality: "high",
    });

    const res = await request(app)
      .post("/api/vendor-assessments")
      .set("X-Api-Key", seed.orgA.apiKey)
      .send(VALID_BODY(vendor));
    expect(res.status).toBe(201);

    // The §2.1 fix runs the recompute via `void withTenant(orgId, …)` scheduled in
    // setImmediate. If it had stayed on the ambient `pg` proxy it would hit the
    // released request client (use-after-release) and never persist the score.
    const scored = await waitForCount(
      ownerPool,
      "SELECT count(*)::int AS n FROM vendors WHERE id = $1 AND current_risk_score IS NOT NULL",
      [vendor],
      1,
    );
    expect(
      scored,
      "vendors.current_risk_score was not updated after the POST — the setImmediate recompute " +
        "did not run in its own withTenant scope (use-after-release on the request client?)",
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("A04-G1 PR γ.3 — vendorAssessments wrap: savepoint-nesting atomicity on POST", () => {
  it("an in-tx failure on the findings INSERT → 500 and NEITHER the vendor_assessments row NOR the findings row persists; a later POST still succeeds", async () => {
    const org = await seedFreshOrg(ownerPool, `va-atomicity-${Date.now()}`);
    const vendor = await seedVendor(ownerPool, org.id, { name: "atomicity vendor", criticality: "high" });

    // Force the findings INSERT (the second write in the helper's tx, after the
    // vendor_assessments INSERT) to fail. The handler's catch runs
    // client.query("ROLLBACK") which the savepoint client rewrites to
    // ROLLBACK TO SAVEPOINT sp_1; RELEASE sp_1 — recovering the outer request tx
    // and undoing the vendor_assessments INSERT too.
    await ownerPool.query(`
      CREATE OR REPLACE FUNCTION harness_fail_findings() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'harness induced findings failure'; END;
      $$ LANGUAGE plpgsql;
    `);
    await ownerPool.query(`
      CREATE TRIGGER harness_fail_f BEFORE INSERT ON findings
      FOR EACH ROW EXECUTE FUNCTION harness_fail_findings();
    `);

    try {
      const res = await request(app)
        .post("/api/vendor-assessments")
        .set("X-Api-Key", org.apiKey)
        .send(VALID_BODY(vendor));
      expect(res.status).toBe(500);
      expect(res.body?.error).toBe("vendor_assessment_create_failed");

      // Atomic: the vendor_assessments INSERT was rolled back to the savepoint.
      const assessments = await ownerPool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM vendor_assessments WHERE organization_id = $1",
        [org.id],
      );
      expect(
        assessments.rows[0].n,
        "vendor_assessments row persisted despite the in-tx failure — savepoint rollback not atomic",
      ).toBe(0);
      const findings = await ownerPool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM findings WHERE organization_id = $1",
        [org.id],
      );
      expect(findings.rows[0].n).toBe(0);
    } finally {
      await ownerPool.query("DROP TRIGGER IF EXISTS harness_fail_f ON findings");
      await ownerPool.query("DROP FUNCTION IF EXISTS harness_fail_findings()");
    }

    // With the fault removed, a POST for the same org now succeeds — proving the
    // earlier ROLLBACK TO SAVEPOINT did not poison the request path.
    const ok = await request(app)
      .post("/api/vendor-assessments")
      .set("X-Api-Key", org.apiKey)
      .send(VALID_BODY(vendor));
    expect(
      ok.status,
      "a valid POST after a savepoint-rolled-back failure failed — the in-tx error path " +
        "left the request/pool in a bad state",
    ).toBe(201);
  });
});

// ===========================================================================
// Cross-org tripwires — WHERE-clause isolation (NOT RLS; see file header).
// RLS certification is deferred to the phase-3 Batch C (vendor_assessments) /
// Batch A (vendors) policies.
// ===========================================================================

describe("A04-G1 PR γ.3 — vendorAssessments wrap: cross-org tripwires (WHERE-clause, RLS deferred to Batch C)", () => {
  it("GET /vendor-assessments/:id of another org's assessment → 404 (tripwire)", async () => {
    // Create an assessment under org B.
    const bCreated = await request(app)
      .post("/api/vendor-assessments")
      .set("X-Api-Key", seed.orgB.apiKey)
      .send(VALID_BODY(vendorB));
    expect(bCreated.status).toBe(201);
    const bId = bCreated.body.assessment.id as string;

    // Org A cannot read it.
    const res = await request(app)
      .get(`/api/vendor-assessments/${bId}`)
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(404);

    // Org A's list does not include it.
    const list = await request(app)
      .get("/api/vendor-assessments")
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(list.status).toBe(200);
    const ids = (list.body?.assessments ?? []).map((a: { id: string }) => a.id);
    expect(ids).not.toContain(bId);
  });

  it("POST referencing another org's vendor → 404 vendor_not_found, and no rows are created for the foreign org (tripwire)", async () => {
    const before = await ownerPool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM vendor_assessments WHERE vendor_id = $1",
      [vendorB],
    );

    // Org A tries to assess org B's vendor.
    const res = await request(app)
      .post("/api/vendor-assessments")
      .set("X-Api-Key", seed.orgA.apiKey)
      .send(VALID_BODY(vendorB));
    expect(res.status).toBe(404);
    expect(res.body?.error).toBe("vendor_not_found");

    const after = await ownerPool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM vendor_assessments WHERE vendor_id = $1",
      [vendorB],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
