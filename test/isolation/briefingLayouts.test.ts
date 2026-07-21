/**
 * briefingLayouts.test.ts — real-Postgres cross-org / cross-user isolation for
 * the per-user Briefing layout store (Briefing Initiative B2). A layout is
 * scoped to (org, user): briefingLayouts.ts reads/upserts/deletes with
 * `WHERE organization_id = $org AND user_id = $user`. These tests exercise
 * those exact predicates so a layout can never be read, replaced, or deleted
 * across an org OR across users within an org, and pin the one-per-user rule.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;

const ENVELOPE = { version: 1, modules: [{ moduleId: "my_work", instanceKey: "my_work", config: {} }] };
const ENVELOPE_B = { version: 1, modules: [{ moduleId: "posture_score", instanceKey: "posture_score", config: {} }] };

async function seedLayout(orgId: string, userId: string, layout: object = ENVELOPE) {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO briefing_layouts (organization_id, user_id, layout)
     VALUES ($1, $2, $3::jsonb) RETURNING id`,
    [orgId, userId, JSON.stringify(layout)]
  );
  return r.rows[0].id;
}

// The route's read predicate — the thing under test.
async function readFor(orgId: string, userId: string) {
  return (
    await pool.query(
      `SELECT id, layout FROM briefing_layouts WHERE organization_id = $1 AND user_id = $2 LIMIT 1`,
      [orgId, userId]
    )
  ).rows;
}
async function deleteFor(orgId: string, userId: string) {
  return (
    await pool.query(
      `DELETE FROM briefing_layouts WHERE organization_id = $1 AND user_id = $2 RETURNING id`,
      [orgId, userId]
    )
  ).rowCount;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the briefing-layouts test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("briefing_layouts — cross-org / cross-user isolation (real Postgres)", () => {
  it("reads only the caller's own layout within their org", async () => {
    const uA = await seedUser(pool, seed.orgA.id, {});
    const uA2 = await seedUser(pool, seed.orgA.id, {});
    const uB = await seedUser(pool, seed.orgB.id, {});
    const lA = await seedLayout(seed.orgA.id, uA.id);
    await seedLayout(seed.orgA.id, uA2.id, ENVELOPE_B);
    await seedLayout(seed.orgB.id, uB.id, ENVELOPE_B);

    const rows = await readFor(seed.orgA.id, uA.id);
    expect(rows.map((r) => r.id)).toEqual([lA]); // not uA2's, not org B's
    expect(rows[0].layout).toEqual(ENVELOPE);
  });

  it("cannot delete another user's layout (same org) or another org's layout", async () => {
    const uA = await seedUser(pool, seed.orgA.id, {});
    const uA2 = await seedUser(pool, seed.orgA.id, {});
    const uB = await seedUser(pool, seed.orgB.id, {});
    const lA = await seedLayout(seed.orgA.id, uA.id);

    // wrong user, same org → no delete
    expect(await deleteFor(seed.orgA.id, uA2.id)).toBe(0);
    // wrong org (even with the right user id) → no delete
    expect(await deleteFor(seed.orgB.id, uA.id)).toBe(0);
    expect(await deleteFor(seed.orgB.id, uB.id)).toBe(0);
    // still present for the owner
    expect((await readFor(seed.orgA.id, uA.id)).map((r) => r.id)).toEqual([lA]);
    // owner can delete (the reset path)
    expect(await deleteFor(seed.orgA.id, uA.id)).toBe(1);
  });

  it("enforces exactly one layout per (org, user) and upserts in place", async () => {
    const uA = await seedUser(pool, seed.orgA.id, {});
    const first = await seedLayout(seed.orgA.id, uA.id);
    // A second bare INSERT violates briefing_layouts_one_per_user…
    await expect(seedLayout(seed.orgA.id, uA.id, ENVELOPE_B)).rejects.toThrow();
    // …and the route's ON CONFLICT upsert replaces in place instead.
    const upsert = await pool.query(
      `INSERT INTO briefing_layouts (organization_id, user_id, layout)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (organization_id, user_id)
       DO UPDATE SET layout = EXCLUDED.layout, updated_at = NOW()
       RETURNING id, layout`,
      [seed.orgA.id, uA.id, JSON.stringify(ENVELOPE_B)]
    );
    expect(upsert.rows[0].id).toBe(first);
    expect(upsert.rows[0].layout).toEqual(ENVELOPE_B);
  });

  it("erasure deletes the user's layout rows (accountDeletionReaper Category-B predicate)", async () => {
    const uA = await seedUser(pool, seed.orgA.id, {});
    const uA2 = await seedUser(pool, seed.orgA.id, {});
    await seedLayout(seed.orgA.id, uA.id);
    await seedLayout(seed.orgA.id, uA2.id, ENVELOPE_B);

    // The reaper's exact statement (users are tombstoned, so CASCADE never fires).
    await pool.query(`DELETE FROM briefing_layouts WHERE organization_id = $1 AND user_id = $2`, [
      seed.orgA.id,
      uA.id,
    ]);
    expect(await readFor(seed.orgA.id, uA.id)).toEqual([]);
    // The other user's layout survives.
    expect((await readFor(seed.orgA.id, uA2.id)).length).toBe(1);
  });
});
