/**
 * webhookDispatcherElevated.test.ts — A04-G1 PR β1: prove the webhook dispatcher
 * is insulated from any request-path tenant scope by talking to the DB through
 * `pgElevated` (the owner pool), not the ambient `pg` proxy.
 *
 * Why this matters
 * ----------------
 * The dispatcher runs as fire-and-forget continuations: the caller routes
 * (findings/risks/posture/vendorAssessments write paths) invoke
 * `dispatchWebhookEvent(...)` WITHOUT awaiting, and the dispatcher itself fans
 * out to `deliverWebhook(...)` per endpoint WITHOUT awaiting. Once those routes
 * are wrapped in `asTenant()` (β2+), an ambient `pg.query()` inside the
 * dispatcher would execute as a continuation AFTER the request transaction has
 * committed and released its tenant client — a use-after-release on the pooled
 * connection: the delivery write would target a client that is back in the pool
 * (possibly serving another request). β1 moves the dispatcher to `pgElevated`,
 * a separate owner pool whose `.query()` bypasses the tenant AsyncLocalStorage
 * entirely, so its connection lifecycle is independent of any caller scope.
 *
 * Simulating the post-flip world
 * ------------------------------
 * Production still connects as the owner today (pgElevated == the same target
 * as the request pool), so the fix is a runtime no-op until the operator flip.
 * To exercise the post-flip split now we point the *request* pool at the
 * `app_request` role (libpq `options=-c role=app_request`, the same device PR
 * α's findingsTenantWrap.test.ts uses) while leaving `pgElevated` on the owner
 * via MIGRATION_DATABASE_URL. Both env vars are read by infra/postgres.ts at
 * module load, so they are set BEFORE the dynamic import below.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  bootstrapTestDb,
  seedWebhookEndpoint,
  type TestDbSeed,
} from "./testDb.js";

// Resolved after the post-flip env is applied + modules dynamically imported.
let dispatchWebhookEvent: typeof import("../../src/api/lib/webhookDispatcher.js")["dispatchWebhookEvent"];
let withTenant: typeof import("../../src/api/infra/postgres.js")["withTenant"];
let pg: typeof import("../../src/api/infra/postgres.js")["pg"];
let pgElevated: typeof import("../../src/api/infra/postgres.js")["pgElevated"];

let seed: TestDbSeed;
let ownerPool: Pool; // owner connection for seeding + reading deliveries
let originalDatabaseUrl: string | undefined;
let originalMigrationUrl: string | undefined;

/** Poll until the query's first column (an int count) reaches `atLeast`, or time out. */
async function waitForCount(
  pool: Pool,
  sql: string,
  params: unknown[],
  atLeast: number,
  timeoutMs = 4000,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let last = -1;
  // Fixed-iteration poll (no Date.now in the loop body decisioning beyond the
  // deadline guard) — ~20ms cadence.
  while (Date.now() < deadline) {
    const r = await pool.query<{ n: number }>(sql, params);
    last = r.rows[0]?.n ?? 0;
    if (last >= atLeast) return last;
    await new Promise((res) => setTimeout(res, 20));
  }
  return last;
}

beforeAll(async () => {
  // Full schema rebuild + app_request role + two seeded orgs (owner connection).
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set for the dispatcher β1 test.");
  }

  // Owner pool: seed the endpoint and read webhook_deliveries for assertions.
  ownerPool = new Pool({ connectionString: url, ssl: false });
  await seedWebhookEndpoint(ownerPool, seed.orgA.id);

  // Simulate the operator flip WITHOUT performing it:
  //   request pool  (DATABASE_URL)          → app_request  (NOBYPASSRLS, non-owner)
  //   elevated pool (MIGRATION_DATABASE_URL) → owner        (the dispatcher's channel)
  originalDatabaseUrl = process.env.DATABASE_URL;
  originalMigrationUrl = process.env.MIGRATION_DATABASE_URL;
  process.env.DATABASE_URL =
    url +
    (url.includes("?") ? "&" : "?") +
    "options=" +
    encodeURIComponent("-c role=app_request");
  process.env.MIGRATION_DATABASE_URL = url;

  const postgres = await import("../../src/api/infra/postgres.js");
  pg = postgres.pg;
  pgElevated = postgres.pgElevated;
  withTenant = postgres.withTenant;
  ({ dispatchWebhookEvent } = await import(
    "../../src/api/lib/webhookDispatcher.js"
  ));
}, 120_000);

