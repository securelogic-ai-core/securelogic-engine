/**
 * dataExports.ts — self-service GDPR/CCPA data-export intake + delivery
 * (data-subject-rights workstream, PR #5). `user_self` scope only.
 *
 * Two routers ship from this file:
 *
 *   default  — AUTHENTICATED surface (requireApiKey + attachOrganizationContext,
 *              JWT-identified user). Mounted among the /api data routers.
 *     POST /api/data-exports                 request a self-export (Art. 15/20)
 *     GET  /api/data-exports                 list my export requests + bundles
 *     GET  /api/data-exports/:fileId/download 302 → short-lived signed R2 URL
 *
 *   dataExportPublicDownloadRouter — SESSION-OPTIONAL tokenized download
 *     GET  /api/data-exports/download?token=…  302 → short-lived signed R2 URL
 *     Mounted in the PUBLIC section (before requireConsent + the API-key rate
 *     limiter) so a future emailed link works with no session (Decisions E/F).
 *
 * Tenant isolation:
 *   • The authenticated routes scope every row by (organization_id, requesting
 *     user) — a user can only ever see or fetch their OWN files; cross-org and
 *     cross-user both resolve to 404.
 *   • The tokenized route has NO org context when it runs, so it resolves the
 *     row on the elevated channel (`pgElevated`) BY the SHA-256 token hash, then
 *     mints a signed URL STRICTLY for the resolved row's own org + key — it can
 *     never be steered at another tenant's bytes (see the migration comment on
 *     data_export_files.download_token_hash).
 *
 * No email is sent here (deferred to PR #4) and no `org_full` intake exists
 * (deferred). The worker (dataRightsWorker.recordSuccess) writes the
 * data_export_files row + token hash at export-completion time.
 */

