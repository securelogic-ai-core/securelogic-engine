/**
 * findingsBulkOps.test.ts — bulk operations + SLA policy defaults (W2 fixes).
 *
 * Proves over the REAL app:
 *   1. bulk assign: one call assigns N findings; per-id results; a foreign
 *      org's id reports not_found and is NEVER touched (no enumeration);
 *   2. bulk decide: every finding individually evaluated through the guarded
 *      machine — allowed transitions apply, guard refusals come back as
 *      per-id reasons (bulk is a convenience, never a bypass); flag-gated;
 *   3. SLA policy: PUT settings with severity→days, then a created finding
 *      with no due date gets CURRENT_DATE + days; explicit due dates and
 *      no-policy orgs unchanged.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, seedFinding, type TestDbSeed } from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;
let priorFlag: string | undefined;

const post = (key: string, path: string, body: unknown) =>
  request(app).post(path).set("X-Api-Key", key).send(body as object);

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the bulk-ops test.");
  pool = new Pool({ connectionString: url, ssl: false });

  priorFlag = process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED;
  process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED = "true";

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 120_000);

afterAll(async () => {
  if (priorFlag === undefined) delete process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED;
  else process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED = priorFlag;
  await pool?.end();
});

describe("POST /api/findings/bulk — assign", () => {
  it("assigns many findings in one call; foreign ids are not_found and untouched", async () => {
    const mine = await Promise.all([
      seedFinding(pool, seed.orgA.id),
      seedFinding(pool, seed.orgA.id),
      seedFinding(pool, seed.orgA.id),
    ]);
    const foreign = await seedFinding(pool, seed.orgB.id);
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (organization_id, email, password_hash)
       VALUES ($1, 'bulk-owner@harness.test', 'x') RETURNING id`,
      [seed.orgA.id]
    );
    const ownerId = user.rows[0].id;

    const res = await post(seed.orgA.apiKey, "/api/findings/bulk", {
      op: "assign",
      ids: [...mine, foreign],
      owner_user_id: ownerId,
    });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(3);
    const byId = new Map(res.body.results.map((r: { id: string; ok: boolean; reason?: string }) => [r.id, r]));
    for (const id of mine) expect((byId.get(id) as { ok: boolean }).ok).toBe(true);
    expect((byId.get(foreign) as { ok: boolean; reason?: string })).toMatchObject({ ok: false, reason: "not_found" });

    // Foreign finding NEVER touched.
    const f = await pool.query(`SELECT owner_user_id FROM findings WHERE id = $1`, [foreign]);
    expect(f.rows[0].owner_user_id).toBe(null);
  });

  it("bounds and validates input", async () => {
    expect((await post(seed.orgA.apiKey, "/api/findings/bulk", { op: "assign", ids: [], owner_user_id: null })).status).toBe(400);
    expect((await post(seed.orgA.apiKey, "/api/findings/bulk", { op: "nope", ids: ["x"] })).status).toBe(400);
    expect((await post(seed.orgA.apiKey, "/api/findings/bulk", { op: "assign", ids: ["not-a-uuid"], owner_user_id: null })).status).toBe(400);
  });
});

describe("POST /api/findings/bulk — decide (guarded, never a bypass)", () => {
  it("applies allowed transitions and returns per-id guard refusals", async () => {
    const triageable = await seedFinding(pool, seed.orgB.id); // needs_review → mitigating OK
    const unclosable = await seedFinding(pool, seed.orgB.id); // close guard must refuse

    const ok = await post(seed.orgB.apiKey, "/api/findings/bulk", {
      op: "decide",
      ids: [triageable],
      decision_state: "mitigating",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.updated).toBe(1);

    const refused = await post(seed.orgB.apiKey, "/api/findings/bulk", {
      op: "decide",
      ids: [unclosable],
      decision_state: "resolved",
    });
    expect(refused.status).toBe(200);
    expect(refused.body.updated).toBe(0);
    expect(refused.body.results[0]).toMatchObject({
      ok: false,
      reason: "close_requires_remediated_or_accepted_risk",
    });

    // Lifecycle stream recorded exactly the ONE applied transition.
    const events = await pool.query(
      `SELECT transition FROM finding_lifecycle_events WHERE finding_id = ANY($1::uuid[])`,
      [[triageable, unclosable]]
    );
    expect(events.rows.map((r) => r.transition)).toEqual(["accept_plan"]);
  });
});

describe("SLA policy defaults (risk_settings.finding_sla_by_severity)", () => {
  it("PUT settings then create: due_date defaults to CURRENT_DATE + policy days", async () => {
    const put = await request(app)
      .put("/api/orgs/me/risk-settings")
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({
        cadence_by_rating: { Critical: 30, High: 60, Moderate: 90, Low: 180 },
        finding_sla_by_severity: { Critical: 7, High: 14, Moderate: 30, Low: 90 },
      });
    expect(put.status).toBe(200);
    expect(put.body.finding_sla_by_severity).toEqual({ Critical: 7, High: 14, Moderate: 30, Low: 90 });

    const created = await post(seed.orgA.apiKey, "/api/findings", {
      title: "SLA policy default test",
      severity: "High",
      source_type: "manual",
      description: "sla",
    });
    expect(created.status).toBe(201);
    const expected = await pool.query<{ d: string }>(`SELECT (CURRENT_DATE + 14)::text AS d`);
    expect(String(created.body.finding.due_date).slice(0, 10)).toBe(expected.rows[0].d);
  });

  it("an explicit due date always wins over the policy", async () => {
    const created = await post(seed.orgA.apiKey, "/api/findings", {
      title: "explicit due date wins",
      severity: "High",
      source_type: "manual",
      description: "sla",
      due_date: "2030-01-01",
    });
    expect(created.status).toBe(201);
    expect(String(created.body.finding.due_date).slice(0, 10)).toBe("2030-01-01");
  });

  it("no-policy org: due_date stays null (behavior unchanged)", async () => {
    const created = await post(seed.orgB.apiKey, "/api/findings", {
      title: "no policy no date",
      severity: "High",
      source_type: "manual",
      description: "sla",
    });
    expect(created.status).toBe(201);
    expect(created.body.finding.due_date).toBe(null);
  });
});
