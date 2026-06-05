/**
 * dashboardReaderWrap.test.ts — A04-G1 reader-surface wrap track, sub-wave 0a,
 * sub-PR 3: end-to-end proof that wrapping the single dashboard JSON route
 * (GET /dashboard/summary) in asTenant() keeps it working when the engine
 * connects as the non-owner `app_request` role, and that EACH of the three
 * RLS-policied tables the route aggregates is correctly scoped by the GUC the
 * wrap sets.
 *
 * dashboard.ts is the single-route file of Wave 0a — there is no DELETE / no
 * .send()/.end()/.write() terminal, so the classification is clean γ.2-light
 * with NO route deferred to Wave 0d (contrast the two link-table files, which
 * shed a 204-send DELETE to 0d). One route, all `res.status(n).json(body)`
 * terminals (200/403/500).
 *
 * WHAT THIS FILE CERTIFIES — strongest RLS-propagation cert in Wave 0a so far
 * --------------------------------------------------------------------------
 * The dashboard reads THREE already-policied tables in one request:
 *   - findings           (RLS policy from the phase-2 pilot)
 *   - risks              (RLS policy from 20260620_batch_a1_rls_policies.sql)
 *   - posture_snapshots  (RLS policy from 20260620_batch_a1_rls_policies.sql)
 * Prior Wave 0a sub-PRs certified at most ONE policied table; this file
 * certifies all three, on BOTH halves of the propagation argument:
 *
 *   (a) FAIL-CLOSED WITHOUT THE GUC. A bare `pg.query` (no asTenant scope) runs
 *       as app_request with no `app.current_org_id` set, so the NULLIF(...)
 *       policy on each of the three tables resolves to NULL and admits ZERO
 *       rows — even though the owner-seeded rows physically exist. This is the
 *       negative baseline.
 *   (b) ADMITTED UNDER THE WRAP. The wrapped GET /dashboard/summary returns the
 *       caller org's real counts for all three tables. A non-zero count can
 *       only happen if the asTenant wrap opened the tenant scope and set the
 *       GUC, AND the policy then admitted the caller org's own rows.
 *
 * Unlike the link-table routes (which gate on a fail-closed `SELECT 1 FROM
 * risks ...` pre-flight → 404), the dashboard NEVER errors on empty data — the
 * "null posture rule" returns 200 with zeros. So the propagation proof here is
 * COUNT-based, not status-based: the route returning 200-with-real-counts vs
 * 200-with-zeros is the signal.
 *
 * Cross-org isolation
 * -------------------
 * Org A and Org B are seeded with DIFFERENT counts. The dashboard for org A
 * must reflect ONLY org A's numbers (never org B's, never the sum) — both the
 * `WHERE organization_id = $1` filter and the RLS policy enforce this.
 *
 * Grant coverage (dashboard-specific hazard)
 * ------------------------------------------
 * dashboard reads ~14 tables. Under Option Y (table-by-table grants, no
 * ALTER DEFAULT PRIVILEGES, with a Tier D = NO GRANT class) a single un-granted
 * table would 500 the wrapped call. All 14 dashboard-read tables are Tier A
 * (SELECT granted) per 20260618_create_app_request_role.sql — verified before
 * wrapping. The positive-read test below is the runtime guard against a future
 * regression here.
 *
 * Simulating the post-flip role split
 * -----------------------------------
 * Identical device to assessmentsReaderWrap/riskControlLinksReaderWrap: the
 * app's request pool reads DATABASE_URL with a libpq `options=-c
 * role=app_request` GUC so every session assumes the non-owner role at startup,
 * while pgElevated is pinned to the owner via MIGRATION_DATABASE_URL. The
 * seeding pool stays the owner.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import {
  bootstrapTestDb,
  seedFinding,
  seedRisk,
  seedPostureSnapshot,
  type TestDbSeed,
} from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let ownerPool: Pool; // seeds + verifies as owner — not the app_request pool
let originalDatabaseUrl: string | undefined;
let originalMigrationUrl: string | undefined;

// Org A seeded counts (the caller under test).
const A_FINDINGS = 2;
const A_RISKS = 1;
const A_POSTURE_SCORE = 75;

// Org B seeded counts — DIFFERENT from A so the cross-org tripwire is meaningful
// (org A's dashboard must never show these).
const B_FINDINGS = 3;
const B_RISKS = 2;
const B_POSTURE_SCORE = 40;

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set for the dashboard reader wrap test.");
  }

  ownerPool = new Pool({ connectionString: url, ssl: false });

  // Org A — 2 findings (status defaults to 'open'), 1 residual-rated risk, 1 posture snapshot.
  for (let i = 0; i < A_FINDINGS; i++) await seedFinding(ownerPool, seed.orgA.id);
  for (let i = 0; i < A_RISKS; i++) await seedRisk(ownerPool, seed.orgA.id, { title: `Org A risk ${i}` });
  await seedPostureSnapshot(ownerPool, seed.orgA.id, {
    snapshotDate: "2026-02-01",
    overallScore: A_POSTURE_SCORE,
  });

  // Org B — different counts, never to appear in org A's dashboard.
  for (let i = 0; i < B_FINDINGS; i++) await seedFinding(ownerPool, seed.orgB.id);
  for (let i = 0; i < B_RISKS; i++) await seedRisk(ownerPool, seed.orgB.id, { title: `Org B risk ${i}` });
  await seedPostureSnapshot(ownerPool, seed.orgB.id, {
    snapshotDate: "2026-02-01",
    overallScore: B_POSTURE_SCORE,
  });

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

/** GET the dashboard summary for an org as app_request through the wrap. */
async function getSummary(apiKey: string) {
  return request(app).get("/api/dashboard/summary").set("X-Api-Key", apiKey);
}

