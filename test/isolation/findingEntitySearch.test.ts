/**
 * findingEntitySearch.test.ts — real-Postgres cross-org isolation for the reverse
 * entity→findings search (work-first Findings page). Org A's "Microsoft" search
 * must resolve A's findings via the signal-link AND assessment paths, and must
 * never surface org B's entities or findings even when B has an identically-named
 * vendor with its own findings.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, seedCyberSignal, type TestDbSeed } from "./testDb.js";
import { searchFindingsByEntity } from "../../src/api/lib/findingEntitySearch.js";

let seed: TestDbSeed;
let pool: Pool;

async function seedVendorWithFindings(orgId: string, vendorName: string, dedup: string) {
  const vendorId = await seedVendor(pool, orgId, { name: vendorName });
  // Signal path: signal linked to the vendor + a cyber_signal-sourced finding.
  const signalId = await seedCyberSignal(pool, { orgId, dedup, vendor: vendorName });
  await pool.query(
    `INSERT INTO signal_vendor_links (organization_id, signal_id, vendor_id) VALUES ($1, $2, $3)`,
    [orgId, signalId, vendorId]
  );
  const f1 = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, source_id)
     VALUES ($1, 'Signal finding', 'high', 'x', 'cyber_signal', $2) RETURNING id`,
    [orgId, signalId]
  );
  // Assessment path: a vendor assessment + its vendor_review finding.
  const va = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assessments (organization_id, vendor_id, assessment_type, overall_severity)
     VALUES ($1, $2, 'security', 'High') RETURNING id`,
    [orgId, vendorId]
  );
  const f2 = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, source_id)
     VALUES ($1, 'Assessment finding', 'high', 'x', 'vendor_review', $2) RETURNING id`,
    [orgId, va.rows[0].id]
  );
  return { vendorId, signalFindingId: f1.rows[0].id, assessmentFindingId: f2.rows[0].id };
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the finding-entity-search test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("entity→findings search — cross-org isolation (real Postgres)", () => {
  it("resolves a vendor's findings via both the signal and assessment paths", async () => {
    const a = await seedVendorWithFindings(seed.orgA.id, "SearchCorp-A1", "es-a-1");
    const out = await searchFindingsByEntity(pool, seed.orgA.id, "SearchCorp-A1");
    expect(out.entities.map((e) => e.id)).toContain(a.vendorId);
    expect(out.finding_ids).toContain(a.signalFindingId);
    expect(out.finding_ids).toContain(a.assessmentFindingId);
  });

  it("never surfaces another org's identically-named vendor or its findings", async () => {
    await seedVendorWithFindings(seed.orgA.id, "SharedName Corp", "es-a-2");
    const b = await seedVendorWithFindings(seed.orgB.id, "SharedName Corp", "es-b-2");
    const outA = await searchFindingsByEntity(pool, seed.orgA.id, "SharedName");
    expect(outA.entities.every((e) => e.id !== b.vendorId)).toBe(true);
    expect(outA.finding_ids).not.toContain(b.signalFindingId);
    expect(outA.finding_ids).not.toContain(b.assessmentFindingId);
  });

  it("returns empty for a query matching nothing in the caller's org", async () => {
    const out = await searchFindingsByEntity(pool, seed.orgA.id, "zz-no-such-entity-zz");
    expect(out).toEqual({ entities: [], finding_ids: [] });
  });
});
