/**
 * postureDomainRollup.test.ts — Domain-count reconciliation ruling (2026-07-17):
 * real-Postgres proof that computeAndSavePostureSnapshot writes a domain rollup
 * in which every active finding is counted exactly once under its primary
 * domain, aux signals (open risks, vendor inventory) drive scores but never
 * counts, SUM(domain_scores.finding_count) === posture_snapshots.
 * open_finding_count, and none of it crosses org boundaries.
 *
 * Regression context: before this ruling landed in code, risk signals and
 * synthetic vendor-inventory signals were merged into the findings array, so
 * domain_scores.finding_count (and the snapshot's open_finding_count) summed
 * to MORE than the unique active-finding total — observed on staging as
 * 4+8+14+0 = 26 active findings vs a domain breakdown summing to 28.
 *
 * Isolation caveat (same as postureTenantWrap.test.ts): these cross-org
 * assertions are WHERE-clause tripwires, not RLS proofs — the posture tables'
 * RLS policies are phase-3 deliverables and the harness connects as the owner.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedRisk, seedVendor, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { computeAndSavePostureSnapshot } from "../../src/api/lib/postureSnapshot.js";

let seed: TestDbSeed;
let pool: Pool;

/** Insert an active finding with an explicit primary domain. */
async function seedDomainFinding(
  orgId: string,
  domain: string,
  severity: string
): Promise<void> {
  await pool.query(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, domain)
     VALUES ($1, $2, $3, 'rollup harness finding', 'manual', $4)`,
    [orgId, `Rollup finding ${domain} ${severity}`, severity, domain]
  );
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the posture rollup test.");
  pool = new Pool({ connectionString: url, ssl: false });

  // Org A: 4 active findings across 3 domains, PLUS aux-signal sources that
  // used to inflate the rollup — 1 open scored risk (Vendor Risk) and 1
  // active critical-criticality vendor (synthetic Vendor Risk signal).
  await seedDomainFinding(seed.orgA.id, "Access Control", "Critical");
  await seedDomainFinding(seed.orgA.id, "Access Control", "High");
  await seedDomainFinding(seed.orgA.id, "Vendor Risk", "Moderate");
  await seedDomainFinding(seed.orgA.id, "AI Governance", "Moderate");
  await seedRisk(pool, seed.orgA.id, { rating: "High", title: "Rollup harness risk A" });
  await seedVendor(pool, seed.orgA.id, { name: "Rollup harness vendor A", criticality: "critical" });

  // Org B: 1 active finding + 1 vendor — the isolation counter-population.
  await seedDomainFinding(seed.orgB.id, "Vendor Risk", "High");
  await seedVendor(pool, seed.orgB.id, { name: "Rollup harness vendor B", criticality: "high" });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("posture domain rollup reconciliation (2026-07-17 ruling)", () => {
  it("counts each active finding once under its primary domain; aux signals score but never count", async () => {
    const result = await withTenant(seed.orgA.id, () =>
      computeAndSavePostureSnapshot(seed.orgA.id)
    );

    // Headline = unique active findings, not signals.
    expect(result.openFindingCount).toBe(4);

    // Domain counts sum to the headline on the same snapshot.
    const sum = result.domainScores.reduce((s, d) => s + d.finding_count, 0);
    expect(sum).toBe(4);

    const byDomain = new Map(result.domainScores.map((d) => [d.domain, d]));
    expect(byDomain.get("Access Control")!.finding_count).toBe(2);
    expect(byDomain.get("AI Governance")!.finding_count).toBe(1);
    // Vendor Risk carries 1 finding + 1 risk signal + 1 inventory signal:
    // exactly one COUNTS; all three still drive the domain score.
    expect(byDomain.get("Vendor Risk")!.finding_count).toBe(1);
    expect(byDomain.get("Vendor Risk")!.score).not.toBeNull();
    expect(result.overallScore).not.toBeNull();
  });

  it("persists reconciled counts: SUM(domain_scores.finding_count) === open_finding_count", async () => {
    const snapRes = await pool.query<{ id: string; open_finding_count: number }>(
      `SELECT id, open_finding_count FROM posture_snapshots
       WHERE organization_id = $1 ORDER BY snapshot_date DESC LIMIT 1`,
      [seed.orgA.id]
    );
    expect(snapRes.rowCount).toBe(1);
    expect(snapRes.rows[0]!.open_finding_count).toBe(4);

    const domRes = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(finding_count), 0)::text AS total
       FROM domain_scores WHERE posture_snapshot_id = $1`,
      [snapRes.rows[0]!.id]
    );
    expect(parseInt(domRes.rows[0]!.total, 10)).toBe(4);
  });

  it("keeps the rollup org-scoped: org B's snapshot reflects only org B data", async () => {
    const result = await withTenant(seed.orgB.id, () =>
      computeAndSavePostureSnapshot(seed.orgB.id)
    );

    // 1 finding — org A's 4 findings, risk, and vendor did not leak in.
    expect(result.openFindingCount).toBe(1);
    const sum = result.domainScores.reduce((s, d) => s + d.finding_count, 0);
    expect(sum).toBe(1);
    expect(result.domainScores.find((d) => d.domain === "Vendor Risk")!.finding_count).toBe(1);

    // And org A's persisted snapshot is untouched by org B's compute.
    const snapA = await pool.query<{ open_finding_count: number }>(
      `SELECT open_finding_count FROM posture_snapshots
       WHERE organization_id = $1 ORDER BY snapshot_date DESC LIMIT 1`,
      [seed.orgA.id]
    );
    expect(snapA.rows[0]!.open_finding_count).toBe(4);
  });
});
