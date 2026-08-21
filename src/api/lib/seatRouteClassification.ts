/**
 * seatRouteClassification.ts — the default-deny registry for the seat model.
 *
 * Every entitlement-gated route FILE is classified here. An unclassified gated
 * file fails the coverage test — the CI enforcement of "anything not explicitly
 * allowed defaults DENY". Classes:
 *   WIRED_SCOPED  — Contributor read scope enforced (list filtered to owner,
 *                   detail 404 on non-owned) + mutations/aggregates denied.
 *   WIRED_DENY    — Contributor denied on every route (governance operations,
 *                   org-wide reads, signals, intelligence, reports, config, and
 *                   families with no trustworthy ownership predicate).
 *   EXEMPT        — no Contributor surface (public/system).
 *
 * NEEDS_WIRING is now empty: every governance family is WIRED or EXEMPT, so the
 * seat model is activation-ready (isSeatModelActivationReady() === true). The
 * flag remains OFF until an operator enables it per environment.
 */

/** Class B — Contributor read-scoped and tested. */
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
  "requirements.ts",
  "controlAssessments.ts",
  "vendorReviews.ts",
  "governanceReviews.ts",
  "obligationAssessments.ts",
  "dependencyAssessments.ts",
  "vendorAssessments.ts",
  "assessments.ts"
];

/** Class A deny-all for Contributors. */
export const WIRED_DENY_ROUTE_FILES: readonly string[] = [
  "aiGovernanceAssessments.ts",
  // SL-RISK-LINK. Deny-all, not read-scoped: deciding that a finding belongs on
  // the Risk Register is a governance act, and the reverse read
  // (/risks/:id/findings) is a cross-tenant-shaped roll-up with no trustworthy
  // per-Contributor ownership predicate — the same posture risks.ts takes on
  // risk creation. denyContributor() is on every route in the file.
  "findingRiskLinks.ts",
  "aiSystemGovernanceContext.ts",
  "aiSystemVendorDependencies.ts",
  "aiSystemsExport.ts",
  "ask.ts",
  // ASK-B confirm/decline (LC-5): denyContributor() on both routes, and the
  // executed mutation re-runs the target route's own chain, so a Contributor
  // could never reach execution anyway — deny-all is belt over braces.
  "askActions.ts",
  "assess.ts",
  "assetAssessments.ts",
  "auditLog.ts",
  "auditPackage.ts",
  "briefingChanges.ts",
  "briefingLayouts.ts",
  "controlComplianceContext.ts",
  "controlMappings.ts",
  "controlsExport.ts",
  "cyberSignals.ts",
  "dashboard.ts",
  "dashboardPreferences.ts",
  "dependencies.ts",
  "executiveReport.ts",
  "findingSavedViews.ts",
  "findingsExport.ts",
  "frameworkActivation.ts",
  "frameworkReadiness.ts",
  "frameworks.ts",
  "gapReport.ts",
  "insights.ts",
  "intelligence.ts",
  "intelligenceBriefs.ts",
  "obligationComplianceContext.ts",
  "obligationMappings.ts",
  "obligationsExport.ts",
  "policies.ts",
  "posture.ts",
  "riskAcceptances.ts",
  "riskApprovals.ts",
  "riskControlLinks.ts",
  "riskLifecycle.ts",
  "riskObligationLinks.ts",
  "riskScale.ts",
  "riskScoringWeights.ts",
  "riskSettings.ts",
  "risksExport.ts",
  "search.ts",
  "signalAiSystemLinks.ts",
  "signalControlLinks.ts",
  "signalMatchSuggestions.ts",
  "signalObligationLinks.ts",
  "signalVendorLinks.ts",
  "signals.ts",
  "templates.ts",
  "topRisks.ts",
  "topRisksSummary.ts",
  "trends.ts",
  "vendorAssessmentAnalysis.ts",
  "vendorAssuranceDocuments.ts",
  // Every route carries denyContributor(): opening an engagement, overriding an
  // inherent rating, issuing a vendor credential and recording a governance
  // decision are all owner/admin actions, and issuing in particular mints a
  // credential for a party outside the organisation.
  "vendorEngagements.ts",
  "vendorSignalContext.ts",
  "webhooks.ts"
];

/** All families with Contributor protection applied. */
export const WIRED_ROUTE_FILES: readonly string[] = [
  ...WIRED_SCOPED_ROUTE_FILES,
  ...WIRED_DENY_ROUTE_FILES,
];

/** Empty — every governance family is wired. */
export const NEEDS_WIRING_ROUTE_FILES: readonly string[] = [];

/** No Contributor surface (public/system). */
export const EXEMPT_ROUTE_FILES: readonly string[] = [
  "sso.ts",
  "subscribers.ts",
  "transcribe.ts",
  "index.ts",
  "newsletterDeliveries.ts",
  "newsletterIssues.ts"
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
/** The seat model is activation-ready when no governance family remains unwired. */
export function isSeatModelActivationReady(): boolean {
  return NEEDS_WIRING_ROUTE_FILES.length === 0;
}
