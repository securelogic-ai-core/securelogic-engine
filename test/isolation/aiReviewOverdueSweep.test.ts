/**
 * aiReviewOverdueSweep.test.ts — the AI overdue-review notification sweep
 * against real Postgres with RLS live.
 *
 * What is proven here:
 *   - dark by default: with the flag off the sweep is a no-op — REFUSAL, not
 *     absence (overdue rows exist and stay unclaimed, zero audit rows);
 *   - claim-then-notify is exactly-once: each lapsed system is claimed and
 *     audited once; a re-run finds nothing left to claim;
 *   - the sweep NOTIFIES, NEVER FLIPS: next_review_due and every governance
 *     fact are untouched — the one write is the bookkeeping marker;
 *   - future-due and no-clock systems are never touched;
 *   - tenancy: each org's rows are claimed under its own tenant transaction
 *     and audited under its own organization_id;
 *   - re-arm: a PATCH writing next_review_due clears the marker, and a fresh
 *     lapse notifies AGAIN — one notification per overdue episode, not one
 *     per row forever.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { runAiReviewOverdueSweep } from "../../src/api/workers/aiReviewOverdueWorker.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

let ownerA: string; // business owner on overdueWithOwner
let overdueWithOwner: string; // A: due yesterday, business owner named
let overduePlain: string; // A: due last week, no business owner
let futureDue: string; // A: due in 30 days — never touched
let noClock: string; // A: no next_review_due — never touched
let overdueB: string; // B: due yesterday

async function seedAiSystem(
  orgId: string,
  name: string,
  dueSql: string | null,
  businessOwnerUserId: string | null = null
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO ai_systems (organization_id, name, use_case, criticality,
                             next_review_due, review_cadence_days, business_owner_user_id)
     VALUES ($1, $2, 'test triage', 'high', ${dueSql ?? "NULL"}, 90, $3)
     RETURNING id`,
    [orgId, name, businessOwnerUserId]
  );
  return r.rows[0]!.id;
}

async function markerOf(id: string): Promise<string | null> {
  const r = await pool.query<{ review_overdue_notified_at: string | null }>(
    `SELECT review_overdue_notified_at FROM ai_systems WHERE id = $1`,
    [id]
  );
  return r.rows[0]!.review_overdue_notified_at;
}

async function auditRows(orgId: string): Promise<Array<{ resource_id: string; payload: Record<string, unknown> }>> {
  const r = await pool.query<{ resource_id: string; payload: Record<string, unknown> }>(
    `SELECT resource_id, payload FROM security_audit_log
      WHERE organization_id = $1 AND event_type = 'ai_system.review_overdue'
      ORDER BY created_at ASC`,
    [orgId]
  );
  return r.rows;
}

/** writeAuditEvent is fire-and-forget — poll briefly rather than racing it. */
async function untilAuditCount(orgId: string, n: number): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if ((await auditRows(orgId)).length >= n) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

