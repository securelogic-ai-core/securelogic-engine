/**
 * actionUnblockWorkflow.test.ts — the explicit, auditable Unblock transition.
 *
 * The walkthrough found Unblock was a bare status PATCH: allowed from any state,
 * indistinguishable from a plain Start, with no preserved record of the blocker
 * being resolved. POST /api/actions/:id/unblock replaces it — a guarded
 * Blocked → In Progress transition that writes a dedicated `action.unblocked`
 * lifecycle event carrying the prior blocker snapshot, stays org-scoped, and
 * refuses when the action is not currently blocked.
 *
 * This drives the real app over real Postgres and proves the transition, the
 * audit event, that blocker metadata stays queryable, the not-blocked guard, and
 * cross-tenant isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import request from "supertest";
import type { Express } from "express";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let app: Express;

async function seedFinding(orgId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, status)
     VALUES ($1, 'unblock seed', 'High', 'seed', 'manual', 'open')
     RETURNING id`,
    [orgId]
  );
  return r.rows[0]!.id;
}

/** Seed an action already in the `blocked` state with full blocker metadata —
 *  the realistic starting point for an unblock. */
async function seedBlockedAction(orgId: string, findingId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO actions
       (organization_id, title, source_type, source_id, priority, status,
        blocked_reason, blocked_dependency, blocked_expected_unblock_date)
     VALUES ($1, 'remediate', 'finding', $2, 'near_term', 'blocked',
             'Waiting on vendor patch', 'CR-1042', '2026-08-01')
     RETURNING id`,
    [orgId, findingId]
  );
  return r.rows[0]!.id;
}

async function seedActionWithStatus(
  orgId: string,
  findingId: string,
  status: string
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO actions (organization_id, title, source_type, source_id, priority, status)
     VALUES ($1, 'remediate', 'finding', $2, 'near_term', $3)
     RETURNING id`,
    [orgId, findingId, status]
  );
  return r.rows[0]!.id;
}

const unblock = (id: string, key: string) =>
  request(app).post(`/api/actions/${id}/unblock`).set("X-Api-Key", key).send({});

/** Poll security_audit_log for the fire-and-forget unblock event (writeAuditEvent
 *  does not await), matching the codebase's audit-assertion pattern. */
async function waitForUnblockEvent(
  actionId: string,
  orgId: string
): Promise<{ payload: Record<string, unknown>; actor: string | null; at: string } | null> {
  for (let i = 0; i < 40; i++) {
    const r = await pool.query<{ payload: Record<string, unknown>; actor_api_key_id: string | null; created_at: string }>(
      `SELECT payload, actor_api_key_id, created_at
         FROM security_audit_log
        WHERE organization_id = $1
          AND resource_type = 'action'
          AND resource_id = $2
          AND event_type = 'action.unblocked'
        ORDER BY created_at DESC
        LIMIT 1`,
      [orgId, actionId]
    );
    if ((r.rowCount ?? 0) > 0) {
      const row = r.rows[0]!;
      return { payload: row.payload, actor: row.actor_api_key_id, at: String(row.created_at) };
    }
    await new Promise((res) => setTimeout(res, 50));
  }
  return null;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the unblock-workflow test.");
  pool = new Pool({ connectionString: url, ssl: false });
  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

describe("POST /api/actions/:id/unblock — explicit auditable transition", () => {
  it("confirm transitions Blocked → In Progress", async () => {
    const findingId = await seedFinding(seed.orgA.id);
    const actionId = await seedBlockedAction(seed.orgA.id, findingId);

    const res = await unblock(actionId, seed.orgA.apiKey);
    expect(res.status).toBe(200);
    expect(res.body.action.status).toBe("in_progress");

    const row = await pool.query(
      `SELECT status FROM actions WHERE id = $1 AND organization_id = $2`,
      [actionId, seed.orgA.id]
    );
    expect(row.rows[0]!.status).toBe("in_progress");
  });

  it("writes an action.unblocked lifecycle event with actor, timestamp, and the prior blocker snapshot", async () => {
    const findingId = await seedFinding(seed.orgA.id);
    const actionId = await seedBlockedAction(seed.orgA.id, findingId);

    const res = await unblock(actionId, seed.orgA.apiKey);
    expect(res.status).toBe(200);

    const evt = await waitForUnblockEvent(actionId, seed.orgA.id);
    expect(evt).not.toBeNull();
    // Actor + timestamp — the "who and when" of an auditable transition.
    expect(evt!.actor).not.toBeNull();
    expect(evt!.at).toBeTruthy();
    // The resolved blocker is preserved on the event.
    expect(evt!.payload["from"]).toBe("blocked");
    expect(evt!.payload["to"]).toBe("in_progress");
    expect(evt!.payload["blocked_reason"]).toBe("Waiting on vendor patch");
    expect(evt!.payload["blocked_dependency"]).toBe("CR-1042");
    expect(evt!.payload["blocked_expected_unblock_date"]).not.toBeNull();
  });

  it("blocker metadata remains queryable after unblock (row columns preserved)", async () => {
    const findingId = await seedFinding(seed.orgA.id);
    const actionId = await seedBlockedAction(seed.orgA.id, findingId);

    await unblock(actionId, seed.orgA.apiKey);

    const row = await pool.query(
      `SELECT status, blocked_reason, blocked_dependency, blocked_expected_unblock_date
         FROM actions WHERE id = $1 AND organization_id = $2`,
      [actionId, seed.orgA.id]
    );
    expect(row.rows[0]!.status).toBe("in_progress");
    // The transition resolves the blocker; it does not erase what it resolved.
    expect(row.rows[0]!.blocked_reason).toBe("Waiting on vendor patch");
    expect(row.rows[0]!.blocked_dependency).toBe("CR-1042");
    expect(row.rows[0]!.blocked_expected_unblock_date).not.toBeNull();
  });

  it("rejects unblock when the action is not currently blocked (409)", async () => {
    const findingId = await seedFinding(seed.orgA.id);
    const inProgressId = await seedActionWithStatus(seed.orgA.id, findingId, "in_progress");

    const res = await unblock(inProgressId, seed.orgA.apiKey);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("action_not_blocked");

    // State is unchanged.
    const row = await pool.query(`SELECT status FROM actions WHERE id = $1`, [inProgressId]);
    expect(row.rows[0]!.status).toBe("in_progress");
  });

  it("rejects a repeated unblock — the second call is no longer blocked (409)", async () => {
    const findingId = await seedFinding(seed.orgA.id);
    const actionId = await seedBlockedAction(seed.orgA.id, findingId);

    const first = await unblock(actionId, seed.orgA.apiKey);
    expect(first.status).toBe(200);

    const second = await unblock(actionId, seed.orgA.apiKey);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("action_not_blocked");
  });

  it("another org cannot unblock this org's action (404, no state change)", async () => {
    const findingId = await seedFinding(seed.orgA.id);
    const actionId = await seedBlockedAction(seed.orgA.id, findingId);

    const res = await unblock(actionId, seed.orgB.apiKey);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("action_not_found");

    // The action is untouched and still blocked.
    const row = await pool.query(`SELECT status FROM actions WHERE id = $1`, [actionId]);
    expect(row.rows[0]!.status).toBe("blocked");
  });
});
