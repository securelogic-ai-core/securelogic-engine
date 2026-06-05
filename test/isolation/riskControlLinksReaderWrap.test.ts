/**
 * riskControlLinksReaderWrap.test.ts — A04-G1 reader-surface wrap track, sub-wave
 * 0a: end-to-end proof that wrapping the three JSON riskControlLinks routes
 * (POST /risks/:id/controls, GET /risks/:id/controls, GET /controls/:id/risks) in
 * asTenant() keeps them working when the engine connects as the non-owner
 * `app_request` role, and that the RLS-policied `risks` table each route reads is
 * correctly scoped by the GUC the wrap sets.
 *
 * The DELETE route (deleteRiskControlLink) is intentionally NOT exercised here:
 * it is deferred to Wave 0d (its terminal is res.status(204).send(), which the
 * asTenant streaming guard rejects), so it is wired UNWRAPPED and testing it
 * would either pass trivially (no isolation) or fail for the wrong reason.
 *
 * WHAT THIS FILE CERTIFIES (and what it defers) — read before adding asserts
 * -------------------------------------------------------------------------
 * `risk_control_links` and `controls` have NO RLS policy yet (Batch A / phase-3,
 * not yet landed for these tables), so for them this file is a WHERE-CLAUSE
 * tripwire exactly like postureTenantWrap.test.ts: the cross-org assertions pass
 * today because every handler filters `organization_id = $1`, NOT because the
 * database enforces a policy. The tripwire exists so a future refactor that drops
 * the WHERE clause is still caught before those tables' policies land.
 *
 * `risks`, however, DOES carry a live RLS policy (20260620_batch_a1_rls_policies
 * .sql). All three routes touch `risks` with NO reliance on the GUC in their own
 * SQL beyond the WHERE filter:
 *   - POST + GET-forward gate on a `SELECT 1 FROM risks WHERE id=$1 AND
 *     organization_id=$2` pre-flight check;
 *   - GET-inverse JOINs `risks r` in its main query.
 * Under `app_request` an UNWRAPPED handler sets no `app.current_org_id` GUC, so
 * the NULLIF risks policy fails CLOSED: the pre-flight returns zero rows (→ 404)
 * and the JOIN admits zero rows (→ empty links). So a SUCCESSFUL read here is a
 * real RLS-propagation proof: POST reaching 201 and the GETs returning their own
 * org's rows can only happen if the asTenant wrap opened the tenant scope and set
 * the GUC, AND the policy then admitted the caller org's own `risks` rows. That
 * is the headline reader-wrap certification for this file — stronger than a pure
 * WHERE-clause tripwire.
 *
 * Simulating the post-flip role split
 * -----------------------------------
 * Identical device to assessmentsReaderWrap/postureTenantWrap/risksTenantWrap:
 * the app's request pool reads DATABASE_URL with a libpq `options=-c
 * role=app_request` GUC so every session assumes the non-owner role at startup,
 * while pgElevated is pinned to the owner via MIGRATION_DATABASE_URL. The seeding
 * pool stays the owner.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, seedRisk, type TestDbSeed } from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let ownerPool: Pool; // seeds + verifies as owner — not the app_request pool
let originalDatabaseUrl: string | undefined;
let originalMigrationUrl: string | undefined;

let aRiskId: string;     // org A's risk
let aControl1Id: string; // org A's control, PRE-LINKED to aRiskId
let aControl2Id: string; // org A's control, NOT linked — for the POST test to link
let bRiskId: string;     // org B's risk (cross-org tripwire)
let bControl1Id: string; // org B's control, PRE-LINKED to bRiskId (cross-org tripwire)

/** Seed one control for an org. Only organization_id + name are NOT NULL. */
async function seedControl(pool: Pool, orgId: string, name: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO controls (organization_id, name) VALUES ($1, $2) RETURNING id`,
    [orgId, name],
  );
  return r.rows[0].id;
}

/** Seed one live risk_control_links row. */
async function seedLink(pool: Pool, orgId: string, riskId: string, controlId: string): Promise<void> {
  await pool.query(
    `INSERT INTO risk_control_links (organization_id, risk_id, control_id, note)
     VALUES ($1, $2, $3, 'harness seed link')`,
    [orgId, riskId, controlId],
  );
}

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set for the riskControlLinks reader wrap test.");
  }

  ownerPool = new Pool({ connectionString: url, ssl: false });

  aRiskId = await seedRisk(ownerPool, seed.orgA.id, { title: "Org A risk" });
  aControl1Id = await seedControl(ownerPool, seed.orgA.id, "Org A control 1");
  aControl2Id = await seedControl(ownerPool, seed.orgA.id, "Org A control 2");
  await seedLink(ownerPool, seed.orgA.id, aRiskId, aControl1Id);

  bRiskId = await seedRisk(ownerPool, seed.orgB.id, { title: "Org B risk" });
  bControl1Id = await seedControl(ownerPool, seed.orgB.id, "Org B control 1");
  await seedLink(ownerPool, seed.orgB.id, bRiskId, bControl1Id);

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
// Functional under app_request + RLS-propagation proof on the risks reads
// ===========================================================================

describe("A04-G1 reader-wrap 0a — riskControlLinks wrap: functional under app_request", () => {
  it("harness control: the app request pool really runs as app_request", async () => {
    const { pg } = await import("../../src/api/infra/postgres.js");
    const r = await pg.query<{ current_user: string }>("SELECT current_user");
    expect(r.rows[0]?.current_user).toBe("app_request");
  });

  it("POST /risks/:id/controls → 201 links a control (RLS-policied risks pre-flight resolves under the wrap GUC)", async () => {
    const res = await request(app)
      .post(`/api/risks/${aRiskId}/controls`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ control_id: aControl2Id });
    // The handler gates on `SELECT 1 FROM risks WHERE id=$1 AND organization_id=$2`
    // before inserting. Under app_request the risks policy fails CLOSED with no
    // GUC → that pre-flight returns 0 → 404. A 201 here proves the wrap set the
    // GUC and the policy admitted org A's own risk.
    expect(
      res.status,
      "POST failed under app_request — wrap GUC did not propagate to the risks pre-flight (would 404) or app_request is missing a grant",
    ).toBe(201);
    expect(res.body?.created).toBe(true);
    expect(res.body?.link?.risk_id).toBe(aRiskId);
    expect(res.body?.link?.control_id).toBe(aControl2Id);
  });

  it("GET /risks/:id/controls → 200 lists the caller org's linked controls (risks pre-flight resolves under the wrap GUC)", async () => {
    const res = await request(app)
      .get(`/api/risks/${aRiskId}/controls`)
      .set("X-Api-Key", seed.orgA.apiKey);
    // Same risks pre-flight gate — an unwrapped read fails closed to 404.
    expect(
      res.status,
      "GET-forward failed under app_request — the wrap broke the read or the risks pre-flight failed closed",
    ).toBe(200);
    expect(res.body?.organizationId).toBe(seed.orgA.id);
    expect(res.body?.riskId).toBe(aRiskId);
    const linked = (res.body?.links ?? []).find(
      (l: { control_id: string }) => l.control_id === aControl1Id,
    );
    expect(linked, "caller org's own linked control not returned under the wrap").toBeTruthy();
  });

  it("GET /controls/:id/risks → 200 returns risks via a JOIN to the RLS-policied risks table (non-empty proves GUC propagation)", async () => {
    const res = await request(app)
      .get(`/api/controls/${aControl1Id}/risks`)
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    expect(res.body?.controlId).toBe(aControl1Id);
    // The main query JOINs `risks r` (RLS-policied). With no GUC the policy fails
    // closed and the JOIN yields zero rows → empty links. A non-empty result that
    // contains org A's risk is the strongest RLS-propagation signal: it can only
    // happen because the wrap opened the tenant scope and set the GUC.
    const linked = (res.body?.links ?? []).find(
      (l: { risk_id: string }) => l.risk_id === aRiskId,
    );
    expect(
      linked,
      "policied risks JOIN returned no row under the wrap — GUC did not propagate",
    ).toBeTruthy();
  });
});

// ===========================================================================
// Cross-org tripwires — WHERE-clause isolation on the two GET readers.
// (risk_control_links / controls have no RLS policy yet; deferred to phase-3.
// risks IS RLS-enforced, but the routes already gate it at the org-check.)
// ===========================================================================

describe("A04-G1 reader-wrap 0a — riskControlLinks wrap: cross-org tripwires", () => {
  it("GET /risks/:id/controls of another org's risk → 404 (tripwire, never 403/200)", async () => {
    const res = await request(app)
      .get(`/api/risks/${bRiskId}/controls`)
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(404);
    expect(res.body?.error).toBe("risk_not_found");
  });

  it("GET /controls/:id/risks of another org's control → 404 (tripwire, never 403/200)", async () => {
    const res = await request(app)
      .get(`/api/controls/${bControl1Id}/risks`)
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(404);
    expect(res.body?.error).toBe("control_not_found");
  });
});
