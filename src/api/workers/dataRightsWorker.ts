/**
 * dataRightsWorker.ts — core logic for the GDPR/CCPA data-rights worker (PR #3).
 *
 * EXPORT-ONLY scope (Phase 0 decision-lock). The worker claims and executes
 * `data_export_self` and `data_export_org` jobs from the generic `jobs` table
 * (migration 20260621_gdpr_foundations.sql), runs the now-complete `runExport`
 * (PR #2a–#2d), and streams the bundle to R2. It deliberately does NOT touch
 * `account_deletion_reap` (deferred until the deletion reaper exists) or
 * `export_file_purge` (a maintenance job, not an export) — those job types are
 * left unclaimed, never errored.
 *
 * ── Tenant isolation (A04-G1-adjacent — the load-bearing invariant) ──────────
 *  • CLAIM POLL runs on the elevated/owner channel (`pgElevated`). It scans the
 *    whole `jobs` queue across every org; under the eventual app_request flip a
 *    context-less poller on the tenant channel would see ZERO rows (jobs RLS
 *    filters to current_org_id). The poll must therefore be elevated. This is
 *    the established cross-org-enumeration pattern (posture-worker, schedulers).
 *  • EVERYTHING ELSE — subject-email resolution, export execution, the terminal
 *    jobs UPDATE and the jobs.result write — runs inside `withTenant(orgId)` so
 *    it is RLS-correct post-flip and provably single-org.
 *  • `subject.userEmail` for a self-export is read from `users.email` IN THE DB
 *    inside `withTenant`, NEVER from `job.payload` (export trust invariant B).
 *    A poisoned payload email can never reach the bundle.
 *
 * ── Terminal write (Decision D-1, revised by PR #5) ──────────────────────────
 * The worker's success output is the R2 object + `jobs.result` JSONB
 * ({ r2_key, file_size_bytes, scope }) + status='succeeded' AND the
 * `data_export_files` delivery row. PR #5 folds the delivery row back into the
 * worker success path (it was briefly deferred to the route PR under the
 * original D-1): on success the worker mints a 256-bit download token, stores
 * only its plain SHA-256 hash + a 7-day expiry, and INSERTs the
 * `data_export_files` row INSIDE the same `withTenant(orgId)` as the jobs
 * UPDATE — so the delivery metadata exists the instant the bundle lands. The
 * raw token is intentionally discarded here in PR #5: there is no sender yet
 * (email is deferred to PR #4); the in-app authenticated download path resolves
 * files by (org, requesting user), not by token.
 *
 * ── Retry / failure (Decisions D-4 / D-5) ────────────────────────────────────
 *  • Transient failure with attempts left → status='queued' with exponential
 *    backoff (scheduled_for bumped). Non-retryable → status='failed' at once.
 *    Attempts exhausted → status='dead_lettered' (needs a human).
 *  • A worker that crashes mid-run strands the job in 'processing' with its lock
 *    held; the claim poll reclaims any 'processing' job whose locked_at is older
 *    than LOCK_TIMEOUT_MS (visibility timeout).
 *  • runExport already fails the whole export (no partial bundle); on any
 *    failure we also abort the in-flight multipart upload so no orphan R2 parts
 *    linger (mirrors the #2b fail-closed discipline).
 */

