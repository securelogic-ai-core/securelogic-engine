/**
 * findingOperationalClosure.test.ts — the authoritative Active predicate, proved.
 *
 * THE DEFECT THIS FILE EXISTS FOR. The canonical enterprise metric is now
 *
 *     Active Finding = operational_status <> 'closed'
 *
 * but before the 20260906 migration, operational_status had NO terminal state
 * (CHECK: open | in_progress | remediated). Against that schema the predicate is
 * ALWAYS TRUE — every closed finding in the platform would have counted as Active,
 * on every surface, silently. This file drives the real app over real Postgres and
 * proves the predicate now means what it says.
 *
 * The four things the ruling demands, each an assertion below:
 *   1. closed findings are EXCLUDED from Active;
 *   2. remediated findings REMAIN Active until validated (the one that matters most —
 *      if remediated ever counts as closed, the platform tells customers that
 *      unvalidated work is finished);
 *   3. reopening restores the finding's REAL active state, derived from its Actions;
 *   4. the legacy and operational axes can never contradict one another.
 *
 * Plus the migration's central safety property: the new predicate and the old one
 * select the IDENTICAL population, so no customer-facing number moved.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import request from "supertest";
import type { Express } from "express";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

const DW_FLAG = "SECURELOGIC_DECISION_WORKSPACE_ENABLED";

let seed: TestDbSeed;
let pool: Pool;
let app: Express;
let prevDw: string | undefined;

async function seedFinding(orgId: string, title: string, status = "open"): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, status)
     VALUES ($1, $2, 'High', 'closure-test seed', 'manual', $3)
     RETURNING id`,
    [orgId, title, status]
  );
  return r.rows[0]!.id;
}

/** A remediation Action on the finding — the workflow evidence the axis derives from. */
async function seedAction(orgId: string, findingId: string, status: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO actions (organization_id, title, source_type, source_id, priority, status)
     VALUES ($1, 'remediate', 'finding', $2, 'near_term', $3)
     RETURNING id`,
    [orgId, findingId, status]
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

/** The ACTIVE population, counted the way every reader now counts it. */
async function activeCount(orgId: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM findings
      WHERE organization_id = $1 AND operational_status <> 'closed'`,
    [orgId]
  );
  return parseInt(r.rows[0]!.n, 10);
}

/** The population the OLD canonical predicate selected. Must be identical. */
async function legacyActiveCount(orgId: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM findings
      WHERE organization_id = $1 AND status IN ('open', 'in_progress')`,
    [orgId]
  );
  return parseInt(r.rows[0]!.n, 10);
}

const patch = (id: string, key: string, body: object) =>
  request(app).patch(`/api/findings/${id}`).set("X-Api-Key", key).send(body);

beforeAll(async () => {
  seed = await bootstrapTestDb();
  prevDw = process.env[DW_FLAG];
  process.env[DW_FLAG] = "true"; // the decision axis is flag-gated
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the closure test.");
  pool = new Pool({ connectionString: url, ssl: false });

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 180_000);

afterAll(async () => {
  if (prevDw === undefined) delete process.env[DW_FLAG];
  else process.env[DW_FLAG] = prevDw;
  await pool?.end();
});

describe("the operational axis has a terminal state (migration 20260906)", () => {
  it("the schema admits 'closed' — the predicate is no longer vacuously true", async () => {
    const c = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'findings'::regclass AND conname = 'findings_operational_status_check'`
    );
    expect(c.rows[0]!.def).toContain("closed");
    expect(c.rows[0]!.def).toContain("remediated");
  });

  it("the database itself forbids the two axes contradicting each other", async () => {
    const id = await seedFinding(seed.orgA.id, "closure-invariant");
    // Try to create the exact state that would break the Active predicate: legacy
    // says closed, operational says open. The CHECK must refuse it.
    await expect(
      pool.query(`UPDATE findings SET status = 'closed' WHERE id = $1`, [id])
    ).rejects.toThrow(/findings_closure_axes_agree/);

    // And the inverse.
    await expect(
      pool.query(`UPDATE findings SET operational_status = 'closed' WHERE id = $1`, [id])
    ).rejects.toThrow(/findings_closure_axes_agree/);
  });
});

