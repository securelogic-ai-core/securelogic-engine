import { Router, type Request, type Response } from "express";

import adminOpsDashboardRouter from "./adminOpsDashboard.js";
import unsubscribeRouter from "./unsubscribe.js";

import newsletterIssuesRouter from "./newsletterIssues.js";
import newsletterDeliveriesRouter from "./newsletterDeliveries.js";
import subscribersRouter from "./subscribers.js";
import emailProviderWebhookRouter from "./emailProviderWebhook.js";

import adminEntitlementsRouter from "./adminEntitlements.js";
import adminSubscribersRouter from "./adminSubscribers.js";
import adminNewsletterIssuesRouter from "./adminNewsletterIssues.js";
import adminCreateNewsletterIssueRouter from "./adminCreateNewsletterIssue.js";
import adminUpdateNewsletterIssueRouter from "./adminUpdateNewsletterIssue.js";
import adminDeleteNewsletterIssueRouter from "./adminDeleteNewsletterIssue.js";
import adminPromoteNewsletterIssueRouter from "./adminPromoteNewsletterIssue.js";
import adminCancelNewsletterIssueRouter from "./adminCancelNewsletterIssue.js";
import adminDeadLetterNewsletterDeliveriesRouter from "./adminDeadLetterNewsletterDeliveries.js";
import adminRequeueNewsletterDeliveryRouter from "./adminRequeueNewsletterDelivery.js";
import adminRequeueNewsletterDeliveriesByIssueRouter from "./adminRequeueNewsletterDeliveriesByIssue.js";
import adminEmailSuppressionsRouter from "./adminEmailSuppressions.js";
import adminCreateEmailSuppressionRouter from "./adminCreateEmailSuppression.js";
import adminDeleteEmailSuppressionRouter from "./adminDeleteEmailSuppression.js";
import adminEmailProviderEventsRouter from "./adminEmailProviderEvents.js";
import adminDeliveryMetricsRouter from "./adminDeliveryMetrics.js";
import adminIssueDeliveryMetricsRouter from "./adminIssueDeliveryMetrics.js";
import adminOpsOverviewRouter from "./adminOpsOverview.js";
import adminOpsHealthRouter from "./adminOpsHealth.js";

import { requireApiKey } from "../middleware/requireApiKey.js";
import { resolveEntitlement } from "../middleware/resolveEntitlement.js";
import { requestAudit } from "../middleware/requestAudit.js";

import { enforceUsageCap } from "../middleware/enforceUsageCap.js";
import { tierRateLimit } from "../middleware/tierRateLimit.js";

import { requireAdminToken } from "../middleware/requireAdminToken.js";
import { adminRateLimit } from "../middleware/adminRateLimit.js";
import { adminAudit } from "../middleware/adminAudit.js";

import { isSignedIssue } from "../contracts/signedIssue.schema.js";
import type { SignedIssue } from "../contracts/signedIssue.schema.js";

import { verifyIssueSignature } from "../infra/verifyIssueSignature.js";
import { logger } from "../infra/logger.js";

import { publishIssueArtifact } from "../infra/issueStore.js";

type RoutesOptions = {
  isDev: boolean;
  publicApiDisabled: boolean;
};

