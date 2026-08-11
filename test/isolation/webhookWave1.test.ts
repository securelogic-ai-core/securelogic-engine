/**
 * webhookWave1.test.ts — DS-15 wave-1 events against real Postgres.
 *
 * What only the real schema can prove:
 *   1. the acceptance.expiring claim (UPDATE … SET expiring_notified_at) is
 *      PERMITTED by the finding_risk_acceptances WORM trigger — bookkeeping,
 *      not decision content — and the 20260911 migration column exists;
 *   2. claim-then-emit is at-most-once: a second sweep claims nothing and
 *      writes no new deliveries;
 *   3. deliveries are org-isolated: org B's endpoint records nothing from
 *      org A's warnings;
 *   4. the delivery payload envelope carries `version: 1` while wave 1 is on;
 *   5. flag off → the warning phase is a pure no-op (no claims, no rows).
 *
 * Deliveries are asserted via webhook_deliveries bookkeeping rows (the
 * dispatcher writes them even when the sink URL is unreachable — same device
 * as webhookDispatcherElevated.test.ts).
 */

process.env.JWT_SECRET ??= "test-jwt-secret-for-webhook-wave1";
process.env.SECURELOGIC_RISK_ACCEPTANCE_ENABLED = "true";
process.env.SECURELOGIC_WEBHOOK_WAVE1_ENABLED = "true";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedWebhookEndpoint, seedUser, type TestDbSeed } from "./testDb.js";
import { runRiskAcceptanceExpiringWarnings } from "../../src/api/workers/riskAcceptanceExpiryWorker.js";

let seed: TestDbSeed;
let pool: Pool;
let ownerA = "";
let approverA = "";
let ownerB = "";
let approverB = "";

function isoInDays(days: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function mkApprovedAcceptance(
  orgId: string,
  title: string,
  expiresInDays: number,
  people: { owner: string; approver: string }
): Promise<{ acceptanceId: string; findingId: string }> {
  const f = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, status)
     VALUES ($1, $2, 'High', 'wave1 seed', 'manual', 'open') RETURNING id`,
    [orgId, title]
  );
  const findingId = f.rows[0]!.id;
  // The approval-complete CHECK requires the full governance facts on any
  // 'approved' row: owner, rationale, approver, approved_at, expires_at.
  const a = await pool.query<{ id: string }>(
    `INSERT INTO finding_risk_acceptances
       (organization_id, finding_id, state, owner_user_id, rationale,
        approver_user_id, approved_at, expires_at)
     VALUES ($1, $2, 'approved', $3, 'seeded approved acceptance', $4, NOW(), $5)
     RETURNING id`,
    [orgId, findingId, people.owner, people.approver, isoInDays(expiresInDays)]
  );
  return { acceptanceId: a.rows[0]!.id, findingId };
}

/** Poll webhook_deliveries until `atLeast` rows match, or time out (dispatch is fire-and-forget). */
async function waitForDeliveries(
  where: string,
  params: unknown[],
  atLeast: number,
  timeoutMs = 4000
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let n = -1;
  while (Date.now() < deadline) {
    const r = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM webhook_deliveries WHERE ${where}`,
      params
    );
    n = Number(r.rows[0]!.n);
    if (n >= atLeast) return n;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return n;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the wave-1 test.");
  pool = new Pool({ connectionString: url, ssl: false });

  await seedWebhookEndpoint(pool, seed.orgA.id);
  await seedWebhookEndpoint(pool, seed.orgB.id);

  ownerA = (await seedUser(pool, seed.orgA.id, { email: "owner@a.test" })).id;
  approverA = (await seedUser(pool, seed.orgA.id, { email: "approver@a.test" })).id;
  ownerB = (await seedUser(pool, seed.orgB.id, { email: "owner@b.test" })).id;
  approverB = (await seedUser(pool, seed.orgB.id, { email: "approver@b.test" })).id;
}, 300_000);

afterAll(async () => {
  await pool?.end();
});

describe("acceptance.expiring — claim-then-emit against the real WORM trigger", () => {
  it("claims inside the window (WORM permits the bookkeeping write) and records an org-scoped delivery", async () => {
    const { acceptanceId } = await mkApprovedAcceptance(seed.orgA.id, "expiring soon", 10, { owner: ownerA, approver: approverA });
    // Outside the 30-day window — must NOT be claimed.
    const far = await mkApprovedAcceptance(seed.orgA.id, "expiring far", 200, { owner: ownerA, approver: approverA });

    const result = await runRiskAcceptanceExpiringWarnings();
    expect(result.warned).toBe(1);

    // The claim survived the WORM trigger and landed on the right row only.
    const rows = await pool.query<{ id: string; expiring_notified_at: string | null }>(
      `SELECT id, expiring_notified_at FROM finding_risk_acceptances
        WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[acceptanceId, far.acceptanceId].sort()]
    );
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r.expiring_notified_at]));
    expect(byId[acceptanceId]).not.toBeNull();
    expect(byId[far.acceptanceId]).toBeNull();

    // Delivery bookkeeping: one acceptance.expiring row, org A's endpoint only.
    const delivered = await waitForDeliveries(
      `organization_id = $1 AND event_type = 'acceptance.expiring'`,
      [seed.orgA.id],
      1
    );
    expect(delivered).toBe(1);

    const crossOrg = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM webhook_deliveries
        WHERE organization_id = $1 AND event_type = 'acceptance.expiring'`,
      [seed.orgB.id]
    );
    expect(Number(crossOrg.rows[0]!.n)).toBe(0);
  });

  it("second sweep claims nothing and writes no new deliveries (at-most-once)", async () => {
    const before = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM webhook_deliveries WHERE event_type = 'acceptance.expiring'`
    );

    const result = await runRiskAcceptanceExpiringWarnings();
    expect(result.warned).toBe(0);

    // Fire-and-forget means "no new rows" needs a settle window before asserting.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const after = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM webhook_deliveries WHERE event_type = 'acceptance.expiring'`
    );
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it("delivery payload envelope carries version 1 while wave 1 is on", async () => {
    const r = await pool.query<{ payload: { version?: number; event_type?: string } }>(
      `SELECT payload FROM webhook_deliveries
        WHERE event_type = 'acceptance.expiring' AND organization_id = $1
        LIMIT 1`,
      [seed.orgA.id]
    );
    expect(r.rows[0]).toBeDefined();
    expect(r.rows[0]!.payload.version).toBe(1);
    expect(r.rows[0]!.payload.event_type).toBe("acceptance.expiring");
  });

  it("flag off → pure no-op: no claims, no deliveries", async () => {
    const { acceptanceId } = await mkApprovedAcceptance(seed.orgB.id, "dark-flag expiring", 5, { owner: ownerB, approver: approverB });

    delete process.env.SECURELOGIC_WEBHOOK_WAVE1_ENABLED;
    try {
      const result = await runRiskAcceptanceExpiringWarnings();
      expect(result).toEqual({ organizations: 0, warned: 0 });
    } finally {
      process.env.SECURELOGIC_WEBHOOK_WAVE1_ENABLED = "true";
    }

    const row = await pool.query<{ expiring_notified_at: string | null }>(
      `SELECT expiring_notified_at FROM finding_risk_acceptances WHERE id = $1`,
      [acceptanceId]
    );
    expect(row.rows[0]!.expiring_notified_at).toBeNull();
  });
});
