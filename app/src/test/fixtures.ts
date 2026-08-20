/**
 * Typed fixtures. They are the REAL exported types, so a fixture that drifts from the
 * wire contract fails typecheck rather than quietly testing a shape the engine stopped
 * sending.
 */
import type {
  Action,
  ActionsResponse,
  ActionsSummary,
  Finding,
  FindingsResponse,
  FindingsSummary,
  MeResponse,
  RiskAcceptance,
} from "@/lib/api";

export function aFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "f-1",
    organization_id: "org-1",
    assessment_id: null,
    source_type: "manual",
    source_id: null,
    title: "Unencrypted backups in eu-west-1",
    severity: "High",
    description: "Backups are written without server-side encryption.",
    recommendation: "Enable SSE-KMS on the backup bucket.",
    framework_control_id: null,
    domain: "Cyber",
    priority: "planned",
    likelihood: null,
    confidence: null,
    time_sensitivity: null,
    scoring_rationale: null,
    status: "open",
    owner_user_id: null,
    due_date: null,
    action_count: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function aFindingsResponse(
  findings: Finding[],
  overrides: Partial<FindingsResponse> = {}
): FindingsResponse {
  return {
    count: findings.length,
    limit: 100,
    total: findings.length,
    organizationId: "org-1",
    nextCursor: null,
    findings,
    ...overrides,
  };
}

export function aFindingsSummary(
  overrides: Partial<FindingsSummary> = {}
): FindingsSummary {
  return {
    // STRICTLY OPEN (lifecycle) vs ACTIVE (enterprise). Deliberately DIFFERENT
    // numbers: a fixture where they coincide cannot catch a tile reading the
    // wrong population — which is the whole defect this convergence fixed.
    open_count: 2,
    in_progress_open: 1,
    active_total: 3,
    critical_high_active: 1,
    critical_active: 2,
    high_active: 1,
    medium_active: 0,
    low_active: 0,
    critical_open: 1,
    high_open: 1,
    medium_open: 0,
    low_open: 0,
    closed_count: 4,
    immediate_priority: 0,
    vendor_sourced: 0,
    signal_sourced: 0,
    ...overrides,
  };
}

export function aMe(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    entitlementLevel: "platform",
    ...overrides,
  } as MeResponse;
}

/**
 * A remediation Action. `is_overdue` is SERVER-decided (Metric Contract) — the
 * fixture carries it rather than deriving it, exactly as the wire does, so a test
 * cannot accidentally re-introduce the client-side NOW()-vs-CURRENT_DATE drift.
 */
export function anAction(overrides: Partial<Action> = {}): Action {
  return {
    id: "a-1",
    organization_id: "org-1",
    title: "Enable SSE-KMS on the backup bucket",
    description: "Turn on server-side encryption for eu-west-1 backups.",
    action_type: "remediation",
    source_type: "finding",
    source_id: "f-1",
    priority: "planned",
    due_date: null,
    owner_user_id: null,
    status: "open",
    completed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    is_overdue: false,
    ...overrides,
  };
}

export function anActionsResponse(
  actions: Action[],
  overrides: Partial<ActionsResponse> = {}
): ActionsResponse {
  return {
    count: actions.length,
    limit: 100,
    total: actions.length,
    organizationId: "org-1",
    nextCursor: null,
    actions,
    ...overrides,
  };
}

/** Authoritative org-wide counts. open_count = ACTIVE (open|in_progress|blocked). */
export function anActionsSummary(
  overrides: Partial<ActionsSummary> = {}
): ActionsSummary {
  return {
    open_count: 3,
    open_only_count: 1,
    in_progress_count: 1,
    blocked_count: 1,
    overdue_count: 1,
    immediate_count: 1,
    closed_count: 5,
    // Server-computed, narrowed to the caller — what the "My Actions" tiles read.
    // Distinct from the org counts above ON PURPOSE: a fixture where they matched
    // would let a view that shows the ORG's number in a personal queue pass.
    my_open_count: 1,
    my_overdue_count: 0,
    ...overrides,
  };
}

// ── Dashboard fixtures (appended — /dashboard render coverage) ───────
// A second import block, deliberately: fixtures.ts is edited by several suites at
// once, and appending is the only conflict-free way to add to it.
import type {
  AuthMeResponse,
  DashboardSummary,
  DomainScore,
  Framework,
  FrameworkReadiness,
  PostureSnapshot,
} from "@/lib/api";

