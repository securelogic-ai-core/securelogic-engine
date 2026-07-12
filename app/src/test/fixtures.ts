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
    open_count: 2,
    in_progress_open: 1,
    active_total: 3,
    critical_high_active: 1,
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
