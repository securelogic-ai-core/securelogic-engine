import { Router, type Request, type Response } from "express";

import adminOpsDashboardRouter from "./adminOpsDashboard.js";
import unsubscribeRouter from "./unsubscribe.js";
import registerRouter from "./register.js";
import accountRouter from "./account.js";
import accountRecoveryRouter from "./accountRecovery.js";

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
import adminApiKeysRouter from "./adminApiKeys.js";
import adminOrganizationsRouter from "./adminOrganizations.js";
import adminAuditLogRouter from "./adminAuditLog.js";
import issuesRouter from "./issues.js";
import intelligenceRouter from "./intelligence.js";

import assessRouter from "./assess.js";
import assessmentsRouter from "./assessments.js";
import findingsRouter from "./findings.js";
import actionsRouter from "./actions.js";
import postureRouter from "./posture.js";
import signalsRouter from "./signals.js";
import insightsRouter from "./insights.js";
import trendsRouter from "./trends.js";
import topRisksRouter from "./topRisks.js";
import topRisksSummaryRouter from "./topRisksSummary.js";
import billingRouter from "./billing.js";

import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";

import { enforceUsageCap } from "../middleware/enforceUsageCap.js";
import { tierRateLimit } from "../middleware/tierRateLimit.js";

import { adminLockout } from "../middleware/adminLockout.js";
import { requireAdminKey } from "../middleware/requireAdminKey.js";
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

  // Self-service registration — public, rate-limited (5/IP/hour)
  router.use("/api", registerRouter);
  router.use("/api", accountRecoveryRouter);

  // Account status — requireApiKey is inline; no entitlement gate (free tier must see own status)
  router.use("/api", accountRouter);

  router.use("/api", newsletterIssuesRouter);
  router.use("/api", newsletterDeliveriesRouter);
  router.use("/api", subscribersRouter);

  // =========================================================
  // ADMIN DASHBOARD PAGE (PUBLIC HTML, TOKEN USED IN JS CALLS)
  // =========================================================

  router.use("/admin/ops/dashboard", adminOpsDashboardRouter);

  // =========================================================
  // ADMIN SECURITY
  // =========================================================

  const adminChain = [
    adminLockout,      // pre-checks IP lockout, attaches lockout context; fails closed if Redis down
    requireAdminKey,   // timing-safe comparison, rotation support, records failures for lockout
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
  router.use("/admin", adminApiKeysRouter);
  router.use("/admin", adminOrganizationsRouter);
  router.use("/admin", adminAuditLogRouter);

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
  router.use("/issues", attachOrganizationContext);
  router.use("/issues", requireEntitlement("standard"));
  router.use("/issues", tierRateLimit);
  router.use("/issues", enforceUsageCap());

  router.use("/issues", (_req, res, next) => {
    if (!opts.publicApiDisabled) return next();

    res.status(503).json({
      error: "service_unavailable",
      reason: "public_api_disabled"
    });
  });

  router.use("/issues", issuesRouter);

  // =========================================================
  // INTELLIGENCE API
  // Serves newsletter issues from the pipeline directly.
  // Gated identically to /issues: API key + standard entitlement.
  // =========================================================

  router.use("/api/intelligence", requireApiKey);
  router.use("/api/intelligence", attachOrganizationContext);
  router.use("/api/intelligence", requireEntitlement("standard"));
  router.use("/api/intelligence", tierRateLimit);
  router.use("/api/intelligence", enforceUsageCap());
  router.use("/api", intelligenceRouter);

  // =========================================================
  // API ROUTES (engine + intelligence)
  // Each router owns its own requireApiKey + attachOrganizationContext
  // + requireEntitlement guards — mounted here for centralized routing.
  // =========================================================

  router.use("/api", billingRouter);
  router.use("/api", assessRouter);
  router.use("/api", assessmentsRouter);
  router.use("/api", findingsRouter);
  router.use("/api", actionsRouter);
  router.use("/api", postureRouter);
  router.use("/api", signalsRouter);
  router.use("/api", insightsRouter);
  router.use("/api", trendsRouter);
  router.use("/api", topRisksRouter);
  router.use("/api", topRisksSummaryRouter);

  return router;
}