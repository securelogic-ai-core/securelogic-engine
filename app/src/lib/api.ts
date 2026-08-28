/**
 * Server-side API client for the SecureLogic Engine.
 *
 * All functions run exclusively in Server Components and API Routes.
 * The engine URL and API key never reach the browser.
 */

// Relative, not "@/": the root vitest config runs app/src/lib tests without the
// Next path aliases, so an aliased import here breaks collection of every test
// that transitively imports api.ts.
import { buildFindingEvidencePayload } from "../components/findings/findingEvidencePayload";
import {
  entitiesQuery,
  relationshipsQuery,
  graphQuery,
  importQuery,
  applicabilityQuery,
  isFeatureDisabledStatus,
  type EntityType,
  type NodeType,
  type EnterpriseEntity,
  type EnterpriseRelationship,
  type GraphNeighborhood,
  type ImportEntityType,
  type ImportPlan,
  type ApplicabilityDecision,
  type MatchTargetType,
  type ApplicabilityAssessmentRow,
  type ApplicabilityAssessmentDetail,
  type ApplicabilityExplanation,
  type EnterpriseContextStats,
} from "./enterpriseContext";
import { type AssetType, type CanonicalAsset, type DetailBackedType } from "./assetRegistry";
import { type OrgConnector } from "./connectors";
import type {
  RiskTrendsResponse,
  RiskKpisResponse,
  PredictiveInsightsResponse,
  PostureForecastResponse,
  ConnectorHealthResponse,
} from "./executiveRisk";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

// =========================================================
// TYPES
// =========================================================

export type MeResponse = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  organizationPlan: string;
  organizationStatus: string;
  apiKeyId: string;
  apiKeyLabel: string;
  apiKeyStatus: string;
  entitlementLevel: string;
  stripeSubscriptionTier?: string | null;
  billingActive: boolean;
  lastUsedAt: string | null;
  apiKeyCreatedAt: string;
};

/**
 * Single source of truth for the human-readable plan label rendered across
 * the account page, dashboard, and any future surface. Prefers the precise
 * Stripe tier (which distinguishes Platform Annual from Platform Monthly,
 * and Brief Team from solo Brief Pro); falls back to the coarser
 * entitlement_level when the Stripe tier is absent (legacy rows, free).
 */
export function planDisplayName(
  entitlementLevel: string,
  stripeSubscriptionTier?: string | null
): string {
  switch (stripeSubscriptionTier) {
    case "professional":    return "Brief Pro";
    case "teams":           return "Brief Team";
    case "platform":        return "Platform Professional";
    case "platform_annual": return "Platform Annual";
    case "team":            return "Platform Professional";
  }
  switch (entitlementLevel) {
    case "premium":      return "Platform Professional";
    // 'platform' and 'team' are full platform entitlements (the dashboard's own
    // isPlatformUser gates treat them exactly like 'premium'). They were missing
    // here, so a platform-entitled org with no Stripe tier — e.g. a seeded or
    // manually-provisioned org — displayed "Plan: Free" while correctly rendering
    // every platform surface (July-15 walkthrough Step-0 defect).
    case "platform":     return "Platform Professional";
    case "team":         return "Platform Professional";
    case "professional": return "Brief Pro";
    case "admin":        return "Enterprise";
    default:             return "Free";
  }
}

export type BriefSignal = {
  // Identity
  id?: string;
  signalId?: string;
  signal_id?: string;
  source?: string;
  sourceUrl?: string;
  source_url?: string;

  // Classification
  title: string;
  category: string;
  severity?: string;            // canonical severity field
  riskLevel: string;            // backward-compat alias for severity
  risk_level?: string;

  // Audience
  audience?: string;

  // Content
  analysis?: string;
  summary?: string;
  whyItMatters?: string;
  recommendation?: string;      // canonical
  recommendedAction?: string;   // backward-compat alias

  // Priority
  riskRationale?: string;
  priorityScore?: number;
  priorityTier?: string;

  // Optional enrichment
  affectedCve?: string | null;
  affectedVendor?: string | null;
  orgRelevance?: boolean | null;
};

export type BriefSections = {
  aiGovernance?: BriefSignal[];
  securityIncidents?: BriefSignal[];
  regulations?: BriefSignal[];
  vendorRisk?: BriefSignal[];
  compliance?: BriefSignal[];
};

export type ActionSummary = {
  thisWeek: string[];
  thisMonth: string[];
  monitor: string[];
};

export type NewsletterIssue = {
  id: string;
  organization_id: string | null;
  issue_number: number | null;
  title: string;
  summary: string | null;
  thesis_headline: string | null;
  status: string;
  audience_tier: string;
  publish_date: string | null;
  created_at: string;
  updated_at: string;
  content_html: string | null;
  content_md: string | null;
  sections_json: BriefSections | null;
  cross_domain_analysis: string | null;
  action_summary_json: ActionSummary | null;
  locked: boolean;
};

export type IssuesResponse = {
  count: number;
  organizationId: string;
  entitlementLevel: string;
  issues: NewsletterIssue[];
};

// =========================================================
// INTELLIGENCE BRIEF TYPES
// =========================================================

export type IntelligenceBriefStatus = "draft" | "generating" | "published" | "failed";

export type IntelligenceBriefCategory =
  | "vulnerability"
  | "threat_actor"
  | "vendor_incident"
  | "regulatory"
  | "general";

export type IntelligenceBriefRelevance = "high" | "medium" | "low";

/**
 * Per-item time-horizon urgency band, classified by the engine's enrichment
 * pipeline. Mirrors BriefUrgency in src/api/lib/intelligenceBriefGenerator.ts.
 *
 *   immediate — act this week
 *   near_term — act this month
 *   far_term  — monitor
 *
 * Null on items generated before the urgency column was added (2026-06-02).
 */
export type IntelligenceBriefUrgency = "immediate" | "near_term" | "far_term";

/** List-shape brief — metadata only (no content_json, no items). */
export type IntelligenceBrief = {
  id: string;
  period_start: string;
  period_end: string;
  status: IntelligenceBriefStatus;
  signal_count: number;
  item_count: number;
  generated_at: string | null;
  published_at: string | null;
  created_at: string;
};

export type IntelligenceBriefItem = {
  id: string;
  category: IntelligenceBriefCategory | string;
  relevance: IntelligenceBriefRelevance | string;
  title: string;
  summary: string;
  affected_cve: string | null;
  affected_vendor: string | null;
  source_slug: string | null;
  /**
   * Human-readable label for source_slug (e.g. "BleepingComputer" for
   * "security_news_bleepingcomputer"). Populated by the engine at API-response
   * time; optional here because briefs returned by older engine deploys —
   * before the source-display PR shipped — won't include it.
   */
  source_display?: string | null;
  signal_type: string | null;
  severity: string | null;
  cyber_signal_id: string | null;
  ingestion_timestamp: string | null;
  /**
   * Source-authoritative event date (IQP Q2): the date the source itself
   * asserts — KEV dateAdded, NVD published, RSS pubDate. Optional because
   * older engine deploys omit it; null when the source asserted no date.
   * Display renders nothing in that case — a date is never inferred.
   */
  signal_published_at?: string | null;
  sort_order: number;
  why_it_matters: string | null;
  recommended_actions: string | null;
  analyst_notes: string | null;
  urgency: IntelligenceBriefUrgency | null;
  /**
   * Personalization (computed at generation since 20260511, returned since EG2
   * slice 6): whether this item matched the org's own platform entities, and
   * exactly which ones — the visible proof the Brief is connected to the
   * tenant's context. Optional: older engine deploys omit both fields.
   */
  is_personalized?: boolean;
  platform_context?: {
    matched_vendors?: Array<{ id: string; name: string }>;
    matched_risks?: Array<{ id: string; title: string }>;
    matched_ai_systems?: Array<{ id: string; name: string }>;
    matched_obligations?: Array<{ id: string; title: string }>;
  } | null;
};

/**
 * Brief-level synthesis embedded in content_json.synthesis. Mirrors the
 * engine's BriefSynthesis type (src/api/lib/briefSynthesizer.ts) — duplicated
 * here intentionally because frontend and engine are separate npm packages
 * and don't share types directly. Keep in sync if the engine shape changes.
 *
 * D1 collapsed this layer to a single 12-word headline. The exec-summary
 * pass added teaser (one-sentence dashboard hook) and exec_summary (three-
 * sentence directive paragraph). Both fields are nullable; older briefs
 * have only headline populated.
 */
export type BriefSynthesis = {
  headline: string | null;
  teaser?: string | null;
  exec_summary?: string | null;
};

export type IntelligenceBriefListResponse = {
  briefs: IntelligenceBrief[];
  next_cursor: { cursor_period_end: string; cursor_id: string } | null;
};

/**
 * Detail-shape brief — full content_json/markdown plus embedded items.
 *
 * content_json is loosely typed (the engine writes a richer structure but
 * the frontend currently only reads .synthesis). Intersection with
 * Record<string, unknown> preserves access to other fields without forcing
 * the frontend to mirror the full shape.
 */
export type IntelligenceBriefDetailResponse = IntelligenceBrief & {
  content_json:
    | ({ synthesis?: BriefSynthesis | null } & Record<string, unknown>)
    | null;
  content_markdown: string;
  items: IntelligenceBriefItem[];
};

export type PostureSnapshot = {
  id: string;
  snapshot_date: string;
  overall_score: number | null;
  overall_severity: string | null;
  open_finding_count: number;
  open_action_count: number;
  overdue_action_count: number;
  created_at: string;
};

export type PostureHistory = {
  organizationId: string;
  days: number;
  count: number;
  snapshots: PostureSnapshot[];
};

export type DomainScore = {
  domain: string;
  score: number | null;
  severity: string | null;
  finding_count: number;
  action_count: number;
  trend_direction?: "improving" | "stable" | "worsening" | "unknown" | null;
};

export type DashboardSummary = {
  posture: {
    overall_score: number | null;
    overall_severity: string | null;
    snapshot_date: string | null;
  };
  domains: DomainScore[];
  findings: {
    open: number;
    by_severity: {
      Critical: number;
      High: number;
      Moderate: number;
      Low: number;
    };
    avg_age_days?:  number | null;
    max_age_days?:  number | null;
    older_than_30?: number;
    older_than_7?:  number;
    // Independent Governance Review: remediation derived complete, governance decision
    // pending (finding-lifecycle-spec §1.3) — the leadership view of the reviewer queue.
    // Optional: absent on older engine builds → the tile falls back to hidden/em-dash.
    pending_independent_review?: number;
  };
  actions: {
    open: number;
    in_progress: number;
    // Metric Contract (optional: absent on older engine builds): `active` =
    // open|in_progress|blocked — the SAME number the destination page's
    // open_count shows, so the ring and its click-through reconcile exactly.
    active?: number;
    blocked?: number;
    overdue: number;
    avg_age_days?:  number | null;
    max_age_days?:  number | null;
    older_than_30?: number;
    older_than_7?:  number;
  };
  controls_cadence: {
    overdue: number;
  };
  risks_summary?: {
    // Metric Contract: ALL open risks (status NOT IN closed/transferred) —
    // the same population the /risks destination shows. Unscored risks are
    // no longer silently excluded from the headline.
    open: number;
    // Legacy keys — populated from residual after Phase 1 backfill.
    // Retained so older dashboard code paths continue to work; new
    // tiles read by_residual_rating / by_residual_likelihood_impact
    // explicitly.
    by_risk_rating: {
      Critical: number;
      High: number;
      Moderate: number;
      Low: number;
      // Open risks without a residual rating yet (optional: absent on older engines).
      Unscored?: number;
    };
    by_residual_rating?: {
      Critical: number;
      High: number;
      Moderate: number;
      Low: number;
      Unscored?: number;
    };
    by_inherent_rating?: {
      Critical: number;
      High: number;
      Moderate: number;
      Low: number;
    };
    by_domain?: Record<string, number>;
    by_likelihood_impact?: Array<{
      likelihood: string;
      impact: string;
      count: number;
    }>;
    by_residual_likelihood_impact?: Array<{
      likelihood: string;
      impact: string;
      count: number;
    }>;
    by_inherent_likelihood_impact?: Array<{
      likelihood: string;
      impact: string;
      count: number;
    }>;
  };
  inventory: {
    vendors: number;
    ai_systems: number;
    controls: number;
    control_assessments: number;
    governance_reviews: number;
    frameworks: number;
    risks?: number;
    obligations?: number;
    dependencies?: number;
  };
  vendor_risk?: {
    by_criticality: {
      critical: number;
      high: number;
      medium: number;
      low: number;
      uncategorized: number;
    };
    total: number;
    high_or_critical: number;
  };
};

export type Vendor = {
  id: string;
  organization_id: string;
  name: string;
  service_description: string | null;
  category: string | null;
  criticality: "critical" | "high" | "medium" | "low" | null;
  current_risk_score: number | null;
  data_sensitivity: string | null;
  access_level: string | null;
  website: string | null;
  status: "active" | "archived";
  owner_user_id: string | null;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Per-vendor finding counts, computed in the DATABASE by GET /api/vendors.
   *
   * The list and the risk board used to fetch the org's Vendor Risk findings with
   * limit:100 and group them by vendor in the browser — past 100, a vendor's
   * findings fell off the page and its card showed no badge at all. These are
   * COUNT(*) over the whole matched set, per vendor. Optional because the single-
   * vendor GET does not return them.
   */
  open_findings_count?: number;
  active_findings_count?: number;
  /**
   * Assessment rows on record for this vendor, counted in the DATABASE by
   * GET /api/vendors — the exact, uncapped answer to "has this vendor ever been
   * assessed?".
   *
   * The surfaces used to answer that by fetching the ORG's assessments with
   * limit:100 and checking whether the vendor appeared. Past 100 assessments an
   * assessed vendor dropped out of that page and rendered as "Never assessed" —
   * on /vendors/risk that also drew a red border and pushed it into Requires
   * Attention. Absence from a capped page is not absence from the table.
   *
   * Predicate: ANY row in vendor_assessments for this vendor in this org — the
   * definition the app already used and customers already understand. This is
   * NOT `last_reviewed_at`, which is a different (and effectively unmaintained)
   * field. Optional because the single-vendor GET does not return it, and a
   * caller MUST read its absence as "unknown", never as "never assessed".
   */
  assessment_count?: number;
  /**
   * `performed_at` of the most recently created assessment, or null when there
   * is none. Same ordering the capped client-side lookup used (created_at DESC,
   * id DESC), so un-capping the value does not redefine which assessment the
   * "Last Assessment" column refers to. Optional on the same terms as above.
   */
  latest_assessment_at?: string | null;
};

/** Exact per-band counts over the applied filter set. Parts always sum to `total`. */
export type VendorCriticalityCounts = {
  critical: number;
  high: number;
  medium: number;
  low: number;
  /** NULL or outside the four known bands — so nothing vanishes from the breakdown. */
  uncategorized: number;
};

export type VendorsResponse = {
  /** Length of the returned SLICE. Never a population size — that is `total`. */
  count: number;
  limit: number;
  /**
   * Exact count of the whole matching population for the applied filters
   * (cursor and limit excluded). Optional: absent on older engine builds, and a
   * caller must treat its absence as "unknown", never as zero.
   */
  total?: number;
  /** Exact criticality breakdown over the same population as `total`. */
  by_criticality?: VendorCriticalityCounts;
  /**
   * Exact count of vendors in that same population with NO assessment on
   * record. Optional on the same terms as `total`: absent on older engine
   * builds, and absence means unknown — never zero.
   */
  never_assessed_count?: number;
  organizationId: string;
  statusFilter: string;
  nextCursor: { created_at: string; id: string } | null;
  vendors: Vendor[];
};

export type VendorAssessment = {
  id: string;
  organization_id: string;
  vendor_id: string;
  assessment_type: string;
  overall_severity: string;
  status: string;
  summary: string | null;
  notes: string | null;
  performed_at: string;
  reviewer_id: string | null;
  created_at: string;
  updated_at: string;
};

export type VendorAssessmentsResponse = {
  count: number;
  limit: number;
  organizationId: string;
  nextCursor: { created_at: string; id: string } | null;
  assessments: VendorAssessment[];
};

export type VendorReview = {
  id: string;
  organization_id: string;
  vendor_id: string;
  status: "not_started" | "in_progress" | "satisfactory" | "concerns_identified" | "critical_issues";
  overall_severity: string | null;
  summary: string | null;
  notes: string | null;
  performed_at: string | null;
  reviewer_id: string | null;
  created_at: string;
  updated_at: string;
};

export type VendorReviewsResponse = {
  count: number;
  limit: number;
  organizationId: string;
  nextCursor: { created_at: string; id: string } | null;
  reviews: VendorReview[];
};

export type Finding = {
  id: string;
  organization_id: string;
  assessment_id: string | null;
  source_type: string;
  source_id: string | null;
  title: string;
  /**
   * Canonical, SLA-BEARING severity. NULL means the finding has NO canonical
   * severity — the source said Informational/None, or its value could not be
   * mapped. NULL is never a hidden fifth level and never acquires a due date.
   * When it is null, `source_severity` says what the source actually stated.
   */
  severity: string | null;
  description: string;
  recommendation: string | null;
  framework_control_id: string | null;
  /** What the SOURCE called the severity, verbatim. Never normalised. */
  source_severity?: string | null;
  /** The finding's id in the source report, e.g. "PT-2026-014". */
  source_reference_id?: string | null;
  cvss_score?: number | string | null;
  cvss_vector?: string | null;
  domain: string | null;
  priority: string | null;
  likelihood: string | null;
  confidence: string | null;
  time_sensitivity: string | null;
  scoring_rationale: string | null;
  status: string;
  // The HUMAN decision axis (needs_review | mitigating | accepted_risk |
  // resolved — finding-lifecycle-spec §1.2). Returned by the list since the
  // work-first engine PR; may be absent on older cached payloads.
  decision_state?: string;
  // The SYSTEM-DERIVED operational axis (open | in_progress | remediated —
  // spec §1.1). Derived from linked Actions; never hand-set. Optional: absent
  // on older cached payloads.
  operational_status?: string;
  owner_user_id: string | null;
  due_date: string | null;
  action_count: number;
  // Attached evidence rows (source_type='finding'). Optional: absent on older
  // engine payloads — surfaces must treat undefined as "unknown", not zero.
  evidence_count?: number;
  created_at: string;
  updated_at: string;
};

export type Action = {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  action_type: string | null;
  source_type: string;
  source_id: string | null;
  priority: "immediate" | "near_term" | "planned" | "watch";
  due_date: string | null;
  owner_user_id: string | null;
  status: "open" | "in_progress" | "blocked" | "closed" | "accepted";
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // R-10: structured blocker metadata, populated when an action is blocked.
  // All optional/nullable; absent on older cached payloads.
  blocked_reason?: string | null;
  blocked_dependency?: string | null;
  blocked_owner_user_id?: string | null;
  blocked_expected_unblock_date?: string | null;
  /**
   * Server-decided, per the Metric Contract (active AND due < CURRENT_DATE).
   * Never re-derive this on the client: doing so with `new Date()` compares
   * against NOW() rather than midnight, which made an action due TODAY overdue
   * on this page and on-time on the dashboard.
   */
  is_overdue: boolean;
};

export type ActionsResponse = {
  count: number;
  limit?: number;
  // Exact total for the applied filter set (cursor excluded) — pagination truth,
  // mirroring FindingsResponse so a capped page can disclose "showing N of M".
  total?: number;
  organizationId?: string;
  nextCursor?: { created_at: string; id: string } | null;
  actions: Action[];
};

// Authoritative org-wide action counts (server-computed COUNT(*) FILTER), the
// single source of truth for the workspace attention tiles so they cannot drift
// from a client-side scan of a truncated page slice.
// Metric Contract: open_count = ACTIVE work (open | in_progress | blocked) —
// the same definition the dashboard uses; open_only/in_progress/blocked are
// its exact parts. overdue compares DATE against CURRENT_DATE everywhere.
export type ActionsSummary = {
  open_count: number;
  // Exact parts of open_count (optional: absent on older engine builds).
  open_only_count?: number;
  in_progress_count?: number;
  blocked_count: number;
  overdue_count: number;
  immediate_count: number;
  closed_count: number;
  // The same predicates narrowed to the signed-in user — what the "My Actions" tiles read.
  // Server-computed, uncapped: deriving these by filtering a fetched page is exactly how a
  // user's assigned work went missing. 0 for an API-key caller (no user identity).
  // Optional: absent on older engine builds.
  my_open_count?: number;
  my_overdue_count?: number;
};

export type ActionsParams = {
  status?: string;
  priority?: string;
  overdue?: boolean;
  /** Metric Contract active set (open|in_progress|blocked) — what an ACTIVE count links to. */
  active?: boolean;
  /**
   * The caller's own remediation. The ONLY accepted value is the literal "me" — the engine
   * resolves the user from the SESSION, so a user id can never be passed and assignments
   * cannot be enumerated. Filtered in SQL, so a personal queue stays correct past one page.
   */
  owner?: "me";
  limit?: number;
};

export type FindingsResponse = {
  count: number;
  limit: number;
  // Exact total for the applied filter set (cursor excluded) — pagination truth.
  total?: number;
  // Echoed OFFSET for the scalable queue's page math (0 for cursor/default paging).
  offset?: number;
  organizationId: string;
  nextCursor: { created_at: string; id: string } | null;
  findings: Finding[];
};

/** The scalable-queue sort modes (queue) plus the legacy keyset `created`. */
export type FindingsSort = "created" | "urgency" | "severity" | "due_date" | "newest" | "oldest";
/** The queue's due-status partition. */
export type FindingsDueStatus = "overdue" | "today" | "soon" | "none";

export type FindingsParams = {
  domain?: string;
  source_type?: string;
  status?: string;
  severity?: string;
  source_id?: string;
  priority?: string;
  // Ops-center work filters (server-side — buckets stay correct at any scale).
  decision_state?: string;
  // The SYSTEM-DERIVED operational axis (open | in_progress | remediated | closed).
  operational_status?: string;
  overdue?: boolean;
  unassigned?: boolean;
  exploited?: boolean;
  // "My Work": only the literal "me" is accepted; the engine resolves the user
  // from the SESSION identity (never a client-supplied id).
  owner?: "me";
  // "Pending Independent Review" reviewer queue: the caller's own independent-
  // governance-review assignments (review_owner_user_id). Same anti-enumeration
  // contract as owner — only the literal "me" is accepted; the engine resolves the
  // user from the SESSION identity, so a reviewer assignment can never be enumerated.
  review_owner?: "me";
  // Still-requires-work statuses only (open / in_progress).
  active?: boolean;
  // Ready-for-decision queue (spec §1.3): all remediation work derived complete
  // (operational_status=remediated) but no governance decision yet.
  ready_for_decision?: boolean;
  // Resolve findings for one cyber-signal across BOTH intelligence channels
  // (legacy per-signal AND event-native via the signal→event bridge). Used by
  // the Brief decision affordance so event-sourced findings are reachable.
  intel_ref?: string;
  // ── Scalable Risk Findings queue controls (all server-side) ──
  // Free-text search across title / description / finding id / CVE / vendor+asset name.
  q?: string;
  // Due-status partition (overdue | today | soon | none).
  due?: FindingsDueStatus;
  // Findings with at least one linked remediation Action / evidence item.
  has_action?: boolean;
  has_evidence?: boolean;
  // Inclusive created-date range (YYYY-MM-DD).
  created_from?: string;
  created_to?: string;
  // Queue sort mode. The queue defaults to "urgency".
  sort?: FindingsSort;
  // OFFSET page start (used with a queue sort; the queue's pagination model).
  offset?: number;
  // Keyset cursor from the previous page's nextCursor (legacy paging).
  before?: { created_at: string; id: string };
  limit?: number;
};

export type FindingsSummary = {
  // STRICTLY OPEN — the lifecycle population (status='open'): work nobody has
  // started. A legitimate filter, but NOT the enterprise metric. Every tile in
  // the product reads the *_active fields below.
  open_count: number;
  // Metric Contract org-truth fields (optional: absent on older engine builds).
  // active_total / critical_high_active use the SAME definitions as
  // decisionQueue.isActiveStatus/isCriticalActive, so the workspace attention
  // tiles are server truth instead of a capped-slice scan.
  in_progress_open?: number;
  active_total?: number;
  critical_high_active?: number;
  // ACTIVE by severity — THE enterprise severity population (operational_status
  // <> 'closed'). Optional: absent on older engine builds, so callers fall back
  // to the strictly-open twin rather than rendering a wrong zero.
  critical_active?: number;
  high_active?: number;
  medium_active?: number;
  low_active?: number;
  // Strictly-open severity twins — the lifecycle population.
  critical_open: number;
  high_open: number;
  medium_open: number;
  low_open: number;
  closed_count: number;
  immediate_priority: number;
  vendor_sourced: number;
  signal_sourced: number;
  // Work-queue counts (ERIP work-first Findings page) — additive; optional so the
  // page degrades if an older engine build omits them.
  overdue_open?: number;
  unassigned_open?: number;
  needs_review_open?: number;
  mitigating_open?: number;
  accepted_risk_total?: number;
  // Ready-for-decision queue (spec §1.3): operational_status=remediated, no
  // governance decision yet.
  ready_for_decision_open?: number;
  regulatory_open?: number;
  ai_governance_open?: number;
  vendor_risk_open?: number;
  exploited_open?: number;
  pending_risk_approvals?: number;
  // Session-scoped: present only when the caller has a user identity (owner=me contract).
  my_work_open?: number;
  // Independent Governance Review (finding-lifecycle-spec §1.3 population, named for the
  // review workflow). `pending_independent_review_open` is the ORG-WIDE ready-for-decision
  // count (identical predicate to ready_for_decision_open). `my_pending_reviews_open` is the
  // reviewer-scoped subset assigned to the caller (review_owner_user_id = me) — session-scoped,
  // present only when the caller has a user identity. Both optional (older engine builds omit).
  pending_independent_review_open?: number;
  my_pending_reviews_open?: number;
};

export type Risk = {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  domain: string | null;
  // ── Legacy single-rating dimension (deprecated; kept for
  // backwards compatibility with the webhook contract). After Phase
  // 1 backfill, legacy mirrors residual on every write — the
  // POST/PATCH handlers maintain that invariant. New UI surfaces
  // (table, detail page, edit form, create form) should read
  // inherent_/residual_ explicitly rather than these legacy fields.
  likelihood: string | null;
  impact: string | null;
  risk_rating: string | null;
  // ── Inherent (pre-controls) — package
  // risk-register-inherent-residual-rating Phase 1+. Nullable
  // because Phase 1 backfill left existing rows with NULL inherent
  // values; users populate them as they reassess.
  inherent_likelihood: string | null;
  inherent_impact: string | null;
  inherent_rating: string | null;
  // ── Residual (post-controls) — Phase 1 backfilled from legacy
  // for every existing row; new rows write residual_* explicitly
  // and Phase 2 POST/PATCH handlers mirror residual into legacy.
  // Still string|null on the type so consumers handle the rare
  // case of a manually-INSERTed row that bypasses the validator.
  residual_likelihood: string | null;
  residual_impact: string | null;
  residual_rating: string | null;
  status: string;
  treatment: string | null;
  owner: string | null;
  /**
   * FK → users.id for the risk owner. Nullable for legacy rows and
   * the "Unassigned" state. The `owner` text column is the
   * denormalized fallback (kept in sync on write) used for display
   * when the FK is null or the user has been deleted.
   */
  owner_user_id: string | null;
  due_date: string | null;
  source_type: string | null;
  source_id: string | null;
  // RR-5: review-cadence fields. last_reviewed_at and next_review_due
  // are written exclusively by POST /api/risks/:id/review.
  // review_cadence_days is the per-risk override; null = use org policy.
  // is_overdue is computed at read time in the engine's RISK_SELECT.
  last_reviewed_at: string | null;
  next_review_due: string | null;
  review_cadence_days: number | null;
  is_overdue: boolean;
  created_at: string;
  updated_at: string;
};

export type RiskIntelligence = {
  id: string;
  title: string;
  domain: string | null;
  // Legacy field retained for backwards compat (= residual after
  // Phase 1 backfill).
  risk_rating: string | null;
  inherent_rating: string | null;
  residual_rating: string | null;
  status: string;
  likelihood: string | null;
  owner: string | null;
  active_treatments: number;
  total_treatments: number;
  linked_findings: number;
};

export type RisksResponse = {
  count: number;
  limit: number;
  organizationId: string;
  nextCursor: { created_at: string; id: string } | null;
  risks: Risk[];
};

export type RisksIntelligenceResponse = {
  count: number;
  open_critical_count: number;
  risks: RiskIntelligence[];
};

export type RisksSummary = {
  total: number;
  open_critical_count: number;
  by_status: Record<string, number>;
  by_risk_rating: Record<string, number>;
  by_inherent_rating: Record<string, number>;
  by_residual_rating: Record<string, number>;
  by_domain: Record<string, number>;
  // RR-5: count of risks where next_review_due < CURRENT_DATE.
  overdue_review_count: number;
};

export type ComplianceContext = {
  suggestedSeverity: "Critical" | "High" | "Moderate" | "Low" | null;
  suggestedSummary: string;
  riskIndicators: string[];
  assessmentGuidance: string;
};

export type VendorSignalContextMatch = {
  title: string;
  relevance: string;
  severity: string;
  suggestedFindingTitle: string;
  suggestedFindingDescription: string;
};

export type VendorSignalContext = {
  matchedSignals: VendorSignalContextMatch[];
  overallRiskSummary: string;
  suggestedAssessmentSeverity: "Critical" | "High" | "Moderate" | "Low" | null;
};

export type AiSystem = {
  id: string;
  organization_id: string;
  name: string;
  use_case: string | null;
  owner_user_id: string | null;
  model_type: string | null;
  data_classification: string | null;
  deployment_status: string | null;
  criticality: "critical" | "high" | "medium" | "low" | null;
  risk_classification: string | null;
  created_at: string;
  updated_at: string;
};

export type AiSystemsResponse = {
  count: number;
  limit: number;
  organizationId: string;
  nextCursor: { created_at: string; id: string } | null;
  ai_systems: AiSystem[];
};