export function buildRoutes(opts: RoutesOptions): Router {
  const router = Router();

  // =========================================================
  // HEALTH + VERSION
  // =========================================================

  router.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ status: "ok" });
  });

  router.all("/health", (req: Request, res: Response) => {
    res.status(405).json({
      error: "method_not_allowed",
      allowed: ["GET"],
      method: req.method
    });
  });

  router.get("/version", (_req: Request, res: Response) => {
    res.status(200).json({
      commit: process.env.RENDER_GIT_COMMIT ?? "unknown",
      service: "securelogic-engine",
      timestamp: new Date().toISOString()
    });
  });

  router.all("/version", (req: Request, res: Response) => {
    res.status(405).json({
      error: "method_not_allowed",
      allowed: ["GET"],
      method: req.method
    });
  });

  // =========================================================
  // PUBLIC ROUTES
  // =========================================================

  router.use("/", emailProviderWebhookRouter);
  router.use("/", unsubscribeRouter);

  router.use("/api", newsletterIssuesRouter);
  router.use("/api", newsletterDeliveriesRouter);
  router.use("/api", subscribersRouter);

  // =========================================================
  // ADMIN DASHBOARD PAGE (PUBLIC HTML, TOKEN USED IN JS CALLS)
  // =========================================================

  router.use("/admin/ops/dashboard", adminOpsDashboardRouter);

  // =========================================================
  // ADMIN SECURITY (TOKEN-BASED)
  // =========================================================

  const adminChain = [
    requireAdminToken,
    adminRateLimit,
    adminAudit
  ];

  router.use("/admin", ...adminChain);

  // =========================================================
  // ADMIN ROUTES
  // =========================================================

  router.use("/admin", adminEntitlementsRouter);
  router.use("/admin", adminSubscribersRouter);
  router.use("/admin", adminNewsletterIssuesRouter);
  router.use("/admin", adminCreateNewsletterIssueRouter);
  router.use("/admin", adminUpdateNewsletterIssueRouter);
  router.use("/admin", adminDeleteNewsletterIssueRouter);
  router.use("/admin", adminPromoteNewsletterIssueRouter);
  router.use("/admin", adminCancelNewsletterIssueRouter);
  router.use("/admin", adminDeadLetterNewsletterDeliveriesRouter);
  router.use("/admin", adminRequeueNewsletterDeliveryRouter);
  router.use("/admin", adminRequeueNewsletterDeliveriesByIssueRouter);
  router.use("/admin", adminEmailSuppressionsRouter);
  router.use("/admin", adminCreateEmailSuppressionRouter);
  router.use("/admin", adminDeleteEmailSuppressionRouter);
  router.use("/admin", adminEmailProviderEventsRouter);
  router.use("/admin", adminDeliveryMetricsRouter);
  router.use("/admin", adminIssueDeliveryMetricsRouter);
  router.use("/admin", adminOpsOverviewRouter);
  router.use("/admin", adminOpsHealthRouter);

  // =========================================================
  // ISSUE PUBLISH
  // =========================================================

  router.post("/admin/issues/publish", async (req: Request, res: Response) => {
    try {
      const parsed = req.body as unknown;

      if (!isSignedIssue(parsed)) {
        return res.status(400).json({ error: "invalid_signed_issue_artifact" });
      }

      const artifact = parsed as SignedIssue;

      if (!verifyIssueSignature(artifact.issue, artifact.signature)) {
        return res.status(400).json({ error: "issue_signature_invalid" });
      }

      const issueNumber = artifact.issue.issueNumber;

      if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
        return res.status(400).json({ error: "invalid_issue_number" });
      }

      await publishIssueArtifact(issueNumber, JSON.stringify(artifact));

      res.status(200).json({
        ok: true,
        published: issueNumber
      });
    } catch (err) {
      logger.error(
        { event: "admin_issue_publish_failed", err },
        "POST /admin/issues/publish failed"
      );

      res.status(500).json({ error: "internal_error" });
    }
  });

  router.all("/admin/issues/publish", (req: Request, res: Response) => {
    res.status(405).json({
      error: "method_not_allowed",
      allowed: ["POST"],
      method: req.method
    });
  });

  // =========================================================
  // PUBLIC ISSUE ACCESS
  // =========================================================

  router.use("/issues", requireApiKey);
  router.use("/issues", resolveEntitlement);
  router.use("/issues", tierRateLimit);
  router.use("/issues", enforceUsageCap());
  router.use("/issues", requestAudit);

  router.use("/issues", (_req, res, next) => {
    if (!opts.publicApiDisabled) return next();

    res.status(503).json({
      error: "service_unavailable",
      reason: "public_api_disabled"
    });
  });

  return router;
}