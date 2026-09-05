/**
 * attentionSignals.ts — what makes an engagement need an ANALYST'S attention
 * (WA-4, owner ruling 5, 2026-09-05).
 *
 * ── The distinction this module exists to hold ───────────────────────────────
 *
 * Two things look alike and must never be merged:
 *
 *   NEEDS ATTENTION is DERIVED. It is a pure function of canonical assessment
 *   truth — the responses the vendor gave, the evidence nobody has checked,
 *   the findings already raised. It is never stored, never edited, and never
 *   "cleared". It stops being true when the underlying truth changes, and not
 *   before. There is deliberately no `needs_attention` column anywhere in this
 *   package: a mutable triage flag is a second copy of the truth that drifts
 *   from the first, and the first is the one the methodology defends.
 *
 *   DISPOSITION is PERSISTED. It is what a named human decided to do about
 *   that state, attributed and timestamped, in `vendor_engagement_dispositions`
 *   (20261093). It is append-only, so recording a new decision never erases the
 *   previous one.
 *
 * A disposition NEVER rewrites the derivation. An engagement with five `fail`
 * answers that an analyst marked `accepted` still HAS five `fail` answers, and
 * this module still says so. What the disposition changes is whether the queue
 * shows it as awaiting a human — which is the actual question a portfolio view
 * is asked.
 *
 * ── Needs attention is TRIAGE, never a Finding ───────────────────────────────
 *
 * Nothing here creates, proposes or promotes a Finding. A `fail` answer is a
 * reason to LOOK, not a governance artifact. Finding creation stays exactly
 * where it is: the explicit, analyst-invoked
 * `POST /api/vendor-engagements/:id/promote-findings`. `finding_proposed` and
 * `finding_confirmed` exist in the disposition vocabulary as records of a human
 * decision — nothing reads them to create anything, the same discipline WA-2's
 * applicability challenges established.
 *
 * ── PURE. No I/O, no DB, no clock ────────────────────────────────────────────
 *
 * Same reasoning as responseCompleteness.ts, which this module deliberately
 * DEFERS to rather than re-deciding: `explanationRequired` and `hasExplanation`
 * are imported, not re-implemented. The vendor's submit gate and the analyst's
 * attention queue must agree about what an unexplained answer is, or one of
 * them is lying.
 *
 * ── One honest compromise, stated rather than hidden ─────────────────────────
 *
 * `deriveAttention` below is the REFERENCE implementation and the vocabulary
 * authority. The engagement LIST endpoint cannot call it per row: filtering and
 * sorting by attention have to happen in the database or pagination stops being
 * correct (a post-hoc filter returns fewer rows than the caller's limit and the
 * offset means nothing). So `listEngagements` computes the same counts in SQL.
 *
 * That is two implementations of one rule, which this codebase otherwise
 * forbids. It is made safe the only way it can be: `attentionSqlEquivalence`
 * in the isolation suite runs both over the same fixture engagements and fails
 * the build on any disagreement. If you change a predicate here, that test
 * tells you the SQL is now wrong — it does not let the two drift quietly.
 */

import {
  explanationRequired,
  hasExplanation,
  isResponseAnswer,
  asEvidencePolicy,
  type EvidencePolicy,
} from "../vendorPortal/responseCompleteness.js";
import type { EngagementState } from "./engagementStateMachine.js";

/* ────────────────────────────────────────────────────────────────────────────
   The attention window
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The states in which an analyst owns the work and can act on what they see.
 *
 * Narrow on purpose. Before `submitted` the vendor is still answering, so every
 * unanswered item would read as a defect rather than as work in progress. After
 * `decided` the engagement has its own signals — `review_overdue` and
 * `reassessment_recommended_at`, both already computed and already rendered —
 * and re-flagging a decided engagement forever because it once had a `fail`
 * would make the badge meaningless within a quarter.
 *
 * `clarification_requested` IS in the window: the analyst asked the question,
 * and it is their queue item until the vendor answers.
 */
export const ATTENTION_WINDOW_STATES: readonly EngagementState[] = [
  "submitted",
  "in_review",
  "clarification_requested",
  "analysis_complete",
  "decision_pending",
] as const;

