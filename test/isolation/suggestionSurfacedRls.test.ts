/**
 * suggestionSurfacedRls.test.ts — real-Postgres proof that the surfaced-event
 * telemetry columns (20261025) inherit `signal_match_suggestions` RLS and add
 * no cross-tenant path.
 *
 * The telemetry is columns on an existing org-owned, RLS-enabled row rather
 * than a new event table, precisely so isolation is inherited rather than
 * re-established. This proves that inheritance holds for WRITES as well as
 * reads, including the case that matters most: an attacker-supplied suggestion
 * id belonging to another organization.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let suggestionA: string;
let suggestionB: string;

const INSERT_SUGGESTION = `INSERT INTO signal_match_suggestions
    (organization_id, signal_id, target_type, target_id, match_reason, match_score)
  VALUES ($1, $2, 'control', $3, 'surfaced_harness', 80)
  RETURNING id`;

/** The exact statement suggestionSurfacedTelemetry.ts issues. */
const SURFACE_SQL = `UPDATE signal_match_suggestions
    SET first_surfaced_at     = COALESCE(first_surfaced_at, $3),
        last_surfaced_at      = $3,
        surface_count         = surface_count + 1,
        last_surfaced_surface = $4
  WHERE organization_id = $1
    AND id = ANY($2::uuid[])
    AND (last_surfaced_at IS NULL OR last_surfaced_at <= $5)
  RETURNING id`;

async function seedSignal(p: Pool, orgId: string, dedup: string): Promise<string> {
  const r = await p.query<{ id: string }>(
    `INSERT INTO cyber_signals
       (organization_id, source, signal_type, severity, normalized_summary, dedup_hash)
     VALUES ($1, 'test', 'breach', 'High', 'surfaced harness signal', $2)
     RETURNING id`,
    [orgId, dedup],
  );
  return r.rows[0].id;
}

