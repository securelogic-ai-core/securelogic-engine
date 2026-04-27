/**
 * Server-side API client for the SecureLogic Engine.
 *
 * All functions run exclusively in Server Components and API Routes.
 * The engine URL and API key never reach the browser.
 */

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
  billingActive: boolean;
  lastUsedAt: string | null;
  apiKeyCreatedAt: string;
};

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
  };
  actions: {
    open: number;
    in_progress: number;
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
    open: number;
    by_risk_rating: {
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
};

export type VendorsResponse = {
  count: number;
  limit: number;
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
  severity: string;
  description: string;
  recommendation: string | null;
  framework_control_id: string | null;
  domain: string | null;
  priority: string | null;
  likelihood: string | null;
  confidence: string | null;
  time_sensitivity: string | null;
  scoring_rationale: string | null;
  status: string;
  owner_user_id: string | null;
  due_date: string | null;
  action_count: number;
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
};

export type ActionsResponse = {
  count: number;
  limit?: number;
  organizationId?: string;
  nextCursor?: { created_at: string; id: string } | null;
  actions: Action[];
};

export type ActionsParams = {
  status?: string;
  priority?: string;
  overdue?: boolean;
  limit?: number;
};

export type FindingsResponse = {
  count: number;
  limit: number;
  organizationId: string;
  nextCursor: { created_at: string; id: string } | null;
  findings: Finding[];
};

export type FindingsParams = {
  domain?: string;
  source_type?: string;
  status?: string;
  severity?: string;
  source_id?: string;
  priority?: string;
  limit?: number;
};

export type FindingsSummary = {
  open_count: number;
  critical_open: number;
  high_open: number;
  medium_open: number;
  low_open: number;
  closed_count: number;
  immediate_priority: number;
  vendor_sourced: number;
  signal_sourced: number;
};

export type Risk = {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  domain: string | null;
  likelihood: string | null;
  impact: string | null;
  risk_rating: string | null;
  status: string;
  treatment: string | null;
  owner: string | null;
  due_date: string | null;
  source_type: string | null;
  source_id: string | null;
  created_at: string;
  updated_at: string;
};

export type RiskIntelligence = {
  id: string;
  title: string;
  domain: string | null;
  risk_rating: string | null;
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
  by_domain: Record<string, number>;
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

export type AuthSignupResponse =
  | { ok: true; message: string }
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

async function engineFetch(
  path: string,
  token: string,
  options?: RequestInit
): Promise<Response> {
  // Supports both legacy API keys (sl_…) and JWT tokens (contains ".").
  // The engine's requireApiKey middleware accepts both via Authorization: Bearer.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
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

export async function getVendors(
  apiKey: string,
  status: "active" | "archived" = "active"
): Promise<VendorsResponse | null> {
  try {
    const res = await engineFetch(
      `/api/vendors?status=${status}&limit=100`,
      apiKey
    );
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
  apiKey: string
): Promise<AiSystemsResponse | null> {
  try {
    const res = await engineFetch("/api/ai-systems?limit=100", apiKey);
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

export type SelfAssessmentReadiness = {
  total: number;
  pass: number;
  partial: number;
  fail: number;
  not_assessed: number;
  readiness_score: number;
};

export type FrameworkDetail = {
  framework: Framework;
  assessment_readiness: {
    self: SelfAssessmentReadiness;
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
  apiKey: string
): Promise<ControlsResponse | null> {
  try {
    const res = await engineFetch("/api/controls?limit=100", apiKey);
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
  promoCode?: string
): Promise<AuthSignupResponse> {
  const res = await fetch(`${ENGINE_URL}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationName, name, email, password, promoCode }),
    cache: "no-store",
  });
  return res.json() as Promise<AuthSignupResponse>;
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

export async function authResendVerification(
  email: string
): Promise<{ ok: boolean }> {
  const res = await fetch(`${ENGINE_URL}/api/auth/resend-verification`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
    cache: "no-store",
  });
  if (!res.ok) return { ok: false };
  return { ok: true };
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
    qs.set("limit", String(params?.limit ?? 100));
    const res = await engineFetch(`/api/actions?${qs.toString()}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<ActionsResponse>;
  } catch {
    return null;
  }
}

export async function getRisks(
  apiKey: string,
  params?: { status?: string; domain?: string; limit?: number }
): Promise<RisksResponse | null> {
  try {
    const qs = new URLSearchParams();
    if (params?.status) qs.set("status", params.status);
    if (params?.domain) qs.set("domain", params.domain);
    qs.set("limit", String(params?.limit ?? 50));
    const res = await engineFetch(`/api/risks?${qs.toString()}`, apiKey);
    if (!res.ok) return null;
    return res.json() as Promise<RisksResponse>;
  } catch {
    return null;
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

export type AlertPreferences = {
  critical_finding_immediate: boolean;
  high_finding_immediate: boolean;
  daily_digest: boolean;
  weekly_summary: boolean;
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
    date_from?: string;
    date_to?: string;
  } = {}
): Promise<AuditLogResponse | null> {
  try {
    const qs = new URLSearchParams();
    if (params.page)       qs.set("page",       String(params.page));
    if (params.limit)      qs.set("limit",      String(params.limit));
    if (params.event_type) qs.set("event_type", params.event_type);
    if (params.user_id)    qs.set("user_id",    params.user_id);
    if (params.date_from)  qs.set("date_from",  params.date_from);
    if (params.date_to)    qs.set("date_to",    params.date_to);
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

export type AskResponse = {
  answer: string;
  context_used: {
    posture_score: number | null;
    findings_count: number;
    risks_count: number;
    vendors_count: number;
    as_of: string | null;
  };
  question: string;
};

export async function askQuestion(
  token: string,
  question: string
): Promise<AskResponse | null> {
  try {
    const res = await engineFetch("/api/ask", token, {
      method: "POST",
      body: JSON.stringify({ question }),
    });
    if (!res.ok) return null;
    return res.json() as Promise<AskResponse>;
  } catch {
    return null;
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
  response: RequirementResponse | null;
};

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
    readiness_score: number;
  };
};

export async function getFrameworkRequirements(
  apiKey: string,
  frameworkId: string,
  assessmentType: "self" | "vendor",
  subjectId: string
): Promise<FrameworkRequirements | null> {
  try {
    const params = new URLSearchParams({
      assessment_type: assessmentType,
      subject_id: subjectId,
    });
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

