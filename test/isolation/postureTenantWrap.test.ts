/**
 * postureTenantWrap.test.ts — A04-G1 PR γ.2: end-to-end proof that wrapping the
 * four `posture` routes in asTenant() (a) keeps the routes working when the
 * engine connects as the non-owner `app_request` role, (b) preserves the
 * explicit-transaction shape of POST /posture/snapshot now that its inner
 * withTenant is gone and the snapshot tx nests as a SAVEPOINT inside the request
 * tx, and (c) keeps cross-org reads scoped — via the handlers'/helper's WHERE
 * clauses.
 *
 * WHY THIS FILE DOES NOT PROVE RLS ISOLATION (read this before adding asserts)
 * ---------------------------------------------------------------------------
 * The β2 findings wrap tests prove RLS isolation ONLY because the `findings`
 * table carries the phase-2 pilot RLS policy (20260619_findings_rls_pilot.sql).
 * NO posture table has an RLS policy yet — those are phase-3 deliverables in
 * DIFFERENT batches (docs/A04-G1-rls-rollout-plan.md): posture_snapshots in
 * Batch A, domain_scores in Batch G (split from posture_snapshots), obligations
 * later, obligation_assessments in Batch C. So under `app_request` here an
 * unscoped SELECT would see ALL rows and an unscoped INSERT would PERSIST.
 * Therefore this file separates the two certification axes (design §4.0):
 *   - TRANSACTION-SHAPE (savepoint safety, commit-before-respond, single-
 *     connection-after-refactor, in-tx error atomicity, serialization, dispatch
 *     survival) — certified HERE by γ.2.
 *   - RLS ISOLATION (policy-enforced cross-org visibility, NULLIF fail-closed)
 *     — certified LATER by the Batch A/C/G posture RLS migrations, NOT by γ.2.
 * The cross-org tests below are WHERE-CLAUSE tripwires: they pass today because
 * each handler/helper filters `organization_id = $1`, NOT because the database
 * enforces a policy. They exist so that if a future refactor drops a WHERE
 * clause before the batches land, the regression is still caught. When the
 * policies land, these should be upgraded to real RLS proofs (and a fail-closed
 * NULLIF test added), mirroring findingsTenantWrap's β2 block.
 *
 * Simulating the post-flip role split
 * -----------------------------------
 * Identical device to risksTenantWrap.test.ts: the app's request pool reads
 * DATABASE_URL with a libpq `options=-c role=app_request` GUC so every session
 * assumes the non-owner role at startup, while pgElevated is pinned to the owner
 * via MIGRATION_DATABASE_URL (the dispatcher channel). The seeding pool stays
 * the owner.
 */

import crypto from "crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, seedFinding, seedWebhookEndpoint, type TestDbSeed } from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let ownerPool: Pool; // seeds + verifies as owner — not the app_request pool
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
 * with NO prior snapshot so that a rolled-back snapshot leaves ZERO rows.
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

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set for the posture wrap test.");
  }

  ownerPool = new Pool({ connectionString: url, ssl: false });
  // One open finding per org so the snapshot computation yields a non-empty
  // domain_scores set (the helper skips the domain_scores INSERT when there are
  // zero domains — see postureComputation: findings.length === 0 → []).
  await seedFinding(ownerPool, seed.orgA.id);
  await seedFinding(ownerPool, seed.orgB.id);
  // Active endpoint for org A so the POST write path exercises dispatchWebhook-
  // Event (pgElevated since β1). Loopback URL → SSRF guard rejects the network
  // call deterministically, but the delivery row is still INSERTed.
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

