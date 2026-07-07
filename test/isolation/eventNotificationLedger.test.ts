/**
 * eventNotificationLedger.test.ts — Intelligence Pipeline Hardening / IE.P7.
 *
 * Real-Postgres behaviour of the notification dedup ledger: a customer-impacting
 * critical event is CLAIMED once (send), a second evaluation is suppressed (no
 * duplicate), 'none' never touches the ledger, and claims are org-isolated.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import {
  evaluateAndClaimNotification,
  type EventNotificationInput
} from "../../src/api/lib/signals/eventNotificationStore.js";

const FLAG = "SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
let prevFlag: string | undefined;

const critical: EventNotificationInput = {
  event_id: "00000000-0000-0000-0000-0000000000aa",
  canonical_key: "cve:CVE-2026-7777",
  severity: "Critical",
  status: "actively_exploited"
};

async function ledgerCount(orgId: string, key: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM intelligence_event_notifications WHERE organization_id=$1 AND canonical_key=$2`,
    [orgId, key]
  );
  return parseInt(r.rows[0].n, 10);
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  prevFlag = process.env[FLAG];
  process.env[FLAG] = "true";
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the notification ledger test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  if (prevFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = prevFlag;
  await pool?.end();
});

describe("IE.P7 — notification dedup ledger (real Postgres)", () => {
  it("claims a customer-impacting critical event once, then suppresses duplicates", async () => {
    // event_id NULL (the ledger dedups on canonical_key), so no FK dependency.
    const ev = { ...critical, event_id: null };

    const first = await evaluateAndClaimNotification(seed.orgA.id, ev, true);
    expect(first.channel).toBe("immediate");
    expect(first.claimed).toBe(true);
    expect(await ledgerCount(seed.orgA.id, critical.canonical_key)).toBe(1);

    const second = await evaluateAndClaimNotification(seed.orgA.id, ev, true);
    expect(second.channel).toBe("immediate");
    expect(second.claimed).toBe(false); // deduped — no duplicate send
    expect(await ledgerCount(seed.orgA.id, critical.canonical_key)).toBe(1);
  });

  it("does not touch the ledger for non-customer-impacting events", async () => {
    const key = "cve:CVE-2026-8888";
    const out = await evaluateAndClaimNotification(seed.orgA.id, { ...critical, canonical_key: key, event_id: null }, false);
    expect(out.channel).toBe("none");
    expect(out.claimed).toBe(false);
    expect(await ledgerCount(seed.orgA.id, key)).toBe(0);
  });

  it("claims are org-isolated (org B can still claim what org A claimed)", async () => {
    const ev = { ...critical, canonical_key: "cve:CVE-2026-9999", event_id: null };
    const a = await evaluateAndClaimNotification(seed.orgA.id, ev, true);
    const b = await evaluateAndClaimNotification(seed.orgB.id, ev, true);
    expect(a.claimed).toBe(true);
    expect(b.claimed).toBe(true); // independent per-org ledger
    expect(await ledgerCount(seed.orgA.id, ev.canonical_key)).toBe(1);
    expect(await ledgerCount(seed.orgB.id, ev.canonical_key)).toBe(1);
  });
});
