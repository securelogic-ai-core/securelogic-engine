/**
 * independentReviewNotification.test.ts — the reviewer notification is dispatched
 * POST-COMMIT and idempotently (production-enable gate), over the REAL app path and real
 * Postgres.
 *
 * The assignment registers the notification via registerAfterCommit, so it fires ONLY
 * after the tenant transaction durably commits, never for a rolled-back assignment, and
 * only on a real NEW assignment (so retries can't duplicate). Proves:
 *   1. commit → the reviewer is emailed exactly once, and NOT before COMMIT;
 *   2. rollback → no email, and no assignment persisted;
 *   3. retry / re-invocation with the same reviewer → no duplicate email.
 *
 * infra/email.sendEmail is mocked so delivery is observable and offline. Both flags are on
 * (workflow + notifications) for this suite and restored after.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedFinding, type TestDbSeed } from "./testDb.js";

// Observable, offline delivery. importOriginal keeps every other export intact so the
// wider module graph (which may use them) is unaffected — only sendEmail is replaced.
vi.mock("../../src/api/infra/email.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/infra/email.js")>();
  return { ...actual, sendEmail: vi.fn(async () => ({ ok: true, id: "test" })) };
});

let seed: TestDbSeed;
let pool: Pool;
let priorWorkflow: string | undefined;
let priorNotify: string | undefined;
let sendEmailMock: ReturnType<typeof vi.fn>;
let orgA_reviewer: string;
let orgA_reviewerEmail: string;
let orgA_remediator: string;

const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

/** Poll until `pred` holds or the budget runs out (for the detached, fire-and-forget send). */
async function waitUntil(pred: () => boolean, tries = 40): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function seedAdmin(orgId: string, email: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, email, name, role, status, password_hash, email_verified)
     VALUES ($1, $2, $3, 'admin', 'active', 'x', TRUE) RETURNING id`,
    [orgId, email, email]
  );
  return r.rows[0]!.id;
}

async function seedRemediatedActionRow(orgId: string, findingId: string): Promise<void> {
  await pool.query(
    `INSERT INTO actions (organization_id, title, source_type, source_id, priority, status)
     VALUES ($1, 'notify remediation', 'finding', $2, 'planned', 'closed')`,
    [orgId, findingId]
  );
}

async function reviewOwner(findingId: string): Promise<string | null> {
  const r = await pool.query<{ review_owner_user_id: string | null }>(
    `SELECT review_owner_user_id FROM findings WHERE id = $1`,
    [findingId]
  );
  return r.rows[0]!.review_owner_user_id;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the notification test.");
  pool = new Pool({ connectionString: url, ssl: false });

  priorWorkflow = process.env.SECURELOGIC_INDEPENDENT_REVIEW_ENABLED;
  priorNotify = process.env.SECURELOGIC_GOVERNANCE_REVIEW_NOTIFICATIONS_ENABLED;
  process.env.SECURELOGIC_INDEPENDENT_REVIEW_ENABLED = "true";
  process.env.SECURELOGIC_GOVERNANCE_REVIEW_NOTIFICATIONS_ENABLED = "true";

  const email = await import("../../src/api/infra/email.js");
  sendEmailMock = email.sendEmail as unknown as ReturnType<typeof vi.fn>;

  orgA_reviewerEmail = `notify-reviewer-${seed.orgA.id}@harness.test`;
  orgA_reviewer = await seedAdmin(seed.orgA.id, orgA_reviewerEmail);
  orgA_remediator = await seedAdmin(seed.orgA.id, `notify-remediator-${seed.orgA.id}@harness.test`);

  await pool.query(
    `INSERT INTO risk_settings (organization_id, cadence_by_rating, require_finding_closure_sod)
     VALUES ($1, '{}'::jsonb, TRUE)
     ON CONFLICT (organization_id) DO UPDATE SET require_finding_closure_sod = TRUE`,
    [seed.orgA.id]
  );
}, 120_000);

afterAll(async () => {
  if (priorWorkflow === undefined) delete process.env.SECURELOGIC_INDEPENDENT_REVIEW_ENABLED;
  else process.env.SECURELOGIC_INDEPENDENT_REVIEW_ENABLED = priorWorkflow;
  if (priorNotify === undefined) delete process.env.SECURELOGIC_GOVERNANCE_REVIEW_NOTIFICATIONS_ENABLED;
  else process.env.SECURELOGIC_GOVERNANCE_REVIEW_NOTIFICATIONS_ENABLED = priorNotify;
  await pool?.end();
});

describe("independent-review reviewer notification — post-commit + idempotent", () => {
  it("commit: emails the reviewer exactly once, and NOT before COMMIT", async () => {
    sendEmailMock.mockClear();
    const findingId = await seedFinding(pool, seed.orgA.id);
    await seedRemediatedActionRow(seed.orgA.id, findingId);

    const { withTenant } = await import("../../src/api/infra/postgres.js");
    const { recomputeFindingOperationalStatus } = await import(
      "../../src/api/lib/findingLifecycle.js"
    );

    let midTxCalls = -1;
    await withTenant(seed.orgA.id, async () => {
      await recomputeFindingOperationalStatus(seed.orgA.id, findingId, {
        actorUserId: orgA_remediator,
        actorApiKeyId: null,
      });
      // Still inside the transaction: the send is deferred, so nothing has gone out.
      midTxCalls = sendEmailMock.mock.calls.length;
    });
    expect(midTxCalls).toBe(0);

    await waitUntil(() => sendEmailMock.mock.calls.length >= 1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    // Addressed to the assigned reviewer (the admin != remediator).
    expect(await reviewOwner(findingId)).toBe(orgA_reviewer);
    expect(sendEmailMock.mock.calls[0]![0].to).toBe(orgA_reviewerEmail);
  });

  it("rollback: no email is sent and no assignment persists", async () => {
    sendEmailMock.mockClear();
    const findingId = await seedFinding(pool, seed.orgA.id);
    await seedRemediatedActionRow(seed.orgA.id, findingId);

    const { withTenant } = await import("../../src/api/infra/postgres.js");
    const { recomputeFindingOperationalStatus } = await import(
      "../../src/api/lib/findingLifecycle.js"
    );

    await expect(
      withTenant(seed.orgA.id, async () => {
        await recomputeFindingOperationalStatus(seed.orgA.id, findingId, {
          actorUserId: orgA_remediator,
          actorApiKeyId: null,
        });
        // The reviewer WAS chosen in-transaction, but the transaction now fails.
        throw new Error("rollback after assignment");
      })
    ).rejects.toThrow("rollback after assignment");

    await settle();
    expect(sendEmailMock).not.toHaveBeenCalled();
    // The rolled-back assignment left no trace — the finding never reached remediated.
    const r = await pool.query<{ review_owner_user_id: string | null; operational_status: string }>(
      `SELECT review_owner_user_id, operational_status FROM findings WHERE id = $1`,
      [findingId]
    );
    expect(r.rows[0]!.review_owner_user_id).toBeNull();
    expect(r.rows[0]!.operational_status).not.toBe("remediated");
  });

  it("retry: re-invoking the assignment for an already-assigned finding sends no duplicate", async () => {
    sendEmailMock.mockClear();
    const findingId = await seedFinding(pool, seed.orgA.id);
    await seedRemediatedActionRow(seed.orgA.id, findingId);

    const { withTenant } = await import("../../src/api/infra/postgres.js");
    const { recomputeFindingOperationalStatus } = await import(
      "../../src/api/lib/findingLifecycle.js"
    );
    const { assignIndependentReviewerIfNeeded } = await import(
      "../../src/api/lib/independentReviewAssignment.js"
    );

    // First pass assigns + sends once.
    await withTenant(seed.orgA.id, () =>
      recomputeFindingOperationalStatus(seed.orgA.id, findingId, {
        actorUserId: orgA_remediator,
        actorApiKeyId: null,
      })
    );
    await waitUntil(() => sendEmailMock.mock.calls.length >= 1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    // Retry: the reviewer is already assigned (and is not the remediator), so this is a
    // no-op — changed=false, nothing registered, no second email.
    const result = await withTenant(seed.orgA.id, () =>
      assignIndependentReviewerIfNeeded(seed.orgA.id, findingId, orgA_remediator, {
        actorUserId: orgA_remediator,
        actorApiKeyId: null,
      })
    );
    expect(result.changed).toBe(false);
    await settle();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });
});