export function aDomainScore(overrides: Partial<DomainScore> = {}): DomainScore {
  return {
    domain: "Cyber",
    score: 72,
    severity: "High",
    finding_count: 3,
    action_count: 2,
    trend_direction: "worsening",
    ...overrides,
  };
}

/**
 * The dashboard summary as the ENGINE actually sends it.
 *
 * `findings.open` is a deprecated ALIAS for the ACTIVE total (open + in_progress) —
 * see src/api/routes/dashboard.ts ("`open` is a DEPRECATED ALIAS carrying the
 * identical value"). The default below therefore carries an active population whose
 * severity buckets sum to it, so a tile that displays this number is displaying
 * ACTIVE findings, whatever it calls them.
 *
 * `actions.active` = open|in_progress|blocked, the same number the /actions
 * destination shows.
 */
export function aDashboardSummary(
  overrides: Partial<DashboardSummary> = {}
): DashboardSummary {
  return {
    posture: {
      overall_score: 67,
      overall_severity: "Moderate",
      snapshot_date: "2026-06-01T00:00:00.000Z",
    },
    domains: [aDomainScore()],
    findings: {
      open: 8, // active total: 2 Critical + 3 High + 2 Moderate + 1 Low
      by_severity: { Critical: 2, High: 3, Moderate: 2, Low: 1 },
      avg_age_days: 12,
      max_age_days: 40,
      older_than_30: 1,
      older_than_7: 3,
    },
    actions: {
      open: 4,
      in_progress: 2,
      blocked: 1,
      active: 7,
      overdue: 3,
      avg_age_days: 9,
      max_age_days: 33,
      older_than_30: 1,
      older_than_7: 2,
    },
    controls_cadence: { overdue: 2 },
    risks_summary: {
      open: 6,
      by_risk_rating: { Critical: 1, High: 2, Moderate: 1, Low: 1, Unscored: 1 },
      by_residual_rating: { Critical: 1, High: 2, Moderate: 1, Low: 1, Unscored: 1 },
      by_residual_likelihood_impact: [
        { likelihood: "likely", impact: "Critical", count: 2 },
        { likelihood: "rare", impact: "Low", count: 1 },
      ],
    },
    inventory: {
      vendors: 8,
      ai_systems: 3,
      controls: 12,
      control_assessments: 5,
      governance_reviews: 2,
      frameworks: 2,
      risks: 6,
      obligations: 4,
    },
    vendor_risk: {
      by_criticality: { critical: 1, high: 2, medium: 3, low: 2, uncategorized: 0 },
      total: 8,
      high_or_critical: 3,
    },
    ...overrides,
  };
}

