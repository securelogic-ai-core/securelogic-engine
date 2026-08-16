import { Router, type Request, type Response } from "express";

import adminOpsDashboardRouter from "./adminOpsDashboard.js";
import unsubscribeRouter from "./unsubscribe.js";
import accountRouter from "./account.js";
import accountRecoveryRouter from "./accountRecovery.js";
import dataExportsRouter, { dataExportPublicDownloadRouter } from "./dataExports.js";

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
import adminSuppressionsRouter from "./adminSuppressions.js";
import adminEmailDeliverabilityRouter from "./adminEmailDeliverability.js";
import adminProviderSuppressionRecoveryRouter from "./adminProviderSuppressionRecovery.js";
import adminEmailEnvironmentEvidenceRouter from "./adminEmailEnvironmentEvidence.js";
import adminBriefSubscribersRouter from "./adminBriefSubscribers.js";
import adminIssuesRouter from "./adminIssues.js";
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
import vendorsRouter from "./vendors.js";
import vendorAssessmentsRouter from "./vendorAssessments.js";
import aiSystemsRouter from "./aiSystems.js";
import aiSystemsExportRouter from "./aiSystemsExport.js";
import governanceReviewsRouter from "./governanceReviews.js";
import aiGovernanceAssessmentsRouter from "./aiGovernanceAssessments.js";
import frameworksRouter from "./frameworks.js";
import frameworkReadinessRouter from "./frameworkReadiness.js";
import frameworkActivationRouter from "./frameworkActivation.js";
import requirementsRouter from "./requirements.js";
import controlsRouter from "./controls.js";
import controlsExportRouter from "./controlsExport.js";
import controlMappingsRouter from "./controlMappings.js";
import controlAssessmentsRouter from "./controlAssessments.js";
import obligationsRouter from "./obligations.js";
import obligationsExportRouter from "./obligationsExport.js";
import obligationMappingsRouter from "./obligationMappings.js";
import obligationAssessmentsRouter from "./obligationAssessments.js";
import evidenceRouter from "./evidence.js";
import dependenciesRouter from "./dependencies.js";
import dependencyAssessmentsRouter from "./dependencyAssessments.js";
import vendorReviewsRouter from "./vendorReviews.js";
import vendorAssessmentAnalysisRouter from "./vendorAssessmentAnalysis.js";
import vendorAssuranceDocumentsRouter from "./vendorAssuranceDocuments.js";
import vendorSignalContextRouter from "./vendorSignalContext.js";
import vendorPortalRouter from "./vendorPortal.js";
import vendorEngagementsRouter from "./vendorEngagements.js";
import controlComplianceContextRouter from "./controlComplianceContext.js";
import obligationComplianceContextRouter from "./obligationComplianceContext.js";
import aiSystemGovernanceContextRouter from "./aiSystemGovernanceContext.js";
import risksRouter from "./risks.js";
import risksExportRouter from "./risksExport.js";
import searchRouter from "./search.js";
import riskTreatmentsRouter from "./riskTreatments.js";
import riskControlLinksRouter from "./riskControlLinks.js";
import riskObligationLinksRouter from "./riskObligationLinks.js";
import riskSettingsRouter from "./riskSettings.js";
import riskLifecycleRouter from "./riskLifecycle.js";
import riskApprovalsRouter from "./riskApprovals.js";
import riskAcceptancesRouter from "./riskAcceptances.js";
import cyberSignalsRouter from "./cyberSignals.js";
import signalVendorLinksRouter from "./signalVendorLinks.js";
import signalAiSystemLinksRouter from "./signalAiSystemLinks.js";
import signalControlLinksRouter from "./signalControlLinks.js";
import signalObligationLinksRouter from "./signalObligationLinks.js";
import signalMatchSuggestionsRouter from "./signalMatchSuggestions.js";
import enterpriseEntitiesRouter from "./enterpriseEntities.js";
import enterpriseRelationshipsRouter from "./enterpriseRelationships.js";
import enterpriseGraphRouter from "./enterpriseGraph.js";
import enterpriseContextImportRouter from "./enterpriseContextImport.js";
import applicabilityAssessmentsRouter from "./applicabilityAssessments.js";
import enterpriseContextStatsRouter from "./enterpriseContextStats.js";
import assetsRouter from "./assets.js";
import riskIntelligenceRouter from "./riskIntelligence.js";
import intelligenceEventsRouter from "./intelligenceEvents.js";
import predictiveIntelligenceRouter from "./predictiveIntelligence.js";
import orchestrationRouter from "./orchestration.js";
import knowledgeGraphRouter from "./knowledgeGraph.js";
import assetAssessmentsRouter from "./assetAssessments.js";
import connectorsRouter from "./connectors.js";
import templatesRouter from "./templates.js";
import aiSystemVendorDependenciesRouter from "./aiSystemVendorDependencies.js";
import riskScoringWeightsRouter from "./riskScoringWeights.js";
import dashboardRouter from "./dashboard.js";
import postureRouter from "./posture.js";
import signalsRouter from "./signals.js";
import insightsRouter from "./insights.js";
import trendsRouter from "./trends.js";
import topRisksRouter from "./topRisks.js";
import topRisksSummaryRouter from "./topRisksSummary.js";
import billingRouter from "./billing.js";
import customerAuthRouter from "./customerAuth.js";
import mfaRouter from "./mfa.js";
import orgSettingsRouter from "./orgSettings.js";
import publicBriefSignupRouter from "./publicBriefSignup.js";
import intelligenceBriefsRouter from "./intelligenceBriefs.js";
import adminBriefsRouter from "./adminBriefs.js";
import auditLogRouter from "./auditLog.js";
import teamInvitesRouter from "./teamInvites.js";
import accountDeletionRouter from "./accountDeletion.js";
import auditPackageRouter from "./auditPackage.js";
import gapReportRouter from "./gapReport.js";
import findingsExportRouter from "./findingsExport.js";
import alertPreferencesRouter from "./alertPreferences.js";
import dashboardPreferencesRouter from "./dashboardPreferences.js";
import findingSavedViewsRouter from "./findingSavedViews.js";
import briefingLayoutsRouter from "./briefingLayouts.js";
import briefingChangesRouter from "./briefingChanges.js";
import policiesRouter from "./policies.js";
import ssoRouter from "./sso.js";
import customerApiKeysRouter from "./customerApiKeys.js";
import webhooksRouter from "./webhooks.js";
import askRouter from "./ask.js";
import askActionsRouter from "./askActions.js";
import transcribeRouter from "./transcribe.js";
import riskScaleRouter from "./riskScale.js";
import executiveReportRouter from "./executiveReport.js";

