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

export type RegisterResponse =
  | { ok: true; apiKey: string; organizationId: string; entitlementLevel: string; note: string }
  | { error: string };

export type DomainScore = {
  domain: string;
  score: number | null;
  severity: string | null;
  finding_count: number;
  action_count: number;
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
  };
  actions: {
    open: number;
    overdue: number;
  };
  inventory: {
    vendors: number;
    ai_systems: number;
    controls: number;
    control_assessments: number;
    governance_reviews: number;
  };
};

export type Vendor = {
  id: string;
  organization_id: string;
  name: string;
  service_description: string | null;
  category: string | null;
  criticality: "critical" | "high" | "medium" | "low" | null;
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

export type Control = {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  owner_user_id: string | null;
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

export type BillingCheckoutResponse = { checkoutUrl: string };
export type BillingPortalResponse   = { portalUrl: string };

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
        organizationId: string;
        organizationName: string;
        entitlementLevel: string;
      };
    }
  | { error: string };

export type AuthMeResponse = {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  organizationName: string;
  entitlementLevel: string;
  billingActive: boolean;
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
  return fetch(`${ENGINE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
    cache: "no-store",
  });
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
  tier: "professional" | "teams" | "team"
): Promise<BillingCheckoutResponse | null> {
  try {
    const res = await engineFetch("/api/billing/checkout", apiKey, {
      method: "POST",
      body: JSON.stringify({ tier }),
    });
    if (!res.ok) return null;
    return res.json() as Promise<BillingCheckoutResponse>;
  } catch {
    return null;
  }
}

export async function createPortalSession(
  apiKey: string
): Promise<BillingPortalResponse | null> {
  try {
    const res = await engineFetch("/api/billing/portal", apiKey, { method: "POST" });
    if (!res.ok) return null;
    return res.json() as Promise<BillingPortalResponse>;
  } catch {
    return null;
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

export async function registerOrg(
  name: string,
  email: string
): Promise<RegisterResponse> {
  const res = await fetch(`${ENGINE_URL}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email }),
    cache: "no-store",
  });
  return res.json() as Promise<RegisterResponse>;
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