export type GovernanceReview = {
  id: string;
  organization_id: string;
  ai_system_id: string;
  review_type: string;
  performed_at: string;
  reviewer_id: string | null;
  outcome: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
};

export type GovernanceReviewsResponse = {
  count: number;
  limit: number;
  organizationId: string;
  nextCursor: { created_at: string; id: string } | null;
  reviews: GovernanceReview[];
};

export type Framework = {
  id: string;
  organization_id: string;
  name: string;
  version: string;
  created_at: string;
  updated_at: string;
};

export type FrameworksResponse = {
  count: number;
  limit: number;
  organizationId: string;
  nextCursor: { created_at: string; id: string } | null;
  frameworks: Framework[];
};

export type Requirement = {
  id: string;
  framework_id: string;
  reference_id: string;
  title: string;
  created_at: string;
};

export type RequirementsResponse = {
  count: number;
  limit: number;
  frameworkId: string;
  nextCursor: { created_at: string; id: string } | null;
  requirements: Requirement[];
};

export type ControlMapping = {
  id: string;
  control_id: string;
  requirement_id: string;
  created_at: string;
};

export type ControlMappingsResponse = {
  count: number;
  limit: number;
  nextCursor: { created_at: string; id: string } | null;
  control_mappings: ControlMapping[];
};

export type ObligationMapping = {
  id: string;
  obligation_id: string;
  requirement_id: string;
  requirement?: Requirement;
  created_at: string;
};

export type ObligationMappingsResponse = {
  count: number;
  obligationId?: string;
  requirementId?: string;
  obligation_mappings: ObligationMapping[];
};

export type MappedControl = {
  control_id: string;
  control_name: string;
  latest_assessment_status: string | null;
};

export type ReadinessRequirement = {
  id: string;
  reference_id: string;
  title: string;
  status: "satisfied" | "partial" | "unmapped";
  mapped_controls: MappedControl[];
};

export type FrameworkReadiness = {
  framework: { id: string; name: string; version: string };
  readiness_score: number;
  total_requirements: number;
  satisfied: number;
  partial: number;
  unmapped: number;
  /** The explicit coverage breakdown ("0 fully satisfied · 3 partial"),
   *  formatted ONCE by the engine (src/api/lib/frameworkCoverage.ts) — item-7
   *  ruling. Surfaces render it verbatim; never re-derive the wording. */
  coverage_caption: string;
  requirements: ReadinessRequirement[];
};

export type Control = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  owner_user_id: string | null;
  control_type: string | null;
  status: string;
  domain: string | null;
  control_family: string | null;
  maturity_level: string | null;
  implementation_status: string | null;
  testing_frequency: "monthly" | "quarterly" | "biannual" | "annual" | "ad_hoc" | null;
  next_test_due: string | null;
  last_tested_at: string | null;
  is_overdue: boolean;
  created_at: string;
  updated_at: string;
};

export type ControlsResponse = {
  count: number;
  limit: number;
  organizationId: string;
  nextCursor: { created_at: string; id: string } | null;
  controls: Control[];
};

