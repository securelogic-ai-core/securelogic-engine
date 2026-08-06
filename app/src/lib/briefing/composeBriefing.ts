/**
 * composeBriefing.ts — the Briefing orchestration layer (B1).
 *
 * Pure reshaping of the dashboard page's EXISTING engine fetch results into
 * per-module view models. Modules never fetch their own data (lint-able
 * convention: module components accept props only); the page fetches each
 * endpoint once and this composer normalizes the union. No business query is
 * duplicated for the Briefing — every number here comes from the same
 * metric-contract endpoints the legacy dashboard reads
 * (GET /api/dashboard/summary, /api/findings/summary, /api/actions/summary).
 *
 * Honest-state rules (the dashboardState.ts discipline, generalized):
 *   - a FAILED fetch is null — an unknown, never a zero;
 *   - a zeros payload is a real "you're clear" and renders as one;
 *   - a personal count that is unknown never selects a personal presentation.
 */

import type {
  Action,
  ActionsSummary,
  BriefingChangesResponse,
  DashboardSummary,
  Finding,
  FindingsSummary,
} from "@/lib/api";
import { activeActionsCount } from "@/lib/actionsMetrics";
import { postureDelta, type PostureDelta, type PostureSnapshotLike } from "@/lib/postureTrend";

export type BriefingInputs = {
  summary: DashboardSummary | null;
  findingsSummary: FindingsSummary | null;
  actionsSummary: ActionsSummary | null;
  /** The since-last-visit delta (EG2 slice 10). Omitted/undefined = the page
   *  had no previous login to diff against (module hidden); null = the fetch
   *  FAILED (render an honest unavailable line, never zeros). */
  changes?: BriefingChangesResponse | null;
  /** ISO timestamp of the session user's previous login, when known. */
  previousLoginAt?: string | null;
  /** Posture snapshot history — feeds the 30-day delta on the score module. */
  postureSnapshots?: readonly PostureSnapshotLike[];
  /**
   * EX1 PR-2 (My Work top items). Active findings owned by the session user
   * (owner=me, resolved server-side from the session — never a client id).
   * undefined = not fetched (identity-less session / legacy path) → the row
   * is absent; null = the fetch FAILED → an explicit notice, never silence.
   */
  myFindings?: readonly Finding[] | null;
  /** Same contract for the user's assigned actions (owner=me). */
  myActions?: readonly Action[] | null;
  /** Render-time clock for overdue determination — injected for determinism. */
  now?: Date;
};

/** One ranked "next up" work item — a finding or action the user owns. */
export type MyWorkTopItem = {
  kind: "finding" | "action";
  id: string;
  title: string;
  /** WHY it ranks: the finding severity or action priority, display-ready. */
  urgency: string;
  /** 0 = Critical/Immediate … 3 = Low/Watch; drives the label's color tier. */
  urgencyRank: 0 | 1 | 2 | 3;
  overdue: boolean;
  /** ISO due date; null = none set. */
  dueDate: string | null;
  href: string;
};

const FINDING_URGENCY: Record<string, 0 | 1 | 2 | 3> = {
  Critical: 0,
  High: 1,
  Moderate: 2,
  Low: 3,
};
const ACTION_URGENCY: Record<string, 0 | 1 | 2 | 3> = {
  immediate: 0,
  near_term: 1,
  planned: 2,
  watch: 3,
};
const ACTION_URGENCY_LABEL: Record<string, string> = {
  immediate: "Immediate",
  near_term: "Near term",
  planned: "Planned",
  watch: "Watch",
};

/**
 * Deterministic ranking of the user's owned work. Ascending on the tuple
 * ⟨overdue-first, urgency (severity/priority mapped to one 0–3 scale),
 * earliest due date (none = last), kind (finding before action), id⟩ — the
 * final id key makes the order total, so identical inputs always produce an
 * identical list regardless of input order. Pure; `now` is injected.
 */
