/**
 * tenantDataGovernance.test.ts — the E-1 invariants that need real Postgres.
 *
 * The unit lane (src/api/__tests__/tenantDataGovernance.test.ts) proves the
 * decisions. This lane proves the things only a database can:
 *
 *   TDG-13  cross-org isolation, through every TDG surface
 *   TDG-8   retention_policies is append-only in the DB, not just in the store
 *   TDG-7   the SoD CHECK and the release-only trigger bite at the DB level
 *   TDG-5   the ledger survives content deletion, and a LIVE message's ledger
 *           rows are unreachable by the sweeper
 *   TDG-9   determinism, idempotency and the activation gate
 *   TDG-6   a hold suppresses expiry AND owner deletion
 *   TDG-12  deletion and its audit event are one transaction
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { planSweep, executeSweep, deleteGovernedObject } from "../../src/api/lib/governance/retentionService.js";
import { insertHold, releaseHold, listActiveHolds, insertPolicyVersion, listPolicyVersions } from "../../src/api/lib/governance/governanceStore.js";
import { resolveEffectivePolicy } from "../../src/api/lib/governance/retentionPolicy.js";
import { getDataClass } from "../../src/api/lib/governance/dataClasses.js";
import { processReapJob } from "../../src/api/workers/accountDeletionReaper.js";

let seed: TestDbSeed;
let pool: Pool;
let userA1: string;
let userA2: string;
let userB1: string;

const ASK = () => getDataClass("ask_conversation")!;

/** An org-scoped Ask thread with one turn and one ledger row, aged as asked. */
async function seedConversation(
  orgId: string,
  userId: string,
  ageDays: number
): Promise<{ conversationId: string; messageId: string; invocationId: string }> {
  const at = new Date(Date.now() - ageDays * 86_400_000);
  const { rows: conv } = await pool.query<{ id: string }>(
    `INSERT INTO ask_conversations (organization_id, user_id, mode, created_at, last_message_at)
     VALUES ($1, $2, 'text', $3, $3) RETURNING id`,
    [orgId, userId, at]
  );
  const conversationId = conv[0]!.id;

  const { rows: msg } = await pool.query<{ id: string }>(
    `INSERT INTO ask_messages (organization_id, conversation_id, user_id, role, content, model_id, created_at)
     VALUES ($1, $2, $3, 'assistant', 'answer text', 'claude-test', $4) RETURNING id`,
    [orgId, conversationId, userId, at]
  );
  const messageId = msg[0]!.id;

  const { rows: inv } = await pool.query<{ id: string }>(
    `INSERT INTO ask_tool_invocations
       (organization_id, message_id, conversation_id, tool_name, action_class, input, authorized, created_at)
     VALUES ($1, $2, $3, 'findings.list', 'read', '{}'::jsonb, true, $4) RETURNING id`,
    [orgId, messageId, conversationId, at]
  );

  return { conversationId, messageId, invocationId: inv[0]!.id };
}

/**
 * security_audit_log is WORM — the test suite cannot truncate it between cases,
 * which is exactly the property under test elsewhere in this file. Events are
 * therefore counted from a per-test watermark taken on the DATABASE clock (not
 * the node clock, which can differ from the container's).
 */
let since: Date;

