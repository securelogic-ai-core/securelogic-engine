/**
 * seedWalkthroughTeardown.test.ts — the walkthrough seed is re-seedable AFTER the
 * accepted-risk lifecycle has actually been exercised, and its teardown cannot reach
 * another tenant.
 *
 * WHY THIS TEST EXISTS
 *   finding_risk_acceptances.finding_id is ON DELETE RESTRICT (deliberately — a
 *   governed acceptance must BLOCK deletion of the Finding it governs). The seed's
 *   teardown deletes findings. So the moment a walkthrough proposes or approves an
 *   acceptance — i.e. the moment the org is used for the thing it exists to validate
 *   — teardown RAISEs and the tenant becomes permanently un-reseedable. That FK is
 *   correct and is NOT changed; teardown clears acceptances first instead.
 *
 *   Before the fix, step 3 below fails with:
 *     update or delete on table "findings" violates foreign key constraint
 *     finding_risk_acceptances_finding_id_fkey
 *
 * Proves, in order:
 *   1. the seed tenant is created, with two usable proposer/approver logins;
 *   2. an accepted-risk record is exercised (propose → approve, real API, real SoD);
 *   3. teardown succeeds;
 *   4. every seeded row for that tenant is gone;
 *   5. a second tenant's rows — including its own risk acceptance — are untouched.
 *
 * NOT in scope: the tenant-offboarding / GDPR-erasure defect. `DELETE FROM
 * organizations` still RAISEs through the WORM triggers on FK cascade. That is a
 * separate, unresolved platform defect; this teardown is an explicitly-invoked
 * validation path, not an offboarding path, and must not be mistaken for one.
 */

process.env.JWT_SECRET ??= "test-jwt-secret-for-walkthrough-teardown";
process.env.SECURELOGIC_RISK_ACCEPTANCE_ENABLED = "true";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool, type PoolClient } from "pg";
import argon2 from "argon2";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { signJwt } from "../../src/api/lib/jwt.js";
import { recordAllCurrentConsents } from "../../src/api/lib/legalConsent.js";
import {
  ANALYST_EMAIL,
  APPROVER_EMAIL,
  WALKTHROUGH_SLUG,
  ensureWalkthroughOrg,
  seed,
  teardown,
} from "../../scripts/validation/seed-walkthrough-org.js";

let app: Express;
let dbSeed: TestDbSeed;
let pool: Pool;

let walkthroughOrgId = "";
let proposerId = "";
let approverId = "";
let jwtProposer = "";
let jwtApprover = "";

/** The other tenant — nothing the teardown does may touch it. */
let otherOrgId = "";
let otherFindingId = "";
let otherAcceptanceId = "";
let otherUserA = "";
let otherUserB = "";

const auth = (path: string, jwt: string) =>
  request(app).post(path).set("Authorization", `Bearer ${jwt}`);

/** Tables the seed writes that must be empty for the torn-down org afterwards. */
const SEEDED_TABLES = [
  "users",
  "api_keys",
  "vendors",
  "vendor_assessments",
  "dependencies",
  "assets",
  "enterprise_relationships",
  "enterprise_entities",
  "endpoints",
  "ai_systems",
  "ai_system_vendor_dependencies",
  "frameworks",
  "controls",
  "obligations",
  "control_assessments",
  "cyber_signals",
  "signal_match_suggestions",
  "findings",
  "finding_risk_acceptances",
  "finding_lifecycle_events",
  "finding_review_marks",
  "evidence",
  "actions",
  "security_audit_log",
  "risk_settings",
] as const;