import { Router, type Request, type Response } from "express";
import { pg, pgElevated, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { hashDownloadToken } from "../lib/dataExportDownloadToken.js";
import { getDataExportSignedUrl } from "../lib/dataExportStorage.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const authMiddleware = [requireApiKey, attachOrganizationContext];

function getOrgId(req: Request): string | null {
  return (req as any).organizationContext?.organizationId ?? null;
}

/** The self-export actor is a human; their identity comes from the JWT (sub). */
function getUserId(req: Request): string | null {
  return ((req as any).jwtPayload?.sub as string | undefined) ?? null;
}

/** A row of data_export_files needed to issue a signed download. */
interface ExportFileRow {
  id: string;
  organization_id: string;
  r2_key: string;
  download_token_expires_at: string;
  purged_at: string | null;
}

/**
 * Best-effort download telemetry. A failure here must NEVER block the download
 * — it is logged and swallowed. Scoped to the row's org via withTenant so it is
 * RLS-correct post-flip. `downloaded_from_ip` is cast to inet defensively; a
 * malformed proxy IP simply aborts this (caught) update rather than the request.
 */
async function markDownloaded(
  fileId: string,
  organizationId: string,
  ip: string | null,
): Promise<void> {
  try {
    await withTenant(organizationId, () =>
      pg.query(
        `UPDATE data_export_files
            SET downloaded_at = now(), downloaded_from_ip = $2::inet
          WHERE id = $1 AND organization_id = $3`,
        [fileId, ip, organizationId],
      ),
    );
  } catch (err) {
    logger.warn(
      { event: "data_export_mark_downloaded_failed", file_id: fileId, err },
      "failed to record data-export download telemetry (non-fatal)",
    );
  }
}

/**
 * Issue a 302 to a short-lived signed URL for an already-authorized row, after
 * recording the download. Shared by the authenticated and tokenized routes.
 */
async function redirectToSignedUrl(
  req: Request,
  res: Response,
  row: ExportFileRow,
): Promise<void> {
  let signed: { url: string };
  try {
    signed = await getDataExportSignedUrl({
      organizationId: row.organization_id,
      r2Key: row.r2_key,
    });
  } catch (err) {
    logger.error(
      { event: "data_export_signed_url_failed", file_id: row.id, err },
      "data-export signed URL issuance failed",
    );
    res.status(500).json({ error: "download_url_failed" });
    return;
  }
  await markDownloaded(row.id, row.organization_id, req.ip ?? null);
  res.redirect(302, signed.url);
}

// ─── default (authenticated) router ──────────────────────────────────────────

const router = Router();

// POST /api/data-exports — request a self-export.
router.post("/data-exports", ...authMiddleware, async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  const userId = getUserId(req);

  if (!orgId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (!userId) {
    res.status(403).json({
      error: "jwt_required",
      detail: "Requesting a data export requires a signed-in user session.",
    });
    return;
  }

  try {
    // One pending self-export per (org, user) — guarded conditional INSERT
    // (Decision C). A second request while one is queued/processing inserts no
    // row (rowCount 0) → 409. The guard is best-effort idempotency, not a hard
    // constraint: two truly-simultaneous requests could both pass the NOT
    // EXISTS, the only cost being a duplicate export — acceptable, and the
    // reason a unique index (and a migration) is intentionally not added here.
    const inserted = await pg.query<{ id: string; status: string; created_at: string }>(
      `INSERT INTO jobs (organization_id, requested_by_user_id, job_type, payload)
       SELECT $1::uuid, $2::uuid, 'data_export_self', jsonb_build_object('userId', $3::text)
        WHERE NOT EXISTS (
          SELECT 1 FROM jobs
           WHERE organization_id = $1::uuid
             AND requested_by_user_id = $2::uuid
             AND job_type = 'data_export_self'
             AND status IN ('queued', 'processing')
        )
       RETURNING id, status, created_at`,
      [orgId, userId, userId],
    );

    if (inserted.rowCount === 0) {
      res.status(409).json({
        error: "export_already_pending",
        detail: "You already have a data export in progress. Wait for it to finish.",
      });
      return;
    }

    const job = inserted.rows[0]!;

    writeAuditEvent({
      organizationId: orgId,
      actorUserId: userId,
      eventType: "data_export.requested",
      resourceType: "data_export_job",
      resourceId: job.id,
      payload: { scope: "user_self" },
      ipAddress: req.ip ?? null,
    });

    res.status(202).json({ jobId: job.id, status: job.status, scope: "user_self" });
  } catch (err) {
    logger.error(
      { event: "data_export_request_failed", org_id: orgId, err },
      "POST /api/data-exports failed",
    );
    res.status(500).json({ error: "internal_error" });
  }
});

// GET /api/data-exports — list the caller's own self-export requests + bundles.
router.get("/data-exports", ...authMiddleware, async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  const userId = getUserId(req);

  if (!orgId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (!userId) {
    res.status(403).json({ error: "jwt_required" });
    return;
  }

  try {
    const result = await pg.query<{
      job_id: string;
      job_status: string;
      requested_at: string;
      completed_at: string | null;
      file_id: string | null;
      file_size_bytes: string | null;
      download_token_expires_at: string | null;
      downloaded_at: string | null;
      purged_at: string | null;
    }>(
      `SELECT j.id           AS job_id,
              j.status        AS job_status,
              j.created_at    AS requested_at,
              j.completed_at  AS completed_at,
              f.id            AS file_id,
              f.file_size_bytes,
              f.download_token_expires_at,
              f.downloaded_at,
              f.purged_at
         FROM jobs j
         LEFT JOIN data_export_files f
           ON f.job_id = j.id AND f.organization_id = j.organization_id
        WHERE j.organization_id = $1
          AND j.requested_by_user_id = $2
          AND j.job_type = 'data_export_self'
        ORDER BY j.created_at DESC
        LIMIT 50`,
      [orgId, userId],
    );

    const nowMs = Date.now();
    const exports = result.rows.map((r) => {
      const hasFile = r.file_id != null;
      const purged = r.purged_at != null;
      const expired =
        r.download_token_expires_at != null &&
        new Date(r.download_token_expires_at).getTime() <= nowMs;
      const available = hasFile && !purged && !expired;
      return {
        jobId: r.job_id,
        status: r.job_status,
        requestedAt: r.requested_at,
        completedAt: r.completed_at,
        file: !hasFile
          ? null
          : {
              id: r.file_id,
              sizeBytes: r.file_size_bytes == null ? null : Number(r.file_size_bytes),
              expiresAt: r.download_token_expires_at,
              downloadedAt: r.downloaded_at,
              purged,
              available,
              downloadPath: available ? `/api/data-exports/${r.file_id}/download` : null,
            },
      };
    });

    res.status(200).json({ exports });
  } catch (err) {
    logger.error(
      { event: "data_export_list_failed", org_id: orgId, err },
      "GET /api/data-exports failed",
    );
    res.status(500).json({ error: "internal_error" });
  }
});

// GET /api/data-exports/:fileId/download — owner download (302 → signed URL).
router.get(
  "/data-exports/:fileId/download",
  ...authMiddleware,
  async (req: Request, res: Response) => {
    const orgId = getOrgId(req);
    const userId = getUserId(req);
    const fileId = typeof req.params.fileId === "string" ? req.params.fileId : "";

    if (!orgId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (!userId) {
      res.status(403).json({ error: "jwt_required" });
      return;
    }
    // A non-UUID id can never be a real row — treat as not-found (and avoid a
    // uuid-cast error on the lookup).
    if (!UUID_RE.test(fileId)) {
      res.status(404).json({ error: "export_not_found" });
      return;
    }

    try {
      // Scoped by BOTH org and the requesting user: cross-org AND cross-user
      // (same-org) requests both fall through to 404 — no IDOR.
      const { rows } = await pg.query<ExportFileRow>(
        `SELECT id, organization_id, r2_key, download_token_expires_at, purged_at
           FROM data_export_files
          WHERE id = $1 AND organization_id = $2 AND requested_by_user_id = $3
          LIMIT 1`,
        [fileId, orgId, userId],
      );
      const row = rows[0];
      if (!row) {
        res.status(404).json({ error: "export_not_found" });
        return;
      }
      if (row.purged_at != null) {
        res.status(410).json({ error: "export_purged" });
        return;
      }
      // The bundle's R2 lifetime equals the token window (both 7 days, O-11);
      // past it the object is gone, so refuse rather than 302 into an R2 404.
      if (new Date(row.download_token_expires_at).getTime() <= Date.now()) {
        res.status(410).json({ error: "export_expired" });
        return;
      }
      await redirectToSignedUrl(req, res, row);
    } catch (err) {
      logger.error(
        { event: "data_export_download_failed", org_id: orgId, file_id: fileId, err },
        "GET /api/data-exports/:fileId/download failed",
      );
      res.status(500).json({ error: "internal_error" });
    }
  },
);

export default router;

// ─── public (session-optional, tokenized) download router ────────────────────

const publicDownloadRouter = Router();

// GET /api/data-exports/download?token=… — tokenized download (no session).
publicDownloadRouter.get("/data-exports/download", async (req: Request, res: Response) => {
  const token = typeof req.query.token === "string" ? req.query.token.trim() : "";
  if (!token) {
    res.status(400).json({ error: "token_required" });
    return;
  }

  try {
    // Hash-then-lookup on the ELEVATED channel: there is no org context yet, so
    // the tenant channel would see zero rows. The unique hash resolves AT MOST
    // one row; the signed URL is then minted strictly for THAT row's org + key.
    const tokenHash = hashDownloadToken(token);
    const { rows } = await pgElevated.query<ExportFileRow>(
      `SELECT id, organization_id, r2_key, download_token_expires_at, purged_at
         FROM data_export_files
        WHERE download_token_hash = $1
        LIMIT 1`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) {
      res.status(404).json({ error: "export_not_found" });
      return;
    }
    if (row.purged_at != null) {
      res.status(410).json({ error: "export_purged" });
      return;
    }
    if (new Date(row.download_token_expires_at).getTime() <= Date.now()) {
      res.status(410).json({ error: "export_expired" });
      return;
    }
    await redirectToSignedUrl(req, res, row);
  } catch (err) {
    logger.error(
      { event: "data_export_token_download_failed", err },
      "GET /api/data-exports/download (tokenized) failed",
    );
    res.status(500).json({ error: "internal_error" });
  }
});

export { publicDownloadRouter as dataExportPublicDownloadRouter };
