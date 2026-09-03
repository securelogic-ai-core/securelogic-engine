/**
 * opinionAcceptance.ts — the pure half of the governed auditor-opinion
 * ACCEPTANCE surface (VA-S4-P2, wiring-plan step 4b).
 *
 * Body validation and decision-basis construction. No DB I/O, no clock reads
 * beyond the caller-supplied timestamp, no organization_id ever read from a
 * body. The route half lives in routes/vendorAssuranceDocuments.ts.
 *
 * ── What this surface is for ────────────────────────────────────────────────
 *
 * 20261066 made an opinion without a human acceptor structurally impossible and
 * then shipped no way for a human to accept one. S4-P1 measured the result: no
 * row has ever reached the opinion hop, in any environment. This is the missing
 * writer, and it is deliberately the ONLY one.
 *
 * ── What accepting an opinion does NOT do ───────────────────────────────────
 *
 * Owner ruling, 2026-08-30, recorded here because the whole risk of this
 * surface is that it reads like more than it is:
 *
 *   Acceptance of the report-level opinion MUST NOT itself establish
 *   requirement coverage, reduce questionnaire depth, change residual risk,
 *   override a control exception, or override contradictory evidence.
 *
 * A report-level opinion is ONE veto among many (report/TSC scope, report
 * period, Type I vs Type II, tested-control result, exceptions, carve-outs,
 * contradictory evidence, open findings, mapping authority). Passing it is
 * necessary and nowhere near sufficient. `opinionCoverageGate` is advisory and
 * is reported as such; nothing in this module or its route computes coverage.
 *
 * ── Why the reviewer's note is conditionally required ───────────────────────
 *
 * Demanding prose on every acceptance produces "n/a". Demanding it exactly
 * where a human departs from a deterministic, explainable rule — or re-decides
 * something already governed — produces a defence. Same philosophy as
 * `gap_reason_required` in vendorAssuranceValidation.ts.
 */

import { sanitizeString } from "../sanitize.js";
import {
  ASSURANCE_OPINIONS,
  isAssuranceOpinion,
  opinionCoverageGate,
  type AssuranceOpinion,
  type OpinionProposal,
} from "./assuranceOpinion.js";

export type ValidationOk<T> = { input: T };
export type ValidationErr = { error: string; detail?: string };

export const MAX_OPINION_REVIEWER_NOTE = 2000;

/**
 * The verbatim source text is capped before it is snapshotted. It comes from a
 * model extraction of a customer-supplied PDF, so it is untrusted in length
 * even though it is trusted in role.
 */
export const MAX_OPINION_SOURCE_TEXT = 8000;