export function inAttentionWindow(state: string): boolean {
  return (ATTENTION_WINDOW_STATES as readonly string[]).includes(state);
}

/* ────────────────────────────────────────────────────────────────────────────
   The reason vocabulary
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Ordered by what an analyst should look at first, not alphabetically. The
 * order is load-bearing: it is the order reasons render in, and the first
 * reason present is the one the row leads with.
 */
export const ATTENTION_REASONS = [
  "control_not_in_place",
  "partial_response",
  "explanation_missing",
  "unanswered_mandatory",
  "evidence_unreviewed",
  "active_finding",
] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

export function isAttentionReason(v: unknown): v is AttentionReason {
  return typeof v === "string" && (ATTENTION_REASONS as readonly string[]).includes(v);
}

/**
 * The analyst-facing sentence for each reason.
 *
 * Plain English about the assessment, never a rule identifier — a badge that
 * says `S1.floor` or `attention.rule.3` tells the reader nothing and leaks
 * internal vocabulary into a customer surface. Kept beside the rule so the API
 * and the UI cannot describe the same signal differently.
 */
export const ATTENTION_REASON_LABELS: Record<AttentionReason, string> = {
  control_not_in_place: "Control reported not in place",
  partial_response: "Control only partially in place",
  explanation_missing: "Answer given without the required explanation",
  unanswered_mandatory: "Required question left unanswered",
  evidence_unreviewed: "Evidence attached but not yet reviewed",
  active_finding: "Active finding from this assessment",
};

/** The longer form, for a tooltip or a detail panel. */
export const ATTENTION_REASON_DETAIL: Record<AttentionReason, string> = {
  control_not_in_place:
    "The vendor reported that one or more controls in scope are not in place. Review what they said and decide whether it warrants a finding.",
  partial_response:
    "The vendor reported one or more controls as only partially in place. Partial is not a pass — read the explanation and decide.",
  explanation_missing:
    "One or more answers require an explanation and do not have one. An unexplained partial, failure or non-applicability cannot be assessed.",
  unanswered_mandatory:
    "One or more required questions have no answer. Assessments submitted before the completeness gate shipped can carry these.",
  evidence_unreviewed:
    "The vendor attached evidence that nobody has confirmed. Until it is reviewed, the control stays at the documented rung rather than evidenced.",
  active_finding:
    "This assessment already produced findings that are not closed. They belong to the remediation lifecycle, not to this queue.",
};

/* ────────────────────────────────────────────────────────────────────────────
   Derivation
   ──────────────────────────────────────────────────────────────────────────── */

/** One scope item and whatever the vendor said about it. */
export type AttentionItem = {
  requirement_id: string;
  mandatory: boolean;
  answer: string | null;
  notes: string | null;
  evidence_policy?: EvidencePolicy | string | null;
};

/** Everything about the engagement that is not per-item. */
export type AttentionContext = {
  status: string;
  /** Engagement evidence rows with no `reviewed_at`. */
  unreviewed_evidence_count: number;
  /** Findings sourced from this engagement that are not closed (sqlFindingActive). */
  active_finding_count: number;
};

export type AttentionCounts = Record<AttentionReason, number>;

export type AttentionState = {
  needs_attention: boolean;
  /** Present reasons, in ATTENTION_REASONS order. */
  reasons: AttentionReason[];
  counts: AttentionCounts;
  /**
   * A stable fingerprint of the derived state. A disposition stores the digest
   * it was recorded against, so "this decision was made about a different
   * assessment than the one you are looking at" is answerable without
   * snapshotting the assessment.
   */
  digest: string;
};

export function emptyCounts(): AttentionCounts {
  return {
    control_not_in_place: 0,
    partial_response: 0,
    explanation_missing: 0,
    unanswered_mandatory: 0,
    evidence_unreviewed: 0,
    active_finding: 0,
  };
}

/**
 * The reference derivation.
 *
 * Note what it does NOT do: it does not treat `not_applicable` as attention on
 * its own. A justified non-applicability is an answer, and WA-1 already forces
 * it to carry an explanation — so an unexplained one surfaces here as
 * `explanation_missing`, which is the honest reason, while an explained one is
 * a decision the vendor made and the analyst can read. Flagging every N/A would
 * make the highest-integrity answer look like a defect.
 */