import { pg, pgElevated, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { runExport } from "../services/dataExport/exporter.js";
import { createDataExportWriteStream } from "../lib/dataExportStorage.js";
import { mintDownloadToken } from "../lib/dataExportDownloadToken.js";
import { exportEmailEnabled, sendExportReadyEmail } from "../lib/exportReadyEmail.js";
import { processReapJob } from "./accountDeletionReaper.js";
import {
  accountDeletionReaperEnabled,
  claimedJobTypes,
  ACCOUNT_DELETION_REAP_JOB_TYPE,
} from "../lib/accountDeletionReaperPolicy.js";
import type { ExportScope, ExportSubject } from "../services/dataExport/types.js";
import type { ObjectWriteHandle } from "../lib/blobStorage.js";
import {
  EXPORT_JOB_TYPES,
  LOCK_TIMEOUT_MS,
  NonRetryableJobError,
  decideFailureState,
} from "../lib/dataRightsWorkerPolicy.js";

// Re-export the DB-free policy surface so callers import everything from here.
export {
  EXPORT_JOB_TYPES,
  LOCK_TIMEOUT_MS,
  MAX_BACKOFF_MS,
  NonRetryableJobError,
  backoffMs,
  decideFailureState,
} from "../lib/dataRightsWorkerPolicy.js";

/** The columns the claim returns — the subset the worker needs to process a job. */
export interface JobRow {
  id: string;
  organization_id: string;
  requested_by_user_id: string | null;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  payload: Record<string, unknown>;
}

/** Injectable seams so the executor core is testable with no R2 / a Buffer sink. */
export interface WorkerDeps {
  /** Identifies this worker instance in locked_by. */
  workerId?: string;
  now?: () => Date;
  /** Open the bundle sink — defaults to R2 via dataExportStorage. */
  openSink?: (orgId: string, exportId: string) => ObjectWriteHandle;
  /** The export executor — defaults to runExport. */
  runExportFn?: typeof runExport;
  /** Loop guard: runOneTick stops claiming when this returns false (shutdown). */
  shouldContinue?: () => boolean;
}

/**
 * Atomically claim the next export job (or reclaim a crashed one) on the
 * ELEVATED channel. SELECT ... FOR UPDATE SKIP LOCKED inside the UPDATE makes
 * two worker instances unable to double-claim. Returns null when nothing is
 * claimable.
 */
const CLAIM_SQL = `
  UPDATE jobs
     SET status = 'processing',
         locked_by = $1,
         locked_at = now(),
         attempts = attempts + 1,
         updated_at = now()
   WHERE id = (
     SELECT id FROM jobs
      WHERE job_type = ANY($2::text[])
        AND (
              (status = 'queued' AND scheduled_for <= now())
           OR (status = 'processing' AND locked_at < now() - ($3::bigint * interval '1 millisecond'))
        )
      ORDER BY scheduled_for
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING id, organization_id, requested_by_user_id, job_type, status, attempts, max_attempts, payload`;

export async function claimNextJob(workerId: string): Promise<JobRow | null> {
  // The reap job type is claimed ONLY when the reaper flag is on (the gated
  // enqueuer also produces none while off), so reap jobs are never drained
  // while the feature is disabled — the export behaviour is unchanged.
  const { rows } = await pgElevated.query(CLAIM_SQL, [
    workerId,
    claimedJobTypes(accountDeletionReaperEnabled()),
    LOCK_TIMEOUT_MS,
  ]);
  return (rows[0] as JobRow | undefined) ?? null;
}

/**
 * Resolve the export scope + subject for a claimed job. For a self-export the
 * subject's email is read from `users.email` inside `withTenant` (trust
 * invariant B) — the payload supplies only the userId. For an org export the
 * executor enumerates members itself, so only orgId matters.
 */
async function resolveSubject(
  job: JobRow,
): Promise<{ scope: ExportScope; subject: ExportSubject }> {
  const orgId = job.organization_id;

  if (job.job_type === "data_export_org") {
    // org_full nulls target_user_id and reads member emails from the DB itself;
    // userId/userEmail here are unused beyond logging.
    return {
      scope: "org_full",
      subject: { userId: job.requested_by_user_id ?? "", userEmail: "", orgId },
    };
  }

  const userId = typeof job.payload?.userId === "string" ? job.payload.userId : null;
  if (!userId) {
    throw new NonRetryableJobError("data_export_self job payload missing a string userId");
  }

  const email = await withTenant(orgId, async () => {
    const { rows } = await pg.query(
      "SELECT email FROM users WHERE id = $1 AND organization_id = $2",
      [userId, orgId],
    );
    return (rows[0] as { email?: string } | undefined)?.email;
  });

  if (!email) {
    throw new NonRetryableJobError(
      `data_export_self subject user ${userId} not found in org ${orgId}`,
    );
  }

  return { scope: "user_self", subject: { userId, userEmail: String(email), orgId } };
}

/**
 * Mark a job succeeded with its result AND write the `data_export_files`
 * delivery row, both inside the org's tenant scope (PR #5, revises D-1). The
 * download token is minted here: only its SHA-256 hash + a 7-day expiry are
 * stored; the raw token is discarded (no sender yet — email is PR #4). The jobs
 * UPDATE and the files INSERT run in the SAME `withTenant` callback so they
 * share one tenant-scoped connection and are RLS-correct post-flip.
 */
async function recordSuccess(
  job: JobRow,
  result: { r2_key: string; file_size_bytes: number; scope: ExportScope },
  now: Date,
): Promise<void> {
  const minted = mintDownloadToken(now);
  // Resolved inside the tenant scope (RLS-correct) so the notification can be
  // sent AFTER commit. Only queried when the export-email flag is on (zero
  // overhead otherwise). The trust invariant holds — the address comes from
  // users.email in the DB, never from job.payload.
  let recipientEmail: string | null = null;
  await withTenant(job.organization_id, async () => {
    await pg.query(
      `UPDATE jobs
          SET status = 'succeeded', result = $2::jsonb, error = NULL,
              locked_by = NULL, locked_at = NULL,
              completed_at = now(), updated_at = now()
        WHERE id = $1`,
      [job.id, JSON.stringify(result)],
    );
    await pg.query(
      `INSERT INTO data_export_files
         (job_id, organization_id, requested_by_user_id, scope, r2_key,
          file_size_bytes, download_token_hash, download_token_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        job.id,
        job.organization_id,
        job.requested_by_user_id,
        result.scope,
        result.r2_key,
        result.file_size_bytes,
        minted.tokenHash,
        minted.expiresAt,
      ],
    );
    if (exportEmailEnabled() && job.requested_by_user_id) {
      const r = await pg.query<{ email: string }>(
        "SELECT email FROM users WHERE id = $1 AND organization_id = $2",
        [job.requested_by_user_id, job.organization_id],
      );
      recipientEmail = r.rows[0]?.email ?? null;
    }
  });

  // GDPR export #4: notify the requester their export is ready (flag-gated,
  // never-throws). Sent AFTER commit so a slow/failed email can't affect the
  // already-succeeded job. Uses the raw download token (the tokenized public
  // download route) — minted above, no longer discarded.
  if (recipientEmail) {
    await sendExportReadyEmail({ to: recipientEmail, rawToken: minted.token, expiresAt: minted.expiresAt });
  }
}

/** Persist a failure outcome (requeue with backoff / failed / dead_lettered). */
async function recordFailure(job: JobRow, err: unknown, now: Date): Promise<void> {
  const decision = decideFailureState(job, err, now);
  const message = ((err as Error)?.message ?? String(err)).slice(0, 2000);
  await withTenant(job.organization_id, async () => {
    await pg.query(
      `UPDATE jobs
          SET status = $2, error = $3, next_attempt_at = $4,
              scheduled_for = COALESCE($4, scheduled_for),
              locked_by = NULL, locked_at = NULL, updated_at = now()
        WHERE id = $1`,
      [job.id, decision.status, message, decision.nextAttemptAt],
    );
  });
}

/**
 * Process one already-claimed job to completion. Never throws — every outcome is
 * persisted to the row. (The claim already moved the job to 'processing'.)
 */
export async function processClaimedJob(job: JobRow, deps: WorkerDeps = {}): Promise<void> {
  // GDPR Art.17 erasure jobs take a different path (no sink / no export). The
  // claim filter only yields these when the reaper flag is on.
  if (job.job_type === ACCOUNT_DELETION_REAP_JOB_TYPE) {
    await processReapJob(job, deps.now ? { now: deps.now } : {});
    return;
  }

  const now = deps.now ?? (() => new Date());
  const openSink =
    deps.openSink ??
    ((orgId, exportId) => createDataExportWriteStream({ organizationId: orgId, exportId }));
  const runExportFn = deps.runExportFn ?? runExport;
  const orgId = job.organization_id;
  const exportId = job.id;

  let resolved: { scope: ExportScope; subject: ExportSubject };
  try {
    resolved = await resolveSubject(job);
  } catch (err) {
    await recordFailure(job, err, now());
    logger.error(
      { event: "data_rights_job_failed", job_id: job.id, org_id: orgId, phase: "resolve", message: (err as Error)?.message },
      "data-rights export job failed to resolve subject",
    );
    return;
  }

  // `openSink` is INSIDE the try: createObjectWriteStream throws synchronously
  // (e.g. BlobStorageNotConfiguredError when R2 env is absent) before the first
  // await, and that fault must be caught at the job level — routed through
  // recordFailure/decideFailureState (config faults are retryable → 'queued',
  // then 'dead_lettered' at max_attempts) — NOT escape to the tick handler and
  // leave the job stale-locked in 'processing' until the reclaim timeout.
  let sink: ObjectWriteHandle | undefined;
  try {
    sink = openSink(orgId, exportId);
    const result = await runExportFn({
      subject: resolved.subject,
      scope: resolved.scope,
      sink: sink.stream,
      exportId,
    });
    const uploaded = await sink.done; // wait for the R2 multipart upload to finish
    await recordSuccess(
      job,
      {
        r2_key: uploaded.key,
        file_size_bytes: uploaded.byteSize,
        scope: resolved.scope,
      },
      now(),
    );
    logger.info(
      {
        event: "data_rights_job_succeeded",
        job_id: job.id,
        org_id: orgId,
        scope: resolved.scope,
        r2_key: uploaded.key,
        file_size_bytes: uploaded.byteSize,
        bytes_written: result.bytes_written,
      },
      "data-rights export job succeeded",
    );
  } catch (err) {
    // Fail-closed: tear down the in-flight multipart upload (no orphan parts).
    // `sink` may be undefined if openSink itself threw — nothing to abort then.
    if (sink) {
      try {
        await sink.abort();
      } catch {
        /* upload may not have started a multipart yet */
      }
    }
    await recordFailure(job, err, now());
    logger.error(
      { event: "data_rights_job_failed", job_id: job.id, org_id: orgId, phase: "execute", message: (err as Error)?.message },
      "data-rights export job failed",
    );
  }
}

/**
 * Drain the queue: claim + process jobs until none are claimable (or shutdown
 * is requested between jobs). Returns the number of jobs processed this tick.
 */
export async function runOneTick(deps: WorkerDeps = {}): Promise<number> {
  const workerId = deps.workerId ?? `data-rights-worker-${process.pid}`;
  let processed = 0;
  for (;;) {
    if (deps.shouldContinue && !deps.shouldContinue()) break;
    const job = await claimNextJob(workerId);
    if (!job) break;
    await processClaimedJob(job, deps);
    processed += 1;
  }
  return processed;
}