async function countFor(table: string, orgId: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM ${table} WHERE organization_id = $1`,
    [orgId]
  );
  return Number(r.rows[0]?.n ?? 0);
}

/** Run one seed-script function inside its own transaction, as the script does. */
async function inTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

beforeAll(async () => {
  dbSeed = await bootstrapTestDb();
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });

  // ── The OTHER tenant: a full acceptance of its own, so we prove the teardown's
  //    new DELETE is org-scoped and does not clear acceptances platform-wide.
  otherOrgId = dbSeed.orgB.id;
  await pool.query(
    `UPDATE organizations SET entitlement_level = 'platform', require_mfa = FALSE WHERE id = $1`,
    [otherOrgId]
  );
  const hash = await argon2.hash("OtherTenant!Pw2026");
  const mkUser = async (email: string, role: string): Promise<string> => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO users (organization_id, email, name, role, status, password_hash, email_verified)
       VALUES ($1, $2, $3, $4, 'active', $5, TRUE) RETURNING id`,
      [otherOrgId, email, `Other ${role}`, role, hash]
    );
    return r.rows[0]!.id;
  };
  otherUserA = await mkUser(`other-proposer-${otherOrgId}@harness.test`, "member");
  otherUserB = await mkUser(`other-approver-${otherOrgId}@harness.test`, "admin");

  const f = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, status)
     VALUES ($1, 'Other tenant finding', 'High', 'must survive teardown', 'manual', 'open')
     RETURNING id`,
    [otherOrgId]
  );
  otherFindingId = f.rows[0]!.id;

  const a = await pool.query<{ id: string }>(
    `INSERT INTO finding_risk_acceptances
       (organization_id, finding_id, state, owner_user_id, rationale,
        requested_by_user_id, expires_at)
     VALUES ($1, $2, 'proposed', $3, 'other tenant acceptance', $3, CURRENT_DATE + 90)
     RETURNING id`,
    [otherOrgId, otherFindingId, otherUserA]
  );
  otherAcceptanceId = a.rows[0]!.id;
  void otherUserB;
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("walkthrough seed — teardown after the accepted-risk lifecycle", () => {
  it("1. creates the seed tenant with two usable proposer/approver logins", async () => {
    walkthroughOrgId = await inTx(async (c) => {
      const orgId = await ensureWalkthroughOrg(c);
      await c.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);
      await seed(c, orgId);
      return orgId;
    });

    const org = await pool.query<{ slug: string; entitlement_level: string }>(
      `SELECT slug, entitlement_level FROM organizations WHERE id = $1`,
      [walkthroughOrgId]
    );
    expect(org.rows[0]?.slug).toBe(WALKTHROUGH_SLUG);
    // 'platform' is what clears requireEntitlement("premium") on the acceptance routes.
    expect(org.rows[0]?.entitlement_level).toBe("platform");

    const users = await pool.query<{ id: string; email: string; role: string; password_hash: string }>(
      `SELECT id, email, role, password_hash FROM users
        WHERE organization_id = $1 AND email = ANY($2) ORDER BY email`,
      [walkthroughOrgId, [ANALYST_EMAIL, APPROVER_EMAIL]]
    );
    expect(users.rowCount).toBe(2);

    const proposer = users.rows.find((u) => u.email === ANALYST_EMAIL)!;
    const approver = users.rows.find((u) => u.email === APPROVER_EMAIL)!;
    proposerId = proposer.id;
    approverId = approver.id;

    // Least privilege: the proposer is NOT an admin. Neither role is gated by the
    // acceptance API — the separation is the two distinct identities.
    expect(proposer.role).toBe("member");
    expect(approver.role).toBe("admin");

    // The passwords actually verify. This is the whole point of the change: before it,
    // password_hash was NULL and neither user could log in at all.
    await expect(argon2.verify(proposer.password_hash, "Walkthrough!Seed2026")).resolves.toBe(true);
    await expect(argon2.verify(approver.password_hash, "Walkthrough!Seed2026")).resolves.toBe(true);

    // And the org has an ACTIVE api_keys row. Without it the JWT bridge in
    // requireApiKey.ts 401s `no_active_api_key` on every request and the passwords are
    // useless — a login that can't call the API is not a usable credential.
    const key = await pool.query(
      `SELECT id FROM api_keys WHERE organization_id = $1 AND status = 'active'`,
      [walkthroughOrgId]
    );
    expect(key.rowCount).toBe(1);

    // requireConsent gates every JWT session app-wide: without current consents each
    // request 403s with consent_required before it reaches an acceptance route.
    for (const uid of [proposerId, approverId]) {
      await recordAllCurrentConsents(pool, {
        userId: uid,
        organizationId: walkthroughOrgId,
        consentMethod: "admin_recorded",
      });
    }

    jwtProposer = signJwt(proposerId, walkthroughOrgId, "member");
    jwtApprover = signJwt(approverId, walkthroughOrgId, "admin");
  }, 120_000);

  it("2. exercises an accepted-risk record: propose → approve, with SoD enforced", async () => {
    const f = await pool.query<{ id: string }>(
      `SELECT id FROM findings WHERE organization_id = $1 ORDER BY created_at, title LIMIT 1`,
      [walkthroughOrgId]
    );
    const findingId = f.rows[0]!.id;

    const proposed = await auth(`/api/findings/${findingId}/risk-acceptance`, jwtProposer).send({
      owner_user_id: proposerId,
      rationale: "Compensating control in place; accepted for one review cycle.",
      expires_at: "2027-01-01",
    });
    expect(proposed.status).toBe(201);
    const acceptanceId = proposed.body.acceptance?.id as string;
    expect(acceptanceId).toBeTruthy();

    // The proposer cannot sign their own acceptance.
    const selfApprove = await auth(`/api/risk-acceptances/${acceptanceId}/approve`, jwtProposer).send({});
    expect(selfApprove.status).toBe(403);
    expect(selfApprove.body.error).toBe("separation_of_duties");

    const approved = await auth(`/api/risk-acceptances/${acceptanceId}/approve`, jwtApprover).send({
      decision_rationale: "Accepted at the governance forum.",
    });
    expect(approved.status).toBe(200);

    const row = await pool.query<{ state: string; approver_user_id: string }>(
      `SELECT state, approver_user_id FROM finding_risk_acceptances WHERE id = $1`,
      [acceptanceId]
    );
    expect(row.rows[0]?.state).toBe("approved");
    expect(row.rows[0]?.approver_user_id).toBe(approverId);

    // The precondition for the bug: an acceptance now RESTRICTs deletion of its finding.
    expect(await countFor("finding_risk_acceptances", walkthroughOrgId)).toBeGreaterThan(0);
  }, 60_000);

  it("3. tears down successfully even though an acceptance exists", async () => {
    // Before the fix this rejects with an FK violation on finding_risk_acceptances.
    await expect(inTx((c) => teardown(c, walkthroughOrgId))).resolves.not.toThrow();
  }, 120_000);

  it("4. removes every seeded row for the walkthrough tenant", async () => {
    for (const table of SEEDED_TABLES) {
      expect(
        { table, rows: await countFor(table, walkthroughOrgId) },
        `${table} should be empty for the torn-down walkthrough org`
      ).toEqual({ table, rows: 0 });
    }
    // The org row itself is deliberately RETAINED — teardown's documented contract.
    const org = await pool.query(`SELECT id FROM organizations WHERE id = $1`, [walkthroughOrgId]);
    expect(org.rowCount).toBe(1);
  }, 60_000);

  it("5. leaves the other tenant's records — including its acceptance — untouched", async () => {
    const acc = await pool.query<{ id: string; state: string; organization_id: string }>(
      `SELECT id, state, organization_id FROM finding_risk_acceptances WHERE id = $1`,
      [otherAcceptanceId]
    );
    expect(acc.rowCount).toBe(1);
    expect(acc.rows[0]?.state).toBe("proposed");
    expect(acc.rows[0]?.organization_id).toBe(otherOrgId);

    const finding = await pool.query(`SELECT id FROM findings WHERE id = $1`, [otherFindingId]);
    expect(finding.rowCount).toBe(1);

    const users = await pool.query(
      `SELECT id FROM users WHERE id = ANY($1)`,
      [[otherUserA, otherUserB]]
    );
    expect(users.rowCount).toBe(2);

    // And org A, seeded by the harness, is equally untouched.
    const orgA = await pool.query(`SELECT id FROM organizations WHERE id = $1`, [dbSeed.orgA.id]);
    expect(orgA.rowCount).toBe(1);
  }, 60_000);
});
