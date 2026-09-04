/**
 * responseCompleteness.ts — what makes a questionnaire answer COMPLETE
 * (WA-1, owner ruling 3, 2026-09-04).
 *
 * ── The gap this closes ──────────────────────────────────────────────────────
 *
 * Measured on the owner's own walkthrough engagement before this shipped:
 * 37 questions, 37 answered, 5 `partial`, 3 `fail`, 1 `not_applicable` — and
 * ZERO explanations on any of them. A `partial` with no words is not an
 * assessable answer: the reviewer cannot tell what is partial, the finding it
 * promotes is unactionable, and the control-effectiveness ladder scores it
 * anyway. `not_applicable` is the highest-leverage answer a vendor can give —
 * it removes a control from assurance entirely — and it was the least gated.
 *
 * ── PURE. No I/O, no DB, no clock ────────────────────────────────────────────
 *
 * The same reasoning criticality.ts and portalTokens.ts state: the rule that
 * decides whether an assessment may be submitted must be exhaustively testable
 * without a database, and must produce identical results for the engine's
 * submit guard and the read surface the vendor's UI renders from. One module,
 * two callers, no second opinion.
 *
 * ── Why the rule is ANSWER-DRIVEN, not question-driven ───────────────────────
 *
 * The obvious implementation is a per-question `explanation_policy` column on
 * `question_versions`. It is the wrong instrument, for a reason worth writing
 * down so nobody adds it later:
 *
 *   - "explain a partial / a failure / a non-applicability" is a property of
 *     the ANSWER, not of the question. It is true of every question ever asked,
 *     so encoding it per-question stores the same value 16+ times per tenant
 *     and invites a curator to switch it off on the questions that matter most.
 *   - `question_versions.content_hash` covers the content contract
 *     (questionContent.ts). Adding a field to that contract rehashes and
 *     REPUBLISHES every bridge question as version N+1 on the next composition,
 *     for a value that is constant. Churn with no information.
 *
 * The one genuinely per-question case — "an affirmative answer needs more" —
 * is already expressible and already stored: `question_versions.evidence_policy`
 * (20261059). It has been written since VA-Q1 P1 and read by NOTHING. This
 * module is its first consumer, which is why every bridged question's current
 * value (`optional`) makes the affirmative case a no-op today and correct the
 * moment a curated question sets `required_on_pass`.
 *
 * ── Enforced at SUBMIT, never at SAVE ────────────────────────────────────────
 *
 * A vendor must be able to click "Partially in place" and then type why. Making
 * the save conditional would either reject the click or force the prose first,
 * and both are worse products than a submit-time gate that names every item.
 * `savePortalAnswer` therefore stays permissive; `submitPortalResponses` is the
 * gate. That also keeps API compatibility: no existing stored row becomes
 * invalid, and no CHECK constraint can refuse to build against the estate.
 */

/** The structured answer vocabulary. Mirrors PORTAL_ANSWERS in vendorPortal.ts. */
export const RESPONSE_ANSWERS = ["pass", "partial", "fail", "not_applicable"] as const;
export type ResponseAnswer = (typeof RESPONSE_ANSWERS)[number];

/** `question_versions.evidence_policy` (20261059). */
export const EVIDENCE_POLICIES = ["none", "optional", "required_on_pass", "required_always"] as const;
export type EvidencePolicy = (typeof EVIDENCE_POLICIES)[number];

/** The policy a pre-P2 row (no question version) is read as. */
export const DEFAULT_EVIDENCE_POLICY: EvidencePolicy = "optional";

export function isResponseAnswer(v: unknown): v is ResponseAnswer {
  return typeof v === "string" && (RESPONSE_ANSWERS as readonly string[]).includes(v);
}

export function asEvidencePolicy(v: unknown): EvidencePolicy {
  return typeof v === "string" && (EVIDENCE_POLICIES as readonly string[]).includes(v)
    ? (v as EvidencePolicy)
    : DEFAULT_EVIDENCE_POLICY;
}

/**
 * Does this answer require the vendor to say something?
 *
 * Owner ruling 3, in full:
 *   partial          -> required   (a gap nobody described is not a gap anybody can fix)
 *   fail             -> required   (the Finding it promotes carries this text)
 *   not_applicable   -> required   (it removes a control from assurance)
 *   pass             -> optional, UNLESS the question's evidence policy asks for more
 *
 * The `pass` clause is the "unless methodology/evidence policy requires more"
 * half of the ruling: where an affirmative answer must be evidenced, it must
 * also be explained — an artifact with no statement of what it proves puts the
 * reviewer back to guessing.
 */
