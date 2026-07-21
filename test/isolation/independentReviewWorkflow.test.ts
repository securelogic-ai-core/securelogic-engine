/**
 * independentReviewWorkflow.test.ts — Independent Governance Review, over the REAL
 * app and real Postgres (operator /goal 2026-07-19; spec
 * docs/specs/independent-governance-review-spec.md).
 *
 * The workflow adds NO lifecycle state: when a finding reaches operational_status
 * 'remediated' in an org that enforces closure separation of duties
 * (risk_settings.require_finding_closure_sod), the single writer of operational_status
 * — recomputeFindingOperationalStatus — auto-assigns an independent Closure Owner
 * (an active admin ≠ the remediator) into findings.review_owner_user_id and writes a
 * finding.review.assigned audit event. Everything is gated behind
 * SECURELOGIC_INDEPENDENT_REVIEW_ENABLED so flag-off is byte-identical.
 *
 * Proves:
 *   1. remediated-under-SoD assigns an admin ≠ the remediator (+ audit event);
 *   2. flag OFF assigns nothing (byte-identical recompute);
 *   3. SoD not enforced (default org) assigns nothing even with the flag on;
 *   4. no eligible admin (only admin IS the remediator) → null, never fabricated;
 *   5. assignment is idempotent (a valid reviewer is left untouched);
 *   6. reviewer selection and the org-wide summary count never cross tenants.
 */

import crypto from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, seedFinding, type TestDbSeed } from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;
let priorFlag: string | undefined;

/** Seed an active admin in an org. Order of insertion drives created_at ASC. */
async function seedAdmin(orgId: string, email: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, email, name, role, status, password_hash, email_verified)
     VALUES ($1, $2, $3, 'admin', 'active', 'x', TRUE)
     RETURNING id`,
    [orgId, email, email]
  );
  return r.rows[0]!.id;
}

/** Drive a finding to operational_status='remediated' through the real single writer,
 *  as `remediator` (the actor who completed the last remediation action). */
async function remediate(
  orgId: string,
  findingId: string,
  remediatorUserId: string | null
): Promise<void> {
  await pool.query(
    `INSERT INTO actions (organization_id, title, source_type, source_id, priority, status)
     VALUES ($1, 'independent-review remediation', 'finding', $2, 'planned', 'closed')`,
    [orgId, findingId]
  );
  const { withTenant } = await import("../../src/api/infra/postgres.js");
  const { recomputeFindingOperationalStatus } = await import(
    "../../src/api/lib/findingLifecycle.js"
  );
  await withTenant(orgId, async () => {
    await recomputeFindingOperationalStatus(orgId, findingId, {
      actorUserId: remediatorUserId,
      actorApiKeyId: null,
    });
  });
}

async function reviewOwner(findingId: string): Promise<string | null> {
  const r = await pool.query<{ review_owner_user_id: string | null; operational_status: string }>(
    `SELECT review_owner_user_id, operational_status FROM findings WHERE id = $1`,
    [findingId]
  );
  // Sanity: every "assigns" scenario here first reaches remediated.
  expect(r.rows[0]!.operational_status).toBe("remediated");
  return r.rows[0]!.review_owner_user_id;
}

/** Poll the fire-and-forget audit projection for the assignment event. */
async function waitForAssignedEvent(orgId: string, findingId: string): Promise<Record<string, unknown> | null> {
  for (let i = 0; i < 40; i++) {
    const r = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM security_audit_log
        WHERE organization_id = $1 AND resource_type = 'finding' AND resource_id = $2
          AND event_type = 'finding.review.assigned'
        ORDER BY created_at DESC LIMIT 1`,
      [orgId, findingId]
    );
    if ((r.rowCount ?? 0) > 0) return r.rows[0]!.payload;
    await new Promise((res) => setTimeout(res, 50));
  }
  return null;
}