export function aFramework(overrides: Partial<Framework> = {}): Framework {
  return {
    id: "fw-1",
    organization_id: "org-1",
    name: "NIST CSF",
    version: "2.0",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function aFrameworkReadiness(
  overrides: Partial<FrameworkReadiness> = {}
): FrameworkReadiness {
  return {
    framework: { id: "fw-1", name: "NIST CSF", version: "2.0" },
    readiness_score: 55,
    total_requirements: 20,
    satisfied: 11,
    partial: 4,
    unmapped: 5,
    coverage_caption: "11 fully satisfied · 4 partial · 5 unmapped",
    requirements: [],
    ...overrides,
  };
}

export function aPostureSnapshot(
  overrides: Partial<PostureSnapshot> = {}
): PostureSnapshot {
  return {
    id: "snap-1",
    snapshot_date: "2026-06-01",
    overall_score: 67,
    overall_severity: "Moderate",
    open_finding_count: 8,
    open_action_count: 7,
    overdue_action_count: 3,
    created_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

export function anAuthMe(overrides: Partial<AuthMeResponse> = {}): AuthMeResponse {
  return {
    id: "user-1",
    email: "user@example.com",
    name: "Test User",
    role: "member",
    organizationId: "org-1",
    organizationName: "Test Org",
    entitlementLevel: "platform",
    billingActive: true,
    emailSuppressed: false,
    onboardingCompleted: true,
    previousLoginAt: null,
    ...overrides,
  };
}

// ── Decision Workspace fixtures (appended — /findings/[id] render coverage) ──
import type { FindingContext } from "@/lib/api";

/**
 * GET /api/findings/:id/context — the payload the Decision Workspace renders.
 *
 * The default is the HONEST-UNKNOWN shape, not a flattering one: every impact
 * dimension `not_assessed` and every affected bucket `none_found`. A fixture that
 * defaulted to "low"/"resolved" would let the exact defect class this page keeps
 * regressing on (#637 — a resolver failure is not a zero) pass unnoticed, because
 * the interesting states would only ever be reached by explicit override.
 *
 * Shallow merge: sub-objects (`business_impact`, `affected`, …) are replaced whole,
 * which is what a wire payload does anyway.
 */
export function aFindingContext(
  overrides: Partial<FindingContext> = {}
): FindingContext {
  return {
    finding: {
      id: "f-1",
      source_type: "manual",
      source_id: null,
      decision_state: "needs_review",
      operational_status: "open",
    },
    risk: { score: 61, band: "High", rationale: ["Severity: High"] },
    business_impact: {
      operational: { level: "not_assessed", note: "" },
      regulatory: { level: "not_assessed", note: "" },
      third_party: { level: "not_assessed", note: "" },
    },
    owner: null,
    affected: {
      vendors: [],
      ai_systems: [],
      controls: [],
      obligations: [],
      resolution: {
        vendors: "none_found",
        ai_systems: "none_found",
        controls: "none_found",
        obligations: "none_found",
      },
      candidates: [],
    },
    intelligence: { events: [], sources: [], timeline: [], signal_ids: [] },
    evidence: [],
    related_findings: [],
    related_context: { same_vendor: [] },
    activity: [],
    whats_changed: { since: null, changes: [] },
    ...overrides,
  };
}

// ── Review-queue + Brief fixtures (appended — /queue and /briefs coverage) ──
import type {
  BriefSignal,
  IntelligenceBriefDetailResponse,
  IntelligenceBriefItem,
  IssuesResponse,
  NewsletterIssue,
  SignalMatchSuggestionCounts,
  SignalMatchSuggestionsResponse,
} from "@/lib/api";
import type { EnrichedSuggestion } from "@/components/queue/SuggestionList";

/**
 * A row of the Review-Suggested-Links queue, as the ENGINE enriches it
 * (SUGGESTION_ENRICHED_SELECT: target_name + event_* fields).
 *
 * The defaults are deliberately hostile: `match_reason` is a raw matcher code and
 * `signal_id` is a real UUID. Both are internal vocabulary, and a fixture that
 * pre-sanitized them could not catch them leaking to a customer.
 */
export function aSuggestion(
  overrides: Partial<EnrichedSuggestion> = {}
): EnrichedSuggestion {
  return {
    id: "sug-1",
    organization_id: "org-1",
    signal_id: "3f2a1b2c-9d4e-4f7a-8b1c-2e5d6a7b8c9d",
    target_type: "vendor",
    target_id: "11111111-2222-4333-8444-555555555555",
    match_reason: "vendor_name_ilike",
    match_score: 82,
    created_at: "2026-06-01T00:00:00.000Z",
    accepted_at: null,
    accepted_by_user_id: null,
    accepted_link_id: null,
    dismissed_at: null,
    dismissed_by_user_id: null,
    dismissal_reason: null,
    target_name: "Acme Cloud",
    intelligence_event_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    event_title: "Actively exploited RCE in Acme Cloud Gateway",
    event_severity: "critical",
    event_confidence: 0.9,
    event_canonical_key: "CVE-2026-1234",
    ...overrides,
  };
}

export function aSuggestionsResponse(
  suggestions: EnrichedSuggestion[],
  overrides: Partial<SignalMatchSuggestionsResponse> = {}
): SignalMatchSuggestionsResponse {
  return {
    count: suggestions.length,
    limit: 25,
    offset: 0,
    sort: "created-desc",
    organizationId: "org-1",
    status: "pending",
    suggestions,
    ...overrides,
  };
}

export function aSuggestionCounts(
  overrides: Partial<SignalMatchSuggestionCounts> = {}
): SignalMatchSuggestionCounts {
  return {
    organizationId: "org-1",
    total: 1,
    by_target_type: { vendor: 1, ai_system: 0, control: 0, obligation: 0 },
    lifetime_total: 1,
    ...overrides,
  };
}

/**
 * A signal inside a legacy newsletter Brief. `source` — the internal FEED name
 * ("cisa_kev") — is populated on purpose: R1 removed it from the render, and the
 * wire type still carries it, so the fixture must carry it too or the regression
 * guard would be guarding nothing.
 */
export function aBriefSignal(overrides: Partial<BriefSignal> = {}): BriefSignal {
  return {
    id: "bs-1",
    title: "Actively exploited RCE in Acme Cloud Gateway",
    category: "SECURITY_INCIDENT",
    riskLevel: "critical",
    source: "cisa_kev",
    sourceUrl: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
    priorityScore: 90,
    priorityTier: "IMMEDIATE",
    riskRationale: "The gateway is internet-facing and exploited in the wild.",
    recommendedAction: "Patch the Acme Cloud Gateway this week.",
    ...overrides,
  };
}

export function aNewsletterIssue(
  overrides: Partial<NewsletterIssue> = {}
): NewsletterIssue {
  return {
    id: "issue-1",
    organization_id: "org-1",
    issue_number: 12,
    title: "This week: an exploited gateway and a new AI rule",
    summary: "Two items need a decision this week.",
    thesis_headline: "Patch the gateway before the regulator asks about it.",
    status: "published",
    audience_tier: "free",
    publish_date: "2026-06-01T00:00:00.000Z",
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    content_html: null,
    content_md: null,
    sections_json: { securityIncidents: [aBriefSignal()] },
    cross_domain_analysis: null,
    action_summary_json: null,
    locked: false,
    ...overrides,
  };
}

export function anIssuesResponse(
  issues: NewsletterIssue[],
  overrides: Partial<IssuesResponse> = {}
): IssuesResponse {
  return {
    count: issues.length,
    organizationId: "org-1",
    entitlementLevel: "free",
    issues,
    ...overrides,
  };
}

/** An item of the canonical Intelligence Brief. `source_slug` present — see aBriefSignal. */
export function anIntelligenceBriefItem(
  overrides: Partial<IntelligenceBriefItem> = {}
): IntelligenceBriefItem {
  return {
    id: "item-1",
    category: "vulnerability",
    relevance: "high",
    title: "Actively exploited RCE in Acme Cloud Gateway",
    summary: "Attackers are exploiting an unauthenticated RCE.",
    affected_cve: "CVE-2026-1234",
    affected_vendor: "Acme Cloud",
    source_slug: "cisa_kev",
    source_display: "CISA KEV",
    signal_type: "vulnerability",
    severity: "critical",
    cyber_signal_id: "3f2a1b2c-9d4e-4f7a-8b1c-2e5d6a7b8c9d",
    ingestion_timestamp: "2026-06-01T00:00:00.000Z",
    sort_order: 0,
    why_it_matters: "The gateway is internet-facing.",
    recommended_actions: "1. Patch the gateway.",
    analyst_notes: null,
    urgency: "immediate",
    ...overrides,
  };
}

export function anIntelligenceBrief(
  items: IntelligenceBriefItem[],
  overrides: Partial<IntelligenceBriefDetailResponse> = {}
): IntelligenceBriefDetailResponse {
  return {
    id: "brief-1",
    period_start: "2026-05-25",
    period_end: "2026-06-01",
    status: "published",
    signal_count: items.length,
    item_count: items.length,
    generated_at: "2026-06-01T00:00:00.000Z",
    published_at: "2026-06-01T00:00:00.000Z",
    created_at: "2026-06-01T00:00:00.000Z",
    content_json: { synthesis: { headline: "Patch the gateway.", exec_summary: "One item needs a decision." } },
    content_markdown: "",
    items,
    ...overrides,
  } as IntelligenceBriefDetailResponse;
}

// ── Asset Registry fixtures (appended — /assets render coverage) ─────
import type { CanonicalAsset } from "@/lib/assetRegistry";
import type { OrgConnector } from "@/lib/connectors";

/**
 * A row of asset_registry_v as GET /api/assets projects it.
 *
 * The default is a DETAIL-BACKED asset (backing_kind "cloud_resources"), because
 * that is the kind the unified surface actually homes — its detail link must stay
 * on /assets/[id]. A vendor/ai_system/enterprise_entity backing federates OUT to
 * its authoritative page (EAR-AD-1), so those are set explicitly by the tests that
 * assert federation, never inherited by accident.
 */
export function aCanonicalAsset(
  overrides: Partial<CanonicalAsset> = {}
): CanonicalAsset {
  return {
    asset_id: "as-1",
    asset_type: "cloud_resource",
    organization_id: "org-1",
    name: "prod-eu-west-1 S3 backups",
    criticality: "high",
    owner_user_id: null,
    status: "active",
    backing_kind: "cloud_resources",
    backing_id: "cr-1",
    lifecycle_status: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A connector row of the /assets/connect catalog (GET /api/connectors). */
export function anOrgConnector(
  overrides: Partial<OrgConnector> = {}
): OrgConnector {
  return {
    connector_id: "servicenow_cmdb",
    display_name: "ServiceNow CMDB",
    category: "cmdb",
    adapter_status: "reference",
    configured: false,
    enabled: false,
    last_sync_at: null,
    last_sync_status: null,
    sync_interval_minutes: null,
    next_sync_at: null,
    consecutive_failures: 0,
    config_fields: [],
    config_keys: [],
    ...overrides,
  };
}

// ── Approvals fixtures (appended — /approvals render coverage) ───────
import type { PendingApproval } from "@/lib/api";

/**
 * A row of the org-wide approvals queue (GET /api/approvals?status=pending).
 *
 * `is_self_proposed` is SERVER-decided: the engine computes it against the caller's
 * identity, because separation of duties is an authorization fact, not a client guess.
 * The fixture carries it exactly as the wire does — `false` by default, i.e. a plan
 * somebody ELSE proposed, which is the only row an approver may legally decide.
 */
export function aPendingApproval(
  overrides: Partial<PendingApproval> = {}
): PendingApproval {
  return {
    id: "ap-1",
    risk_id: "risk-1",
    treatment_id: "tr-1",
    kind: "treatment_plan",
    decision: "pending",
    requested_by_user_id: "user-2",
    approver_user_id: null,
    request_rationale: "Compensating controls are in place while we migrate.",
    expires_at: null,
    created_at: "2026-06-01T00:00:00.000Z",
    risk_title: "Unencrypted backups in eu-west-1",
    risk_domain: "Cyber",
    residual_rating: "High",
    residual_score: 61,
    lifecycle_state: "pending_approval",
    is_self_proposed: false,
    ...overrides,
  };
}

// ── Vendor + AI-system detail fixtures (appended — /vendors/[id], /ai-systems/[id]) ──
// Appended, not merged into the blocks above: fixtures.ts is edited by several suites
// at once and appending is the only conflict-free way in.
import type {
  AiGovernanceAssessment,
  AiGovernanceAssessmentsResponse,
  AiSystem,
  AiSystemLinkedSignal,
  AiVendorDependency,
  GovernanceReview,
  GovernanceReviewsResponse,
  Vendor,
  VendorAiDependency,
  VendorAssessment,
  VendorAssessmentsResponse,
  VendorAssuranceDocument,
  VendorAssuranceExtractionResponse,
  VendorFinding,
  VendorReview,
  VendorReviewsResponse,
  VendorSignalContext,
} from "@/lib/api";

/** The vendor the ENGINE returned for this id — the only vendor a detail page may show. */
export function aVendor(overrides: Partial<Vendor> = {}): Vendor {
  return {
    id: "v-1",
    organization_id: "org-1",
    name: "Acme Cloud",
    service_description: "Managed object storage for the claims platform.",
    category: "Infrastructure",
    criticality: "high",
    current_risk_score: 42,
    data_sensitivity: "regulated_phi",
    access_level: "systems_access",
    website: "acme.example",
    status: "active",
    owner_user_id: null,
    last_reviewed_at: "2026-05-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

export function aVendorAssessment(
  overrides: Partial<VendorAssessment> = {}
): VendorAssessment {
  return {
    id: "va-1",
    organization_id: "org-1",
    vendor_id: "v-1",
    assessment_type: "annual_review",
    overall_severity: "High",
    status: "completed",
    summary: "Encryption at rest is unproven for the claims bucket.",
    notes: null,
    performed_at: "2026-05-01T00:00:00.000Z",
    reviewer_id: null,
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

export function aVendorAssessmentsResponse(
  assessments: VendorAssessment[],
  overrides: Partial<VendorAssessmentsResponse> = {}
): VendorAssessmentsResponse {
  return {
    count: assessments.length,
    limit: 20,
    organizationId: "org-1",
    nextCursor: null,
    assessments,
    ...overrides,
  };
}

export function aVendorReview(overrides: Partial<VendorReview> = {}): VendorReview {
  return {
    id: "vr-1",
    organization_id: "org-1",
    vendor_id: "v-1",
    status: "in_progress",
    overall_severity: null,
    summary: "Annual review cycle underway.",
    notes: null,
    performed_at: null,
    reviewer_id: null,
    created_at: "2026-05-10T00:00:00.000Z",
    updated_at: "2026-05-10T00:00:00.000Z",
    ...overrides,
  };
}

export function aVendorReviewsResponse(
  reviews: VendorReview[],
  overrides: Partial<VendorReviewsResponse> = {}
): VendorReviewsResponse {
  return {
    count: reviews.length,
    limit: 20,
    organizationId: "org-1",
    nextCursor: null,
    reviews,
    ...overrides,
  };
}

/** A finding as GET /api/vendors/:id/findings projects it (assessment-joined). */
export function aVendorFinding(overrides: Partial<VendorFinding> = {}): VendorFinding {
  return {
    id: "f-1",
    title: "Unencrypted backups in eu-west-1",
    severity: "High",
    status: "open",
    domain: "Third Party",
    description: "Backups are written without server-side encryption.",
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    assessment_id: "va-1",
    assessment_type: "annual_review",
    performed_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Matched external signals for THIS vendor. The default is empty — an honest
 * "we matched nothing", so a suite that wants intelligence must say so.
 */
export function aVendorSignalContext(
  overrides: Partial<VendorSignalContext> = {}
): VendorSignalContext {
  return {
    matchedSignals: [],
    overallRiskSummary: "",
    suggestedAssessmentSeverity: null,
    ...overrides,
  };
}

/** The reverse supply-chain edge: an AI system that depends on this vendor. */
export function aVendorAiDependency(
  overrides: Partial<VendorAiDependency> = {}
): VendorAiDependency {
  return {
    dependency_id: "dep-1",
    dependency_role: "model_provider",
    notes: null,
    created_at: "2026-04-01T00:00:00.000Z",
    ai_system_id: "ai-1",
    ai_system_name: "Claims Triage Copilot",
    ai_system_criticality: "high",
    ai_system_deployment_status: "production",
    ...overrides,
  };
}

export function aVendorAssuranceDocument(
  overrides: Partial<VendorAssuranceDocument> = {}
): VendorAssuranceDocument {
  return {
    id: "doc-1",
    organization_id: "org-1",
    vendor_id: "v-1",
    uploaded_by_user_id: "user-1",
    original_filename: "acme-soc2-2026.pdf",
    byte_size: 1024,
    sha256: "a".repeat(64),
    storage_key: "vendor-assurance/doc-1.pdf",
    mime_type: "application/pdf",
    document_type_hint: "soc2_type2",
    processing_status: "finalized",
    processing_error_code: null,
    processing_error_detail: null,
    finalized_at: "2026-05-20T00:00:00.000Z",
    finalized_by_user_id: "user-1",
    approved_at: null,
    approved_by_user_id: null,
    created_at: "2026-05-19T00:00:00.000Z",
    updated_at: "2026-05-20T00:00:00.000Z",
    ...overrides,
  };
}

/** An extraction whose fields are all EXTRACTED and un-reviewed unless a test says otherwise. */
export function aVendorAssuranceExtractionResponse(
  overrides: Partial<VendorAssuranceExtractionResponse> = {}
): VendorAssuranceExtractionResponse {
  return {
    extraction: {
      id: "ext-1",
      organization_id: "org-1",
      document_id: "doc-1",
      model_id: "test-model",
      prompt_version: "v1",
      raw_response_excerpt: null,
      fields: {
        report_type: { value: "SOC 2 Type II", confidence: 0.95, status: "extracted" },
        auditor_name: { value: "Ledger & Co", confidence: 0.9, status: "extracted" },
        auditor_opinion: { value: "unqualified", confidence: 0.9, status: "extracted" },
        report_period_end: { value: "2026-03-31", confidence: 0.9, status: "extracted" },
        report_issued_date: { value: "2026-04-30", confidence: 0.9, status: "extracted" },
      },
      created_at: "2026-05-19T00:00:00.000Z",
    },
    spans: [],
    current_decisions: {},
    field_overrides: [],
    ...overrides,
  };
}

/** The AI system the ENGINE returned for this id. */
export function anAiSystem(overrides: Partial<AiSystem> = {}): AiSystem {
  return {
    id: "ai-1",
    organization_id: "org-1",
    name: "Claims Triage Copilot",
    use_case: "Ranks inbound claims for adjuster review.",
    owner_user_id: null,
    model_type: "LLM",
    data_classification: "PHI",
    deployment_status: "production",
    criticality: "high",
    risk_classification: "high_risk",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

export function aGovernanceReview(
  overrides: Partial<GovernanceReview> = {}
): GovernanceReview {
  return {
    id: "gr-1",
    organization_id: "org-1",
    ai_system_id: "ai-1",
    review_type: "Pre-deployment review",
    performed_at: "2026-05-01T00:00:00.000Z",
    reviewer_id: null,
    outcome: "Approved with conditions",
    summary: "Human review required on all denials.",
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

export function aGovernanceReviewsResponse(
  reviews: GovernanceReview[],
  overrides: Partial<GovernanceReviewsResponse> = {}
): GovernanceReviewsResponse {
  return {
    count: reviews.length,
    limit: 20,
    organizationId: "org-1",
    nextCursor: null,
    reviews,
    ...overrides,
  };
}

export function anAiGovernanceAssessment(
  overrides: Partial<AiGovernanceAssessment> = {}
): AiGovernanceAssessment {
  return {
    id: "aga-1",
    organization_id: "org-1",
    ai_system_id: "ai-1",
    status: "partially_compliant",
    overall_severity: "Moderate",
    summary: "Model card is missing an evaluation section.",
    notes: null,
    performed_at: "2026-05-05T00:00:00.000Z",
    reviewer_id: null,
    created_at: "2026-05-05T00:00:00.000Z",
    updated_at: "2026-05-05T00:00:00.000Z",
    ...overrides,
  };
}

export function anAiGovernanceAssessmentsResponse(
  assessments: AiGovernanceAssessment[],
  overrides: Partial<AiGovernanceAssessmentsResponse> = {}
): AiGovernanceAssessmentsResponse {
  return {
    count: assessments.length,
    limit: 20,
    organizationId: "org-1",
    nextCursor: null,
    assessments,
    ...overrides,
  };
}

/** An external signal linked to an AI system (signal_ai_system_links + event bridge). */
export function anAiSystemLinkedSignal(
  overrides: Partial<AiSystemLinkedSignal> = {}
): AiSystemLinkedSignal {
  return {
    link_id: "link-1",
    link_created_at: "2026-06-01T00:00:00.000Z",
    id: "sig-1",
    source: "cisa_kev",
    signal_type: "vulnerability",
    severity: "critical",
    normalized_summary: "Prompt-injection bypass in the hosted inference runtime.",
    affected_vendor: "Acme Cloud",
    affected_cve: "CVE-2026-1234",
    ingestion_timestamp: "2026-06-01T00:00:00.000Z",
    intelligence_event_id: "evt-1",
    event_summary: "Actively exploited RCE in Acme Cloud Gateway",
    ...overrides,
  };
}

/** The forward supply-chain edge: a vendor this AI system depends on. */
export function anAiVendorDependency(
  overrides: Partial<AiVendorDependency> = {}
): AiVendorDependency {
  return {
    dependency_id: "dep-1",
    dependency_role: "model_provider",
    notes: null,
    created_at: "2026-04-01T00:00:00.000Z",
    vendor_id: "v-1",
    vendor_name: "Acme Cloud",
    vendor_criticality: "high",
    vendor_status: "active",
    ...overrides,
  };
}

// ── Executive Risk (ERIP #537 / E4) ─────────────────────────────────────────
// Imported here (not in the header block) to keep this append-only section from
// colliding with concurrent edits. The types are the REAL client-safe contracts the
// executive surfaces consume, so a fixture that drifts fails typecheck.
import type {
  ConnectorHealthEntry,
  ConnectorHealthResponse,
  DimensionTrend,
  HistoryPoint,
  PostureForecastResponse,
  PredictiveInsights,
  PredictiveInsightsResponse,
  RiskTrendsResponse,
} from "@/lib/executiveRisk";

export function aHistoryPoint(overrides: Partial<HistoryPoint> = {}): HistoryPoint {
  return {
    snapshot_date: "2026-07-01",
    asset_count: 40,
    at_risk_count: 9,
    max_risk: 82,
    avg_risk: 41,
    ...overrides,
  };
}

/**
 * A dimension's trend. `current` defaults to the LAST point, which is what the engine
 * sends — a fixture whose `current` disagreed with its series would test a state the
 * wire cannot produce.
 */
export function aDimensionTrend(overrides: Partial<DimensionTrend> = {}): DimensionTrend {
  const points = overrides.points ?? [
    aHistoryPoint({ snapshot_date: "2026-04-13", asset_count: 30, at_risk_count: 4, max_risk: 70, avg_risk: 31 }),
    aHistoryPoint({ snapshot_date: "2026-07-01", asset_count: 40, at_risk_count: 9, max_risk: 82, avg_risk: 41 }),
  ];
  return {
    dimension: "enterprise",
    points,
    current: points[points.length - 1] ?? null,
    avg_risk_change: 10,
    at_risk_change: 5,
    direction: "up",
    ...overrides,
  };
}

export function aRiskTrends(overrides: Partial<RiskTrendsResponse> = {}): RiskTrendsResponse {
  return {
    window_days: 90,
    trends: [aDimensionTrend()],
    ...overrides,
  };
}

export function aPredictiveInsights(
  overrides: Partial<PredictiveInsights> = {}
): PredictiveInsights {
  return {
    source: "deterministic",
    headline: "Cloud risk is rising faster than any other dimension.",
    narrative: "Average cloud asset risk rose 12 points over the window, driven by unpatched hosts.",
    recommendations: [
      {
        dimension: "cloud",
        action: "Patch the 6 internet-facing hosts flagged critical.",
        priority: "immediate",
        rationale: "They carry the highest blast radius in the graph.",
      },
    ],
    ...overrides,
  };
}

export function aPredictiveInsightsResponse(
  overrides: Partial<PredictiveInsightsResponse> = {}
): PredictiveInsightsResponse {
  return {
    horizon_days: 30,
    insights: aPredictiveInsights(),
    ...overrides,
  };
}

export function aPostureForecast(
  overrides: Partial<PostureForecastResponse> = {}
): PostureForecastResponse {
  return {
    metric: "posture_score",
    horizon_days: 30,
    observations: [
      { date: "2026-06-01", score: 62 },
      { date: "2026-06-15", score: 65 },
      { date: "2026-07-01", score: 68 },
    ],
    forecast: {
      method: "linear_regression",
      trend: "increasing",
      points: [{ x: 0, y: 68 }, { x: 30, y: 72 }],
      projected_value: 72,
    },
    ...overrides,
  };
}

export function aConnectorHealthEntry(
  overrides: Partial<ConnectorHealthEntry> = {}
): ConnectorHealthEntry {
  return {
    connector_id: "aws",
    display_name: "AWS",
    category: "cloud",
    band: "degraded",
    reasons: ["drift_stale_assets"],
    severity: 2,
    signals: {
      enabled: true,
      last_sync_status: "success",
      last_sync_at: "2026-07-11T00:00:00.000Z",
      consecutive_failures: 0,
      next_sync_at: "2026-07-13T00:00:00.000Z",
      stale_observations: 3,
      writeback_pending: 0,
      writeback_conflict: 0,
      writeback_failed: 0,
      open_dead_letters: 0,
    },
    ...overrides,
  };
}

export function aConnectorHealth(
  overrides: Partial<ConnectorHealthResponse> = {}
): ConnectorHealthResponse {
  const connectors = overrides.connectors ?? [aConnectorHealthEntry()];
  return {
    overall_band: "degraded",
    configured_count: connectors.filter((c) => c.band !== "unconfigured").length,
    by_band: { degraded: 1 },
    connectors,
    ...overrides,
  };
}

export function aRiskAcceptance(overrides: Partial<RiskAcceptance> = {}): RiskAcceptance {
  return {
    id: "ra-1",
    organization_id: "org-1",
    finding_id: "f-1",
    state: "proposed",
    owner_user_id: "user-2",
    rationale: "Compensating control in place; cost of fix exceeds the exposure.",
    requested_by_user_id: "user-1",
    approver_user_id: null,
    approved_at: null,
    decision_rationale: null,
    expires_at: "2026-12-31",
    withdrawn_at: null,
    withdrawal_reason: null,
    governance_review_required: false,
    promoted_risk_id: null,
    created_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

// ── Billing fixtures (SL-BILL-1) ────────────────────────────────────────────
import type { SubscriptionInfo } from "@/lib/api";

/**
 * GET /api/billing/subscription — the payload /account renders its trial,
 * renewal and dunning blocks from.
 *
 * The default is a healthy active subscription. `payment_failed_at` is the
 * authoritative dunning stamp (written by `invoice.payment_failed`, cleared
 * only by a successful grant), so a delinquency test sets THAT rather than
 * inferring failure from the entitlement level — the level is downgraded to
 * `starter` by the `past_due` webhook and therefore cannot carry the signal.
 */
export function aSubscription(overrides: Partial<SubscriptionInfo> = {}): SubscriptionInfo {
  // grace_state is DERIVED from payment_failed_at unless a test states it,
  // because the wire can never carry "a payment failed and the org is healthy".
  // A fixture that allowed that combination would let a test assert against a
  // state the engine cannot produce — and the /account banner branches on
  // exactly this pair. Default is `lapsed`: with the grace flag off (today),
  // any open failure is lapsed.
  const derivedGrace: SubscriptionInfo["grace_state"] =
    overrides.grace_state ??
    (overrides.payment_failed_at ? "lapsed" : "healthy");
  return {
    tier: "premium",
    entitlement_level: "premium",
    status: "active",
    stripe_customer_id: "cus_test_1",
    current_period_end: "2026-09-15T00:00:00.000Z",
    payment_failed_at: null,
    grace_ends_at: null,
    subscription_tier: "platform",
    trial_end: null,
    amount: 80000,
    currency: "usd",
    interval: "month",
    ...overrides,
    grace_state: derivedGrace,
  };
}
