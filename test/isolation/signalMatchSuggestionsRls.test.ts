/**
 * signalMatchSuggestionsRls.test.ts — A04-G1: DB-layer RLS enforcement on
 * `signal_match_suggestions` (migration 20260702_signal_match_suggestions_rls.sql).
 *
 * Final table in the signal-link RLS batch. The route family
 * (signalMatchSuggestions.ts — list/counts/accept/dismiss/recompute) is
 * asTenant()-wrapped; the two background writers are tenant-safe
 * (cyberSignalProcessingService on pgElevated, llmControlMatcher inside
 * withTenant), so the policy preserves the "policy => writers tenant-safe"
 * invariant. Rows are org-owned (organization_id NOT NULL); target_id is
 * polymorphic with no FK, so a generated UUID is a valid target.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let suggestionA: string;
let signalA: string;
let signalB: string;

async function seedSignal(p: Pool, orgId: string, dedup: string): Promise<string> {
  const r = await p.query<{ id: string }>(
    `INSERT INTO cyber_signals
       (organization_id, source, signal_type, severity, normalized_summary, dedup_hash)
     VALUES ($1, 'test', 'breach', 'High', 'rls harness signal', $2)
     RETURNING id`,
    [orgId, dedup],
  );
  return r.rows[0].id;
}

// target_id has no FK (polymorphic dispatch by target_type) — a fresh UUID per
// insert keeps each row clear of the partial unique index on pending rows
// (organization_id, signal_id, target_type, target_id) WHERE pending.
const INSERT_SUGGESTION = `INSERT INTO signal_match_suggestions
    (organization_id, signal_id, target_type, target_id, match_reason, match_score)
  VALUES ($1, $2, 'control', $3, 'rls_harness', 80)
  RETURNING id`;

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the signal_match_suggestions RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });

  signalA = await seedSignal(pool, seed.orgA.id, "rls-sms-a");
  signalB = await seedSignal(pool, seed.orgB.id, "rls-sms-b");

  const a = await pool.query(INSERT_SUGGESTION, [seed.orgA.id, signalA, crypto.randomUUID()]);
  suggestionA = a.rows[0].id as string;
  await pool.query(INSERT_SUGGESTION, [seed.orgB.id, signalB, crypto.randomUUID()]);
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("A04-G1 — signal_match_suggestions RLS enforcement", () => {
  it("app_request scoped to org A cannot see org B's suggestions, and sees its own", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      const crossOrg = await client.query(
        "SELECT id FROM signal_match_suggestions WHERE organization_id = $1",
        [seed.orgB.id],
      );
      expect(crossOrg.rowCount).toBe(0);

      const visible = await client.query("SELECT organization_id FROM signal_match_suggestions");
      const orgs = visible.rows.map((r) => r.organization_id);
      expect(orgs).toContain(seed.orgA.id);
      expect(orgs).not.toContain(seed.orgB.id);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A can INSERT a suggestion for org A (positive write)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      const inserted = await client.query(INSERT_SUGGESTION, [seed.orgA.id, signalA, crypto.randomUUID()]);
      expect(inserted.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org B cannot UPDATE or DELETE org A's suggestion (rowCount 0, DB-enforced)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);

      const upd = await client.query("UPDATE signal_match_suggestions SET match_reason = 'hijacked' WHERE id = $1", [suggestionA]);
      expect(upd.rowCount).toBe(0);
      const dismiss = await client.query("UPDATE signal_match_suggestions SET dismissed_at = NOW() WHERE id = $1", [suggestionA]);
      expect(dismiss.rowCount).toBe(0);
      const hardDel = await client.query("DELETE FROM signal_match_suggestions WHERE id = $1", [suggestionA]);
      expect(hardDel.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an UNSET org GUC sees zero suggestions (fail-closed default)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      const res = await client.query("SELECT id FROM signal_match_suggestions");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an EMPTY-STRING org GUC sees zero suggestions (NULLIF fail-closed)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', '', true)");
      const res = await client.query("SELECT id FROM signal_match_suggestions");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A cannot INSERT a suggestion stamped for org B (WITH CHECK)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);

      await expect(
        client.query(INSERT_SUGGESTION, [seed.orgB.id, signalB, crypto.randomUUID()]),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the owner connection bypasses RLS (regression — sees all orgs' suggestions)", async () => {
    const res = await pool.query("SELECT DISTINCT organization_id FROM signal_match_suggestions");
    const orgs = res.rows.map((r) => r.organization_id);
    expect(orgs).toContain(seed.orgA.id);
    expect(orgs).toContain(seed.orgB.id);
  });
});
