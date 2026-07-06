/**
 * orchestrationPolicy.ts — ERIP Epic 6 (Autonomous Operations): the PURE
 * approval + state-machine policy (ERIP-AD-24/25/26). No I/O. The route composes
 * these guards; persistence lives in the route/executor.
 */

export type ProposalStatus = "proposed" | "approved" | "rejected" | "executed" | "failed";
export type ProposalType = "create_action";

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

export const PROPOSAL_TYPES: readonly ProposalType[] = ["create_action"];

export function isProposalType(v: unknown): v is ProposalType {
  return typeof v === "string" && (PROPOSAL_TYPES as readonly string[]).includes(v);
}

const PRIORITIES = new Set(["immediate", "near_term", "planned", "watch"]);

export interface CreateActionPayload {
  title: string;
  description: string | null;
  priority: string;
}

export type PayloadValidation =
  | { payload: CreateActionPayload }
  | { error: string; detail?: string };

/**
 * Validate a proposal's payload for its type. For `create_action`: a non-empty
 * title and a valid canonical priority; description optional.
 */
export function validateProposalPayload(type: ProposalType, raw: unknown): PayloadValidation {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "payload_must_be_object" };
  }
  const o = raw as Record<string, unknown>;
  if (type === "create_action") {
    const title = typeof o.title === "string" ? o.title.trim() : "";
    if (title.length === 0) return { error: "payload_invalid", detail: "title is required" };
    if (title.length > 200) return { error: "payload_invalid", detail: "title too long" };
    const priority = typeof o.priority === "string" ? o.priority : "";
    if (!PRIORITIES.has(priority)) return { error: "payload_invalid", detail: "priority must be a canonical value" };
    const description =
      o.description === undefined || o.description === null
        ? null
        : typeof o.description === "string"
          ? o.description.slice(0, 2000)
          : null;
    return { payload: { title, description, priority } };
  }
  return { error: "unknown_proposal_type" };
}