import { requireApiKey } from "../middleware/requireApiKey.js";
import { requireConsent } from "../middleware/requireConsent.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { trackApiUsage } from "../middleware/trackApiUsage.js";

import { enforceUsageCap } from "../middleware/enforceUsageCap.js";
import { tierRateLimit } from "../middleware/tierRateLimit.js";
import {
  createApiKeyRateLimiter,
  createOrgRateLimiter
} from "../middleware/apiRateLimiter.js";

import { pg } from "../infra/postgres.js";
import { requireAdminNetwork } from "../middleware/requireAdminNetwork.js";
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

  router.get("/health", async (_req: Request, res: Response) => {
    try {
      await pg.query("SELECT 1");
      res.status(200).json({
        status: "ok",
        db: "connected",
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({
        status: "degraded",
        db: "unreachable",
        timestamp: new Date().toISOString(),
      });
    }
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
      branch: process.env.RENDER_GIT_BRANCH ?? "unknown",
      deployedAt: new Date().toISOString()
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

  // Public marketing signup — no API key, rate-limited (5/IP/min)
  router.use("/api", publicBriefSignupRouter);

  router.use("/api", accountRecoveryRouter);

  // GDPR self-export tokenized download — session-optional (no API key / no
  // login). Mounted in the PUBLIC section, BEFORE requireConsent + the API-key
  // rate limiter, so a future emailed download link resolves with no session.
  // It resolves the file strictly by SHA-256 token hash (Decisions E/F).
  router.use("/api", dataExportPublicDownloadRouter);

  // Customer email/password auth — public (rate-limited), JWT-issuing
  router.use("/api", customerAuthRouter);

  // GDPR Art.17 self-service account deletion request + cancel — JWT-protected,
  // request gated by the reaper flag (404 when disabled)
  router.use("/api", accountDeletionRouter);

  // MFA routes — mix of public (verify, use-backup) and JWT-protected (setup, disable, reset)
  router.use("/api", mfaRouter);

  // Org-level security settings — JWT-protected
  router.use("/api", orgSettingsRouter);

  // SAML 2.0 SSO — public endpoints (check-domain, login, acs, metadata) + protected config endpoints
  router.use("/api", ssoRouter);

  // Legal-consent gate. Mounted AFTER all /api/auth/* routers (auth, mfa, sso)
  // so login + POST /api/auth/accept-terms remain reachable, and BEFORE the
  // authenticated platform routers below. Only gates JWT (human) sessions;
  // raw machine API keys pass through. Fails open on DB error. See
  // middleware/requireConsent.ts for scope rationale.
  router.use("/api", requireConsent);

  // Customer self-service API key management — own requireApiKey inline
  router.use("/api", customerApiKeysRouter);

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
    // FIRST, deliberately. An off-network caller is turned away before it can
    // burn a lockout counter that legitimate admins share, before any
    // timing-safe key comparison runs, and before it consumes rate-limit
    // budget. DARK until SECURELOGIC_ADMIN_NETWORK_ENFORCED="true" — see
    // middleware/requireAdminNetwork.ts for why enabling it blind would lock
    // every operator out of production.
    requireAdminNetwork,
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
  router.use("/admin", adminSuppressionsRouter);
  // Joins the provider's suppression list, our mirror of it, and the account
  // itself into the one answer a support ticket needs. Read-only.
  router.use("/admin", adminEmailDeliverabilityRouter);
  // The remediation half. Mutates the Resend account shared by prod/staging/
  // demo, so the clear is gated on APP_ENV=production AND an explicit flag —
  // see lib/providerSuppressionRecoveryPolicy.ts. Must stay inside adminChain.
  router.use("/admin", adminProviderSuppressionRecoveryRouter);
  // P1-2 "prove" step: what enforcement WOULD have dropped on this receiver,
  // computed with the same classifier the webhook uses. Read-only; enables
  // nothing.
  router.use("/admin", adminEmailEnvironmentEvidenceRouter);
  router.use("/admin", adminBriefSubscribersRouter);
  router.use("/admin", adminIssuesRouter);
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
  // API RATE LIMITING (global — all /api/* routes)
  // 120 requests per minute per API key. Applied before individual
  // route guards so every /api/* path is covered. Fails open when
  // Redis is unavailable. Health endpoints are excluded (mounted
  // separately above without this middleware).
  // =========================================================

  const defaultApiRateLimiter = createApiKeyRateLimiter(120);
  router.use("/api", defaultApiRateLimiter);

  // Fire-and-forget daily usage counter — runs after rate limit check,
  // before route handlers. Never delays or blocks requests.
  router.use("/api", trackApiUsage);

  // Specialized limiters — applied inline at their respective route paths
  // after requireApiKey + attachOrganizationContext have run.
  const signalIngestRateLimiter = createOrgRateLimiter(10, "signal_ingest");
  const briefGenerationRateLimiter = createOrgRateLimiter(5, "brief_generate");

  // Cyber signal ingest — 10 per minute per org (expensive pipeline operation)
  router.post("/api/cyber-signals", signalIngestRateLimiter);
  router.post("/api/cyber-signals/fetch/:source", signalIngestRateLimiter);

  // Intelligence brief generation — 5 per minute per org
  router.post("/api/intelligence-briefs/generate", briefGenerationRateLimiter);

  // =========================================================
  // API ROUTES (engine + intelligence)
  // Each router owns its own requireApiKey + attachOrganizationContext;
  // entitlement gating is per-router, NOT universal. Engine/intelligence
  // routers add their own requireEntitlement (as /issues + /api/intelligence
  // do above), but self-service routers deliberately carry NO entitlement
  // gate — e.g. dataExportsRouter, where GDPR/CCPA data-subject access &
  // portability rights are not tier-gated (same rationale as accountRouter's
  // "free tier must see own status"). Mounted here for centralized routing.
  // =========================================================

  router.use("/api", billingRouter);
  router.use("/api", assessRouter);
  router.use("/api", assessmentsRouter);
  // findingsExportRouter MUST mount before findingsRouter: its literal path
  // /findings/export.csv is otherwise captured by GET /findings/:id, which
  // rejects "export.csv" as a non-UUID id (staging EXP-1).
  router.use("/api", findingsExportRouter);
  router.use("/api", findingsRouter);
  router.use("/api", actionsRouter);
  router.use("/api", vendorsRouter);
  router.use("/api", vendorAssessmentsRouter);
  router.use("/api", vendorReviewsRouter);
  router.use("/api", vendorAssessmentAnalysisRouter);
  router.use("/api", vendorAssuranceDocumentsRouter);
  router.use("/api", vendorEngagementsRouter);
  router.use("/api", vendorSignalContextRouter);
  // EXTERNAL surface — reachable without a platform account. Every route inside
  // is flag-gated and resolves its identity from a portal session row, never
  // from the request. See src/api/routes/vendorPortal.ts before adding to it.
  router.use("/api", vendorPortalRouter);
  router.use("/api", controlComplianceContextRouter);
  router.use("/api", obligationComplianceContextRouter);
  router.use("/api", aiSystemGovernanceContextRouter);
  // Export before register — GET /ai-systems/:id captures export.csv otherwise.
  router.use("/api", aiSystemsExportRouter);
  router.use("/api", aiSystemsRouter);
  router.use("/api", governanceReviewsRouter);
  router.use("/api", aiGovernanceAssessmentsRouter);
  router.use("/api", frameworkActivationRouter);
  router.use("/api", frameworkReadinessRouter);
  router.use("/api", frameworksRouter);
  router.use("/api", requirementsRouter);
  // Export routers MUST mount before their register routers: GET /:id would
  // otherwise capture the literal /export.csv path (the findingsExport trap).
  router.use("/api", controlsExportRouter);
  router.use("/api", controlsRouter);
  router.use("/api", controlMappingsRouter);
  router.use("/api", controlAssessmentsRouter);
  router.use("/api", obligationsExportRouter);
  router.use("/api", obligationsRouter);
  router.use("/api", obligationMappingsRouter);
  router.use("/api", obligationAssessmentsRouter);
  router.use("/api", evidenceRouter);
  router.use("/api", dependenciesRouter);
  router.use("/api", dependencyAssessmentsRouter);
  // risksExportRouter MUST mount before risksRouter: its literal path
  // /risks/export.csv is otherwise captured by GET /risks/:id (same trap
  // findingsExport documents above).
  router.use("/api", risksExportRouter);
  router.use("/api", risksRouter);
  router.use("/api", searchRouter);
  router.use("/api", riskTreatmentsRouter);
  router.use("/api", riskControlLinksRouter);
  router.use("/api", riskObligationLinksRouter);
  router.use("/api", riskSettingsRouter);
router.use("/api", riskLifecycleRouter);
router.use("/api", riskApprovalsRouter);
router.use("/api", riskAcceptancesRouter);
  router.use("/api", cyberSignalsRouter);
  router.use("/api", signalVendorLinksRouter);
  router.use("/api", signalAiSystemLinksRouter);
  router.use("/api", signalControlLinksRouter);
  router.use("/api", signalObligationLinksRouter);
  router.use("/api", signalMatchSuggestionsRouter);
  // Enterprise Context Layer (Slice 1). Unconditional mount; the ECL feature flag
  // (SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED, default off → 404 before auth) gates
  // the surface in-router.
  router.use("/api", enterpriseEntitiesRouter);
  router.use("/api", enterpriseRelationshipsRouter);
  router.use("/api", enterpriseGraphRouter);
  router.use("/api", enterpriseContextImportRouter);
  router.use("/api", applicabilityAssessmentsRouter);
  router.use("/api", enterpriseContextStatsRouter);
  // Enterprise Asset Registry (Phase 0). Same unconditional-mount pattern; its
  // OWN flag (SECURELOGIC_ASSET_REGISTRY_ENABLED, default off → 404 before
  // auth) gates the surface in-router.
  router.use("/api", assetsRouter);
  router.use("/api", riskIntelligenceRouter);
  // Intelligence Pipeline Hardening / IE.P7: canonical event read surface. OWN
  // flag (SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED, default off → 404 before auth).
  router.use("/api", intelligenceEventsRouter);
  router.use("/api", predictiveIntelligenceRouter);
  router.use("/api", orchestrationRouter);
  router.use("/api", knowledgeGraphRouter);
  // EAR P10: generic asset-assessment service — same registry flag (404
  // before auth, default off).
  router.use("/api", assetAssessmentsRouter);
  // EAR Phase 3b: connector config + sync. Double-fenced in-router (ECL flag
  // AND registry flag, both default off → 404 before auth).
  router.use("/api", connectorsRouter);
  router.use("/api", templatesRouter);
  router.use("/api", aiSystemVendorDependenciesRouter);
  router.use("/api", riskScoringWeightsRouter);
  router.use("/api", dashboardRouter);
  router.use("/api", postureRouter);
  router.use("/api", signalsRouter);
  router.use("/api", insightsRouter);
  router.use("/api", trendsRouter);
  router.use("/api", topRisksRouter);
  router.use("/api", topRisksSummaryRouter);
  router.use("/api", intelligenceBriefsRouter);
  router.use("/api", auditLogRouter);
  router.use("/api", teamInvitesRouter);
  router.use("/api", auditPackageRouter);
  router.use("/api", gapReportRouter);
  // GDPR self-export intake + authenticated list/download (each route owns
  // requireApiKey + attachOrganizationContext). The session-optional tokenized
  // download lives in dataExportPublicDownloadRouter, mounted above.
  router.use("/api", dataExportsRouter);
  router.use("/api", alertPreferencesRouter);
  router.use("/api", dashboardPreferencesRouter);
  router.use("/api", findingSavedViewsRouter);
  router.use("/api", briefingLayoutsRouter);
  router.use("/api", briefingChangesRouter);
  router.use("/api", policiesRouter);
  router.use("/api", webhooksRouter);
  router.use("/api", askRouter);
  router.use("/api", askActionsRouter);
  router.use("/api", transcribeRouter);
  router.use("/api", riskScaleRouter);
  router.use("/api", executiveReportRouter);

  // Admin brief operations — own bearer-token auth (SCHEDULER_SECRET),
  // independent of the admin panel key and org API key systems.
  router.use("/api", adminBriefsRouter);

  return router;
}