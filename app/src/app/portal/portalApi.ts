/**
 * portalApi.ts — client-side contract for the external vendor portal.
 *
 * Every call goes to the SAME-ORIGIN proxy (/api/vendor-portal/...), so the
 * browser attaches the httpOnly portal cookie automatically (its path is
 * /api/vendor-portal — it is never sent to page routes, which is why all data
 * fetching on this surface is client-side). The invite token is exchanged once
 * by the accept page and never persisted anywhere client-side.
 *
 * Types mirror src/api/routes/vendorPortal.ts response shapes exactly.
 */

// ── Response shapes (engine contract) ───────────────────────────────────────

export type PortalEngagement = {
  organization_name: string;
  vendor_name: string;
  title: string | null;
  status: string;
  due_date: string | null;
  /** True while answers may still be edited (issued / in_progress). */
  accepting_responses: boolean;
  /**
   * VA-P1. Whether THIS participant may submit. Only the main contact can —
   * submitting freezes the questionnaire for everybody. Undefined on an engine
   * that predates VA-P1, which the review screen treats as permitted.
   */
  can_submit?: boolean;
  participant_role?: "coordinator" | "contributor" | null;
};

export type ScopeReason = {
  rule_id: string;
  rule_family: string;
  rationale: string;
};

export type PortalQuestion = {
  requirement_id: string;
  reference: string;
  title: string;
  guidance: string | null;
  depth: string;
  mandatory: boolean;
  /** The rule trace: why this control applies to this vendor. */
  why_we_are_asking: ScopeReason[] | null;
  answer: string | null;
  notes: string | null;
  /**
   * VA-P1 collaboration. `answered_at` doubles as the optimistic-concurrency
   * token: send it back as `prev_answered_at` and a save whose stored value has
   * moved on since is refused with 412 instead of quietly replacing a
   * colleague's work.
   */
  answered_at: string | null;
  answered_by_name: string | null;
  answered_by_you: boolean;
};

/** VA-P1 — a teammate at the same supplier, on the same engagement. */
export type PortalParticipant = {
  id: string;
  full_name: string;
  email: string;
  title: string | null;
  participant_role: "coordinator" | "contributor";
  status: "invited" | "active" | "revoked";
  first_accepted_at: string | null;
  last_accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  is_you: boolean;
  invited_by_teammate: boolean;
  has_live_invite: boolean;
  invite_expires_at: string | null;
};

export type PortalParticipants = {
  participants: PortalParticipant[];
  you: { participant_id: string | null; can_manage_team: boolean };
};

export type PortalEvidenceFile = {
  id: string;
  title: string;
  filename: string;
  byte_size: number;
  requirement_id: string | null;
  requirement_reference: string | null;
  uploaded_at: string;
};

export type PortalMessage = {
  id: string;
  from: "you" | "reviewer";
  author_name: string | null;
  body: string;
  requirement_id: string | null;
  requirement_reference: string | null;
  sent_at: string;
};

export type PortalErrorBody = {
  error?: string;
  message?: string;
  detail?: string;
  allowed?: string[];
  unanswered_required?: number;
};

// ── Vocabulary (labels only — wire values are the engine's, verbatim) ───────

/** The structured answer vocabulary the effectiveness ladder consumes. */
export const ANSWER_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: "pass", label: "In place", hint: "This control is fully implemented." },
  { value: "partial", label: "Partially in place", hint: "Implemented with gaps or exceptions." },
  { value: "fail", label: "Not in place", hint: "This control is not implemented." },
  { value: "not_applicable", label: "Not applicable", hint: "This control does not apply to the service provided." },
];

export function answerLabel(value: string | null): string {
  if (!value) return "Not answered";
  return ANSWER_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/** Vendor-facing names for engagement workflow states. */
export function statusLabel(status: string): string {
  switch (status) {
    case "issued":
    case "in_progress":
      return "In progress";
    case "submitted":
      return "Submitted";
    case "in_review":
      return "Under review";
    case "clarification_requested":
      return "Clarification requested";
    case "analysis_complete":
    case "decision_pending":
    case "decided":
    case "monitoring":
      return "Review complete";
    case "closed":
      return "Closed";
    case "cancelled":
      return "Withdrawn";
    case "expired":
      return "Expired";
    default:
      return status;
  }
}

export function depthLabel(depth: string): string {
  switch (depth) {
    case "full":
      return "Evidence requested";
    case "confirm":
      return "Confirmation";
    case "attest":
      return "Attestation";
    default:
      return depth;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Fetch helper ────────────────────────────────────────────────────────────

export type PortalResult<T> = {
  status: number;
  ok: boolean;
  body: (T & PortalErrorBody) | null;
};

/**
 * Same-origin fetch to the portal proxy. Never throws on HTTP errors — every
 * screen decides from `status` (401 → session required; 409/422/… → the
 * engine's own message). Throws only on network failure, which callers catch
 * into their error state.
 */
export async function portalFetch<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit
): Promise<PortalResult<T>> {
  const res = await fetch(`/api/vendor-portal${path}`, {
    cache: "no-store",
    ...init,
  });
  let body: (T & PortalErrorBody) | null = null;
  try {
    body = (await res.json()) as T & PortalErrorBody;
  } catch {
    body = null;
  }
  return { status: res.status, ok: res.ok, body };
}

/** The engine's message for a failed call, with a safe fallback. */
export function errorMessage(result: PortalResult<unknown>, fallback: string): string {
  return result.body?.message ?? result.body?.detail ?? fallback;
}
