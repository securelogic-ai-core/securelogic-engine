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

  // Risks: 3 still on the register (one deliberately UNSCORED → the 'Unscored'
  // bucket) and 2 terminal. The terminal pair is the whole point — without them the
  // "Open Risks tile == its destination list" assertion would pass on an empty set
  // and prove nothing.
  for (const [status, residual] of [
    ["open", "Critical"],
    ["accepted", "Moderate"],
    ["open", null],
    ["closed", "High"],
    ["transferred", "Low"],
  ] as const) {
    await pool.query(
      `INSERT INTO risks (organization_id, title, domain, likelihood, impact, risk_rating, residual_rating, status)
       VALUES ($1, $2, 'Cyber', 'possible', 'High', 'High', $3, $4)`,
      [seed.orgA.id, `risk ${status} ${residual ?? "unscored"}`, residual, status]
    );
  }
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

  it("the ACTIVE tile's own link reproduces the ACTIVE number (tile → destination)", async () => {
    // The gap this closes: the tests above proved the tile agrees with the
    // *summary*, but never that it agrees with the LIST THE USER LANDS ON. It did
    // not. `/api/actions` had only a single exact `status=` filter, so the tile's
    // link carried no status at all and the destination listed closed and accepted
    // actions under a heading promising N active. No URL could reproduce N.
    const [dash, activeList, unfiltered] = await Promise.all([
      get("/api/dashboard/summary", seed.orgA.apiKey),
      get("/api/actions?active=true&limit=100", seed.orgA.apiKey),
      get("/api/actions?limit=100", seed.orgA.apiKey),
    ]);
    expect(activeList.status).toBe(200);

    // The number on the tile == the total of the page it links to. This is the
    // whole acceptance criterion ("dashboard metrics reconcile with destination
    // pages") for Actions.
    expect(activeList.body.total).toBe(dash.body.actions.active);
    expect(activeList.body.total).toBe(4);

    // ...and it is a REAL filter, not a coincidence: the unfiltered list is strictly
    // bigger, because it still contains the terminal (closed) actions.
    expect(unfiltered.body.total).toBeGreaterThan(activeList.body.total);
    const statuses = activeList.body.actions.map((x: { status: string }) => x.status);
    expect(statuses).not.toContain("closed");
    expect(statuses).not.toContain("accepted");
  });

  it("is_overdue ships from the server — a due-TODAY action is not overdue anywhere", async () => {
    // The client used to re-derive this against NOW() instead of CURRENT_DATE, so
    // an action due TODAY wore a red 'overdue' badge in the list while being
    // excluded from the dashboard's overdue count. Same action, two answers. The
    // field is now decided once, server-side, by the Metric Contract.
    const list = await get("/api/actions?limit=100", seed.orgA.apiKey);
    expect(list.status).toBe(200);

    const rows = list.body.actions as Array<{
      status: string;
      due_date: string | null;
      is_overdue: boolean;
    }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(typeof r.is_overdue).toBe("boolean");

    // Exactly one overdue row, and it is the long-past blocked one — never the
    // due-today one. This equals the dashboard's overdue count by construction.
    const overdue = rows.filter((r) => r.is_overdue);
    expect(overdue).toHaveLength(1);
    expect(overdue[0]!.status).toBe("blocked");

    const today = new Date().toISOString().slice(0, 10);
    const dueToday = rows.filter((r) => (r.due_date ?? "").slice(0, 10) === today);
    expect(dueToday).toHaveLength(1);
    expect(dueToday[0]!.is_overdue).toBe(false);

    const dash = await get("/api/dashboard/summary", seed.orgA.apiKey);
    expect(overdue.length).toBe(dash.body.actions.overdue);
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

  it("the dashboard findings tile, the Operations Center, and the list are ONE number", async () => {
    // This test used to assert `dash.findings.open === summary.open_count`, and it
    // PASSED — both were `status='open'`. It was pinning the divergence in place:
    // the aging numbers inside that same dashboard tile counted sqlFindingActive()
    // (open + in_progress), so the tile disagreed with ITSELF, and the word
    // "findings" meant a smaller number on the dashboard than in the Operations
    // Center. Agreeing with the wrong definition is not reconciliation.
    const [dash, sum, list, unfiltered] = await Promise.all([
      get("/api/dashboard/summary", seed.orgA.apiKey),
      get("/api/findings/summary", seed.orgA.apiKey),
      get("/api/findings?active=true&limit=100", seed.orgA.apiKey),
      get("/api/findings?limit=100", seed.orgA.apiKey),
    ]);

    const active = dash.body.findings.active;
    expect(active).toBe(sum.body.summary.active_total); // dashboard == Operations Center
    expect(active).toBe(list.body.total);               // == the page the tile links to
    expect(dash.body.findings.open).toBe(active);       // deprecated alias, same number

    // The destination's POPULATION, not just its total: the tile links to `?active=true`,
    // so that URL must carry exactly the findings that still require work. Asserting the
    // total alone would still pass if the list quietly served every status.
    const statuses = list.body.findings.map((f: { status: string }) => f.status);
    expect(statuses).not.toContain("closed");
    expect(statuses).not.toContain("accepted");
    // The filter is real: the unfiltered list still carries the terminal findings.
    expect(unfiltered.body.total).toBeGreaterThan(active);

    // The severity donut is drawn from the SAME population as the headline, so the
    // parts can never exceed the whole.
    const bySeverity: Record<string, number> = dash.body.findings.by_severity;
    const sumParts = Object.values(bySeverity).reduce((a, b) => a + b, 0);
    expect(sumParts).toBe(active);

    // ...and the aging buckets, which live in this tile, are subsets of it — the
    // defect was that they were computed over a LARGER population than the headline.
    expect(dash.body.findings.older_than_30).toBeLessThanOrEqual(active);
    expect(dash.body.findings.older_than_7).toBeLessThanOrEqual(active);
  });

  it("the Open Risks tile's link reproduces the Open Risks number", async () => {
    // /api/risks applied NO default status filter, so the tile's "open risks" count
    // landed on a page that also listed closed and transferred risks. No URL could
    // reproduce the tile.
    const [dash, activeList, unfiltered] = await Promise.all([
      get("/api/dashboard/summary", seed.orgA.apiKey),
      get("/api/risks?active=true&limit=100", seed.orgA.apiKey),
      get("/api/risks?limit=100", seed.orgA.apiKey),
    ]);
    expect(activeList.status).toBe(200);

    const rs = dash.body.risks_summary;
    // Seeded: 3 on the register (open/Critical, accepted/Moderate, open/UNSCORED),
    // 2 terminal (closed, transferred).
    expect(rs.open).toBe(3);
    expect(activeList.body.risks.length).toBe(rs.open);

    // The severity breakdown is drawn from the same population as its own total —
    // including the unscored risk, which lands in 'Unscored' rather than vanishing.
    const byRating = rs.by_residual_rating as Record<string, number>;
    expect(Object.values(byRating).reduce((a, b) => a + b, 0)).toBe(rs.open);
    expect(byRating["Unscored"]).toBe(1);

    const statuses = activeList.body.risks.map((r: { status: string }) => r.status);
    expect(statuses).not.toContain("closed");
    expect(statuses).not.toContain("transferred");
    // The filter is real: the unfiltered list still carries the terminal risks.
    expect(unfiltered.body.risks.length).toBeGreaterThanOrEqual(activeList.body.risks.length);
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