afterAll(async () => {
  await ownerPool?.end();
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalMigrationUrl === undefined) delete process.env.MIGRATION_DATABASE_URL;
  else process.env.MIGRATION_DATABASE_URL = originalMigrationUrl;
});

describe("A04-G1 PR β1 — webhook dispatcher uses pgElevated, insulated from request scope", () => {
  it("control: request pool runs as app_request, pgElevated runs as the owner (channels are distinct post-flip)", async () => {
    const reqRole = await pg.query<{ role: string }>("SELECT current_user AS role");
    const elevRole = await pgElevated.query<{ role: string }>("SELECT current_user AS role");

    expect(
      reqRole.rows[0].role,
      "request pool should be app_request under the simulated flip",
    ).toBe("app_request");
    expect(
      elevRole.rows[0].role,
      "pgElevated (the dispatcher's channel) must NOT be app_request — it is the owner",
    ).not.toBe("app_request");
  });

  it("dispatch with no active scope writes its delivery via pgElevated under the simulated flip", async () => {
    const before = await ownerPool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM webhook_deliveries WHERE organization_id = $1",
      [seed.orgA.id],
    );

    await dispatchWebhookEvent({
      event_type: "finding.created",
      organization_id: seed.orgA.id,
      data: { id: "no-scope" },
    });

    const reached = await waitForCount(
      ownerPool,
      "SELECT count(*)::int AS n FROM webhook_deliveries WHERE organization_id = $1",
      [seed.orgA.id],
      before.rows[0].n + 1,
    );
    expect(reached).toBeGreaterThanOrEqual(before.rows[0].n + 1);
  });

  it("use-after-release proof: dispatch fired from INSIDE a committed+released tenant scope still writes its delivery", async () => {
    // Mimic a wrapped route (β2): fire the dispatch from inside withTenant
    // WITHOUT awaiting it, then let the scope commit + release its app_request
    // client. The dispatcher's SELECT + per-endpoint deliverWebhook
    // continuations then run AFTER that client is released. With the β1 fix
    // they execute on pgElevated (owner) and the delivery row lands; with the
    // pre-β1 ambient-pg dispatcher the INSERT/UPDATE would target the released
    // tenant client and the row would never be written.
    const before = await ownerPool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM webhook_deliveries WHERE organization_id = $1",
      [seed.orgA.id],
    );

    let dispatchPromise: Promise<void> | undefined;
    await withTenant(seed.orgA.id, async () => {
      // Not awaited inside the scope — exactly how the route handlers call it.
      dispatchPromise = dispatchWebhookEvent({
        event_type: "finding.updated",
        organization_id: seed.orgA.id,
        data: { id: "after-release" },
      });
      // scope body returns here → withTenant COMMITs + RELEASEs the client
    });
    await dispatchPromise; // resolves after the SELECT + non-awaited fan-out kickoff

    const reached = await waitForCount(
      ownerPool,
      "SELECT count(*)::int AS n FROM webhook_deliveries WHERE organization_id = $1",
      [seed.orgA.id],
      before.rows[0].n + 1,
    );
    expect(
      reached,
      "dispatcher failed to write a delivery row after the tenant scope closed — " +
        "the dispatcher is NOT insulated from the released request client (β1 regressed)",
    ).toBeGreaterThanOrEqual(before.rows[0].n + 1);
  });
});