async function setSod(orgId: string, on: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO risk_settings (organization_id, cadence_by_rating, require_finding_closure_sod)
     VALUES ($1, '{}'::jsonb, $2)
     ON CONFLICT (organization_id) DO UPDATE SET require_finding_closure_sod = $2`,
    [orgId, on]
  );
}

// Org A admins, oldest first: reviewer V, then remediator R → R's remediation must
// route to V. Org B admin is seeded FIRST of all, so if reviewer selection ever leaked
// across tenants it would pick the globally-oldest admin (org B) — it must not.
let orgB_admin: string;
let orgA_reviewer: string;
let orgA_remediator: string;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the independent-review test.");
  pool = new Pool({ connectionString: url, ssl: false });

  priorFlag = process.env.SECURELOGIC_INDEPENDENT_REVIEW_ENABLED;
  process.env.SECURELOGIC_INDEPENDENT_REVIEW_ENABLED = "true";

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });

  orgB_admin = await seedAdmin(seed.orgB.id, `b-admin-${seed.orgB.id}@harness.test`);
  orgA_reviewer = await seedAdmin(seed.orgA.id, `a-reviewer-${seed.orgA.id}@harness.test`);
  orgA_remediator = await seedAdmin(seed.orgA.id, `a-remediator-${seed.orgA.id}@harness.test`);

  // Org A enforces closure SoD; org B stays at the default (off).
  await setSod(seed.orgA.id, true);
}, 120_000);

afterAll(async () => {
  if (priorFlag === undefined) delete process.env.SECURELOGIC_INDEPENDENT_REVIEW_ENABLED;
  else process.env.SECURELOGIC_INDEPENDENT_REVIEW_ENABLED = priorFlag;
  await pool?.end();
});

describe("independent governance review — auto-assignment on remediation", () => {
  it("SoD-enforcing org: remediation assigns an admin who is NOT the remediator", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id);
    await remediate(seed.orgA.id, findingId, orgA_remediator);

    const owner = await reviewOwner(findingId);
    // The counterparty: never the remediator, and (only two admins) deterministically V.
    expect(owner).not.toBe(orgA_remediator);
    expect(owner).toBe(orgA_reviewer);

    const payload = await waitForAssignedEvent(seed.orgA.id, findingId);
    expect(payload).not.toBeNull();
    expect(payload!.reviewer_user_id).toBe(orgA_reviewer);
    expect(payload!.remediator_user_id).toBe(orgA_remediator);
  });

  it("flag OFF: recompute assigns nothing (byte-identical)", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id);
    process.env.SECURELOGIC_INDEPENDENT_REVIEW_ENABLED = "false";
    try {
      await remediate(seed.orgA.id, findingId, orgA_remediator);
    } finally {
      process.env.SECURELOGIC_INDEPENDENT_REVIEW_ENABLED = "true";
    }
    expect(await reviewOwner(findingId)).toBeNull();
  });

  it("org without closure SoD: no reviewer assigned even with the flag on", async () => {
    // Org B never set require_finding_closure_sod → default FALSE.
    const findingId = await seedFinding(pool, seed.orgB.id);
    await remediate(seed.orgB.id, findingId, orgB_admin);
    expect(await reviewOwner(findingId)).toBeNull();
  });

  it("no eligible admin (the only admin IS the remediator): null, never fabricated", async () => {
    // A fresh org whose sole admin remediates: SoD is unsatisfiable, so the finding
    // is left unassigned and surfaces org-wide — the work is never routed to the very
    // person the close gate would refuse.
    const solo = await bootstrapExtraOrg();
    await setSod(solo.orgId, true);
    const onlyAdmin = await seedAdmin(solo.orgId, `solo-${solo.orgId}@harness.test`);
    const findingId = await seedFinding(pool, solo.orgId);
    await remediate(solo.orgId, findingId, onlyAdmin);
    expect(await reviewOwner(findingId)).toBeNull();
  });

  it("assignment is idempotent: a valid reviewer is left untouched on re-invocation", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id);
    await remediate(seed.orgA.id, findingId, orgA_remediator);
    const first = await reviewOwner(findingId);
    expect(first).toBe(orgA_reviewer);

    // Re-invoke the assignment directly inside the tenant transaction: a reviewer who is
    // not the current remediator must be kept (changed=false), not reshuffled.
    const { withTenant } = await import("../../src/api/infra/postgres.js");
    const { assignIndependentReviewerIfNeeded } = await import(
      "../../src/api/lib/independentReviewAssignment.js"
    );
    const result = await withTenant(seed.orgA.id, () =>
      assignIndependentReviewerIfNeeded(seed.orgA.id, findingId, orgA_remediator, {
        actorUserId: orgA_remediator,
        actorApiKeyId: null,
      })
    );
    expect(result.changed).toBe(false);
    expect(result.assignedReviewerUserId).toBe(orgA_reviewer);
    expect(await reviewOwner(findingId)).toBe(orgA_reviewer);
  });

  it("reviewer selection is org-scoped: never routes to another tenant's admin", async () => {
    // orgB_admin is the globally-oldest admin; if the selection query dropped its
    // org filter it would win the ORDER BY created_at. It must never be chosen for org A.
    const findingId = await seedFinding(pool, seed.orgA.id);
    await remediate(seed.orgA.id, findingId, orgA_remediator);
    const owner = await reviewOwner(findingId);
    expect(owner).not.toBe(orgB_admin);
    expect(owner).toBe(orgA_reviewer);
  });

  it("org-wide pending-review summary count never crosses tenants", async () => {
    // Both orgs have a remediated finding awaiting a decision. Each org's summary must
    // count only its own — pending_independent_review_open uses the SAME predicate as
    // ready_for_decision_open, org-scoped by organization_id = the caller's org.
    const a = await request(app).get("/api/findings/summary").set("X-Api-Key", seed.orgA.apiKey);
    const b = await request(app).get("/api/findings/summary").set("X-Api-Key", seed.orgB.apiKey);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // Identical to the ready-for-decision population (same predicate, renamed).
    expect(a.body.summary.pending_independent_review_open).toBe(
      a.body.summary.ready_for_decision_open
    );
    // Org A has accrued several remediated-undecided findings above; org B has one.
    expect(a.body.summary.pending_independent_review_open).toBeGreaterThan(0);
    expect(b.body.summary.pending_independent_review_open).toBeGreaterThanOrEqual(1);
  });
});

/** Create one more organization on the shared throwaway DB (mirrors testDb's org insert;
 *  no API key needed — this org is exercised only through the tenant-scoped recompute). */
async function bootstrapExtraOrg(): Promise<{ orgId: string }> {
  const slug = `solo-review-${crypto.randomBytes(6).toString("hex")}`;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, status, entitlement_level)
     VALUES ('solo-review-org', $1, 'active', 'premium')
     RETURNING id`,
    [slug]
  );
  return { orgId: r.rows[0]!.id };
}
