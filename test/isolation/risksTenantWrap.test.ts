/**
 * risksTenantWrap.test.ts — A04-G1 PR γ.1: end-to-end proof that wrapping the
 * eight `risks` routes in asTenant() (a) keeps ordinary CRUD working when the
 * engine connects as the non-owner `app_request` role, (b) preserves the
 * savepoint + fire-and-forget transaction shape of the two explicit-tx writes,
 * and (c) keeps cross-org reads scoped — via the handlers' WHERE clauses.
 *
 * WHY THIS FILE DOES NOT PROVE RLS ISOLATION (read this before adding asserts)
 * ---------------------------------------------------------------------------
 * The β2 findings wrap tests prove RLS isolation ONLY because the `findings`
 * table carries the phase-2 pilot RLS policy (20260619_findings_rls_pilot.sql).
 * The `risks` table has NO RLS policy and RLS is not enabled on it — that is a
 * phase-3 Batch-A deliverable (docs/A04-G1-rls-rollout-plan.md §4 batch A),
 * landing after the γ wrap work cooks on main. So under `app_request` here:
 *   - an unscoped `SELECT risks` would see ALL rows (no policy filters), and
 *   - an unscoped INSERT would PERSIST (no WITH CHECK).
 * Therefore this file separates the two certification axes (design §4.0):
 *   - TRANSACTION-SHAPE (savepoint safety, commit-before-respond, fire-and-
 *     forget survival, serialization) — certified HERE by γ.1.
 *   - RLS ISOLATION (policy-enforced cross-org visibility, NULLIF fail-closed)
 *     — certified LATER by the Batch-A risks RLS migration, NOT by γ.1.
 * The cross-org tests below are WHERE-CLAUSE tripwires: they pass today because
 * each handler filters `organization_id = $2`, NOT because the database
 * enforces a policy. They exist so that if a future refactor drops a WHERE
 * clause before Batch A lands, the regression is still caught. When the Batch-A
 * policy lands, these should be upgraded to real RLS proofs (and a fail-closed
 * NULLIF test added), mirroring findingsTenantWrap's β2 block.
 *
 * Simulating the post-flip role split
 * -----------------------------------
 * Identical device to findingsTenantWrap.test.ts: the app's request pool reads
 * DATABASE_URL with a libpq `options=-c role=app_request` GUC so every session
 * assumes the non-owner role at startup (NOBYPASSRLS, not the table owner),
 * while pgElevated is pinned to the owner via MIGRATION_DATABASE_URL (the
 * dispatcher/audit channel). The separate seeding pool stays the owner.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, seedRisk, seedWebhookEndpoint, type TestDbSeed } from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let ownerPool: Pool; // seeds + verifies as owner — not the app_request pool
let riskA: string;
let riskB: string;
let originalDatabaseUrl: string | undefined;
let originalMigrationUrl: string | undefined;

// A well-formed UUID that is never seeded — used for not-found / foreign-owner
// probes. v4 shape so it passes the route's isUuid()/validator gates.
const ABSENT_UUID = "99999999-9999-4999-8999-999999999999";

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

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set for the risks wrap test.");
  }

  ownerPool = new Pool({ connectionString: url, ssl: false });
  riskA = await seedRisk(ownerPool, seed.orgA.id, { title: "Org A risk" });
  riskB = await seedRisk(ownerPool, seed.orgB.id, { title: "Org B risk" });
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

describe("A04-G1 PR γ.1 — risks wrap: functional under app_request", () => {
  it("harness control: the app request pool really runs as app_request", async () => {
    // Proves the role-simulation is in effect WITHOUT relying on RLS (risks has
    // no policy). An owner pool would report 'harness' here. This is the risks
    // analogue of findings' fail-closed control, which can't use the zero-rows
    // trick because risks has no policy to fail closed against.
    const { pg } = await import("../../src/api/infra/postgres.js");
    const r = await pg.query<{ current_user: string }>("SELECT current_user");
    expect(r.rows[0]?.current_user).toBe("app_request");
  });

  it("POST /risks → 201, readable back, and the risk.created webhook delivery lands (pgElevated, post-commit)", async () => {
    const before = await ownerPool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM webhook_deliveries WHERE organization_id = $1 AND event_type = 'risk.created'",
      [seed.orgA.id],
    );

    const res = await request(app)
      .post("/api/risks")
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({
        title: "γ.1 created risk",
        domain: "Vendor Risk",
        likelihood: "possible",
        impact: "High",
        risk_rating: "High",
        inherent_likelihood: "likely",
        inherent_impact: "High",
        inherent_rating: "High",
        residual_likelihood: "possible",
        residual_impact: "High",
        residual_rating: "High",
        status: "open",
      });

    expect(
      res.status,
      "POST /risks failed under app_request — the wrap broke ordinary create or " +
        "app_request is missing a Tier-A grant on risks",
    ).toBe(201);
    const createdId = res.body?.risk?.id as string;
    expect(createdId).toBeTruthy();
    expect(res.body?.risk?.organization_id).toBe(seed.orgA.id);

    const getRes = await request(app)
      .get(`/api/risks/${createdId}`)
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(getRes.status).toBe(200);
    expect(getRes.body?.risk?.id).toBe(createdId);

    // dispatchWebhookEvent is fire-and-forget on pgElevated; poll for the row.
    const reached = await waitForCount(
      ownerPool,
      "SELECT count(*)::int AS n FROM webhook_deliveries WHERE organization_id = $1 AND event_type = 'risk.created'",
      [seed.orgA.id],
      before.rows[0].n + 1,
    );
    expect(
      reached,
      "risk.created delivery row did not land after a wrapped POST — β1 pgElevated " +
        "insulation is not holding under the asTenant wrap",
    ).toBeGreaterThanOrEqual(before.rows[0].n + 1);
  });

  it("POST /risks/:id/review → 200 (savepoint commits within the request tx) and the risk.reviewed audit row lands", async () => {
    const target = await seedRisk(ownerPool, seed.orgA.id, { title: "review target" });
    const before = await ownerPool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM security_audit_log WHERE organization_id = $1 AND event_type = 'risk.reviewed'",
      [seed.orgA.id],
    );

    const res = await request(app)
      .post(`/api/risks/${target}/review`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ reviewed_at: "2026-06-01" });

    expect(res.status).toBe(200);
    expect(res.body?.cadence_days_used).toBeGreaterThan(0);

    // The inner BEGIN/COMMIT runs as SAVEPOINT/RELEASE inside the outer request
    // tx; the row's next_review_due must be persisted once the outer tx commits.
    const persisted = await waitForCount(
      ownerPool,
      "SELECT count(*)::int AS n FROM risks WHERE id = $1 AND last_reviewed_at IS NOT NULL",
      [target],
      1,
    );
    expect(persisted, "review did not persist after the wrapped COMMIT").toBeGreaterThanOrEqual(1);

    // writeAuditEvent is fire-and-forget on pgElevated — survives the wrap.
    const audited = await waitForCount(
      ownerPool,
      "SELECT count(*)::int AS n FROM security_audit_log WHERE organization_id = $1 AND event_type = 'risk.reviewed'",
      [seed.orgA.id],
      before.rows[0].n + 1,
    );
    expect(audited, "risk.reviewed audit row did not land via pgElevated").toBeGreaterThanOrEqual(
      before.rows[0].n + 1,
    );
  });

  it("PATCH /risks/:id → 200 and the change persists", async () => {
    const target = await seedRisk(ownerPool, seed.orgA.id, { title: "patch target" });

    const res = await request(app)
      .patch(`/api/risks/${target}`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ status: "mitigated" });

    expect(res.status).toBe(200);
    expect(res.body?.risk?.status).toBe("mitigated");

    const closed = await waitForCount(
      ownerPool,
      "SELECT count(*)::int AS n FROM risks WHERE id = $1 AND status = 'mitigated'",
      [target],
      1,
    );
    expect(closed, "PATCH did not persist after the wrapped COMMIT").toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// Cross-org tripwires — WHERE-clause isolation (NOT RLS; see file header).
// RLS certification is deferred to the phase-3 Batch-A risks policy migration.
// ===========================================================================

describe("A04-G1 PR γ.1 — risks wrap: cross-org tripwires (WHERE-clause, RLS deferred to Batch A)", () => {
  it("GET /risks lists only the caller org's risks (tripwire, not an RLS proof)", async () => {
    const res = await request(app).get("/api/risks").set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    const ids = (res.body?.risks ?? []).map((r: { id: string }) => r.id);
    expect(ids).toContain(riskA);
    expect(ids).not.toContain(riskB);
  });

  it("GET /risks/:id of another org's risk → 404 (tripwire)", async () => {
    const res = await request(app).get(`/api/risks/${riskB}`).set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(404);
  });

  it("GET /risks/intelligence excludes another org's risk (tripwire)", async () => {
    const res = await request(app)
      .get("/api/risks/intelligence")
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    const ids = (res.body?.risks ?? []).map((r: { id: string }) => r.id);
    expect(ids).toContain(riskA);
    expect(ids).not.toContain(riskB);
  });

  it("GET /risks/:id/history of another org's risk → 404, not an empty list (tripwire)", async () => {
    const res = await request(app)
      .get(`/api/risks/${riskB}/history`)
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(404);
  });

  it("review/PATCH cannot touch another org's risk → 404 each, row unchanged (tripwire)", async () => {
    const before = await ownerPool.query<{ status: string }>(
      "SELECT status FROM risks WHERE id = $1",
      [riskB],
    );

    const reviewRes = await request(app)
      .post(`/api/risks/${riskB}/review`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({});
    expect(reviewRes.status).toBe(404);

    const patchRes = await request(app)
      .patch(`/api/risks/${riskB}`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ status: "closed" });
    expect(patchRes.status).toBe(404);

    const after = await ownerPool.query<{ status: string }>(
      "SELECT status FROM risks WHERE id = $1",
      [riskB],
    );
    expect(after.rows[0]?.status).toBe(before.rows[0]?.status);
  });
});

// ===========================================================================
// Transaction-shape — savepoint balance + early-return rollbacks under the wrap
// ===========================================================================

describe("A04-G1 PR γ.1 — risks wrap: savepoint + early-return rollback shape", () => {
  it("review of a non-existent id → 404 (inner ROLLBACK pops only sp_1) and a later valid review still succeeds", async () => {
    // The 404 path runs the inner `client.query("ROLLBACK")` which the savepoint
    // client rewrites to ROLLBACK TO sp_1; RELEASE sp_1 — balancing the stack
    // without rolling back the outer request tx. If that left the pooled
    // connection poisoned, the FOLLOWING request on the same pool would fail.
    const notFound = await request(app)
      .post(`/api/risks/${ABSENT_UUID}/review`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({});
    expect(notFound.status).toBe(404);

    const target = await seedRisk(ownerPool, seed.orgA.id, { title: "post-rollback review" });
    const ok = await request(app)
      .post(`/api/risks/${target}/review`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({});
    expect(
      ok.status,
      "a valid review after a 404-rollback failed — the stray inner ROLLBACK " +
        "poisoned the pooled connection (mismatched-pop guard not holding)",
    ).toBe(200);
  });

  it("PATCH with a foreign owner_user_id → 400 and the attempted change does NOT persist (early ROLLBACK balances the savepoint)", async () => {
    const target = await seedRisk(ownerPool, seed.orgA.id, { title: "owner-rollback target" });

    const res = await request(app)
      .patch(`/api/risks/${target}`)
      .set("X-Api-Key", seed.orgA.apiKey)
      // title would change, but the foreign owner_user_id triggers the
      // resolveOwnerUserSameOrg failure → ROLLBACK before the UPDATE runs.
      .send({ title: "SHOULD NOT PERSIST", owner_user_id: ABSENT_UUID });
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe("invalid_owner_user_id");

    // The title must be unchanged on the owner pool — nothing was committed.
    const row = await ownerPool.query<{ title: string }>(
      "SELECT title FROM risks WHERE id = $1",
      [target],
    );
    expect(row.rows[0]?.title).toBe("owner-rollback target");
  });
});