async function auditEvents(orgId: string, eventType: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM security_audit_log
      WHERE organization_id = $1 AND event_type = $2 AND created_at >= $3`,
    [orgId, eventType, since]
  );
  return Number(rows[0]!.count);
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  pool = new Pool({ connectionString: url, ssl: false });
  userA1 = (await seedUser(pool, seed.orgA.id)).id;
  userA2 = (await seedUser(pool, seed.orgA.id)).id;
  userB1 = (await seedUser(pool, seed.orgB.id)).id;
}, 120_000);

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  // Each test starts from a clean governance + Ask state so determinism claims
  // are about the code, not about leftovers.
  await pool.query("DELETE FROM ask_tool_invocations");
  await pool.query("DELETE FROM ask_conversations");
  // E-2 Increment 1 split the legal_holds guard: the UPDATE state machine stays
  // in guard_legal_holds_row_mutation, and DELETE is now refused by the shared
  // worm_guard_mutation via prevent_legal_holds_delete. The teardown has to
  // disable the DELETE one — which is the point of the split, since that is the
  // trigger E-2 Increment 2 will teach about certified erasure.
  await pool.query("ALTER TABLE legal_holds DISABLE TRIGGER prevent_legal_holds_delete");
  await pool.query("DELETE FROM legal_holds");
  await pool.query("ALTER TABLE legal_holds ENABLE TRIGGER prevent_legal_holds_delete");
  await pool.query("ALTER TABLE retention_policies DISABLE TRIGGER prevent_retention_policies_row_mutation");
  await pool.query("DELETE FROM retention_policies");
  await pool.query("ALTER TABLE retention_policies ENABLE TRIGGER prevent_retention_policies_row_mutation");
  const { rows } = await pool.query<{ now: Date }>("SELECT now() AS now");
  since = rows[0]!.now;
});

/* ──────────────────────────────── TDG-13 ─────────────────────────────────── */

describe("TDG-13: cross-org isolation through every TDG surface", () => {
  it("a plan for org A never contains org B's objects", async () => {
    await seedConversation(seed.orgA.id, userA1, 500);
    const bThread = await seedConversation(seed.orgB.id, userB1, 500);

    const plan = await withTenant(seed.orgA.id, () =>
      planSweep({ organizationId: seed.orgA.id, dataClassKey: "ask_conversation" })
    );

    expect(plan!.eligible.map((o) => o.id)).not.toContain(bThread.conversationId);
    expect(plan!.eligible).toHaveLength(1);
  });

  it("org A cannot delete org B's conversation even naming its id exactly", async () => {
    const bThread = await seedConversation(seed.orgB.id, userB1, 10);

    const outcome = await withTenant(seed.orgA.id, () =>
      deleteGovernedObject({
        organizationId: seed.orgA.id,
        dataClassKey: "ask_conversation",
        objectId: bThread.conversationId,
        actorUserId: userA1,
        requireOwnerUserId: null,
        trigger: "administrator"
      })
    );

    expect(outcome.outcome).toBe("not_found");
    const { rows } = await pool.query(`SELECT id FROM ask_conversations WHERE id = $1`, [
      bThread.conversationId
    ]);
    expect(rows).toHaveLength(1);
  });

  it("org B's hold does not protect — and org A's hold does not reach — the other tenant", async () => {
    await withTenant(seed.orgB.id, () =>
      insertHold({
        organizationId: seed.orgB.id,
        scopeType: "organization",
        dataClass: null,
        subjectUserId: null,
        objectId: null,
        reason: "B matter",
        placedByUserId: userB1
      })
    );

    const aHolds = await withTenant(seed.orgA.id, () => listActiveHolds(seed.orgA.id));
    expect(aHolds).toHaveLength(0);
  });

  it("a policy set by org A does not change org B's effective policy", async () => {
    await withTenant(seed.orgA.id, () =>
      insertPolicyVersion({
        organizationId: seed.orgA.id,
        dataClass: "ask_conversation",
        retentionDays: 30,
        cleared: false,
        source: "tenant",
        setByUserId: userA1,
        reason: "test"
      })
    );

    const bVersions = await withTenant(seed.orgB.id, () =>
      listPolicyVersions(seed.orgB.id, "ask_conversation")
    );
    expect(bVersions).toHaveLength(0);
    expect(resolveEffectivePolicy(ASK(), bVersions).retentionDays).toBe(365);
  });
});

/* ───────────────────────────── TDG-8 / TDG-7 ─────────────────────────────── */

describe("TDG-8: retention_policies is append-only in the database", () => {
  it("refuses UPDATE and DELETE, so history cannot be rewritten", async () => {
    const inserted = await withTenant(seed.orgA.id, () =>
      insertPolicyVersion({
        organizationId: seed.orgA.id,
        dataClass: "ask_conversation",
        retentionDays: 90,
        cleared: false,
        source: "tenant",
        setByUserId: userA1,
        reason: null
      })
    );

    await expect(
      pool.query(`UPDATE retention_policies SET retention_days = 1 WHERE id = $1`, [inserted.id])
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query(`DELETE FROM retention_policies WHERE id = $1`, [inserted.id])
    ).rejects.toThrow(/append-only/);
  });

  it("versions increment per (org, class) without collision", async () => {
    for (const days of [90, 120, 200]) {
      await withTenant(seed.orgA.id, () =>
        insertPolicyVersion({
          organizationId: seed.orgA.id,
          dataClass: "ask_conversation",
          retentionDays: days,
          cleared: false,
          source: "tenant",
          setByUserId: userA1,
          reason: null
        })
      );
    }
    const versions = await withTenant(seed.orgA.id, () =>
      listPolicyVersions(seed.orgA.id, "ask_conversation")
    );
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(resolveEffectivePolicy(ASK(), versions).retentionDays).toBe(200);
  });
});

describe("TDG-7: the database enforces release-only mutation and separation of duties", () => {
  async function placeHold(): Promise<string> {
    const hold = await withTenant(seed.orgA.id, () =>
      insertHold({
        organizationId: seed.orgA.id,
        scopeType: "organization",
        dataClass: null,
        subjectUserId: null,
        objectId: null,
        reason: "Matter 2026-14",
        placedByUserId: userA1
      })
    );
    return hold.id;
  }

  it("a hold cannot be deleted", async () => {
    const id = await placeHold();
    await expect(pool.query(`DELETE FROM legal_holds WHERE id = $1`, [id])).rejects.toThrow(
      /append-plus-release/
    );
  });

  it("a release may not alter the hold it releases", async () => {
    const id = await placeHold();
    await expect(
      pool.query(
        `UPDATE legal_holds
            SET status = 'released', released_at = now(), release_reason = 'x', reason = 'rewritten'
          WHERE id = $1`,
        [id]
      )
    ).rejects.toThrow(/may not alter the hold/);
  });

  it("a non-release UPDATE is refused outright", async () => {
    const id = await placeHold();
    await expect(
      pool.query(`UPDATE legal_holds SET reason = 'quietly different' WHERE id = $1`, [id])
    ).rejects.toThrow(/only the active -> released transition/);
  });

  it("the CHECK refuses a self-release even when the route is bypassed", async () => {
    const id = await placeHold();
    await expect(
      pool.query(
        `UPDATE legal_holds
            SET status = 'released', released_by_user_id = $2, released_at = now(), release_reason = 'mine'
          WHERE id = $1`,
        [id, userA1]
      )
    ).rejects.toThrow(/legal_holds_sod/);
  });

  it("a different admin releases cleanly, once", async () => {
    const id = await placeHold();
    const released = await withTenant(seed.orgA.id, () =>
      releaseHold({
        organizationId: seed.orgA.id,
        holdId: id,
        releasedByUserId: userA2,
        releaseReason: "Matter closed"
      })
    );
    expect(released?.status).toBe("released");

    const second = await withTenant(seed.orgA.id, () =>
      releaseHold({
        organizationId: seed.orgA.id,
        holdId: id,
        releasedByUserId: userA2,
        releaseReason: "again"
      })
    );
    expect(second).toBeNull();
  });
});

/* ──────────────────────────────── TDG-5 ──────────────────────────────────── */

describe("TDG-5: the ledger outlives its content, and a live turn's ledger is unreachable", () => {
  it("deleting a message orphans its invocation instead of cascading it away", async () => {
    const t = await seedConversation(seed.orgA.id, userA1, 1);

    await pool.query(`DELETE FROM ask_messages WHERE id = $1`, [t.messageId]);

    const { rows } = await pool.query<{ id: string; message_id: string | null; conversation_id: string | null }>(
      `SELECT id, message_id, conversation_id FROM ask_tool_invocations WHERE id = $1`,
      [t.invocationId]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.message_id).toBeNull();
    expect(rows[0]!.conversation_id).toBe(t.conversationId);
  });

  it("an aged ledger row attached to a LIVE message is never eligible", async () => {
    await seedConversation(seed.orgA.id, userA1, 5_000);

    const plan = await withTenant(seed.orgA.id, () =>
      planSweep({ organizationId: seed.orgA.id, dataClassKey: "ask_tool_invocation" })
    );
    expect(plan!.eligible).toHaveLength(0);
  });

  it("the same row becomes eligible once its content is gone", async () => {
    const t = await seedConversation(seed.orgA.id, userA1, 5_000);
    await pool.query(`DELETE FROM ask_messages WHERE id = $1`, [t.messageId]);

    const plan = await withTenant(seed.orgA.id, () =>
      planSweep({ organizationId: seed.orgA.id, dataClassKey: "ask_tool_invocation" })
    );
    expect(plan!.eligible.map((o) => o.id)).toEqual([t.invocationId]);
  });
});

/* ──────────────────────── TDG-9 / TDG-6 / TDG-12 ─────────────────────────── */

describe("TDG-9: planning is deterministic and the activation gate is real", () => {
  it("two plans over the same state are identical", async () => {
    await seedConversation(seed.orgA.id, userA1, 400);
    await seedConversation(seed.orgA.id, userA1, 500);
    const now = new Date();

    const first = await withTenant(seed.orgA.id, () =>
      planSweep({ organizationId: seed.orgA.id, dataClassKey: "ask_conversation", now })
    );
    const second = await withTenant(seed.orgA.id, () =>
      planSweep({ organizationId: seed.orgA.id, dataClassKey: "ask_conversation", now })
    );

    expect(second!.deletable).toEqual(first!.deletable);
    expect(second!.cutoff.toISOString()).toBe(first!.cutoff.toISOString());
  });

  it("a fresh conversation is not eligible under the 365-day default", async () => {
    await seedConversation(seed.orgA.id, userA1, 10);
    const plan = await withTenant(seed.orgA.id, () =>
      planSweep({ organizationId: seed.orgA.id, dataClassKey: "ask_conversation" })
    );
    expect(plan!.eligible).toHaveLength(0);
  });

  it("with the gates closed, execution deletes NOTHING and says so", async () => {
    const t = await seedConversation(seed.orgA.id, userA1, 500);

    const result = await withTenant(seed.orgA.id, async () => {
      const plan = await planSweep({ organizationId: seed.orgA.id, dataClassKey: "ask_conversation" });
      return executeSweep({ organizationId: seed.orgA.id, plan: plan!, actorUserId: null, dryRun: false });
    });

    expect(result.executed).toBe(false);
    expect(result.reason).toBe("blocked");
    expect(result.plan.blockers.length).toBeGreaterThan(0);
    const { rows } = await pool.query(`SELECT id FROM ask_conversations WHERE id = $1`, [t.conversationId]);
    expect(rows).toHaveLength(1);
  });

  it("a dry run never writes, even with the gates open", async () => {
    await seedConversation(seed.orgA.id, userA1, 500);
    const before = await auditEvents(seed.orgA.id, "governance.retention_expiry_executed");

    const result = await withTenant(seed.orgA.id, async () => {
      const plan = await planSweep({
        organizationId: seed.orgA.id,
        dataClassKey: "ask_conversation",
        env: {
          SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED: "true",
          SECURELOGIC_TDG_EFFECTIVE_FROM: "2020-01-01T00:00:00Z"
        } as NodeJS.ProcessEnv
      });
      return executeSweep({ organizationId: seed.orgA.id, plan: plan!, actorUserId: null, dryRun: true });
    });

    expect(result.executed).toBe(false);
    expect(result.reason).toBe("dry_run");
    expect(await auditEvents(seed.orgA.id, "governance.retention_expiry_executed")).toBe(before);
    const { rows } = await pool.query(`SELECT COUNT(*)::text AS c FROM ask_conversations`);
    expect(Number((rows[0] as { c: string }).c)).toBe(1);
  });

  it("with the gates open it deletes, writes ONE run event, and is idempotent", async () => {
    const t = await seedConversation(seed.orgA.id, userA1, 500);
    const env = {
      SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED: "true",
      SECURELOGIC_TDG_EFFECTIVE_FROM: "2020-01-01T00:00:00Z"
    } as NodeJS.ProcessEnv;

    const run = async () =>
      withTenant(seed.orgA.id, async () => {
        const plan = await planSweep({
          organizationId: seed.orgA.id,
          dataClassKey: "ask_conversation",
          env
        });
        return executeSweep({ organizationId: seed.orgA.id, plan: plan!, actorUserId: null, dryRun: false });
      });

    const first = await run();
    expect(first.executed).toBe(true);
    expect(first.counts.objects).toBe(1);
    expect(first.counts.children["ask_messages"]).toBe(1);

    const second = await run();
    expect(second.executed).toBe(false);
    expect(second.counts.objects).toBe(0);

    expect(await auditEvents(seed.orgA.id, "governance.retention_expiry_executed")).toBe(1);

    // The ledger row survived its content and is now orphaned, as TDG-5 requires.
    const { rows } = await pool.query<{ message_id: string | null }>(
      `SELECT message_id FROM ask_tool_invocations WHERE id = $1`,
      [t.invocationId]
    );
    expect(rows[0]!.message_id).toBeNull();
  });
});

describe("TDG-6: a hold outranks both the sweeper and the owner", () => {
  const env = {
    SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED: "true",
    SECURELOGIC_TDG_EFFECTIVE_FROM: "2020-01-01T00:00:00Z"
  } as NodeJS.ProcessEnv;

  it("suppresses expiry and records the suppression", async () => {
    const t = await seedConversation(seed.orgA.id, userA1, 500);
    await withTenant(seed.orgA.id, () =>
      insertHold({
        organizationId: seed.orgA.id,
        scopeType: "object",
        dataClass: "ask_conversation",
        subjectUserId: null,
        objectId: t.conversationId,
        reason: "Matter 2026-14",
        placedByUserId: userA1
      })
    );

    const result = await withTenant(seed.orgA.id, async () => {
      const plan = await planSweep({ organizationId: seed.orgA.id, dataClassKey: "ask_conversation", env });
      return executeSweep({ organizationId: seed.orgA.id, plan: plan!, actorUserId: null, dryRun: false });
    });

    expect(result.plan.suppressed).toHaveLength(1);
    expect(result.counts.objects).toBe(0);
    expect(await auditEvents(seed.orgA.id, "governance.retention_sweep_suppressed")).toBe(1);
    const { rows } = await pool.query(`SELECT id FROM ask_conversations WHERE id = $1`, [t.conversationId]);
    expect(rows).toHaveLength(1);
  });

  it("refuses the OWNER's own deletion rather than silently keeping the data", async () => {
    const t = await seedConversation(seed.orgA.id, userA1, 1);
    await withTenant(seed.orgA.id, () =>
      insertHold({
        organizationId: seed.orgA.id,
        scopeType: "subject_user",
        dataClass: null,
        subjectUserId: userA1,
        objectId: null,
        reason: "Matter 2026-14",
        placedByUserId: userA2
      })
    );

    const outcome = await withTenant(seed.orgA.id, () =>
      deleteGovernedObject({
        organizationId: seed.orgA.id,
        dataClassKey: "ask_conversation",
        objectId: t.conversationId,
        actorUserId: userA1,
        requireOwnerUserId: userA1,
        trigger: "owner_request"
      })
    );

    expect(outcome.outcome).toBe("held");
    const { rows } = await pool.query(`SELECT id FROM ask_conversations WHERE id = $1`, [t.conversationId]);
    expect(rows).toHaveLength(1);
  });

  it("a released hold stops suppressing", async () => {
    const t = await seedConversation(seed.orgA.id, userA1, 1);
    const hold = await withTenant(seed.orgA.id, () =>
      insertHold({
        organizationId: seed.orgA.id,
        scopeType: "organization",
        dataClass: null,
        subjectUserId: null,
        objectId: null,
        reason: "Matter",
        placedByUserId: userA1
      })
    );
    await withTenant(seed.orgA.id, () =>
      releaseHold({
        organizationId: seed.orgA.id,
        holdId: hold.id,
        releasedByUserId: userA2,
        releaseReason: "closed"
      })
    );

    const outcome = await withTenant(seed.orgA.id, () =>
      deleteGovernedObject({
        organizationId: seed.orgA.id,
        dataClassKey: "ask_conversation",
        objectId: t.conversationId,
        actorUserId: userA1,
        requireOwnerUserId: userA1,
        trigger: "owner_request"
      })
    );
    expect(outcome.outcome).toBe("deleted");
  });
});

describe("TDG-10 / TDG-12: owner deletion, and the record that cannot diverge from it", () => {
  it("an owner deletes their own thread, and exactly one event records it", async () => {
    const t = await seedConversation(seed.orgA.id, userA1, 1);

    const outcome = await withTenant(seed.orgA.id, () =>
      deleteGovernedObject({
        organizationId: seed.orgA.id,
        dataClassKey: "ask_conversation",
        objectId: t.conversationId,
        actorUserId: userA1,
        requireOwnerUserId: userA1,
        trigger: "owner_request"
      })
    );

    expect(outcome.outcome).toBe("deleted");
    expect(await auditEvents(seed.orgA.id, "governance.object_deleted")).toBe(1);

    const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM security_audit_log
        WHERE organization_id = $1 AND event_type = 'governance.object_deleted'
          AND created_at >= $2`,
      [seed.orgA.id, since]
    );
    const payload = rows[0]!.payload;
    expect(payload["trigger"]).toBe("owner_request");
    expect(payload["objectId"]).toBe(t.conversationId);
    // TDG-14 at runtime: the event says what was destroyed, never what it said.
    expect(Object.keys(payload)).not.toContain("content");
    expect(Object.keys(payload)).not.toContain("title");
  });

  it("a colleague cannot delete a thread they do not own, and cannot tell it apart from absent", async () => {
    const t = await seedConversation(seed.orgA.id, userA1, 1);

    const outcome = await withTenant(seed.orgA.id, () =>
      deleteGovernedObject({
        organizationId: seed.orgA.id,
        dataClassKey: "ask_conversation",
        objectId: t.conversationId,
        actorUserId: userA2,
        requireOwnerUserId: userA2,
        trigger: "owner_request"
      })
    );

    expect(outcome.outcome).toBe("not_owner");
    expect(await auditEvents(seed.orgA.id, "governance.object_deleted")).toBe(0);
  });

  it("an administrator deletes a thread they do not own — the action plane without the content plane", async () => {
    const t = await seedConversation(seed.orgA.id, userA1, 1);

    const outcome = await withTenant(seed.orgA.id, () =>
      deleteGovernedObject({
        organizationId: seed.orgA.id,
        dataClassKey: "ask_conversation",
        objectId: t.conversationId,
        actorUserId: userA2,
        requireOwnerUserId: null,
        trigger: "administrator"
      })
    );

    expect(outcome.outcome).toBe("deleted");
    const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM security_audit_log
        WHERE organization_id = $1 AND event_type = 'governance.object_deleted'
          AND created_at >= $2`,
      [seed.orgA.id, since]
    );
    expect(rows[0]!.payload["trigger"]).toBe("administrator");
  });

  it("a rolled-back transaction leaves neither the deletion nor its event", async () => {
    const t = await seedConversation(seed.orgA.id, userA1, 1);

    await expect(
      withTenant(seed.orgA.id, async () => {
        await deleteGovernedObject({
          organizationId: seed.orgA.id,
          dataClassKey: "ask_conversation",
          objectId: t.conversationId,
          actorUserId: userA1,
          requireOwnerUserId: userA1,
          trigger: "owner_request"
        });
        throw new Error("simulated failure after the delete");
      })
    ).rejects.toThrow(/simulated failure/);

    const { rows } = await pool.query(`SELECT id FROM ask_conversations WHERE id = $1`, [t.conversationId]);
    expect(rows).toHaveLength(1);
    expect(await auditEvents(seed.orgA.id, "governance.object_deleted")).toBe(0);
  });
});

/* ─────────── The operator ruling of 2026-08-16, against real Postgres ─────── */

describe("RULING: a conversation outlives its author", () => {
  it("a hard-deleted user leaves the thread, its turns and its ledger standing", async () => {
    // A user who exists only to be deleted here — the reaper tombstones rather
    // than deletes, so this is the path the schema must survive, not the one it
    // takes today.
    const doomed = (await seedUser(pool, seed.orgA.id)).id;
    const t = await seedConversation(seed.orgA.id, doomed, 5);

    await pool.query(`DELETE FROM users WHERE id = $1`, [doomed]);

    const conv = await pool.query<{ id: string; user_id: string | null }>(
      `SELECT id, user_id FROM ask_conversations WHERE id = $1`,
      [t.conversationId]
    );
    expect(conv.rows).toHaveLength(1);
    expect(conv.rows[0]!.user_id).toBeNull();

    const msgs = await pool.query<{ id: string; user_id: string | null }>(
      `SELECT id, user_id FROM ask_messages WHERE conversation_id = $1`,
      [t.conversationId]
    );
    expect(msgs.rows).toHaveLength(1);
    expect(msgs.rows[0]!.user_id).toBeNull();

    const ledger = await pool.query(
      `SELECT id FROM ask_tool_invocations WHERE id = $1 AND message_id IS NOT NULL`,
      [t.invocationId]
    );
    expect(ledger.rows).toHaveLength(1);
  });

  it("the orphaned thread is still a GOVERNED record, not an unreachable one", async () => {
    const doomed = (await seedUser(pool, seed.orgA.id)).id;
    const t = await seedConversation(seed.orgA.id, doomed, 500);
    await pool.query(`DELETE FROM users WHERE id = $1`, [doomed]);

    const plan = await withTenant(seed.orgA.id, () =>
      planSweep({ organizationId: seed.orgA.id, dataClassKey: "ask_conversation" })
    );
    expect(plan!.eligible.map((o) => o.id)).toContain(t.conversationId);
    expect(plan!.eligible.find((o) => o.id === t.conversationId)!.ownerUserId).toBeNull();
  });

  it("an owner-less thread has no owner-deletion path, but an administrator can remove it", async () => {
    const doomed = (await seedUser(pool, seed.orgA.id)).id;
    const t = await seedConversation(seed.orgA.id, doomed, 5);
    await pool.query(`DELETE FROM users WHERE id = $1`, [doomed]);

    const asOwner = await withTenant(seed.orgA.id, () =>
      deleteGovernedObject({
        organizationId: seed.orgA.id,
        dataClassKey: "ask_conversation",
        objectId: t.conversationId,
        actorUserId: userA1,
        requireOwnerUserId: userA1,
        trigger: "owner_request"
      })
    );
    expect(asOwner.outcome).toBe("not_owner");

    const asAdmin = await withTenant(seed.orgA.id, () =>
      deleteGovernedObject({
        organizationId: seed.orgA.id,
        dataClassKey: "ask_conversation",
        objectId: t.conversationId,
        actorUserId: userA2,
        requireOwnerUserId: null,
        trigger: "administrator"
      })
    );
    expect(asAdmin.outcome).toBe("deleted");
  });

  it("an ORGANIZATION-scoped hold still protects an orphaned thread", async () => {
    // The documented consequence of SET NULL: a SUBJECT hold cannot cover a
    // thread whose subject is gone. An organization or object hold can, and
    // this is the mitigation the migration comment points at.
    const doomed = (await seedUser(pool, seed.orgA.id)).id;
    const t = await seedConversation(seed.orgA.id, doomed, 500);
    await pool.query(`DELETE FROM users WHERE id = $1`, [doomed]);

    await withTenant(seed.orgA.id, () =>
      insertHold({
        organizationId: seed.orgA.id,
        scopeType: "organization",
        dataClass: null,
        subjectUserId: null,
        objectId: null,
        reason: "Matter covering a departed employee",
        placedByUserId: userA1
      })
    );

    const outcome = await withTenant(seed.orgA.id, () =>
      deleteGovernedObject({
        organizationId: seed.orgA.id,
        dataClassKey: "ask_conversation",
        objectId: t.conversationId,
        actorUserId: userA2,
        requireOwnerUserId: null,
        trigger: "administrator"
      })
    );
    expect(outcome.outcome).toBe("held");
  });
});

/* ────── A legal hold stands in front of EVERY deletion path, including the
          Art.17 account-deletion reaper (real reaper, real database) ────────── */

describe("legal hold vs the Art.17 account-deletion reaper", () => {
  async function pendingDeletionUser(): Promise<string> {
    const id = (await seedUser(pool, seed.orgA.id)).id;
    await pool.query(
      `UPDATE users SET status = 'pending_deletion', deletion_scheduled_at = now() - interval '1 day'
        WHERE id = $1`,
      [id]
    );
    return id;
  }

  function reapJob(userId: string) {
    return {
      id: "00000000-0000-4000-8000-00000000dead",
      organization_id: seed.orgA.id,
      requested_by_user_id: userId,
      job_type: "account_deletion_reap",
      status: "processing",
      attempts: 1,
      max_attempts: 5,
      payload: { userId, organizationId: seed.orgA.id }
    } as never;
  }

  it("a subject hold suppresses the erasure, leaves the request pending, and records why", async () => {
    const subject = await pendingDeletionUser();
    const emailBefore = (
      await pool.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [subject])
    ).rows[0]!.email;

    await withTenant(seed.orgA.id, () =>
      insertHold({
        organizationId: seed.orgA.id,
        scopeType: "subject_user",
        dataClass: null,
        subjectUserId: subject,
        objectId: null,
        reason: "Matter 2026-14 names this custodian",
        placedByUserId: userA1
      })
    );

    await processReapJob(reapJob(subject));

    const after = await pool.query<{ email: string; status: string }>(
      `SELECT email, status FROM users WHERE id = $1`,
      [subject]
    );
    // Not tombstoned: the identity survives for the matter.
    expect(after.rows[0]!.email).toBe(emailBefore);
    // And the request is neither lost nor completed — it waits for the hold.
    expect(after.rows[0]!.status).toBe("pending_deletion");
    expect(await auditEvents(seed.orgA.id, "governance.erasure_suppressed")).toBe(1);
  });

  it("an ORGANIZATION hold suppresses it too", async () => {
    const subject = await pendingDeletionUser();
    await withTenant(seed.orgA.id, () =>
      insertHold({
        organizationId: seed.orgA.id,
        scopeType: "organization",
        dataClass: null,
        subjectUserId: null,
        objectId: null,
        reason: "Org-wide preservation notice",
        placedByUserId: userA1
      })
    );

    await processReapJob(reapJob(subject));

    const after = await pool.query<{ status: string }>(`SELECT status FROM users WHERE id = $1`, [subject]);
    expect(after.rows[0]!.status).toBe("pending_deletion");
  });

  it("a hold on a CONVERSATION does not block the person's erasure", async () => {
    // The scopes are not interchangeable: preserving a thing must not quietly
    // suspend someone's right to be forgotten.
    const subject = await pendingDeletionUser();
    const t = await seedConversation(seed.orgA.id, subject, 1);
    await withTenant(seed.orgA.id, () =>
      insertHold({
        organizationId: seed.orgA.id,
        scopeType: "object",
        dataClass: "ask_conversation",
        subjectUserId: null,
        objectId: t.conversationId,
        reason: "One thread is evidence",
        placedByUserId: userA1
      })
    );

    await processReapJob(reapJob(subject));

    const after = await pool.query<{ email: string; status: string }>(
      `SELECT email, status FROM users WHERE id = $1`,
      [subject]
    );
    expect(after.rows[0]!.email).toMatch(/^deleted-.*@deleted\.invalid$/);
    expect(after.rows[0]!.status).toBe("deleted");
  });

  it("once the hold is released the erasure proceeds — and the conversations still survive it", async () => {
    const subject = await pendingDeletionUser();
    const t = await seedConversation(seed.orgA.id, subject, 1);

    const hold = await withTenant(seed.orgA.id, () =>
      insertHold({
        organizationId: seed.orgA.id,
        scopeType: "subject_user",
        dataClass: null,
        subjectUserId: subject,
        objectId: null,
        reason: "Matter 2026-14",
        placedByUserId: userA1
      })
    );

    await processReapJob(reapJob(subject));
    expect(
      (await pool.query<{ status: string }>(`SELECT status FROM users WHERE id = $1`, [subject]))
        .rows[0]!.status
    ).toBe("pending_deletion");

    await withTenant(seed.orgA.id, () =>
      releaseHold({
        organizationId: seed.orgA.id,
        holdId: hold.id,
        releasedByUserId: userA2,
        releaseReason: "Matter closed"
      })
    );

    await processReapJob(reapJob(subject));

    const user = await pool.query<{ email: string; status: string }>(
      `SELECT email, status FROM users WHERE id = $1`,
      [subject]
    );
    expect(user.rows[0]!.email).toMatch(/^deleted-.*@deleted\.invalid$/);
    expect(user.rows[0]!.status).toBe("deleted");

    // THE RULING, end to end: the person is erased, the organization's record
    // is not, and it is still attributable to a thread rather than to nothing.
    const conv = await pool.query<{ id: string; user_id: string | null }>(
      `SELECT id, user_id FROM ask_conversations WHERE id = $1`,
      [t.conversationId]
    );
    expect(conv.rows).toHaveLength(1);
    expect(conv.rows[0]!.user_id).toBe(subject);

    const msgs = await pool.query(`SELECT id FROM ask_messages WHERE conversation_id = $1`, [
      t.conversationId
    ]);
    expect(msgs.rows).toHaveLength(1);
  });
});
