/**
 * findingClosureSod.test.ts — org-enforced separation of duties on finding
 * closure (spec §7; migration 20260902; machine gate in
 * findingLifecycleMachine.evaluateFindingDecisionTransition).
 *
 * Proves over the REAL app (decision writes are flag-gated, so the flag is
 * set for this suite and restored after):
 *   1. an SoD-enforcing org rejects an unidentified (API-key-only) closer
 *      with 409 actor_identity_required — policy + wiring resolved in-route;
 *   2. a non-enforcing org (default) closes exactly as before;
 *   3. the policy is org-scoped: org A's enforcement never affects org B.
 *
 * The remediator≠closer path needs a JWT session identity and is covered by
 * the machine unit tests (findingLifecycle.test.ts, SoD matrix).
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

async function remediatedFinding(orgId: string): Promise<string> {
  const findingId = await seedFinding(pool, orgId);
  await pool.query(
    `INSERT INTO actions (organization_id, title, source_type, source_id, priority, status)
     VALUES ($1, 'sod remediation', 'finding', $2, 'planned', 'closed')`,
    [orgId, findingId]
  );
  // Derive remediated through the real single writer.
  const { withTenant } = await import("../../src/api/infra/postgres.js");
  const { recomputeFindingOperationalStatus } = await import("../../src/api/lib/findingLifecycle.js");
  await withTenant(orgId, async () => {
    await recomputeFindingOperationalStatus(orgId, findingId, {
      actorUserId: null,
      actorApiKeyId: null,
    });
  });
  return findingId;
}

const close = (key: string, findingId: string) =>
  request(app)
    .patch(`/api/findings/${findingId}`)
    .set("X-Api-Key", key)
    .send({ decision_state: "resolved" });

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the closure SoD test.");
  pool = new Pool({ connectionString: url, ssl: false });

  priorFlag = process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED;
  process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED = "true";

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });

  // Org A enforces closure SoD; org B stays at the default (off).
  await pool.query(
    `INSERT INTO risk_settings (organization_id, cadence_by_rating, require_finding_closure_sod)
     VALUES ($1, '{}'::jsonb, TRUE)
     ON CONFLICT (organization_id) DO UPDATE SET require_finding_closure_sod = TRUE`,
    [seed.orgA.id]
  );
}, 120_000);

afterAll(async () => {
  if (priorFlag === undefined) delete process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED;
  else process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED = priorFlag;
  await pool?.end();
});

describe("finding closure separation of duties (org-enforced)", () => {
  it("enforcing org: an unidentified closer is refused (409 actor_identity_required)", async () => {
    const findingId = await remediatedFinding(seed.orgA.id);
    const res = await close(seed.orgA.apiKey, findingId);
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("actor_identity_required");

    // And the finding is untouched.
    const row = await pool.query(`SELECT decision_state FROM findings WHERE id = $1`, [findingId]);
    expect(row.rows[0].decision_state).toBe("needs_review");
  });

  it("non-enforcing org (default): closes exactly as before", async () => {
    const findingId = await remediatedFinding(seed.orgB.id);
    const res = await close(seed.orgB.apiKey, findingId);
    expect(res.status).toBe(200);
    expect(res.body.finding.decision_state).toBe("resolved");
  });

  it("non-close transitions are unaffected by enforcement", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id);
    const res = await request(app)
      .patch(`/api/findings/${findingId}`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ decision_state: "mitigating" });
    expect(res.status).toBe(200);
    expect(res.body.finding.decision_state).toBe("mitigating");
  });
});
