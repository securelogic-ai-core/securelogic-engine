/**
 * matcherEventLinkage.test.ts — Intelligence Pipeline Hardening (event-native linkage).
 *
 * Real-Postgres proof that the matcher-linkage layer is event-native: when the
 * flag is on, a matcher-produced suggestion carries the canonical
 * intelligence_event_id (resolved from the corroboration ledger) while
 * preserving signal_id for backward compatibility. Flag OFF → intelligence_event_id
 * is NULL (byte-identical legacy). Tenant-scoped.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

import { bootstrapTestDb, seedVendor, seedCyberSignal, type TestDbSeed } from "./testDb.js";
import { projectSignalWithClient } from "../../src/api/lib/signals/intelligenceEventStore.js";
import { runMatcherForSignal, type CyberSignalRecord } from "../../src/api/lib/cyberSignalProcessingService.js";

const FLAG = "SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
let prevFlag: string | undefined;

async function projectGlobalSignal(signalId: string, cve: string): Promise<void> {
  const client: PoolClient = await pool.connect();
  try {
    await projectSignalWithClient(client, {
      cyber_signal_id: signalId, source: "nvd", external_id: null, signal_type: "cve",
      severity: "Critical", affected_cve: cve, affected_vendor: "Acme",
      summary: "Acme Gateway RCE. Sources: NVD.", ingestion_timestamp: "2026-07-07T10:00:00.000Z",
      dedup_hash: `dh-${signalId}`
    });
  } finally {
    client.release();
  }
}

async function suggestionEventId(orgId: string, signalId: string): Promise<string | null> {
  const r = await pool.query<{ intelligence_event_id: string | null }>(
    `SELECT intelligence_event_id FROM signal_match_suggestions
      WHERE organization_id=$1 AND signal_id=$2 AND target_type='vendor' LIMIT 1`,
    [orgId, signalId]
  );
  return r.rows[0]?.intelligence_event_id ?? null;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  prevFlag = process.env[FLAG];
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the matcher event-linkage test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  if (prevFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = prevFlag;
  await pool?.end();
});

describe("event-native matcher linkage (real Postgres)", () => {
  it("stamps the canonical intelligence_event_id on the suggestion when the flag is on", async () => {
    await seedVendor(pool, seed.orgA.id, { name: "Acme" });
    const cve = "CVE-2026-5151";
    const signalId = await seedCyberSignal(pool, { orgId: null, source: "nvd", signalType: "cve", severity: "Critical", cve, vendor: "Acme", dedup: "mev-1", summary: "Acme Gateway RCE. Sources: NVD." });
    await projectGlobalSignal(signalId, cve);

    const eventRow = await pool.query<{ id: string }>(`SELECT id FROM intelligence_events WHERE canonical_key=$1`, [`cve:${cve}`]);
    const eventId = eventRow.rows[0].id;

    const record: CyberSignalRecord = {
      id: signalId, organization_id: "", source: "nvd", signal_type: "cve",
      severity: "Critical", normalized_summary: "Acme Gateway RCE. Sources: NVD.",
      affected_vendor: "Acme", affected_cve: cve
    };

    process.env[FLAG] = "true";
    const res = await runMatcherForSignal(record, seed.orgA.id);
    expect(res.matched_vendor_id).toBeTruthy(); // matched Acme → produced a suggestion
    // The suggestion is event-native: it references the canonical event.
    expect(await suggestionEventId(seed.orgA.id, signalId)).toBe(eventId);
  });

  it("leaves intelligence_event_id NULL when the flag is off (byte-identical legacy)", async () => {
    await seedVendor(pool, seed.orgB.id, { name: "Beta" });
    const cve = "CVE-2026-5252";
    const signalId = await seedCyberSignal(pool, { orgId: null, source: "nvd", signalType: "cve", severity: "High", cve, vendor: "Beta", dedup: "mev-2", summary: "Beta flaw. Sources: NVD." });

    const record: CyberSignalRecord = {
      id: signalId, organization_id: "", source: "nvd", signal_type: "cve",
      severity: "High", normalized_summary: "Beta flaw. Sources: NVD.",
      affected_vendor: "Beta", affected_cve: cve
    };

    process.env[FLAG] = "false";
    const res = await runMatcherForSignal(record, seed.orgB.id);
    expect(res.matched_vendor_id).toBeTruthy();
    expect(await suggestionEventId(seed.orgB.id, signalId)).toBeNull(); // legacy: signal-only
  });
});