describe("Active Finding = operational_status <> 'closed'", () => {
  it("a REMEDIATED finding is still ACTIVE — completed work awaiting validation", async () => {
    // The assertion that matters most in this package. Remediation done, nobody has
    // validated it. It is NOT closed, and it must NOT leave the Active population.
    const id = await seedFinding(seed.orgB.id, "remediated-stays-active");
    const actionId = await seedAction(seed.orgB.id, id, "in_progress");

    const before = await activeCount(seed.orgB.id);

    const close = await request(app)
      .patch(`/api/actions/${actionId}`)
      .set("X-Api-Key", seed.orgB.apiKey)
      .send({ status: "closed" });
    expect(close.status).toBe(200);

    const a = await axes(id);
    expect(a.op).toBe("remediated");
    expect(a.status).not.toBe("closed"); // legacy axis is NOT closed either
    expect(await activeCount(seed.orgB.id)).toBe(before); // still counted
  });

  it("a governance CLOSE excludes the finding from Active, on BOTH axes", async () => {
    const id = await seedFinding(seed.orgB.id, "governance-close");
    const actionId = await seedAction(seed.orgB.id, id, "in_progress");
    await request(app)
      .patch(`/api/actions/${actionId}`)
      .set("X-Api-Key", seed.orgB.apiKey)
      .send({ status: "closed" });
    expect((await axes(id)).op).toBe("remediated"); // ready for decision

    const before = await activeCount(seed.orgB.id);

    // The human governance decision — the only path to closure.
    const res = await patch(id, seed.orgB.apiKey, { decision_state: "resolved" });
    expect(res.status).toBe(200);

    const a = await axes(id);
    expect(a.decision).toBe("resolved");
    expect(a.op).toBe("closed");     // derived, not hand-set
    expect(a.status).toBe("closed"); // legacy axis dragged along — no contradiction
    expect(await activeCount(seed.orgB.id)).toBe(before - 1);

    // The API must report the state the DB actually holds, not the pre-recompute one.
    expect(res.body.finding.operational_status).toBe("closed");
  });

  it("REOPEN restores the finding's real active state, derived from its Actions", async () => {
    const id = await seedFinding(seed.orgB.id, "reopen-to-real-state");
    const actionId = await seedAction(seed.orgB.id, id, "in_progress");
    await request(app)
      .patch(`/api/actions/${actionId}`)
      .set("X-Api-Key", seed.orgB.apiKey)
      .send({ status: "closed" });
    await patch(id, seed.orgB.apiKey, { decision_state: "resolved" });
    expect((await axes(id)).op).toBe("closed");

    // Reopen. The finding's Action is still terminal, so its REAL state is
    // 'remediated' — not 'open'. A dumb reopen would have parked it at 'open' and
    // lost the fact that the work was already done.
    const res = await patch(id, seed.orgB.apiKey, { decision_state: "needs_review" });
    expect(res.status).toBe(200);

    const a = await axes(id);
    expect(a.op).toBe("remediated");
    expect(a.status).toBe("in_progress"); // §3: remediated has no legacy spelling
    expect(res.body.finding.operational_status).toBe("remediated");
  });

  it("reopening a finding whose work is UNDONE returns it to in_progress", async () => {
    const id = await seedFinding(seed.orgB.id, "reopen-work-restarted");
    const actionId = await seedAction(seed.orgB.id, id, "in_progress");

    // Complete the work through the API so the cascade actually derives the state
    // (closing an Action with raw SQL would bypass the recompute, and the close
    // guard would then correctly refuse — the finding would never be remediated).
    await request(app)
      .patch(`/api/actions/${actionId}`)
      .set("X-Api-Key", seed.orgB.apiKey)
      .send({ status: "closed" });
    await patch(id, seed.orgB.apiKey, { decision_state: "resolved" });
    expect((await axes(id)).op).toBe("closed");

    // Work restarts WHILE the finding is closed. Governance still dominates: a
    // closed finding stays closed however much Action churn happens beneath it.
    await request(app)
      .patch(`/api/actions/${actionId}`)
      .set("X-Api-Key", seed.orgB.apiKey)
      .send({ status: "in_progress" });
    expect((await axes(id)).op).toBe("closed");

    // Now reopen it: the finding returns to the state its real work implies.
    await patch(id, seed.orgB.apiKey, { decision_state: "needs_review" });
    expect((await axes(id)).op).toBe("in_progress");
  });

  it("the LEGACY compat bridge: a direct status='closed' write closes the operational axis too", async () => {
    // Legacy `status` is still writable (importers, flag-off callers). If it did not
    // drag the authoritative axis with it, this finding would be status='closed' and
    // operational_status='open' — counted as ACTIVE while displayed as closed.
    const id = await seedFinding(seed.orgB.id, "legacy-close-bridge");
    const before = await activeCount(seed.orgB.id);

    const res = await patch(id, seed.orgB.apiKey, { status: "closed" });
    expect(res.status).toBe(200);

    const a = await axes(id);
    expect(a.op).toBe("closed");
    expect(await activeCount(seed.orgB.id)).toBe(before - 1);
  });

  it("the bridge reverses: reopening via legacy status returns it to Active", async () => {
    const id = await seedFinding(seed.orgB.id, "legacy-reopen-bridge");
    await patch(id, seed.orgB.apiKey, { status: "closed" });
    expect((await axes(id)).op).toBe("closed");

    const res = await patch(id, seed.orgB.apiKey, { status: "open" });
    expect(res.status).toBe(200);
    expect((await axes(id)).op).toBe("open");
  });

  it("legacy 'accepted' is terminal — the population it had before the migration", async () => {
    const id = await seedFinding(seed.orgB.id, "legacy-accepted");
    const res = await patch(id, seed.orgB.apiKey, { status: "accepted" });
    expect(res.status).toBe(200);

    const a = await axes(id);
    expect(a.op).toBe("closed");
    expect(a.status).toBe("accepted"); // preserved, not rewritten to 'closed'
  });
});

