/**
 * accountDeletion.ts — GDPR Art.17 self-service deletion request + cancel
 * (D-5 self-only, D-6 30-day grace). The request endpoint moves the caller's
 * own user row to 'pending_deletion' and stamps the reap time
 * (deletion_scheduled_at = now() + 30 days); the gated enqueuer cron is the only
 * thing that turns that into a reap job once the window elapses.
 *
 * The request endpoint is gated by the reaper flag so a deletion can never be
 * requested while no reaper exists to collect it (which would strand the user,
 * unable to authenticate, forever). Cancel is always available — defence in
 * depth for any user already in the window.
 */

import { Router, type Request, type Response } from "express";
import { pg, withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import {
  accountDeletionReaperEnabled,
  DELETION_GRACE_DAYS,
} from "../lib/accountDeletionReaperPolicy.js";

const router = Router();
const authMiddleware = [requireApiKey, attachOrganizationContext];

function getOrgId(req: Request): string | null {
  return (req as any).organizationContext?.organizationId ?? null;
}
/** D-5: the actor deletes their OWN account; identity comes from the JWT (sub). */
function getUserId(req: Request): string | null {
  return ((req as any).jwtPayload?.sub as string | undefined) ?? null;
}

// POST /api/account/deletion — request erasure of the caller's own account.
router.post("/account/deletion", ...authMiddleware, async (req: Request, res: Response) => {
  if (!accountDeletionReaperEnabled()) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const orgId = getOrgId(req);
  const userId = getUserId(req);
  if (!orgId) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (!userId) {
    res.status(403).json({ error: "jwt_required", detail: "Requesting account deletion requires a signed-in user session." });
    return;
  }

  const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 1000) : null;

  try {
    const result = await withTenant(orgId, () =>
      pg.query<{ deletion_scheduled_at: string }>(
        `UPDATE users
            SET status = 'pending_deletion',
                deletion_scheduled_at = now() + make_interval(days => $3::int),
                deletion_requested_by_user_id = $1,
                deletion_reason = $4,
                updated_at = now()
          WHERE id = $1 AND organization_id = $2 AND status = 'active'
          RETURNING deletion_scheduled_at`,
        [userId, orgId, DELETION_GRACE_DAYS, reason]
      )
    );
    if ((result.rowCount ?? 0) === 0) {
      res.status(409).json({ error: "not_deletable", detail: "Account is not active (already pending deletion or deleted)." });
      return;
    }
    const scheduledFor = result.rows[0]!.deletion_scheduled_at;
    writeAuditEvent({
      organizationId: orgId,
      actorUserId: userId,
      eventType: "account.deletion_requested",
      resourceType: "user",
      resourceId: userId,
      payload: { reason, scheduled_for: scheduledFor },
    });
    logger.info({ event: "account_deletion_requested", org_id: orgId, scheduled_for: scheduledFor }, "Account deletion requested");
    res.status(202).json({ ok: true, status: "pending_deletion", scheduled_for: scheduledFor, grace_days: DELETION_GRACE_DAYS });
  } catch (err) {
    logger.error({ event: "account_deletion_request_failed", err }, "POST /api/account/deletion failed");
    res.status(500).json({ error: "deletion_request_failed" });
  }
});

// POST /api/account/deletion/cancel — cancel during the grace window (D-6).
router.post("/account/deletion/cancel", ...authMiddleware, async (req: Request, res: Response) => {
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
    const result = await withTenant(orgId, () =>
      pg.query(
        `UPDATE users
            SET status = 'active',
                deletion_scheduled_at = NULL,
                deletion_requested_by_user_id = NULL,
                deletion_reason = NULL,
                updated_at = now()
          WHERE id = $1 AND organization_id = $2 AND status = 'pending_deletion'
          RETURNING id`,
        [userId, orgId]
      )
    );
    if ((result.rowCount ?? 0) === 0) {
      res.status(409).json({ error: "not_pending_deletion", detail: "Account is not pending deletion." });
      return;
    }
    writeAuditEvent({
      organizationId: orgId,
      actorUserId: userId,
      eventType: "account.deletion_cancelled",
      resourceType: "user",
      resourceId: userId,
    });
    logger.info({ event: "account_deletion_cancelled", org_id: orgId }, "Account deletion cancelled");
    res.status(200).json({ ok: true, status: "active" });
  } catch (err) {
    logger.error({ event: "account_deletion_cancel_failed", err }, "POST /api/account/deletion/cancel failed");
    res.status(500).json({ error: "deletion_cancel_failed" });
  }
});

export default router;
