/**
 * findingsTenantWrap.test.ts — A04-G1 PR α: end-to-end proof that the asTenant
 * wrap enforces tenant isolation on the findings READ routes AS IF the engine
 * connected as the non-owner `app_request` role — WITHOUT performing the
 * operator DATABASE_URL flip.
 *
 * Simulating the flip
 * -------------------
 * Production connects as the DB owner today, which BYPASSES RLS, so the wrap is
 * a runtime no-op until the operator repoints DATABASE_URL to app_request
 * (A04-G1 phase 3). To exercise the post-flip behavior now, we point the
 * application's request-path pool at the SAME database but make every session
 * assume the non-owner `app_request` role at startup — a libpq `options` GUC
 * (`-c role=app_request`) appended to the URL the app reads from DATABASE_URL.
 * The harness DB superuser can assume app_request with no password — the same
 * device findingsRls.test.ts uses (SET LOCAL ROLE). After the switch the app's
 * connections are NOBYPASSRLS and not the table owner, so the findings RLS
 * policy (20260619_findings_rls_pilot.sql) applies exactly as it will in
 * production after the flip. The separate seeding pool is left as the owner
 * (RLS bypassed) so it can plant rows for both orgs.
 *
 * What this proves
 * ----------------
 *   - Positive control: org A GETs its own finding → 200 with that finding.
 *     This can ONLY pass if asTenant set app.current_org_id for the request:
 *     under app_request an unset GUC fails closed to zero rows (the NULLIF
 *     policy), so a 200 carrying the row is direct proof — over the real HTTP
 *     stack — that the wrap opened the scope and set the GUC.
 *   - Cross-org: org B GETs org A's finding → 404 (RLS filters it out).
 *   - List: org A's GET /findings returns its own finding and not org B's.
 *   - Fail-closed control: an UNSCOPED read on the same (app_request) pool sees
 *     zero rows — confirming the pool really runs as app_request (an owner pool
 *     would see both rows) and demonstrating the outage the wrap exists to
 *     prevent on every org-scoped read once the flip happens.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import {
  bootstrapTestDb,
  seedFinding,
  seedWebhookEndpoint,
  type TestDbSeed,
} from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let ownerPool: Pool; // seeds as owner — bypasses RLS
let findingA: string;
let findingB: string;
let originalDatabaseUrl: string | undefined;
let originalMigrationUrl: string | undefined;

beforeAll(async () => {
  // Drops + applies the full migration set (creates app_request, enables RLS on
  // findings) + seeds the two orgs and their API keys.
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set for the findings wrap test.");
  }

  // Seed one finding per org as the owner (RLS bypassed). This pool is separate
  // from the app's pool and is NEVER given SET ROLE — seeding must see all orgs.
  ownerPool = new Pool({ connectionString: url, ssl: false });
  findingA = await seedFinding(ownerPool, seed.orgA.id);
  findingB = await seedFinding(ownerPool, seed.orgB.id);
  // Active webhook endpoint for org A so the POST write path exercises
  // dispatchWebhookEvent (β1: now pgElevated-backed). Loopback URL → the SSRF
  // guard rejects it deterministically (no network), but the delivery row is
  // still INSERTed, which is what the β2 dispatch-survival case asserts.
  await seedWebhookEndpoint(ownerPool, seed.orgA.id);

  // Simulate the operator's DATABASE_URL → app_request flip without performing
  // it: point the app's REQUEST pool at the same DB but assume app_request at
  // session start via a libpq `options` GUC, AND pin pgElevated to the owner via
  // MIGRATION_DATABASE_URL — faithfully modelling the post-flip split (request
  // pool = app_request, elevated/dispatcher channel = owner). infra/postgres.ts
  // reads both at module load, so they MUST be set before the dynamic import
  // below. The seeding pool above keeps the unmodified (owner) URL.
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
  // The app pool is left to process teardown (its connections may still be
  // serving fire-and-forget usage writes); only close the seeding pool here.
  await ownerPool?.end();
  // Restore the mutated env so it cannot leak to another test file
  // (setup.ts also resets DATABASE_URL per file; this is belt-and-suspenders).
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalMigrationUrl === undefined) delete process.env.MIGRATION_DATABASE_URL;
  else process.env.MIGRATION_DATABASE_URL = originalMigrationUrl;
});

describe("A04-G1 PR α — asTenant wrap enforces findings isolation as app_request", () => {
  it("positive control: org A GETs its own finding (200) — proves the wrap set the GUC", async () => {
    const res = await request(app)
      .get(`/api/findings/${findingA}`)
      .set("X-Api-Key", seed.orgA.apiKey);

    expect(
      res.status,
      "POSITIVE CONTROL FAILED: under app_request an unset GUC fails closed to " +
        "zero rows → 404. A 200 here means asTenant opened the scope and set " +
        "app.current_org_id over the HTTP stack.",
    ).toBe(200);
    expect(res.body?.finding?.id).toBe(findingA);
    expect(res.body?.finding?.organization_id).toBe(seed.orgA.id);
  });

  it("cross-org: org B cannot GET org A's finding (404) — RLS filters it out", async () => {
    const res = await request(app)
      .get(`/api/findings/${findingA}`)
      .set("X-Api-Key", seed.orgB.apiKey);

    expect(res.status).toBe(404);
  });

  it("list: org A's GET /findings returns only its own finding", async () => {
    const res = await request(app)
      .get("/api/findings")
      .set("X-Api-Key", seed.orgA.apiKey);

    expect(res.status).toBe(200);
    const ids = (res.body?.findings ?? []).map((f: { id: string }) => f.id);
    expect(ids).toContain(findingA);
    expect(ids).not.toContain(findingB);
  });

  it("fail-closed control: an UNSCOPED read on the app pool sees zero rows (pool really is app_request)", async () => {
    const { pg } = await import("../../src/api/infra/postgres.js");
    // No withTenant scope active → routes to the raw app pool (app_request, GUC
    // unset/reset). An owner pool would return both seeded rows; app_request
    // with the NULLIF fail-closed policy returns none.
    const r = await pg.query("SELECT id FROM findings");
    expect(r.rowCount).toBe(0);
  });
});

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

describe("A04-G1 PR β2 — asTenant wrap enforces findings isolation on WRITE paths", () => {
  it("positive control: org A POSTs a finding (201) and can GET it back — proves the wrap set the GUC for the INSERT's WITH CHECK and the read", async () => {
    const res = await request(app)
      .post("/api/findings")
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({
        title: "β2 created finding",
        severity: "High",
        source_type: "manual",
        description: "created under the asTenant write wrap",
      });

    expect(
      res.status,
      "POSITIVE CONTROL FAILED: under app_request the findings RLS WITH CHECK " +
        "rejects an INSERT whose org GUC is unset (NULLIF fail-closed). A 201 " +
        "proves asTenant opened the scope + set app.current_org_id for the write.",
    ).toBe(201);
    const createdId = res.body?.finding?.id as string;
    expect(createdId).toBeTruthy();
    expect(res.body?.finding?.organization_id).toBe(seed.orgA.id);

    // The wrapped GET must see the row org A just created (read-scope works too).
    const getRes = await request(app)
      .get(`/api/findings/${createdId}`)
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(getRes.status).toBe(200);
    expect(getRes.body?.finding?.id).toBe(createdId);
  });

  it("positive: org A PATCHes its own finding (200) and the change persists", async () => {
    const res = await request(app)
      .patch(`/api/findings/${findingA}`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ status: "closed" });

    expect(res.status).toBe(200);
    expect(res.body?.finding?.status).toBe("closed");

    // Confirm via the owner pool (RLS-bypassing) that the row really changed.
    // The asTenant wrap flushes the HTTP response from INSIDE the request
    // transaction; withTenant issues COMMIT only after the handler promise
    // resolves. So this supertest call returns before the COMMIT lands, and a
    // read on the separate owner pool can race it. Poll until the committed
    // value is visible (mirrors the webhook-delivery-row wait below) rather
    // than reading once and flaking under load.
    const closed = await waitForCount(
      ownerPool,
      "SELECT count(*)::int AS n FROM findings WHERE id = $1 AND status = 'closed'",
      [findingA],
      1,
    );
    expect(
      closed,
      "PATCH did not persist as 'closed' on the owner pool within the timeout — " +
        "the wrapped UPDATE's COMMIT never landed",
    ).toBeGreaterThanOrEqual(1);
  });

  it("cross-org: org A's PATCH cannot touch org B's finding (404, row unchanged) — RLS scopes the UPDATE", async () => {
    const before = await ownerPool.query<{ status: string }>(
      "SELECT status FROM findings WHERE id = $1",
      [findingB],
    );

    const res = await request(app)
      .patch(`/api/findings/${findingB}`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ status: "closed" });

    // Under RLS the UPDATE … WHERE matches zero rows → handler returns 404.
    expect(res.status).toBe(404);

    // Org B's finding must be untouched.
    const after = await ownerPool.query<{ status: string }>(
      "SELECT status FROM findings WHERE id = $1",
      [findingB],
    );
    expect(after.rows[0]?.status).toBe(before.rows[0]?.status);
  });

  it("webhook dispatch survives the wrap: POST that fires dispatchWebhookEvent completes (201) and the delivery row lands via pgElevated", async () => {
    const before = await ownerPool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM webhook_deliveries WHERE organization_id = $1 AND event_type = 'finding.created'",
      [seed.orgA.id],
    );

    const res = await request(app)
      .post("/api/findings")
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({
        title: "β2 finding with webhook",
        severity: "Critical",
        source_type: "manual",
        description: "should trigger a webhook delivery row",
      });
    expect(res.status).toBe(201);

    // dispatchWebhookEvent is fire-and-forget; poll for the delivery row. If the
    // wrap had left the dispatcher on the request's tenant client (pre-β1), the
    // INSERT would hit a committed+released connection and no row would appear.
    const reached = await waitForCount(
      ownerPool,
      "SELECT count(*)::int AS n FROM webhook_deliveries WHERE organization_id = $1 AND event_type = 'finding.created'",
      [seed.orgA.id],
      before.rows[0].n + 1,
    );
    expect(
      reached,
      "webhook delivery row did not land after a wrapped POST — the β1 pgElevated " +
        "insulation is not holding under the actual asTenant wrap",
    ).toBeGreaterThanOrEqual(before.rows[0].n + 1);
  });
});
