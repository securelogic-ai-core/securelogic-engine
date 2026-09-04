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
};

export type ScopeReason = {
  rule_id: string;
  rule_family: string;
  rationale: string;
};

/** `question_versions.evidence_policy` — what the QUESTION demands. */
export type EvidencePolicy = "none" | "optional" | "required_on_pass" | "required_always";

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
  /** WA-1 completeness contract, decided by the engine. */
  evidence_policy: EvidencePolicy;
  /** Artifacts already attached to THIS question. */
  evidence_count: number;
  /**
   * NULL until the question is answered — the requirement is a property of the
   * answer. Never recomputed here: the engine's submit gate and this flag come
   * from one module (src/api/lib/vendorPortal/responseCompleteness.ts), so the
   * prompt a vendor sees and the refusal they would hit cannot disagree.
   */
  explanation_required: boolean | null;
  evidence_required: boolean | null;
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
  /** WA-1: the rest of the `incomplete` refusal. Additive — see vendorPortal.ts. */
  explanations_missing?: number;
  evidence_missing?: number;
  items?: Array<{ requirement_id: string; reference: string; reason: string }>;
  items_truncated?: boolean;
};

/**
 * What a vendor must still do to one question before the questionnaire can be
 * submitted. Mirrors `IncompleteReason` in responseCompleteness.ts.
 */
export type IncompleteReason = "unanswered" | "explanation_missing" | "evidence_missing";

/** The prompt beside a question that needs words. Answer-specific on purpose. */
export const EXPLANATION_PROMPT: Record<string, string> = {
  partial: "Describe what is in place and what is not.",
  fail: "Explain why this is not in place, and any compensating control or plan.",
  not_applicable: "Explain why this does not apply to the service you provide.",
  pass: "Describe how this is implemented for the service you provide.",
};

/**
 * The ONE client-side mirror of the engine's explanation rule.
 *
 * `PortalQuestion.explanation_required` is authoritative, but it is computed
 * against the answer the engine has STORED. The questionnaire updates answers
 * optimistically, so between the click and the next read the stored answer and
 * the answer on screen differ — and a vendor who selects "Partially in place"
 * must be told an explanation is needed at that moment, not one fetch later.
 *
 * So this function exists, it is the only copy of the rule on this side of the
 * wire, and it mirrors `explanationRequired` in
 * src/api/lib/vendorPortal/responseCompleteness.ts. If that rule changes, this
 * changes with it — which is why the rule lives in one named function in each
 * process rather than inline in a component.
 */
export function explanationRequiredForAnswer(
  answer: string | null,
  policy: EvidencePolicy
): boolean {
  if (answer === null) return false;
  if (answer === "partial" || answer === "fail" || answer === "not_applicable") return true;
  return answer === "pass" && (policy === "required_on_pass" || policy === "required_always");
}

/**
 * The client-side view of the submit gate, for the pre-submit review screen.
 *
 * Uses the engine's `evidence_required` verbatim (nothing optimistic can change
 * it — attaching a file re-reads the list) and the mirror above for the
 * explanation, so the review list matches what Submit would refuse.
 */
export function questionBlocker(
  q: PortalQuestion,
  notes?: string | null
): IncompleteReason | null {
  const text = notes === undefined ? q.notes : notes;
  if (q.answer === null) return q.mandatory ? "unanswered" : null;
  if (explanationRequiredForAnswer(q.answer, q.evidence_policy) && !(text ?? "").trim()) {
    return "explanation_missing";
  }
  if (q.evidence_required && q.evidence_count <= 0) return "evidence_missing";
  return null;
}

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
