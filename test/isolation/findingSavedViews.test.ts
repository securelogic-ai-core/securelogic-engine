/**
 * findingSavedViews.test.ts — real-Postgres cross-org / cross-user isolation for
 * the Findings saved-views store (ERIP §1). A saved view is scoped to (org, user):
 * the route reads/deletes with `WHERE organization_id = $org AND user_id = $user`.
 * These tests exercise those exact predicates against real Postgres so a view can
 * never be read or deleted across an org OR across users within an org.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;

async function seedView(orgId: string, userId: string, name: string, filters: object) {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO finding_saved_views (organization_id, user_id, name, filters)
     VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
    [orgId, userId, name, JSON.stringify(filters)]
  );
  return r.rows[0].id;
}

// The route's list/delete predicate — the thing under test.
async function listFor(orgId: string, userId: string) {
  return (
    await pool.query(
      `SELECT id, name FROM finding_saved_views WHERE organization_id = $1 AND user_id = $2 ORDER BY name`,
      [orgId, userId]
    )
  ).rows;
}
async function deleteFor(orgId: string, userId: string, id: string) {
  return (
    await pool.query(
      `DELETE FROM finding_saved_views WHERE id = $1 AND organization_id = $2 AND user_id = $3 RETURNING id`,
      [id, orgId, userId]
    )
  ).rowCount;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the finding-saved-views test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("finding_saved_views — cross-org / cross-user isolation (real Postgres)", () => {
  it("lists only the caller's own views within their org", async () => {
    const uA = await seedUser(pool, seed.orgA.id, {});
    const uA2 = await seedUser(pool, seed.orgA.id, {});
    const uB = await seedUser(pool, seed.orgB.id, {});
    const vA = await seedView(seed.orgA.id, uA.id, "Critical open", { severity: "Critical", status: "open" });
    await seedView(seed.orgA.id, uA2.id, "Another user view", { status: "open" });
    await seedView(seed.orgB.id, uB.id, "Org B view", { status: "open" });

    const listA = await listFor(seed.orgA.id, uA.id);
    expect(listA.map((r) => r.id)).toEqual([vA]); // not uA2's, not org B's
  });

  it("cannot delete another user's view (same org) or another org's view", async () => {
    const uA = await seedUser(pool, seed.orgA.id, {});
    const uA2 = await seedUser(pool, seed.orgA.id, {});
    const uB = await seedUser(pool, seed.orgB.id, {});
    const vA = await seedView(seed.orgA.id, uA.id, "Mine", { status: "open" });

    // wrong user, same org → no delete
    expect(await deleteFor(seed.orgA.id, uA2.id, vA)).toBe(0);
    // wrong org → no delete
    expect(await deleteFor(seed.orgB.id, uB.id, vA)).toBe(0);
    // still present for the owner
    expect((await listFor(seed.orgA.id, uA.id)).map((r) => r.id)).toEqual([vA]);
    // owner can delete
    expect(await deleteFor(seed.orgA.id, uA.id, vA)).toBe(1);
  });

  it("enforces the (org,user,name) unique constraint", async () => {
    const uA = await seedUser(pool, seed.orgA.id, {});
    await seedView(seed.orgA.id, uA.id, "Dupe", { status: "open" });
    await expect(seedView(seed.orgA.id, uA.id, "Dupe", { status: "closed" })).rejects.toThrow();
  });
});
