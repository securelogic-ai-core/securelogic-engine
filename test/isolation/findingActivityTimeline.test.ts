/**
 * findingActivityTimeline.test.ts — the finding Activity timeline is audit-grade.
 *
 * The Decision Workspace's Activity feed must answer WHEN (exact), WHO, WHAT
 * changed, on WHICH remediation action, and — for a block/unblock — WHY. The
 * resolver query is what makes that possible: it joins each org-scoped audit row
 * to the actor's name/email, the affected action's title, and the resolved
 * blocker owner, ordered newest-first with a stable tiebreaker.
 *
 * This drives resolveFindingContext over real Postgres and proves the enrichment,
 * the ordering, that a malformed blocker-owner payload cannot error the query, and
 * that every join stays inside the caller's org (tenant isolation).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { resolveFindingContext, type Queryable } from "../../src/api/lib/findingContextResolver.js";

let seed: TestDbSeed;
let pool: Pool;
let db: Queryable;

async function seedUser(orgId: string, email: string, name: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, email, name) VALUES ($1, $2, $3) RETURNING id`,
    [orgId, email, name]
  );
  return r.rows[0]!.id;
}

async function seedFinding(orgId: string, title: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, status)
     VALUES ($1, $2, 'High', 'seed', 'manual', 'open')
     RETURNING id`,
    [orgId, title]
  );
  return r.rows[0]!.id;
}

async function seedAction(orgId: string, findingId: string, title: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO actions (organization_id, title, source_type, source_id, priority, status)
     VALUES ($1, $2, 'finding', $3, 'near_term', 'in_progress')
     RETURNING id`,
    [orgId, title, findingId]
  );
  return r.rows[0]!.id;
}

async function seedAudit(opts: {
  orgId: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  actorUserId?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO security_audit_log
       (organization_id, actor_user_id, event_type, resource_type, resource_id, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      opts.orgId,
      opts.actorUserId ?? null,
      opts.eventType,
      opts.resourceType,
      opts.resourceId,
      opts.payload != null ? JSON.stringify(opts.payload) : null,
      opts.createdAt,
    ]
  );
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the activity-timeline test.");
  pool = new Pool({ connectionString: url, ssl: false });
  db = pool as unknown as Queryable;
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

describe("finding Activity timeline — audit-grade enrichment via resolveFindingContext", () => {
  it("enriches each entry with actor, action identity, resolved blocker owner, and orders newest-first", async () => {
    const actorId = await seedUser(seed.orgA.id, "dana@a.test", "Dana Ops");
    const blockerOwnerId = await seedUser(seed.orgA.id, "priya@a.test", "Priya Netsec");
    const findingId = await seedFinding(seed.orgA.id, "Log4j exposure");
    const actionId = await seedAction(seed.orgA.id, findingId, "Patch Log4j on billing hosts");

    await seedAudit({
      orgId: seed.orgA.id,
      eventType: "finding.created",
      resourceType: "finding",
      resourceId: findingId,
      createdAt: "2026-06-10T08:00:00.000Z",
    });
    await seedAudit({
      orgId: seed.orgA.id,
      eventType: "action.status_changed",
      resourceType: "action",
      resourceId: actionId,
      actorUserId: actorId,
      payload: {
        status: "blocked",
        from: "in_progress",
        to: "blocked",
        title: "Patch Log4j on billing hosts",
        blocked_reason: "Waiting on vendor patch",
        blocked_dependency: "CR-1042",
        blocked_owner_user_id: blockerOwnerId,
        blocked_expected_unblock_date: "2026-08-01",
      },
      createdAt: "2026-06-12T09:00:00.000Z",
    });
    await seedAudit({
      orgId: seed.orgA.id,
      eventType: "action.unblocked",
      resourceType: "action",
      resourceId: actionId,
      actorUserId: actorId,
      payload: {
        from: "blocked",
        to: "in_progress",
        title: "Patch Log4j on billing hosts",
        blocked_reason: "Waiting on vendor patch",
        blocked_dependency: "CR-1042",
        blocked_owner_user_id: blockerOwnerId,
        blocked_expected_unblock_date: "2026-08-01",
      },
      createdAt: "2026-06-14T10:00:00.000Z",
    });

    const ctx = await resolveFindingContext(db, seed.orgA.id, findingId);
    expect(ctx).not.toBeNull();
    const activity = ctx!.activity as Array<Record<string, any>>;
    expect(activity.length).toBe(3);

    // Newest-first: the unblock (Jun 14) leads, the creation (Jun 10) trails.
    expect(activity[0]!.event_type).toBe("action.unblocked");
    expect(activity[activity.length - 1]!.event_type).toBe("finding.created");

    const unblock = activity.find((a) => a.event_type === "action.unblocked")!;
    // WHO + WHAT.
    expect(unblock.actor_name).toBe("Dana Ops");
    expect(unblock.actor_email).toBe("dana@a.test");
    expect(unblock.action_title).toBe("Patch Log4j on billing hosts");
    // The blocked state it resolved is preserved on the payload.
    expect(unblock.payload.from).toBe("blocked");
    expect(unblock.payload.blocked_reason).toBe("Waiting on vendor patch");

    const block = activity.find((a) => a.event_type === "action.status_changed")!;
    // Block metadata is on the payload (req 4), and the blocker owner UUID is
    // resolved to a human name (req: never a bare id in the audit trail).
    expect(block.payload.blocked_dependency).toBe("CR-1042");
    expect(block.blocked_owner_name).toBe("Priya Netsec");
  });

  it("a malformed blocker-owner payload does not error the query (guarded cast) and resolves to no name", async () => {
    const findingId = await seedFinding(seed.orgA.id, "malformed owner");
    const actionId = await seedAction(seed.orgA.id, findingId, "remediate");
    await seedAudit({
      orgId: seed.orgA.id,
      eventType: "action.status_changed",
      resourceType: "action",
      resourceId: actionId,
      payload: { status: "blocked", blocked_reason: "x", blocked_owner_user_id: "not-a-uuid" },
      createdAt: "2026-06-12T09:00:00.000Z",
    });

    const ctx = await resolveFindingContext(db, seed.orgA.id, findingId);
    expect(ctx).not.toBeNull();
    const block = (ctx!.activity as Array<Record<string, any>>).find(
      (a) => a.event_type === "action.status_changed"
    )!;
    expect(block.blocked_owner_name).toBeNull();
    // The blocker reason still surfaces — the row is not lost.
    expect(block.payload.blocked_reason).toBe("x");
  });

  it("stays inside the org: another org's finding is not resolvable, and a cross-org audit row cannot leak", async () => {
    const findingId = await seedFinding(seed.orgA.id, "isolation finding");
    const actionId = await seedAction(seed.orgA.id, findingId, "isolation action");
    await seedAudit({
      orgId: seed.orgA.id,
      eventType: "action.status_changed",
      resourceType: "action",
      resourceId: actionId,
      payload: { status: "closed", from: "in_progress", to: "closed" },
      createdAt: "2026-06-12T09:00:00.000Z",
    });

    // A crafted cross-tenant audit row: org B, but referencing org A's action id.
    // The resolver filters on organization_id = $1, so it must never appear.
    await seedAudit({
      orgId: seed.orgB.id,
      eventType: "action.status_changed",
      resourceType: "action",
      resourceId: actionId,
      payload: { status: "closed", leaked: true },
      createdAt: "2026-06-13T09:00:00.000Z",
    });

    const ctxA = await resolveFindingContext(db, seed.orgA.id, findingId);
    expect(ctxA).not.toBeNull();
    const activity = ctxA!.activity as Array<Record<string, any>>;
    expect(activity.length).toBe(1);
    expect((activity[0]!.payload as Record<string, unknown>).leaked).toBeUndefined();

    // Org B cannot resolve org A's finding at all.
    const ctxB = await resolveFindingContext(db, seed.orgB.id, findingId);
    expect(ctxB).toBeNull();
  });
});
