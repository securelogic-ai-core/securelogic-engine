/**
 * accountDeletionReaper.ts — GDPR Art.17 erasure handler (PR #6). Processes one
 * claimed `account_deletion_reap` job: tombstones the subject user and purges
 * their export bundles. Slots into the existing data-rights worker
 * (processClaimedJob branches here on job_type); reuses its claim / retry /
 * dead-letter machinery. INERT unless the reaper flag is on (the gated enqueuer
 * is the sole producer of these jobs, and the worker only claims them when the
 * flag is on).
 *
 * Phase 1 — ONE withTenant(orgId) transaction, in the carry-forward order
 *   TEXT-anonymize → Category-B delete → users tombstone LAST. Irreversible only
 *   at this single COMMIT; a cancel before then leaves status != 'pending_
 *   deletion' so the idempotency gate no-ops. Every statement carries an
 *   explicit org/user predicate — RLS is not the guard.
 * Phase 2 — R2 export-bundle purge, AFTER the PG commit, idempotent on
 *   purged_at IS NULL (D-7 inline purge, D-8 scrub downloaded_from_ip + keep row).
 *
 * See accountDeletionReaperPolicy.ts for the settled decision-locks (D-1..D-10).
 */

import { pg, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { deleteObject } from "../lib/blobStorage.js";
import { BlobStorageNotConfiguredError } from "../lib/blobStorageConfig.js";
import { NonRetryableJobError, decideFailureState } from "../lib/dataRightsWorkerPolicy.js";
import {
  buildTombstoneUpdate,
  REVIEWER_TEXT_TABLES,
} from "../lib/accountDeletionReaperPolicy.js";
import type { JobRow } from "./dataRightsWorker.js";

function payloadUserId(job: JobRow): string {
  const userId = typeof job.payload?.userId === "string" ? job.payload.userId : null;
  if (!userId) {
    throw new NonRetryableJobError("account_deletion_reap payload missing a string userId");
  }
  return userId;
}

/**
 * Phase 1 — the irreversible-at-COMMIT erasure, in one tenant transaction.
 * Returns "erased" when the user was tombstoned, "skipped" when the
 * idempotency gate fired (already reaped / cancelled / gone).
 */
async function eraseAccount(job: JobRow, now: Date): Promise<"erased" | "skipped"> {
  const orgId = job.organization_id;
  const userId = payloadUserId(job);

  return withTenant(orgId, async (): Promise<"erased" | "skipped"> => {
    // 1. Gate + capture the still-live email (needed for the TEXT scrub before
    //    the tombstone rewrites it). FOR UPDATE pins the row against a racing
    //    cancel. Idempotency: only 'pending_deletion' is reapable.
    const u = await pg.query<{ email: string; status: string }>(
      `SELECT email, status FROM users WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [userId, orgId]
    );
    const row = u.rows[0];
    if (!row || row.status !== "pending_deletion") {
      return "skipped";
    }
    const email = row.email;

    // 2. TEXT-anonymize the deprecated free-text reviewer_id columns by email
    //    (org-scoped). The FK reviewer_uuid is left — anonymized transitively
    //    by the tombstone (D-1). Table names are a fixed trusted allowlist.
    for (const table of REVIEWER_TEXT_TABLES) {
      await pg.query(
        `UPDATE ${table} SET reviewer_id = NULL WHERE organization_id = $1 AND reviewer_id = $2`,
        [orgId, email]
      );
    }

    // 3. Category-B DELETE — user-scoped rows that die with the user (CASCADE
    //    never fires; the users row is tombstoned, not deleted). org_invites
    //    (D-3) and legal_consents (D-2) are deliberately NOT deleted.
    await pg.query(`DELETE FROM password_history WHERE user_id = $1`, [userId]);
    await pg.query(`DELETE FROM user_alert_preferences WHERE user_id = $1`, [userId]);
    await pg.query(`DELETE FROM alert_sends WHERE user_id = $1`, [userId]);
    // dashboard_preferences keeps org_default rows (user_id IS NULL).
    await pg.query(
      `DELETE FROM dashboard_preferences WHERE organization_id = $1 AND user_id = $2`,
      [orgId, userId]
    );

    // 4. legal_consents — D-2 retain-with-scrub (Art.17(3)(b)/(e)): keep the
    //    consent skeleton, scrub the captured PII.
    await pg.query(
      `UPDATE legal_consents SET ip_address = NULL, user_agent = NULL
        WHERE organization_id = $1 AND user_id = $2`,
      [orgId, userId]
    );

    // 5. users tombstone LAST (scrubs the email step 2 depended on).
    const { sql, params } = buildTombstoneUpdate(userId, orgId, now);
    const t = await pg.query(sql, params);
    if (t.rowCount !== 1) {
      // The status changed between the gate and here (a cancel raced in) — abort
      // the whole transaction so nothing is half-erased; the next run no-ops.
      throw new Error(
        `tombstone affected ${t.rowCount ?? 0} rows for user ${userId} (expected 1) — racing cancel?`
      );
    }
    return "erased";
  });
}

/**
 * Phase 2 — purge the subject's R2 export bundles, AFTER the Phase-1 commit.
 * Idempotent (purged_at IS NULL guard) so a crash mid-purge resumes cleanly.
 * If R2 is not configured (prod default today), the bundles can't be reached —
 * leave purged_at unset for a later run rather than failing the already-erased
 * job; the legal obligation (PG tombstone) is already satisfied.
 */
async function purgeExportBundles(job: JobRow, now: Date): Promise<void> {
  const orgId = job.organization_id;
  const userId = payloadUserId(job);

  await withTenant(orgId, async () => {
    const files = await pg.query<{ id: string; r2_key: string }>(
      `SELECT id, r2_key FROM data_export_files
        WHERE organization_id = $1 AND requested_by_user_id = $2 AND purged_at IS NULL`,
      [orgId, userId]
    );

    for (const file of files.rows) {
      try {
        await deleteObject({ organizationId: orgId, key: file.r2_key });
      } catch (err) {
        if (err instanceof BlobStorageNotConfiguredError) {
          logger.warn(
            { event: "account_deletion_reap_r2_unconfigured", job_id: job.id, file_id: file.id },
            "R2 not configured — deferring export-bundle purge; PG erasure already committed"
          );
          continue; // leave purged_at NULL; a later run with R2 set completes it
        }
        throw err;
      }
      // D-8: scrub the IP, KEEP the row, mark purged.
      await pg.query(
        `UPDATE data_export_files SET downloaded_from_ip = NULL, purged_at = $2 WHERE id = $1`,
        [file.id, now]
      );
    }
  });
}

async function recordReapSuccess(
  job: JobRow,
  outcome: "erased" | "skipped",
  now: Date
): Promise<void> {
  await withTenant(job.organization_id, async () => {
    await pg.query(
      `UPDATE jobs
          SET status = 'succeeded', result = $2::jsonb, error = NULL,
              locked_by = NULL, locked_at = NULL,
              completed_at = $3, updated_at = $3
        WHERE id = $1`,
      [job.id, JSON.stringify({ outcome }), now]
    );
  });
}

async function recordReapFailure(job: JobRow, err: unknown, now: Date): Promise<void> {
  const decision = decideFailureState(job, err, now);
  const message = ((err as Error)?.message ?? String(err)).slice(0, 2000);
  await withTenant(job.organization_id, async () => {
    await pg.query(
      `UPDATE jobs
          SET status = $2, error = $3, next_attempt_at = $4,
              scheduled_for = COALESCE($4, scheduled_for),
              locked_by = NULL, locked_at = NULL, updated_at = now()
        WHERE id = $1`,
      [job.id, decision.status, message, decision.nextAttemptAt]
    );
  });
}

/**
 * Process one already-claimed account_deletion_reap job. Never throws — every
 * outcome is persisted to the job row (mirrors processClaimedJob for exports).
 */
export async function processReapJob(
  job: JobRow,
  deps: { now?: () => Date } = {}
): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const orgId = job.organization_id;
  try {
    const outcome = await eraseAccount(job, now());
    // Phase 2 runs even on "skipped" — it cleans up any export rows left
    // un-purged by an earlier crashed run (purged_at IS NULL guard).
    await purgeExportBundles(job, now());
    await recordReapSuccess(job, outcome, now());
    logger.info(
      { event: "account_deletion_reap_succeeded", job_id: job.id, org_id: orgId, outcome },
      "account-deletion reap succeeded"
    );
  } catch (err) {
    await recordReapFailure(job, err, now());
    logger.error(
      {
        event: "account_deletion_reap_failed",
        job_id: job.id,
        org_id: orgId,
        message: (err as Error)?.message,
      },
      "account-deletion reap failed"
    );
  }
}
