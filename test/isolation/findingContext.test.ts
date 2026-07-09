/**
 * findingContext.test.ts — ERIP Package 3 (Decision Workspace), Phase 3.0.
 *
 * Real-Postgres cross-org isolation for the Finding Context Resolver: a
 * signal-sourced finding resolves its affected vendor + evidence for its own org;
 * another org gets null for that finding (no cross-tenant read); and the resolver
 * never mixes another org's affected entities into the context.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, seedCyberSignal, seedUser, type TestDbSeed } from "./testDb.js";
import { resolveFindingContext } from "../../src/api/lib/findingContextResolver.js";

let seed: TestDbSeed;
let pool: Pool;

async function seedSignalSourcedFinding(orgId: string, dedup: string) {
  const signalId = await seedCyberSignal(pool, { orgId, dedup, vendor: "Acme" });
  const vendorId = await seedVendor(pool, orgId, { name: `Vendor-${dedup}` });
  await pool.query(
    `INSERT INTO signal_vendor_links (organization_id, signal_id, vendor_id) VALUES ($1, $2, $3)`,
    [orgId, signalId, vendorId]
  );
  const f = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, source_id)
     VALUES ($1, 'Ctx finding', 'high', 'ctx', 'cyber_signal', $2)
     RETURNING id`,
    [orgId, signalId]
  );
  const findingId = f.rows[0].id;
  await pool.query(
    `INSERT INTO evidence (organization_id, source_type, source_id, title, evidence_type)
     VALUES ($1, 'finding', $2, 'advisory.pdf', 'document')`,
    [orgId, findingId]
  );
  return { signalId, vendorId, findingId };
}

async function seedVendorReviewFinding(orgId: string, dedup: string) {
  const vendorId = await seedVendor(pool, orgId, { name: `AsmtVendor-${dedup}` });
  const va = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assessments (organization_id, vendor_id, assessment_type, overall_severity)
     VALUES ($1, $2, 'security', 'High') RETURNING id`,
    [orgId, vendorId]
  );
  const assessmentId = va.rows[0].id;
  const f = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, source_id)
     VALUES ($1, 'Vendor review finding', 'high', 'ctx', 'vendor_review', $2)
     RETURNING id`,
    [orgId, assessmentId]
  );
  return { vendorId, assessmentId, findingId: f.rows[0].id };
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the finding-context test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("Package 3 Phase 3.0 — finding context resolver (real Postgres)", () => {
  it("resolves the affected vendor + evidence for a signal-sourced finding", async () => {
    const a = await seedSignalSourcedFinding(seed.orgA.id, "ctx-a-1");
    const ctx = await resolveFindingContext(pool, seed.orgA.id, a.findingId);
    expect(ctx).not.toBeNull();
    expect(ctx!.affected.vendors.map((v) => v.id)).toContain(a.vendorId);
    expect(ctx!.evidence.length).toBe(1);
    expect(ctx!.finding.source_type).toBe("cyber_signal");
    // Phase 3.1 — risk score + business impact composed from real data.
    expect(typeof ctx!.risk.score).toBe("number");
    expect(ctx!.business_impact.third_party.level).not.toBe("none"); // 1 affected vendor
    expect(ctx!.business_impact.revenue.level).toBe("not_assessed"); // never fabricated
    // Phase 3.2a — decision_state (business decision) present + defaulted.
    expect(ctx!.finding.decision_state).toBe("needs_review");
  });

  it("finding_review_marks (What's-Changed) is org-scoped", async () => {
    const a = await seedSignalSourcedFinding(seed.orgA.id, "ctx-a-4");
    const user = await seedUser(pool, seed.orgA.id, {});
    await pool.query(
      `INSERT INTO finding_review_marks (organization_id, finding_id, user_id) VALUES ($1, $2, $3)`,
      [seed.orgA.id, a.findingId, user.id]
    );
    const inA = await pool.query(
      `SELECT 1 FROM finding_review_marks WHERE organization_id = $1 AND finding_id = $2`,
      [seed.orgA.id, a.findingId]
    );
    expect(inA.rowCount).toBe(1);
    const inB = await pool.query(
      `SELECT 1 FROM finding_review_marks WHERE organization_id = $1 AND finding_id = $2`,
      [seed.orgB.id, a.findingId]
    );
    expect(inB.rowCount).toBe(0);
  });

  it("resolves the affected vendor for an assessment-sourced (vendor_review) finding", async () => {
    // §6 source-consistency: assessment-sourced findings resolve affected context too.
    const a = await seedVendorReviewFinding(seed.orgA.id, "asmt-a-1");
    const ctx = await resolveFindingContext(pool, seed.orgA.id, a.findingId);
    expect(ctx).not.toBeNull();
    expect(ctx!.finding.source_type).toBe("vendor_review");
    expect(ctx!.affected.vendors.map((v) => v.id)).toEqual([a.vendorId]);
  });

  it("never leaks another org's vendor via an assessment-sourced finding", async () => {
    const a = await seedVendorReviewFinding(seed.orgA.id, "asmt-a-2");
    await seedVendorReviewFinding(seed.orgB.id, "asmt-b-2");
    const ctxA = await resolveFindingContext(pool, seed.orgA.id, a.findingId);
    expect(ctxA!.affected.vendors.every((v) => v.id === a.vendorId)).toBe(true);
    // Another org cannot read this finding's context at all.
    expect(await resolveFindingContext(pool, seed.orgB.id, a.findingId)).toBeNull();
  });

  it("returns null for another org's finding (no cross-tenant read)", async () => {
    const a = await seedSignalSourcedFinding(seed.orgA.id, "ctx-a-2");
    const ctx = await resolveFindingContext(pool, seed.orgB.id, a.findingId);
    expect(ctx).toBeNull();
  });

  it("never mixes another org's affected entities into the context", async () => {
    const a = await seedSignalSourcedFinding(seed.orgA.id, "ctx-a-3");
    await seedSignalSourcedFinding(seed.orgB.id, "ctx-b-3");
    const ctx = await resolveFindingContext(pool, seed.orgA.id, a.findingId);
    expect(ctx).not.toBeNull();
    expect(ctx!.affected.vendors.every((v) => v.id === a.vendorId)).toBe(true);
  });
});