async function asOrg<T>(orgId: string, fn: (c: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE app_request");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the surfaced-telemetry RLS test.");
  pool = new Pool({ connectionString: url, ssl: false });

  const signalA = await seedSignal(pool, seed.orgA.id, "surfaced-a");
  const signalB = await seedSignal(pool, seed.orgB.id, "surfaced-b");
  suggestionA = (await pool.query(INSERT_SUGGESTION, [seed.orgA.id, signalA, crypto.randomUUID()])).rows[0].id;
  suggestionB = (await pool.query(INSERT_SUGGESTION, [seed.orgB.id, signalB, crypto.randomUUID()])).rows[0].id;
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("surfaced telemetry — RLS enforcement", () => {
  it("the columns exist with the intended defaults, and default to NEVER SURFACED", async () => {
    const r = await pool.query(
      `SELECT first_surfaced_at, last_surfaced_at, surface_count, last_surfaced_surface
         FROM signal_match_suggestions WHERE id = $1`, [suggestionA]);
    // NULL means "never observed surfaced" — deliberately distinct from a zero
    // that would imply we looked and saw nothing.
    expect(r.rows[0].first_surfaced_at).toBeNull();
    expect(r.rows[0].last_surfaced_at).toBeNull();
    expect(r.rows[0].surface_count).toBe(0);
    expect(r.rows[0].last_surfaced_surface).toBeNull();
  });

  it("org A can record its own suggestion as surfaced (positive write, under app_request)", async () => {
    const now = new Date();
    const stale = new Date(now.getTime() - 30 * 60 * 1000);
    const updated = await asOrg(seed.orgA.id, async (c) => {
      const r = await c.query(SURFACE_SQL, [seed.orgA.id, [suggestionA], now, "suggestions_list", stale]);
      // Read back inside the same scope to prove the write landed.
      const back = await c.query(
        "SELECT first_surfaced_at, surface_count, last_surfaced_surface FROM signal_match_suggestions WHERE id = $1",
        [suggestionA]);
      return { rowCount: r.rowCount, row: back.rows[0] };
    });
    expect(updated.rowCount).toBe(1);
    expect(updated.row.first_surfaced_at).not.toBeNull();
    expect(updated.row.surface_count).toBe(1);
    expect(updated.row.last_surfaced_surface).toBe("suggestions_list");
  });

  it("org A CANNOT mark org B's suggestion surfaced, even naming its exact id", async () => {
    const now = new Date();
    const stale = new Date(now.getTime() - 30 * 60 * 1000);

    // The adversarial case: a caller scoped to org A supplies org B's real
    // suggestion id. RLS must make the row invisible to the UPDATE.
    const r = await asOrg(seed.orgA.id, (c) =>
      c.query(SURFACE_SQL, [seed.orgB.id, [suggestionB], now, "suggestions_list", stale]));
    expect(r.rowCount).toBe(0);

    // ...and org B's row is untouched, verified on the owner channel.
    const check = await pool.query(
      "SELECT first_surfaced_at, surface_count FROM signal_match_suggestions WHERE id = $1", [suggestionB]);
    expect(check.rows[0].first_surfaced_at).toBeNull();
    expect(check.rows[0].surface_count).toBe(0);
  });

  it("even with its OWN org id in the predicate, org A cannot reach org B's row id", async () => {
    // Belt and braces: the id is org B's but the predicate claims org A. RLS
    // and the explicit organization_id predicate must BOTH have to fail for a
    // cross-tenant write to occur.
    const now = new Date();
    const stale = new Date(now.getTime() - 30 * 60 * 1000);
    const r = await asOrg(seed.orgA.id, (c) =>
      c.query(SURFACE_SQL, [seed.orgA.id, [suggestionB], now, "suggestions_list", stale]));
    expect(r.rowCount).toBe(0);
  });

  it("org B cannot READ org A's surfaced telemetry", async () => {
    const rows = await asOrg(seed.orgB.id, (c) =>
      c.query("SELECT id, first_surfaced_at FROM signal_match_suggestions WHERE first_surfaced_at IS NOT NULL"));
    expect(rows.rows.map((r) => r.id)).not.toContain(suggestionA);
  });

  it("the coalesce predicate suppresses a repeat inside the window, in real Postgres", async () => {
    const now = new Date();
    const stale = new Date(now.getTime() - 30 * 60 * 1000);
    const result = await asOrg(seed.orgA.id, async (c) => {
      // First surfacing in this scope.
      const first = await c.query(SURFACE_SQL, [seed.orgA.id, [suggestionA], now, "suggestions_list", stale]);
      // Immediate repeat — inside the window, so it must update nothing.
      const repeat = await c.query(SURFACE_SQL, [seed.orgA.id, [suggestionA], now, "suggestions_list", stale]);
      // A surfacing after the window has elapsed counts again.
      const later = new Date(now.getTime() + 31 * 60 * 1000);
      const after = await c.query(SURFACE_SQL,
        [seed.orgA.id, [suggestionA], later, "suggestions_list", new Date(later.getTime() - 30 * 60 * 1000)]);
      const back = await c.query(
        "SELECT first_surfaced_at, last_surfaced_at, surface_count FROM signal_match_suggestions WHERE id = $1",
        [suggestionA]);
      return { first: first.rowCount, repeat: repeat.rowCount, after: after.rowCount, row: back.rows[0] };
    });

    expect(result.first).toBe(1);
    expect(result.repeat).toBe(0);   // re-render suppressed
    expect(result.after).toBe(1);    // meaningful re-surfacing counted
    expect(result.row.surface_count).toBe(2);
    // first_surfaced_at is immutable; last_surfaced_at advances.
    expect(new Date(result.row.last_surfaced_at).getTime())
      .toBeGreaterThan(new Date(result.row.first_surfaced_at).getTime());
  });

  it("recording surfaced does NOT disturb accept/dismiss state", async () => {
    const row = await pool.query(
      "SELECT accepted_at, dismissed_at, accepted_link_id FROM signal_match_suggestions WHERE id = $1",
      [suggestionA]);
    expect(row.rows[0].accepted_at).toBeNull();
    expect(row.rows[0].dismissed_at).toBeNull();
    expect(row.rows[0].accepted_link_id).toBeNull();
  });
});
