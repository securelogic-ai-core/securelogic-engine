/**
 * assessmentsReaderWrap.test.ts — A04-G1 reader-surface wrap track, sub-wave 0a:
 * end-to-end proof that wrapping the two read-only `assessments` routes
 * (GET /assessments, GET /assessments/:id) in asTenant() keeps them working when
 * the engine connects as the non-owner `app_request` role, and that the
 * RLS-policied read inside them (`findings`) is correctly scoped by the GUC the
 * wrap sets.
 *
 * WHAT THIS FILE CERTIFIES (and what it defers) — read before adding asserts
 * -------------------------------------------------------------------------
 * `assessments` and `reports` have NO RLS policy yet (Batch A / phase-3, not yet
 * landed), so for those tables this file is a WHERE-CLAUSE tripwire exactly like
 * postureTenantWrap.test.ts: the cross-org assertion passes today because the
 * handler filters `a.organization_id = $1`, NOT because the database enforces a
 * policy. The tripwire exists so a future refactor that drops the WHERE clause is
 * still caught before the Batch-A policy lands.
 *
 * `findings`, however, DOES carry the phase-2 pilot RLS policy
 * (20260619_findings_rls_pilot.sql). The route's findings reads have NO org
 * filter in their SQL — the list subquery is `WHERE f.assessment_id = a.id` and
 * the :id read is `WHERE assessment_id = $1` — they trust that the parent
 * assessment was already org-checked. Under `app_request` an unwrapped handler
 * sets no `app.current_org_id` GUC, so the NULLIF policy fails CLOSED and those
 * findings reads return ZERO rows. So a NON-EMPTY findings result here is a real
 * RLS-propagation proof: it can only happen if the asTenant wrap opened the
 * tenant scope and set the GUC, AND the policy then admitted the caller org's
 * own rows. That is the headline reader-wrap certification for this file —
 * stronger than a pure WHERE-clause tripwire.
 *
 * Simulating the post-flip role split
 * -----------------------------------
 * Identical device to postureTenantWrap/risksTenantWrap: the app's request pool
 * reads DATABASE_URL with a libpq `options=-c role=app_request` GUC so every
 * session assumes the non-owner role at startup, while pgElevated is pinned to
 * the owner via MIGRATION_DATABASE_URL. The seeding pool stays the owner.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let ownerPool: Pool; // seeds + verifies as owner — not the app_request pool
let originalDatabaseUrl: string | undefined;
let originalMigrationUrl: string | undefined;

let aAssessmentId: string; // org A's assessment, with a linked finding
let bAssessmentId: string; // org B's assessment, with a linked finding

/** Seed one assessment (+ report + one linked, org-stamped finding) for an org. */
async function seedAssessmentWithFinding(pool: Pool, orgId: string): Promise<string> {
  const a = await pool.query<{ id: string }>(
    `INSERT INTO assessments (organization_id, type, framework, status, subject_name, completed_at)
     VALUES ($1, 'internal', 'SOC2', 'completed', 'Harness Assessment', NOW())
     RETURNING id`,
    [orgId],
  );
  const assessmentId = a.rows[0].id;
  await pool.query(
    `INSERT INTO reports (assessment_id, organization_id, type, risk_score, summary)
     VALUES ($1, $2, 'assessment', 42.0, 'Harness report summary')`,
    [assessmentId, orgId],
  );
  await pool.query(
    `INSERT INTO findings (organization_id, assessment_id, title, severity, description, source_type)
     VALUES ($1, $2, 'Harness finding', 'High', 'seed finding for assessments reader wrap', 'manual')`,
    [orgId, assessmentId],
  );
  return assessmentId;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set for the assessments reader wrap test.");
  }

  ownerPool = new Pool({ connectionString: url, ssl: false });
  aAssessmentId = await seedAssessmentWithFinding(ownerPool, seed.orgA.id);
  bAssessmentId = await seedAssessmentWithFinding(ownerPool, seed.orgB.id);

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
// Functional under app_request + RLS-propagation proof on the findings read
// ===========================================================================

describe("A04-G1 reader-wrap 0a — assessments wrap: functional under app_request", () => {
  it("harness control: the app request pool really runs as app_request", async () => {
    const { pg } = await import("../../src/api/infra/postgres.js");
    const r = await pg.query<{ current_user: string }>("SELECT current_user");
    expect(r.rows[0]?.current_user).toBe("app_request");
  });

  it("GET /assessments → 200 lists the caller org's assessment with finding_count ≥ 1 (RLS-policied findings subquery resolves under the wrap GUC)", async () => {
    const res = await request(app)
      .get("/api/assessments")
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(
      res.status,
      "GET /assessments failed under app_request — the wrap broke the read or app_request is missing a grant",
    ).toBe(200);
    expect(res.body?.organizationId).toBe(seed.orgA.id);
    const mine = (res.body?.assessments ?? []).find((a: { id: string }) => a.id === aAssessmentId);
    expect(mine, "caller org's own assessment not returned under the wrap").toBeTruthy();
    // finding_count comes from an RLS-policied findings subquery with NO org
    // filter in SQL → non-zero ONLY if the wrap set the GUC and the policy
    // admitted org A's rows. An unwrapped read would fail closed to 0.
    expect(mine.finding_count, "RLS-policied findings subquery returned 0 — wrap GUC did not propagate").toBeGreaterThanOrEqual(1);
  });

  it("GET /assessments/:id → 200 returns the assessment and its RLS-policied findings (findingCount ≥ 1)", async () => {
    const res = await request(app)
      .get(`/api/assessments/${aAssessmentId}`)
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    expect(res.body?.assessment?.id).toBe(aAssessmentId);
    expect(res.body?.assessment?.organizationId).toBe(seed.orgA.id);
    // The :id findings read (`WHERE assessment_id = $1`, no org filter) is the
    // strongest RLS-propagation signal: non-empty proves the wrap GUC reached the
    // policied table.
    expect(res.body?.findingCount, "policied findings read returned 0 under the wrap — GUC not set").toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// Cross-org tripwires — WHERE-clause isolation on `assessments`/`reports`
// (no RLS policy yet; deferred to phase-3 Batch A). findings isolation IS
// RLS-enforced but the route already gates it at the assessment org-check.
// ===========================================================================

describe("A04-G1 reader-wrap 0a — assessments wrap: cross-org tripwires (WHERE-clause, assessments RLS deferred to Batch A)", () => {
  it("GET /assessments never lists another org's assessment (tripwire)", async () => {
    const res = await request(app)
      .get("/api/assessments")
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    const leaked = (res.body?.assessments ?? []).some((a: { id: string }) => a.id === bAssessmentId);
    expect(leaked, "org A's list leaked org B's assessment").toBe(false);
  });

  it("GET /assessments/:id of another org's assessment → 404 (tripwire, never 403/200)", async () => {
    const res = await request(app)
      .get(`/api/assessments/${bAssessmentId}`)
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(404);
    expect(res.body?.error).toBe("assessment_not_found");
  });
});