export type ControlAssessment = {
  id: string;
  organization_id: string;
  control_id: string;
  status: string;
  overall_severity: string | null;
  summary: string | null;
  notes: string | null;
  performed_at: string | null;
  reviewer_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ControlAssessmentsResponse = {
  count: number;
  limit: number;
  organizationId: string;
  nextCursor: { created_at: string; id: string } | null;
  assessments: ControlAssessment[];
};

export type BillingSessionResult = { url: string } | { error: string };

// ─── Customer auth types ────────────────────────────────────────────────────

/**
 * What the engine says happened to the verification email.
 *
 * `sent` is the only value that licenses "check your inbox" copy. The other two
 * mean the account exists but nothing was delivered, so the customer is locked
 * out until they recover — login answers 403 `email_not_verified` and the token
 * lives only in the database.
 */
export type VerificationEmailStatus = "sent" | "unavailable" | "failed";

export type AuthSignupResponse =
  | {
      ok: true;
      message: string;
      /** Absent on engines predating the truthful-signup fix; treat as unknown. */
      verification_email?: VerificationEmailStatus;
      detail?: string;
      recovery?: { resend_path: string; resend_endpoint: string; support_email: string };
    }
  | { error: string; detail?: string };

export type AuthLoginResponse =
  | {
      ok: true;
      token: string;
      user: {
        id: string;
        email: string;
        name: string;
        role: string;
        organizationId: string;
        organizationName: string;
        entitlementLevel: string;
        onboardingCompleted?: boolean;
      };
    }
  | { mfa_required: true; mfa_token: string }
  | { error: string };

export type AuthMeResponse = {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string;
  organizationName: string;
  entitlementLevel: string;
  billingActive: boolean;
  emailSuppressed?: boolean;
  onboardingCompleted?: boolean;
  totpEnabled?: boolean;
  previousLoginAt?: string | null;
  userCreatedAt?: string;
  dismissedBannerKeys?: string[];
};

export type TeamMember = {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  created_at: string;
  last_used_at: string | null;
  lockout_until?: string | null;
  totp_enabled?: boolean;
};

export type PendingInvite = {
  id: string;
  email: string;
  role: string;
  invited_by: string;
  expires_at: string;
  created_at: string;
};

export type TeamResponse = {
  members: TeamMember[];
  pending_invites: PendingInvite[];
  seat_usage: { used: number; max: number };
};

export type InvitePreviewResponse =
  | { valid: true; email: string; orgName: string; inviterName: string; role: string }
  | { valid: false; reason: string };

export type AuditEvent = {
  id: string;
  organization_id: string | null;
  actor_api_key_id: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  event_type: string;
  resource_type: string;
  resource_id: string | null;
  payload: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
};

// AuditLogEvent — shape returned by the viewer API (payload aliased as metadata)
export type AuditLogEvent = {
  id: string;
  event_type: string;
  actor_email: string | null;
  actor_name: string | null;
  resource_type: string | null;
  resource_id: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type AuditLogResponse = {
  events: AuditLogEvent[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
};

export type ApiKeyRecord = {
  id: string;
  label: string;
  entitlement_level: string;
  status: "active" | "revoked";
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
  expires_at?: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
};

export type ApiKeyCreateResponse = {
  key: ApiKeyRecord;
  rawKey: string;
};

export type KeyUsageSummary = {
  key_id: string;
  label: string;
  status: string;
  total_requests: number;
  requests_last_7_days: number;
  last_active_date: string | null;
};

export type ApiUsageResponse = {
  keys: KeyUsageSummary[];
  daily: { date: string; total: number }[];
  totalRequests: number;
  periodDays: number;
};

export type ApiKeysResponse = {
  keys: ApiKeyRecord[];
};

export type SsoConfig = {
  id: string;
  organization_id: string;
  idp_entity_id: string;
  idp_sso_url: string;
  idp_certificate: string;
  sp_entity_id: string;
  is_enforced: boolean;
  created_at: string;
  updated_at: string;
};

export type SsoDomainCheck = {
  hasSso: boolean;
  isEnforced: boolean;
  organizationId: string | null;
};

// =========================================================
// HELPERS
// =========================================================

/**
 * Default client abort for engine reads. Right for the CRUD surface, which
 * answers in well under a second; deliberately overridable, because one caller
 * on this client is not a CRUD read (see ASK_CLIENT_TIMEOUT_MS).
 */
export const ENGINE_FETCH_TIMEOUT_MS = 15_000;

/**
 * Ask is the exception, and it must OUTLIVE the engine's own budget.
 *
 * The engine bounds `/api/ask` at 90s (ASK_REQUEST_TIMEOUT_MS, raised in
 * 1f8da416 once a real tool-path turn was measured at 38–52s). Aborting here
 * at the 15s default meant the app gave up less than a third of the way in and
 * reported `network_error` — rendered to the user as "Couldn't reach the
 * server. Check your connection and try again." — for a server that was
 * working correctly and about to answer.
 *
 * It also silently defeated that 90s fix on the ONE path that needed it. The
 * page uses SSE when streaming is on (its proxy already allows 180s), so the
 * non-streaming server action is exactly what runs where streaming is OFF —
 * the production default. Engine-side probes never saw this because they call
 * the engine directly and never cross this client.
 *
 * 95s is the engine's 90s PLUS margin, in that order and for that reason: the
 * client must still be waiting when the engine gives up, so the user gets the
 * engine's real 504 rather than a fabricated connection error. The ceiling is
 * Cloudflare, which aborts the origin at ~100s.
 */
export const ASK_CLIENT_TIMEOUT_MS = 95_000;

async function engineFetch(
  path: string,
  token: string,
  options?: RequestInit,
  timeoutMs: number = ENGINE_FETCH_TIMEOUT_MS
): Promise<Response> {
  // Supports both legacy API keys (sl_…) and JWT tokens (contains ".").
  // The engine's requireApiKey middleware accepts both via Authorization: Bearer.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${ENGINE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        ...(options?.headers ?? {}),
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

// =========================================================
// PUBLIC API
// =========================================================

export async function getMe(apiKey: string): Promise<MeResponse | null> {
  try {
    const res = await engineFetch("/api/me", apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<MeResponse>;
  } catch {
    return null;
  }
}

/**
 * Billing/subscription state from GET /api/billing/subscription.
 * `status` distinguishes "trialing" from "active"; trial_end + amount/interval
 * come straight off the live Stripe subscription (never hardcoded).
 */
export interface SubscriptionInfo {
  tier: string;
  entitlement_level: string;
  status: "active" | "trialing" | "past_due" | "canceled" | "none";
  stripe_customer_id: string | null;
  current_period_end: string | null;
  payment_failed_at: string | null;
  /**
   * The ENGINE's grace decision, not a client-side derivation. Computed by the
   * same graceWindow function that the request path enforces with and the
   * dunning emails are worded from, so /account cannot tell a customer
   * something different from what the platform is doing.
   */
  grace_state: "healthy" | "in_grace" | "lapsed";
  /** ISO date access ends, present only while grace_state is "in_grace". */
  grace_ends_at: string | null;
  subscription_tier: string | null;
  /** ISO timestamp the trial converts to a paid subscription (trialing only). */
  trial_end: string | null;
  /** Subscribed price in the smallest currency unit (e.g. cents). */
  amount: number | null;
  currency: string | null;
  /** Stripe recurring interval: "month" | "year". */
  interval: string | null;
}

export async function getSubscription(token: string): Promise<SubscriptionInfo | null> {
  try {
    const res = await engineFetch("/api/billing/subscription", token);
    if (!res.ok) return null;
    return res.json() as Promise<SubscriptionInfo>;
  } catch {
    return null;
  }
}

export async function getIssues(apiKey: string): Promise<IssuesResponse | null> {
  try {
    const res = await engineFetch("/api/newsletter-issues", apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<IssuesResponse>;
  } catch {
    return null;
  }
}

export async function getIssue(
  apiKey: string,
  id: string
): Promise<NewsletterIssue | null> {
  try {
    const res = await engineFetch(`/api/newsletter-issues/${id}`, apiKey);
    if (!res.ok) return null;
    const body = (await res.json()) as { issue: NewsletterIssue };
    return body.issue ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch a single intelligence brief by id.
 *
 * Returns the full detail-shape (content_json with synthesis, content_markdown,
 * embedded items). Returns null on 404, network failure, or any non-2xx response.
 *
 * Pattern matches getIssue: callers can compose with Promise.all and treat
 * a null result as "not this entity type" rather than "error".
 */
export async function getIntelligenceBrief(
  apiKey: string,
  id: string
): Promise<IntelligenceBriefDetailResponse | null> {
  try {
    const res = await engineFetch(`/api/intelligence-briefs/${id}`, apiKey);
    if (!res.ok) return null;
    return (await res.json()) as IntelligenceBriefDetailResponse;
  } catch {
    return null;
  }
}

/**
 * List the org's canonical intelligence briefs (metadata only — no items).
 * The /briefs archive reads this; it previously listed the legacy
 * newsletter-issues table, whose generation pipeline is off by default, so
 * paying readers could not browse brief history at all.
 */
export async function getIntelligenceBriefs(
  apiKey: string,
  opts: { limit?: number; status?: string } = {}
): Promise<IntelligenceBriefListResponse | null> {
  try {
    const p = new URLSearchParams();
    if (opts.limit) p.set("limit", String(opts.limit));
    if (opts.status) p.set("status", opts.status);
    const qs = p.toString();
    const res = await engineFetch(`/api/intelligence-briefs${qs ? `?${qs}` : ""}`, apiKey);
    if (!res.ok) return null;
    return (await res.json()) as IntelligenceBriefListResponse;
  } catch {
    return null;
  }
}

/**
 * Fetch the most recent intelligence brief for the org with all items embedded.
 *
 * Two-step: GET /api/intelligence-briefs?limit=1 to find the latest brief id,
 * then getIntelligenceBrief() for the full payload (the list endpoint is
 * metadata-only — items only come back via the detail route).
 *
 * Returns null when no briefs exist or any request fails.
 */
/**
 * The three answers "what is the latest brief?" can have (EDX-1).
 *
 * This reader is the one place in lib/api that MUST discriminate, because its
 * consumer prints a sentence about publication history — "No briefs published
 * yet" — which is a claim about the customer's data, not about the request. A
 * bare `T | null` cannot support that claim: `null` covered a failed list read,
 * an empty list, and a failed detail read alike, so an outage told a subscriber
 * nothing had ever been published.
 */
export type LatestBriefResult =
  | { state: "unavailable" }
  | { state: "none" }
  | { state: "brief"; brief: IntelligenceBriefDetailResponse };

export async function getLatestBrief(
  apiKey: string
): Promise<LatestBriefResult> {
  try {
    const listRes = await engineFetch("/api/intelligence-briefs?limit=1", apiKey);
    if (!listRes.ok) return { state: "unavailable" };

    const list = (await listRes.json()) as IntelligenceBriefListResponse;
    const latest = list.briefs?.[0];
    // The list read SUCCEEDED and holds nothing. That is an answer.
    if (!latest) return { state: "none" };

    const brief = await getIntelligenceBrief(apiKey, latest.id);
    // A brief exists but its detail could not be fetched. Emphatically not
    // "none": the list just said otherwise.
    return brief ? { state: "brief", brief } : { state: "unavailable" };
  } catch {
    return { state: "unavailable" };
  }
}

export async function createCheckoutSession(
  apiKey: string,
  tier: "professional" | "teams" | "platform" | "platform_annual"
): Promise<BillingSessionResult> {
  try {
    const res = await engineFetch("/api/billing/checkout", apiKey, {
      method: "POST",
      body: JSON.stringify({ tier }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      return { error: body.message ?? body.error ?? res.statusText ?? "unknown" };
    }
    const data = (await res.json()) as { checkoutUrl?: string };
    if (!data.checkoutUrl) return { error: "missing_checkout_url" };
    return { url: data.checkoutUrl };
  } catch {
    return { error: "network_error" };
  }
}

export async function createPortalSession(
  apiKey: string
): Promise<BillingSessionResult> {
  try {
    const res = await engineFetch("/api/billing/portal", apiKey, { method: "POST" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      return { error: body.message ?? body.error ?? res.statusText ?? "unknown" };
    }
    const data = (await res.json()) as { portalUrl?: string };
    if (!data.portalUrl) return { error: "missing_portal_url" };
    return { url: data.portalUrl };
  } catch {
    return { error: "network_error" };
  }
}

export async function engineLogout(token: string): Promise<void> {
  try {
    await engineFetch("/api/auth/logout", token, { method: "POST" });
  } catch {
    // Fire-and-forget — sign-out proceeds even if the engine is unreachable
  }
}

export async function requestRecovery(email: string): Promise<{ ok: boolean }> {
  try {
    const res = await fetch(`${ENGINE_URL}/api/account/recovery/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false };
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function claimRecovery(
  token: string
): Promise<{ ok: true; apiKey: string } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${ENGINE_URL}/api/account/recovery/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      cache: "no-store",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? "recovery_failed" };
    }
    const body = (await res.json()) as { apiKey: string };
    return { ok: true, apiKey: body.apiKey };
  } catch {
    return { ok: false, error: "recovery_failed" };
  }
}

export async function getDashboardSummary(
  apiKey: string
): Promise<DashboardSummary | null> {
  try {
    const res = await engineFetch("/api/dashboard/summary", apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<DashboardSummary>;
  } catch {
    return null;
  }
}

export async function getPostureHistory(
  token: string,
  days: number = 90
): Promise<PostureHistory | null> {
  try {
    const res = await engineFetch(`/api/posture/history?days=${days}`, token);
    if (!res.ok) return null;
    return res.json() as Promise<PostureHistory>;
  } catch {
    return null;
  }
}

/**
 * The register filters GET /api/vendors applies in SQL.
 *
 * `criticality` and `reviewed` live here rather than in the page because
 * filtering a fetched page can only ever narrow the ≤100 rows the engine chose
 * to return: past the cap a matching vendor is simply absent from the filtered
 * view, with nothing disclosing the loss. The same rule the Actions and
 * Findings queues already follow.
 */
export type VendorListOpts = {
  /** Shared asset-search term (engine-resolved: name, alias, exact UUID). */
  q?: string;
  criticality?: "critical" | "high" | "medium" | "low";
  /**
   * LEGACY — `last_reviewed_at IS NULL`. Retained for API compatibility only.
   *
   * RULING (2026-08-09): "Never reviewed" is not a valid customer-facing metric.
   * `vendors.last_reviewed_at` is written by nothing in the product, so any
   * claim built on it is one the system cannot support. No SecureLogic surface
   * may use this filter; use `assessed` instead.
   */
  reviewed?: "never";
  /**
   * The RATIFIED definition: vendors with zero rows in `vendor_assessments`.
   * Shares its SQL predicate with the `never_assessed_count` aggregate, so a
   * count and the list it links to are the same population by construction.
   */
  assessed?: "never";
  /** Slice size. Use 1 when the response is wanted only for its aggregates. */
  limit?: number;
};

export async function getVendors(
  apiKey: string,
  status: "active" | "archived" = "active",
  opts: VendorListOpts = {}
): Promise<VendorsResponse | null> {
  try {
    const params = new URLSearchParams({
      status,
      limit: String(opts.limit ?? 100),
    });
    if (opts.q) params.set("q", opts.q);
    if (opts.criticality) params.set("criticality", opts.criticality);
    if (opts.reviewed) params.set("reviewed", opts.reviewed);
    if (opts.assessed) params.set("assessed", opts.assessed);
    const res = await engineFetch(`/api/vendors?${params.toString()}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<VendorsResponse>;
  } catch {
    return null;
  }
}

export async function getVendorAssessments(
  apiKey: string,
  limit = 100
): Promise<VendorAssessmentsResponse | null> {
  try {
    const res = await engineFetch(
      `/api/vendor-assessments?limit=${limit}`,
      apiKey
    );
    if (!res.ok) return null;
    return res.json() as Promise<VendorAssessmentsResponse>;
  } catch {
    return null;
  }
}

export async function getAiSystems(
  apiKey: string,
  opts: { q?: string } = {}
): Promise<AiSystemsResponse | null> {
  try {
    const params = new URLSearchParams({ limit: "100" });
    // Shared asset-search term (engine-resolved: name, alias, exact UUID).
    if (opts.q) params.set("q", opts.q);
    const res = await engineFetch(`/api/ai-systems?${params.toString()}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<AiSystemsResponse>;
  } catch {
    return null;
  }
}

export async function getGovernanceReviews(
  apiKey: string
): Promise<GovernanceReviewsResponse | null> {
  try {
    const res = await engineFetch("/api/governance-reviews?limit=100", apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<GovernanceReviewsResponse>;
  } catch {
    return null;
  }
}

export async function getFrameworks(
  apiKey: string
): Promise<FrameworksResponse | null> {
  try {
    const res = await engineFetch("/api/frameworks?limit=100", apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<FrameworksResponse>;
  } catch {
    return null;
  }
}

export async function getFramework(
  apiKey: string,
  frameworkId: string
): Promise<Framework | null> {
  try {
    const res = await engineFetch(`/api/frameworks/${encodeURIComponent(frameworkId)}`, apiKey);
    if (!res.ok) return null;
    const body = (await res.json()) as { framework: Framework };
    return body.framework ?? null;
  } catch {
    return null;
  }
}

export type SelfAssessmentProgress = {
  total: number;
  pass: number;
  partial: number;
  fail: number;
  not_assessed: number;
  /** 0–100 share of requirements with a completed response. O-5 ruling:
   *  this measures assessment PROGRESS (how much has been answered), never
   *  readiness — readiness comes only from satisfied control mappings via
   *  FrameworkReadiness.readiness_score. */
  progress_pct: number;
};

export type FrameworkDetail = {
  framework: Framework;
  assessment_progress: {
    self: SelfAssessmentProgress;
  };
};

export async function getFrameworkDetail(
  apiKey: string,
  frameworkId: string
): Promise<FrameworkDetail | null> {
  try {
    const res = await engineFetch(`/api/frameworks/${encodeURIComponent(frameworkId)}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<FrameworkDetail>;
  } catch {
    return null;
  }
}

export async function getRequirements(
  apiKey: string,
  frameworkId: string,
  limit?: number
): Promise<RequirementsResponse | null> {
  try {
    const qs = new URLSearchParams({ framework_id: frameworkId });
    if (limit) qs.set("limit", String(limit));
    const res = await engineFetch(`/api/requirements?${qs.toString()}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<RequirementsResponse>;
  } catch {
    return null;
  }
}

export async function getControlMappings(
  apiKey: string,
  params: { control_id?: string; requirement_id?: string; limit?: number }
): Promise<ControlMappingsResponse | null> {
  try {
    const qs = new URLSearchParams();
    if (params.control_id) qs.set("control_id", params.control_id);
    if (params.requirement_id) qs.set("requirement_id", params.requirement_id);
    if (params.limit) qs.set("limit", String(params.limit));
    const res = await engineFetch(`/api/control-mappings?${qs.toString()}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<ControlMappingsResponse>;
  } catch {
    return null;
  }
}

export async function getObligationMappings(
  apiKey: string,
  params: { obligation_id?: string; requirement_id?: string; limit?: number }
): Promise<ObligationMappingsResponse | null> {
  try {
    const qs = new URLSearchParams();
    if (params.obligation_id) qs.set("obligation_id", params.obligation_id);
    if (params.requirement_id) qs.set("requirement_id", params.requirement_id);
    if (params.limit) qs.set("limit", String(params.limit));
    const res = await engineFetch(`/api/obligation-mappings?${qs.toString()}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<ObligationMappingsResponse>;
  } catch {
    return null;
  }
}

export async function getFrameworkReadiness(
  apiKey: string,
  frameworkId: string
): Promise<FrameworkReadiness | null> {
  try {
    const res = await engineFetch(
      `/api/frameworks/${encodeURIComponent(frameworkId)}/readiness`,
      apiKey
    );
    if (!res.ok) return null;
    return res.json() as Promise<FrameworkReadiness>;
  } catch {
    return null;
  }
}

export async function getControls(
  apiKey: string,
  params?: { q?: string }
): Promise<ControlsResponse | null> {
  try {
    const qs = new URLSearchParams({ limit: "100" });
    // Engine search mode: name/description ILIKE, alphabetical, no cursor
    // (the CUEC ControlPicker contract — reused, not duplicated).
    if (params?.q) qs.set("q", params.q);
    const res = await engineFetch(`/api/controls?${qs.toString()}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<ControlsResponse>;
  } catch {
    return null;
  }
}

export async function getControlAssessments(
  apiKey: string
): Promise<ControlAssessmentsResponse | null> {
  try {
    const res = await engineFetch("/api/control-assessments?limit=100", apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<ControlAssessmentsResponse>;
  } catch {
    return null;
  }
}

// ─── Customer auth engine calls ─────────────────────────────────────────────

export async function authSignup(
  organizationName: string,
  name: string,
  email: string,
  password: string,
  promoCode: string | undefined,
  acceptedTerms: boolean
): Promise<AuthSignupResponse> {
  const res = await fetch(`${ENGINE_URL}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationName, name, email, password, promoCode, acceptedTerms }),
    cache: "no-store",
  });
  return res.json() as Promise<AuthSignupResponse>;
}

// ─── Legal consent (PR #2) ──────────────────────────────────────────────────

/** The three legal documents tracked by the engine. */
export type ConsentDocumentType =
  | "terms_of_service"
  | "privacy_policy"
  | "ai_transparency_policy";

export type ConsentStatus =
  | { consentRequired: false }
  | { consentRequired: true; missingDocuments: ConsentDocumentType[] };

/**
 * Probe whether the current JWT user still owes consent to any current-version
 * legal document. Uses GET /api/me — a route behind the engine's requireConsent
 * middleware — so a user lacking consent comes back as 403 { error:
 * "consent_required", missingDocuments: [...] }.
 *
 * Fails OPEN (consentRequired: false) on any network/parse error or unexpected
 * status: a transient probe failure must never wall off the whole app. This
 * mirrors the engine middleware, which also fails open.
 */
export async function getConsentStatus(jwtToken: string): Promise<ConsentStatus> {
  try {
    const res = await fetch(`${ENGINE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${jwtToken}` },
      cache: "no-store",
    });
    if (res.status !== 403) return { consentRequired: false };
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      missingDocuments?: ConsentDocumentType[];
    };
    if (body.error !== "consent_required") return { consentRequired: false };
    return {
      consentRequired: true,
      missingDocuments: Array.isArray(body.missingDocuments) ? body.missingDocuments : [],
    };
  } catch {
    return { consentRequired: false };
  }
}

/**
 * Record consent for the current JWT user. Empty body lets the engine default
 * to all currently-missing documents (re-consent / first-login interstitial).
 */
export async function acceptTerms(
  jwtToken: string,
  acceptedDocuments?: ConsentDocumentType[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${ENGINE_URL}/api/auth/accept-terms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwtToken}`,
      },
      body: JSON.stringify(acceptedDocuments ? { acceptedDocuments } : {}),
      cache: "no-store",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? "accept_terms_failed" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

// ─── Self-service data export (GDPR/CCPA, user_self scope) ──────────────────

/**
 * One row in the engine's data-export bundle (only present once the worker has
 * written the file at completion). `available` collapses the purged/expired
 * checks the engine already computed — the client never re-derives them.
 */
export type DataExportFile = {
  id: string;
  sizeBytes: number | null;
  expiresAt: string | null;
  downloadedAt: string | null;
  purged: boolean;
  available: boolean;
  downloadPath: string | null;
};

/** One self-export request and its (possibly not-yet-ready) bundle. */
export type DataExportRecord = {
  jobId: string;
  status: string;
  requestedAt: string;
  completedAt: string | null;
  file: DataExportFile | null;
};

export type DataExportsListResponse = {
  exports: DataExportRecord[];
};

/**
 * Server-side initial fetch of the caller's own export requests, mirroring the
 * dashboard's lib-level engine reads. JWT-only: the engine answers 403
 * jwt_required for a legacy API-key session, which surfaces here as null — the
 * privacy page renders the sign-in explainer in that case rather than calling
 * this at all.
 */
export async function getDataExports(
  jwtToken: string
): Promise<DataExportsListResponse | null> {
  try {
    const res = await engineFetch("/api/data-exports", jwtToken);
    if (!res.ok) return null;
    return res.json() as Promise<DataExportsListResponse>;
  } catch {
    return null;
  }
}

export async function authLogin(
  email: string,
  password: string
): Promise<AuthLoginResponse> {
  const res = await fetch(`${ENGINE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  return res.json() as Promise<AuthLoginResponse>;
}

export async function authVerifyEmail(
  token: string
): Promise<{ ok: true; token: string } | { error: string }> {
  const res = await fetch(`${ENGINE_URL}/api/auth/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    cache: "no-store",
  });
  return res.json() as Promise<{ ok: true; token: string } | { error: string }>;
}

/**
 * Ask the engine to resend a verification email.
 *
 * The engine answers identically for every address on purpose — a per-address
 * outcome here would be an account-existence oracle — so `attempted` is as
 * specific as this can get, and it means exactly that: handed to the mail
 * provider, result unobserved. `unavailable` is the one honest exception: no
 * provider is configured at all, which is true of every address equally and so
 * gives nothing away.
 */
export async function authResendVerification(
  email: string
): Promise<{ ok: boolean; verificationEmail: "attempted" | "unavailable" }> {
  const res = await fetch(`${ENGINE_URL}/api/auth/resend-verification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
    cache: "no-store",
  });
  if (!res.ok) return { ok: false, verificationEmail: "attempted" };

  const body = (await res.json().catch(() => ({}))) as { verification_email?: unknown };
  return {
    ok: true,
    verificationEmail: body.verification_email === "unavailable" ? "unavailable" : "attempted",
  };
}

export async function authForgotPassword(
  email: string
): Promise<{ ok: boolean }> {
  const res = await fetch(`${ENGINE_URL}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
    cache: "no-store",
  });
  if (!res.ok) return { ok: false };
  return { ok: true };
}

export async function authResetPassword(
  token: string,
  password: string
): Promise<{ ok: true } | { error: string }> {
  const res = await fetch(`${ENGINE_URL}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
    cache: "no-store",
  });
  return res.json() as Promise<{ ok: true } | { error: string }>;
}

export async function getAuthMe(
  jwtToken: string
): Promise<AuthMeResponse | null> {
  try {
    const res = await fetch(`${ENGINE_URL}/api/auth/me`, {
      headers: {
        "Authorization": `Bearer ${jwtToken}`,
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json() as Promise<AuthMeResponse>;
  } catch {
    return null;
  }
}

export async function authCompleteOnboarding(
  jwtToken: string
): Promise<{ ok: boolean }> {
  try {
    const res = await fetch(`${ENGINE_URL}/api/auth/onboarding-complete`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${jwtToken}` },
      cache: "no-store",
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

export async function getTeamMembers(token: string): Promise<TeamResponse | null> {
  try {
    const res = await engineFetch("/api/team/members", token);
    if (!res.ok) return null;
    return res.json() as Promise<TeamResponse>;
  } catch {
    return null;
  }
}

export type OrgSettings = {
  require_mfa: boolean;
  // Organization profile (customer-writable since the org-profile settings
  // surface). The risk-context fields drive context-weighted scoring, finding
  // enterprise context, and posture computation.
  name: string;
  regulated: boolean;
  handles_pii: boolean;
  safety_critical: boolean;
  scale: "Small" | "Medium" | "Enterprise";
  // ASK-C C-1 (LC-4): tenant-level voice governance. Optional so the app
  // tolerates an engine predating the column; absence means enabled.
  voice_input_enabled?: boolean;
};

export async function getOrgSettings(token: string): Promise<OrgSettings | null> {
  try {
    const res = await engineFetch("/api/org/settings", token);
    if (!res.ok) return null;
    return res.json() as Promise<OrgSettings>;
  } catch {
    return null;
  }
}

export type TileConfig = {
  id: string;
  visible: boolean;
  order: number;
};

export type DashboardPreferences = {
  layout: TileConfig[];
  source: "personal" | "org_default" | "system_default";
};

export async function getDashboardPreferences(token: string): Promise<DashboardPreferences | null> {
  try {
    const res = await engineFetch("/api/dashboard/preferences", token);
    if (!res.ok) return null;
    return res.json() as Promise<DashboardPreferences>;
  } catch {
    return null;
  }
}

/**
 * The caller's saved Briefing layout (Briefing Initiative B2). `layout` is the
 * raw stored envelope — parsed/enforced by moduleIdsFromEnvelope +
 * filterRequestedModules app-side. null (fetch/flag-off/no-identity) and
 * {layout: null} (no saved row) both mean "unsaved state" to the caller.
 */
export type BriefingLayoutResponse = {
  layout: unknown | null;
  updated_at: string | null;
};

export async function getBriefingLayout(
  token: string
): Promise<BriefingLayoutResponse | null> {
  try {
    const res = await engineFetch("/api/briefing/layout", token);
    if (!res.ok) return null;
    return res.json() as Promise<BriefingLayoutResponse>;
  } catch {
    return null;
  }
}

export async function updateDashboardPreferences(
  token: string,
  layout: TileConfig[]
): Promise<DashboardPreferences | null> {
  try {
    const res = await engineFetch("/api/dashboard/preferences", token, {
      method: "PUT",
      body: JSON.stringify({ layout }),
    });
    if (!res.ok) return null;
    return res.json() as Promise<DashboardPreferences>;
  } catch {
    return null;
  }
}

export async function resetDashboardPreferences(token: string): Promise<DashboardPreferences | null> {
  try {
    const res = await engineFetch("/api/dashboard/preferences", token, { method: "DELETE" });
    if (!res.ok) return null;
    return res.json() as Promise<DashboardPreferences>;
  } catch {
    return null;
  }
}

export async function updateOrgDashboardPreferences(
  token: string,
  layout: TileConfig[]
): Promise<DashboardPreferences | null> {
  try {
    const res = await engineFetch("/api/dashboard/preferences/org", token, {
      method: "PUT",
      body: JSON.stringify({ layout }),
    });
    if (!res.ok) return null;
    return res.json() as Promise<DashboardPreferences>;
  } catch {
    return null;
  }
}

export async function getInvitePreview(token: string): Promise<InvitePreviewResponse | null> {
  try {
    const res = await fetch(
      `${ENGINE_URL}/api/team/invites/${encodeURIComponent(token)}/preview`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    return res.json() as Promise<InvitePreviewResponse>;
  } catch {
    return null;
  }
}

export async function getVendor(
  apiKey: string,
  id: string
): Promise<Vendor | null> {
  try {
    const res = await engineFetch(`/api/vendors/${encodeURIComponent(id)}`, apiKey);
    if (!res.ok) return null;
    const body = (await res.json()) as { vendor: Vendor };
    return body.vendor ?? null;
  } catch {
    return null;
  }
}

export async function getVendorAssessmentsForVendor(
  apiKey: string,
  vendorId: string,
  limit = 20
): Promise<VendorAssessmentsResponse | null> {
  try {
    const res = await engineFetch(
      `/api/vendor-assessments?vendor_id=${encodeURIComponent(vendorId)}&limit=${limit}`,
      apiKey
    );
    if (!res.ok) return null;
    return res.json() as Promise<VendorAssessmentsResponse>;
  } catch {
    return null;
  }
}

export type VendorFinding = {
  id: string;
  title: string;
  severity: string;
  status: string;
  domain: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
  assessment_id: string;
  assessment_type: string;
  performed_at: string | null;
};

export async function getVendorFindings(
  apiKey: string,
  vendorId: string,
  status?: string
): Promise<{ findings: VendorFinding[]; total: number } | null> {
  try {
    const params = new URLSearchParams({ limit: "100" });
    if (status) params.set("status", status);
    const res = await engineFetch(
      `/api/vendors/${encodeURIComponent(vendorId)}/findings?${params.toString()}`,
      apiKey
    );
    if (!res.ok) return null;
    return res.json() as Promise<{ findings: VendorFinding[]; total: number }>;
  } catch {
    return null;
  }
}

export async function getVendorReviews(
  apiKey: string,
  vendorId?: string,
  limit = 20
): Promise<VendorReviewsResponse | null> {
  try {
    const params = new URLSearchParams({ limit: String(limit) });
    if (vendorId) params.set("vendor_id", vendorId);
    const res = await engineFetch(`/api/vendor-reviews?${params.toString()}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<VendorReviewsResponse>;
  } catch {
    return null;
  }
}

export async function getVendorReview(
  apiKey: string,
  id: string
): Promise<{ review: VendorReview; finding: Finding | null } | null> {
  try {
    const res = await engineFetch(`/api/vendor-reviews/${encodeURIComponent(id)}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<{ review: VendorReview; finding: Finding | null }>;
  } catch {
    return null;
  }
}

export async function getFindings(
  apiKey: string,
  params?: FindingsParams
): Promise<FindingsResponse | null> {
  try {
    const qs = new URLSearchParams();
    if (params?.domain) qs.set("domain", params.domain);
    if (params?.source_type) qs.set("source_type", params.source_type);
    if (params?.status) qs.set("status", params.status);
    if (params?.severity) qs.set("severity", params.severity);
    if (params?.source_id) qs.set("source_id", params.source_id);
    if (params?.priority) qs.set("priority", params.priority);
    if (params?.decision_state) qs.set("decision_state", params.decision_state);
    if (params?.operational_status) qs.set("operational_status", params.operational_status);
    if (params?.overdue) qs.set("overdue", "true");
    if (params?.unassigned) qs.set("unassigned", "true");
    if (params?.exploited) qs.set("exploited", "true");
    if (params?.owner) qs.set("owner", params.owner);
    if (params?.review_owner) qs.set("review_owner", params.review_owner);
    if (params?.active) qs.set("active", "true");
    if (params?.ready_for_decision) qs.set("ready_for_decision", "true");
    if (params?.intel_ref) qs.set("intel_ref", params.intel_ref);
    if (params?.q) qs.set("q", params.q);
    if (params?.due) qs.set("due", params.due);
    if (params?.has_action) qs.set("has_action", "true");
    if (params?.has_evidence) qs.set("has_evidence", "true");
    if (params?.created_from) qs.set("created_from", params.created_from);
    if (params?.created_to) qs.set("created_to", params.created_to);
    if (params?.sort) qs.set("sort", params.sort);
    if (typeof params?.offset === "number" && params.offset > 0) {
      qs.set("offset", String(params.offset));
    }
    if (params?.before) {
      qs.set("before_created_at", params.before.created_at);
      qs.set("before_id", params.before.id);
    }
    qs.set("limit", String(params?.limit ?? 50));
    const res = await engineFetch(`/api/findings?${qs.toString()}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<FindingsResponse>;
  } catch {
    return null;
  }
}

export async function getFindingsSummary(
  apiKey: string
): Promise<{ summary: FindingsSummary } | null> {
  try {
    const res = await engineFetch(`/api/findings/summary`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<{ summary: FindingsSummary }>;
  } catch {
    return null;
  }
}

export async function getFinding(
  apiKey: string,
  id: string
): Promise<{ finding: Finding } | null> {
  try {
    const res = await engineFetch(`/api/findings/${encodeURIComponent(id)}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<{ finding: Finding }>;
  } catch {
    return null;
  }
}

// ─── Decision Workspace (ERIP Package 3) ─────────────────────────────────────
// The engine 404s /api/findings/:id/context while SECURELOGIC_DECISION_WORKSPACE_ENABLED
// is off, so getFindingContext returns null → the page renders the legacy detail.

export type FindingAffectedEntity = { type: string; id: string; name: string };
// Context Contract: how an affected bucket resolved (empty ≠ zero ≠ unknowable).
/**
 * Mirrors the engine's Context Contract. `resolver_error` is the state that says the
 * emptiness is IGNORANCE, not a zero — the UI must never render it as "None found".
 */
export type AffectedResolution =
  | "resolved"
  | "none_found"
  | "not_applicable"
  | "resolver_error";
// A matcher suggestion awaiting human review — a candidate, not certainty.
export type FindingCandidateEntity = {
  type: string;
  id: string;
  name: string;
  status: "needs_review";
  match_reason: string | null;
  match_score: number | null;
};
export type FindingImpactDimension = { level: string; note: string };
export type FindingContext = {
  finding: {
    id: string;
    source_type: string;
    source_id: string | null;
    decision_state: string;
    // System-derived operational axis (spec §1.1); optional on older payloads.
    operational_status?: string;
  };
  risk: { score: number; band: string; rationale: string[] };
  // `revenue` and `customer` were removed: they were hardcoded "not_assessed"
  // literals with no schema column behind them and no code path that could ever
  // set them otherwise. See findingRiskScore.ts BusinessImpact.
  business_impact: {
    operational: FindingImpactDimension;
    regulatory: FindingImpactDimension;
    third_party: FindingImpactDimension;
  };
  owner: { id: string; email: string } | null;
  /**
   * Independent Governance Review projection (mirrors the engine). Drives the remediator's
   * waiting state and the reviewer's decision controls. `independent_review_active` is true
   * only when the workflow flag is on AND the org enforces closure separation of duties;
   * when false the workspace behaves exactly as before this feature. `reviewer` is the
   * assigned Closure Owner (review_owner_user_id); `remediator_user_id` is the actor who
   * completed the remediation (latest operational→remediated event), so the UI can tell a
   * remediator (waiting state) from the assigned reviewer (decision controls). Optional on
   * older engine payloads → treated as inactive (unchanged UI).
   */
  review?: {
    independent_review_active: boolean;
    reviewer: { id: string; email: string; name: string | null } | null;
    remediator_user_id: string | null;
  };
  affected: {
    vendors: FindingAffectedEntity[];
    ai_systems: FindingAffectedEntity[];
    controls: FindingAffectedEntity[];
    obligations: FindingAffectedEntity[];
    // ERG convergence C5 — canonical Enterprise Assets the applicability
    // decision reached, resolved through asset_registry_v. Absent (not empty)
    // whenever the engine convergence is dark, so the dark surface is unchanged.
    assets?: FindingAffectedEntity[];
    // Context Contract: per-bucket resolution outcome — distinguishes an
    // honest zero ('none_found') from a bucket the resolver has no path for
    // on this source type ('not_applicable'). Optional on older payloads.
    resolution?: {
      vendors: AffectedResolution;
      ai_systems: AffectedResolution;
      controls: AffectedResolution;
      obligations: AffectedResolution;
      assets?: AffectedResolution;
    };
    // Matcher suggestions pending human review — candidate links, never
    // merged into the buckets above. Optional on older payloads.
    candidates?: FindingCandidateEntity[];
  };
  intelligence: {
    events: Array<Record<string, unknown>>;
    sources: Array<Record<string, unknown>>;
    timeline: Array<Record<string, unknown>>;
    // The signals this finding resolves to (post-bridge). Lets the UI scope the
    // suggested-links queue to THIS finding. Optional: older payloads omit it.
    signal_ids?: string[];
  };
  evidence: Array<Record<string, unknown>>;
  // Tiers 1–4 of the relationship hierarchy, best-tier-first. Tier 5 (vendor) is
  // never in this list — it is a count in `related_context`, so vendor stays
  // supporting context and never becomes the workflow's organizing principle.
  related_findings: Array<{
    id: string;
    title: string;
    severity: string;
    status: string;
    relation_tier?: number;
    relation?: string;
  }>;
  related_context?: {
    same_vendor: Array<{ vendor_id: string; vendor_name: string; finding_count: number }>;
  };
  // Audit-grade activity entries. The core three (event_type / created_at /
  // payload) are always present; the enrichment fields are optional so older
  // payloads and fixtures stay valid. `resource_type`/`resource_id` scope the
  // entry to a finding or a specific remediation action; `actor_*` is WHO;
  // `action_title` + `blocked_owner_*` are the resolved WHAT/WHO the renderer
  // shows instead of a bare id.
  activity: Array<{
    event_type: string;
    created_at: string;
    payload: unknown;
    resource_type?: string;
    resource_id?: string | null;
    actor_user_id?: string | null;
    actor_name?: string | null;
    actor_email?: string | null;
    action_title?: string | null;
    blocked_owner_name?: string | null;
    blocked_owner_email?: string | null;
  }>;
  whats_changed: { since: string | null; changes: Array<{ label: string; at: string }> };
};

// ─── Pen-test engagements (SL-PENTEST-IN / PEN-1) ────────────────────────────
// The penetration test a finding came from — provenance, not a lifecycle. Its
// findings are ordinary Findings reached through getFindings({ source_type:
// "pen_test", source_id }): there is deliberately NO pentest-specific findings
// endpoint, so nothing here duplicates the finding list contract.

/** T2-I lifecycle — a STATEMENT of where the engagement is, not a lock:
 *  transitions are free (the engine rules why), the audit log holds history. */
export type PenTestEngagementStatus =
  | "planned"
  | "testing"
  | "report_received"
  | "remediation"
  | "closed";

export type PenTestTestType =
  | "network"
  | "web_application"
  | "mobile_application"
  | "api"
  | "cloud"
  | "social_engineering"
  | "physical"
  | "red_team"
  | "other";

export type PenTestEngagement = {
  id: string;
  name: string;
  /** The testing firm — free text, deliberately not a Vendor record. */
  provider: string | null;
  started_on: string | null;
  ended_on: string | null;
  /** Where the report lives — a URL, a document id, or a filing reference. */
  report_reference: string | null;
  /** T2-I: where the engagement is in its lifecycle. */
  status: PenTestEngagementStatus;
  test_type: PenTestTestType | null;
  /** The recurrence clock ("annual test due"), YYYY-MM-DD or null. */
  next_test_due: string | null;
  /**
   * Overdue is COMPUTED BY THE ENGINE at read (next_test_due < today) — the
   * app renders it and never recomputes it client-side.
   */
  test_overdue: boolean;
  /** Detail-only (the list row omits them): the provider's own words. */
  methodology?: string | null;
  scope_summary?: string | null;
  /** Stamped by the engine on entry to 'closed', cleared on leaving — the
   *  closed <=> stamped pair is a DB CHECK and can never disagree. */
  closed_at?: string | null;
  created_at: string;
  /**
   * Findings referencing this engagement (source_type='pen_test'). Computed by
   * the engine in SQL — an engagement showing zero is either brand new or an
   * import that failed, and those look identical without the count.
   */
  finding_count: number;
};

/** One retest act on a pen-test finding (T2-I). APPEND-ONLY on the engine —
 *  the newest row is the current verification state, and a 'remediated'
 *  retest NEVER closes the finding (the closure gate is the only path). */
export type PenTestRetestResult =
  | "remediated"
  | "not_remediated"
  | "partially_remediated";

export type PenTestRetest = {
  id: string;
  engagement_id: string;
  /** Joined by the engine: the name of the engagement that DID the retest —
   *  legitimately a later engagement than the one that found the issue. */
  engagement_name: string;
  result: PenTestRetestResult;
  notes: string | null;
  performed_on: string;
  recorded_by_user_id: string | null;
  created_at: string;
};

/** Verification history for one pen-test finding, newest first. null = the
 *  fetch failed (an outage), which is a DIFFERENT fact from an empty history
 *  ("never retested") — callers must not collapse the two. */
export async function getFindingRetests(
  apiKey: string,
  findingId: string
): Promise<{ count: number; retests: PenTestRetest[] } | null> {
  try {
    const res = await engineFetch(
      `/api/findings/${encodeURIComponent(findingId)}/retests`,
      apiKey
    );
    if (!res.ok) return null;
    return res.json() as Promise<{ count: number; retests: PenTestRetest[] }>;
  } catch {
    return null;
  }
}

export async function getPenTestEngagements(
  apiKey: string
): Promise<{ engagements: PenTestEngagement[]; count: number } | null> {
  try {
    const res = await engineFetch(`/api/pen-test-engagements`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<{ engagements: PenTestEngagement[]; count: number }>;
  } catch {
    return null;
  }
}

export async function getPenTestEngagement(
  apiKey: string,
  id: string
): Promise<{ engagement: PenTestEngagement } | null> {
  try {
    const res = await engineFetch(`/api/pen-test-engagements/${encodeURIComponent(id)}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<{ engagement: PenTestEngagement }>;
  } catch {
    return null;
  }
}

export async function getFindingContext(
  apiKey: string,
  id: string
): Promise<FindingContext | null> {
  try {
    const res = await engineFetch(`/api/findings/${encodeURIComponent(id)}/context`, apiKey);
    if (!res.ok) return null;
    const body = (await res.json()) as { context: FindingContext };
    return body.context;
  } catch {
    return null;
  }
}

// Finding risk-acceptance (product ruling 2026-07-12). The engine subsystem
// (/api/risk-acceptances) is the ONE approval workflow for accepting the risk of a
// Finding — deliberately separate from `risk_approvals`, which approves Risk-Register
// entries and cannot approve a Finding. Every route 404s while
// SECURELOGIC_RISK_ACCEPTANCE_ENABLED is off (byte-identical flag-off).
export type RiskAcceptanceState =
  | "proposed"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "expired"
  | "legacy_unverified";

export type RiskAcceptance = {
  id: string;
  organization_id: string;
  finding_id: string;
  state: RiskAcceptanceState;
  /**
   * 'acceptance' = the organisation accepts the risk; remediation is finished
   * and the finding CLOSES. 'exception' = the organisation authorises a
   * temporary deviation; remediation remains OUTSTANDING and the finding stays
   * OPEN. Optional for backward compatibility with reads that predate it;
   * absent is read as 'acceptance', which is what every historical row is.
   */
  kind?: "acceptance" | "exception";
  owner_user_id: string | null;
  rationale: string | null;
  requested_by_user_id: string | null;
  approver_user_id: string | null;
  approved_at: string | null;
  decision_rationale: string | null;
  expires_at: string | null;
  withdrawn_at: string | null;
  // NB: withdrawn_by_user_id exists in the schema but the register SELECT does not
  // project it — a withdrawal is dated in the UI, not attributed.
  withdrawal_reason: string | null;
  governance_review_required: boolean;
  promoted_risk_id: string | null;
  /** What reduces the exposure while an exception stands. */
  compensating_control?: string | null;
  /** The finding's remediation due date when the request was made. Frozen. */
  sla_due_date_at_request?: string | null;
  created_at: string;
  updated_at: string;
  // JOINed finding columns the register/per-finding read returns (optional).
  finding_title?: string;
  finding_severity?: string;
  finding_priority?: string | null;
  finding_domain?: string | null;
  finding_operational_status?: string;
  evidence_count?: number;
  // Display names the register JOINs from users, so a governance surface can name the
  // people involved instead of printing their uuids. Absent/deleted user → null.
  requested_by_name?: string | null;
  requested_by_email?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  approver_name?: string | null;
  approver_email?: string | null;
  // Computed by the engine against the SESSION user: this viewer proposed this acceptance,
  // so separation of duties forbids them approving it. The engine enforces it regardless
  // (409 sod_violation); the UI refuses before the round-trip.
  is_self_proposed?: boolean;
};

/**
 * A finding's current acceptance plus its terminal history, org-scoped by the engine.
 *
 * The return distinguishes two states the caller MUST NOT conflate:
 *   null → the route is dark (404) or unreachable — the feature is NOT active for this
 *          caller, so the UI keeps the legacy Accept-Risk control (byte-identical).
 *   []   → the feature IS active and this finding simply has no acceptances yet — the UI
 *          shows the "propose acceptance" affordance.
 */
export async function getRiskAcceptancesForFinding(
  token: string,
  findingId: string
): Promise<RiskAcceptance[] | null> {
  try {
    const res = await engineFetch(
      `/api/risk-acceptances?finding_id=${encodeURIComponent(findingId)}`,
      token
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { acceptances?: RiskAcceptance[] };
    return body.acceptances ?? [];
  } catch {
    return null;
  }
}

export type RiskAcceptanceSummary = {
  awaiting_approval: number;
  active_acceptances: number;
  review_due_30d: number;
  lapsed_pending_sweep: number;
  expired: number;
  governance_review_required: number;
};

/**
 * The org-wide risk-acceptance approver queue, for /approvals.
 *
 * Reads the SAME register route the per-finding panel reads — there is no second approval
 * engine and no queue-specific endpoint. `?state=proposed` IS the pending queue: withdrawn,
 * rejected and expired records carry a different state, so they leave the queue by virtue
 * of the state machine rather than by any filtering the UI has to remember to do.
 *
 * ReadResult, not a bare array, because the three failure modes are NOT the same thing:
 *   disabled (404) → the feature is dark for this org; the section must not render at all.
 *   error          → the engine is reachable but unhappy; say so, don't render "0 pending".
 *   ok + []        → genuinely nothing awaiting approval. An honest empty state.
 * Collapsing these is how a dark or broken queue comes to read as "all clear".
 */
export async function getRiskAcceptanceQueueServer(
  token: string,
  opts: { state?: RiskAcceptanceState; limit?: number; offset?: number } = {}
): Promise<ReadResult<{ acceptances: RiskAcceptance[]; total: number; limit: number; offset: number }>> {
  const state = opts.state ?? "proposed";
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  try {
    const res = await engineFetch(
      `/api/risk-acceptances?state=${encodeURIComponent(state)}&limit=${limit}&offset=${offset}`,
      token
    );
    if (!res.ok) {
      return { ok: false, disabled: res.status === 404, error: await readError(res) };
    }
    const body = (await res.json()) as {
      acceptances?: RiskAcceptance[];
      total?: number;
      limit?: number;
      offset?: number;
    };
    return {
      ok: true,
      acceptances: body.acceptances ?? [],
      total: body.total ?? 0,
      limit: body.limit ?? limit,
      offset: body.offset ?? offset,
    };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

/** The governance counters (awaiting_approval is the queue's authoritative pending count). */
export async function getRiskAcceptanceSummaryServer(
  token: string
): Promise<ReadResult<{ summary: RiskAcceptanceSummary }>> {
  try {
    const res = await engineFetch(`/api/risk-acceptances/summary`, token);
    if (!res.ok) {
      return { ok: false, disabled: res.status === 404, error: await readError(res) };
    }
    const body = (await res.json()) as { summary: RiskAcceptanceSummary };
    return { ok: true, summary: body.summary };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

// Findings saved views (ERIP §1) — per-user named filter presets. The engine route
// 404s while SECURELOGIC_DECISION_WORKSPACE_ENABLED is off, so this returns [] and the
// saved-views bar simply does not render (byte-identical flag-off).
export type FindingSavedView = {
  id: string;
  name: string;
  filters: Record<string, string>;
  created_at: string;
  updated_at: string;
};

export async function getFindingSavedViews(apiKey: string): Promise<FindingSavedView[]> {
  try {
    const res = await engineFetch(`/api/finding-saved-views`, apiKey);
    if (!res.ok) return [];
    const body = (await res.json()) as { views?: FindingSavedView[] };
    return body.views ?? [];
  } catch {
    return [];
  }
}

// Reverse entity→findings search (work-first Findings page). The engine route 404s
// while SECURELOGIC_DECISION_WORKSPACE_ENABLED is off → null (search UI not shown).
export type EntityFindingsResponse = {
  query: string;
  entities: Array<{ type: MatchTargetType; id: string; name: string }>;
  count: number;
  findings: Finding[];
};

export async function getFindingsByEntity(
  apiKey: string,
  q: string
): Promise<EntityFindingsResponse | null> {
  try {
    const qs = new URLSearchParams({ q });
    const res = await engineFetch(`/api/findings/by-entity?${qs.toString()}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<EntityFindingsResponse>;
  } catch {
    return null;
  }
}

export async function getActionsForFinding(
  apiKey: string,
  findingId: string
): Promise<ActionsResponse | null> {
  try {
    const qs = new URLSearchParams({ source_type: "finding", source_id: findingId, limit: "100" });
    const res = await engineFetch(`/api/actions?${qs.toString()}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<ActionsResponse>;
  } catch {
    return null;
  }
}

export async function getAction(
  apiKey: string,
  id: string
): Promise<{ action: Action } | null> {
  try {
    const res = await engineFetch(`/api/actions/${encodeURIComponent(id)}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<{ action: Action }>;
  } catch {
    return null;
  }
}

export async function createAction(
  apiKey: string,
  data: {
    title: string;
    description?: string;
    priority: Action["priority"];
    due_date?: string;
    source_type: string;
    source_id: string;
  }
): Promise<{ action: Action } | null> {
  try {
    const res = await engineFetch("/api/actions", apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) return null;
    return res.json() as Promise<{ action: Action }>;
  } catch {
    return null;
  }
}

export async function updateAction(
  apiKey: string,
  id: string,
  updates: {
    status?: Action["status"];
    priority?: Action["priority"];
    due_date?: string | null;
    owner_user_id?: string | null;
  }
): Promise<{ action: Action } | null> {
  try {
    const res = await engineFetch(`/api/actions/${encodeURIComponent(id)}`, apiKey, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) return null;
    return res.json() as Promise<{ action: Action }>;
  } catch {
    return null;
  }
}

export async function getActions(
  apiKey: string,
  params?: ActionsParams
): Promise<ActionsResponse | null> {
  try {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.priority) qs.set("priority", params.priority);
    if (params?.overdue) qs.set("overdue", "true");
    if (params?.active) qs.set("active", "true");
    if (params?.owner) qs.set("owner", params.owner);
    qs.set("limit", String(params?.limit ?? 100));
    const res = await engineFetch(`/api/actions?${qs.toString()}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<ActionsResponse>;
  } catch {
    return null;
  }
}

/**
 * The filter set GET /api/actions/summary accepts — deliberately ActionsParams
 * minus `limit`.
 *
 * Pagination has no meaning for an aggregate, and an aggregate computed over a
 * page is the exact defect this route exists to avoid, so the type refuses to
 * carry `limit` rather than relying on a caller to remember not to send it.
 */
export type ActionsSummaryParams = Omit<ActionsParams, "limit">;

/**
 * Exact action counts from GET /api/actions/summary — server COUNT(*) FILTER,
 * org-scoped, uncapped — for the SAME filter set passed to getActions.
 *
 * Pass the identical filter object to both readers. The engine builds the WHERE
 * for the list and for this summary from one shared `buildActionFilters()`, so
 * an identical query string is a guarantee (not a convention) that the counts
 * describe the population the list is showing.
 *
 * Called with no params the URL is byte-identical to the org-wide form this
 * reader has always sent, so existing callers are unaffected.
 */
export async function getActionsSummary(
  apiKey: string,
  params?: ActionsSummaryParams
): Promise<ActionsSummary | null> {
  try {
    const qs = new URLSearchParams();
    if (params?.status)   qs.set("status",   params.status);
    if (params?.priority) qs.set("priority", params.priority);
    if (params?.overdue)  qs.set("overdue",  "true");
    if (params?.active)   qs.set("active",   "true");
    if (params?.owner)    qs.set("owner",    params.owner);
    const query = qs.toString();
    const res = await engineFetch(
      `/api/actions/summary${query ? `?${query}` : ""}`,
      apiKey
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { summary?: ActionsSummary };
    return body?.summary ?? null;
  } catch {
    return null;
  }
}

export async function getRisks(
  apiKey: string,
  params?: {
    status?:        string;
    domain?:        string;
    risk_rating?:   string;
    review_status?: "overdue" | "due_soon" | "up_to_date";
    archived?:      boolean;
    /** Metric Contract: only risks still on the register — what an "open risks" count links to. */
    active?:        boolean;
    /** Register search term (2–120): title / description. */
    q?:             string;
    limit?:         number;
  }
): Promise<RisksResponse | null> {
  try {
    const qs = new URLSearchParams();
    if (params?.status)         qs.set("status",        params.status);
    if (params?.domain)         qs.set("domain",        params.domain);
    if (params?.risk_rating)    qs.set("risk_rating",   params.risk_rating);
    if (params?.review_status)  qs.set("review_status", params.review_status);
    if (params?.archived)       qs.set("archived",      "true");
    if (params?.active)         qs.set("active",        "true");
    if (params?.q)              qs.set("q",             params.q);
    qs.set("limit", String(params?.limit ?? 50));
    const res = await engineFetch(`/api/risks?${qs.toString()}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<RisksResponse>;
  } catch {
    return null;
  }
}

export type RiskTreatment = {
  id: string;
  organization_id: string;
  risk_id: string;
  status: string;
  treatment_type: string | null;
  owner: string | null;
  /**
   * FK → users.id for the treatment owner (the person executing the
   * treatment). Distinct from reviewer_id (the approver). The `owner`
   * text column is the denormalized fallback for display when the FK
   * user has been deleted.
   */
  owner_user_id: string | null;
  due_date: string | null;
  summary: string | null;
  notes: string | null;
  performed_at: string | null;
  reviewer_id: string | null;
  created_at: string;
  updated_at: string;
};

export type RiskTreatmentsResponse = {
  count: number;
  limit: number;
  organizationId: string;
  nextCursor: { created_at: string; id: string } | null;
  treatments: RiskTreatment[];
};

export async function getRiskById(
  apiKey: string,
  id: string
): Promise<Risk | null> {
  try {
    const res = await engineFetch(`/api/risks/${id}`, apiKey);
    if (!res.ok) return null;
    const body = (await res.json()) as { risk: Risk };
    return body.risk ?? null;
  } catch {
    return null;
  }
}

export async function getRiskTreatments(
  apiKey: string,
  params?: { risk_id?: string; status?: string; limit?: number }
): Promise<RiskTreatmentsResponse | null> {
  try {
    const qs = new URLSearchParams();
    if (params?.risk_id) qs.set("risk_id", params.risk_id);
    if (params?.status)  qs.set("status",  params.status);
    qs.set("limit", String(params?.limit ?? 50));
    const res = await engineFetch(`/api/risk-treatments?${qs.toString()}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<RiskTreatmentsResponse>;
  } catch {
    return null;
  }
}

export async function getRiskTreatmentById(
  apiKey: string,
  id: string
): Promise<RiskTreatment | null> {
  try {
    const res = await engineFetch(`/api/risk-treatments/${id}`, apiKey);
    if (!res.ok) return null;
    const body = (await res.json()) as { treatment: RiskTreatment };
    return body.treatment ?? null;
  } catch {
    return null;
  }
}

/**
 * patchRisk — wraps PATCH /api/risks/:id. The server validates partial
 * updates and rejects {} with `no_fields_to_update`. Caller should pass
 * only fields that actually changed.
 */
export async function patchRisk(
  apiKey: string,
  id: string,
  body: Partial<{
    title: string;
    description: string | null;
    domain: string;
    likelihood: string;
    impact: string;
    risk_rating: string;
    inherent_likelihood: string;
    inherent_impact: string;
    inherent_rating: string;
    residual_likelihood: string;
    residual_impact: string;
    residual_rating: string;
    status: string;
    treatment: string | null;
    owner: string | null;
    owner_user_id: string | null;
    due_date: string | null;
    source_type: string | null;
    source_id: string | null;
    // RR-5: per-risk review-cadence override. Positive integer = override;
    // null = clear and fall back to org policy / documented defaults.
    review_cadence_days: number | null;
  }>
): Promise<{ risk: Risk } | { error: string }> {
  try {
    const res = await engineFetch(`/api/risks/${id}`, apiKey, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      return { error: data.detail ?? data.error ?? `patch_failed_${res.status}` };
    }
    return res.json() as Promise<{ risk: Risk }>;
  } catch {
    return { error: "network_error" };
  }
}

/**
 * createRiskTreatment — wraps POST /api/risk-treatments. Caller fixes
 * status to 'not_started' for v1; the backend allows other values but
 * the UI never sends them (decision D from package 2 investigation).
 */
export async function createRiskTreatment(
  apiKey: string,
  body: {
    risk_id: string;
    status?: string;
    treatment_type?: string | null;
    owner?: string | null;
    owner_user_id?: string | null;
    due_date?: string | null;
    summary?: string | null;
    notes?: string | null;
    performed_at?: string | null;
    reviewer_id?: string | null;
  }
): Promise<{ treatment: RiskTreatment } | { error: string }> {
  try {
    const res = await engineFetch(`/api/risk-treatments`, apiKey, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      return { error: data.detail ?? data.error ?? `create_failed_${res.status}` };
    }
    return res.json() as Promise<{ treatment: RiskTreatment }>;
  } catch {
    return { error: "network_error" };
  }
}

/**
 * patchRiskTreatment — wraps PATCH /api/risk-treatments/:id. The server
 * requires `status` and rejects self-loops via the transition graph.
 * Terminal-state PATCHes atomically update the parent risk's status.
 */
export async function patchRiskTreatment(
  apiKey: string,
  id: string,
  body: {
    status: string;
    treatment_type?: string | null;
    owner?: string | null;
    owner_user_id?: string | null;
    due_date?: string | null;
    summary?: string | null;
    notes?: string | null;
    performed_at?: string | null;
    reviewer_id?: string | null;
  }
): Promise<{ treatment: RiskTreatment } | { error: string }> {
  try {
    const res = await engineFetch(`/api/risk-treatments/${id}`, apiKey, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
      return { error: data.detail ?? data.error ?? `patch_failed_${res.status}` };
    }
    return res.json() as Promise<{ treatment: RiskTreatment }>;
  } catch {
    return { error: "network_error" };
  }
}

export async function getRisksIntelligence(
  apiKey: string
): Promise<RisksIntelligenceResponse | null> {
  try {
    const res = await engineFetch("/api/risks/intelligence", apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<RisksIntelligenceResponse>;
  } catch {
    return null;
  }
}

export async function getRisksSummary(
  apiKey: string
): Promise<RisksSummary | null> {
  try {
    const res = await engineFetch("/api/risks/summary", apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<RisksSummary>;
  } catch {
    return null;
  }
}

export async function getVendorSignalContext(
  apiKey: string,
  vendorId: string
): Promise<VendorSignalContext | null> {
  try {
    const res = await engineFetch(`/api/vendors/${vendorId}/signal-context`, apiKey);
    if (!res.ok) return null;
    const body = (await res.json()) as { signal_context: VendorSignalContext };
    return body.signal_context ?? null;
  } catch {
    return null;
  }
}

// ── Detail-page linkage reads (W5/W6 read-surface wiring) ──────────────────
// The DB already connects vendors ↔ signals ↔ AI systems ↔ dependencies; these
// surface that canonical linkage on the resting detail pages so "how risky is
// this NOW / what does it depend on" is answered without page-hopping.

// One external signal linked to an AI system (signal_ai_system_links + the
// event bridge when the signal contributed to a canonical event).
export type AiSystemLinkedSignal = {
  link_id: string;
  link_created_at: string;
  id: string;
  source: string | null;
  signal_type: string | null;
  severity: string | null;
  normalized_summary: string | null;
  affected_vendor: string | null;
  affected_cve: string | null;
  ingestion_timestamp: string | null;
  intelligence_event_id: string | null;
  event_summary: string | null;
};

export async function getAiSystemSignals(
  apiKey: string,
  aiSystemId: string,
  limit = 10
): Promise<AiSystemLinkedSignal[]> {
  try {
    const res = await engineFetch(
      `/api/ai-systems/${encodeURIComponent(aiSystemId)}/signals?limit=${limit}`,
      apiKey
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { signals?: AiSystemLinkedSignal[] };
    return body.signals ?? [];
  } catch {
    return [];
  }
}

/**
 * Deterministic linked signals for a VENDOR (signal_vendor_links) — the same
 * projection as the AI-system read (shared engine LINK/SIGNAL_SELECT). This
 * client is what the vendor page's intelligence section reads (EG2 Tier 2
 * slice 9); before it existed, accepted vendor↔signal links were written to a
 * table no UI displayed and the vendor page showed a per-pageload LLM guess.
 */
export async function getVendorSignals(
  apiKey: string,
  vendorId: string,
  limit = 10
): Promise<AiSystemLinkedSignal[] | null> {
  try {
    const res = await engineFetch(
      `/api/vendors/${encodeURIComponent(vendorId)}/signals?limit=${limit}`,
      apiKey
    );
    // null on failure, [] only on a genuine empty read — an outage must never
    // render as "no intelligence on this vendor" (the clean-vendor lie).
    if (!res.ok) return null;
    const body = (await res.json()) as { signals?: AiSystemLinkedSignal[] };
    return body.signals ?? [];
  } catch {
    return null;
  }
}

// AI system → vendor dependency (ai_system_vendor_dependencies).
export type AiVendorDependency = {
  dependency_id: string;
  dependency_role: string;
  notes: string | null;
  created_at: string;
  vendor_id: string;
  vendor_name: string;
  vendor_criticality: string | null;
  vendor_status: string | null;
};

export async function getAiSystemVendorDependencies(
  apiKey: string,
  aiSystemId: string,
  limit = 25
): Promise<AiVendorDependency[]> {
  try {
    const res = await engineFetch(
      `/api/ai-systems/${encodeURIComponent(aiSystemId)}/vendors?limit=${limit}`,
      apiKey
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { dependencies?: AiVendorDependency[] };
    return body.dependencies ?? [];
  } catch {
    return [];
  }
}

// Vendor → dependent AI systems (the reverse edge; concentration signal).
export type VendorAiDependency = {
  dependency_id: string;
  dependency_role: string;
  notes: string | null;
  created_at: string;
  ai_system_id: string;
  ai_system_name: string;
  ai_system_criticality: string | null;
  ai_system_deployment_status: string | null;
};

export async function getVendorAiDependencies(
  apiKey: string,
  vendorId: string,
  limit = 25
): Promise<VendorAiDependency[]> {
  try {
    const res = await engineFetch(
      `/api/vendors/${encodeURIComponent(vendorId)}/ai-systems?limit=${limit}`,
      apiKey
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { dependencies?: VendorAiDependency[] };
    return body.dependencies ?? [];
  } catch {
    return [];
  }
}

export async function getControlComplianceContext(
  apiKey: string,
  controlId: string
): Promise<ComplianceContext | null> {
  try {
    const res = await engineFetch(`/api/controls/${encodeURIComponent(controlId)}/compliance-context`, apiKey);
    if (!res.ok) return null;
    const body = (await res.json()) as { compliance_context: ComplianceContext };
    return body.compliance_context ?? null;
  } catch {
    return null;
  }
}

export async function getObligationComplianceContext(
  apiKey: string,
  obligationId: string
): Promise<ComplianceContext | null> {
  try {
    const res = await engineFetch(`/api/obligations/${encodeURIComponent(obligationId)}/compliance-context`, apiKey);
    if (!res.ok) return null;
    const body = (await res.json()) as { compliance_context: ComplianceContext };
    return body.compliance_context ?? null;
  } catch {
    return null;
  }
}

// ─── Obligation types ────────────────────────────────────────────────────────

export type ObligationSummary = {
  total: number;
  /** Metric Contract: ACTIVE with due_date strictly before today. Optional so
   *  an older engine build degrades to 0 rather than a wrong render. */
  overdue?: number;
  by_status: {
    active: number;
    waived: number;
    not_applicable: number;
  };
  by_domain: Record<string, number>;
};

export type Obligation = {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  source_regulation: string | null;
  jurisdiction: string | null;
  domain: string | null;
  status: "active" | "waived" | "not_applicable";
  priority: "immediate" | "near_term" | "planned" | "watch" | null;
  due_date: string | null;
  owner_user_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ObligationsParams = {
  status?: string;
  domain?: string;
  /** true = only overdue obligations (active + due before today). */
  overdue?: boolean;
  /** Register search term (2–120): title / source_regulation / description. */
  q?: string;
  limit?: number;
};

export type ObligationsResponse = {
  count: number;
  limit: number;
  organizationId: string;
  statusFilter: string;
  nextCursor: { created_at: string; id: string } | null;
  obligations: Obligation[];
};

export type ObligationAssessment = {
  id: string;
  organization_id: string;
  obligation_id: string;
  status: "not_started" | "in_progress" | "compliant" | "non_compliant" | "partially_compliant";
  overall_severity: string | null;
  summary: string | null;
  notes: string | null;
  performed_at: string | null;
  reviewer_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ObligationAssessmentsResponse = {
  count: number;
  limit: number;
  organizationId: string;
  nextCursor: { created_at: string; id: string } | null;
  assessments: ObligationAssessment[];
};

export type Evidence = {
  id: string;
  organization_id: string;
  source_id: string;
  source_type: string;
  title: string;
  description: string | null;
  evidence_type: string;
  collected_at: string | null;
  collected_by: string | null;
  external_ref: string | null;
  // File attachment (nullable — reference-only evidence leaves these unset).
  // `has_file` is the boolean the UI branches on; the raw storage key is never
  // exposed (downloads go through the signed-URL redirect at /api/evidence/:id/file).
  has_file?: boolean;
  original_filename?: string | null;
  mime_type?: string | null;
  byte_size?: number | null;
  sha256?: string | null;
  uploaded_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
};

export type EvidenceResponse = {
  count: number;
  organizationId: string;
  source_type: string;
  source_id: string;
  evidence: Evidence[];
};

export type EvidenceSummary = {
  total: number;
  by_source_type: Record<string, number>;
};

/** Org-wide evidence counts by workflow — the /evidence page's headline read. */
export async function getEvidenceSummary(apiKey: string): Promise<EvidenceSummary | null> {
  try {
    const res = await engineFetch("/api/evidence/summary", apiKey);
    if (!res.ok) return null;
    return (await res.json()) as EvidenceSummary;
  } catch {
    return null;
  }
}

/** Latest evidence records across the whole org (EG2 Tier 2 slice 8). */
export async function getRecentEvidence(
  apiKey: string,
  limit = 50
): Promise<{ count: number; evidence: Evidence[] } | null> {
  try {
    const res = await engineFetch(`/api/evidence/recent?limit=${limit}`, apiKey);
    if (!res.ok) return null;
    return (await res.json()) as { count: number; evidence: Evidence[] };
  } catch {
    return null;
  }
}

// ─── Obligation API functions ─────────────────────────────────────────────────

export async function getObligationSummary(
  apiKey: string
): Promise<ObligationSummary | null> {
  try {
    const res = await engineFetch("/api/obligations/summary", apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<ObligationSummary>;
  } catch {
    return null;
  }
}

export async function getObligations(
  apiKey: string,
  params?: ObligationsParams
): Promise<ObligationsResponse | null> {
  try {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.domain) qs.set("domain", params.domain);
    if (params?.overdue) qs.set("overdue", "true");
    if (params?.q) qs.set("q", params.q);
    qs.set("limit", String(params?.limit ?? 50));
    const res = await engineFetch(`/api/obligations?${qs.toString()}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<ObligationsResponse>;
  } catch {
    return null;
  }
}

export async function getObligation(
  apiKey: string,
  id: string
): Promise<Obligation | null> {
  try {
    const res = await engineFetch(`/api/obligations/${encodeURIComponent(id)}`, apiKey);
    if (!res.ok) return null;
    const body = (await res.json()) as { obligation: Obligation };
    return body.obligation ?? null;
  } catch {
    return null;
  }
}

export async function getObligationAssessments(
  apiKey: string,
  obligationId: string,
  limit = 20
): Promise<ObligationAssessmentsResponse | null> {
  try {
    const res = await engineFetch(
      `/api/obligation-assessments?obligation_id=${encodeURIComponent(obligationId)}&limit=${limit}`,
      apiKey
    );
    if (!res.ok) return null;
    return res.json() as Promise<ObligationAssessmentsResponse>;
  } catch {
    return null;
  }
}

export async function getControl(
  apiKey: string,
  id: string
): Promise<Control | null> {
  try {
    const res = await engineFetch(`/api/controls/${encodeURIComponent(id)}`, apiKey);
    if (!res.ok) return null;
    const body = (await res.json()) as { control: Control };
    return body.control ?? null;
  } catch {
    return null;
  }
}

export async function updateControl(
  apiKey: string,
  controlId: string,
  updates: {
    name?: string;
    description?: string | null;
    owner_user_id?: string | null;
    testing_frequency?: Control["testing_frequency"];
    next_test_due?: string | null;
  }
): Promise<Control | null> {
  try {
    const res = await engineFetch(`/api/controls/${encodeURIComponent(controlId)}`, apiKey, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { control: Control };
    return body.control ?? null;
  } catch {
    return null;
  }
}

export async function getControlAssessmentsForControl(
  apiKey: string,
  controlId: string,
  limit = 20
): Promise<ControlAssessmentsResponse | null> {
  try {
    const res = await engineFetch(
      `/api/control-assessments?control_id=${encodeURIComponent(controlId)}&limit=${limit}`,
      apiKey
    );
    if (!res.ok) return null;
    return res.json() as Promise<ControlAssessmentsResponse>;
  } catch {
    return null;
  }
}

/**
 * Browser-side evidence access for a finding, via the /api/evidence Next proxy.
 *
 * Distinct from `getEvidence` below, which is the SERVER-side variant taking an
 * apiKey and calling the engine directly. These two run in the browser from the
 * Decision Workspace's Remediation tab, so they carry no key — the proxy attaches
 * the session token.
 */
export async function getFindingEvidence(
  findingId: string
): Promise<ReadResult<{ evidence: Evidence[] }>> {
  try {
    const qs = new URLSearchParams({ source_type: "finding", source_id: findingId });
    const res = await fetch(`/api/evidence?${qs.toString()}`, { cache: "no-store" });
    if (!res.ok) {
      return { ok: false, disabled: res.status === 404, error: await readError(res) };
    }
    const body = (await res.json()) as EvidenceResponse;
    return { ok: true, evidence: body.evidence ?? [] };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

/**
 * Attach evidence to a finding. On the engine side this also recomputes the
 * finding's operational_status (routes/evidence.ts:242), so satisfying an org's
 * evidence gate advances the finding to `remediated` immediately — the caller
 * should refresh the page to pick that up.
 */
export async function attachFindingEvidence(
  findingId: string,
  input: {
    title: string;
    evidence_type: string;
    description?: string | null;
    external_ref?: string | null;
  }
): Promise<ActionResult<{ evidence: Evidence }>> {
  try {
    const payload = buildFindingEvidencePayload(findingId, input);
    const res = await fetch(`/api/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: await readError(res), status: res.status };
    }
    const body = (await res.json()) as { evidence: Evidence };
    return { ok: true, evidence: body.evidence };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  }
}

/** The authenticated download URL for a file-backed evidence row. The app proxy
 *  attaches the session token and 302s to a short-lived, single-org signed URL —
 *  there is never a public object URL. */
export function evidenceFileHref(evidenceId: string): string {
  return `/api/evidence/${encodeURIComponent(evidenceId)}/file`;
}

/**
 * Upload a FILE as evidence for a finding (multipart). Uses XHR rather than fetch
 * so the caller gets real upload-progress events. On success the engine has
 * persisted the file AND recomputed the finding's operational_status, so an
 * evidence-gated finding advances immediately — the caller should refresh.
 */
export function uploadFindingEvidence(
  findingId: string,
  file: File,
  meta: {
    title: string;
    evidence_type: string;
    description?: string | null;
    external_ref?: string | null;
  },
  onProgress?: (pct: number) => void
): Promise<ActionResult<{ evidence: Evidence }>> {
  return uploadEvidenceFile("finding", findingId, file, meta, onProgress);
}

/**
 * Upload a FILE as evidence against ANY canonical evidence source (multipart).
 * The engine upload lane has always accepted every source_type in its table
 * (control_test, obligation_review, ai_review, ai_governance_review, …) — only
 * this client was finding-only, which is why the control/obligation/AI
 * evidence forms could record a ticket reference but never attach the actual
 * artifact an auditor asks for (EG2 Tier 2 slice 8).
 */
export function uploadEvidenceFile(
  sourceType: string,
  sourceId: string,
  file: File,
  meta: {
    title: string;
    evidence_type: string;
    description?: string | null;
    external_ref?: string | null;
    collected_at?: string | null;
    collected_by?: string | null;
  },
  onProgress?: (pct: number) => void
): Promise<ActionResult<{ evidence: Evidence }>> {
  return new Promise((resolve) => {
    const form = new FormData();
    form.append("source_type", sourceType);
    form.append("source_id", sourceId);
    form.append("title", meta.title);
    form.append("evidence_type", meta.evidence_type);
    if (meta.description) form.append("description", meta.description);
    if (meta.external_ref) form.append("external_ref", meta.external_ref);
    if (meta.collected_at) form.append("collected_at", meta.collected_at);
    if (meta.collected_by) form.append("collected_by", meta.collected_by);
    // `file` last so the text fields are parsed first server-side.
    form.append("file", file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/evidence/upload");
    xhr.responseType = "json";
    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      const body = (xhr.response ?? {}) as {
        evidence?: Evidence;
        error?: string;
        detail?: string;
        details?: { reason?: string };
      };
      if (xhr.status >= 200 && xhr.status < 300 && body.evidence) {
        resolve({ ok: true, evidence: body.evidence });
        return;
      }
      // The hardened-server guards return `{error:"bad_request", details:{reason}}`
      // (e.g. request_body_too_large) — a nested reason the UI can map precisely,
      // unlike the flat top-level `error`. Prefer that reason when present so the
      // message tells the user WHY (too large / malformed) rather than "bad_request".
      const nestedReason = body.details?.reason;
      const code =
        body.error === "bad_request" && nestedReason
          ? nestedReason
          : body.error ?? "upload_failed";
      resolve({
        ok: false,
        error: body.detail ? `${code}: ${body.detail}` : code,
        status: xhr.status,
      });
    };
    xhr.onerror = () => resolve({ ok: false, error: "network_error", status: 0 });
    xhr.send(form);
  });
}

export async function getEvidence(
  apiKey: string,
  sourceType: string,
  sourceId: string
): Promise<EvidenceResponse | null> {
  try {
    const res = await engineFetch(
      `/api/evidence?source_type=${encodeURIComponent(sourceType)}&source_id=${encodeURIComponent(sourceId)}`,
      apiKey
    );
    if (!res.ok) return null;
    return res.json() as Promise<EvidenceResponse>;
  } catch {
    return null;
  }
}

// ─── AI Governance types ─────────────────────────────────────────────────────

export type AiGovernanceAssessment = {
  id: string;
  organization_id: string;
  ai_system_id: string;
  status: "not_started" | "in_progress" | "compliant" | "non_compliant" | "partially_compliant";
  overall_severity: string | null;
  summary: string | null;
  notes: string | null;
  performed_at: string | null;
  reviewer_id: string | null;
  created_at: string;
  updated_at: string;
};

export type AiGovernanceAssessmentsResponse = {
  count: number;
  limit: number;
  organizationId: string;
  nextCursor: { created_at: string; id: string } | null;
  assessments: AiGovernanceAssessment[];
};

// ─── AI Governance API functions ─────────────────────────────────────────────

export async function getAiSystem(
  apiKey: string,
  id: string
): Promise<AiSystem | null> {
  try {
    const res = await engineFetch(`/api/ai-systems/${encodeURIComponent(id)}`, apiKey);
    if (!res.ok) return null;
    const body = (await res.json()) as { ai_system: AiSystem };
    return body.ai_system ?? null;
  } catch {
    return null;
  }
}

/**
 * Findings linked to ONE AI system, resolved in the database.
 *
 * `total` / `active_total` / `open_total` are COUNT(*) over the whole matched set —
 * never the length of `findings`, which is a bounded display page. The detail page
 * used to fetch the org's findings with limit:50 and filter them down in the browser,
 * so past 50 org findings a system's real findings fell off the page before the filter
 * saw them and the tile printed a confident zero. A truncation is not a zero.
 *
 * Returns null on a non-OK/thrown response — a resolver failure, which the caller must
 * NOT coalesce into an empty list (that would reproduce the same lie by another route).
 */
export type AiSystemFindingsResponse = {
  findings: Finding[];
  total: number;
  active_total: number;
  open_total: number;
};

export async function getAiSystemFindings(
  apiKey: string,
  systemId: string,
  limit = 100
): Promise<AiSystemFindingsResponse | null> {
  try {
    const res = await engineFetch(
      `/api/ai-systems/${encodeURIComponent(systemId)}/findings?limit=${limit}`,
      apiKey
    );
    if (!res.ok) return null;
    return res.json() as Promise<AiSystemFindingsResponse>;
  } catch {
    return null;
  }
}

/**
 * Findings linked to ONE obligation / ONE control, resolved in the database.
 *
 * Same contract as getAiSystemFindings, for the same reason: these pages used to
 * fetch the org's findings with a cap and filter them down to the entity in the
 * browser — past the cap, the entity's real findings fell off the page before the
 * filter saw them and the page printed a confident zero. A truncation is not a zero.
 *
 * The counts are COUNT(*) over the whole matched set, never `findings.length`.
 * A null return is a RESOLVER FAILURE and must not be coalesced into an empty list.
 */
export type ScopedFindingsResponse = {
  findings: Finding[];
  total: number;
  active_total: number;
  open_total: number;
};

export async function getObligationFindings(
  apiKey: string,
  obligationId: string,
  limit = 100
): Promise<ScopedFindingsResponse | null> {
  try {
    const res = await engineFetch(
      `/api/obligations/${encodeURIComponent(obligationId)}/findings?limit=${limit}`,
      apiKey
    );
    if (!res.ok) return null;
    return res.json() as Promise<ScopedFindingsResponse>;
  } catch {
    return null;
  }
}

export async function getControlFindings(
  apiKey: string,
  controlId: string,
  limit = 100
): Promise<ScopedFindingsResponse | null> {
  try {
    const res = await engineFetch(
      `/api/controls/${encodeURIComponent(controlId)}/findings?limit=${limit}`,
      apiKey
    );
    if (!res.ok) return null;
    return res.json() as Promise<ScopedFindingsResponse>;
  } catch {
    return null;
  }
}

export async function getGovernanceReviewsForSystem(
  apiKey: string,
  systemId: string,
  limit = 20
): Promise<GovernanceReviewsResponse | null> {
  try {
    const res = await engineFetch(
      `/api/governance-reviews?ai_system_id=${encodeURIComponent(systemId)}&limit=${limit}`,
      apiKey
    );
    if (!res.ok) return null;
    return res.json() as Promise<GovernanceReviewsResponse>;
  } catch {
    return null;
  }
}

export async function getAiGovernanceAssessments(
  apiKey: string,
  systemId: string,
  limit = 20
): Promise<AiGovernanceAssessmentsResponse | null> {
  try {
    const res = await engineFetch(
      `/api/ai-governance-assessments?ai_system_id=${encodeURIComponent(systemId)}&limit=${limit}`,
      apiKey
    );
    if (!res.ok) return null;
    return res.json() as Promise<AiGovernanceAssessmentsResponse>;
  } catch {
    return null;
  }
}

// ─── Audit Package types ──────────────────────────────────────────────────────

export type AuditPackageEvidenceItem = {
  id: string;
  title: string;
  evidence_type: string;
  description: string | null;
  collected_at: string | null;
  collected_by: string | null;
  external_ref: string | null;
};

export type AuditPackageControl = {
  control_id: string;
  control_name: string;
  assessment_id: string | null;
  assessment_status: string | null;
  overall_severity: string | null;
  assessment_summary: string | null;
  performed_at: string | null;
  evidence: AuditPackageEvidenceItem[];
};

export type AuditPackageRequirement = {
  id: string;
  reference_id: string;
  title: string;
  status: "satisfied" | "partial" | "unmapped";
  controls: AuditPackageControl[];
};

export type AuditPackage = {
  generated_at: string;
  organization: { name: string };
  framework: { id: string; name: string; version: string };
  readiness_summary: {
    readiness_score: number;
    total_requirements: number;
    satisfied: number;
    partial: number;
    unmapped: number;
  };
  requirements: AuditPackageRequirement[];
};

export async function getAuditPackageJson(
  apiKey: string,
  frameworkId: string
): Promise<AuditPackage | null> {
  try {
    const res = await engineFetch(
      `/api/frameworks/${encodeURIComponent(frameworkId)}/audit-package`,
      apiKey
    );
    if (!res.ok) return null;
    return res.json() as Promise<AuditPackage>;
  } catch {
    return null;
  }
}

export async function getAiSystemGovernanceContext(
  apiKey: string,
  systemId: string
): Promise<ComplianceContext | null> {
  try {
    const res = await engineFetch(`/api/ai-systems/${encodeURIComponent(systemId)}/governance-context`, apiKey);
    if (!res.ok) return null;
    const body = (await res.json()) as { governance_context: ComplianceContext | null };
    return body.governance_context ?? null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Alert Preferences
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/briefing/changes — the since-last-visit delta (EG2 slice 10). */
export type BriefingChangesResponse = {
  since: string;
  clamped: boolean;
  window_days_max: number;
  changes: {
    new_active_findings: number;
    new_critical_high: number;
    remediation_completed: number;
    resolved: number;
    newly_overdue_actions: number;
    briefs_published: number;
  };
};

export async function getBriefingChanges(
  apiKey: string,
  sinceIso: string
): Promise<BriefingChangesResponse | null> {
  try {
    const res = await engineFetch(
      `/api/briefing/changes?since=${encodeURIComponent(sinceIso)}`,
      apiKey
    );
    if (!res.ok) return null;
    return (await res.json()) as BriefingChangesResponse;
  } catch {
    return null;
  }
}

export type AlertPreferences = {
  critical_finding_immediate: boolean;
  high_finding_immediate: boolean;
  daily_digest: boolean;
  weekly_summary: boolean;
  /** "Assigned to you" emails (EG2 Tier 2 slice 7). Optional: older engines omit it. */
  assignment_immediate?: boolean;
  /** Daily "work you own went overdue" email (EG2 Tier 2 slice 11). */
  sla_breach_daily?: boolean;
};

export async function getAlertPreferences(apiKey: string): Promise<AlertPreferences | null> {
  try {
    const res = await engineFetch("/api/alert-preferences", apiKey);
    if (!res.ok) return null;
    const body = (await res.json()) as { preferences: AlertPreferences };
    return body.preferences ?? null;
  } catch {
    return null;
  }
}

export async function updateAlertPreferences(
  apiKey: string,
  updates: Partial<AlertPreferences>
): Promise<AlertPreferences | null> {
  try {
    const res = await engineFetch("/api/alert-preferences", apiKey, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { preferences: AlertPreferences };
    return body.preferences ?? null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Policy types
// ─────────────────────────────────────────────────────────────────────────────

export type Policy = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  category: string;
  version: string | null;
  owner: string | null;
  status: "draft" | "active" | "under_review" | "retired";
  review_frequency: "annual" | "biannual" | "ad_hoc" | null;
  last_reviewed_at: string | null;
  next_review_at: string | null;
  is_overdue: boolean;
  created_at: string;
  updated_at: string;
};

export type PolicyDetail = Policy & {
  linked_controls: Array<{
    control_id: string;
    control_name: string;
  }>;
};

export type PoliciesResponse = {
  policies: Policy[];
  total: number;
  nextCursor: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Policy API functions
// ─────────────────────────────────────────────────────────────────────────────

export async function getPolicies(
  apiKey: string,
  params?: {
    status?: string;
    category?: string;
    linked_to_control?: string;
    limit?: number;
  }
): Promise<PoliciesResponse | null> {
  try {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.category) qs.set("category", params.category);
    if (params?.linked_to_control) qs.set("linked_to_control", params.linked_to_control);
    if (params?.limit) qs.set("limit", String(params.limit));
    const query = qs.toString() ? `?${qs.toString()}` : "";
    const res = await engineFetch(`/api/policies${query}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<PoliciesResponse>;
  } catch {
    return null;
  }
}

export async function getPolicy(
  apiKey: string,
  id: string
): Promise<{ policy: PolicyDetail } | null> {
  try {
    const res = await engineFetch(`/api/policies/${encodeURIComponent(id)}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<{ policy: PolicyDetail }>;
  } catch {
    return null;
  }
}

export async function createPolicy(
  token: string,
  data: {
    name: string;
    description?: string;
    category?: string;
    status?: string;
    version?: string;
    owner?: string;
    review_frequency?: string | null;
    last_reviewed_at?: string;
    next_review_at?: string;
  }
): Promise<{ policy: Policy } | null> {
  try {
    const res = await engineFetch("/api/policies", token, {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (!res.ok) return null;
    return res.json() as Promise<{ policy: Policy }>;
  } catch {
    return null;
  }
}

export async function getAuditLog(
  token: string,
  params: {
    page?: number;
    limit?: number;
    event_type?: string;
    user_id?: string;
    resource_type?: string;
    resource_id?: string;
    date_from?: string;
    date_to?: string;
  } = {}
): Promise<AuditLogResponse | null> {
  try {
    const qs = new URLSearchParams();
    if (params.page)          qs.set("page",          String(params.page));
    if (params.limit)         qs.set("limit",         String(params.limit));
    if (params.event_type)    qs.set("event_type",    params.event_type);
    if (params.user_id)       qs.set("user_id",       params.user_id);
    if (params.resource_type) qs.set("resource_type", params.resource_type);
    if (params.resource_id)   qs.set("resource_id",   params.resource_id);
    if (params.date_from)     qs.set("date_from",     params.date_from);
    if (params.date_to)       qs.set("date_to",       params.date_to);
    const path = `/api/audit-log${qs.toString() ? `?${qs.toString()}` : ""}`;
    const res = await engineFetch(path, token);
    if (!res.ok) return null;
    return res.json() as Promise<AuditLogResponse>;
  } catch {
    return null;
  }
}

export async function getAuditLogEventTypes(token: string): Promise<string[] | null> {
  try {
    const res = await engineFetch("/api/audit-log/event-types", token);
    if (!res.ok) return null;
    const body = (await res.json()) as { event_types: string[] };
    return body.event_types ?? null;
  } catch {
    return null;
  }
}

// Per-object history (RR-3, generalized). Mirrors the AuditLogEvent
// shape so the existing label/badge utilities can render rows verbatim.
// total_count rather than total_pages because the HistorySection uses
// limit/offset "Load more" paging instead of page-number navigation.
export type ResourceHistoryResponse = {
  events:      AuditLogEvent[];
  total_count: number;
  limit:       number;
  offset:      number;
};

export type RiskHistoryResponse = ResourceHistoryResponse;

// Register objects with an engine /:id/history endpoint. Kept as a
// closed union so a typo'd path fails the build, not the request.
export type HistoryResource =
  | "risks"
  | "findings"
  | "vendors"
  | "controls"
  | "obligations"
  | "ai-systems";

export async function getResourceHistory(
  resource: HistoryResource,
  resourceId: string,
  params: { limit?: number; offset?: number } = {}
): Promise<ResourceHistoryResponse | null> {
  try {
    const qs = new URLSearchParams();
    if (params.limit  !== undefined) qs.set("limit",  String(params.limit));
    if (params.offset !== undefined) qs.set("offset", String(params.offset));
    const path = `/api/${resource}/${encodeURIComponent(resourceId)}/history${qs.toString() ? `?${qs.toString()}` : ""}`;
    // Browser-side fetch goes through the Next.js proxy, which attaches
    // the JWT from the session cookie. No bearer token in the client.
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json() as Promise<ResourceHistoryResponse>;
  } catch {
    return null;
  }
}

// Risk-control linkage (RR-4) — forward direction (controls mitigating a risk)
export type RiskControlLink = {
  link_id:                string;
  note:                   string | null;
  link_created_at:        string;
  created_by_user_id:     string | null;
  created_by_email:       string | null;
  created_by_name:        string | null;
  control_id:             string;
  control_name:           string;
  control_status:         string | null;
  control_domain:         string | null;
  control_family:         string | null;
  control_maturity_level: string | null;
};

export type RiskControlLinksResponse = {
  count:          number;
  limit:          number;
  organizationId: string;
  riskId:         string;
  links:          RiskControlLink[];
};

// Inverse direction (risks mitigated by a control)
export type ControlRiskLink = {
  link_id:              string;
  note:                 string | null;
  link_created_at:      string;
  risk_id:              string;
  risk_title:           string;
  risk_status:          string;
  risk_residual_rating: string | null;
  risk_domain:          string | null;
};

export type ControlRiskLinksResponse = {
  count:          number;
  limit:          number;
  organizationId: string;
  controlId:      string;
  links:          ControlRiskLink[];
};

// Risk-obligation linkage (RR-6) — forward direction
// (obligations affected by a risk).
export type RiskObligationLink = {
  link_id:                       string;
  note:                          string | null;
  link_created_at:               string;
  created_by_user_id:            string | null;
  created_by_email:              string | null;
  created_by_name:               string | null;
  obligation_id:                 string;
  obligation_title:              string;
  obligation_source_regulation:  string | null;
  obligation_jurisdiction:       string | null;
  obligation_domain:             string | null;
  obligation_status:             string;
  obligation_priority:           string | null;
};

export type RiskObligationLinksResponse = {
  count:          number;
  limit:          number;
  organizationId: string;
  riskId:         string;
  links:          RiskObligationLink[];
};

// Inverse direction (risks affecting an obligation)
export type ObligationRiskLink = {
  link_id:              string;
  note:                 string | null;
  link_created_at:      string;
  risk_id:              string;
  risk_title:           string;
  risk_status:          string;
  risk_residual_rating: string | null;
  risk_domain:          string | null;
};

export type ObligationRiskLinksResponse = {
  count:          number;
  limit:          number;
  organizationId: string;
  obligationId:   string;
  links:          ObligationRiskLink[];
};

export async function getRiskHistory(
  riskId: string,
  params: { limit?: number; offset?: number } = {}
): Promise<RiskHistoryResponse | null> {
  return getResourceHistory("risks", riskId, params);
}

// =========================================================
// Risk-control linkage helpers (RR-4) — browser-side, all go
// through the Next.js proxy at /api/risks/[id]/controls etc.
// =========================================================

export async function getControlsForRisk(
  riskId: string
): Promise<RiskControlLinksResponse | null> {
  try {
    const res = await fetch(
      `/api/risks/${encodeURIComponent(riskId)}/controls`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    return res.json() as Promise<RiskControlLinksResponse>;
  } catch {
    return null;
  }
}

export async function getRisksForControl(
  controlId: string
): Promise<ControlRiskLinksResponse | null> {
  try {
    const res = await fetch(
      `/api/controls/${encodeURIComponent(controlId)}/risks`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    return res.json() as Promise<ControlRiskLinksResponse>;
  } catch {
    return null;
  }
}

export async function linkRiskToControl(
  riskId: string,
  controlId: string,
  note: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `/api/risks/${encodeURIComponent(riskId)}/controls`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ control_id: controlId, note }),
        cache: "no-store",
      }
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? `http_${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

export async function unlinkRiskFromControl(
  riskId: string,
  controlId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `/api/risks/${encodeURIComponent(riskId)}/controls/${encodeURIComponent(controlId)}`,
      { method: "DELETE", cache: "no-store" }
    );
    if (res.status === 204 || res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? `http_${res.status}` };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

// Browser-side controls list, used by the ControlPicker (RR-4) via the
// /api/controls Next.js proxy. The server-side getControls() above uses
// engineFetch with a Bearer token; this variant goes through the proxy
// so the JWT stays in the session cookie.
export type ControlPickerOption = {
  id:                     string;
  name:                   string;
  control_family:         string | null;
  domain:                 string | null;
  maturity_level:         string | null;
  implementation_status:  string | null;
};

export async function getControlsViaProxy(
  limit: number = 200
): Promise<ControlPickerOption[] | null> {
  try {
    const res = await fetch(`/api/controls?limit=${limit}`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      controls?: Array<Record<string, unknown>>;
    };
    const raw = Array.isArray(body.controls) ? body.controls : [];
    return raw.map((c) => ({
      id:                    String(c.id ?? ""),
      name:                  String(c.name ?? ""),
      control_family:        (c.control_family as string | null) ?? null,
      domain:                (c.domain as string | null) ?? null,
      maturity_level:        (c.maturity_level as string | null) ?? null,
      implementation_status: (c.implementation_status as string | null) ?? null,
    }));
  } catch {
    return null;
  }
}

// =========================================================
// Risk lifecycle (R3) — browser-side, all go through the Next.js
// proxies under /api/risks/[id]/lifecycle/* and /api/approvals.
//
// The engine returns 404 when SECURELOGIC_RISK_LIFECYCLE_ENABLED is off;
// the read helpers surface that as { ok:false, disabled:true } so the UI
// can render nothing rather than an error. Action helpers return the
// engine's machine-readable `error` reason for inline gate feedback.
// =========================================================

export type LifecycleGates = {
  owner:                  boolean;
  score:                  boolean;
  evidence:               boolean;
  evidence_gate_enforced: boolean;
  treatment_count:        number;
  approval_granted:       boolean;
  approval_required:      boolean;
};

export type RiskLifecycleState = {
  lifecycle_state:     string;
  gates:               LifecycleGates;
  allowed_transitions: string[];
};

export type LifecycleEvent = {
  id:               string;
  from_state:       string | null;
  to_state:         string;
  transition:       string;
  actor_user_id:    string | null;
  actor_api_key_id: string | null;
  actor_name:       string | null;
  actor_email:      string | null;
  comment:          string | null;
  evidence_ids:     string[];
  approval_id:      string | null;
  created_at:       string;
};

export type RiskEvidence = {
  id:            string;
  title:         string;
  description:   string | null;
  evidence_type: string;
  collected_at:  string | null;
  collected_by:  string | null;
  external_ref:  string | null;
  created_at:    string;
};

export type PendingApproval = {
  id:                   string;
  risk_id:              string;
  treatment_id:         string | null;
  kind:                 string;
  decision:             string;
  requested_by_user_id: string | null;
  approver_user_id:     string | null;
  request_rationale:    string | null;
  expires_at:           string | null;
  created_at:           string;
  risk_title:           string | null;
  risk_domain:          string | null;
  residual_rating:      string | null;
  residual_score:       number | null;
  lifecycle_state:      string | null;
  is_self_proposed:     boolean;
};

type ReadResult<T> =
  | ({ ok: true } & T)
  | { ok: false; disabled: boolean; error: string };

type ActionResult<T> =
  | ({ ok: true } & T)
  | { ok: false; error: string; status: number };

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `http_${res.status}`;
}

export async function getRiskLifecycle(
  riskId: string
): Promise<ReadResult<{ data: RiskLifecycleState }>> {
  try {
    const res = await fetch(
      `/api/risks/${encodeURIComponent(riskId)}/lifecycle`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      return { ok: false, disabled: res.status === 404, error: await readError(res) };
    }
    return { ok: true, data: (await res.json()) as RiskLifecycleState };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

export async function getRiskLifecycleEvents(
  riskId: string,
  opts: { limit?: number; before?: string } = {}
): Promise<ReadResult<{ events: LifecycleEvent[]; next_cursor: string | null }>> {
  try {
    const qs = new URLSearchParams();
    if (opts.limit !== undefined) qs.set("limit", String(opts.limit));
    if (opts.before) qs.set("before", opts.before);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await fetch(
      `/api/risks/${encodeURIComponent(riskId)}/lifecycle/events${suffix}`,
      { cache: "no-store" }
    );
    if (!res.ok) {
      return { ok: false, disabled: res.status === 404, error: await readError(res) };
    }
    const body = (await res.json()) as {
      events: LifecycleEvent[];
      next_cursor: string | null;
    };
    return { ok: true, events: body.events ?? [], next_cursor: body.next_cursor ?? null };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

export async function getRiskEvidence(
  riskId: string
): Promise<ReadResult<{ evidence: RiskEvidence[] }>> {
  try {
    const res = await fetch(`/api/risks/${encodeURIComponent(riskId)}/evidence`, {
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, disabled: res.status === 404, error: await readError(res) };
    }
    const body = (await res.json()) as { evidence: RiskEvidence[] };
    return { ok: true, evidence: body.evidence ?? [] };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

export async function attachRiskEvidence(
  riskId: string,
  input: {
    title: string;
    evidence_type: string;
    description?: string | null;
    collected_at?: string | null;
    collected_by?: string | null;
    external_ref?: string | null;
  }
): Promise<ActionResult<{ evidence: RiskEvidence }>> {
  try {
    const res = await fetch(`/api/risks/${encodeURIComponent(riskId)}/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) {
      return { ok: false, error: await readError(res), status: res.status };
    }
    const body = (await res.json()) as { evidence: RiskEvidence };
    return { ok: true, evidence: body.evidence };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  }
}

export async function detachRiskEvidence(
  riskId: string,
  evidenceId: string
): Promise<ActionResult<{ detached?: boolean }>> {
  try {
    const res = await fetch(
      `/api/risks/${encodeURIComponent(riskId)}/evidence/${encodeURIComponent(evidenceId)}`,
      { method: "DELETE", cache: "no-store" }
    );
    if (!res.ok) {
      return { ok: false, error: await readError(res), status: res.status };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  }
}

export async function executeRiskTransition(
  riskId: string,
  input: { transition: string; comment: string; expected_from_state?: string }
): Promise<ActionResult<{ lifecycle_state: string }>> {
  try {
    const res = await fetch(
      `/api/risks/${encodeURIComponent(riskId)}/lifecycle/transitions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        cache: "no-store",
      }
    );
    if (!res.ok) {
      return { ok: false, error: await readError(res), status: res.status };
    }
    const body = (await res.json()) as { lifecycle_state: string };
    return { ok: true, lifecycle_state: body.lifecycle_state };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  }
}

export async function requestRiskApproval(
  riskId: string,
  input: {
    kind?: "treatment_plan" | "risk_acceptance";
    treatment_id?: string;
    request_rationale?: string;
    expires_at?: string;
  } = {}
): Promise<ActionResult<{ lifecycle_state: string }>> {
  try {
    const res = await fetch(
      `/api/risks/${encodeURIComponent(riskId)}/approvals`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        cache: "no-store",
      }
    );
    if (!res.ok) {
      return { ok: false, error: await readError(res), status: res.status };
    }
    const body = (await res.json()) as { lifecycle_state: string };
    return { ok: true, lifecycle_state: body.lifecycle_state };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  }
}

export async function decideRiskApproval(
  riskId: string,
  approvalId: string,
  input: { decision: "approved" | "rejected"; comment: string }
): Promise<ActionResult<{ lifecycle_state: string }>> {
  try {
    const res = await fetch(
      `/api/risks/${encodeURIComponent(riskId)}/approvals/${encodeURIComponent(approvalId)}/decision`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        cache: "no-store",
      }
    );
    if (!res.ok) {
      return { ok: false, error: await readError(res), status: res.status };
    }
    const body = (await res.json()) as { lifecycle_state: string };
    return { ok: true, lifecycle_state: body.lifecycle_state };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  }
}

/** Server-side approvals fetch (Bearer token via engineFetch) for the initial
 *  render of the approvals page. Mirrors getPendingApprovals but does not go
 *  through the browser proxy. Passing the JWT lets the engine compute
 *  is_self_proposed for the current user. */
export async function getApprovalsServer(
  token: string,
  status: "pending" | "approved" | "rejected" = "pending"
): Promise<ReadResult<{ approvals: PendingApproval[] }>> {
  try {
    const res = await engineFetch(`/api/approvals?status=${status}`, token);
    if (!res.ok) {
      return { ok: false, disabled: res.status === 404, error: `http_${res.status}` };
    }
    const body = (await res.json()) as { approvals: PendingApproval[] };
    return { ok: true, approvals: body.approvals ?? [] };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

export async function getPendingApprovals(
  opts: { status?: "pending" | "approved" | "rejected"; limit?: number } = {}
): Promise<ReadResult<{ approvals: PendingApproval[] }>> {
  try {
    const qs = new URLSearchParams();
    if (opts.status) qs.set("status", opts.status);
    if (opts.limit !== undefined) qs.set("limit", String(opts.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await fetch(`/api/approvals${suffix}`, { cache: "no-store" });
    if (!res.ok) {
      return { ok: false, disabled: res.status === 404, error: await readError(res) };
    }
    const body = (await res.json()) as { approvals: PendingApproval[] };
    return { ok: true, approvals: body.approvals ?? [] };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

// =========================================================
// Risk-obligation linkage helpers (RR-6) — browser-side, all
// go through the Next.js proxy at /api/risks/[id]/obligations etc.
// =========================================================

export async function getObligationsForRisk(
  riskId: string
): Promise<RiskObligationLinksResponse | null> {
  try {
    const res = await fetch(
      `/api/risks/${encodeURIComponent(riskId)}/obligations`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    return res.json() as Promise<RiskObligationLinksResponse>;
  } catch {
    return null;
  }
}

export async function getRisksForObligation(
  obligationId: string
): Promise<ObligationRiskLinksResponse | null> {
  try {
    const res = await fetch(
      `/api/obligations/${encodeURIComponent(obligationId)}/risks`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    return res.json() as Promise<ObligationRiskLinksResponse>;
  } catch {
    return null;
  }
}

export async function linkRiskToObligation(
  riskId: string,
  obligationId: string,
  note: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `/api/risks/${encodeURIComponent(riskId)}/obligations`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ obligation_id: obligationId, note }),
        cache: "no-store",
      }
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? `http_${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

export async function unlinkRiskFromObligation(
  riskId: string,
  obligationId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `/api/risks/${encodeURIComponent(riskId)}/obligations/${encodeURIComponent(obligationId)}`,
      { method: "DELETE", cache: "no-store" }
    );
    if (res.status === 204 || res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? `http_${res.status}` };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

// Browser-side obligations list, used by the ObligationPicker (RR-6) via the
// /api/obligations Next.js proxy. The server-side getObligations() above uses
// engineFetch with a Bearer token; this variant goes through the proxy so
// the JWT stays in the session cookie.
export type ObligationPickerOption = {
  id:                string;
  title:             string;
  source_regulation: string | null;
  jurisdiction:      string | null;
  domain:            string | null;
  status:            string;
};

export async function getObligationsViaProxy(
  limit: number = 200
): Promise<ObligationPickerOption[] | null> {
  try {
    const res = await fetch(`/api/obligations?limit=${limit}`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      obligations?: Array<Record<string, unknown>>;
    };
    const raw = Array.isArray(body.obligations) ? body.obligations : [];
    return raw.map((o) => ({
      id:                String(o.id ?? ""),
      title:             String(o.title ?? ""),
      source_regulation: (o.source_regulation as string | null) ?? null,
      jurisdiction:      (o.jurisdiction as string | null) ?? null,
      domain:            (o.domain as string | null) ?? null,
      status:            String(o.status ?? "active"),
    }));
  } catch {
    return null;
  }
}

// =========================================================
// Risk review cadence (RR-5) — browser-side
// =========================================================

export type RiskSettings = {
  is_default:           boolean;
  organization_id:      string;
  cadence_by_rating:    Record<string, number>;
  /**
   * Remediation SLA: severity → CALENDAR days. The engine computes a due date
   * as CURRENT_DATE + days (findingSlaPolicyRules.ts) — there is no
   * business-day or holiday arithmetic anywhere in the platform, so nothing
   * built on this may imply one.
   *
   * `null` means NO due-date automation: findings are created with whatever
   * due date the caller supplied, and none if they supplied nothing. That is a
   * real, distinct state from "configured", not a missing value.
   */
  finding_sla_by_severity: Record<string, number> | null;
  created_at:           string | null;
  updated_at:           string | null;
  updated_by_user_id:   string | null;
};

export async function getRiskSettings(): Promise<RiskSettings | null> {
  try {
    const res = await fetch("/api/orgs/me/risk-settings", { cache: "no-store" });
    if (!res.ok) return null;
    return res.json() as Promise<RiskSettings>;
  } catch {
    return null;
  }
}

/**
 * Server-side variant of getRiskSettings — calls the engine directly via
 * engineFetch with the session token. Used by RSC pages that need the
 * effective cadence policy on first render (e.g., the risk detail page
 * surfacing the "(org default)" subtitle on the ReviewCadenceCard).
 */
export async function getRiskSettingsServer(
  token: string
): Promise<RiskSettings | null> {
  try {
    const res = await engineFetch("/api/orgs/me/risk-settings", token);
    if (!res.ok) return null;
    return res.json() as Promise<RiskSettings>;
  } catch {
    return null;
  }
}

/**
 * The engine treats an ABSENT finding_sla_by_severity as "leave the stored
 * policy unchanged" and an explicit null as "clear it". That distinction is
 * load-bearing, so this signature preserves it: omit the option to leave the
 * SLA alone (what the cadence form does), pass a map to set it, pass null to
 * turn due-date automation off.
 *
 * cadence_by_rating is always required by the endpoint, so every caller sends
 * the cadence it is currently showing — saving one section must never blank
 * the other.
 */
export async function putRiskSettings(
  cadence_by_rating: Record<string, number>,
  options?: { finding_sla_by_severity?: Record<string, number> | null }
): Promise<{ ok: true; settings: RiskSettings } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/orgs/me/risk-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cadence_by_rating,
        ...(options && "finding_sla_by_severity" in options
          ? { finding_sla_by_severity: options.finding_sla_by_severity }
          : {}),
      }),
      cache: "no-store",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? `http_${res.status}` };
    }
    const settings = (await res.json()) as RiskSettings;
    return { ok: true, settings };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

export async function markRiskReviewed(
  riskId: string,
  body: { reviewed_at?: string; note?: string } = {}
): Promise<{ ok: true; risk: Risk; cadence_days_used: number } | { ok: false; error: string }> {
  try {
    const res = await fetch(
      `/api/risks/${encodeURIComponent(riskId)}/review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      }
    );
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: errBody?.error ?? `http_${res.status}` };
    }
    const okBody = (await res.json()) as { risk: Risk; cadence_days_used: number };
    return { ok: true, risk: okBody.risk, cadence_days_used: okBody.cadence_days_used };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

export async function getSsoConfig(
  jwtToken: string
): Promise<{ config: SsoConfig } | null> {
  try {
    const res = await fetch(`${ENGINE_URL}/api/sso/config`, {
      headers: { Authorization: `Bearer ${jwtToken}` },
      cache: "no-store",
    });
    if (res.status === 404) return { config: null as unknown as SsoConfig };
    if (!res.ok) return null;
    return res.json() as Promise<{ config: SsoConfig }>;
  } catch {
    return null;
  }
}

export async function checkSsoDomain(
  email: string
): Promise<SsoDomainCheck> {
  try {
    const res = await fetch(
      `${ENGINE_URL}/api/sso/check-domain?email=${encodeURIComponent(email)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return { hasSso: false, isEnforced: false, organizationId: null };
    return res.json() as Promise<SsoDomainCheck>;
  } catch {
    return { hasSso: false, isEnforced: false, organizationId: null };
  }
}

export async function getApiKeys(
  jwtToken: string
): Promise<ApiKeysResponse | null> {
  try {
    const res = await fetch(`${ENGINE_URL}/api/customer/keys`, {
      headers: { Authorization: `Bearer ${jwtToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json() as Promise<ApiKeysResponse>;
  } catch {
    return null;
  }
}

export async function createApiKey(
  jwtToken: string,
  label: string
): Promise<ApiKeyCreateResponse | null> {
  try {
    const res = await fetch(`${ENGINE_URL}/api/customer/keys`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ label }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json() as Promise<ApiKeyCreateResponse>;
  } catch {
    return null;
  }
}

export async function revokeApiKey(
  jwtToken: string,
  keyId: string
): Promise<{ ok: boolean } | null> {
  try {
    const res = await fetch(
      `${ENGINE_URL}/api/customer/keys/${encodeURIComponent(keyId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${jwtToken}` },
        cache: "no-store",
      }
    );
    if (!res.ok) return null;
    return res.json() as Promise<{ ok: boolean }>;
  } catch {
    return null;
  }
}

export async function getApiUsage(
  jwtToken: string,
  days = 30
): Promise<ApiUsageResponse | null> {
  try {
    const res = await fetch(
      `${ENGINE_URL}/api/customer/keys/usage?days=${days}`,
      {
        headers: { Authorization: `Bearer ${jwtToken}` },
        cache: "no-store",
      }
    );
    if (!res.ok) return null;
    return res.json() as Promise<ApiUsageResponse>;
  } catch {
    return null;
  }
}

// =========================================================
// WEBHOOKS
// =========================================================

export type WebhookEndpoint = {
  id: string;
  organization_id: string;
  url: string;
  secret_hint: string;
  description: string | null;
  status: "active" | "disabled" | "failed";
  event_types: string[];
  failure_count: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WebhookEndpointWithSecret = WebhookEndpoint & { secret: string };

export type WebhookDelivery = {
  id: string;
  event_type: string;
  status: "pending" | "delivered" | "failed" | "retrying";
  attempt_count: number;
  response_status: number | null;
  error_message: string | null;
  delivered_at: string | null;
  created_at: string;
};

export async function getWebhooks(
  token: string
): Promise<{ endpoints: WebhookEndpoint[] } | null> {
  try {
    const res = await engineFetch("/api/webhooks", token);
    if (!res.ok) return null;
    return res.json() as Promise<{ endpoints: WebhookEndpoint[] }>;
  } catch {
    return null;
  }
}

export interface WebhookEventDefinition {
  event_type: string;
  description: string;
}

/**
 * The event catalog this deployment accepts. The engine owns the vocabulary
 * (and gates wave-1 entries on its own feature flag), so the settings UI must
 * render from this rather than a hardcoded copy that silently goes stale.
 */
export async function getWebhookEventTypes(
  token: string
): Promise<WebhookEventDefinition[] | null> {
  try {
    const res = await engineFetch("/api/webhooks/event-types", token);
    if (!res.ok) return null;
    const body = (await res.json()) as { event_types?: WebhookEventDefinition[] };
    return body.event_types ?? null;
  } catch {
    return null;
  }
}

export async function createWebhook(
  token: string,
  data: { url: string; description?: string; event_types?: string[] }
): Promise<{ endpoint: WebhookEndpointWithSecret } | null> {
  try {
    const res = await engineFetch("/api/webhooks", token, {
      method: "POST",
      body: JSON.stringify(data),
    });
    if (!res.ok) return null;
    return res.json() as Promise<{ endpoint: WebhookEndpointWithSecret }>;
  } catch {
    return null;
  }
}

export async function updateWebhook(
  token: string,
  id: string,
  data: { url?: string; description?: string; event_types?: string[]; status?: string }
): Promise<{ endpoint: WebhookEndpoint } | null> {
  try {
    const res = await engineFetch(`/api/webhooks/${id}`, token, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
    if (!res.ok) return null;
    return res.json() as Promise<{ endpoint: WebhookEndpoint }>;
  } catch {
    return null;
  }
}

export async function deleteWebhook(token: string, id: string): Promise<boolean> {
  try {
    const res = await engineFetch(`/api/webhooks/${id}`, token, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Rotate the endpoint's signing secret in place (identity and delivery
 * history survive). The response carries the full new secret ONCE — the
 * same show-once contract as create.
 */
export async function rotateWebhookSecret(
  token: string,
  id: string
): Promise<{ endpoint: WebhookEndpointWithSecret } | null> {
  try {
    const res = await engineFetch(`/api/webhooks/${id}/rotate-secret`, token, {
      method: "POST",
    });
    if (!res.ok) return null;
    return res.json() as Promise<{ endpoint: WebhookEndpointWithSecret }>;
  } catch {
    return null;
  }
}

export async function testWebhook(
  token: string,
  id: string
): Promise<{ delivery: WebhookDelivery } | null> {
  try {
    const res = await engineFetch(`/api/webhooks/${id}/test`, token, { method: "POST" });
    if (!res.ok) return null;
    return res.json() as Promise<{ delivery: WebhookDelivery }>;
  } catch {
    return null;
  }
}

export async function getWebhookDeliveries(
  token: string,
  endpointId: string
): Promise<{ deliveries: WebhookDelivery[] } | null> {
  try {
    const res = await engineFetch(`/api/webhooks/${endpointId}/deliveries`, token);
    if (!res.ok) return null;
    return res.json() as Promise<{ deliveries: WebhookDelivery[] }>;
  } catch {
    return null;
  }
}

// =========================================================
// ASK (natural language posture search)
// =========================================================

/**
 * `context_used` differs by which retrieval path the engine ran (ask.ts):
 *   - snapshot path: posture_score / findings_count / risks_count /
 *     vendors_count / as_of
 *   - tool path: retrieval:"tools" / tool_calls / tools_denied / complete
 * All fields optional so one type covers both; callers must branch on
 * presence, never assume a shape.
 */
export type AskContextUsed = {
  // Snapshot path
  posture_score?: number | null;
  findings_count?: number;
  risks_count?: number;
  vendors_count?: number;
  as_of?: string | null;
  // Tool path
  retrieval?: "tools";
  tool_calls?: number;
  tools_denied?: number;
  complete?: boolean;
};

/**
 * A citation on a verified claim.
 *
 * Two field spellings exist in the engine, both real:
 *   - POST /api/ask's `provenance.claims[].citations[]` maps the engine's
 *     `tool_name` to `tool` (ask.ts response assembly).
 *   - The STORED claims column on ask_messages holds the raw engine Claim
 *     shape (src/api/lib/ask/claims.ts): `invocation_index`, `tool_name`,
 *     plus optional `object_type` / `object_id` / `field` / `value`.
 * Renderers read `tool_name ?? tool` and treat every field as optional.
 */
export type AskClaimCitation = {
  invocation_index?: number;
  tool_name?: string;
  tool?: string;
  object_type?: string;
  object_id?: string;
  field?: string;
  value?: unknown;
};

/** Mirrors CLAIM_CLASSES in src/api/lib/ask/claims.ts (strongest-evidence-first). */
export type AskClaimClass = "observed" | "derived" | "inference" | "recommendation";

export type AskClaim = {
  text: string;
  claim_class: AskClaimClass | string;
  citations: AskClaimCitation[];
  /** For `inference`: indices of the claims it reasoned from (stored shape only). */
  derived_from?: number[];
};

export type AskResponse = {
  answer: string;
  context_used: AskContextUsed;
  question: string;
  /**
   * Present on the tool path when a thread was created/continued; absent on
   * the snapshot path and when persistence failed. Its absence means the UI
   * must behave single-shot.
   */
  conversation_id?: string | null;
  /**
   * Present only when the provenance pass ran — absent is "no provenance
   * available", NOT "nothing was observed" (engine contract).
   */
  provenance?: {
    verified: boolean;
    claims: AskClaim[];
  };
  /**
   * Provenance lifecycle for this turn.
   *
   * `pending` is the one that changes the UI's obligations: the answer is
   * complete and correct, but its claims are still being decomposed by the
   * background worker because the answer was too long to decompose inside the
   * interactive budget. Citations will arrive on the stored turn.
   *
   * Absent means provenance was never applicable (no retrieval). It must NOT be
   * rendered as "verified" — an answer nobody decomposed and an answer verified
   * clean are different things.
   */
  provenance_status?: "pending" | "complete" | "partial" | "failed";
  /**
   * ASK-B (LC-5): mutations the assistant PREPARED, awaiting this user's
   * explicit confirmation. `token` is the server-issued confirmation
   * credential — it exists only in this response and must never be logged
   * or persisted client-side beyond the card that uses it.
   */
  proposed_actions?: AskProposedAction[];
};

export type AskProposedAction = {
  id: string;
  tool: string;
  /** Server-rendered change-set — what the user is actually confirming. */
  summary: string;
  token: string;
  expires_at: string;
};

/** Outcome of confirming a proposal. The token is single-use either way. */
export type AskConfirmResult =
  | { ok: true; status: "executed"; summary: string; action?: unknown }
  | { ok: true; status: "refused"; summary: string; message: string }
  | { ok: true; status: "declined"; summary: string }
  | { ok: false; status: number; code: string; message: string };

export async function confirmAskAction(
  token: string,
  proposalToken: string,
  decision: "confirm" | "decline"
): Promise<AskConfirmResult> {
  try {
    const res = await fetch(
      `${ENGINE_URL}/api/ask/actions/${decision === "confirm" ? "confirm" : "decline"}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token: proposalToken }),
        cache: "no-store",
      }
    );
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        code: typeof body?.error === "string" ? body.error : "confirm_failed",
        message:
          typeof body?.message === "string" ? body.message : "Unable to process confirmation",
      };
    }
    const status = body?.status;
    if (status === "executed") {
      return {
        ok: true,
        status: "executed",
        summary: String(body?.summary ?? ""),
        action: body?.action,
      };
    }
    if (status === "refused") {
      return {
        ok: true,
        status: "refused",
        summary: String(body?.summary ?? ""),
        message: String(body?.message ?? "The platform declined this change."),
      };
    }
    if (status === "declined") {
      return { ok: true, status: "declined", summary: String(body?.summary ?? "") };
    }
    return { ok: false, status: res.status, code: "unexpected_response", message: "Unexpected response" };
  } catch {
    return { ok: false, status: 0, code: "network_error", message: "Could not reach the server" };
  }
}

// ─── Ask conversations (multi-turn) ─────────────────────────

/** Mirrors AskConversation in src/api/lib/ask/conversationStore.ts. */
export type AskConversationSummary = {
  id: string;
  title: string | null;
  mode: "text" | "voice";
  last_message_at: string | null;
};

/**
 * Mirrors AskMessage in src/api/lib/ask/conversationStore.ts. `claims` is the
 * verified-claims structure captured at answer time (null on user turns and on
 * answers whose provenance pass did not run) — citations are RENDERED from it,
 * never recomputed.
 */
export type AskConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  claims: unknown;
  /**
   * Provenance lifecycle, replayed from the record. `pending` means a deferred
   * decomposition is still running for this turn — the reason a reloaded
   * thread may show an answer with no citations that later gains them.
   */
  provenance_status?: "pending" | "complete" | "partial" | "failed" | null;
  created_at: string;
};

export type AskConversationDetail = {
  conversation: AskConversationSummary;
  messages: AskConversationMessage[];
};

/**
 * GET /api/ask/conversations — the caller's own threads, newest-activity first
 * (ordering is the engine's; do not re-sort).
 *
 * Returns null on ANY failure — including 404 from an engine predating the
 * conversation routes — and the caller must degrade to single-shot Ask, never
 * render an error for it.
 */
export async function listAskConversations(
  token: string
): Promise<{ conversations: AskConversationSummary[] } | null> {
  try {
    const res = await engineFetch("/api/ask/conversations", token);
    if (!res.ok) return null;
    return res.json() as Promise<{ conversations: AskConversationSummary[] }>;
  } catch {
    return null;
  }
}

/**
 * GET /api/ask/conversations/:id — one owned thread with its transcript.
 * The engine answers 404 for not-found AND not-owned (indistinguishable on
 * purpose); both surface here as null.
 */
export async function getAskConversation(
  token: string,
  conversationId: string
): Promise<AskConversationDetail | null> {
  try {
    const res = await engineFetch(
      `/api/ask/conversations/${encodeURIComponent(conversationId)}`,
      token
    );
    if (!res.ok) return null;
    return res.json() as Promise<AskConversationDetail>;
  } catch {
    return null;
  }
}

// Discriminated-union result so the caller can distinguish success from
// each failure mode (auth, rate-limit, model failure, network) and render
// a useful message instead of a generic one. The server's JSON error body
// uses `error` for the code and `message` for the human string; we map
// those onto our `code`/`message` fields here.
export type AskResult =
  | { ok: true; data: AskResponse }
  | { ok: false; status: number; code?: string; message?: string };

export async function askQuestion(
  token: string,
  question: string,
  conversationId?: string | null
): Promise<AskResult> {
  let res: Response;
  try {
    res = await engineFetch(
      "/api/ask",
      token,
      {
        method: "POST",
        // conversation_id continues an existing thread on the tool path; the
        // snapshot path (and an unknown/expired id) simply ignores it, so
        // sending it is always safe.
        body: JSON.stringify(
          conversationId ? { question, conversation_id: conversationId } : { question }
        ),
      },
      // NOT the 15s default. A tool-path turn takes longer than that to think.
      ASK_CLIENT_TIMEOUT_MS
    );
  } catch {
    return { ok: false, status: 0, code: "network_error" };
  }

  if (!res.ok) {
    let body: { error?: string; message?: string } = {};
    try {
      body = (await res.json()) as { error?: string; message?: string };
    } catch {
      // non-JSON body (proxy 502, plain-text 504, etc.) — fall through
      // with empty body; the caller still has res.status.
    }
    return {
      ok: false,
      status: res.status,
      code: body.error,
      message: body.message,
    };
  }

  try {
    const data = (await res.json()) as AskResponse;
    return { ok: true, data };
  } catch {
    return { ok: false, status: res.status, code: "parse_error" };
  }
}

// ─────────────────────────────────────────────────────────────
// Requirement responses
// ─────────────────────────────────────────────────────────────

export type RequirementResponse = {
  id: string;
  requirement_id: string;
  assessment_type: "self" | "vendor";
  subject_id: string;
  status: "pass" | "fail" | "partial" | "not_assessed";
  notes: string | null;
  evidence_url: string | null;
  assessed_at: string;
};

export type RequirementWithResponse = {
  id: string;
  reference_id: string;
  title: string;
  description: string | null;
  /** VA-6 content-layer fields. Optional: absent on older engine payloads. */
  scope_tags?: string[];
  scope_tags_source?: "heuristic" | "curated" | null;
  response: RequirementResponse | null;
};

/** VA-6 — scope-tag curation coverage ("curated_pct is the number that
 *  matters before launch"). */
export type ScopeTagCoverage = {
  total: number;
  curated: number;
  heuristic: number;
  untagged: number;
  core_tagged: number;
  curated_pct: number;
};

export type ScopeTagCoverageReport = {
  overall: ScopeTagCoverage;
  frameworks: Array<{
    framework_id: string;
    name: string;
    version: string;
    coverage: ScopeTagCoverage;
  }>;
  /** The closed vocabulary, served by the engine so the curation UI never
   *  duplicates it. */
  vocabulary: string[];
};

export async function getScopeTagCoverage(
  apiKey: string
): Promise<ScopeTagCoverageReport | null> {
  try {
    const res = await engineFetch(
      `/api/requirements/scope-tag-coverage`,
      apiKey
    );
    if (!res.ok) return null;
    return res.json() as Promise<ScopeTagCoverageReport>;
  } catch {
    return null;
  }
}

export type FrameworkRequirements = {
  framework: {
    id: string;
    name: string;
    version: string;
  };
  requirements: RequirementWithResponse[];
  summary: {
    total: number;
    pass: number;
    partial: number;
    fail: number;
    not_assessed: number;
    /** 0–100 completion share — assessment progress, never readiness (O-5). */
    progress_pct: number;
    /** ISO timestamp of the most recent response, null when nothing answered.
     *  Optional: absent on older engine payloads. */
    last_response_at?: string | null;
  };
};

export async function getFrameworkRequirements(
  apiKey: string,
  frameworkId: string,
  assessmentType: "self" | "vendor",
  subjectId?: string
): Promise<FrameworkRequirements | null> {
  try {
    const params = new URLSearchParams({ assessment_type: assessmentType });
    // For "self" the engine defaults subject_id to the org; vendor requires it.
    if (subjectId) params.set("subject_id", subjectId);
    const res = await engineFetch(
      `/api/frameworks/${encodeURIComponent(frameworkId)}/requirements?${params.toString()}`,
      apiKey
    );
    if (!res.ok) return null;
    return res.json() as Promise<FrameworkRequirements>;
  } catch {
    return null;
  }
}

// =========================================================
// RISK SCALE
// =========================================================

export type RiskScaleLevel = {
  value: string;
  label: string;
  color: string;
  rank: number;
};

export type RiskScale = {
  preset_name: string;
  display_name: string;
  is_customized: boolean;
  levels: RiskScaleLevel[];
};

export async function getRiskScale(token: string): Promise<RiskScale | null> {
  try {
    const res = await engineFetch("/api/risk-scale", token);
    if (!res.ok) return null;
    return res.json() as Promise<RiskScale>;
  } catch {
    return null;
  }
}

export async function getRiskScalePresets(
  token: string
): Promise<RiskScale[] | null> {
  try {
    const res = await engineFetch("/api/risk-scale/presets", token);
    if (!res.ok) return null;
    const body = (await res.json()) as { presets: RiskScale[] };
    return body.presets ?? null;
  } catch {
    return null;
  }
}

export async function updateRiskScale(
  token: string,
  body: { preset_name: string; custom_levels?: Partial<RiskScaleLevel>[] }
): Promise<RiskScale | null> {
  try {
    const res = await engineFetch("/api/risk-scale", token, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return res.json() as Promise<RiskScale>;
  } catch {
    return null;
  }
}

export async function saveRequirementResponse(
  apiKey: string,
  body: {
    requirement_id: string;
    assessment_type: "self" | "vendor";
    subject_id: string;
    status: "pass" | "fail" | "partial" | "not_assessed";
    notes: string | null;
    evidence_url: string | null;
  }
): Promise<{ response: RequirementResponse; updated: boolean } | null> {
  try {
    const res = await engineFetch("/api/requirement-responses", apiKey, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return res.json() as Promise<{ response: RequirementResponse; updated: boolean }>;
  } catch {
    return null;
  }
}

// =========================================================
// SIGNAL MATCH SUGGESTIONS — matcher queue UI
//
// The queue page (Package 4) reads pending suggestions and lets a user
// accept (creates a signal_*_link) or dismiss (terminal). The list endpoint
// supports sort + offset + filters; the counts endpoint feeds the
// per-target-type filter chips and the first-time-empty state check
// (lifetime_total > 0 means the org has had matcher activity, so an empty
// pending list with active filters is a "no matches for these filters",
// not "we've never seen any signals").
// =========================================================

export type SignalMatchTargetType =
  | "vendor"
  | "ai_system"
  | "control"
  | "obligation"
  // EAR Phase 2: registry-target suggestions. Listable/dismissable today;
  // accept is engine-refused (409 asset_target_accept_unsupported) until the
  // registry link store ships (Phase 3), and the UI must not offer it.
  | "asset";

export type SignalMatchSuggestionStatus = "pending" | "accepted" | "dismissed";

export type SignalMatchSuggestion = {
  id: string;
  organization_id: string;
  signal_id: string;
  target_type: SignalMatchTargetType;
  target_id: string;
  match_reason: string | null;
  match_score: number | null;
  created_at: string;
  accepted_at: string | null;
  accepted_by_user_id: string | null;
  accepted_link_id: string | null;
  dismissed_at: string | null;
  dismissed_by_user_id: string | null;
  dismissal_reason: string | null;
};

export type SignalMatchSuggestionsResponse = {
  count: number;
  limit: number;
  offset: number;
  sort: "created-desc" | "score-desc";
  organizationId: string;
  status: SignalMatchSuggestionStatus;
  suggestions: SignalMatchSuggestion[];
};

export type SignalMatchSuggestionCounts = {
  organizationId: string;
  total: number;
  // `asset` is present only while the engine's asset registry is enabled —
  // its presence is the signal that the Assets queue chip should render.
  by_target_type: Record<Exclude<SignalMatchTargetType, "asset">, number> & {
    asset?: number;
  };
  // lifetime_total counts ALL states (pending, accepted, dismissed). The
  // queue UI uses it to distinguish a filtered-empty state from a
  // first-time-empty state without a separate query — the alternative was
  // a one-row helper in this file, but bundling it into /counts is one
  // round-trip per page render rather than two.
  lifetime_total: number;
};

export async function getSignalMatchSuggestions(
  token: string,
  params: {
    status?: SignalMatchSuggestionStatus;
    target_type?: SignalMatchTargetType;
    signal_id?: string;
    /** Free-text filter on the entity the suggestion is about (R3). */
    q?: string;
    sort?: "created-desc" | "score-desc";
    limit?: number;
    offset?: number;
  } = {}
): Promise<SignalMatchSuggestionsResponse | null> {
  try {
    const qs = new URLSearchParams();
    if (params.status)      qs.set("status",      params.status);
    if (params.target_type) qs.set("target_type", params.target_type);
    if (params.signal_id)   qs.set("signal_id",   params.signal_id);
    if (params.q)           qs.set("q",           params.q);
    if (params.sort)        qs.set("sort",        params.sort);
    if (params.limit)       qs.set("limit",       String(params.limit));
    if (params.offset)      qs.set("offset",      String(params.offset));
    const path = `/api/signal-match-suggestions${qs.toString() ? `?${qs.toString()}` : ""}`;
    const res = await engineFetch(path, token);
    if (!res.ok) return null;
    return res.json() as Promise<SignalMatchSuggestionsResponse>;
  } catch {
    return null;
  }
}

export async function getSignalMatchSuggestionCounts(
  token: string
): Promise<SignalMatchSuggestionCounts | null> {
  try {
    const res = await engineFetch("/api/signal-match-suggestions/counts", token);
    if (!res.ok) return null;
    return res.json() as Promise<SignalMatchSuggestionCounts>;
  } catch {
    return null;
  }
}

export type AcceptSignalMatchSuggestionResult = {
  suggestion: SignalMatchSuggestion;
  link: { id: string } & Record<string, unknown>;
  link_already_existed: boolean;
};

export async function acceptSignalMatchSuggestion(
  token: string,
  suggestionId: string,
  body: { note?: string | null } = {}
): Promise<AcceptSignalMatchSuggestionResult | { error: string }> {
  try {
    const res = await engineFetch(
      `/api/signal-match-suggestions/${suggestionId}/accept`,
      token,
      { method: "POST", body: JSON.stringify(body) }
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: data.error ?? `accept_failed_${res.status}` };
    }
    return res.json() as Promise<AcceptSignalMatchSuggestionResult>;
  } catch {
    return { error: "network_error" };
  }
}

export async function dismissSignalMatchSuggestion(
  token: string,
  suggestionId: string,
  body: { dismissal_reason?: string | null } = {}
): Promise<{ suggestion: SignalMatchSuggestion } | { error: string }> {
  try {
    const res = await engineFetch(
      `/api/signal-match-suggestions/${suggestionId}/dismiss`,
      token,
      { method: "POST", body: JSON.stringify(body) }
    );
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return { error: data.error ?? `dismiss_failed_${res.status}` };
    }
    return res.json() as Promise<{ suggestion: SignalMatchSuggestion }>;
  } catch {
    return { error: "network_error" };
  }
}


// =========================================================
// INDUSTRY STARTER TEMPLATES (Package 5)
// =========================================================

export type IndustryTemplateId = "healthcare-saas" | "fintech" | "b2b-ai";

export type IndustryTemplateSummary = {
  id: IndustryTemplateId;
  name: string;
  description: string;
  version: string;
  last_reviewed_at: string;
  counts: { vendors: number; ai_systems: number; obligations: number; controls: number };
  review_blocked: boolean;
};

export type IndustryTemplateDetail = IndustryTemplateSummary & {
  vendors:     Array<{ id: string; name: string; criticality: string; category: string; description: string; flags?: Record<string, boolean>; needs_review?: boolean }>;
  ai_systems:  Array<{ id: string; name: string; use_case: string; criticality: string; data_classification?: string; needs_review?: boolean }>;
  obligations: Array<{ id: string; regulation_name: string; jurisdiction: string; priority: string; description: string; needs_review?: boolean }>;
  controls:    Array<{ id: string; name: string; description: string; framework_ref: string; needs_review?: boolean }>;
};

/** Returns null on 404 (gate closed) or any non-2xx. */
export async function getIndustryTemplates(token: string): Promise<{ templates: IndustryTemplateSummary[] } | null> {
  try {
    const res = await engineFetch("/api/templates", token);
    if (!res.ok) return null;
    return res.json() as Promise<{ templates: IndustryTemplateSummary[] }>;
  } catch { return null; }
}

export async function getIndustryTemplate(token: string, industryId: IndustryTemplateId): Promise<IndustryTemplateDetail | null> {
  try {
    const res = await engineFetch(`/api/templates/${industryId}`, token);
    if (!res.ok) return null;
    const body = (await res.json()) as { template: IndustryTemplateDetail };
    return body.template ?? null;
  } catch { return null; }
}


// =========================================================
// VENDOR ASSURANCE INTELLIGENCE (Phase 1)
// =========================================================

export type VendorAssuranceProcessingStatus =
  | "pending"
  | "extracting"
  | "extracted"
  | "extraction_failed"
  | "finalized"                 // legacy terminal state — no new code path writes this
  | "approved"
  | "manual_review_requested"
  | "rejected";

export type VendorAssuranceDocument = {
  id: string;
  organization_id: string;
  vendor_id: string;
  uploaded_by_user_id: string | null;
  original_filename: string;
  byte_size: number;
  sha256: string;
  storage_key: string;
  mime_type: string;
  document_type_hint: "soc1" | "soc2_type1" | "soc2_type2" | null;
  processing_status: VendorAssuranceProcessingStatus;
  processing_error_code: string | null;
  processing_error_detail: string | null;
  finalized_at: string | null;
  finalized_by_user_id: string | null;
  approved_at: string | null;
  approved_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type VendorAssuranceExtractedField = {
  value: unknown;
  confidence: number;
  status: "extracted";
};

export type VendorAssuranceExtraction = {
  id: string;
  organization_id: string;
  document_id: string;
  model_id: string;
  prompt_version: string;
  raw_response_excerpt: string | null;
  fields: Record<string, VendorAssuranceExtractedField>;
  created_at: string;
};

export type VendorAssuranceExtractionSpan = {
  id: string;
  organization_id: string;
  extraction_id: string;
  field_name: string;
  page_number: number | null;
  char_start: number;
  char_end: number;
  quote: string;
  created_at: string;
};

export type VendorAssuranceCurrentDecision = {
  decision: "accept" | "edit" | "reject";
  reviewed_value: unknown;
  reviewer_note: string | null;
  decided_by_user_id: string | null;
  decided_at: string;
};

/** Current override per material field (latest by overridden_at). */
export type VendorAssuranceFieldOverride = {
  field_name: string;
  original_value: unknown;
  override_value: unknown;
  reason: string;
  overridden_by_user_id: string | null;
  overridden_at: string;
};

export type VendorAssuranceExtractionResponse = {
  extraction: VendorAssuranceExtraction | null;
  spans: VendorAssuranceExtractionSpan[];
  current_decisions: Record<string, VendorAssuranceCurrentDecision>;
  field_overrides: VendorAssuranceFieldOverride[];
  material_field_names?: readonly string[];
};

export type VendorAssuranceReviewDecisionInput = {
  field_name: string;
  decision: "accept" | "edit" | "reject";
  reviewed_value?: unknown;
  reviewer_note?: string | null;
};

/**
 * Filter values accepted by listVendorAssuranceDocuments. `"reviewed"` is a
 * PSEUDO-STATUS meaning "a human accepted this extraction" — it expands
 * server-side to `approved OR finalized`. Surfaces that want the latest
 * reviewed document MUST pass this rather than naming a raw state: `finalized`
 * is written by no current code path (migration 20260612) and `approved` alone
 * drops legacy reviewed rows.
 */
export type VendorAssuranceStatusFilter =
  | VendorAssuranceProcessingStatus
  | "reviewed";

export async function listVendorAssuranceDocuments(
  token: string,
  opts?: { vendorId?: string; status?: VendorAssuranceStatusFilter; limit?: number }
): Promise<{ documents: VendorAssuranceDocument[] } | null> {
  const params = new URLSearchParams();
  if (opts?.vendorId) params.set("vendor_id", opts.vendorId);
  if (opts?.status) params.set("status", opts.status);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  try {
    const res = await engineFetch(`/api/vendor-assurance/documents${qs ? `?${qs}` : ""}`, token);
    if (!res.ok) return null;
    return res.json() as Promise<{ documents: VendorAssuranceDocument[] }>;
  } catch { return null; }
}

export async function getVendorAssuranceDocument(
  token: string,
  documentId: string
): Promise<VendorAssuranceDocument | null> {
  try {
    const res = await engineFetch(`/api/vendor-assurance/documents/${encodeURIComponent(documentId)}`, token);
    if (!res.ok) return null;
    const body = (await res.json()) as { document: VendorAssuranceDocument };
    return body.document ?? null;
  } catch { return null; }
}

export async function getVendorAssuranceExtraction(
  token: string,
  documentId: string
): Promise<VendorAssuranceExtractionResponse | null> {
  try {
    const res = await engineFetch(
      `/api/vendor-assurance/documents/${encodeURIComponent(documentId)}/extraction`,
      token
    );
    if (!res.ok) return null;
    return res.json() as Promise<VendorAssuranceExtractionResponse>;
  } catch { return null; }
}

/**
 * Same-origin path of the app's PDF stream-through proxy
 * (app/src/app/api/vendor-assurance/[documentId]/pdf/route.ts). The proxy
 * authenticates from the session cookie, calls the engine /pdf endpoint with
 * the Bearer token server-side, follows the engine's 302 to the pre-signed R2
 * URL server-side, and streams the bytes back to the browser — so the browser
 * never sees the engine URL or the pre-signed URL, and CSP connect-src never
 * needs to allow the R2 host.
 */
export function getVendorAssuranceDocumentPdfUrl(documentId: string): string {
  return `/api/vendor-assurance/${encodeURIComponent(documentId)}/pdf`;
}

export async function recordVendorAssuranceReviewDecisions(
  token: string,
  extractionId: string,
  decisions: VendorAssuranceReviewDecisionInput[]
): Promise<{ inserted_ids: string[]; current_decisions: Record<string, VendorAssuranceCurrentDecision> } | null> {
  try {
    const res = await engineFetch(
      `/api/vendor-assurance/extractions/${encodeURIComponent(extractionId)}/review-decisions`,
      token,
      { method: "POST", body: JSON.stringify({ decisions }) }
    );
    if (!res.ok) return null;
    return res.json() as Promise<{
      inserted_ids: string[];
      current_decisions: Record<string, VendorAssuranceCurrentDecision>;
    }>;
  } catch { return null; }
}

export async function finalizeVendorAssuranceDocument(
  token: string,
  documentId: string
): Promise<{ document: VendorAssuranceDocument } | { error: string; missing_field_names?: string[] }> {
  try {
    const res = await engineFetch(
      `/api/vendor-assurance/documents/${encodeURIComponent(documentId)}/finalize`,
      token,
      { method: "POST", body: JSON.stringify({}) }
    );
    const body = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      return {
        error: String(body["error"] ?? "finalize_failed"),
        ...(Array.isArray(body["missing_field_names"])
          ? { missing_field_names: body["missing_field_names"] as string[] }
          : {})
      };
    }
    return body as { document: VendorAssuranceDocument };
  } catch {
    return { error: "finalize_failed" };
  }
}

// ---------------------------------------------------------------------------
// Document-presentation package: field overrides + document-level transitions
// ---------------------------------------------------------------------------

export type VendorAssuranceActionResult<T> = T | { error: string };

/** POST .../field-overrides — record one reviewer override with a required reason. */
export async function overrideVendorAssuranceField(
  token: string,
  documentId: string,
  fieldName: string,
  overrideValue: unknown,
  reason: string
): Promise<VendorAssuranceActionResult<{ override: VendorAssuranceFieldOverride }>> {
  try {
    const res = await engineFetch(
      `/api/vendor-assurance/documents/${encodeURIComponent(documentId)}/field-overrides`,
      token,
      { method: "POST", body: JSON.stringify({ field_name: fieldName, override_value: overrideValue, reason }) }
    );
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { error: String(body["error"] ?? "field_override_failed") };
    return body as { override: VendorAssuranceFieldOverride };
  } catch {
    return { error: "field_override_failed" };
  }
}

/** POST .../approve — extracted → approved (the conceptual replacement for finalize). */
export async function approveVendorAssuranceDocument(
  token: string,
  documentId: string
): Promise<VendorAssuranceActionResult<{ document: VendorAssuranceDocument }>> {
  try {
    const res = await engineFetch(
      `/api/vendor-assurance/documents/${encodeURIComponent(documentId)}/approve`,
      token,
      { method: "POST", body: JSON.stringify({}) }
    );
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { error: String(body["error"] ?? "approve_failed") };
    return body as { document: VendorAssuranceDocument };
  } catch {
    return { error: "approve_failed" };
  }
}

/** POST .../request-manual-review — extracted → manual_review_requested (not terminal). */
export async function requestVendorAssuranceManualReview(
  token: string,
  documentId: string,
  comment?: string
): Promise<VendorAssuranceActionResult<{ document: VendorAssuranceDocument }>> {
  try {
    const res = await engineFetch(
      `/api/vendor-assurance/documents/${encodeURIComponent(documentId)}/request-manual-review`,
      token,
      { method: "POST", body: JSON.stringify(comment && comment.trim().length > 0 ? { comment: comment.trim() } : {}) }
    );
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { error: String(body["error"] ?? "request_manual_review_failed") };
    return body as { document: VendorAssuranceDocument };
  } catch {
    return { error: "request_manual_review_failed" };
  }
}

/** POST .../reject — extracted → rejected (terminal). */
export async function rejectVendorAssuranceDocument(
  token: string,
  documentId: string,
  reason: string
): Promise<VendorAssuranceActionResult<{ document: VendorAssuranceDocument }>> {
  try {
    const res = await engineFetch(
      `/api/vendor-assurance/documents/${encodeURIComponent(documentId)}/reject`,
      token,
      { method: "POST", body: JSON.stringify({ reason }) }
    );
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { error: String(body["error"] ?? "reject_failed") };
    return body as { document: VendorAssuranceDocument };
  } catch {
    return { error: "reject_failed" };
  }
}

// ---------------------------------------------------------------------------
// CUEC matcher package: cuecs + N:M control mappings + control search
// ---------------------------------------------------------------------------

/**
 * VA-1/VA-2. The old vocabulary was ["pending","reviewed_no_match"], and
 * `reviewed_no_match` conflated "this does not apply to us" with "this applies
 * and we do not do it" — which is why a reviewed document could never produce
 * remediation work. `reviewed_no_match` remains readable so legacy rows render,
 * but the review UI offers only the four explicit outcomes.
 */
export type CuecReviewStatus =
  | "pending"
  | "not_applicable"
  | "satisfied"
  | "gap"
  | "reviewed_no_match";

/** The determinations a reviewer may now record. */
export const CUEC_DETERMINATIONS = ["not_applicable", "satisfied", "gap"] as const;
export type CuecMappingStatus = "suggested" | "accepted" | "dismissed";
export type CuecMappingSource = "auto" | "manual";

export type VendorAssuranceCuecMapping = {
  id: string;
  cuec_id: string;
  control_id: string;
  mapping_status: CuecMappingStatus;
  mapping_score: number | null;
  mapping_source: CuecMappingSource;
  reason: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  control_name: string;
  control_description: string | null;
  control_status: string;
};

export type VendorAssuranceCuec = {
  id: string;
  ordinal: number;
  cuec_text: string;
  review_status: CuecReviewStatus;
  review_status_reason: string | null;
  review_status_updated_by_user_id: string | null;
  review_status_updated_at: string | null;
  /** Snapshot of the mapped controls and their state at determination time. */
  gap_basis: {
    determined_at?: string;
    determined_status?: string;
    mapped_controls?: Array<{
      control_id: string; control_name: string;
      implementation_status: string | null; maturity_level: string | null;
      last_tested_at: string | null;
    }>;
    mapped_control_count?: number;
    basis?: string;
  } | null;
  /** The finding this gap produced, if promoted. NULL is the normal state. */
  promoted_finding_id: string | null;
  created_at: string;
  updated_at: string;
  mappings: VendorAssuranceCuecMapping[];
};

export type VendorAssuranceCuecMatchSummary = {
  matched: boolean;
  reason?: string;
  cuecCount: number;
  controlCount: number;
  suggestionsConsidered: number;
  suggestionsWritten: number;
};

export type VendorAssuranceCuecsResponse = {
  document_id: string;
  cuecs: VendorAssuranceCuec[];
  match_score_min_threshold: number;
  match_score_high_confidence: number;
  /** Present only on the re-match response. */
  result?: VendorAssuranceCuecMatchSummary;
};

export type ControlSummary = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  domain?: string | null;
  control_family?: string | null;
};

/** GET .../cuecs — the document's CUEC rows with their control mappings joined to control names. */
export async function getCuecsForDocument(
  token: string,
  documentId: string
): Promise<VendorAssuranceCuecsResponse | null> {
  try {
    const res = await engineFetch(`/api/vendor-assurance/documents/${encodeURIComponent(documentId)}/cuecs`, token);
    if (!res.ok) return null;
    return res.json() as Promise<VendorAssuranceCuecsResponse>;
  } catch { return null; }
}

/**
 * POST .../rematch-cuecs — re-run the LLM matcher for this document against the
 * current controls inventory. Uses a longer timeout than engineFetch because
 * the matcher makes an LLM call.
 */
export async function rematchCuecs(
  token: string,
  documentId: string
): Promise<VendorAssuranceActionResult<VendorAssuranceCuecsResponse>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(
      `${ENGINE_URL}/api/vendor-assurance/documents/${encodeURIComponent(documentId)}/rematch-cuecs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
        cache: "no-store",
        signal: controller.signal,
      }
    );
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { error: String(body["error"] ?? "cuec_rematch_failed") };
    return body as VendorAssuranceCuecsResponse;
  } catch {
    return { error: "cuec_rematch_failed" };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** POST /cuecs/:id/mappings — user creates a manual accepted mapping to a control. */
export async function createCuecMapping(
  token: string,
  cuecId: string,
  controlId: string,
  reason?: string
): Promise<VendorAssuranceActionResult<{ mapping: VendorAssuranceCuecMapping }>> {
  try {
    const res = await engineFetch(
      `/api/vendor-assurance/cuecs/${encodeURIComponent(cuecId)}/mappings`,
      token,
      { method: "POST", body: JSON.stringify(reason && reason.trim().length > 0 ? { control_id: controlId, reason: reason.trim() } : { control_id: controlId }) }
    );
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { error: String(body["error"] ?? "cuec_mapping_create_failed") };
    return body as { mapping: VendorAssuranceCuecMapping };
  } catch {
    return { error: "cuec_mapping_create_failed" };
  }
}

/** PATCH /cuec-mappings/:id — accept a suggested mapping, or dismiss any non-accepted mapping. */
export async function updateCuecMapping(
  token: string,
  mappingId: string,
  mappingStatus: "accepted" | "dismissed",
  reason?: string
): Promise<VendorAssuranceActionResult<{ mapping: VendorAssuranceCuecMapping }>> {
  try {
    const res = await engineFetch(
      `/api/vendor-assurance/cuec-mappings/${encodeURIComponent(mappingId)}`,
      token,
      { method: "PATCH", body: JSON.stringify(reason && reason.trim().length > 0 ? { mapping_status: mappingStatus, reason: reason.trim() } : { mapping_status: mappingStatus }) }
    );
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { error: String(body["error"] ?? "cuec_mapping_update_failed") };
    return body as { mapping: VendorAssuranceCuecMapping };
  } catch {
    return { error: "cuec_mapping_update_failed" };
  }
}

/** POST /cuecs/:id/review-status — set/clear the "no applicable control in inventory" marker. */
/**
 * Promote a CUEC gap into an ordinary Finding.
 *
 * Explicit by design: recording a gap and opening remediation work are two
 * different acts, so this is never called automatically. Severity is REQUIRED —
 * it drives the SLA, and a deadline the platform invented would have no author.
 */
export async function promoteCuecToFinding(
  token: string,
  cuecId: string,
  severity: "Critical" | "High" | "Moderate" | "Low",
): Promise<VendorAssuranceActionResult<{ finding: { id: string; title: string; severity: string; due_date: string | null }; created: boolean }>> {
  try {
    const res = await engineFetch(
      `/api/vendor-assurance/cuecs/${encodeURIComponent(cuecId)}/promote-to-finding`,
      token,
      { method: "POST", body: JSON.stringify({ severity }) },
    );
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { error: String(body["error"] ?? "cuec_promotion_failed") };
    return body as { finding: { id: string; title: string; severity: string; due_date: string | null }; created: boolean };
  } catch {
    return { error: "cuec_promotion_failed" };
  }
}

export async function updateCuecReviewStatus(
  token: string,
  cuecId: string,
  reviewStatus: CuecReviewStatus,
  reason?: string
): Promise<VendorAssuranceActionResult<{ cuec: VendorAssuranceCuec }>> {
  try {
    const res = await engineFetch(
      `/api/vendor-assurance/cuecs/${encodeURIComponent(cuecId)}/review-status`,
      token,
      // A reason accompanies any determination that carries one. The engine
      // REQUIRES it on `gap` — asserting the organisation fails an obligation
      // has to be explained — and ignores it when clearing back to pending.
      {
        method: "POST",
        body: JSON.stringify(
          reviewStatus !== "pending" && reason && reason.trim().length > 0
            ? { review_status: reviewStatus, reason: reason.trim() }
            : { review_status: reviewStatus },
        ),
      }
    );
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { error: String(body["error"] ?? "cuec_review_status_update_failed") };
    return body as { cuec: VendorAssuranceCuec };
  } catch {
    return { error: "cuec_review_status_update_failed" };
  }
}

/** GET /api/controls?q= — type-ahead search of the org's controls inventory (for the ControlPicker). */
export async function searchControls(
  token: string,
  q: string,
  limit = 20
): Promise<ControlSummary[]> {
  const query = q.trim();
  if (query.length === 0) return [];
  try {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    const res = await engineFetch(`/api/controls?${params.toString()}`, token);
    if (!res.ok) return [];
    const body = (await res.json()) as { controls?: ControlSummary[] };
    return Array.isArray(body.controls) ? body.controls : [];
  } catch { return []; }
}

/**
 * Multipart upload helper. Accepts a FormData body, posts directly to the
 * engine via Bearer auth, and returns the document row on success.
 *
 * Server-side use only — never expose the engine token to the browser.
 */
export async function uploadVendorAssuranceDocument(
  token: string,
  formData: FormData
): Promise<{ document: VendorAssuranceDocument } | { error: string }> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    try {
      const res = await fetch(`${ENGINE_URL}/api/vendor-assurance/documents`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
        signal: controller.signal
      });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok) return { error: String(body["error"] ?? "upload_failed") };
      return body as { document: VendorAssuranceDocument };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return { error: "upload_failed" };
  }
}

// =========================================================
// ENTERPRISE CONTEXT LAYER (ECL) — Tier-1 UI (goal Item 7, Phase 7A.1)
// =========================================================
//
// READS run server-side via engineFetch(path, token) and return the gate-aware
// ReadResult union: { ok:false, disabled:true } means the engine returned 404 (feature
// off / not granted → hide it); { ok:false, disabled:false } is a real error. WRITES run
// client-side through the Next proxy routes under /api/enterprise-context/** and return
// ActionResult so the caller can map the engine error code via enterpriseContextErrorMessage.
// The whole surface is dark until SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED is on.

// ── Reads (Server Components) ──────────────────────────────────────────────────

// ─── EAR Phase 4: unified Assets surface ────────────────────────────────────

/** GET /api/assets — the unified cross-type list over asset_registry_v. */
export async function getAssets(
  token: string,
  params: { asset_type?: AssetType; at_risk?: boolean; q?: string; limit?: number; offset?: number } = {},
): Promise<ReadResult<{ assets: CanonicalAsset[]; total: number; limit: number; offset: number }>> {
  const q = new URLSearchParams();
  if (params.asset_type) q.set("asset_type", params.asset_type);
  // The population the executive "Assets at risk" tile counts (own_risk > 0 on the
  // current applicability decision) — so that tile has a destination that reproduces it.
  if (params.at_risk) q.set("at_risk", "true");
  // Free-text search (Phase 1): substring match over the fields the registry view
  // exposes (name, asset ID). Composes with the filters and survives pagination.
  if (params.q) q.set("q", params.q);
  if (params.limit !== undefined) q.set("limit", String(params.limit));
  if (params.offset !== undefined) q.set("offset", String(params.offset));
  try {
    const res = await engineFetch(`/api/assets?${q.toString()}`, token);
    if (!res.ok) {
      return { ok: false, disabled: isFeatureDisabledStatus(res.status), error: await readError(res) };
    }
    const body = (await res.json()) as {
      assets: CanonicalAsset[];
      total: number;
      limit: number;
      offset: number;
    };
    return { ok: true, ...body };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

/** GET /api/assets/:id — canonical header + typed detail (detail-backed kinds). */
export async function getAsset(
  token: string,
  id: string,
): Promise<ReadResult<{ asset: CanonicalAsset; detail: Record<string, unknown> | null }>> {
  try {
    const res = await engineFetch(`/api/assets/${encodeURIComponent(id)}`, token);
    if (!res.ok) {
      return { ok: false, disabled: isFeatureDisabledStatus(res.status), error: await readError(res) };
    }
    const body = (await res.json()) as { asset: CanonicalAsset; detail: Record<string, unknown> | null };
    return { ok: true, ...body };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

export async function getEnterpriseEntities(
  token: string,
  params: { entity_type?: EntityType; q?: string; limit?: number; offset?: number } = {},
): Promise<ReadResult<{ enterprise_entities: EnterpriseEntity[]; limit: number; offset: number }>> {
  try {
    const res = await engineFetch(`/api/enterprise-entities?${entitiesQuery(params)}`, token);
    if (!res.ok) {
      return { ok: false, disabled: isFeatureDisabledStatus(res.status), error: await readError(res) };
    }
    const body = (await res.json()) as {
      enterprise_entities: EnterpriseEntity[];
      limit: number;
      offset: number;
    };
    return { ok: true, ...body };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

export async function getEnterpriseEntity(
  token: string,
  id: string,
): Promise<ReadResult<{ enterprise_entity: EnterpriseEntity }>> {
  try {
    const res = await engineFetch(`/api/enterprise-entities/${encodeURIComponent(id)}`, token);
    if (!res.ok) {
      return { ok: false, disabled: isFeatureDisabledStatus(res.status), error: await readError(res) };
    }
    const body = (await res.json()) as { enterprise_entity: EnterpriseEntity };
    return { ok: true, ...body };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

export async function getEnterpriseRelationships(
  token: string,
  params: { node_type?: NodeType; node_id?: string; limit?: number; offset?: number } = {},
): Promise<
  ReadResult<{ enterprise_relationships: EnterpriseRelationship[]; limit: number; offset: number }>
> {
  try {
    const res = await engineFetch(
      `/api/enterprise-relationships?${relationshipsQuery(params)}`,
      token,
    );
    if (!res.ok) {
      return { ok: false, disabled: isFeatureDisabledStatus(res.status), error: await readError(res) };
    }
    const body = (await res.json()) as {
      enterprise_relationships: EnterpriseRelationship[];
      limit: number;
      offset: number;
    };
    return { ok: true, ...body };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

export async function getEnterpriseGraph(
  token: string,
  params: { node_type: NodeType; node_id: string; depth?: number },
): Promise<ReadResult<{ enterprise_graph: GraphNeighborhood }>> {
  try {
    const res = await engineFetch(`/api/enterprise-graph?${graphQuery(params)}`, token);
    if (!res.ok) {
      return { ok: false, disabled: isFeatureDisabledStatus(res.status), error: await readError(res) };
    }
    const body = (await res.json()) as { enterprise_graph: GraphNeighborhood };
    return { ok: true, ...body };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

// ── Applicability decision reads (R5 — over the R4 engine routes) ──────────────

export async function getApplicabilityAssessments(
  token: string,
  params: {
    decision?: ApplicabilityDecision;
    target_type?: MatchTargetType;
    signal_id?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<
  ReadResult<{ applicability_assessments: ApplicabilityAssessmentRow[]; limit: number; offset: number }>
> {
  try {
    const res = await engineFetch(`/api/applicability-assessments?${applicabilityQuery(params)}`, token);
    if (!res.ok) {
      return { ok: false, disabled: isFeatureDisabledStatus(res.status), error: await readError(res) };
    }
    const body = (await res.json()) as {
      applicability_assessments: ApplicabilityAssessmentRow[];
      limit: number;
      offset: number;
    };
    return { ok: true, ...body };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

export async function getApplicabilityAssessment(
  token: string,
  id: string,
): Promise<
  ReadResult<{
    applicability_assessment: ApplicabilityAssessmentDetail;
    explanation: ApplicabilityExplanation;
  }>
> {
  try {
    const res = await engineFetch(`/api/applicability-assessments/${encodeURIComponent(id)}`, token);
    if (!res.ok) {
      return { ok: false, disabled: isFeatureDisabledStatus(res.status), error: await readError(res) };
    }
    const body = (await res.json()) as {
      applicability_assessment: ApplicabilityAssessmentDetail;
      explanation: ApplicabilityExplanation;
    };
    return { ok: true, ...body };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

// ── Stats rollup (R6 — exec dashboard) ─────────────────────────────────────────

export async function getEnterpriseContextStats(
  token: string,
): Promise<ReadResult<{ stats: EnterpriseContextStats }>> {
  try {
    const res = await engineFetch(`/api/enterprise-context/stats`, token);
    if (!res.ok) {
      return { ok: false, disabled: isFeatureDisabledStatus(res.status), error: await readError(res) };
    }
    const body = (await res.json()) as { stats: EnterpriseContextStats };
    return { ok: true, ...body };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

// ── Writes (Client Components → Next proxy routes) ─────────────────────────────

export interface EnterpriseEntityCreateInput {
  entity_type: EntityType;
  name: string;
  description?: string;
  owner_user_id?: string;
  status?: string;
  criticality?: string;
  confidence?: string;
  external_ref?: string;
  data_store?: {
    data_classification?: string;
    residency_region?: string;
    retention_policy?: string;
    encryption_at_rest?: boolean;
  };
}

/**
 * PATCH is partial with per-key replace semantics; a supplied key overwrites the column.
 * Optional string/enum fields accept explicit null to CLEAR the stored value (the engine
 * validator maps null → NULL; empty-string clears strings but is invalid for enums).
 * A supplied `data_store` object replaces ALL four attributes (omitted attrs become null).
 */
export interface EnterpriseEntityUpdateInput {
  name?: string;
  description?: string | null;
  owner_user_id?: string | null;
  status?: string;
  criticality?: string | null;
  confidence?: string | null;
  external_ref?: string | null;
  data_store?: {
    data_classification?: string | null;
    residency_region?: string | null;
    retention_policy?: string | null;
    encryption_at_rest?: boolean | null;
  };
}

export async function createEnterpriseEntity(
  input: EnterpriseEntityCreateInput,
): Promise<ActionResult<{ enterprise_entity: EnterpriseEntity }>> {
  try {
    const res = await fetch(`/api/enterprise-context/entities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: await readError(res), status: res.status };
    const body = (await res.json()) as { enterprise_entity: EnterpriseEntity };
    return { ok: true, ...body };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  }
}

export async function updateEnterpriseEntity(
  id: string,
  input: EnterpriseEntityUpdateInput,
): Promise<ActionResult<{ enterprise_entity: EnterpriseEntity }>> {
  try {
    const res = await fetch(`/api/enterprise-context/entities/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: await readError(res), status: res.status };
    const body = (await res.json()) as { enterprise_entity: EnterpriseEntity };
    return { ok: true, ...body };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  }
}

export async function deleteEnterpriseEntity(
  id: string,
): Promise<ActionResult<{ deleted: boolean; id: string }>> {
  try {
    const res = await fetch(`/api/enterprise-context/entities/${encodeURIComponent(id)}`, {
      method: "DELETE",
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: await readError(res), status: res.status };
    const body = (await res.json()) as { deleted: boolean; id: string };
    return { ok: true, ...body };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  }
}

export interface EnterpriseRelationshipCreateInput {
  from_type: NodeType;
  from_id: string;
  to_type: NodeType;
  to_id: string;
  relationship_type: string;
  note?: string;
}

export async function createEnterpriseRelationship(
  input: EnterpriseRelationshipCreateInput,
): Promise<ActionResult<{ enterprise_relationship: EnterpriseRelationship }>> {
  try {
    const res = await fetch(`/api/enterprise-context/relationships`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: await readError(res), status: res.status };
    const body = (await res.json()) as { enterprise_relationship: EnterpriseRelationship };
    return { ok: true, ...body };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  }
}

export async function deleteEnterpriseRelationship(
  id: string,
): Promise<ActionResult<{ deleted: boolean; id: string }>> {
  try {
    const res = await fetch(`/api/enterprise-context/relationships/${encodeURIComponent(id)}`, {
      method: "DELETE",
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: await readError(res), status: res.status };
    const body = (await res.json()) as { deleted: boolean; id: string };
    return { ok: true, ...body };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  }
}

// ─── EAR management: unified-surface CRUD for the four detail-backed types ─────
//
// Writes run client-side through the Next proxy routes under /api/assets/**,
// which forward the session token to the engine (POST/PATCH/DELETE /api/assets).
// The engine 404s the whole surface while SECURELOGIC_ASSET_REGISTRY_ENABLED is
// off and 403s without the `enterprise_context` capability — statuses pass
// straight through so the client maps the code via assetErrorMessage. Bodies are
// FLAT (asset_type + name + criticality + status + external_ref + typed columns
// as top-level keys), mirroring validateAssetDetailCreate / …Update.

/** Create input: flat body; `asset_type` must be a detail-backed type. */
export type AssetCreateInput = { asset_type: DetailBackedType; name: string } & Record<
  string,
  string | undefined
>;

/** Partial update: flat patch; explicit null clears a nullable column. */
export type AssetUpdateInput = Record<string, string | null>;

export async function createAsset(
  input: AssetCreateInput,
): Promise<ActionResult<{ asset: CanonicalAsset }>> {
  try {
    const res = await fetch(`/api/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: await readError(res), status: res.status };
    const body = (await res.json()) as { asset: CanonicalAsset };
    return { ok: true, ...body };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  }
}

export async function updateAsset(
  id: string,
  input: AssetUpdateInput,
): Promise<ActionResult<{ asset: CanonicalAsset }>> {
  try {
    const res = await fetch(`/api/assets/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: await readError(res), status: res.status };
    const body = (await res.json()) as { asset: CanonicalAsset };
    return { ok: true, ...body };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  }
}

export async function deleteAsset(
  id: string,
): Promise<ActionResult<{ deleted: boolean }>> {
  try {
    const res = await fetch(`/api/assets/${encodeURIComponent(id)}`, {
      method: "DELETE",
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: await readError(res), status: res.status };
    const body = (await res.json()) as { deleted: boolean };
    return { ok: true, ...body };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  }
}

// ── Import (Client Components → multipart Next proxy) ───────────────────────────

async function runEnterpriseImport(
  entity_type: ImportEntityType,
  mode: "preview" | "commit",
  file: File,
): Promise<ActionResult<ImportPlan>> {
  try {
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch(`/api/enterprise-context/import?${importQuery(entity_type, mode)}`, {
      method: "POST",
      body: fd,
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: await readError(res), status: res.status };
    const body = (await res.json()) as ImportPlan;
    return { ok: true, ...body };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  }
}

export function previewEnterpriseImport(
  entity_type: ImportEntityType,
  file: File,
): Promise<ActionResult<ImportPlan>> {
  return runEnterpriseImport(entity_type, "preview", file);
}

export function commitEnterpriseImport(
  entity_type: ImportEntityType,
  file: File,
): Promise<ActionResult<ImportPlan>> {
  return runEnterpriseImport(entity_type, "commit", file);
}

// ── EAR P16: detail-backed asset import (unified /assets/import → thin route) ────

async function runAssetImport(
  asset_type: string,
  mode: "preview" | "commit",
  file: File,
): Promise<ActionResult<ImportPlan>> {
  try {
    const fd = new FormData();
    fd.set("file", file);
    const q = new URLSearchParams({ asset_type, mode }).toString();
    const res = await fetch(`/api/assets/import?${q}`, {
      method: "POST",
      body: fd,
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: await readError(res), status: res.status };
    const body = (await res.json()) as ImportPlan;
    return { ok: true, ...body };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  }
}

export function previewAssetImport(asset_type: string, file: File): Promise<ActionResult<ImportPlan>> {
  return runAssetImport(asset_type, "preview", file);
}

export function commitAssetImport(asset_type: string, file: File): Promise<ActionResult<ImportPlan>> {
  return runAssetImport(asset_type, "commit", file);
}

// ── EAR P16: connector configuration mutations (admin-only; /assets/connect/[id]) ─
//
// Client → Next proxy (/api/connectors/*) → engine PUT/DELETE/POST. The engine
// fences these on admin role (requireAdminRole) + the ECL/registry flags + the
// enterprise_context capability; a 403 surfaces as insufficient_permissions/
// forbidden, classified by the caller.

export interface ConnectorConfigBody {
  config?: Record<string, string>;
  enabled?: boolean;
  sync_interval_minutes?: number | null;
}

export async function saveConnectorConfig(
  id: string,
  body: ConnectorConfigBody,
): Promise<ActionResult<{ connector?: unknown }>> {
  try {
    const res = await fetch(`/api/connectors/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: await readError(res), status: res.status };
    const data = (await res.json().catch(() => ({}))) as { connector?: unknown };
    return { ok: true, ...data };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  }
}

export async function disconnectConnector(id: string): Promise<ActionResult<{ deleted?: boolean }>> {
  try {
    const res = await fetch(`/api/connectors/${encodeURIComponent(id)}`, {
      method: "DELETE",
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: await readError(res), status: res.status };
    const data = (await res.json().catch(() => ({}))) as { deleted?: boolean };
    return { ok: true, ...data };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  }
}

export async function syncConnector(id: string): Promise<ActionResult<{ status?: string }>> {
  try {
    const res = await fetch(`/api/connectors/${encodeURIComponent(id)}/sync`, {
      method: "POST",
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: await readError(res), status: res.status };
    const data = (await res.json().catch(() => ({}))) as { status?: string };
    return { ok: true, ...data };
  } catch {
    return { ok: false, error: "network_error", status: 0 };
  }
}

// =========================================================
// ERIP Executive Risk dashboard reads (Server Components)
//
// All dark behind their engine feature flags (risk-intelligence /
// predictive-intelligence / knowledge-graph / connectors), so each returns the
// ReadResult<T> union: { ok:false, disabled:true } == the engine 404'd (feature
// off / not granted → the page hides the panel); { ok:false, disabled:false }
// is a real error. Types live in ./executiveRisk (client-safe, shared with the
// chart components).
// =========================================================

/** GET /api/risk/trends — per-dimension executive trend lines over risk_history. */
export async function getRiskTrends(token: string, days = 90): Promise<ReadResult<RiskTrendsResponse>> {
  try {
    const res = await engineFetch(`/api/risk/trends?days=${encodeURIComponent(String(days))}`, token);
    if (!res.ok) return { ok: false, disabled: isFeatureDisabledStatus(res.status), error: await readError(res) };
    return { ok: true, ...((await res.json()) as RiskTrendsResponse) };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

/** GET /api/risk/kpis — executive KPI scorecard (enterprise current vs window start). */
export async function getRiskKpis(token: string, days = 90): Promise<ReadResult<RiskKpisResponse>> {
  try {
    const res = await engineFetch(`/api/risk/kpis?days=${encodeURIComponent(String(days))}`, token);
    if (!res.ok) return { ok: false, disabled: isFeatureDisabledStatus(res.status), error: await readError(res) };
    return { ok: true, ...((await res.json()) as RiskKpisResponse) };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

/** GET /api/predictive/insights — LLM-assisted (or deterministic) forecast narrative. */
export async function getPredictiveInsights(token: string): Promise<ReadResult<PredictiveInsightsResponse>> {
  try {
    const res = await engineFetch(`/api/predictive/insights`, token);
    if (!res.ok) return { ok: false, disabled: isFeatureDisabledStatus(res.status), error: await readError(res) };
    return { ok: true, ...((await res.json()) as PredictiveInsightsResponse) };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

/** GET /api/predictive/posture-forecast — posture score observations + projection. */
export async function getPostureForecast(token: string, horizonDays = 30): Promise<ReadResult<PostureForecastResponse>> {
  try {
    const res = await engineFetch(`/api/predictive/posture-forecast?horizon_days=${encodeURIComponent(String(horizonDays))}`, token);
    if (!res.ok) return { ok: false, disabled: isFeatureDisabledStatus(res.status), error: await readError(res) };
    return { ok: true, ...((await res.json()) as PostureForecastResponse) };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

/** GET /api/connectors/health — per-connector health band + org rollup. */
export async function getConnectorHealth(token: string): Promise<ReadResult<ConnectorHealthResponse>> {
  try {
    const res = await engineFetch(`/api/connectors/health`, token);
    if (!res.ok) return { ok: false, disabled: isFeatureDisabledStatus(res.status), error: await readError(res) };
    return { ok: true, ...((await res.json()) as ConnectorHealthResponse) };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

/**
 * GET /api/connectors — the org's connectors merged with the registry catalog
 * (the "Connect Enterprise Systems" catalog behind /assets/connect). Double-
 * fenced on the engine (ECL + asset-registry flags) + `enterprise_context`
 * capability; a 404 → disabled, 403 → capability_required, classified by
 * connectorsReadFailure.
 */
export async function getConnectors(
  token: string,
): Promise<ReadResult<{ connectors: OrgConnector[] }>> {
  try {
    const res = await engineFetch(`/api/connectors`, token);
    if (!res.ok) return { ok: false, disabled: isFeatureDisabledStatus(res.status), error: await readError(res) };
    return { ok: true, ...((await res.json()) as { connectors: OrgConnector[] }) };
  } catch {
    return { ok: false, disabled: false, error: "network_error" };
  }
}

// ─── Intelligence Event drill-through (ERIP Package 3.3) ──────────────────────
// Read one canonical Intelligence Event for the drill-through page
// (/intelligence/[id]). The engine route GET /api/intelligence/events/:id is
// gated by its OWN pre-existing flag (SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED)
// and returns a bare 404 while dark — so this fetcher fail-softs to null on any
// non-200, exactly like getFindingContext. The drill-through page treats null as
// "no canonical enrichment available" and renders from the finding-context
// payload (or the honest-unavailable state); it never blocks on this call.
//
// These types mirror the engine reader's IntelligenceEventDetail
// (src/api/lib/signals/intelligenceEventReader.ts) field-for-field. The engine
// responds with the detail object directly (not wrapped), matching getEventDetail.

export type IntelligenceEventRow = {
  id: string;
  canonical_key: string;
  title: string;
  executive_summary: string;
  summary_status: string;
  event_type: string;
  severity: string;
  status: string;
  affected_cve: string | null;
  affected_vendor: string | null;
  source_count: number;
  confidence: number;
  first_seen_at: string;
  last_seen_at: string;
  revision: number;
};

/** A corroborating source (citation = attribution + timestamps; no URL field). */
export type IntelligenceEventSource = {
  source: string;
  external_id: string | null;
  relation: string;
  first_contributed_at: string;
  last_contributed_at: string;
};

export type IntelligenceEventTimelineEntry = {
  entry_type: string;
  occurred_at: string;
  summary: string;
  source: string | null;
};

export type IntelligenceRelatedFinding = {
  id: string;
  title: string;
  severity: string;
  status: string;
  domain: string | null;
};

export type IntelligenceAffectedAsset = {
  kind: "vendor";
  id: string;
  name: string;
};

export type IntelligenceRecommendedAction = {
  action: string;
  urgency: "immediate" | "near_term" | "planned" | "watch";
};

export type IntelligenceEventDetail = {
  event: IntelligenceEventRow;
  sources: IntelligenceEventSource[];
  timeline: IntelligenceEventTimelineEntry[];
  related_findings: IntelligenceRelatedFinding[];
  affected_assets: IntelligenceAffectedAsset[];
  recommended_actions: IntelligenceRecommendedAction[];
};

/**
 * Fetch one canonical Intelligence Event by id. Returns null when the event is
 * not found OR the engine's Intelligence Events surface is dark (bare 404) OR
 * the request errors — the caller degrades honestly and never throws.
 */
export async function getIntelligenceEvent(
  apiKey: string,
  id: string,
): Promise<IntelligenceEventDetail | null> {
  try {
    const res = await engineFetch(`/api/intelligence/events/${encodeURIComponent(id)}`, apiKey);
    if (!res.ok) return null;
    return (await res.json()) as IntelligenceEventDetail;
  } catch {
    return null;
  }
}

// =========================================================
// GLOBAL SEARCH (GET /api/search)
// =========================================================

export type GlobalSearchHit = {
  type: "finding" | "risk" | "vendor" | "ai_system" | "control" | "obligation" | "asset";
  id: string;
  title: string;
  subtitle: string | null;
  /** App route for this object — the engine owns routing, the UI just links. */
  href: string;
};

export type GlobalSearchResponse = {
  query: string;
  total: number;
  hits: GlobalSearchHit[];
};

/**
 * Federated search across the canonical domain objects. Returns null on any
 * failure (bad query, entitlement denial, engine error) — the search page
 * degrades to an empty state and never throws.
 */
export async function searchGlobal(
  apiKey: string,
  q: string,
): Promise<GlobalSearchResponse | null> {
  try {
    const res = await engineFetch(`/api/search?q=${encodeURIComponent(q)}`, apiKey);
    if (!res.ok) return null;
    return (await res.json()) as GlobalSearchResponse;
  } catch {
    return null;
  }
}

// =========================================================
// VENDOR ENGAGEMENT WORKFLOW (internal reviewer surface)
//
// Typed wrappers over src/api/routes/vendorEngagements.ts — the internal half
// of the Vendor Assurance engagement spine. The ENGINE is the only authority on
// workflow legality: every transition is re-checked server-side and a refused
// one comes back as a 409 whose reason these wrappers preserve verbatim
// (`VendorEngagementFailure`) so the UI can show the engine's words, not a
// paraphrase.
// =========================================================

/**
 * The engine's refusal/validation shape, preserved as-is. 409s carry `reason`
 * (the state machine's sentence) and/or `message` (the handler's explanation);
 * 400s on intake carry `missing` + `invalid`.
 */
export type VendorEngagementFailure = {
  error: string;
  message?: string;
  reason?: string;
  from?: string;
  status?: string;
  missing?: string[];
  invalid?: Array<{ field: string; allowed: readonly string[] }>;
};

export type VendorEngagementResult<T> = T | { failure: VendorEngagementFailure };

export function isEngagementFailure<T>(
  r: VendorEngagementResult<T>
): r is { failure: VendorEngagementFailure } {
  return typeof r === "object" && r !== null && "failure" in r;
}

/**
 * The one sentence a reviewer sees when the engine refuses an action.
 * Preference order: the handler's `message`, then the state machine's `reason`,
 * then a summary of intake validation, then the bare error code. Never invents
 * words the engine did not say beyond naming the failed fields.
 */
export function vendorEngagementFailureText(f: VendorEngagementFailure): string {
  if (f.message) return f.message;
  if (f.reason) return f.reason;
  const parts: string[] = [];
  if (f.missing && f.missing.length > 0) {
    parts.push(`Missing: ${f.missing.join(", ")}`);
  }
  if (f.invalid && f.invalid.length > 0) {
    parts.push(
      f.invalid
        .map((i) => `Invalid ${i.field} (allowed: ${i.allowed.join(", ")})`)
        .join("; ")
    );
  }
  if (parts.length > 0) return parts.join(". ");
  return f.error;
}

async function engagementFailureFrom(
  res: Response,
  fallback: string
): Promise<{ failure: VendorEngagementFailure }> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    failure: {
      error: String(body["error"] ?? fallback),
      ...(typeof body["message"] === "string" ? { message: body["message"] } : {}),
      ...(typeof body["reason"] === "string" ? { reason: body["reason"] } : {}),
      ...(typeof body["from"] === "string" ? { from: body["from"] } : {}),
      ...(typeof body["status"] === "string" ? { status: body["status"] } : {}),
      ...(Array.isArray(body["missing"]) ? { missing: body["missing"] as string[] } : {}),
      ...(Array.isArray(body["invalid"])
        ? { invalid: body["invalid"] as Array<{ field: string; allowed: readonly string[] }> }
        : {}),
    },
  };
}

/** One row of GET /api/vendor-engagements — the reviewer's queue. */
export type VendorEngagementListRow = {
  id: string;
  status: string;
  title: string | null;
  engagement_type: string;
  inherent_score: number | null;
  inherent_rating: string | null;
  assessment_tier: string | null;
  residual_score: number | null;
  residual_rating: string | null;
  residual_computed_at: string | null;
  decision: string | null;
  decided_at: string | null;
  next_review_due: string | null;
  analysis_coverage: "full" | "partial" | "deterministic_only" | null;
  /** Monitoring-sweep signal: status='monitoring' AND next_review_due < today. */
  review_overdue: boolean;
  /** Intelligence-triggered reassessment recommendation, if the sweep raised one. */
  reassessment_recommended_at: string | null;
  vendor_id: string;
  vendor_name: string;
  created_at: string;
  updated_at: string;
};

/** GET /api/vendor-engagements/:id — SELECT e.* + vendor_name. */
export type VendorEngagementDetail = {
  id: string;
  organization_id: string;
  vendor_id: string;
  vendor_name: string;
  engagement_type: string;
  parent_engagement_id: string | null;
  title: string | null;
  status: string;
  issued_at: string | null;
  submitted_at: string | null;
  closed_at: string | null;
  cancellation_reason: string | null;
  inherent_score: number | null;
  inherent_rating: string | null;
  inherent_arithmetic_rating: string | null;
  inherent_basis: unknown;
  inherent_override_rationale: string | null;
  inherent_overridden_at: string | null;
  assessment_tier: string | null;
  effectiveness_score: number | null;
  residual_score: number | null;
  residual_rating: string | null;
  residual_basis: unknown;
  residual_computed_at: string | null;
  decision: string | null;
  decision_rationale: string | null;
  decided_at: string | null;
  decision_expires_at: string | null;
  analysis_coverage: "full" | "partial" | "deterministic_only" | null;
  analysis_coverage_at: string | null;
  next_review_due: string | null;
  review_cadence_days: number | null;
  reassessment_recommended_at: string | null;
  reassessment_reason: string | null;
  scope_resolved_at: string | null;
  methodology_version: string;
  scope_rule_version: string;
  created_at: string;
  updated_at: string;
};

export type VendorEngagementQuestionnaire = {
  scoped: number;
  answered: number;
  mandatory: number;
};

/** One row of GET /api/vendor-engagements/:id/evidence. */
export type VendorEngagementEvidenceRow = {
  id: string;
  title: string | null;
  original_filename: string | null;
  /** BIGINT — node-postgres serializes it as a string; callers must coerce. */
  byte_size: number | string | null;
  mime_type: string | null;
  created_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  requirement_id: string | null;
  requirement_reference: string | null;
  requirement_title: string | null;
  /** Provenance: an invite upload means the VENDOR supplied it. */
  from_vendor: boolean;
  uploaded_by_user_id: string | null;
  /**
   * The analysis worker's ADVISORY verdict — a suggestion for where to look
   * first, never an input to scoring. `unreadable` is the worker's deterministic
   * "a human must read this". Null when the worker has not run for this file.
   */
  analysis_verdict: "supports" | "insufficient" | "contradicts" | "unreadable" | null;
  analysis_rationale: string | null;
};

/** One row of GET /api/vendor-engagements/:id/comments. */
export type VendorEngagementComment = {
  id: string;
  author_type: "internal" | "vendor";
  author_user_id: string | null;
  author_display_name: string | null;
  visibility: "internal" | "vendor";
  body: string;
  created_at: string;
  requirement_id: string | null;
  requirement_reference: string | null;
};

/** POST /api/vendor-engagements — full intake; every field is required. */
export type VendorEngagementIntakeInput = {
  data_sensitivity: string;
  data_volume: string;
  access_level: string;
  operational_dependency: string;
  recoverability: string;
  business_criticality: string;
  regulatory_exposure: string;
  regulatory_breach_notification: boolean;
  ai_involvement: string;
  ai_autonomy: string;
  hosting_model: string;
  fourth_party_exposure: string;
  concentration: string;
};

export type VendorEngagementCreated = {
  id: string;
  status: "draft";
  inherent: {
    score: number;
    rating: string;
    arithmetic_rating: string;
    tier: string;
    basis: unknown;
  };
};

export async function listVendorEngagements(
  token: string,
  opts?: { status?: string; limit?: number }
): Promise<{ engagements: VendorEngagementListRow[]; count: number } | null> {
  const params = new URLSearchParams();
  if (opts?.status) params.set("status", opts.status);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  try {
    const res = await engineFetch(`/api/vendor-engagements${qs ? `?${qs}` : ""}`, token);
    if (!res.ok) return null;
    return res.json() as Promise<{ engagements: VendorEngagementListRow[]; count: number }>;
  } catch {
    return null;
  }
}

export async function getVendorEngagement(
  token: string,
  id: string
): Promise<{
  engagement: VendorEngagementDetail;
  questionnaire: VendorEngagementQuestionnaire;
  /** VA-L1 — optional during rolling deploy: older engines omit it. */
  invite?: VendorEngagementInviteBlock;
} | null> {
  try {
    const res = await engineFetch(`/api/vendor-engagements/${encodeURIComponent(id)}`, token);
    if (!res.ok) return null;
    return res.json() as Promise<{
      engagement: VendorEngagementDetail;
      questionnaire: VendorEngagementQuestionnaire;
      invite?: VendorEngagementInviteBlock;
    }>;
  } catch {
    return null;
  }
}

export async function createVendorEngagement(
  token: string,
  input: {
    vendor_id: string;
    engagement_type: "initial" | "periodic" | "targeted" | "event_driven";
    title?: string;
    intake: VendorEngagementIntakeInput;
  }
): Promise<VendorEngagementResult<VendorEngagementCreated>> {
  try {
    const res = await engineFetch(`/api/vendor-engagements`, token, {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!res.ok) return engagementFailureFrom(res, "engagement_create_failed");
    return (await res.json()) as VendorEngagementCreated;
  } catch {
    return { failure: { error: "engagement_create_failed" } };
  }
}

export async function overrideVendorEngagementInherent(
  token: string,
  id: string,
  rating: string,
  rationale: string
): Promise<VendorEngagementResult<{ ok: true; inherent_rating: string }>> {
  try {
    const res = await engineFetch(
      `/api/vendor-engagements/${encodeURIComponent(id)}/inherent`,
      token,
      { method: "PATCH", body: JSON.stringify({ rating, rationale }) }
    );
    if (!res.ok) return engagementFailureFrom(res, "override_failed");
    return (await res.json()) as { ok: true; inherent_rating: string };
  } catch {
    return { failure: { error: "override_failed" } };
  }
}

export async function resolveVendorEngagementScope(
  token: string,
  id: string
): Promise<
  VendorEngagementResult<{
    scoped: number;
    excluded: number;
    tier: string;
    scope_rule_version: string;
    /** Tier-cap truncation, surfaced never silent (VA-6 repaired the field
     *  name — the engine previously emitted a `notes` that was always null). */
    truncated: { cap: number; dropped_requirement_ids: string[] } | null;
  }>
> {
  try {
    const res = await engineFetch(
      `/api/vendor-engagements/${encodeURIComponent(id)}/scope`,
      token,
      { method: "POST", body: JSON.stringify({}) }
    );
    if (!res.ok) return engagementFailureFrom(res, "scope_resolve_failed");
    return (await res.json()) as {
      scoped: number;
      excluded: number;
      tier: string;
      scope_rule_version: string;
      truncated: { cap: number; dropped_requirement_ids: string[] } | null;
    };
  } catch {
    return { failure: { error: "scope_resolve_failed" } };
  }
}

/**
 * POST .../issue — mints the vendor portal invite. The engine returns the RAW
 * token exactly once (only its hash is stored). The caller must show it once
 * and never persist it.
 */
export async function issueVendorEngagement(
  token: string,
  id: string,
  contactEmail: string,
  contactName?: string
): Promise<
  VendorEngagementResult<{
    ok: true;
    status: "issued";
    invite_token: string;
    expires_at: string;
    /** VA-L1 — optional during rolling deploy: older engines omit it. */
    email_delivery?: InviteEmailDelivery;
  }>
> {
  try {
    const res = await engineFetch(
      `/api/vendor-engagements/${encodeURIComponent(id)}/issue`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          contact_email: contactEmail,
          ...(contactName ? { contact_name: contactName } : {}),
        }),
      }
    );
    if (!res.ok) return engagementFailureFrom(res, "issue_failed");
    return (await res.json()) as {
      ok: true;
      status: "issued";
      invite_token: string;
      expires_at: string;
      email_delivery?: InviteEmailDelivery;
    };
  } catch {
    return { failure: { error: "issue_failed" } };
  }
}

/** VA-L1 (2026-08-23): invite lifecycle. */
export type InviteEmailDelivery = "sent" | "failed" | "disabled";

/** Customer-visible invite record — the engine never includes token material. */
export type VendorEngagementInviteStatus = {
  id: string;
  contact_email: string;
  contact_name: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  first_exchanged_at: string | null;
  last_exchanged_at: string | null;
  exchange_count: number;
};

export type VendorEngagementInviteBlock = {
  active: VendorEngagementInviteStatus | null;
  latest: VendorEngagementInviteStatus | null;
  history_count: number;
};

export async function revokeVendorEngagementInvite(
  token: string,
  id: string,
  reason?: string
): Promise<
  VendorEngagementResult<{ ok: true; invites_revoked: number; sessions_revoked: number }>
> {
  try {
    const res = await engineFetch(
      `/api/vendor-engagements/${encodeURIComponent(id)}/invite/revoke`,
      token,
      { method: "POST", body: JSON.stringify(reason ? { reason } : {}) }
    );
    if (!res.ok) return engagementFailureFrom(res, "invite_revoke_failed");
    return (await res.json()) as {
      ok: true;
      invites_revoked: number;
      sessions_revoked: number;
    };
  } catch {
    return { failure: { error: "invite_revoke_failed" } };
  }
}

export async function reissueVendorEngagementInvite(
  token: string,
  id: string,
  contactEmail: string,
  contactName?: string
): Promise<
  VendorEngagementResult<{
    ok: true;
    invite_token: string;
    expires_at: string;
    prior_invites_revoked: number;
    email_delivery: InviteEmailDelivery;
  }>
> {
  try {
    const res = await engineFetch(
      `/api/vendor-engagements/${encodeURIComponent(id)}/invite/reissue`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          contact_email: contactEmail,
          ...(contactName ? { contact_name: contactName } : {}),
        }),
      }
    );
    if (!res.ok) return engagementFailureFrom(res, "invite_reissue_failed");
    return (await res.json()) as {
      ok: true;
      invite_token: string;
      expires_at: string;
      prior_invites_revoked: number;
      email_delivery: InviteEmailDelivery;
    };
  } catch {
    return { failure: { error: "invite_reissue_failed" } };
  }
}

export type VendorEngagementRecomputeResult = {
  effectiveness: {
    score: number;
    arithmetic_score: number;
    assessed: number;
    not_applicable: number;
    not_assessed: number;
    failed_mandatory: number;
    coverage: number;
    basis: unknown;
  };
  residual: {
    score: number;
    rating: string;
    arithmetic_score: number;
    inherent_understated: boolean;
    basis: unknown;
  };
};

export async function recomputeVendorEngagementRisk(
  token: string,
  id: string
): Promise<VendorEngagementResult<VendorEngagementRecomputeResult>> {
  try {
    const res = await engineFetch(
      `/api/vendor-engagements/${encodeURIComponent(id)}/recompute`,
      token,
      { method: "POST", body: JSON.stringify({}) }
    );
    if (!res.ok) return engagementFailureFrom(res, "recompute_failed");
    return (await res.json()) as VendorEngagementRecomputeResult;
  } catch {
    return { failure: { error: "recompute_failed" } };
  }
}

/** The engine's allowed decision values (POST .../decision). */
export const VENDOR_ENGAGEMENT_DECISIONS = [
  "approved",
  "approved_with_conditions",
  "rejected",
  "terminated",
] as const;
export type VendorEngagementDecision = (typeof VENDOR_ENGAGEMENT_DECISIONS)[number];

export async function recordVendorEngagementDecision(
  token: string,
  id: string,
  decision: VendorEngagementDecision,
  rationale: string,
  expiresAt?: string
): Promise<
  VendorEngagementResult<{
    ok: true;
    status: "decided";
    decision: string;
    residual_score: number | null;
    residual_rating: string | null;
  }>
> {
  try {
    const res = await engineFetch(
      `/api/vendor-engagements/${encodeURIComponent(id)}/decision`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          decision,
          rationale,
          ...(expiresAt ? { expires_at: expiresAt } : {}),
        }),
      }
    );
    if (!res.ok) return engagementFailureFrom(res, "decision_failed");
    return (await res.json()) as {
      ok: true;
      status: "decided";
      decision: string;
      residual_score: number | null;
      residual_rating: string | null;
    };
  } catch {
    return { failure: { error: "decision_failed" } };
  }
}

/** VA-R1 (2026-08-23): the reviewer's per-question view of the questionnaire.
 *  Pre-issue this is "what will be sent" (every response is null); post-submit
 *  it is the review surface. The engine computes everything — never derive
 *  answered/complete locally. */
export type VendorEngagementResponseItem = {
  requirement: {
    id: string;
    reference: string;
    title: string;
    description: string | null;
  };
  scope: { depth: string; mandatory: boolean };
  response: {
    status: string | null;
    notes: string | null;
    responder_type: string | null;
    answered_via_invite_id: string | null;
    assessed_by_user_id: string | null;
    assessed_at: string | null;
    updated_at: string | null;
  } | null;
  evidence: { count: number; confirmed: boolean };
  revisions: {
    total: number;
    truncated: boolean;
    entries: Array<{
      status: string;
      notes: string | null;
      responder_type: string;
      answered_by_user_id: string | null;
      answered_via_invite_id: string | null;
      created_at: string;
    }>;
  };
};

export type VendorEngagementResponses = {
  engagement_id: string;
  engagement_status: string;
  counts: { scoped: number; answered: number; mandatory: number };
  items: VendorEngagementResponseItem[];
};

export async function getVendorEngagementResponses(
  token: string,
  id: string
): Promise<VendorEngagementResponses | null> {
  try {
    const res = await engineFetch(
      `/api/vendor-engagements/${encodeURIComponent(id)}/responses`,
      token
    );
    if (!res.ok) return null;
    return res.json() as Promise<VendorEngagementResponses>;
  } catch {
    return null;
  }
}

export async function listVendorEngagementEvidence(
  token: string,
  id: string
): Promise<{ evidence: VendorEngagementEvidenceRow[]; count: number } | null> {
  try {
    const res = await engineFetch(
      `/api/vendor-engagements/${encodeURIComponent(id)}/evidence`,
      token
    );
    if (!res.ok) return null;
    return res.json() as Promise<{ evidence: VendorEngagementEvidenceRow[]; count: number }>;
  } catch {
    return null;
  }
}

/**
 * POST .../evidence/:evidenceId/review — the human confirmation the assurance
 * ladder turns on. `supports:false` requires a note the vendor can act on.
 * The engine reminds: run /recompute to apply the change to the scores.
 */
export async function reviewVendorEngagementEvidence(
  token: string,
  id: string,
  evidenceId: string,
  supports: boolean,
  note?: string
): Promise<VendorEngagementResult<{ ok: true; reviewed: boolean; note: string }>> {
  try {
    const res = await engineFetch(
      `/api/vendor-engagements/${encodeURIComponent(id)}/evidence/${encodeURIComponent(evidenceId)}/review`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ supports, ...(note ? { note } : {}) }),
      }
    );
    if (!res.ok) return engagementFailureFrom(res, "review_failed");
    return (await res.json()) as { ok: true; reviewed: boolean; note: string };
  } catch {
    return { failure: { error: "review_failed" } };
  }
}

export type VendorEngagementPromotionResult = {
  promoted: number;
  created: number;
  updated: number;
  findings: Array<{
    reference: string;
    severity: string;
    title: string;
    severity_rationale: string;
  }>;
  /** Supersede-on-pass ruling (2026-08-22, cross-engagement 2026-08-23):
   *  open findings — from ANY engagement of this vendor — whose controls now
   *  report pass/not_applicable in THIS engagement. Named, never auto-closed.
   *  `source_engagement_id` may name an EARLIER engagement than the one
   *  promoted against; the engine computes this — never recompute here. */
  superseded_by_source: Array<{
    finding_id: string;
    reference: string;
    requirement_id: string;
    /** Optional during rolling deploy — older engine payloads omit it. */
    source_engagement_id?: string;
    current_response: "pass" | "not_applicable";
    as_of: string;
  }>;
  /** Findings whose equivalence to a current response CANNOT be established
   *  deterministically (requirement_id is NULL). Surfaced, never guessed.
   *  Optional during rolling deploy. */
  supersede_equivalence_undetermined?: {
    count: number;
    finding_ids: string[];
  };
};

export async function promoteVendorEngagementFindings(
  token: string,
  id: string
): Promise<VendorEngagementResult<VendorEngagementPromotionResult>> {
  try {
    const res = await engineFetch(
      `/api/vendor-engagements/${encodeURIComponent(id)}/promote-findings`,
      token,
      { method: "POST", body: JSON.stringify({}) }
    );
    if (!res.ok) return engagementFailureFrom(res, "promotion_failed");
    return (await res.json()) as VendorEngagementPromotionResult;
  } catch {
    return { failure: { error: "promotion_failed" } };
  }
}

export async function listVendorEngagementComments(
  token: string,
  id: string
): Promise<{ comments: VendorEngagementComment[]; count: number } | null> {
  try {
    const res = await engineFetch(
      `/api/vendor-engagements/${encodeURIComponent(id)}/comments`,
      token
    );
    if (!res.ok) return null;
    return res.json() as Promise<{ comments: VendorEngagementComment[]; count: number }>;
  } catch {
    return null;
  }
}

/**
 * POST .../comments. Visibility defaults to INTERNAL server-side; a
 * vendor-visible comment posted while in_review performs
 * in_review → clarification_requested — the response's `status` reports the
 * resulting state so the caller can tell whether that transition happened.
 */
export async function postVendorEngagementComment(
  token: string,
  id: string,
  body: string,
  visibility: "internal" | "vendor",
  requirementId?: string
): Promise<VendorEngagementResult<{ id: string; visibility: string; status: string }>> {
  try {
    const res = await engineFetch(
      `/api/vendor-engagements/${encodeURIComponent(id)}/comments`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          body,
          visibility,
          ...(requirementId ? { requirement_id: requirementId } : {}),
        }),
      }
    );
    if (!res.ok) return engagementFailureFrom(res, "comment_post_failed");
    return (await res.json()) as { id: string; visibility: string; status: string };
  } catch {
    return { failure: { error: "comment_post_failed" } };
  }
}

export async function beginVendorEngagementReview(
  token: string,
  id: string
): Promise<VendorEngagementResult<{ ok: true; status: "in_review" }>> {
  try {
    const res = await engineFetch(
      `/api/vendor-engagements/${encodeURIComponent(id)}/begin-review`,
      token,
      { method: "POST", body: JSON.stringify({}) }
    );
    if (!res.ok) return engagementFailureFrom(res, "begin_review_failed");
    return (await res.json()) as { ok: true; status: "in_review" };
  } catch {
    return { failure: { error: "begin_review_failed" } };
  }
}

export async function completeVendorEngagementAnalysis(
  token: string,
  id: string
): Promise<
  VendorEngagementResult<{
    ok: true;
    status: "analysis_complete";
    analysis_coverage: "full" | "partial" | "deterministic_only";
  }>
> {
  try {
    const res = await engineFetch(
      `/api/vendor-engagements/${encodeURIComponent(id)}/complete-analysis`,
      token,
      { method: "POST", body: JSON.stringify({}) }
    );
    if (!res.ok) return engagementFailureFrom(res, "complete_analysis_failed");
    return (await res.json()) as {
      ok: true;
      status: "analysis_complete";
      analysis_coverage: "full" | "partial" | "deterministic_only";
    };
  } catch {
    return { failure: { error: "complete_analysis_failed" } };
  }
}

/**
 * POST .../monitoring — from `decided` it starts monitoring; from `monitoring`
 * it records a completed periodic review (re-arming both sweep triggers).
 * Provide cadence_days (1–3650) or an explicit next_review_due (YYYY-MM-DD).
 */
export async function startVendorEngagementMonitoring(
  token: string,
  id: string,
  opts: { cadenceDays?: number; nextReviewDue?: string }
): Promise<
  VendorEngagementResult<{
    ok: true;
    status: "monitoring";
    next_review_due: string;
    cadence_days: number | null;
  }>
> {
  try {
    const res = await engineFetch(
      `/api/vendor-engagements/${encodeURIComponent(id)}/monitoring`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          ...(opts.cadenceDays !== undefined ? { cadence_days: opts.cadenceDays } : {}),
          ...(opts.nextReviewDue ? { next_review_due: opts.nextReviewDue } : {}),
        }),
      }
    );
    if (!res.ok) return engagementFailureFrom(res, "monitoring_start_failed");
    return (await res.json()) as {
      ok: true;
      status: "monitoring";
      next_review_due: string;
      cadence_days: number | null;
    };
  } catch {
    return { failure: { error: "monitoring_start_failed" } };
  }
}


/* ── Findings ↔ Risk Register (SL-RISK-LINK) ─────────────────────────────── */

export interface FindingRiskLink {
  risk_id: string;
  link_type: "linked" | "promoted";
  note: string | null;
  created_at: string;
  created_by_user_id: string | null;
  risk_title: string;
  risk_domain: string;
  risk_rating: string;
  risk_status: string;
}

export interface RiskSupportingFinding {
  finding_id: string;
  link_type: "linked" | "promoted";
  note: string | null;
  created_at: string;
  finding_title: string;
  finding_severity: string;
  finding_status: string;
  finding_source_type: string;
  finding_due_date: string | null;
}

/**
 * The register entries this finding supports. An EMPTY list is the normal,
 * correct answer for most findings — standalone is the default and is never
 * changed by automation — so callers must render "not linked" as a state, not
 * as an absence of data.
 */
/**
 * Which assets a vulnerability affects, and the rollup shown beside it.
 *
 * PAGINATED BY CONTRACT. A finding can affect thousands of hosts, so there is no
 * "fetch them all" variant — the caller always asks for a page, and the rollup
 * comes from a grouped aggregate rather than from counting the page it happened
 * to receive. Returning zero occurrences is a legitimate state ("no asset
 * recorded"), never an error, so failures degrade to an empty page with a zero
 * rollup rather than throwing into a finding page that is otherwise fine.
 */
export interface FindingOccurrence {
  id: string;
  finding_id: string;
  asset_id: string;
  presence_status: "present" | "absent" | "remediated";
  first_seen_at: string;
  last_seen_at: string;
  absent_since: string | null;
  remediated_at: string | null;
  reappeared_count: number;
  last_reappeared_at: string | null;
  source: string | null;
  source_occurrence_id: string | null;
  asset_type: string | null;
  asset_lifecycle_status: string | null;
}

export interface OccurrenceRollup {
  affected: number;
  active: number;
  absent: number;
  remediated: number;
  recurring: number;
}

export async function getFindingOccurrences(
  token: string,
  findingId: string,
  opts: { limit?: number; offset?: number; presenceStatus?: string } = {}
): Promise<{ occurrences: FindingOccurrence[]; rollup: OccurrenceRollup; limit: number; offset: number }> {
  const empty = {
    occurrences: [] as FindingOccurrence[],
    rollup: { affected: 0, active: 0, absent: 0, remediated: 0, recurring: 0 },
    limit: opts.limit ?? 25,
    offset: opts.offset ?? 0,
  };
  try {
    const qs = new URLSearchParams();
    if (opts.limit !== undefined) qs.set("limit", String(opts.limit));
    if (opts.offset !== undefined) qs.set("offset", String(opts.offset));
    if (opts.presenceStatus) qs.set("presence_status", opts.presenceStatus);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await engineFetch(
      `/api/findings/${encodeURIComponent(findingId)}/occurrences${suffix}`,
      token
    );
    if (!res.ok) return empty;
    const body = (await res.json()) as Partial<typeof empty>;
    return {
      occurrences: body.occurrences ?? [],
      rollup: body.rollup ?? empty.rollup,
      limit: body.limit ?? empty.limit,
      offset: body.offset ?? empty.offset,
    };
  } catch {
    return empty;
  }
}

/**
 * T1-B — where a promoted Vendor Assurance finding came from.
 *
 * `source` is a three-state answer, not a nullable payload:
 *   "vendor_assurance_cuec" — promoted from a reviewed CUEC; `provenance` is set
 *   "vendor_assessment"     — a vendor_review finding with no CUEC. Legitimate
 *   "not_applicable"        — some other source_type entirely
 *
 * Absence is an answer rather than an error, so the panel can say which of those
 * three it is instead of rendering an empty box. Fails soft like every other
 * finding-detail panel: a provenance lookup must never take down the page.
 */
export interface FindingVendorProvenance {
  finding_id: string;
  source_type: string;
  source:
    | "vendor_assurance_cuec"
    | "vendor_assessment"
    | "vendor_engagement"
    | "not_applicable";
  /** VA-10: set only for source === "vendor_engagement"; null there means a
   *  dangling source_id (convention arm) — reported honestly, not 404'd. */
  engagement_provenance?: {
    vendor: { id: string; name: string };
    engagement: {
      id: string;
      title: string | null;
      engagement_type: string;
      status: string;
      decision: string | null;
      decided_at: string | null;
      submitted_at: string | null;
      methodology_version: string;
    };
    requirement: {
      id: string;
      reference: string | null;
      title: string | null;
    } | null;
    /** Promotion-time snapshot, stamped with the methodology version. */
    severity_rationale: string | null;
    /** Today's source assertion — labeled CURRENT in the UI. Per the
     *  supersede-on-pass ruling a pass here never closes the finding. */
    current_response: {
      status: string;
      as_of: string | null;
      responder_type: string | null;
    } | null;
  } | null;
  provenance: {
    vendor: { id: string; name: string };
    document: {
      id: string;
      original_filename: string;
      sha256: string;
      document_type_hint: string | null;
      processing_status: string;
    };
    cuec: { id: string; ordinal: number; text: string; review_status: string };
    determination: {
      review_status: string;
      reason: string | null;
      decided_at: string | null;
      decided_by: { user_id: string; email: string | null; name: string | null } | null;
      basis: unknown;
    };
  } | null;
}

export async function getFindingVendorProvenance(
  token: string,
  findingId: string
): Promise<FindingVendorProvenance | null> {
  try {
    const res = await engineFetch(
      `/api/findings/${encodeURIComponent(findingId)}/vendor-provenance`,
      token
    );
    if (!res.ok) return null;
    return (await res.json()) as FindingVendorProvenance;
  } catch {
    return null;
  }
}

export async function getFindingRiskLinks(
  token: string,
  findingId: string
): Promise<FindingRiskLink[]> {
  try {
    const res = await engineFetch(`/api/findings/${findingId}/risk-links`, token);
    if (!res.ok) return [];
    const body = (await res.json()) as { links?: FindingRiskLink[] };
    return body.links ?? [];
  } catch {
    return [];
  }
}

/**
 * The findings that EVIDENCE this register entry.
 *
 * Distinct from findings raised FROM a risk (`source_type='risk'`), which the
 * risk page already shows. One is "this risk produced work"; this is "this is
 * why we believe the risk is real". Conflating them would let a register entry
 * look evidenced by findings it generated itself.
 */
export async function getRiskSupportingFindings(
  token: string,
  riskId: string
): Promise<RiskSupportingFinding[]> {
  try {
    const res = await engineFetch(`/api/risks/${riskId}/findings`, token);
    if (!res.ok) return [];
    const body = (await res.json()) as { findings?: RiskSupportingFinding[] };
    return body.findings ?? [];
  } catch {
    return [];
  }
}