describe("the migration moved no customer-facing number", () => {
  it("the NEW predicate and the OLD one select the identical population", async () => {
    // The safety property of the whole package. Every row in both orgs — seeded above
    // through closes, reopens, remediations and legacy writes — must be classified
    // identically by `operational_status <> 'closed'` and by the pre-migration
    // `status IN ('open','in_progress')`. If these ever diverge, some surface's count
    // silently changed.
    for (const org of [seed.orgA, seed.orgB]) {
      expect(await activeCount(org.id)).toBe(await legacyActiveCount(org.id));
    }

    // And not vacuously: org B genuinely holds BOTH closed and active findings, so
    // the agreement above is a real reconciliation and not two empty sets matching.
    const total = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM findings WHERE organization_id = $1`,
      [seed.orgB.id]
    );
    const active = await activeCount(seed.orgB.id);
    expect(active).toBeGreaterThan(0);
    expect(parseInt(total.rows[0]!.n, 10)).toBeGreaterThan(active);
  });
});

describe("tenant isolation", () => {
  it("closing a finding in org B changes no count in org A", async () => {
    const beforeA = await activeCount(seed.orgA.id);

    const id = await seedFinding(seed.orgB.id, "iso-close");
    await patch(id, seed.orgB.apiKey, { status: "closed" });

    expect(await activeCount(seed.orgA.id)).toBe(beforeA);
  });

  it("org A cannot close org B's finding (cross-org write is a 404, not a close)", async () => {
    const id = await seedFinding(seed.orgB.id, "iso-cross-org-close");

    const res = await patch(id, seed.orgA.apiKey, { status: "closed" });
    expect(res.status).toBe(404);

    // And it is genuinely untouched — still Active in its own org.
    expect((await axes(id)).op).not.toBe("closed");
  });
});
