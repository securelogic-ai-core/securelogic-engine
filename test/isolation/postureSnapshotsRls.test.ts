/**
 * postureSnapshotsRls.test.ts — A04-G1 Batch A.1: DB-layer RLS enforcement on
 * `posture_snapshots` (migration 20260620_batch_a1_rls_policies.sql).
 *
 * Certifies cross-org isolation for `posture_snapshots` at the database layer.
 * The γ.2 wrap PR (postureTenantWrap.test.ts) proved the posture route family
 * sets the GUC and runs in a per-request transaction, but deferred RLS
 * certification to Batch A — its cross-org checks were WHERE-clause assertions,
 * not DB-enforced. Here the policy filters at the engine level: an unfiltered
 * read only returns the scoped org's snapshots, and an UPDATE/DELETE aimed at
 * another org's snapshot affects zero rows.
 *
 * Why no app_request password is needed — see findingsRls.test.ts. The harness
 * DB connects as the Postgres superuser, which can `SET ROLE app_request`
 * without the role's password. The role and the policy both exist because
 * bootstrapTestDb applies the full migration set.
 *
 * Mechanics: every scoped assertion runs inside BEGIN … ROLLBACK with
 * `SET LOCAL ROLE app_request` and a tx-local GUC via set_config(…, true).
 * ROLLBACK reverts both. NB posture_snapshots has UNIQUE (organization_id,
 * snapshot_date) — the seed rows use '2026-01-01', so positive-write and
 * WITH CHECK cases insert distinct dates to avoid a spurious unique collision.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  bootstrapTestDb,
  seedPostureSnapshot,
  type TestDbSeed,
} from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let snapshotA: string;
let snapshotB: string;

beforeAll(async () => {
  // Drops + applies the full migration set (creates app_request, enables RLS on
  // posture_snapshots via the Batch A.1 migration) + seeds the two orgs.
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set for the posture_snapshots RLS test.",
    );
  }
  pool = new Pool({ connectionString: url, ssl: false });

  // Seed one snapshot per org as the owner (RLS bypassed for seeding). Both at
  // the default '2026-01-01' — distinct orgs, so the unique constraint is fine.
  snapshotA = await seedPostureSnapshot(pool, seed.orgA.id);
  snapshotB = await seedPostureSnapshot(pool, seed.orgB.id);
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("A04-G1 Batch A.1 — posture_snapshots RLS enforcement", () => {
  it("app_request scoped to org A cannot see org B's snapshots, and sees its own", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [
        seed.orgA.id,
      ]);

      // Even an explicit WHERE for org B returns nothing — the policy filters first.
      const crossOrg = await client.query(
        "SELECT id FROM posture_snapshots WHERE organization_id = $1",
        [seed.orgB.id],
      );
      expect(crossOrg.rowCount).toBe(0);

      // Positive control: an unfiltered read returns ONLY org A's row.
      const visible = await client.query("SELECT id FROM posture_snapshots");
      const ids = visible.rows.map((r) => r.id);
      expect(ids).toContain(snapshotA);
      expect(ids).not.toContain(snapshotB);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A can INSERT a snapshot for org A and read it back (positive write)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [
        seed.orgA.id,
      ]);

      // Distinct snapshot_date from the seed row to avoid the unique constraint.
      const inserted = await client.query(
        `INSERT INTO posture_snapshots (organization_id, snapshot_date, overall_score)
         VALUES ($1, '2026-02-02', 60) RETURNING id`,
        [seed.orgA.id],
      );
      expect(inserted.rowCount).toBe(1);
      const newId = inserted.rows[0].id as string;

      const readBack = await client.query(
        "SELECT id FROM posture_snapshots WHERE id = $1",
        [newId],
      );
      expect(readBack.rowCount).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org B cannot UPDATE or DELETE org A's snapshot (rowCount 0, DB-enforced)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [
        seed.orgB.id,
      ]);

      const upd = await client.query(
        "UPDATE posture_snapshots SET overall_score = 1 WHERE id = $1",
        [snapshotA],
      );
      expect(upd.rowCount).toBe(0);

      const del = await client.query(
        "DELETE FROM posture_snapshots WHERE id = $1",
        [snapshotA],
      );
      expect(del.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an UNSET org GUC sees zero snapshots (fail-closed default)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      // Deliberately do NOT set app.current_org_id.
      const res = await client.query("SELECT id FROM posture_snapshots");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request with an EMPTY-STRING org GUC sees zero snapshots (NULLIF fail-closed, never permissive)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', '', true)");

      const res = await client.query("SELECT id FROM posture_snapshots");
      expect(res.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("app_request scoped to org A cannot INSERT a snapshot stamped for org B (WITH CHECK)", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [
        seed.orgA.id,
      ]);

      await expect(
        client.query(
          `INSERT INTO posture_snapshots (organization_id, snapshot_date, overall_score)
           VALUES ($1, '2026-03-03', 60)`,
          [seed.orgB.id],
        ),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });

  it("the owner connection bypasses RLS (regression — sees all orgs' snapshots)", async () => {
    const res = await pool.query("SELECT id FROM posture_snapshots");
    const ids = res.rows.map((r) => r.id);
    expect(ids).toContain(snapshotA);
    expect(ids).toContain(snapshotB);
  });
});
