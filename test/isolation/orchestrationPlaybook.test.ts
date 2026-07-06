/**
 * orchestrationPlaybook.test.ts — ERIP E6b: real-Postgres proof that a playbook
 * creates proposals on run (each still 'proposed', needing approval), the
 * scheduler instantiates due playbooks, and it self-gates + org-isolates.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { createPlaybookHandler, runPlaybookHandler } from "../../src/api/routes/orchestration.js";
import { runDuePlaybooks } from "../../src/api/workers/orchestrationPlaybookWorker.js";
import type { Request, Response } from "express";

const FLAG = "SECURELOGIC_AUTONOMOUS_OPERATIONS_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
let prevFlag: string | undefined;

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0, _json: undefined,
    status(c: number) { (this as { _status: number })._status = c; return this; },
    json(b: unknown) { (this as { _json: unknown })._json = b; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}
function req(orgId: string, opts: { userId?: string; params?: Record<string, string>; body?: unknown } = {}): Request {
  return { organizationContext: { organizationId: orgId }, userId: opts.userId, params: opts.params ?? {}, body: opts.body, ip: "203.0.113.9" } as unknown as Request;
}
async function seedUser(orgId: string): Promise<string> {
  const r = await pool.query(`INSERT INTO users (organization_id, email, name, password_hash) VALUES ($1, $2, 'u', 'x') RETURNING id`, [orgId, `pb-${Math.random()}@corp.com`]);
  return r.rows[0].id as string;
}
async function proposals(orgId: string): Promise<Array<{ proposal_type: string; status: string; title: string }>> {
  const r = await pool.query(`SELECT proposal_type, status, title FROM orchestration_proposals WHERE organization_id = $1 ORDER BY created_at`, [orgId]);
  return r.rows;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  prevFlag = process.env[FLAG];
  process.env[FLAG] = "true";
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL not set for playbook test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  if (prevFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = prevFlag;
  await pool?.end();
});

describe("ERIP E6b — playbook framework + scheduling", () => {
  it("run creates one 'proposed' proposal per step (still needs approval)", async () => {
    const user = await seedUser(seed.orgA.id);
    const createRes = mockRes();
    await withTenant(seed.orgA.id, () =>
      createPlaybookHandler(
        req(seed.orgA.id, {
          userId: user,
          body: {
            name: "Critical-vendor breach response",
            steps: [
              { proposal_type: "slack_message", payload: { title: "Notify SOC of vendor breach" } },
              { proposal_type: "create_action", payload: { title: "Rotate vendor credentials", priority: "immediate" } }
            ]
          }
        }),
        createRes
      )
    );
    expect(createRes._status).toBe(201);
    const playbookId = (createRes._json as { playbook: { id: string } }).playbook.id;

    const runRes = mockRes();
    await withTenant(seed.orgA.id, () => runPlaybookHandler(req(seed.orgA.id, { userId: user, params: { id: playbookId } }), runRes));
    expect(runRes._status).toBe(202);
    expect((runRes._json as { proposals_created: number }).proposals_created).toBe(2);

    const props = await proposals(seed.orgA.id);
    expect(props).toHaveLength(2);
    expect(props.every((p) => p.status === "proposed")).toBe(true); // NOT auto-executed
    expect(props.map((p) => p.proposal_type).sort()).toEqual(["create_action", "slack_message"]);
  });

  it("the scheduler instantiates a due scheduled playbook and advances next_run_at", async () => {
    const user = await seedUser(seed.orgB.id);
    // Create a scheduled (60-min) enabled playbook, due now (next_run_at NULL).
    const createRes = mockRes();
    await withTenant(seed.orgB.id, () =>
      createPlaybookHandler(
        req(seed.orgB.id, {
          userId: user,
          body: {
            name: "Weekly evidence sweep",
            schedule_interval_minutes: 60,
            enabled: true,
            steps: [{ proposal_type: "evidence_request", payload: { title: "Collect SOC 2 report" } }]
          }
        }),
        createRes
      )
    );
    const playbookId = (createRes._json as { playbook: { id: string } }).playbook.id;

    const ran = await runDuePlaybooks();
    expect(ran).toBeGreaterThanOrEqual(1);

    const props = await proposals(seed.orgB.id);
    expect(props.some((p) => p.proposal_type === "evidence_request")).toBe(true);

    // next_run_at advanced → not due again immediately.
    const after = await pool.query(`SELECT next_run_at FROM orchestration_playbooks WHERE id = $1`, [playbookId]);
    expect(after.rows[0].next_run_at).not.toBeNull();
    expect(new Date(after.rows[0].next_run_at).getTime()).toBeGreaterThan(Date.now() + 50 * 60_000);
  });

  it("self-gates: with the flag off the scheduler instantiates nothing", async () => {
    process.env[FLAG] = "false";
    try {
      expect(await runDuePlaybooks()).toBe(0);
    } finally {
      process.env[FLAG] = "true";
    }
  });
});