export function deriveAttention(
  items: readonly AttentionItem[],
  context: AttentionContext
): AttentionState {
  const counts = emptyCounts();

  if (!inAttentionWindow(context.status)) {
    return { needs_attention: false, reasons: [], counts, digest: digestOf(counts) };
  }

  for (const item of items) {
    if (!isResponseAnswer(item.answer)) {
      if (item.mandatory) counts.unanswered_mandatory += 1;
      continue;
    }
    const answer = item.answer;
    const policy = asEvidencePolicy(item.evidence_policy ?? undefined);

    if (answer === "fail") counts.control_not_in_place += 1;
    else if (answer === "partial") counts.partial_response += 1;

    // Deferred to responseCompleteness, never re-decided here.
    if (explanationRequired(answer, policy) && !hasExplanation(item.notes)) {
      counts.explanation_missing += 1;
    }
  }

  counts.evidence_unreviewed = Math.max(0, context.unreviewed_evidence_count | 0);
  counts.active_finding = Math.max(0, context.active_finding_count | 0);

  const reasons = ATTENTION_REASONS.filter((r) => counts[r] > 0);
  return {
    needs_attention: reasons.length > 0,
    reasons: [...reasons],
    counts,
    digest: digestOf(counts),
  };
}

/**
 * The fingerprint: reason:count pairs in vocabulary order, present reasons only.
 *
 * Deliberately NOT a hash. It is short, it is readable in a log and in a
 * database row, and a human comparing two dispositions can see what moved.
 * Empty state digests as `none` rather than as an empty string, so a stored
 * digest is never mistaken for a missing one.
 */
export function digestOf(counts: AttentionCounts): string {
  const parts = ATTENTION_REASONS.filter((r) => counts[r] > 0).map((r) => `${r}:${counts[r]}`);
  return parts.length === 0 ? "none" : parts.join("|");
}

/* ────────────────────────────────────────────────────────────────────────────
   Human disposition
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * What a human decided. Ordered from lightest to heaviest commitment.
 *
 * `finding_proposed` and `finding_confirmed` record a DECISION ABOUT a finding.
 * They do not create one, and no code reads them to create one. The governed
 * path to a Finding remains `POST /vendor-engagements/:id/promote-findings`,
 * invoked explicitly by an analyst.
 */
export const DISPOSITIONS = [
  "reviewed",
  "accepted",
  "escalated",
  "finding_proposed",
  "finding_confirmed",
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export function isDisposition(v: unknown): v is Disposition {
  return typeof v === "string" && (DISPOSITIONS as readonly string[]).includes(v);
}

export const DISPOSITION_LABELS: Record<Disposition, string> = {
  reviewed: "Reviewed",
  accepted: "Accepted as-is",
  escalated: "Escalated",
  finding_proposed: "Finding proposed",
  finding_confirmed: "Finding confirmed",
};

/**
 * Dispositions that assert a judgement rather than merely acknowledging one.
 * These require a rationale — the same bar the inherent-risk override, the WA-2
 * applicability challenge and the WA-3 reseed all set: a governance act carries
 * its reason or it does not happen.
 */
export const DISPOSITIONS_REQUIRING_RATIONALE: readonly Disposition[] = [
  "accepted",
  "escalated",
  "finding_proposed",
  "finding_confirmed",
] as const;

export const RATIONALE_MIN = 10;
export const RATIONALE_MAX = 4000;

export function rationaleRequired(d: Disposition): boolean {
  return DISPOSITIONS_REQUIRING_RATIONALE.includes(d);
}

/**
 * Is a stored disposition still about the assessment in front of the reader?
 *
 * A disposition recorded when three controls failed does not speak for an
 * assessment that now has five. Rather than silently invalidating it — which
 * would throw away a real human decision — the surface says the state moved and
 * lets the analyst decide whether to record a new one.
 */
export function dispositionStale(storedDigest: string | null, currentDigest: string): boolean {
  if (storedDigest === null) return false;
  return storedDigest !== currentDigest;
}