const patchSystem = (key: string, id: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/ai-systems/${id}`).set("X-Api-Key", key).send(body);

beforeAll(async () => {
  seed = await bootstrapTestDb();
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

  app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));

  ownerA = (await seedUser(pool, seed.orgA.id, {})).id;
  overdueWithOwner = await seedAiSystem(seed.orgA.id, "lapsed with owner", "CURRENT_DATE - 1", ownerA);
  overduePlain = await seedAiSystem(seed.orgA.id, "lapsed plain", "CURRENT_DATE - 7");
  futureDue = await seedAiSystem(seed.orgA.id, "still current", "CURRENT_DATE + 30");
  noClock = await seedAiSystem(seed.orgA.id, "no clock", null);
  overdueB = await seedAiSystem(seed.orgB.id, "org B lapsed", "CURRENT_DATE - 1");
}, 180_000);

afterAll(async () => {
  delete process.env["SECURELOGIC_AI_REVIEW_SWEEP_ENABLED"];
  await pool?.end();
});

describe("dark by default — refusal, not absence", () => {
  it("with the flag off, lapsed systems exist and the sweep claims NOTHING", async () => {
    delete process.env["SECURELOGIC_AI_REVIEW_SWEEP_ENABLED"];
    const result = await runAiReviewOverdueSweep();
    expect(result).toEqual({ organizations: 0, overdue: 0 });
    expect(await markerOf(overdueWithOwner)).toBeNull();
    expect(await markerOf(overdueB)).toBeNull();
    expect(await auditRows(seed.orgA.id)).toEqual([]);
  });
});

describe("the sweep (flag on)", () => {
  beforeAll(() => {
    process.env["SECURELOGIC_AI_REVIEW_SWEEP_ENABLED"] = "true";
  });

  it("claims each lapsed system once, per org, and writes the audit record", async () => {
    const result = await runAiReviewOverdueSweep();
    expect(result.organizations).toBe(2);
    expect(result.overdue).toBe(3);

    // Markers set on the lapsed rows only.
    expect(await markerOf(overdueWithOwner)).not.toBeNull();
    expect(await markerOf(overduePlain)).not.toBeNull();
    expect(await markerOf(overdueB)).not.toBeNull();
    expect(await markerOf(futureDue)).toBeNull();
    expect(await markerOf(noClock)).toBeNull();

    // The durable record, under each org's own id.
    await untilAuditCount(seed.orgA.id, 2);
    await untilAuditCount(seed.orgB.id, 1);
    const a = await auditRows(seed.orgA.id);
    const b = await auditRows(seed.orgB.id);
    expect(a.map((r) => r.resource_id).sort()).toEqual(
      [overdueWithOwner, overduePlain].sort()
    );
    expect(b.map((r) => r.resource_id)).toEqual([overdueB]);

    const withOwner = a.find((r) => r.resource_id === overdueWithOwner)!;
    expect(withOwner.payload["business_owner_user_id"]).toBe(ownerA);
    expect(withOwner.payload["name"]).toBe("lapsed with owner");
    expect(typeof withOwner.payload["next_review_due"]).toBe("string");
  });

  it("notifies, never flips: next_review_due is untouched by the claim", async () => {
    const r = await pool.query<{ due: string }>(
      `SELECT to_char(next_review_due, 'YYYY-MM-DD') AS due FROM ai_systems WHERE id = $1`,
      [overduePlain]
    );
    const expected = await pool.query<{ due: string }>(
      `SELECT to_char(CURRENT_DATE - 7, 'YYYY-MM-DD') AS due`
    );
    expect(r.rows[0]!.due).toBe(expected.rows[0]!.due);
  });

  it("a re-run finds nothing left to claim — exactly once per lapse", async () => {
    const again = await runAiReviewOverdueSweep();
    expect(again).toEqual({ organizations: 0, overdue: 0 });
    expect((await auditRows(seed.orgA.id)).length).toBe(2);
    expect((await auditRows(seed.orgB.id)).length).toBe(1);
  });

  it("re-arm: PATCHing next_review_due clears the marker, and a fresh lapse notifies AGAIN", async () => {
    // The review happens: the date moves forward. The marker must clear.
    const forward = await patchSystem(seed.orgA.apiKey, overdueWithOwner, {
      next_review_due: "2030-01-01",
    });
    expect(forward.status).toBe(200);
    expect(await markerOf(overdueWithOwner)).toBeNull();

    // A current date never notifies.
    const quiet = await runAiReviewOverdueSweep();
    expect(quiet).toEqual({ organizations: 0, overdue: 0 });

    // The next lapse is a NEW episode.
    const lapse = await patchSystem(seed.orgA.apiKey, overdueWithOwner, {
      next_review_due: "2026-01-01",
    });
    expect(lapse.status).toBe(200);
    const result = await runAiReviewOverdueSweep();
    expect(result).toEqual({ organizations: 1, overdue: 1 });
    await untilAuditCount(seed.orgA.id, 3);
    const a = await auditRows(seed.orgA.id);
    expect(a.filter((r) => r.resource_id === overdueWithOwner).length).toBe(2);
  });
});
