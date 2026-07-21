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
  ActionsSummary,
  DashboardSummary,
  FindingsSummary,
} from "@/lib/api";
import { activeActionsCount } from "@/lib/actionsMetrics";

export type BriefingInputs = {
  summary: DashboardSummary | null;
  findingsSummary: FindingsSummary | null;
  actionsSummary: ActionsSummary | null;
};

export type MyWorkModel = {
  /** Active findings owned by the signed-in user; null = summary unavailable. */
  findingsOpen: number | null;
  /** Active actions assigned to the signed-in user; null = summary unavailable. */
  actionsOpen: number | null;
  actionsOverdue: number | null;
  /** Every count known and zero — render the all-clear state. */
  allClear: boolean;
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

  return {
    orgLoaded: summary !== null,
    myWork: {
      findingsOpen,
      actionsOpen,
      actionsOverdue,
      allClear:
        findingsOpen === 0 && actionsOpen === 0 && actionsOverdue === 0,
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
    },
  };
}
