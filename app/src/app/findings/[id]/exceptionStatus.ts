/**
 * exceptionStatus.ts — the truthful summary of a finding under a risk exception.
 *
 * WHY THIS IS A SEPARATE, PURE MODULE. Before SL-EXC-1 the platform could say
 * only "overdue" or "closed" about a finding, so recording an exception closed
 * it — asserting that remediation was DONE at the exact moment someone said
 * they could not finish in time. This view model exists to say the true thing
 * instead, which takes several facts at once and none of them may be dropped:
 *
 *   the finding is OPEN · the original due date was X · the SLA was missed ·
 *   the exposure is AUTHORISED until Y · remediation is OUTSTANDING
 *
 * "Overdue" and "overdue with an approved exception" are different operational
 * states and a customer must be able to tell them apart at a glance. Equally,
 * an approved exception must never render as remediated, closed, or SLA
 * compliant — the exception authorises the delay, it does not satisfy the
 * requirement.
 *
 * Pure and dependency-free so the wording rules are unit-testable without a DOM.
 */

export type ExceptionState =
  | "none"
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "withdrawn";

/** What the SLA is doing, taking any exception into account but never hidden by it. */
export type SlaPosture =
  | "no_due_date"
  | "within_sla"
  | "overdue_no_exception"
  | "overdue_exception_approved"
  | "overdue_exception_pending"
  | "overdue_exception_expired";

export interface ExceptionInput {
  state: string;
  kind?: string | null;
  expires_at?: string | null;
  compensating_control?: string | null;
  sla_due_date_at_request?: string | null;
  rationale?: string | null;
}

export interface ExceptionSummary {
  exceptionState: ExceptionState;
  slaPosture: SlaPosture;
  /** The ORIGINAL remediation date. Never replaced by the exception's expiry. */
  originalDueDate: string | null;
  /** When the authorisation runs out. A different fact from the line above. */
  exceptionExpiresAt: string | null;
  compensatingControl: string | null;
  /** True whenever the finding is not closed — an exception never makes it false. */
  remediationOutstanding: boolean;
}

/** Exceptions only. An acceptance is a different decision and is not summarised here. */
function liveException(exceptions: ExceptionInput[]): ExceptionInput | null {
  const isException = (e: ExceptionInput) => (e.kind ?? "acceptance") === "exception";
  // Precedence is deliberate: an approved exception is the operative fact; a
  // pending one is the next most useful; a terminal one only matters when
  // nothing live exists.
  return (
    exceptions.find((e) => isException(e) && e.state === "approved") ??
    exceptions.find((e) => isException(e) && e.state === "proposed") ??
    exceptions.find((e) => isException(e) && ["expired", "rejected", "withdrawn"].includes(e.state)) ??
    null
  );
}

function isPast(date: string | null | undefined, now: Date): boolean {
  if (!date) return false;
  const d = Date.parse(date);
  return Number.isFinite(d) && d < Date.parse(now.toISOString().slice(0, 10));
}

export function summariseException(
  finding: { due_date?: string | null; operational_status?: string | null },
  exceptions: ExceptionInput[],
  now: Date = new Date()
): ExceptionSummary {
  const live = liveException(exceptions);

  let exceptionState: ExceptionState = "none";
  if (live) {
    if (live.state === "approved") {
      // An approved exception past its date is EXPIRED, whatever the stored
      // state says. The date test lives here for the same reason it lives in
      // the SQL predicate: a customer's posture must not depend on whether the
      // expiry sweep ran this morning.
      exceptionState = isPast(live.expires_at, now) ? "expired" : "approved";
    } else if (live.state === "proposed") exceptionState = "pending";
    else if (live.state === "rejected") exceptionState = "rejected";
    else if (live.state === "expired") exceptionState = "expired";
    else if (live.state === "withdrawn") exceptionState = "withdrawn";
  }

  const originalDueDate = finding.due_date ?? live?.sla_due_date_at_request ?? null;
  const overdue = isPast(originalDueDate, now);

  let slaPosture: SlaPosture;
  if (!originalDueDate) slaPosture = "no_due_date";
  else if (!overdue) slaPosture = "within_sla";
  else if (exceptionState === "approved") slaPosture = "overdue_exception_approved";
  else if (exceptionState === "pending") slaPosture = "overdue_exception_pending";
  else if (exceptionState === "expired") slaPosture = "overdue_exception_expired";
  else slaPosture = "overdue_no_exception";

  return {
    exceptionState,
    slaPosture,
    originalDueDate,
    exceptionExpiresAt: live?.expires_at ?? null,
    compensatingControl: live?.compensating_control ?? null,
    // The assertion the package exists for: an exception never satisfies the
    // remediation requirement, so the work stays outstanding until the finding
    // is genuinely closed.
    remediationOutstanding: (finding.operational_status ?? "open") !== "closed",
  };
}

/** Customer-facing wording. Never says "remediated", "closed" or "compliant" for an exception. */
export const SLA_POSTURE_LABEL: Record<SlaPosture, string> = {
  no_due_date: "No remediation due date",
  within_sla: "Within SLA",
  overdue_no_exception: "Overdue — no exception",
  overdue_exception_approved: "Overdue — exception approved",
  overdue_exception_pending: "Overdue — exception requested",
  overdue_exception_expired: "Overdue — exception expired",
};

export const EXCEPTION_STATE_LABEL: Record<ExceptionState, string> = {
  none: "None",
  pending: "Requested",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  withdrawn: "Withdrawn",
};
