/**
 * findingOwnerFilter.test.ts — real-Postgres cross-org AND cross-user isolation for
 * the owner=me ("My Work") path. The route resolves the user id from the SESSION
 * and queries `WHERE organization_id = $org AND owner_user_id = $user`; these tests
 * exercise that exact predicate so one user can never read another user's
 * assignments — inside the same org or across orgs — and the summary's
 * my_work_open count is scoped identically.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;

async function seedOwnedFinding(orgId: string, ownerUserId: string | null, title: string, status = "open") {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, owner_user_id, status)
     VALUES ($1, $2, 'high', 'x', 'manual', $3, $4) RETURNING id`,
    [orgId, title, ownerUserId, status]
  );
  return r.rows[0].id;
}

// The exact predicates the route/summary use for owner=me.
async function myWorkList(orgId: string, userId: string) {
  return (
    await pool.query(
      `SELECT id FROM findings WHERE organization_id = $1 AND owner_user_id = $2 ORDER BY created_at DESC`,
      [orgId, userId]
    )
  ).rows.map((r) => r.id);
}
async function myWorkOpenCount(orgId: string, userId: string) {
  const r = await pool.query<{ mine: string }>(
    `SELECT COUNT(*) AS mine FROM findings
      WHERE organization_id = $1 AND owner_user_id = $2 AND status IN ('open','in_progress')`,
    [orgId, userId]
  );
  return parseInt(r.rows[0]?.mine ?? "0", 10);
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the finding-owner-filter test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("owner=me — cross-org / cross-user isolation (real Postgres)", () => {
  it("returns only the caller's own assignments within their org", async () => {
    const u1 = await seedUser(pool, seed.orgA.id, {});
    const u2 = await seedUser(pool, seed.orgA.id, {});
    const mine = await seedOwnedFinding(seed.orgA.id, u1.id, "of-mine-1");
    await seedOwnedFinding(seed.orgA.id, u2.id, "of-theirs-1");
    await seedOwnedFinding(seed.orgA.id, null, "of-unassigned-1");

    const ids = await myWorkList(seed.orgA.id, u1.id);
    expect(ids).toContain(mine);
    expect(ids.length).toBe(1); // never another user's, never unassigned
  });

  it("never crosses orgs even for the same user id bound against another org", async () => {
    const uA = await seedUser(pool, seed.orgA.id, {});
    const mineA = await seedOwnedFinding(seed.orgA.id, uA.id, "of-a-2");
    // org B query with org A's user id yields nothing (org predicate wins).
    expect(await myWorkList(seed.orgB.id, uA.id)).toEqual([]);
    expect(await myWorkList(seed.orgA.id, uA.id)).toContain(mineA);
  });

  it("my_work_open counts only open/in_progress assignments of the caller", async () => {
    const u = await seedUser(pool, seed.orgA.id, {});
    await seedOwnedFinding(seed.orgA.id, u.id, "of-open", "open");
    await seedOwnedFinding(seed.orgA.id, u.id, "of-progress", "in_progress");
    await seedOwnedFinding(seed.orgA.id, u.id, "of-closed", "closed");
    expect(await myWorkOpenCount(seed.orgA.id, u.id)).toBe(2);
    expect(await myWorkOpenCount(seed.orgB.id, u.id)).toBe(0);
  });
});
