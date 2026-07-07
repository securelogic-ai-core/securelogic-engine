/**
 * intelligenceEventProjection.test.ts — Intelligence Pipeline Hardening / IE.P4.
 *
 * Real-Postgres behaviour of the canonical Intelligence Event projection:
 * multiple GLOBAL cyber_signals describing the same CVE collapse into ONE
 * evolving intelligence_events row (never duplicate events/findings), the
 * corroboration ledger preserves every source, the timeline accrues, severity
 * peaks and status escalates, and re-projection is idempotent. Also exercises
 * the flag-gated batch entrypoint projectUnprojectedGlobalSignals().
 *
 * These tables are GLOBAL (org-agnostic), so this is a projection-correctness
 * test rather than a tenant-isolation test, but it needs real Postgres and so
 * lives in the isolation lane.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

import { bootstrapTestDb, seedCyberSignal, type TestDbSeed } from "./testDb.js";
import {
  projectSignalWithClient,
  projectUnprojectedGlobalSignals,
  toIncomingSignal,
  type CyberSignalRow
} from "../../src/api/lib/signals/intelligenceEventStore.js";

const FLAG = "SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
let prevFlag: string | undefined;

function row(part: Partial<CyberSignalRow>): CyberSignalRow {
  return {
    id: "", source: "nvd", signal_type: "cve", severity: "High",
    normalized_summary: "Acme Gateway remote code execution disclosed. Patch pending.",
    affected_vendor: "Acme", affected_cve: "CVE-2026-8080", external_id: null,
    dedup_hash: "", ingestion_timestamp: "2026-07-07T10:00:00.000Z", ...part
  };
}

async function projectOne(part: Partial<CyberSignalRow>): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await projectSignalWithClient(client, toIncomingSignal(row(part)));
  } finally {
    client.release();
  }
}

async function count(table: string, where: string, params: unknown[]): Promise<number> {
  const r = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ${table} WHERE ${where}`, params);
  return parseInt(r.rows[0].n, 10);
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  prevFlag = process.env[FLAG];
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the intelligence-event projection test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  if (prevFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = prevFlag;
  await pool?.end();
});

describe("IE.P4 — canonical event projection (real Postgres)", () => {
  it("collapses multi-source same-CVE signals into one evolving event with corroboration + timeline", async () => {
    const cve = "CVE-2026-8080";
    const nvdId = await seedCyberSignal(pool, { orgId: null, source: "nvd", signalType: "cve", severity: "Moderate", cve, vendor: "Acme", dedup: "ie-nvd-1", summary: "Acme Gateway RCE disclosed. Patch pending." });
    const bcId = await seedCyberSignal(pool, { orgId: null, source: "bleepingcomputer", signalType: "cve", severity: "High", cve, vendor: "Acme", dedup: "ie-bc-1", summary: "Acme Gateway flaw under discussion. Details emerging." });
    const kevId = await seedCyberSignal(pool, { orgId: null, source: "cisa_kev", signalType: "cve", severity: "Critical", cve, vendor: "Acme", dedup: "ie-kev-1", summary: "CVE-2026-8080 added to the KEV catalog. Active exploitation observed." });

    await projectOne({ id: nvdId, source: "nvd", severity: "Moderate", dedup_hash: "ie-nvd-1", affected_cve: cve });
    await projectOne({ id: bcId, source: "bleepingcomputer", severity: "High", dedup_hash: "ie-bc-1", affected_cve: cve });
    await projectOne({ id: kevId, source: "cisa_kev", severity: "Critical", dedup_hash: "ie-kev-1", affected_cve: cve });

    // Exactly ONE event for this CVE.
    const evtRes = await pool.query<{ id: string; severity: string; status: string; source_count: number; confidence: number }>(
      `SELECT id, severity, status, source_count, confidence FROM intelligence_events WHERE canonical_key = $1`,
      [`cve:${cve}`]
    );
    expect(evtRes.rows).toHaveLength(1);
    const evt = evtRes.rows[0];
    expect(evt.severity).toBe("Critical"); // peak across sources
    expect(evt.status).toBe("actively_exploited"); // KEV escalated it
    expect(evt.source_count).toBe(3);
    expect(evt.confidence).toBeGreaterThan(50);

    // Three source-ledger rows: one canonical, two corroborating — attribution preserved.
    expect(await count("intelligence_event_sources", "event_id = $1", [evt.id])).toBe(3);
    expect(await count("intelligence_event_sources", "event_id = $1 AND relation = 'canonical'", [evt.id])).toBe(1);

    // Timeline accrued a first_seen + corroboration + exploit + severity entries.
    const tl = await pool.query<{ entry_type: string }>(
      `SELECT entry_type FROM intelligence_event_timeline WHERE event_id = $1`,
      [evt.id]
    );
    const types = tl.rows.map((r) => r.entry_type);
    expect(types).toContain("first_seen");
    expect(types).toContain("corroborated");
    expect(types).toContain("exploit_activity");
    expect(types).toContain("severity_change");
  });

  it("is idempotent — re-projecting a contributed signal creates nothing new", async () => {
    const cve = "CVE-2026-8080";
    const before = await pool.query<{ rev: number; sc: number }>(
      `SELECT revision AS rev, source_count AS sc FROM intelligence_events WHERE canonical_key = $1`,
      [`cve:${cve}`]
    );
    await projectOne({ id: (await pool.query<{ id: string }>(`SELECT id FROM cyber_signals WHERE dedup_hash='ie-nvd-1'`)).rows[0].id, source: "nvd", severity: "Moderate", dedup_hash: "ie-nvd-1", affected_cve: cve });
    const after = await pool.query<{ rev: number; sc: number }>(
      `SELECT revision AS rev, source_count AS sc FROM intelligence_events WHERE canonical_key = $1`,
      [`cve:${cve}`]
    );
    expect(after.rows[0].rev).toBe(before.rows[0].rev); // no revision bump
    expect(after.rows[0].sc).toBe(before.rows[0].sc);
    expect(await count("intelligence_event_sources", "event_id = (SELECT id FROM intelligence_events WHERE canonical_key=$1)", [`cve:${cve}`])).toBe(3);
  });

  it("batch entrypoint projects unprojected global signals when the flag is on, and no-ops when off", async () => {
    const cve = "CVE-2026-9090";
    await seedCyberSignal(pool, { orgId: null, source: "nvd", signalType: "cve", severity: "High", cve, vendor: "Beta", dedup: "ie-batch-1", summary: "Beta appliance auth bypass disclosed. Fix available." });

    // Flag OFF → no-op.
    process.env[FLAG] = "false";
    const off = await projectUnprojectedGlobalSignals();
    expect(off.skipped).toBe("disabled");
    expect(await count("intelligence_events", "canonical_key = $1", [`cve:${cve}`])).toBe(0);

    // Flag ON → projects the new global signal into one event.
    process.env[FLAG] = "true";
    const on = await projectUnprojectedGlobalSignals();
    expect(on.projected).toBeGreaterThanOrEqual(1);
    expect(await count("intelligence_events", "canonical_key = $1", [`cve:${cve}`])).toBe(1);

    // Second pass: everything already projected → nothing new.
    const again = await projectUnprojectedGlobalSignals();
    expect(again.projected).toBe(0);
  });
});
