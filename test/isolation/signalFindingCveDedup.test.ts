/**
 * signalFindingCveDedup.test.ts — CVE-grain finding dedup, real Postgres.
 *
 * Real-SQL proof for the SECURELOGIC_SIGNAL_FINDING_CVE_DEDUP_ENABLED guard in
 * cyberSignalProcessingService §3a. The mocked-pg suite proves orchestration
 * order; it structurally cannot prove the probe's SQL parses and selects
 * correctly — and the probe JOINs findings⋈cyber_signals, two tables sharing
 * the id / organization_id / created_at / updated_at column names, the exact
 * shape that shipped the 42702 ambiguous-column 500 in enterpriseEntities.
 *
 * Staging evidence behind the feature (2026-08-05): six OPEN findings for
 * CVE-2026-20316 / Cisco at three severities — one per source signal
 * (cisa_kev + nvd + re-ingests). This suite proves, against real Postgres:
 *   1. flag ON: a second signal for the same (org, CVE, vendor) REUSES the
 *      active finding — no second row, finding_was_created=false;
 *   2. tenant isolation: another org with the same CVE + vendor name still
 *      mints its OWN finding (no cross-org reuse through the JOIN);
 *   3. flag OFF: byte-identical legacy — a duplicate row IS minted;
 *   4. Active-only: once the org's findings for the CVE are closed
 *      (operational_status='closed'), a new signal creates a fresh finding.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, seedCyberSignal, type TestDbSeed } from "./testDb.js";
import { runMatcherForSignal, type CyberSignalRecord } from "../../src/api/lib/cyberSignalProcessingService.js";

const FLAG = "SECURELOGIC_SIGNAL_FINDING_CVE_DEDUP_ENABLED";
const CVE = "CVE-2026-7777";

let seed: TestDbSeed;
let pool: Pool;
let prevFlag: string | undefined;

function record(signalId: string, source: string, severity: string, vendor: string): CyberSignalRecord {
  return {
    id: signalId, organization_id: "", source, signal_type: "cve",
    severity, normalized_summary: `${vendor} flaw ${CVE}. Sources: ${source}.`,
    affected_vendor: vendor, affected_cve: CVE
  };
}

async function cveFindingCount(orgId: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM findings f JOIN cyber_signals s ON s.id = f.source_id
      WHERE f.organization_id = $1 AND f.source_type = 'cyber_signal'
        AND s.affected_cve = $2`,
    [orgId, CVE]
  );
  return Number(r.rows[0]!.n);
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  prevFlag = process.env[FLAG];
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the CVE-dedup test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  if (prevFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = prevFlag;
  await pool?.end();
});

describe("CVE-grain finding dedup (real Postgres)", () => {
  it("flag ON: second source for the same CVE reuses the active finding — one row, not two", async () => {
    await seedVendor(pool, seed.orgA.id, { name: "Cisco" });

    process.env[FLAG] = "true";

    // First signal (cisa_kev) — no prior finding, so one is created.
    const s1 = await seedCyberSignal(pool, { orgId: null, source: "cisa_kev", signalType: "cve", severity: "High", cve: CVE, vendor: "Cisco", dedup: "cvd-1", summary: "Cisco flaw. Sources: CISA KEV." });
    const r1 = await runMatcherForSignal(record(s1, "cisa_kev", "High", "Cisco"), seed.orgA.id);
    expect(r1.matched_vendor_id).toBeTruthy();
    expect(r1.finding_was_created).toBe(true);
    const firstFindingId = (r1.finding as { id: string }).id;
    expect(await cveFindingCount(seed.orgA.id)).toBe(1);

    // Second signal: DIFFERENT source, different severity, lowercase vendor —
    // the staging duplication shape. Must reuse, not mint.
    const s2 = await seedCyberSignal(pool, { orgId: null, source: "nvd", signalType: "cve", severity: "Moderate", cve: CVE, vendor: "cisco", dedup: "cvd-2", summary: "cisco flaw. Sources: NVD." });
    const r2 = await runMatcherForSignal(record(s2, "nvd", "Moderate", "cisco"), seed.orgA.id);
    expect(r2.matched_vendor_id).toBeTruthy();
    expect(r2.finding_was_created).toBe(false);
    expect((r2.finding as { id: string }).id).toBe(firstFindingId);
    expect(await cveFindingCount(seed.orgA.id)).toBe(1);

    // Per-signal provenance still attaches: s2 got its own suggestion row.
    const sugg = await pool.query(
      `SELECT 1 FROM signal_match_suggestions WHERE organization_id=$1 AND signal_id=$2`,
      [seed.orgA.id, s2]
    );
    expect(sugg.rowCount).toBe(1);
  });

  it("tenant isolation: org B with the same CVE + vendor name mints its OWN finding", async () => {
    await seedVendor(pool, seed.orgB.id, { name: "Cisco" });

    process.env[FLAG] = "true";
    const s3 = await seedCyberSignal(pool, { orgId: null, source: "nvd", signalType: "cve", severity: "High", cve: CVE, vendor: "Cisco", dedup: "cvd-3", summary: "Cisco flaw. Sources: NVD." });
    const r3 = await runMatcherForSignal(record(s3, "nvd", "High", "Cisco"), seed.orgB.id);
    expect(r3.matched_vendor_id).toBeTruthy();
    // Org A's finding for this CVE must NOT satisfy org B's probe.
    expect(r3.finding_was_created).toBe(true);
    expect(await cveFindingCount(seed.orgB.id)).toBe(1);
    expect(await cveFindingCount(seed.orgA.id)).toBe(1); // untouched
  });

  it("flag OFF: byte-identical legacy — a duplicate row IS minted", async () => {
    process.env[FLAG] = "false";
    const s4 = await seedCyberSignal(pool, { orgId: null, source: "sans_isc", signalType: "cve", severity: "High", cve: CVE, vendor: "Cisco", dedup: "cvd-4", summary: "Cisco flaw. Sources: SANS ISC." });
    const r4 = await runMatcherForSignal(record(s4, "sans_isc", "High", "Cisco"), seed.orgA.id);
    expect(r4.finding_was_created).toBe(true); // legacy grain: one finding per signal
    expect(await cveFindingCount(seed.orgA.id)).toBe(2);
  });

  it("flag ON reuses only ACTIVE findings: with all CVE findings closed, a new one is created", async () => {
    // Close every org-A finding for the CVE on the canonical Active axis.
    await pool.query(
      `UPDATE findings f SET operational_status = 'closed', status = 'closed'
        FROM cyber_signals s
       WHERE s.id = f.source_id AND f.organization_id = $1
         AND f.source_type = 'cyber_signal' AND s.affected_cve = $2`,
      [seed.orgA.id, CVE]
    );

    process.env[FLAG] = "true";
    const s5 = await seedCyberSignal(pool, { orgId: null, source: "cisa_kev", signalType: "cve", severity: "Critical", cve: CVE, vendor: "Cisco", dedup: "cvd-5", summary: "Cisco flaw regressed. Sources: CISA KEV." });
    const r5 = await runMatcherForSignal(record(s5, "cisa_kev", "Critical", "Cisco"), seed.orgA.id);
    expect(r5.finding_was_created).toBe(true); // closed rows are not reuse targets
    expect(await cveFindingCount(seed.orgA.id)).toBe(3);
  });
});
