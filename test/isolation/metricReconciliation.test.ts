/**
 * metricReconciliation.test.ts — Metric Contract verification (Contract 1 E2E).
 *
 * Drives the REAL app (createApp) over real Postgres and proves that every
 * count surface computes the SAME number from the SAME definitions
 * (src/api/lib/metricDefinitions.ts):
 *
 *   1. dashboard actions.active == /api/actions/summary open_count, with
 *      open/in_progress/blocked as exact parts and IDENTICAL overdue in both;
 *   2. a due-TODAY action is overdue NOWHERE (DATE vs CURRENT_DATE rule — the
 *      old NOW() bug made it overdue on one screen and on-time on another);
 *   3. findings summary counts == the list `total` for the same filter
 *      (active / overdue / ready_for_decision) — tile and destination page
 *      reconcile exactly;
 *   4. the ready-for-decision queue is populated by the REAL cascade: closing
 *      the last remediation Action over HTTP flips the parent to remediated;
 *   5. my_work_open appears ONLY with a session identity (API-key calls omit
 *      it — honest unknown, never a fake 0);
 *   6. tenant isolation: org B's aggregates see none of org A's work.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;

async function seedFindingRow(opts: {
  orgId: string;
  title: string;
  severity: string;
  status: string;
  dueDate?: string | null;
}): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, status, due_date)
     VALUES ($1, $2, $3, 'metric-reconciliation seed', 'manual', $4, $5)
     RETURNING id`,
    [opts.orgId, opts.title, opts.severity, opts.status, opts.dueDate ?? null]
  );
  return r.rows[0].id;
}

async function seedActionRow(opts: {
  orgId: string;
  status: string;
  dueDate?: string | null;
  sourceType?: string;
  sourceId?: string | null;
}): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO actions (organization_id, title, source_type, source_id, priority, status, due_date)
     VALUES ($1, 'metric seed action', $2, $3, 'planned', $4, $5)
     RETURNING id`,
    [opts.orgId, opts.sourceType ?? "manual", opts.sourceId ?? null, opts.status, opts.dueDate ?? null]
  );
  return r.rows[0].id;
}

const get = (path: string, key: string) => request(app).get(path).set("X-Api-Key", key);

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the metric reconciliation test.");
  pool = new Pool({ connectionString: url, ssl: false });

  // createApp imported only now — infra/postgres.ts needs DATABASE_URL at import.
  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });

  // ── Org A: a deliberate mix exercising every definition edge ──
  // Findings: 2 open (Critical, Low), 1 in_progress (High, OVERDUE, unassigned), 1 closed.
  await seedFindingRow({ orgId: seed.orgA.id, title: "open critical", severity: "Critical", status: "open" });
  await seedFindingRow({
    orgId: seed.orgA.id, title: "in-progress overdue", severity: "High", status: "in_progress",
    dueDate: "2020-01-01",
  });
  await seedFindingRow({ orgId: seed.orgA.id, title: "closed", severity: "Low", status: "closed" });

  // Standalone actions: open, in_progress, blocked+OVERDUE, closed, open+due-TODAY.
  await seedActionRow({ orgId: seed.orgA.id, status: "open" });
  await seedActionRow({ orgId: seed.orgA.id, status: "in_progress" });
  await seedActionRow({ orgId: seed.orgA.id, status: "blocked", dueDate: "2020-01-01" });
  await seedActionRow({ orgId: seed.orgA.id, status: "closed" });
  // Due exactly today — must NOT be overdue anywhere (CURRENT_DATE, not NOW()).
  const today = (await pool.query<{ d: string }>(`SELECT CURRENT_DATE::text AS d`)).rows[0].d;
  await seedActionRow({ orgId: seed.orgA.id, status: "open", dueDate: today });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("Metric Contract — cross-surface reconciliation (real app, real Postgres)", () => {
  it("cascade: closing the last remediation Action over HTTP flips the parent to remediated", async () => {
    // The 4th open finding: remediation tracked by one Action, closed via the API.
    const findingId = await seedFindingRow({
      orgId: seed.orgA.id, title: "open low remediated-by-cascade", severity: "Low", status: "open",
    });
    const actionId = await seedActionRow({
      orgId: seed.orgA.id, status: "in_progress", sourceType: "finding", sourceId: findingId,
    });

    const patch = await request(app)
      .patch(`/api/actions/${actionId}`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ status: "closed" });
    expect(patch.status).toBe(200);

    const f = await pool.query(`SELECT operational_status FROM findings WHERE id = $1`, [findingId]);
    expect(f.rows[0].operational_status).toBe("remediated");
  });

  it("dashboard actions == actions summary: same active total, same parts, same overdue", async () => {
    const [dash, sum] = await Promise.all([
      get("/api/dashboard/summary", seed.orgA.apiKey),
      get("/api/actions/summary", seed.orgA.apiKey),
    ]);
    expect(dash.status).toBe(200);
    expect(sum.status).toBe(200);

    const a = dash.body.actions;
    const s = sum.body.summary;

    // ONE definition of active work — tile total equals destination total.
    expect(a.active).toBe(s.open_count);
    // Parts are exact: open + in_progress + blocked = active, on both surfaces.
    expect(a.open + a.in_progress + a.blocked).toBe(a.active);
    expect(s.open_only_count + s.in_progress_count + s.blocked_count).toBe(s.open_count);
    expect(a.open).toBe(s.open_only_count);
    expect(a.in_progress).toBe(s.in_progress_count);
    expect(a.blocked).toBe(s.blocked_count);
    // ONE definition of overdue.
    expect(a.overdue).toBe(s.overdue_count);

    // Seeded truth: active = open(1) + in_progress(1) + blocked(1) + due-today open(1)
    // = 4 standalone (the cascade test's action is closed). Overdue = the blocked
    // one ONLY — the due-today action must not count (CURRENT_DATE rule).
    expect(a.active).toBe(4);
    expect(a.blocked).toBe(1);
    expect(a.overdue).toBe(1);
  });

  it("findings summary counts reconcile exactly with the list totals for the same filters", async () => {
    const sum = await get("/api/findings/summary", seed.orgA.apiKey);
    expect(sum.status).toBe(200);
    const s = sum.body.summary;

    const [active, overdue, ready] = await Promise.all([
      get("/api/findings?active=true&limit=1", seed.orgA.apiKey),
      get("/api/findings?overdue=true&limit=1", seed.orgA.apiKey),
      get("/api/findings?ready_for_decision=true&limit=1", seed.orgA.apiKey),
    ]);

    // Tile count == destination page total, for every queue.
    expect(s.active_total).toBe(active.body.total);
    expect(s.overdue_open).toBe(overdue.body.total);
    expect(s.ready_for_decision_open).toBe(ready.body.total);

    // Seeded truth: active = open Critical + in_progress High + cascade finding
    // (open→remediated leaves legacy status 'open') = 3; overdue = 1;
    // ready-for-decision = the cascade finding = 1.
    expect(s.active_total).toBe(3);
    expect(s.overdue_open).toBe(1);
    expect(s.ready_for_decision_open).toBe(1);
    // Parts: open_count(2) + in_progress_open(1) = active_total.
    expect(s.open_count + s.in_progress_open).toBe(s.active_total);
    // Same-definition severity tile: Critical + High active.
    expect(s.critical_high_active).toBe(2);
  });

  it("dashboard findings.open equals the findings summary open_count (one definition)", async () => {
    const [dash, sum] = await Promise.all([
      get("/api/dashboard/summary", seed.orgA.apiKey),
      get("/api/findings/summary", seed.orgA.apiKey),
    ]);
    expect(dash.body.findings.open).toBe(sum.body.summary.open_count);
  });

  it("my_work_open is omitted for API-key callers (honest unknown, never a fake 0)", async () => {
    const sum = await get("/api/findings/summary", seed.orgA.apiKey);
    expect(sum.status).toBe(200);
    expect("my_work_open" in sum.body.summary).toBe(false);
  });

  it("owner filter accepts ONLY the literal 'me' (assignments are not enumerable)", async () => {
    const byId = await get(
      "/api/findings?owner=11111111-1111-1111-1111-111111111111",
      seed.orgA.apiKey
    );
    expect(byId.status).toBe(400);
  });

  it("tenant isolation: org B's aggregates see none of org A's work", async () => {
    const [dashB, findB, actB] = await Promise.all([
      get("/api/dashboard/summary", seed.orgB.apiKey),
      get("/api/findings/summary", seed.orgB.apiKey),
      get("/api/actions/summary", seed.orgB.apiKey),
    ]);
    expect(dashB.body.actions.active).toBe(0);
    expect(dashB.body.findings.open).toBe(0);
    expect(findB.body.summary.active_total).toBe(0);
    expect(findB.body.summary.ready_for_decision_open).toBe(0);
    expect(actB.body.summary.open_count).toBe(0);
    expect(actB.body.summary.overdue_count).toBe(0);
  });
});
