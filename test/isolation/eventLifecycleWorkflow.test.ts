/**
 * eventLifecycleWorkflow.test.ts — Intelligence Pipeline Hardening (items 4/5/7).
 *
 * Real-Postgres behaviour of lifecycle-driven workflow automation: reaching a
 * trigger-worthy state fires per-org follow-through ONCE — a finding is
 * reconciled and a notification claimed for each org tracking the vendor — and a
 * second pass fires nothing new (once per event lifecycle transition, not per
 * signal ingestion). Org-isolated.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { processEventLifecycleTriggers } from "../../src/api/lib/signals/eventLifecycleWorkflow.js";

const FLAG = "SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
let prevFlag: string | undefined;

async function insertEvent(canonicalKey: string, vendor: string, status: string, severity = "Critical"): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO intelligence_events
       (canonical_key, title, executive_summary, summary_status, event_type, severity, status, affected_cve, affected_vendor, source_count, confidence, ever_exploited)
     VALUES ($1, 'Acme RCE', 'Acme RCE actively exploited. Sources: CISA KEV.', 'complete', 'cve', $3, $2, 'CVE-2026-7000', $4, 2, 80, TRUE)
     RETURNING id`,
    [canonicalKey, status, severity, vendor]
  );
  return r.rows[0].id;
}

async function scalar(sql: string, params: unknown[]): Promise<number> {
  const r = await pool.query<{ n: string }>(sql, params);
  return parseInt(r.rows[0].n, 10);
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  prevFlag = process.env[FLAG];
  process.env[FLAG] = "true";
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the lifecycle workflow test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  if (prevFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = prevFlag;
  await pool?.end();
});

describe("items 4/5/7 — lifecycle-driven workflow (real Postgres)", () => {
  it("fires per-org follow-through once per transition, then never again", async () => {
    await seedVendor(pool, seed.orgA.id, { name: "Acme" });
    const eventId = await insertEvent("cve:CVE-2026-7000", "Acme", "actively_exploited");

    const first = await processEventLifecycleTriggers();
    expect(first.transitions).toBeGreaterThanOrEqual(1);
    expect(first.findings_reconciled).toBeGreaterThanOrEqual(1);
    expect(first.notifications_claimed).toBeGreaterThanOrEqual(1);

    // Exactly one finding, one notification, one trigger for this event.
    expect(await scalar(`SELECT COUNT(*)::text AS n FROM findings WHERE organization_id=$1 AND source_type='intelligence_event' AND source_id=$2`, [seed.orgA.id, eventId])).toBe(1);
    expect(await scalar(`SELECT COUNT(*)::text AS n FROM intelligence_event_notifications WHERE organization_id=$1 AND canonical_key='cve:CVE-2026-7000'`, [seed.orgA.id])).toBe(1);
    expect(await scalar(`SELECT COUNT(*)::text AS n FROM intelligence_event_workflow_triggers WHERE event_id=$1 AND to_state='actively_exploited'`, [eventId])).toBe(1);

    // Second pass: the transition already fired → nothing new.
    const second = await processEventLifecycleTriggers();
    expect(second.transitions).toBe(0);
    expect(await scalar(`SELECT COUNT(*)::text AS n FROM findings WHERE organization_id=$1 AND source_type='intelligence_event' AND source_id=$2`, [seed.orgA.id, eventId])).toBe(1);
    expect(await scalar(`SELECT COUNT(*)::text AS n FROM intelligence_event_workflow_triggers WHERE event_id=$1`, [eventId])).toBe(1);
  });

  it("does not create findings for an org that does not track the vendor", async () => {
    const eventId = await insertEvent("cve:CVE-2026-7001", "Zeta", "confirmed", "High");
    await processEventLifecycleTriggers();
    // No org tracks 'Zeta' → no finding anywhere for this event.
    expect(await scalar(`SELECT COUNT(*)::text AS n FROM findings WHERE source_type='intelligence_event' AND source_id=$1`, [eventId])).toBe(0);
    // The trigger still records once (so it is not reprocessed forever).
    expect(await scalar(`SELECT COUNT(*)::text AS n FROM intelligence_event_workflow_triggers WHERE event_id=$1`, [eventId])).toBe(1);
  });
});
