import { Router, type Request, type Response } from "express";

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

import { requireApiKey } from "../middleware/requireApiKey.js";
import { resolveEntitlement } from "../middleware/resolveEntitlement.js";
import { requestAudit } from "../middleware/requestAudit.js";

import { enforceUsageCap } from "../middleware/enforceUsageCap.js";
import { tierRateLimit } from "../middleware/tierRateLimit.js";

import { requireSubscription } from "../middleware/requireSubscription.js";

import { requireAdminNetwork } from "../middleware/requireAdminNetwork.js";
import { adminLockout } from "../middleware/adminLockout.js";
import { requireAdminKey } from "../middleware/requireAdminKey.js";
import { adminRateLimit } from "../middleware/adminRateLimit.js";
import { adminAudit } from "../middleware/adminAudit.js";

import { isSignedIssue } from "../contracts/signedIssue.schema.js";
import type { SignedIssue } from "../contracts/signedIssue.schema.js";

import { verifyIssueSignature } from "../infra/verifyIssueSignature.js";
import { logger } from "../infra/logger.js";

import {
  getLatestIssueId,
  getIssueArtifact,
  publishIssueArtifact
} from "../infra/issueStore.js";

type RoutesOptions = {
  isDev: boolean;
  publicApiDisabled: boolean;
};

export function buildRoutes(opts: RoutesOptions): Router {
  const router = Router();

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

  router.use("/", emailProviderWebhookRouter);

  router.use("/api", newsletterIssuesRouter);
  router.use("/api", newsletterDeliveriesRouter);
  router.use("/api", subscribersRouter);

  const adminChain = [
    requireAdminNetwork,
    adminLockout,
    requireAdminKey,
    adminRateLimit,
    adminAudit
  ];

  router.use("/admin", ...adminChain);

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

  router.post("/admin/issues/publish", async (req: Request, res: Response) => {
    try {
      const parsed = req.body as unknown;

      if (!isSignedIssue(parsed)) {
        res.status(400).json({ error: "invalid_signed_issue_artifact" });
        return;
      }

      const artifact = parsed as SignedIssue;

      if (!verifyIssueSignature(artifact.issue, artifact.signature)) {
        res.status(400).json({ error: "issue_signature_invalid" });
        return;
      }

      const issueNumber = artifact.issue.issueNumber;

      if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
        res.status(400).json({ error: "invalid_issue_number" });
        return;
      }

      await publishIssueArtifact(issueNumber, JSON.stringify(artifact));

      res.status(200).json({
        ok: true,
        published: issueNumber
      });
    } catch (err) {
      logger.error(
        {
          event: "admin_issue_publish_failed",
          err
        },
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

  router.use("/issues", requireApiKey);
  router.use("/issues", resolveEntitlement);
  router.use("/issues", tierRateLimit);
  router.use("/issues", enforceUsageCap());
  router.use("/issues", requestAudit);

  router.use("/issues", (_req, res, next) => {
    if (!opts.publicApiDisabled) {
      next();
      return;
    }

    res.status(503).json({
      error: "service_unavailable",
      reason: "public_api_disabled"
    });
  });

  router.get(
    "/issues/latest",
    requireSubscription,
    async (_req: Request, res: Response) => {
      try {
        const latestId = await getLatestIssueId();

        if (!latestId) {
          res.status(404).json({ error: "no_issues_published" });
          return;
        }

        const raw = await getIssueArtifact(latestId);

        if (!raw) {
          res.status(404).json({ error: "no_issues_published" });
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          res.status(500).json({ error: "issue_artifact_corrupted" });
          return;
        }

        if (!isSignedIssue(parsed)) {
          res.status(500).json({ error: "issue_artifact_invalid" });
          return;
        }

        const artifact = parsed as SignedIssue;

        if (!opts.isDev) {
          if (!verifyIssueSignature(artifact.issue, artifact.signature)) {
            res.status(500).json({
              error: "issue_signature_verification_failed"
            });
            return;
          }
        }

        res.status(200).json(artifact.issue);
      } catch (err) {
        logger.error(
          {
            event: "issues_latest_failed",
            err
          },
          "GET /issues/latest failed"
        );

        res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.all("/issues/latest", (req: Request, res: Response) => {
    res.status(405).json({
      error: "method_not_allowed",
      allowed: ["GET"],
      method: req.method
    });
  });

  router.get(
    "/issues/:id",
    requireSubscription,
    async (req: Request, res: Response) => {
      try {
        const idNum = Number(req.params.id);

        if (!Number.isFinite(idNum) || idNum <= 0) {
          res.status(400).json({ error: "invalid_issue_id" });
          return;
        }

        const raw = await getIssueArtifact(idNum);

        if (!raw) {
          res.status(404).json({ error: "issue_not_found" });
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          res.status(500).json({ error: "issue_artifact_corrupted" });
          return;
        }

        if (!isSignedIssue(parsed)) {
          res.status(500).json({ error: "issue_artifact_invalid" });
          return;
        }

        const artifact = parsed as SignedIssue;

        if (!opts.isDev) {
          if (!verifyIssueSignature(artifact.issue, artifact.signature)) {
            res.status(500).json({
              error: "issue_signature_verification_failed"
            });
            return;
          }
        }

        res.status(200).json(artifact.issue);
      } catch (err) {
        logger.error(
          {
            event: "issues_get_by_id_failed",
            err
          },
          "GET /issues/:id failed"
        );

        res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.all("/issues/:id", (req: Request, res: Response) => {
    res.status(405).json({
      error: "method_not_allowed",
      allowed: ["GET"],
      method: req.method
    });
  });

  return router;
}
