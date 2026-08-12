/**
 * seatRouteClassification.ts — the default-deny registry for the seat model.
 *
 * Every entitlement-gated route FILE is classified here. The classification is
 * the enforcement of "anything not explicitly allowed defaults DENY": a route
 * file that is not classified fails the coverage test, and the seat model must
 * not be switched on (SECURELOGIC_SEAT_MODEL_ENABLED) until no file remains in
 * NEEDS_WIRING — because a Contributor reaching an un-wired governance route
 * would read tenant-wide data the seat is meant to withhold.
 *
 * Classes:
 *   WIRED         — Contributor scope enforced (scoped reads + owner-guarded
 *                   mutations + denied aggregates). Proven by tests.
 *   NEEDS_WIRING  — carries Contributor-reachable governance data but is NOT yet
 *                   scoped. Until wired, the seat model stays OFF. This is the
 *                   default class for anything not proven safe — default deny.
 *   EXEMPT        — no Contributor mutation/leak surface: public/system routes,
 *                   or surfaces with no tenant governance rows. Reviewed, safe
 *                   as-is under the seat model.
 *
 * The seat model flag is OFF in every environment while NEEDS_WIRING is
 * non-empty. isSeatModelActivationReady() encodes that gate.
 */

/** Class B — Contributor scope enforced (scoped list/detail) and tested. */
export const WIRED_SCOPED_ROUTE_FILES: readonly string[] = [
  "findings.ts",
  "actions.ts",
  "evidence.ts",
  "vendors.ts",
  "controls.ts",
  "aiSystems.ts",
  "obligations.ts",
  "risks.ts",
  "riskTreatments.ts",
];

/**
 * Class A deny-all — a Contributor is denied every route (no trustworthy
 * ownership predicate exists on the underlying table, so per the default-deny
 * rule the whole family is denied rather than partially scoped).
 */
export const WIRED_DENY_ROUTE_FILES: readonly string[] = [
  "dependencies.ts", // the dependencies table has no user column
];

/** All families with Contributor protection actually applied. */
export const WIRED_ROUTE_FILES: readonly string[] = [
  ...WIRED_SCOPED_ROUTE_FILES,
  ...WIRED_DENY_ROUTE_FILES,
];

/**
 * Governance routes that still expose tenant-wide data to a Contributor and
 * MUST be scoped-or-denied before the seat model is enabled. Ordered roughly by
 * the program's remaining Phase 3b sequence (owner families, then assessment
 * families, then the long tail).
 */
export const NEEDS_WIRING_ROUTE_FILES: readonly string[] = [
  // Assessment / response families (assigned_to_user_id — Phase 1 migration)
  "requirements.ts",
  "controlAssessments.ts",
  "vendorReviews.ts",
  "governanceReviews.ts",
  "obligationAssessments.ts",
  "dependencyAssessments.ts",
  "vendorAssessments.ts",
  "assessments.ts",
  "aiGovernanceAssessments.ts",
  "assetAssessments.ts",
  // Governance operation / link / context / report surfaces
  "riskAcceptances.ts",
  "riskApprovals.ts",
  "riskLifecycle.ts",
  "riskControlLinks.ts",
  "riskObligationLinks.ts",
  "controlMappings.ts",
  "obligationMappings.ts",
  "frameworks.ts",
  "frameworkActivation.ts",
  "frameworkReadiness.ts",
  "policies.ts",
  "findingSavedViews.ts",
  "aiSystemVendorDependencies.ts",
  "aiSystemGovernanceContext.ts",
  "controlComplianceContext.ts",
  "obligationComplianceContext.ts",
  "vendorSignalContext.ts",
  "vendorAssessmentAnalysis.ts",
  "vendorAssuranceDocuments.ts",
  "cyberSignals.ts",
  "signalAiSystemLinks.ts",
  "signalControlLinks.ts",
  "signalObligationLinks.ts",
  "signalVendorLinks.ts",
  "signalMatchSuggestions.ts",
  "signals.ts",
  "intelligence.ts",
  "intelligenceBriefs.ts",
  "insights.ts",
  "trends.ts",
  "dashboard.ts",
  "dashboardPreferences.ts",
  "posture.ts",
  "topRisks.ts",
  "topRisksSummary.ts",
  "briefingChanges.ts",
  "briefingLayouts.ts",
  "templates.ts",
  "search.ts",
  "ask.ts",
  "assess.ts",
  // Reports / exports (also gated separately by export capability in Phase 6)
  "executiveReport.ts",
  "auditPackage.ts",
  "gapReport.ts",
  "findingsExport.ts",
  "risksExport.ts",
  "controlsExport.ts",
  "obligationsExport.ts",
  "aiSystemsExport.ts",
  // Admin / config (Class D — will be denyContributor or admin-only)
  "riskSettings.ts",
  "riskScale.ts",
  "riskScoringWeights.ts",
  "auditLog.ts",
  "webhooks.ts",
];

/** Reviewed as having no Contributor mutation/leak surface. */
export const EXEMPT_ROUTE_FILES: readonly string[] = [
  "sso.ts", // public ACS + admin-gated config (requireRole("admin"))
  "subscribers.ts", // public brief signup
  "transcribe.ts", // ask() audio helper, no governance rows
  "index.ts", // health/version/system mounting
  "newsletterDeliveries.ts", // operational, no per-contributor rows
  "newsletterIssues.ts",
];

export type SeatRouteClass = "WIRED" | "NEEDS_WIRING" | "EXEMPT" | "UNCLASSIFIED";

const WIRED = new Set(WIRED_ROUTE_FILES);
const NEEDS = new Set(NEEDS_WIRING_ROUTE_FILES);
const EXEMPT = new Set(EXEMPT_ROUTE_FILES);

export function classifyRouteFile(basename: string): SeatRouteClass {
  if (WIRED.has(basename)) return "WIRED";
  if (NEEDS.has(basename)) return "NEEDS_WIRING";
  if (EXEMPT.has(basename)) return "EXEMPT";
  return "UNCLASSIFIED";
}

/**
 * The activation gate. The seat model must not be enabled in any environment
 * until every governance route is either WIRED or EXEMPT — never NEEDS_WIRING.
 */
export function isSeatModelActivationReady(): boolean {
  return NEEDS_WIRING_ROUTE_FILES.length === 0;
}