export function explanationRequired(answer: ResponseAnswer, policy: EvidencePolicy): boolean {
  if (answer === "partial" || answer === "fail" || answer === "not_applicable") return true;
  return policy === "required_on_pass" || policy === "required_always";
}

/**
 * Does this answer require an attached artifact?
 *
 * Only the question's own policy can demand this — never the answer alone.
 * `not_applicable` is exempt from `required_always` on purpose: demanding proof
 * of a control the vendor has justified as inapplicable asks for a document
 * that cannot exist, and would push honest vendors toward answering `fail`.
 *
 * Every question in the library today is `optional` (the bridge default), so
 * this returns false everywhere until a curated question says otherwise. That
 * is deliberate: the contract is wired now, the behaviour changes only when
 * content changes.
 */
export function evidenceRequired(answer: ResponseAnswer, policy: EvidencePolicy): boolean {
  if (answer === "not_applicable") return false;
  if (policy === "required_always") return true;
  return policy === "required_on_pass" && answer === "pass";
}

/** Is there anything in the explanation the vendor gave? */
export function hasExplanation(notes: string | null | undefined): boolean {
  return typeof notes === "string" && notes.trim().length > 0;
}

// ── The submit gate ─────────────────────────────────────────────────────────

/** Why one item is not ready to submit. Ordered by how the vendor should fix it. */
export type IncompleteReason = "unanswered" | "explanation_missing" | "evidence_missing";

export type CompletenessItem = {
  requirement_id: string;
  reference: string;
  mandatory: boolean;
  answer: string | null;
  notes: string | null;
  evidence_policy: EvidencePolicy;
  evidence_count: number;
};

export type IncompleteItem = {
  requirement_id: string;
  reference: string;
  reason: IncompleteReason;
};

/**
 * Every item standing between the vendor and a submission.
 *
 * TWO different rules, deliberately not merged:
 *
 *   - UNANSWERED blocks only when the item is MANDATORY. That is the shipped
 *     `all_mandatory_answered` guard and it is not widened here: an optional
 *     question a vendor chose to skip is a choice, not an omission.
 *
 *   - A MISSING EXPLANATION blocks on ANY answered item, mandatory or not.
 *     An optional control answered `fail` still promotes to a Finding with the
 *     same severity machinery; letting the explanation requirement depend on
 *     the item's mandatory flag would make the least-supervised answers the
 *     least explained.
 *
 * Returned in the caller's order so the vendor's list matches their screen.
 */
export function incompleteItems(items: readonly CompletenessItem[]): IncompleteItem[] {
  const out: IncompleteItem[] = [];
  for (const item of items) {
    if (!isResponseAnswer(item.answer)) {
      if (item.mandatory) {
        out.push({ requirement_id: item.requirement_id, reference: item.reference, reason: "unanswered" });
      }
      continue;
    }
    const answer = item.answer;
    if (explanationRequired(answer, item.evidence_policy) && !hasExplanation(item.notes)) {
      out.push({
        requirement_id: item.requirement_id,
        reference: item.reference,
        reason: "explanation_missing",
      });
      continue;
    }
    if (evidenceRequired(answer, item.evidence_policy) && item.evidence_count <= 0) {
      out.push({
        requirement_id: item.requirement_id,
        reference: item.reference,
        reason: "evidence_missing",
      });
    }
  }
  return out;
}

/**
 * The vendor-facing sentence for one unmet requirement.
 *
 * Kept beside the rule rather than in the UI so the engine's refusal and the
 * portal's inline prompt cannot drift into saying different things about the
 * same item.
 */
export const EXPLANATION_PROMPT: Record<ResponseAnswer, string> = {
  partial: "Describe what is in place and what is not.",
  fail: "Explain why this is not in place, and any compensating control or plan.",
  not_applicable: "Explain why this does not apply to the service you provide.",
  pass: "Describe how this is implemented for the service you provide.",
};

/** Summary counts for the refusal body and the review screen. */
export function summarizeIncomplete(incomplete: readonly IncompleteItem[]): {
  unanswered_required: number;
  explanations_missing: number;
  evidence_missing: number;
} {
  return {
    unanswered_required: incomplete.filter((i) => i.reason === "unanswered").length,
    explanations_missing: incomplete.filter((i) => i.reason === "explanation_missing").length,
    evidence_missing: incomplete.filter((i) => i.reason === "evidence_missing").length,
  };
}