describe("A04-G1 PR γ.2 — posture wrap: functional under app_request", () => {
  it("harness control: the app request pool really runs as app_request", async () => {
    // Proves the role-simulation is in effect WITHOUT relying on RLS (posture
    // tables have no policy). An owner pool would report 'harness' here.
    const { pg } = await import("../../src/api/infra/postgres.js");
    const r = await pg.query<{ current_user: string }>("SELECT current_user");
    expect(r.rows[0]?.current_user).toBe("app_request");
  });

  it("POST /posture/snapshot → 201, snapshot + its domain_scores persist, and the posture.snapshot_created webhook delivery lands (pgElevated, post-commit)", async () => {
    const before = await ownerPool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM webhook_deliveries WHERE organization_id = $1 AND event_type = 'posture.snapshot_created'",
      [seed.orgA.id],
    );

    const res = await request(app)
      .post("/api/posture/snapshot")
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({});

    expect(
      res.status,
      "POST /posture/snapshot failed under app_request — the wrap/refactor broke " +
        "snapshot creation or app_request is missing a Tier-A grant",
    ).toBe(201);
    const snapshotId = res.body?.snapshotId as string;
    expect(snapshotId).toBeTruthy();
    expect(res.body?.organizationId).toBe(seed.orgA.id);
    // The seeded finding guarantees at least one domain score.
    expect(Array.isArray(res.body?.domainScores)).toBe(true);
    expect(res.body.domainScores.length).toBeGreaterThan(0);

    // The snapshot row and its domain_scores must BOTH be persisted — proving the
    // helper's explicit tx (now a SAVEPOINT inside the request tx after the inner
    // withTenant was removed) committed as part of the wrapped request.
    const snapPersisted = await waitForCount(
      ownerPool,
      "SELECT count(*)::int AS n FROM posture_snapshots WHERE id = $1 AND organization_id = $2",
      [snapshotId, seed.orgA.id],
      1,
    );
    expect(snapPersisted, "snapshot did not persist after the wrapped COMMIT").toBeGreaterThanOrEqual(1);

    const domainPersisted = await waitForCount(
      ownerPool,
      "SELECT count(*)::int AS n FROM domain_scores WHERE posture_snapshot_id = $1",
      [snapshotId],
      1,
    );
    expect(
      domainPersisted,
      "domain_scores did not persist with the snapshot — the helper's savepoint tx " +
        "did not fold into the request tx",
    ).toBeGreaterThanOrEqual(1);

    // dispatchWebhookEvent is fire-and-forget on pgElevated; poll for the row.
    const reached = await waitForCount(
      ownerPool,
      "SELECT count(*)::int AS n FROM webhook_deliveries WHERE organization_id = $1 AND event_type = 'posture.snapshot_created'",
      [seed.orgA.id],
      before.rows[0].n + 1,
    );
    expect(
      reached,
      "posture.snapshot_created delivery row did not land after a wrapped POST — β1 " +
        "pgElevated insulation is not holding under the asTenant wrap",
    ).toBeGreaterThanOrEqual(before.rows[0].n + 1);
  });

  it("GET /posture/latest → 200 with the caller org's snapshot and domain scores", async () => {
    const res = await request(app)
      .get("/api/posture/latest")
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    expect(res.body?.snapshot?.organizationId).toBe(seed.orgA.id);
    expect(Array.isArray(res.body?.domainScores)).toBe(true);
    expect(res.body.domainScores.length).toBeGreaterThan(0);
  });

  it("GET /posture/history → 200 with the caller org's snapshots", async () => {
    const res = await request(app)
      .get("/api/posture/history")
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    expect(res.body?.organizationId).toBe(seed.orgA.id);
    expect(Array.isArray(res.body?.snapshots)).toBe(true);
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });

  it("GET /posture/compliance-summary → 200 with the canonical zero-shape (no obligations seeded for A)", async () => {
    const res = await request(app)
      .get("/api/posture/compliance-summary")
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    expect(res.body?.obligations?.total).toBe(0);
    expect(res.body?.assessments?.total).toBe(0);
    expect(res.body?.open_compliance_concerns).toBe(0);
    // Canonical keys always present (proves both serialized queries ran + bound).
    expect(Object.keys(res.body.obligations.by_status).sort()).toEqual(
      ["active", "not_applicable", "waived"].sort(),
    );
  });
});

// ===========================================================================
// Cross-org tripwires — WHERE-clause isolation (NOT RLS; see file header).
// RLS certification is deferred to the phase-3 Batch A/C/G posture policies.
// ===========================================================================

describe("A04-G1 PR γ.2 — posture wrap: cross-org tripwires (WHERE-clause, RLS deferred to Batch A/C/G)", () => {
  it("GET /posture/latest returns the caller org's snapshot, never another org's (tripwire)", async () => {
    // Give org B its own snapshot, then confirm org A's latest is still A's.
    const bSnap = await request(app)
      .post("/api/posture/snapshot")
      .set("X-Api-Key", seed.orgB.apiKey)
      .send({});
    expect(bSnap.status).toBe(201);
    const bSnapshotId = bSnap.body?.snapshotId as string;

    const res = await request(app)
      .get("/api/posture/latest")
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    expect(res.body?.snapshot?.organizationId).toBe(seed.orgA.id);
    expect(res.body?.snapshot?.id).not.toBe(bSnapshotId);
  });

  it("GET /posture/compliance-summary does not count another org's obligations (tripwire)", async () => {
    // Seed an obligation for org B only.
    await ownerPool.query(
      `INSERT INTO obligations (organization_id, title, status)
       VALUES ($1, $2, 'active')
       ON CONFLICT (organization_id, title) DO NOTHING`,
      [seed.orgB.id, "Org B obligation"],
    );

    // Org A must not see it.
    const aRes = await request(app)
      .get("/api/posture/compliance-summary")
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(aRes.status).toBe(200);
    expect(aRes.body?.obligations?.total).toBe(0);

    // Org B sees exactly its own.
    const bRes = await request(app)
      .get("/api/posture/compliance-summary")
      .set("X-Api-Key", seed.orgB.apiKey);
    expect(bRes.status).toBe(200);
    expect(bRes.body?.obligations?.total).toBe(1);
    expect(bRes.body?.obligations?.by_status?.active).toBe(1);
  });
});

