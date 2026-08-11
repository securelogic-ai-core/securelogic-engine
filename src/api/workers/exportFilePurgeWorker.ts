/**
 * exportFilePurgeWorker.ts — the TTL half of the data-export lifecycle (O-11).
 *
 * data_export_files has carried `purged_at` ("when the R2 object was deleted
 * by the purge job — O-11: 7-day lifetime") and an index on
 * download_token_expires_at since the GDPR foundations migration, and
 * 'export_file_purge' has been a declared job type all along — but no worker
 * ever existed. Expired bundles were only purged reactively when the whole
 * account was deleted (accountDeletionReaper); an export whose download
 * window lapsed sat in R2 indefinitely. This worker makes O-11 true: once
 * the download token expires, the bundle is deleted from R2 and the row is
 * marked purged (keeping the row itself — it is the compliance evidence).
 *
 * Design (mirrors the reaper's purge phase + the retry worker's sweep shape):
 *   - Candidates: purged_at IS NULL AND download_token_expires_at <= NOW(),
 *     batched. All DB access via pgElevated (documented owner-pool pattern —
 *     the sweep spans orgs; every query filters explicitly).
 *   - R2 delete first, THEN mark purged — a crash between the two leaves the
 *     row unpurged and the next sweep retries; R2 object deletion is
 *     idempotent, so a concurrent double-delete is harmless (no lease
 *     needed).
 *   - D-8 parity with the reaper: marking purged also scrubs
 *     downloaded_from_ip.
 *   - R2 not configured → log once and stop the sweep (every delete would
 *     fail identically); rows stay unpurged for a later run with R2 set.
 *
 * Ops brake: SECURELOGIC_EXPORT_PURGE_DISABLED=true skips every tick.
 */

import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { deleteObject } from "../lib/blobStorage.js";
import { BlobStorageNotConfiguredError } from "../lib/blobStorageConfig.js";

const INTERVAL_MS = 60 * 60 * 1000; // hourly — expiry granularity is days
const BATCH_SIZE = 100;

export function exportFilePurgeDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_EXPORT_PURGE_DISABLED"] === "true";
}

interface PurgeCandidate {
  id: string;
  organization_id: string;
  r2_key: string;
}

export async function runExportFilePurgeSweep(): Promise<{
  candidates: number;
  purged: number;
  storage_unconfigured: boolean;
}> {
  if (exportFilePurgeDisabled()) {
    return { candidates: 0, purged: 0, storage_unconfigured: false };
  }

  const candidateResult = await pgElevated.query<PurgeCandidate>(
    `SELECT id, organization_id, r2_key
       FROM data_export_files
      WHERE purged_at IS NULL
        AND download_token_expires_at <= NOW()
      ORDER BY download_token_expires_at ASC
      LIMIT $1`,
    [BATCH_SIZE]
  );

  let purged = 0;

  for (const file of candidateResult.rows) {
    try {
      await deleteObject({ organizationId: file.organization_id, key: file.r2_key });
    } catch (err) {
      if (err instanceof BlobStorageNotConfiguredError) {
        logger.warn(
          { event: "export_file_purge_r2_unconfigured", file_id: file.id },
          "R2 not configured — deferring export-file purge sweep"
        );
        return {
          candidates: candidateResult.rowCount ?? 0,
          purged,
          storage_unconfigured: true,
        };
      }
      // One file's failure must not stop the batch; the row stays
      // unpurged and the next sweep retries it.
      logger.error(
        { event: "export_file_purge_delete_failed", file_id: file.id, err },
        "Export-file R2 delete failed; will retry next sweep"
      );
      continue;
    }

    // D-8: scrub the IP, KEEP the row (it is the compliance evidence).
    await pgElevated.query(
      `UPDATE data_export_files
          SET downloaded_from_ip = NULL, purged_at = NOW()
        WHERE id = $1 AND purged_at IS NULL`,
      [file.id]
    );
    purged += 1;
  }

  const candidates = candidateResult.rowCount ?? 0;
  if (candidates > 0) {
    logger.info(
      { event: "export_file_purge_sweep_complete", candidates, purged },
      "Export-file purge sweep complete"
    );
  }

  return { candidates, purged, storage_unconfigured: false };
}

export function startExportFilePurgeWorker(): void {
  if (exportFilePurgeDisabled()) {
    logger.info(
      { event: "export_file_purge_worker_disabled" },
      "Export-file purge worker: SECURELOGIC_EXPORT_PURGE_DISABLED — not starting"
    );
    return;
  }

  const tick = (): void => {
    runExportFilePurgeSweep().catch((err) =>
      logger.error(
        { event: "export_file_purge_sweep_failed", err },
        "Export-file purge sweep failed"
      )
    );
  };

  tick(); // run once at boot — a long-down service should catch up immediately
  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref();

  logger.info(
    { event: "export_file_purge_worker_started", interval_ms: INTERVAL_MS },
    "Export-file purge worker started"
  );
}
