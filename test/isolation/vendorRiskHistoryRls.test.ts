/**
 * vendorRiskHistoryRls.test.ts — VA-7: real-Postgres proof that the daily
 * vendor-risk snapshot (vendor_risk_snapshots, 20261045) captures the
 * canonical per-vendor facts, converges on a same-day re-run instead of
 * duplicating, carries an enforced RLS policy, never leaks across orgs
 * through the store, the trend route or the rollup route, and returns the
 * honest empty state ([] — never zero-padding) for a vendor with no history.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { snapshotVendorRiskForOrg } from "../../src/api/lib/vendorRiskHistoryStore.js";
import { runVendorRiskHistorySnapshot } from "../../src/api/workers/vendorRiskHistoryWorker.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

const TODAY = new Date().toISOString().slice(0, 10);

// Seeded ids (org A unless suffixed otherwise).
let vendorA1: string; // findings + engagement residual + legacy score
let vendorA2: string; // exists, no activity at all
let vendorArchived: string; // archived — must not accrue snapshots
let vendorB1: string; // org B
let closableFindingId: string; // org A finding closed mid-test to prove refresh

/** Owner-channel seeding helpers (the migration/import path, not the request path). */

async function seedAssessmentFinding(
  orgId: string,
  vendorId: string,
  opts: { title: string; dueDate?: string; operationalStatus?: string }
): Promise<string> {
  const assessment = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assessments (organization_id, vendor_id, assessment_type, overall_severity)
     VALUES ($1, $2, 'security_review', 'High') RETURNING id`,
    [orgId, vendorId]
  );
  const finding = await pool.query<{ id: string }>(
    `INSERT INTO findings
       (organization_id, title, severity, description, source_type, source_id,
        status, operational_status, due_date)
     VALUES ($1, $2, 'High', 'VA-7 harness finding', 'vendor_review', $3, $4, $5, $6)
     RETURNING id`,
    [
      orgId,
      opts.title,
      assessment.rows[0].id,
      // findings_closure_axes_agree: the two closure axes must agree.
      (opts.operationalStatus ?? "open") === "closed" ? "closed" : "open",
      opts.operationalStatus ?? "open",
      opts.dueDate ?? null,
    ]
  );
  return finding.rows[0].id;
}

async function seedEngagementWithResidualAndFinding(orgId: string, vendorId: string): Promise<void> {
  const engagement = await pool.query<{ id: string }>(
    `INSERT INTO vendor_engagements
       (organization_id, vendor_id, engagement_type, status,
        methodology_version, scope_rule_version,
        residual_rating, residual_score, residual_computed_at, next_review_due)
     VALUES ($1, $2, 'periodic', 'monitoring', 'v1', 'v1',
             'High', 62, NOW(), CURRENT_DATE - 10)
     RETURNING id`,
    [orgId, vendorId]
  );
  await pool.query(
    `INSERT INTO findings
       (organization_id, title, severity, description, source_type, source_id,
        status, operational_status)
     VALUES ($1, 'VA-7 engagement-promoted gap', 'Moderate', 'VA-7 harness finding',
             'vendor_engagement', $2, 'open', 'open')`,
    [orgId, engagement.rows[0].id]
  );
}

async function snapshotRows(orgId: string): Promise<
  Array<{
    vendor_id: string;
    captured_on: string;
    legacy_risk_score: string | null;
    criticality: string | null;
    active_findings_count: number;
    residual_rating: string | null;
    residual_score: number | null;
  }>
> {
  const r = await pool.query(
    `SELECT vendor_id, captured_on::text AS captured_on, legacy_risk_score, criticality,
            active_findings_count, residual_rating, residual_score
       FROM vendor_risk_snapshots
      WHERE organization_id = $1
      ORDER BY vendor_id, captured_on`,
    [orgId]
  );
  return r.rows;
}

const asOrgA = {
  get: (path: string) => request(app).get(path).set("X-Api-Key", seed.orgA.apiKey),
};
const asOrgB = {
  get: (path: string) => request(app).get(path).set("X-Api-Key", seed.orgB.apiKey),
};

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the vendor risk history test.");
  pool = new Pool({ connectionString: url, ssl: false });

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));

  // Org A: one fully-populated vendor, one bare vendor, one archived vendor.
  vendorA1 = await seedVendor(pool, seed.orgA.id, { name: "VA7 Alpha", criticality: "high" });
  vendorA2 = await seedVendor(pool, seed.orgA.id, { name: "VA7 Bare", criticality: "low" });
  vendorArchived = await seedVendor(pool, seed.orgA.id, { name: "VA7 Archived", criticality: "low" });
  await pool.query(`UPDATE vendors SET status = 'archived' WHERE id = $1`, [vendorArchived]);
  await pool.query(`UPDATE vendors SET current_risk_score = 73.50 WHERE id = $1`, [vendorA1]);

  // Two Active findings on different edges + one Closed (must not count) + one
  // Active-and-overdue (feeds the remediation rollup).
  closableFindingId = await seedAssessmentFinding(seed.orgA.id, vendorA1, {
    title: "VA7 open assessment finding",
  });
  await seedAssessmentFinding(seed.orgA.id, vendorA1, {
    title: "VA7 closed finding",
    operationalStatus: "closed",
  });
  await seedAssessmentFinding(seed.orgA.id, vendorA1, {
    title: "VA7 overdue finding",
    dueDate: "2026-01-01",
  });
  await seedEngagementWithResidualAndFinding(seed.orgA.id, vendorA1);

  // Org B: its own vendor + finding, to prove the sweep and reads are scoped.
  vendorB1 = await seedVendor(pool, seed.orgB.id, { name: "VA7 Beta", criticality: "medium" });
  await seedAssessmentFinding(seed.orgB.id, vendorB1, { title: "VA7 org B finding" });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("VA-7 — vendor risk snapshot substrate", () => {
  it("the worker captures every org's vendors with canonical counts, score, criticality and residual", async () => {
    const orgs = await runVendorRiskHistorySnapshot({ today: () => TODAY });
    expect(orgs).toBeGreaterThanOrEqual(2); // at least org A and org B

    const a = await snapshotRows(seed.orgA.id);
    const a1 = a.find((r) => r.vendor_id === vendorA1)!;
    // 3 Active findings: 2 assessment-edge (one overdue) + 1 engagement-edge.
    // The Closed finding is excluded — the canonical Active population.
    expect(a1).toMatchObject({
      captured_on: TODAY,
      criticality: "high",
      active_findings_count: 3,
      residual_rating: "High",
      residual_score: 62,
    });
    expect(Number(a1.legacy_risk_score)).toBeCloseTo(73.5);

    // The bare vendor snapshots honestly: count 0 is a measurement; the never-
    // computed legacy score stays NULL (never coalesced to 0 = "worst").
    const a2 = a.find((r) => r.vendor_id === vendorA2)!;
    expect(a2.active_findings_count).toBe(0);
    expect(a2.legacy_risk_score).toBeNull();
    expect(a2.residual_rating).toBeNull();

    // Archived vendors accrue no new points.
    expect(a.some((r) => r.vendor_id === vendorArchived)).toBe(false);

    // Org B captured its own vendor — in its own partition.
    const b = await snapshotRows(seed.orgB.id);
    expect(b.find((r) => r.vendor_id === vendorB1)?.active_findings_count).toBe(1);
  });

  it("a same-day re-run converges (upsert, no duplicate rows) and refreshes the values", async () => {
    // Both closure axes together — findings_closure_axes_agree requires
    // operational_status='closed' ⟺ status IN ('closed','accepted').
    await pool.query(
      `UPDATE findings SET operational_status = 'closed', status = 'closed' WHERE id = $1`,
      [closableFindingId]
    );

    const written = await withTenant(seed.orgA.id, () =>
      snapshotVendorRiskForOrg(seed.orgA.id, TODAY)
    );
    expect(written).toBe(2); // A1 + A2; archived excluded

    const a = await snapshotRows(seed.orgA.id);
    // Still exactly one row per vendor for the day…
    expect(a.filter((r) => r.vendor_id === vendorA1 && r.captured_on === TODAY)).toHaveLength(1);
    // …with the refreshed count (3 - the one just closed).
    expect(a.find((r) => r.vendor_id === vendorA1)!.active_findings_count).toBe(2);
  });

  it("RLS is enabled with the tenant policy, and org B's tenant channel sees zero org A rows", async () => {
    const rls = await pool.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'vendor_risk_snapshots'`
    );
    expect(rls.rows[0].relrowsecurity).toBe(true);

    const policy = await pool.query(
      `SELECT policyname FROM pg_policies
        WHERE tablename = 'vendor_risk_snapshots'
          AND policyname = 'vendor_risk_snapshots_tenant_isolation'`
    );
    expect(policy.rowCount).toBe(1);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);
      const crossOrg = await client.query(
        `SELECT count(*)::int AS n FROM vendor_risk_snapshots WHERE organization_id = $1`,
        [seed.orgA.id]
      );
      expect(crossOrg.rows[0].n).toBe(0); // RLS blocks the cross-org read outright
      const ownRows = await client.query(`SELECT count(*)::int AS n FROM vendor_risk_snapshots`);
      expect(ownRows.rows[0].n).toBeGreaterThanOrEqual(1); // …while its own remain visible
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("GET /vendors/:id/risk-trend returns the series for the org's own vendor and 404 cross-org", async () => {
    const own = await asOrgA.get(`/api/vendors/${vendorA1}/risk-trend`);
    expect(own.status).toBe(200);
    expect(own.body.vendor_id).toBe(vendorA1);
    expect(own.body.series.length).toBeGreaterThanOrEqual(1);
    expect(own.body.series[0]).toMatchObject({
      captured_on: TODAY,
      score: 73.5,
      active_findings_count: 2,
      residual_rating: "High",
    });

    // Another org's vendor id resolves to nothing — indistinguishable from absent.
    const cross = await asOrgB.get(`/api/vendors/${vendorA1}/risk-trend`);
    expect(cross.status).toBe(404);
  });

  it("a vendor with no snapshots gets the honest empty state: [], not zeros", async () => {
    const fresh = await seedVendor(pool, seed.orgA.id, { name: "VA7 Fresh", criticality: "low" });
    const res = await asOrgA.get(`/api/vendors/${fresh}/risk-trend`);
    expect(res.status).toBe(200);
    expect(res.body.series).toEqual([]);
  });

  it("GET /vendors/reporting-rollups reports org-scoped aging, overdue remediation and overdue reviews", async () => {
    const a = await asOrgA.get("/api/vendors/reporting-rollups");
    expect(a.status).toBe(200);
    // A1 assessed today (<90); Bare + Fresh never; archived excluded entirely.
    expect(a.body.assessment_aging).toMatchObject({
      under_90_days: 1,
      days_90_to_365: 0,
      over_365_days: 0,
      never_assessed: 2,
    });
    // Exactly one vendor has an Active finding past due_date.
    expect(a.body.overdue_remediation).toEqual([
      { vendor_id: vendorA1, vendor_name: "VA7 Alpha", overdue_findings_count: 1 },
    ]);
    // One monitoring engagement with next_review_due in the past.
    expect(a.body.engagement_reviews_overdue).toBe(1);

    // Org B sees only its own facts — nothing of org A's leaks into the counts.
    const b = await asOrgB.get("/api/vendors/reporting-rollups");
    expect(b.status).toBe(200);
    expect(b.body.assessment_aging).toMatchObject({ under_90_days: 1, never_assessed: 0 });
    expect(b.body.overdue_remediation).toEqual([]);
    expect(b.body.engagement_reviews_overdue).toBe(0);
  });
});
