/**
 * orchestrationPolicy.ts — ERIP Epic 6 (Autonomous Operations): the PURE
 * approval + state-machine policy (ERIP-AD-24/25/26). No I/O. The route composes
 * these guards; persistence lives in the route/executor.
 */

export type ProposalStatus = "proposed" | "approved" | "rejected" | "executed" | "failed";
export type ProposalType =
  | "create_action"
  | "servicenow_incident"
  | "jira_issue"
  | "teams_message"
  | "slack_message"
  | "send_email"
  | "evidence_request"
  | "escalate";

/** Forward-only transitions (ERIP-AD-26). No backward edges. */
const ALLOWED: Record<ProposalStatus, ProposalStatus[]> = {
  proposed: ["approved", "rejected"],
  approved: ["executed", "failed"],
  rejected: [],
  executed: [],
  failed: []
};

export function canTransition(from: ProposalStatus, to: ProposalStatus): boolean {
  return ALLOWED[from].includes(to);
}

/**
 * Separation of duties (ERIP-AD-25): the approver must be a DIFFERENT identified
 * human from the proposer. A missing approver or a self-approval is refused.
 */
export function approvalAllowed(
  proposedByUserId: string | null,
  approverUserId: string | null
): { ok: true } | { ok: false; error: string } {
  if (!approverUserId) return { ok: false, error: "approver_required" };
  if (proposedByUserId && proposedByUserId === approverUserId) {
    return { ok: false, error: "separation_of_duties" };
  }
  return { ok: true };
}

export const PROPOSAL_TYPES: readonly ProposalType[] = [
  "create_action",
  "servicenow_incident",
  "jira_issue",
  "teams_message",
  "slack_message",
  "send_email",
  "evidence_request",
  "escalate"
];

export function isProposalType(v: unknown): v is ProposalType {
  return typeof v === "string" && (PROPOSAL_TYPES as readonly string[]).includes(v);
}

const PRIORITIES = new Set(["immediate", "near_term", "planned", "watch"]);

/** A validated proposal payload (normalized, executor-agnostic). */
export type ValidatedPayload = Record<string, string>;

export type PayloadValidation =
  | { payload: ValidatedPayload }
  | { error: string; detail?: string };

function str(o: Record<string, unknown>, key: string): string {
  return typeof o[key] === "string" ? (o[key] as string).trim() : "";
}

/**
 * Validate a proposal's payload for its type. Every type needs a non-empty
 * `title`; `description` is optional (bounded). Type-specific extras:
 *   create_action / evidence_request → a canonical `priority`.
 *   send_email                       → a `to` address containing '@'.
 * The returned payload is normalized (trimmed, bounded) and executor-ready.
 */
export function validateProposalPayload(type: ProposalType, raw: unknown): PayloadValidation {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "payload_must_be_object" };
  }
  const o = raw as Record<string, unknown>;
  const title = str(o, "title");
  if (title.length === 0) return { error: "payload_invalid", detail: "title is required" };
  if (title.length > 200) return { error: "payload_invalid", detail: "title too long" };

  const out: ValidatedPayload = { title };
  const description = str(o, "description");
  if (description) out.description = description.slice(0, 2000);

  if (type === "create_action" || type === "evidence_request") {
    const priority = str(o, "priority") || "near_term";
    if (!PRIORITIES.has(priority)) return { error: "payload_invalid", detail: "priority must be a canonical value" };
    out.priority = priority;
  }
  if (type === "send_email") {
    const to = str(o, "to");
    if (!to.includes("@")) return { error: "payload_invalid", detail: "to must be an email address" };
    out.to = to;
  }
  if (type === "servicenow_incident") {
    const urgency = str(o, "urgency");
    if (urgency) out.urgency = urgency.slice(0, 8);
  }
  if (type === "jira_issue") {
    const issueType = str(o, "issue_type");
    if (issueType) out.issue_type = issueType.slice(0, 40);
  }
  return { payload: out };
}
