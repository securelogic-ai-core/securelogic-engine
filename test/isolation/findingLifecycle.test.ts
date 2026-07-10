/**
 * findingLifecycle.test.ts — finding two-axis lifecycle (C6) DB-layer proofs.
 *
 * Covers what the pure unit tests cannot: the 20260901 migration artifacts and
 * the in-transaction appliers of src/api/lib/findingLifecycle.ts.
 *
 *  1. Child→parent cascade (spec §5): recomputeFindingOperationalStatus derives
 *     the parent from its Actions and appends a finding_lifecycle_events row in
 *     the SAME transaction.
 *  2. Cross-org safety: a recompute for org B with org A's finding id writes
 *     nothing (org scoping is in every statement).
 *  3. finding_lifecycle_events is append-only (UPDATE/DELETE/TRUNCATE forbidden)
 *     and RLS-scoped for app_request.
 *  4. Migration backfill/constraints: operational_status CHECK values and the
 *     ratified decision_state CHECK (no 'in_progress').
 *
 * The appliers use the ambient `pg` (AsyncLocalStorage tenant routing); here we
 * run them through withTenant() exactly as asTenant() does in production, so
 * the "same transaction" claim is what is actually proven.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedFinding, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import {
  recomputeFindingOperationalStatus,
} from "../../src/api/lib/findingLifecycle.js";

let seed: TestDbSeed;
let pool: Pool;

const ACTOR = { actorUserId: null, actorApiKeyId: null };

async function seedAction(
  orgId: string,
  findingId: string,
  status: string
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `INSERT INTO actions (organization_id, title, source_type, source_id, priority, status)
     VALUES ($1, 'Harness remediation', 'finding', $2, 'planned', $3)
     RETURNING id`,
    [orgId, findingId, status]
  );
  return res.rows[0].id;
}

async function opStatus(findingId: string): Promise<string> {
  const r = await pool.query(
    `SELECT operational_status FROM findings WHERE id = $1`,
    [findingId]
  );
  return String(r.rows[0].operational_status);
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the finding lifecycle test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("finding lifecycle C6 — derived operational axis", () => {
  it("cascades action status → parent operational_status with lifecycle events (spec §5)", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id);
    expect(await opStatus(findingId)).toBe("open");

    const actionId = await seedAction(seed.orgA.id, findingId, "open");

    // Action starts → parent derives in_progress.
    await pool.query(`UPDATE actions SET status = 'in_progress' WHERE id = $1`, [actionId]);
    await withTenant(seed.orgA.id, async () => {
      const r = await recomputeFindingOperationalStatus(seed.orgA.id, findingId, ACTOR);
      expect(r).toMatchObject({ changed: true, fromState: "open", toState: "in_progress" });
      expect(r.auditEvent).toBe("finding.operational.advanced");
    });
    expect(await opStatus(findingId)).toBe("in_progress");

    // Last action terminal → remediated.
    await pool.query(`UPDATE actions SET status = 'closed' WHERE id = $1`, [actionId]);
    await withTenant(seed.orgA.id, async () => {
      const r = await recomputeFindingOperationalStatus(seed.orgA.id, findingId, ACTOR);
      expect(r).toMatchObject({ changed: true, toState: "remediated" });
      expect(r.auditEvent).toBe("finding.remediated");
    });
    expect(await opStatus(findingId)).toBe("remediated");

    // New work added → regresses (pure recompute, spec §4 "recomputed").
    await seedAction(seed.orgA.id, findingId, "open");
    await withTenant(seed.orgA.id, async () => {
      const r = await recomputeFindingOperationalStatus(seed.orgA.id, findingId, ACTOR);
      expect(r).toMatchObject({ changed: true, fromState: "remediated", toState: "open" });
      expect(r.auditEvent).toBe("finding.operational.recomputed");
    });

    // Idempotent: recompute with no change writes nothing.
    await withTenant(seed.orgA.id, async () => {
      const r = await recomputeFindingOperationalStatus(seed.orgA.id, findingId, ACTOR);
      expect(r.changed).toBe(false);
    });

    // The event stream recorded exactly the three transitions, in order.
    const events = await pool.query(
      `SELECT axis, from_state, to_state, transition
         FROM finding_lifecycle_events
        WHERE organization_id = $1 AND finding_id = $2
        ORDER BY created_at ASC, id ASC`,
      [seed.orgA.id, findingId]
    );
    expect(events.rows).toEqual([
      { axis: "operational", from_state: "open", to_state: "in_progress", transition: "operational_advanced" },
      { axis: "operational", from_state: "in_progress", to_state: "remediated", transition: "operational_remediated" },
      { axis: "operational", from_state: "remediated", to_state: "open", transition: "operational_recomputed" },
    ]);
  });

  it("never moves a foreign org's finding (cross-org recompute is a no-op)", async () => {
    const findingA = await seedFinding(pool, seed.orgA.id);
    await seedAction(seed.orgA.id, findingA, "closed");

    // Org B attempts the recompute with org A's finding id.
    await withTenant(seed.orgB.id, async () => {
      const r = await recomputeFindingOperationalStatus(seed.orgB.id, findingA, ACTOR);
      expect(r.changed).toBe(false);
    });
    expect(await opStatus(findingA)).toBe("open"); // untouched

    const events = await pool.query(
      `SELECT COUNT(*)::int AS n FROM finding_lifecycle_events WHERE finding_id = $1`,
      [findingA]
    );
    expect(events.rows[0].n).toBe(0);
  });

  it("cross-org actions never count toward another org's derivation", async () => {
    const findingA = await seedFinding(pool, seed.orgA.id);
    // An org-B action that (maliciously/erroneously) points at org A's finding.
    await seedAction(seed.orgB.id, findingA, "closed");

    await withTenant(seed.orgA.id, async () => {
      const r = await recomputeFindingOperationalStatus(seed.orgA.id, findingA, ACTOR);
      // Org A sees no linked actions of its own → stays open, no event.
      expect(r.changed).toBe(false);
    });
    expect(await opStatus(findingA)).toBe("open");
  });
});

describe("finding_lifecycle_events — append-only + RLS", () => {
  it("forbids UPDATE, DELETE and TRUNCATE regardless of role", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id);
    await seedAction(seed.orgA.id, findingId, "in_progress");
    await withTenant(seed.orgA.id, async () => {
      await recomputeFindingOperationalStatus(seed.orgA.id, findingId, ACTOR);
    });

    await expect(
      pool.query(`UPDATE finding_lifecycle_events SET comment = 'tamper' WHERE finding_id = $1`, [findingId])
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query(`DELETE FROM finding_lifecycle_events WHERE finding_id = $1`, [findingId])
    ).rejects.toThrow(/append-only/);
    await expect(pool.query(`TRUNCATE finding_lifecycle_events`)).rejects.toThrow(/append-only/);
  });

  it("RLS scopes app_request reads to the GUC org", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id);
    await seedAction(seed.orgA.id, findingId, "in_progress");
    await withTenant(seed.orgA.id, async () => {
      await recomputeFindingOperationalStatus(seed.orgA.id, findingId, ACTOR);
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);
      const crossOrg = await client.query(
        `SELECT id FROM finding_lifecycle_events WHERE finding_id = $1`,
        [findingId]
      );
      expect(crossOrg.rowCount).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});

describe("evidence gate (spec §1.1) — org-enforced remediation evidence", () => {
  it("gate-enforcing org: terminal actions hold at in_progress until evidence attaches, then remediate", async () => {
    // Org B enforces the evidence gate (same policy object as the Risk lifecycle).
    await pool.query(
      `INSERT INTO risk_settings (organization_id, cadence_by_rating, require_evidence_gate)
       VALUES ($1, '{}'::jsonb, TRUE)
       ON CONFLICT (organization_id) DO UPDATE SET require_evidence_gate = TRUE`,
      [seed.orgB.id]
    );

    const findingId = await seedFinding(pool, seed.orgB.id);
    const actionId = await seedAction(seed.orgB.id, findingId, "in_progress");

    await withTenant(seed.orgB.id, async () => {
      await recomputeFindingOperationalStatus(seed.orgB.id, findingId, ACTOR);
    });
    expect(await opStatus(findingId)).toBe("in_progress");

    // All work terminal, but NO evidence: the gate holds it at in_progress —
    // validation (ready-for-decision) must not be offered without evidence.
    await pool.query(`UPDATE actions SET status = 'closed' WHERE id = $1`, [actionId]);
    await withTenant(seed.orgB.id, async () => {
      const r = await recomputeFindingOperationalStatus(seed.orgB.id, findingId, ACTOR);
      expect(r.changed).toBe(false);
    });
    expect(await opStatus(findingId)).toBe("in_progress");

    // Evidence attaches → recompute advances to remediated.
    await pool.query(
      `INSERT INTO evidence (organization_id, source_type, source_id, title, evidence_type)
       VALUES ($1, 'finding', $2, 'patch-validation.pdf', 'document')`,
      [seed.orgB.id, findingId]
    );
    await withTenant(seed.orgB.id, async () => {
      const r = await recomputeFindingOperationalStatus(seed.orgB.id, findingId, ACTOR);
      expect(r).toMatchObject({ changed: true, toState: "remediated" });
      expect(r.auditEvent).toBe("finding.remediated");
    });
    expect(await opStatus(findingId)).toBe("remediated");
  });

  it("non-enforcing org (default): remediates without evidence — behaviour unchanged", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id);
    const actionId = await seedAction(seed.orgA.id, findingId, "in_progress");
    await pool.query(`UPDATE actions SET status = 'closed' WHERE id = $1`, [actionId]);
    await withTenant(seed.orgA.id, async () => {
      const r = await recomputeFindingOperationalStatus(seed.orgA.id, findingId, ACTOR);
      expect(r).toMatchObject({ changed: true, toState: "remediated" });
    });
  });
});

describe("20260901 migration constraints", () => {
  it("rejects hand-set garbage operational_status (CHECK)", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id);
    await expect(
      pool.query(`UPDATE findings SET operational_status = 'closed' WHERE id = $1`, [findingId])
    ).rejects.toThrow(/findings_operational_status_check/);
  });

  it("rejects the removed 'in_progress' decision_state (ratified set only)", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id);
    await expect(
      pool.query(`UPDATE findings SET decision_state = 'in_progress' WHERE id = $1`, [findingId])
    ).rejects.toThrow(/findings_decision_state_check/);
  });
});
