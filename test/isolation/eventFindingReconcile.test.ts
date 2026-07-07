/**
 * eventFindingReconcile.test.ts — Intelligence Pipeline Hardening / IE.P6.
 *
 * Real-Postgres behaviour of event→finding reconciliation: a canonical event
 * whose affected vendor an org tracks yields exactly ONE finding; an evolving
 * event UPDATES that finding (dedup-by-update, never a duplicate); an org that
 * does not track the vendor gets no finding; and reconciliation is org-isolated.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { reconcileEventFindingForOrg } from "../../src/api/lib/signals/eventFindingStore.js";
import type { EventForFinding } from "../../src/api/lib/signals/eventFinding.js";

const FLAG = "SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
let prevFlag: string | undefined;

async function insertEvent(part: Partial<EventForFinding> & { canonical_key: string }): Promise<EventForFinding> {
  const e: EventForFinding = {
    event_id: "", title: "Acme Gateway RCE",
    executive_summary: "Acme Gateway has a critical RCE. Sources: NVD.",
    severity: "High", status: "corroborating", event_type: "cve",
    affected_vendor: "Acme", affected_cve: "CVE-2026-6161", ...part
  };
  const res = await pool.query<{ id: string }>(
    `INSERT INTO intelligence_events
       (canonical_key, title, executive_summary, summary_status, event_type, severity, status, affected_cve, affected_vendor, source_count, confidence)
     VALUES ($1, $2, $3, 'complete', $4, $5, $6, $7, $8, 1, 60)
     RETURNING id`,
    [part.canonical_key, e.title, e.executive_summary, e.event_type, e.severity, e.status, e.affected_cve, e.affected_vendor]
  );
  return { ...e, event_id: res.rows[0].id };
}

async function findingCount(orgId: string, eventId: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM findings WHERE organization_id=$1 AND source_type='intelligence_event' AND source_id=$2`,
    [orgId, eventId]
  );
  return parseInt(r.rows[0].n, 10);
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  prevFlag = process.env[FLAG];
  process.env[FLAG] = "true";
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the event-finding reconcile test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  if (prevFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = prevFlag;
  await pool?.end();
});

describe("IE.P6 — event→finding reconciliation (real Postgres)", () => {
  it("creates one finding when the org tracks the vendor, then UPDATES it (no duplicate)", async () => {
    await seedVendor(pool, seed.orgA.id, { name: "Acme" });
    const event = await insertEvent({ canonical_key: "cve:CVE-2026-6161", severity: "High" });

    const first = await reconcileEventFindingForOrg(seed.orgA.id, event);
    expect(first.action).toBe("created");
    expect(await findingCount(seed.orgA.id, event.event_id)).toBe(1);

    // Event escalates to Critical — reconcile again: SAME finding, updated.
    const escalated: EventForFinding = { ...event, severity: "Critical", status: "actively_exploited" };
    const second = await reconcileEventFindingForOrg(seed.orgA.id, escalated);
    expect(second.action).toBe("updated");
    expect(second.findingId).toBe(first.findingId);
    expect(await findingCount(seed.orgA.id, event.event_id)).toBe(1); // still ONE

    const sev = await pool.query<{ severity: string }>(`SELECT severity FROM findings WHERE id=$1`, [first.findingId!]);
    expect(sev.rows[0].severity).toBe("Critical");

    // A third identical reconcile is a no-op.
    const third = await reconcileEventFindingForOrg(seed.orgA.id, escalated);
    expect(third.action).toBe("noop");
    expect(await findingCount(seed.orgA.id, event.event_id)).toBe(1);
  });

  it("does not create a finding for an org that does not track the vendor (org-isolated)", async () => {
    const event = await insertEvent({ canonical_key: "cve:CVE-2026-6262", affected_vendor: "Beta", affected_cve: "CVE-2026-6262" });
    // orgB tracks no vendor named Beta.
    const out = await reconcileEventFindingForOrg(seed.orgB.id, event);
    expect(out.action).toBe("not_relevant");
    expect(await findingCount(seed.orgB.id, event.event_id)).toBe(0);
    // And orgA (tracks Acme, not Beta) also gets nothing for this event.
    expect((await reconcileEventFindingForOrg(seed.orgA.id, event)).action).toBe("not_relevant");
    expect(await findingCount(seed.orgA.id, event.event_id)).toBe(0);
  });
});