export type AcceptOpinionInput = {
  opinion: AssuranceOpinion;
  reviewer_note: string | null;
  /** Explicit re-decision of an already-accepted opinion. Never implicit. */
  supersede: boolean;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Validate the acceptance body.
 *
 * `candidate` is the normalizer's proposal for the CURRENT source text, passed
 * in by the route so this stays pure. It decides only whether a note is
 * required — it never decides the value, which is the human's.
 */
export function validateAcceptOpinionBody(
  body: unknown,
  candidate: AssuranceOpinion
): ValidationOk<AcceptOpinionInput> | ValidationErr {
  if (!isPlainObject(body)) return { error: "request_body_must_be_object" };

  const raw = body["opinion"];
  if (!isAssuranceOpinion(raw)) {
    return {
      error: "invalid_assurance_opinion",
      detail: `must be one of: ${ASSURANCE_OPINIONS.join(", ")}`,
    };
  }

  const supersedeRaw = body["supersede"];
  if (supersedeRaw !== undefined && typeof supersedeRaw !== "boolean") {
    return { error: "supersede_must_be_boolean" };
  }
  const supersede = supersedeRaw === true;

  const noteRaw = body["reviewer_note"];
  if (noteRaw !== undefined && noteRaw !== null && typeof noteRaw !== "string") {
    return { error: "reviewer_note_must_be_string" };
  }
  const note =
    typeof noteRaw === "string"
      ? sanitizeString(noteRaw, MAX_OPINION_REVIEWER_NOTE).trim()
      : "";

  // A human departing from the deterministic candidate must say why. The
  // normalizer is explainable and its reasoning is shown to the reviewer; an
  // unexplained override of it cannot be defended to an auditor later.
  if (raw !== candidate && note.length === 0) {
    return {
      error: "reviewer_note_required_for_override",
      detail:
        `The opinion normalizer proposed "${candidate}" from the report's own words. ` +
        `Accepting "${raw}" instead is a judgement about what the report says — ` +
        `state the basis for it so the determination can be defended later.`,
    };
  }

  // Re-deciding something already governed is always explained, even when the
  // new value happens to match the candidate.
  if (supersede && note.length === 0) {
    return {
      error: "reviewer_note_required_for_supersede",
      detail:
        "Replacing an accepted opinion is an explicit re-decision. Say what " +
        "changed, so the superseded determination remains explainable.",
    };
  }

  return { input: { opinion: raw, reviewer_note: note.length > 0 ? note : null, supersede } };
}

/** The acceptance being replaced, on an explicit re-decision. */
export type PriorAcceptance = {
  opinion: string;
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  reviewer_note: string | null;
};

export type OpinionBasisArgs = {
  acceptedAt: string;
  acceptedByUserId: string;
  accepted: AssuranceOpinion;
  proposal: OpinionProposal;
  /** Verbatim report text the proposal was computed from. */
  sourceText: string | null;
  /** Where that text came from: the extraction, or a reviewer field override. */
  sourceOrigin: "extraction" | "field_override" | "absent";
  extractionId: string | null;
  documentStatus: string;
  documentApprovedAt: string | null;
  documentApprovedByUserId: string | null;
  reviewerNote: string | null;
  priorAcceptance: PriorAcceptance | null;
};

/**
 * Build the decision-basis snapshot, BY VALUE.
 *
 * Everything an auditor needs to reconstruct the determination without
 * consulting a mutable extraction: what the report said, what the rule
 * proposed, whether the human agreed, what state the document was in, and what
 * this replaced. Recomputing any of it later would silently substitute today's
 * facts for the ones the reviewer actually saw — the same reason
 * `vendor_assurance_cuecs.gap_basis` is snapshotted rather than derived.
 *
 * `establishes_requirement_coverage: false` is recorded EXPLICITLY, in the row,
 * so that a future reader of this data cannot mistake an accepted opinion for a
 * coverage decision. It is not a comment; it is part of the record.
 */
export function buildOpinionAcceptanceBasis(args: OpinionBasisArgs): Record<string, unknown> {
  const agreed = args.accepted === args.proposal.candidate;
  return {
    basis_version: "opinion-acceptance-1.0",
    accepted_at: args.acceptedAt,
    accepted_by_user_id: args.acceptedByUserId,
    accepted_opinion: args.accepted,

    source: {
      origin: args.sourceOrigin,
      extraction_id: args.extractionId,
      // Verbatim, capped. The note column holds the same text; it is repeated
      // here so the basis is self-contained if the columns ever diverge.
      auditor_opinion_text:
        args.sourceText === null ? null : sanitizeString(args.sourceText, MAX_OPINION_SOURCE_TEXT),
    },

    proposal: {
      candidate: args.proposal.candidate,
      rule: args.proposal.rule,
      reason: args.proposal.reason,
      normalizer_version: args.proposal.normalizer_version,
    },

    // The single most useful field for a later reviewer: did a person accept
    // the machine's reading, or overrule it?
    human_agreed_with_candidate: agreed,
    reviewer_note: args.reviewerNote,

    document_state_at_acceptance: {
      processing_status: args.documentStatus,
      approved_at: args.documentApprovedAt,
      approved_by_user_id: args.documentApprovedByUserId,
    },

    // Advisory only. Recorded so the gate's reading at acceptance time is
    // preserved, NOT so anything can act on it.
    coverage_gate_at_acceptance: opinionCoverageGate(args.accepted),

    // Owner ruling, 2026-08-30. Part of the record, not a comment: accepting an
    // opinion is one veto passed, never coverage established.
    establishes_requirement_coverage: false,

    ...(args.priorAcceptance ? { supersedes: args.priorAcceptance } : {}),
  };
}
