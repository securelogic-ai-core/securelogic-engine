/**
 * actionBlockMetadata.test.ts — R-10: a blocked remediation Action captures WHY.
 *
 * The walkthrough found "Block" was a bare status flip with nowhere to record the
 * blocker. Migration 20260908 adds four nullable columns; PATCH /api/actions/:id
 * now accepts and persists them. This drives the real app over real Postgres and
 * proves the round-trip, the validation, and that the write stays org-scoped.
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
     VALUES ($1, 'block-meta seed', 'High', 'seed', 'manual', 'open')
     RETURNING id`,
    [orgId]
  );
  return r.rows[0]!.id;
}

async function seedAction(orgId: string, findingId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO actions (organization_id, title, source_type, source_id, priority, status)
     VALUES ($1, 'remediate', 'finding', $2, 'near_term', 'in_progress')
     RETURNING id`,
    [orgId, findingId]
  );
  return r.rows[0]!.id;
}

const patchAction = (id: string, key: string, body: object) =>
  request(app).patch(`/api/actions/${id}`).set("X-Api-Key", key).send(body);

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the block-metadata test.");
  pool = new Pool({ connectionString: url, ssl: false });
  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

describe("R-10 — block metadata round-trips through PATCH /api/actions/:id", () => {
  it("persists reason, dependency, blocker owner and expected unblock date", async () => {
    const findingId = await seedFinding(seed.orgA.id);
    const actionId = await seedAction(seed.orgA.id, findingId);

    const res = await patchAction(actionId, seed.orgA.apiKey, {
      status: "blocked",
      blocked_reason: "Waiting on vendor patch",
      blocked_dependency: "CR-1042",
      blocked_owner_user_id: null,
      blocked_expected_unblock_date: "2026-07-01",
    });

    expect(res.status).toBe(200);
    expect(res.body.action.status).toBe("blocked");
    expect(res.body.action.blocked_reason).toBe("Waiting on vendor patch");
    expect(res.body.action.blocked_dependency).toBe("CR-1042");

    const row = await pool.query(
      `SELECT status, blocked_reason, blocked_dependency, blocked_expected_unblock_date
         FROM actions WHERE id = $1 AND organization_id = $2`,
      [actionId, seed.orgA.id]
    );
    expect(row.rows[0]!.status).toBe("blocked");
    expect(row.rows[0]!.blocked_reason).toBe("Waiting on vendor patch");
    expect(row.rows[0]!.blocked_dependency).toBe("CR-1042");
    expect(row.rows[0]!.blocked_expected_unblock_date).not.toBeNull();
  });

  it("empty-string blocker fields are stored as NULL, not ''", async () => {
    const findingId = await seedFinding(seed.orgA.id);
    const actionId = await seedAction(seed.orgA.id, findingId);
    const res = await patchAction(actionId, seed.orgA.apiKey, {
      blocked_reason: "  ",
      blocked_dependency: "",
    });
    expect(res.status).toBe(200);
    expect(res.body.action.blocked_reason).toBeNull();
    expect(res.body.action.blocked_dependency).toBeNull();
  });

  it("rejects a non-UUID blocker owner and a malformed unblock date", async () => {
    const findingId = await seedFinding(seed.orgA.id);
    const actionId = await seedAction(seed.orgA.id, findingId);

    const badOwner = await patchAction(actionId, seed.orgA.apiKey, { blocked_owner_user_id: "not-a-uuid" });
    expect(badOwner.status).toBe(400);
    expect(badOwner.body.error).toBe("blocked_owner_user_id_must_be_uuid_or_null");

    const badDate = await patchAction(actionId, seed.orgA.apiKey, { blocked_expected_unblock_date: "07/01/2026" });
    expect(badDate.status).toBe(400);
    expect(badDate.body.error).toBe("blocked_expected_unblock_date_must_be_yyyy_mm_dd_or_null");
  });

  it("another org cannot write blocker metadata onto this org's action", async () => {
    const findingId = await seedFinding(seed.orgA.id);
    const actionId = await seedAction(seed.orgA.id, findingId);

    const res = await patchAction(actionId, seed.orgB.apiKey, {
      status: "blocked",
      blocked_reason: "cross-tenant write attempt",
    });
    expect(res.status).toBe(404);

    const row = await pool.query(`SELECT blocked_reason FROM actions WHERE id = $1`, [actionId]);
    expect(row.rows[0]!.blocked_reason).toBeNull();
  });
});
