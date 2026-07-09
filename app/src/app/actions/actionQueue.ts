/**
 * actionQueue.ts — pure logic that turns a flat actions list into a remediation
 * work queue (ERIP §5 — My Actions depth). Dependency-free (no React) so it is
 * unit-testable without a DOM/RTL harness the app does not have. Mirrors
 * decisionQueue.ts so the remediation queue reads as the same system as Findings.
 *
 * Adds SLA framing, ownership visibility, and source-finding linkage (removing the
 * standalone-Actions dead-end the ERIP audit flagged). Uses existing Action fields
 * only — no engine change, no new data. Shown ONLY under
 * SECURELOGIC_DECISION_WORKSPACE_ENABLED; flag-off is the unchanged legacy list
 * (byte-identical). Rows link into the source Finding's Decision Workspace.
 */

import type { Action } from "@/lib/api";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Active = still needs remediation work (open / in progress / blocked). */
export function isActiveStatus(status: string): boolean {
  return status === "open" || status === "in_progress" || status === "blocked";
}

export type SlaState = "overdue" | "due_today" | "due_this_week" | "scheduled" | "none";

/** SLA state of an action from its due_date, relative to now (UTC-day boundaries). */
export function slaState(action: Pick<Action, "due_date" | "status">, nowMs: number): SlaState {
  if (!isActiveStatus(action.status)) return "none";
  if (!action.due_date) return "none";
  const t = Date.parse(action.due_date);
  if (!Number.isFinite(t)) return "none";
  const nowDay = Math.floor(nowMs / DAY_MS);
  const dueDay = Math.floor(t / DAY_MS);
  if (dueDay < nowDay) return "overdue";
  if (dueDay === nowDay) return "due_today";
  if (dueDay <= nowDay + 6) return "due_this_week";
  return "scheduled";
}

/** SLA is "at risk" when it is overdue or due within the week (needs attention now). */
export function isAtRisk(action: Pick<Action, "due_date" | "status">, nowMs: number): boolean {
  const s = slaState(action, nowMs);
  return s === "overdue" || s === "due_today" || s === "due_this_week";
}

/**
 * Deep-link an action to the source it remediates, so the remediation queue is not
 * a dead end. Finding-sourced actions open the Decision Workspace; risk/obligation
 * actions open their record. Returns null when there is nothing to link to.
 */
export function actionSourceHref(action: Pick<Action, "source_type" | "source_id">): string | null {
  if (!action.source_id) return null;
  switch (action.source_type) {
    case "finding":
      return `/findings/${action.source_id}`;
    case "risk":
      return `/risks/${action.source_id}`;
    case "obligation":
      return `/obligations/${action.source_id}`;
    default:
      return null;
  }
}

export type Ownership = "you" | "assigned" | "unassigned";

/**
 * Ownership relative to the signed-in user. `sessionUserId` MUST come from the
 * session, never request input (R5). Undefined identity never reads as "you".
 */
export function ownershipLabel(
  action: Pick<Action, "owner_user_id">,
  sessionUserId: string | undefined,
): Ownership {
  if (!action.owner_user_id) return "unassigned";
  if (sessionUserId && action.owner_user_id === sessionUserId) return "you";
  return "assigned";
}

export type ActionAttention = {
  open: number;
  overdue: number;
  atRisk: number;
  unassigned: number;
};

/**
 * Counts for the remediation attention tiles. Categories are INDEPENDENT (an action
 * can be both overdue and unassigned), unlike the exclusive SLA grouping below.
 */
export function actionAttention(actions: Action[], nowMs: number): ActionAttention {
  let open = 0;
  let overdue = 0;
  let atRisk = 0;
  let unassigned = 0;
  for (const a of actions) {
    if (!isActiveStatus(a.status)) continue;
    open++;
    const s = slaState(a, nowMs);
    if (s === "overdue") overdue++;
    if (s === "overdue" || s === "due_today" || s === "due_this_week") atRisk++;
    if (!a.owner_user_id) unassigned++;
  }
  return { open, overdue, atRisk, unassigned };
}

export type ActionBucket = SlaState | "resolved";

/** Most-urgent-first ordering for the grouped remediation queue. */
export const ACTION_BUCKET_ORDER: readonly ActionBucket[] = [
  "overdue",
  "due_today",
  "due_this_week",
  "scheduled",
  "none",
  "resolved",
];

export const ACTION_BUCKET_LABELS: Record<ActionBucket, string> = {
  overdue: "Overdue",
  due_today: "Due today",
  due_this_week: "Due this week",
  scheduled: "Scheduled",
  none: "No SLA set",
  resolved: "Resolved / closed",
};

/** The one bucket an action belongs to: resolved when done, else its SLA state. */
export function actionBucket(action: Action, nowMs: number): ActionBucket {
  if (!isActiveStatus(action.status)) return "resolved";
  return slaState(action, nowMs);
}

/**
 * Group actions into remediation buckets, most-urgent-first, dropping empty
 * buckets. Within a bucket, actions keep their incoming (server) order.
 */
export function groupBySla(
  actions: Action[],
  nowMs: number,
): Array<{ bucket: ActionBucket; label: string; actions: Action[] }> {
  const map = new Map<ActionBucket, Action[]>();
  for (const a of actions) {
    const b = actionBucket(a, nowMs);
    (map.get(b) ?? map.set(b, []).get(b)!).push(a);
  }
  return ACTION_BUCKET_ORDER.filter((b) => (map.get(b)?.length ?? 0) > 0).map((b) => ({
    bucket: b,
    label: ACTION_BUCKET_LABELS[b],
    actions: map.get(b)!,
  }));
}
