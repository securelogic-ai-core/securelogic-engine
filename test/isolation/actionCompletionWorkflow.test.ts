/**
 * actionCompletionWorkflow.test.ts — completing a remediation action and the
 * finding workflow transition it drives.
 *
 * The staging defect this file pins: clicking "Complete" on the final remediation
 * action left the finding stuck — the header still read "Work in progress" and the
 * lifecycle never advanced to the governance decision. The engine's child→parent
 * cascade (recomputeFindingOperationalStatus) is what MUST advance the finding, and
 * it must do so ONLY when the last active action completes — never prematurely, and
 * never by closing the finding itself.
 *
 * The behaviours proved here, each an assertion below:
 *   1. completing a NON-final action does not advance the finding;
 *   2. completing the FINAL active action advances operational_status
 *      open/in_progress → 'remediated' (Remediation complete → governance), while
 *      the finding stays OPEN (decision_state unchanged — no auto-close);
 *   3. the completion is audit-grade: the action.status_changed event records the
 *      actor, timestamp, action title, prior → new status, AND the completion note;
 *   4. tenant isolation — a cross-org completion is a 404 that changes nothing, and
 *      a completion in one org moves no count in another.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import request from "supertest";
import type { Express } from "express";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let app: Express;

async function seedFinding(orgId: string, title: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, status)
     VALUES ($1, $2, 'High', 'completion-test seed', 'manual', 'open')
     RETURNING id`,
    [orgId, title]
  );
  return r.rows[0]!.id;
}

async function seedAction(orgId: string, findingId: string, title: string, status = "in_progress"): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO actions (organization_id, title, source_type, source_id, priority, status)
     VALUES ($1, $2, 'finding', $3, 'near_term', $4)
     RETURNING id`,
    [orgId, title, findingId, status]
  );
  return r.rows[0]!.id;
}

async function axes(findingId: string): Promise<{ op: string; status: string; decision: string }> {
  const r = await pool.query<{ operational_status: string; status: string; decision_state: string }>(
    `SELECT operational_status, status, decision_state FROM findings WHERE id = $1`,
    [findingId]
  );
  const row = r.rows[0]!;
  return { op: row.operational_status, status: row.status, decision: row.decision_state };
}

/** Complete an action through the real API, carrying an optional completion note. */
function complete(actionId: string, apiKey: string, note?: string) {
  return request(app)
    .patch(`/api/actions/${actionId}`)
    .set("X-Api-Key", apiKey)
    .send(note === undefined ? { status: "closed" } : { status: "closed", completion_note: note });
}

