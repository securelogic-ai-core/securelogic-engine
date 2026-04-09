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
  id?: string;
  signalId?: string;
  signal_id?: string;
  title: string;
  category: string;
  riskLevel: string;
  risk_level?: string;
  analysis?: string;
  summary?: string;
  whyItMatters?: string;
  recommendedAction?: string;
  recommendation?: string;
  riskRationale?: string;
  priorityScore?: number;
  priorityTier?: string;
  source?: string;
  sourceUrl?: string;
  source_url?: string;
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

export type BillingCheckoutResponse = { checkoutUrl: string };
export type BillingPortalResponse   = { portalUrl: string };

// =========================================================
// HELPERS
// =========================================================

async function engineFetch(
  path: string,
  apiKey: string,
  options?: RequestInit
): Promise<Response> {
  return fetch(`${ENGINE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
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
  tier: "professional" | "team"
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