// ===========================================================================
// Harness control + the FAIL-CLOSED-WITHOUT-GUC negative baseline (half a).
// Each policied table must admit ZERO rows to a bare app_request query.
// ===========================================================================

describe("A04-G1 reader-wrap 0a — dashboard wrap: app_request + policy baseline", () => {
  it("harness control: the app request pool really runs as app_request", async () => {
    const { pg } = await import("../../src/api/infra/postgres.js");
    const r = await pg.query<{ current_user: string }>("SELECT current_user");
    expect(r.rows[0]?.current_user).toBe("app_request");
  });

  it("RLS baseline — all 3 policied tables fail CLOSED for a bare app_request query (no GUC set)", async () => {
    const { pg } = await import("../../src/api/infra/postgres.js");
    // No asTenant scope → no `app.current_org_id` → NULLIF policy admits 0 rows,
    // even though ownerPool seeded these rows. This is the negative half of the
    // propagation proof, asserted for ALL THREE policied tables the route reads.
    const findings = await pg.query<{ c: number }>(
      "SELECT COUNT(*)::int AS c FROM findings WHERE organization_id = $1",
      [seed.orgA.id],
    );
    const risks = await pg.query<{ c: number }>(
      "SELECT COUNT(*)::int AS c FROM risks WHERE organization_id = $1",
      [seed.orgA.id],
    );
    const posture = await pg.query<{ c: number }>(
      "SELECT COUNT(*)::int AS c FROM posture_snapshots WHERE organization_id = $1",
      [seed.orgA.id],
    );
    expect(findings.rows[0]?.c, "findings policy did not fail closed without a GUC").toBe(0);
    expect(risks.rows[0]?.c, "risks policy did not fail closed without a GUC").toBe(0);
    expect(posture.rows[0]?.c, "posture_snapshots policy did not fail closed without a GUC").toBe(0);
  });
});

// ===========================================================================
// Wrapped route works under app_request, and EACH policied table is admitted
// under the wrap GUC (half b). Non-zero counts ⟹ the wrap set the GUC and the
// policy admitted the caller org's rows.
// ===========================================================================