// ===========================================================================
// Transaction-shape — the explicit-tx site (POST /posture/snapshot helper).
// The helper's BEGIN/COMMIT/ROLLBACK run as SAVEPOINT/RELEASE/ROLLBACK-TO inside
// the request tx (inner withTenant removed in γ.2 §2.2). This is the headline
// refactor proof: an in-tx error must roll back the whole snapshot atomically
// via the savepoint, the request tx must stay healthy and COMMIT cleanly (500,
// NOT a tenant_commit_failed durability incident), and the pool must not be
// poisoned for the next request.
// ===========================================================================

describe("A04-G1 PR γ.2 — posture wrap: savepoint-nesting atomicity on POST /posture/snapshot", () => {
  it("an in-tx failure on the domain_scores INSERT → 500 and NEITHER snapshot nor domain_scores persist; a later snapshot still succeeds", async () => {
    const org = await seedFreshOrg(ownerPool, `posture-atomicity-${Date.now()}`);
    await seedFinding(ownerPool, org.id); // ensure domain_scores INSERT runs

    // Force the domain_scores INSERT (the LAST write in the helper's tx) to fail,
    // so the helper hits its catch → client.query("ROLLBACK") which the savepoint
    // client rewrites to ROLLBACK TO SAVEPOINT sp_1; RELEASE sp_1 — recovering the
    // outer request tx from the aborted-statement state and undoing the snapshot
    // INSERT + DELETE too.
    await ownerPool.query(`
      CREATE OR REPLACE FUNCTION harness_fail_domain_scores() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'harness induced domain_scores failure'; END;
      $$ LANGUAGE plpgsql;
    `);
    await ownerPool.query(`
      CREATE TRIGGER harness_fail_ds BEFORE INSERT ON domain_scores
      FOR EACH ROW EXECUTE FUNCTION harness_fail_domain_scores();
    `);

    try {
      const res = await request(app)
        .post("/api/posture/snapshot")
        .set("X-Api-Key", org.apiKey)
        .send({});
      expect(res.status).toBe(500);
      expect(res.body?.error).toBe("posture_snapshot_failed");

      // Atomic: the snapshot INSERT was rolled back to the savepoint, so the
      // fresh org has ZERO snapshots and ZERO domain_scores.
      const snaps = await ownerPool.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM posture_snapshots WHERE organization_id = $1",
        [org.id],
      );
      expect(snaps.rows[0].n, "snapshot persisted despite the in-tx failure — savepoint rollback not atomic").toBe(0);
      const domains = await ownerPool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM domain_scores ds
         JOIN posture_snapshots ps ON ps.id = ds.posture_snapshot_id
         WHERE ps.organization_id = $1`,
        [org.id],
      );
      expect(domains.rows[0].n).toBe(0);
    } finally {
      await ownerPool.query("DROP TRIGGER IF EXISTS harness_fail_ds ON domain_scores");
      await ownerPool.query("DROP FUNCTION IF EXISTS harness_fail_domain_scores()");
    }

    // With the fault removed, a snapshot for the same org now succeeds — proving
    // the earlier ROLLBACK TO SAVEPOINT did not poison the request path.
    const ok = await request(app)
      .post("/api/posture/snapshot")
      .set("X-Api-Key", org.apiKey)
      .send({});
    expect(
      ok.status,
      "a valid snapshot after a savepoint-rolled-back failure failed — the in-tx " +
        "error path left the request/pool in a bad state",
    ).toBe(201);

    const persisted = await waitForCount(
      ownerPool,
      "SELECT count(*)::int AS n FROM posture_snapshots WHERE organization_id = $1",
      [org.id],
      1,
    );
    expect(persisted).toBeGreaterThanOrEqual(1);
  });
});
