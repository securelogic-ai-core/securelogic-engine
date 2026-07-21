/**
 * orchestration.test.ts — ERIP Epic 6: real-Postgres proof of the
 * approval-gated orchestration flow. A proposal is inert until a DIFFERENT
 * human approves it (SoD); approval executes the create_action executor and
 * records the outcome; reject is terminal; org-isolated; RLS enforced.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import {
  createProposal,
  listProposals,
  approveProposal,
  rejectProposal
} from "../../src/api/routes/orchestration.js";
import type { Request, Response } from "express";

const FLAG = "SECURELOGIC_AUTONOMOUS_OPERATIONS_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
let prevFlag: string | undefined;

function mockRes(): Response & { _status?: number; _json?: unknown } {
  const res = {
    _status: 0, _json: undefined,
    status(code: number) { (this as { _status: number })._status = code; return this; },
    json(body: unknown) { (this as { _json: unknown })._json = body; return this; }
  };
  return res as unknown as Response & { _status?: number; _json?: unknown };
}

function req(orgId: string, opts: { userId?: string; params?: Record<string, string>; body?: unknown } = {}): Request {
  return {
    organizationContext: { organizationId: orgId },
    userId: opts.userId,
    params: opts.params ?? {},
    body: opts.body,
    ip: "203.0.113.9"
  } as unknown as Request;
}

async function seedUser(orgId: string, email: string): Promise<string> {
  const r = await pool.query(
    `INSERT INTO users (organization_id, email, name, password_hash) VALUES ($1, $2, $2, 'x') RETURNING id`,
    [orgId, email]
  );
  return r.rows[0].id as string;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  prevFlag = process.env[FLAG];
  process.env[FLAG] = "true";
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the orchestration test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  if (prevFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = prevFlag;
  await pool?.end();
});

describe("ERIP Epic 6 — approval-gated orchestration", () => {
  it("propose → self-approval refused (SoD) → different human approves → action executed", async () => {
    const proposer = await seedUser(seed.orgA.id, `proposer-${Date.now()}@corp.com`);
    const approver = await seedUser(seed.orgA.id, `approver-${Date.now()}@corp.com`);

    // Propose.
    const createRes = mockRes();
    await withTenant(seed.orgA.id, () =>
      createProposal(
        req(seed.orgA.id, {
          userId: proposer,
          body: { proposal_type: "create_action", title: "Remediate CVE-2026-1", payload: { title: "Remediate CVE-2026-1", priority: "immediate" } }
        }),
        createRes
      )
    );
    expect(createRes._status).toBe(201);
    const proposalId = (createRes._json as { proposal: { id: string; status: string } }).proposal.id;
    expect((createRes._json as { proposal: { status: string } }).proposal.status).toBe("proposed");

    // Self-approval refused (SoD).
    const selfRes = mockRes();
    await withTenant(seed.orgA.id, () =>
      approveProposal(req(seed.orgA.id, { userId: proposer, params: { id: proposalId } }), selfRes)
    );
    expect(selfRes._status).toBe(403);
    expect(selfRes._json).toMatchObject({ error: "separation_of_duties" });

    // A DIFFERENT human approves → executes.
    const approveRes = mockRes();
    await withTenant(seed.orgA.id, () =>
      approveProposal(req(seed.orgA.id, { userId: approver, params: { id: proposalId } }), approveRes)
    );
    expect(approveRes._status).toBe(200);
    const approved = (approveRes._json as { proposal: { status: string; execution_result: { action_id: string }; approved_by_user_id: string } }).proposal;
    expect(approved.status).toBe("executed");
    expect(approved.approved_by_user_id).toBe(approver);

    // The executor created a real actions row.
    const action = await pool.query(
      `SELECT id, title, action_type, source_type, priority, status FROM actions WHERE id = $1`,
      [approved.execution_result.action_id]
    );
    expect(action.rows[0]).toMatchObject({
      title: "Remediate CVE-2026-1",
      action_type: "orchestration:create_action",
      source_type: "manual",
      priority: "immediate",
      status: "open"
    });

    // Re-approving an executed proposal is refused (forward-only).
    const reRes = mockRes();
    await withTenant(seed.orgA.id, () =>
      approveProposal(req(seed.orgA.id, { userId: approver, params: { id: proposalId } }), reRes)
    );
    expect(reRes._status).toBe(409);
  });

  it("reject is terminal; a rejected proposal cannot be approved", async () => {
    const proposer = await seedUser(seed.orgA.id, `p2-${Date.now()}@corp.com`);
    const approver = await seedUser(seed.orgA.id, `a2-${Date.now()}@corp.com`);
    const createRes = mockRes();
    await withTenant(seed.orgA.id, () =>
      createProposal(
        req(seed.orgA.id, { userId: proposer, body: { proposal_type: "create_action", title: "T", payload: { title: "T", priority: "planned" } } }),
        createRes
      )
    );
    const id = (createRes._json as { proposal: { id: string } }).proposal.id;

    const rejRes = mockRes();
    await withTenant(seed.orgA.id, () => rejectProposal(req(seed.orgA.id, { userId: approver, params: { id } }), rejRes));
    expect(rejRes._status).toBe(200);
    expect((rejRes._json as { proposal: { status: string } }).proposal.status).toBe("rejected");

    const appRes = mockRes();
    await withTenant(seed.orgA.id, () => approveProposal(req(seed.orgA.id, { userId: approver, params: { id } }), appRes));
    expect(appRes._status).toBe(409);
  });

  it("org isolation: list and approve never cross orgs; RLS blocks direct reads", async () => {
    const proposer = await seedUser(seed.orgB.id, `pb-${Date.now()}@corp.com`);
    const createRes = mockRes();
    await withTenant(seed.orgB.id, () =>
      createProposal(
        req(seed.orgB.id, { userId: proposer, body: { proposal_type: "create_action", title: "B-only", payload: { title: "B-only", priority: "watch" } } }),
        createRes
      )
    );
    const bId = (createRes._json as { proposal: { id: string } }).proposal.id;

    // Org A's list does not include org B's proposal.
    const listRes = mockRes();
    await withTenant(seed.orgA.id, () => listProposals(req(seed.orgA.id), listRes));
    const titles = (listRes._json as { proposals: Array<{ title: string }> }).proposals.map((p) => p.title);
    expect(titles).not.toContain("B-only");

    // Org A approving org B's id → not found (org-scoped).
    const crossRes = mockRes();
    await withTenant(seed.orgA.id, () => approveProposal(req(seed.orgA.id, { userId: proposer, params: { id: bId } }), crossRes));
    expect(crossRes._status).toBe(404);

    // RLS: org A role cannot read org B's row directly.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      const r = await client.query(`SELECT count(*)::int AS n FROM orchestration_proposals WHERE id = $1`, [bId]);
      expect(r.rows[0].n).toBe(0);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});