describe("A04-G1 reader-wrap 0a — dashboard wrap: functional + RLS propagation under the wrap", () => {
  it("GET /dashboard/summary → 200 under app_request (wrap works; all ~14 read tables are granted)", async () => {
    const res = await getSummary(seed.orgA.apiKey);
    expect(
      res.status,
      "dashboard 500'd under app_request — the wrap broke the read or a read table is missing a SELECT grant",
    ).toBe(200);
  });

  it("RLS-propagation probe (findings): dashboard surfaces org A's open findings under the wrap GUC", async () => {
    const res = await getSummary(seed.orgA.apiKey);
    expect(res.status).toBe(200);
    // 0 here would mean the findings policy failed closed inside the wrap (GUC
    // did not propagate to the findings aggregate). Exactly A_FINDINGS proves
    // propagation AND no cross-org bleed.
    expect(
      res.body?.findings?.open,
      "findings policy returned no rows under the wrap — GUC did not propagate",
    ).toBe(A_FINDINGS);
  });

  it("RLS-propagation probe (risks): dashboard surfaces org A's risks under the wrap GUC", async () => {
    const res = await getSummary(seed.orgA.apiKey);
    expect(res.status).toBe(200);
    expect(
      res.body?.inventory?.risks,
      "risks policy returned no rows under the wrap (inventory) — GUC did not propagate",
    ).toBe(A_RISKS);
    expect(
      res.body?.risks_summary?.open,
      "risks policy returned no rows under the wrap (summary) — GUC did not propagate",
    ).toBe(A_RISKS);
  });

  it("RLS-propagation probe (posture_snapshots): dashboard surfaces org A's snapshot under the wrap GUC", async () => {
    const res = await getSummary(seed.orgA.apiKey);
    expect(res.status).toBe(200);
    // With no GUC the most-recent-snapshot SELECT admits 0 rows → posture is all
    // null. A non-null score equal to the seed proves the posture_snapshots
    // policy admitted org A's row under the wrap.
    expect(
      res.body?.posture?.overall_score,
      "posture_snapshots policy returned no row under the wrap — GUC did not propagate",
    ).toBe(A_POSTURE_SCORE);
    expect(res.body?.posture?.snapshot_date, "snapshot_date null under the wrap").not.toBeNull();
  });
});

// ===========================================================================
// Cross-org isolation — org A's dashboard reflects ONLY org A's numbers,
// never org B's larger counts, across all three policied tables.
// ===========================================================================

describe("A04-G1 reader-wrap 0a — dashboard wrap: cross-org isolation", () => {
  it("org A dashboard shows org A's counts, never org B's (no bleed across the 3 policied tables)", async () => {
    const res = await getSummary(seed.orgA.apiKey);
    expect(res.status).toBe(200);
    // Org B has more of each; a bleed (or a sum) would show B's or A+B's totals.
    expect(res.body?.findings?.open).toBe(A_FINDINGS);
    expect(res.body?.findings?.open).not.toBe(B_FINDINGS);
    expect(res.body?.findings?.open).not.toBe(A_FINDINGS + B_FINDINGS);

    expect(res.body?.inventory?.risks).toBe(A_RISKS);
    expect(res.body?.inventory?.risks).not.toBe(B_RISKS);
    expect(res.body?.inventory?.risks).not.toBe(A_RISKS + B_RISKS);

    // Org A's most-recent snapshot score, not org B's.
    expect(res.body?.posture?.overall_score).toBe(A_POSTURE_SCORE);
    expect(res.body?.posture?.overall_score).not.toBe(B_POSTURE_SCORE);
  });

  it("org B dashboard shows org B's counts (symmetric isolation check)", async () => {
    const res = await getSummary(seed.orgB.apiKey);
    expect(res.status).toBe(200);
    expect(res.body?.findings?.open).toBe(B_FINDINGS);
    expect(res.body?.inventory?.risks).toBe(B_RISKS);
    expect(res.body?.posture?.overall_score).toBe(B_POSTURE_SCORE);
  });
});
