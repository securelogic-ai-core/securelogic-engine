/**
 * assetAssessments.test.ts — EAR P10 on real Postgres: the generic
 * asset-assessment engine round-trip.
 *
 * Proves the Track B exit criterion: a detail-backed asset type (endpoint —
 * onboarded in Phase 3a with zero assessment code) gains a full assessment
 * path through the ONE generic table. Covers: create with registry
 * existence check, the spec-driven status machine (transition + terminal
 * guards), finding-on-FIRST-transition-only (source_type='asset_assessment'),
 * cross-org denial, and a vendor-backed (federated) subject.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { createDetailAsset } from "../../src/api/lib/assetDetailPersistence.js";
import {
  createAssetAssessment,
  transitionAssetAssessment
} from "../../src/api/lib/assessmentEngine.js";

let seed: TestDbSeed;
let pool: Pool;
let assetId: string;

const CREATE_BASE = {
  status: "not_started",
  overall_severity: null,
  summary: null,
  notes: null,
  performed_at: null,
  reviewer_id: null
};

const PATCH_BASE = {
  overall_severity: null,
  summary: null,
  notes: null,
  performed_at: null,
  reviewer_id: null
};

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the asset assessments test.");
  pool = new Pool({ connectionString: url, ssl: false });

  const created = await withTenant(seed.orgA.id, () =>
    createDetailAsset(seed.orgA.id, {
      asset_type: "endpoint",
      name: "assess-laptop",
      criticality: "high",
      status: "active",
      external_ref: "p10:ep-1",
      typed: { hostname: "assess-laptop.corp", exposure: "internal" }
    })
  );
  if (!("row" in created)) throw new Error("seed create failed");
  assetId = created.assetId;
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("EAR P10 — generic asset-assessment engine", () => {
  let assessmentId: string;

  it("creates an assessment for a detail-backed asset (registry-checked, no finding)", async () => {
    const missing = await withTenant(seed.orgA.id, () =>
      createAssetAssessment(seed.orgA.id, {
        ...CREATE_BASE,
        asset_type: "endpoint",
        asset_id: "00000000-0000-4000-8000-000000000000"
      })
    );
    expect(missing).toEqual({ error: "asset_not_found" });

    const result = await withTenant(seed.orgA.id, () =>
      createAssetAssessment(seed.orgA.id, {
        ...CREATE_BASE,
        asset_type: "endpoint",
        asset_id: assetId
      })
    );
    if ("error" in result) throw new Error("create failed");
    assessmentId = String(result.assessment["id"]);
    expect(result.assessment).toMatchObject({
      asset_type: "endpoint",
      asset_id: assetId,
      status: "not_started"
    });

    const findings = await pool.query(
      `SELECT 1 FROM findings WHERE organization_id = $1 AND source_type = 'asset_assessment'`,
      [seed.orgA.id]
    );
    expect(findings.rowCount).toBe(0);
  });

  it("cross-org: orgB cannot see or transition orgA's assessment", async () => {
    const denied = await withTenant(seed.orgB.id, () =>
      transitionAssetAssessment(seed.orgB.id, assessmentId, {
        ...PATCH_BASE,
        status: "in_progress"
      })
    );
    expect(denied).toEqual({ error: "not_found" });

    const cantCreate = await withTenant(seed.orgB.id, () =>
      createAssetAssessment(seed.orgB.id, {
        ...CREATE_BASE,
        asset_type: "endpoint",
        asset_id: assetId // orgA's asset is invisible to orgB's registry view
      })
    );
    expect(cantCreate).toEqual({ error: "asset_not_found" });
  });

  it("enforces the spec transition graph", async () => {
    const skip = await withTenant(seed.orgA.id, () =>
      transitionAssetAssessment(seed.orgA.id, assessmentId, {
        ...PATCH_BASE,
        status: "deficient",
        overall_severity: "High"
      })
    );
    expect(skip).toEqual({ error: "invalid_transition" }); // not_started ↛ deficient

    const ok = await withTenant(seed.orgA.id, () =>
      transitionAssetAssessment(seed.orgA.id, assessmentId, {
        ...PATCH_BASE,
        status: "in_progress"
      })
    );
    if ("error" in ok) throw new Error("transition failed");
    expect(ok.assessment).toMatchObject({ status: "in_progress" });
    expect(ok.finding).toBeNull();
    expect(ok.from).toBe("not_started");
  });

  it("creates exactly ONE finding on the first finding-status transition, then goes terminal", async () => {
    const result = await withTenant(seed.orgA.id, () =>
      transitionAssetAssessment(seed.orgA.id, assessmentId, {
        ...PATCH_BASE,
        status: "deficient",
        overall_severity: "High",
        summary: "Endpoint fails hardening baseline"
      })
    );
    if ("error" in result) throw new Error("transition failed");
    expect(result.finding).not.toBeNull();
    expect(result.finding).toMatchObject({
      source_type: "asset_assessment",
      severity: "High",
      status: "open",
      description: "Endpoint fails hardening baseline"
    });
    expect(String(result.finding!["title"])).toContain("assess-laptop");

    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM findings
        WHERE organization_id = $1 AND source_type = 'asset_assessment' AND source_id = $2::uuid`,
      [seed.orgA.id, assessmentId]
    );
    expect(count.rows[0].n).toBe(1);

    // Terminal now — no further transitions.
    const terminal = await withTenant(seed.orgA.id, () =>
      transitionAssetAssessment(seed.orgA.id, assessmentId, {
        ...PATCH_BASE,
        status: "in_progress"
      })
    );
    expect(terminal).toEqual({ error: "workflow_terminal" });
  });

  it("a federated (vendor-backed) subject works through the same path — zero new code", async () => {
    const vendorId = await seedVendor(pool, seed.orgA.id);

    // The registry view exposes the vendor; its asset_id is what the view says.
    const viewRow = await pool.query(
      `SELECT asset_id FROM asset_registry_v
        WHERE organization_id = $1 AND asset_type = 'vendor' AND backing_id = $2`,
      [seed.orgA.id, vendorId]
    );
    expect(viewRow.rowCount).toBe(1);
    const vendorAssetId = String(viewRow.rows[0].asset_id);

    const created = await withTenant(seed.orgA.id, () =>
      createAssetAssessment(seed.orgA.id, {
        ...CREATE_BASE,
        asset_type: "vendor",
        asset_id: vendorAssetId,
        status: "in_progress"
      })
    );
    if ("error" in created) throw new Error("vendor-subject create failed");
    expect(created.assessment).toMatchObject({ asset_type: "vendor", status: "in_progress" });

    const done = await withTenant(seed.orgA.id, () =>
      transitionAssetAssessment(seed.orgA.id, String(created.assessment["id"]), {
        ...PATCH_BASE,
        status: "satisfactory"
      })
    );
    if ("error" in done) throw new Error("vendor-subject transition failed");
    expect(done.assessment).toMatchObject({ status: "satisfactory" });
    expect(done.finding).toBeNull(); // satisfactory is not a finding status
  });
});