export function rankMyWorkItems(
  findings: readonly Finding[],
  actions: readonly Action[],
  now: Date,
  limit = 3,
): MyWorkTopItem[] {
  const nowMs = now.getTime();
  const items: Array<MyWorkTopItem & { dueMs: number }> = [];
  for (const f of findings) {
    const dueMs = f.due_date ? Date.parse(f.due_date) : Number.POSITIVE_INFINITY;
    items.push({
      kind: "finding",
      id: f.id,
      title: f.title,
      urgency: f.severity,
      urgencyRank: FINDING_URGENCY[f.severity] ?? 3,
      overdue: dueMs < nowMs,
      dueDate: f.due_date,
      href: `/findings/${f.id}`,
      dueMs,
    });
  }
  for (const a of actions) {
    const dueMs = a.due_date ? Date.parse(a.due_date) : Number.POSITIVE_INFINITY;
    items.push({
      kind: "action",
      id: a.id,
      title: a.title,
      urgency: ACTION_URGENCY_LABEL[a.priority] ?? a.priority,
      urgencyRank: ACTION_URGENCY[a.priority] ?? 3,
      overdue: dueMs < nowMs,
      dueDate: a.due_date,
      // No action detail route exists — the owner queue is the canonical
      // destination (same contract as the module's overdue callout).
      href: "/actions?view=mine",
      dueMs,
    });
  }
  items.sort((x, y) =>
    (x.overdue === y.overdue ? 0 : x.overdue ? -1 : 1) ||
    x.urgencyRank - y.urgencyRank ||
    x.dueMs - y.dueMs ||
    (x.kind === y.kind ? 0 : x.kind === "finding" ? -1 : 1) ||
    (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
  );
  return items.slice(0, limit).map(({ dueMs: _dueMs, ...item }) => item);
}

export type MyWorkModel = {
  /** Active findings owned by the signed-in user; null = summary unavailable. */
  findingsOpen: number | null;
  /** Active actions assigned to the signed-in user; null = summary unavailable. */
  actionsOpen: number | null;
  actionsOverdue: number | null;
  /** Every count known and zero — render the all-clear state. */
  allClear: boolean;
  /**
   * Ranked owned items (≤3). null = lists not fetched (identity-less session /
   * legacy path) — the NEXT UP row is absent; [] = fetched and empty — also
   * hidden; non-empty = rendered. Failure of a source is signaled separately.
   */
  topItems: MyWorkTopItem[] | null;
  /** true = the owner=me findings list fetch FAILED (explicit notice). */
  topItemsFindingsFailed: boolean;
  /** true = the owner=me actions list fetch FAILED (explicit notice). */
  topItemsActionsFailed: boolean;
};

export type MyPendingReviewsModel = {
  mine: number;
  /** Org-wide ready-to-close total, shown only as explicitly labeled context. */
  orgWide: number;
};

export type NeedsAttentionModel = { critical: number; high: number };

export type OverdueActionsModel = { active: number; overdue: number };

export type ReadyToCloseModel = { orgWide: number };

export type PostureScoreModel = {
  /** null = no snapshot yet — MUST render as "insufficient data", never 0. */
  score: number | null;
  severity: string | null;
  asOf: string | null;
  /** 30-day delta; null = insufficient history (rendered as nothing, never 0%). */
  delta30: PostureDelta | null;
};

export type WhatsChangedModel = {
  /** The window start actually used by the engine (clamped to its max). */
  since: string;
  clamped: boolean;
  /** false = the changes fetch failed — the module says so, never zeros. */
  loaded: boolean;
  newActiveFindings: number;
  newCriticalHigh: number;
  remediationCompleted: number;
  resolved: number;
  newlyOverdueActions: number;
  briefsPublished: number;
  /** Every count known and zero — the "quiet since your last visit" state. */
  allQuiet: boolean;
};

export type BriefingViewModel = {
  /**
   * false = the dashboard summary fetch FAILED: the organization zone renders
   * one explicit error panel instead of its modules (a load failure must be
   * distinguishable from an empty-but-healthy org).
   */
  orgLoaded: boolean;
  myWork: MyWorkModel;
  /** null = module hidden (no reviews assigned, or personal count unknown). */
  myPendingReviews: MyPendingReviewsModel | null;
  needsAttention: NeedsAttentionModel;
  overdueActions: OverdueActionsModel;
  /** null = module hidden (empty org-wide ready-to-close population). */
  readyToClose: ReadyToCloseModel | null;
  postureScore: PostureScoreModel;
  /** null = module hidden (no previous login to diff against). */
  whatsChanged: WhatsChangedModel | null;
};

export function composeBriefing(inputs: BriefingInputs): BriefingViewModel {
  const { summary, findingsSummary, actionsSummary } = inputs;

  const findingsOpen = findingsSummary?.my_work_open ?? null;
  const actionsOpen = actionsSummary?.my_open_count ?? null;
  const actionsOverdue = actionsSummary?.my_overdue_count ?? null;

  const mine = findingsSummary?.my_pending_reviews_open ?? null;
  const orgWideReady =
    summary?.findings?.pending_independent_review ??
    findingsSummary?.pending_independent_review_open ??
    0;

  const bySeverity = summary?.findings?.by_severity;
  const actions = summary?.actions;

  // Since-last-visit delta (EG2 slice 10). Hidden without a previous login;
  // a failed fetch keeps the module visible with an honest unavailable state
  // anchored to the login timestamp the page DOES know.
  const { changes, previousLoginAt } = inputs;
  let whatsChanged: WhatsChangedModel | null = null;
  if (previousLoginAt) {
    if (changes) {
      const c = changes.changes;
      whatsChanged = {
        since: changes.since,
        clamped: changes.clamped,
        loaded: true,
        newActiveFindings: c.new_active_findings,
        newCriticalHigh: c.new_critical_high,
        remediationCompleted: c.remediation_completed,
        resolved: c.resolved,
        newlyOverdueActions: c.newly_overdue_actions,
        briefsPublished: c.briefs_published,
        allQuiet:
          c.new_active_findings === 0 &&
          c.remediation_completed === 0 &&
          c.resolved === 0 &&
          c.newly_overdue_actions === 0 &&
          c.briefs_published === 0,
      };
    } else {
      whatsChanged = {
        since: previousLoginAt,
        clamped: false,
        loaded: false,
        newActiveFindings: 0,
        newCriticalHigh: 0,
        remediationCompleted: 0,
        resolved: 0,
        newlyOverdueActions: 0,
        briefsPublished: 0,
        allQuiet: false,
      };
    }
  }

  // EX1 PR-2: ranked owned work. undefined inputs = feature absent (legacy
  // path or identity-less session) → null; a null input = that fetch failed
  // (rank what DID load, flag the failure — null is never treated as empty).
  const { myFindings, myActions } = inputs;
  const topFetched = myFindings !== undefined || myActions !== undefined;
  const topItems = topFetched
    ? rankMyWorkItems(myFindings ?? [], myActions ?? [], inputs.now ?? new Date())
    : null;

  return {
    orgLoaded: summary !== null,
    myWork: {
      findingsOpen,
      actionsOpen,
      actionsOverdue,
      allClear:
        findingsOpen === 0 && actionsOpen === 0 && actionsOverdue === 0,
      topItems,
      topItemsFindingsFailed: myFindings === null,
      topItemsActionsFailed: myActions === null,
    },
    // Personal variant only on a KNOWN, non-zero personal count (the a817aa36
    // rule) — an unknown `mine` must never surface a personal module.
    myPendingReviews:
      mine !== null && mine > 0 ? { mine, orgWide: orgWideReady } : null,
    needsAttention: {
      critical: bySeverity?.Critical ?? 0,
      high: bySeverity?.High ?? 0,
    },
    overdueActions: {
      // The shared Metric Contract presentation fallback — same derivation as
      // the legacy ActionsRing / OpenItemsAging tiles (one definition).
      active: activeActionsCount(actions),
      overdue: actions?.overdue ?? 0,
    },
    readyToClose: orgWideReady > 0 ? { orgWide: orgWideReady } : null,
    postureScore: {
      score: summary?.posture?.overall_score ?? null,
      severity: summary?.posture?.overall_severity ?? null,
      asOf: summary?.posture?.snapshot_date ?? null,
      delta30: postureDelta(inputs.postureSnapshots ?? [], 30),
    },
    whatsChanged,
  };
}