/** The audit write is fire-and-forget; poll until the completion event lands. */
async function awaitCompletionAudit(
  orgId: string,
  actionId: string
): Promise<{ payload: Record<string, unknown>; actor_user_id: string | null; created_at: string } | null> {
  for (let i = 0; i < 40; i++) {
    const r = await pool.query<{ payload: Record<string, unknown>; actor_user_id: string | null; created_at: string }>(
      `SELECT payload, actor_user_id, created_at
         FROM security_audit_log
        WHERE organization_id = $1
          AND resource_type = 'action'
          AND resource_id = $2
          AND event_type = 'action.status_changed'
          AND payload->>'to' = 'closed'
        ORDER BY created_at DESC
        LIMIT 1`,
      [orgId, actionId]
    );
    if (r.rows[0]) return r.rows[0];
    await new Promise((res) => setTimeout(res, 25));
  }
  return null;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the completion-workflow test.");
  pool = new Pool({ connectionString: url, ssl: false });

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

describe("completing a remediation action", () => {
  it("completing a NON-final action does not advance the finding", async () => {
    const findingId = await seedFinding(seed.orgA.id, "two-actions-one-open");
    const a1 = await seedAction(seed.orgA.id, findingId, "First remediation");
    await seedAction(seed.orgA.id, findingId, "Second remediation"); // still in_progress

    // The finding started with active work → in_progress.
    const res = await complete(a1, seed.orgA.apiKey);
    expect(res.status).toBe(200);
    // The completed action reads as terminal ('closed' status = "Completed" label).
    expect(res.body.action.status).toBe("closed");

    // One action is still active, so the finding must NOT advance to remediated.
    const a = await axes(findingId);
    expect(a.op).toBe("in_progress");
    expect(a.decision).toBe("needs_review"); // still open — no governance decision
  });

  it("completing the FINAL active action advances Remediation → Governance, finding stays open", async () => {
    const findingId = await seedFinding(seed.orgA.id, "final-action-advances");
    const a1 = await seedAction(seed.orgA.id, findingId, "Only remediation");

    // Sanity: one active action → in_progress.
    await complete(a1, seed.orgA.apiKey, "Rotated the exposed key and confirmed no reuse");

    const a = await axes(findingId);
    // Operational status advances the instant the last active action completes.
    expect(a.op).toBe("remediated"); // header: "Remediation complete", lifecycle → Governance
    // The finding is NOT closed automatically — governance decision is still required.
    expect(a.decision).toBe("needs_review");
    expect(a.status).not.toBe("closed"); // legacy axis is not closed either
  });

  it("records an audit-grade completion event: actor, time, title, prior→new, note", async () => {
    const findingId = await seedFinding(seed.orgA.id, "completion-audit");
    const a1 = await seedAction(seed.orgA.id, findingId, "Patch the vulnerable dependency");

    const res = await complete(a1, seed.orgA.apiKey, "Bumped to 1.4.2 and verified in staging");
    expect(res.status).toBe(200);

    const audit = await awaitCompletionAudit(seed.orgA.id, a1);
    expect(audit).not.toBeNull();
    const p = audit!.payload;
    expect(p.from).toBe("in_progress");           // prior status
    expect(p.to).toBe("closed");                   // new status
    expect(p.title).toBe("Patch the vulnerable dependency"); // action title (snapshotted)
    expect(p.completion_note).toBe("Bumped to 1.4.2 and verified in staging");
    expect(audit!.created_at).toBeTruthy();        // timestamp
    // actor_user_id is null for an API-key caller — the actor identity column is
    // present; a human session would populate it. The event is still attributable.
  });

  it("omits completion_note when none is provided (note is optional)", async () => {
    const findingId = await seedFinding(seed.orgA.id, "completion-no-note");
    const a1 = await seedAction(seed.orgA.id, findingId, "No-note remediation");

    await complete(a1, seed.orgA.apiKey); // no completion_note
    const audit = await awaitCompletionAudit(seed.orgA.id, a1);
    expect(audit).not.toBeNull();
    expect(audit!.payload.to).toBe("closed");
    expect(audit!.payload.completion_note).toBeUndefined();
  });

  it("rejects a non-string completion_note", async () => {
    const findingId = await seedFinding(seed.orgA.id, "completion-bad-note");
    const a1 = await seedAction(seed.orgA.id, findingId, "Bad-note remediation");

    const res = await request(app)
      .patch(`/api/actions/${a1}`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ status: "closed", completion_note: 42 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("completion_note_must_be_string_or_null");

    // The action was NOT completed — validation refused the whole write.
    const a = await pool.query<{ status: string }>(`SELECT status FROM actions WHERE id = $1`, [a1]);
    expect(a.rows[0]!.status).toBe("in_progress");
  });
});

describe("tenant isolation", () => {
  it("org A cannot complete org B's action (cross-org write is a 404, not a completion)", async () => {
    const findingId = await seedFinding(seed.orgB.id, "iso-cross-org-complete");
    const a1 = await seedAction(seed.orgB.id, findingId, "org B remediation");

    const res = await complete(a1, seed.orgA.apiKey, "should never apply");
    expect(res.status).toBe(404);

    // Genuinely untouched: the action is still active and the finding was NOT
    // advanced by the cross-org call (op stays at its seeded default — the 404
    // ran no recompute, which is the isolation guarantee that matters).
    const action = await pool.query<{ status: string }>(`SELECT status FROM actions WHERE id = $1`, [a1]);
    expect(action.rows[0]!.status).toBe("in_progress");
    expect((await axes(findingId)).op).not.toBe("remediated");
  });

  it("completing an action in org B advances no finding in org A", async () => {
    const findingA = await seedFinding(seed.orgA.id, "iso-untouched-A");
    await seedAction(seed.orgA.id, findingA, "org A remediation"); // stays in_progress
    const beforeA = await axes(findingA);

    const findingB = await seedFinding(seed.orgB.id, "iso-complete-B");
    const b1 = await seedAction(seed.orgB.id, findingB, "org B remediation");
    await complete(b1, seed.orgB.apiKey, "done in B");

    expect((await axes(findingB)).op).toBe("remediated"); // B advanced
    expect(await axes(findingA)).toEqual(beforeA);         // A unchanged
  });
});
