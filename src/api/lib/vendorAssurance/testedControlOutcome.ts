/**
 * testedControlOutcome.ts — VA-S4-4C-3. The three-layer outcome model.
 *
 * 4C-2 answered WHICH canonical control a vendor's tested control IS. This
 * answers WHAT THE REPORT SAID ABOUT IT, WHAT SECURELOGIC GOVERNS AS A RESULT,
 * and WHAT ANY EXCEPTION ACTUALLY MEANS — as three separate things, because
 * collapsing them is how an assurance platform starts lying.
 *
 * ── Layer 1. AUDITOR ASSERTION. What the source says. ──────────────────────
 *
 * A normalization of the auditor's own words about one tested control. It
 * describes the SOURCE's assertion and MUST NOT itself assert SecureLogic-
 * governed effectiveness. The auditor's verbatim result is preserved beside it,
 * always, so the normalized value can be argued back to the report.
 *
 * EXCEPTION AND DEVIATION ARE REPORT TERMINOLOGY, NOT SEVERITY. Owner ruling.
 * `EXCEPTION_NOTED` and `DEVIATION_NOTED` are two words auditors use for the
 * same class of finding, and nothing here — no ordering, no comparison, no
 * ranking function — may be read as one being worse than the other. They are
 * kept distinct ONLY so the source's own word survives normalization.
 *
 * Layer 1 is MACHINE-PRODUCED and carries no human authority. That is
 * deliberate: it is a reading of the source, not a decision about the vendor. A
 * reviewer who disagrees with it says so in Layer 2, where authority lives, with
 * a note. Giving Layer 1 its own acceptance surface would create a second place
 * where a human appears to settle effectiveness, which is exactly what the
 * layering exists to prevent.
 *
 * ── Layer 2. GOVERNED EFFECTIVENESS. What SecureLogic says. ────────────────
 *
 * EFFECTIVE / INEFFECTIVE / INDETERMINATE. Owner ruling: there is deliberately
 * NO `EFFECTIVE_WITH_EXCEPTION`. Layer 2 is ORTHOGONAL to exception state, so a
 * record may legitimately be `EFFECTIVE` while an exception is separately
 * PRESENT, and the two facts are read together rather than fused into a value
 * that hides one of them.
 *
 * FAIL CLOSED IS STRUCTURAL, NOT POLICY. There is no function in this file that
 * turns a Layer-1 assertion into a Layer-2 effectiveness. `suggestEffectiveness`
 * returns a candidate ONLY for the assertions whose governed reading is
 * unambiguous, and returns `null` — meaning "a person must decide" — for every
 * other case including every case this file has never seen. An unknown outcome
 * therefore cannot become EFFECTIVE by default, by coercion, or by omission:
 * the absence of a Layer-2 record is the absence of effectiveness, never
 * effectiveness itself.
 *
 * ── Layer 3. EXCEPTION EFFECT. What an exception actually means. ───────────
 *
 * A separate authority at a separate grain, many-to-many with tested controls
 * where the source supports it. The vocabulary is TWO values, both witnessed in
 * the corpus, and it is deliberately NOT a severity taxonomy:
 *
 *   control_deficiency — the exception describes the control failing to operate
 *                        or to be designed as intended.
 *   scope_limitation   — the exception describes assurance not being OBTAINABLE.
 *                        The control is not thereby deficient. Owner ruling: a
 *                        scope limitation must not be represented as a control
 *                        deficiency merely because it limits assurance.
 *
 * NULL means no human has interpreted it yet, and NULL is not "fine".
 */

import { sanitizeString } from "../sanitize.js";

/* =========================================================================
   LAYER 1 — the auditor assertion vocabulary.
   ========================================================================= */

/**
 * The auditor/source assertion about ONE tested control.
 *
 * Every value except `NOT_STATED` has at least one witness among the 25
 * distinct `controls[].result` strings measured in the corpus on 2026-08-31.
 * `NOT_STATED` has none — no observed control carries a null result — but it is
 * structurally REACHABLE, because the extraction contract declares
 * `result: string|null` and an absent result must be representable as absent
 * rather than coerced into a reading. This is the distinction that the CUEC
 * `review_status` value `'accepted'` got wrong: that value no writer could ever
 * produce. This one a writer can.
 *
 * ORDER IN THIS ARRAY CARRIES NO MEANING. It is not a severity ladder and must
 * never be indexed into as one.
 */
export const AUDITOR_ASSERTIONS = [
  "NO_EXCEPTION_NOTED",
  "EXCEPTION_NOTED",
  "DEVIATION_NOTED",
  "NOT_EFFECTIVE_STATED",
  "NOT_TESTED",
  "NOT_APPLICABLE",
  "INCONCLUSIVE",
  "DESIGN_ONLY",
  "NOT_STATED",
] as const;
export type AuditorAssertion = (typeof AUDITOR_ASSERTIONS)[number];

export function isAuditorAssertion(v: unknown): v is AuditorAssertion {
  return typeof v === "string" && (AUDITOR_ASSERTIONS as readonly string[]).includes(v);
}

/**
 * Bumped whenever the rules below change. Recorded on every materialized
 * assertion so a past reading can be argued against the rules that produced it
 * rather than against today's.
 */
export const ASSERTION_NORMALIZER_VERSION = "tested-control-assertion-1.0";

export type AssertionProposal = {
  candidate: AuditorAssertion;
  /** Why, in words a reviewer can check against the verbatim result. */
  reason: string;
  /** Which rule fired, for the audit trail. */
  rule: string;
  normalizer_version: string;
};

type Rule = [RegExp, string];

/**
 * NEGATIVE-FIRST. "No exceptions noted" contains "exception"; every naive
 * exception matcher gets this backwards, and it is the single most common
 * string in the corpus. The negations are therefore tested before anything
 * else that mentions an exception or a deviation.
 */
const CLEAN_RULES: readonly Rule[] = [
  [/\bno\s+exceptions?\s+(?:were\s+)?noted\b/i, "the auditor states no exception was noted"],
  [/\bno\s+deviations?\s+(?:were\s+)?noted\b/i, "the auditor states no deviation was noted"],
  [/\bno\s+exceptions?\s+(?:were\s+)?identified\b/i, "the auditor states no exception was identified"],
  [/\bwithout\s+exception\b/i, "the auditor states the control operated without exception"],
];

/**
 * NOT APPLICABLE before NOT TESTED: "not applicable" reports frequently go on
 * to explain that the control was consequently not tested, and applicability is
 * the stronger statement.
 */
const NOT_APPLICABLE_RULES: readonly Rule[] = [
  [/\bnot\s+applicable\b/i, "the auditor states the control is not applicable"],
  [/\bn\/a\b/i, "the auditor marks the control not applicable"],
];

/**
 * DESIGN ONLY before NOT TESTED, and this ordering is load-bearing. The corpus
 * string is "The control was suitably designed as of 31 December 2025.
 * Operating effectiveness was not tested." — it contains a not-tested clause,
 * but the assertion the auditor is making is a Type I design opinion, which is
 * a materially different thing from having skipped the control.
 */
const DESIGN_ONLY_RULES: readonly Rule[] = [
  [/\bsuitably\s+designed\b/i, "the auditor asserts suitable design"],
  [/\bdesign\s+only\b/i, "the auditor asserts design only"],
  [/\bdesign\s+(?:was\s+)?(?:tested|evaluated)\b.*\boperating\s+effectiveness\s+was\s+not\b/i,
    "the auditor tested design but not operating effectiveness"],
];

/**
 * INCONCLUSIVE before NOT_TESTED. "Test results were inconclusive" means the
 * auditor DID test and could not conclude, which is not the same claim as not
 * having tested — and the two carry different governed reasons downstream.
 */
const INCONCLUSIVE_RULES: readonly Rule[] = [
  [/\binconclusive\b/i, "the auditor states the test results were inconclusive"],
  [/\bunable\s+to\s+(?:conclude|determine|form\s+a\s+conclusion)\b/i, "the auditor was unable to conclude"],
];

const NOT_TESTED_RULES: readonly Rule[] = [
  [/\bnot\s+tested\b/i, "the auditor states the control was not tested"],
  [/\bwas\s+not\s+(?:tested|examined|evaluated)\b/i, "the auditor states the control was not tested"],
  [/\bunable\s+to\s+test\b/i, "the auditor states they were unable to test the control"],
  [/\bdid\s+not\s+test\b/i, "the auditor states they did not test the control"],
  [/\bnot\s+within\s+the\s+scope\b/i, "the auditor states the control was outside the examination scope"],
  [/\bcarved\s+out\b/i, "the auditor states the control is carved out"],
];

/**
 * An explicit statement that the control did not operate. This is the auditor
 * asserting failure directly rather than noting an exception against it, and it
 * is kept separate for exactly that reason.
 */
const NOT_EFFECTIVE_RULES: readonly Rule[] = [
  [/\bdid\s+not\s+operate\s+effectively\b/i, "the auditor states the control did not operate effectively"],
  [/\bwas\s+not\s+operating\s+effectively\b/i, "the auditor states the control was not operating effectively"],
  [/\bwas\s+not\s+suitably\s+designed\b/i, "the auditor states the control was not suitably designed"],
  [/\bcontrol\s+failure\b/i, "the auditor states a control failure"],
];

/**
 * TERMINOLOGY, NOT SEVERITY. These two tables exist to preserve which WORD the
 * auditor used. Nothing may read the split as a ranking.
 */
const EXCEPTION_RULES: readonly Rule[] = [
  [/\bexceptions?\s+(?:were\s+|was\s+)?noted\b/i, "the auditor notes an exception"],
  [/\bexceptions?\s+(?:were\s+|was\s+)?identified\b/i, "the auditor identifies an exception"],
  [/\bthe\s+following\s+exceptions?\b/i, "the auditor lists exceptions"],
];

const DEVIATION_RULES: readonly Rule[] = [
  [/\bdeviations?\s+(?:were\s+|was\s+)?noted\b/i, "the auditor notes a deviation"],
  [/\bdeviations?\s+(?:were\s+|was\s+)?identified\b/i, "the auditor identifies a deviation"],
];

function firstMatch(text: string, rules: readonly Rule[]): { reason: string; rule: string } | null {
  for (const [re, reason] of rules) {
    if (re.test(text)) return { reason, rule: re.source };
  }
  return null;
}

/**
 * Propose the auditor's assertion for one tested control's verbatim result.
 * Deterministic, pure, explainable.
 *
 * PRECEDENCE, and the reason for each step:
 *   1. absent          → NOT_STATED. Absence is never a reading.
 *   2. clean negations → NO_EXCEPTION_NOTED. Tested FIRST because "no
 *                        exceptions noted" contains "exception".
 *   3. not applicable  → applicability outranks the not-tested clause that
 *                        usually follows it.
 *   4. design only     → a Type I design opinion is not a skipped control, even
 *                        though it says "not tested" in the same breath.
 *   5. inconclusive    → tested but unable to conclude ≠ not tested.
 *   6. not tested      → including carve-outs and out-of-scope categories.
 *   7. not effective   → an explicit statement of failure.
 *   8. exception       → the auditor's own word.
 *   9. deviation       → the auditor's own word.
 *  10. anything else   → NOT_STATED with rule `unrecognised`. NEVER
 *                        NO_EXCEPTION_NOTED: an unreadable result must not
 *                        become a clean one, which is the whole failure mode
 *                        this precedence exists to prevent.
 */
export function proposeAuditorAssertion(resultText: string | null | undefined): AssertionProposal {
  const base = { normalizer_version: ASSERTION_NORMALIZER_VERSION };
  const t = (resultText ?? "").trim();

  if (t === "") {
    return { ...base, candidate: "NOT_STATED", rule: "empty", reason: "the report states no result for this control" };
  }

  const clean = firstMatch(t, CLEAN_RULES);
  if (clean) return { ...base, candidate: "NO_EXCEPTION_NOTED", ...clean };

  const na = firstMatch(t, NOT_APPLICABLE_RULES);
  if (na) return { ...base, candidate: "NOT_APPLICABLE", ...na };

  const design = firstMatch(t, DESIGN_ONLY_RULES);
  if (design) return { ...base, candidate: "DESIGN_ONLY", ...design };

  const inconclusive = firstMatch(t, INCONCLUSIVE_RULES);
  if (inconclusive) return { ...base, candidate: "INCONCLUSIVE", ...inconclusive };

  const notTested = firstMatch(t, NOT_TESTED_RULES);
  if (notTested) return { ...base, candidate: "NOT_TESTED", ...notTested };

  const notEffective = firstMatch(t, NOT_EFFECTIVE_RULES);
  if (notEffective) return { ...base, candidate: "NOT_EFFECTIVE_STATED", ...notEffective };

  const exception = firstMatch(t, EXCEPTION_RULES);
  if (exception) return { ...base, candidate: "EXCEPTION_NOTED", ...exception };

  const deviation = firstMatch(t, DEVIATION_RULES);
  if (deviation) return { ...base, candidate: "DEVIATION_NOTED", ...deviation };

  return {
    ...base,
    candidate: "NOT_STATED",
    rule: "unrecognised",
    reason: "the result text matched no known pattern and must be read by a person",
  };
}

/* =========================================================================
   LAYER 2 — governed effectiveness.
   ========================================================================= */

export const GOVERNED_EFFECTIVENESS = ["EFFECTIVE", "INEFFECTIVE", "INDETERMINATE"] as const;
export type GovernedEffectiveness = (typeof GOVERNED_EFFECTIVENESS)[number];

export function isGovernedEffectiveness(v: unknown): v is GovernedEffectiveness {
  return typeof v === "string" && (GOVERNED_EFFECTIVENESS as readonly string[]).includes(v);
}

/**
 * Why effectiveness could not be established. Required on INDETERMINATE and
 * forbidden otherwise: "we could not establish this" without a reason is
 * indistinguishable from nobody having looked.
 *
 * Four values, each drawn from a distinct region of the observed semantic
 * space. There is deliberately no `other`: an outcome that fits none of these
 * is an outcome this vocabulary does not yet describe, and the correct response
 * is to leave it unaccepted and visible rather than to absorb it into a
 * catch-all that makes the gap unmeasurable.
 */
export const INDETERMINATE_REASONS = [
  "not_tested",
  "not_applicable",
  "scope_limited",
  "design_only",
] as const;
export type IndeterminateReason = (typeof INDETERMINATE_REASONS)[number];

export function isIndeterminateReason(v: unknown): v is IndeterminateReason {
  return typeof v === "string" && (INDETERMINATE_REASONS as readonly string[]).includes(v);
}

/** accept = a governed effectiveness now stands. reject = none does. */
export const EFFECTIVENESS_DECISIONS = ["accepted", "rejected"] as const;
export type EffectivenessDecision = (typeof EFFECTIVENESS_DECISIONS)[number];

export type EffectivenessSuggestion = {
  /**
   * NULL means THIS FUNCTION HAS NO GOVERNED READING and a person must decide.
   * It is not a soft "probably effective". Every caller must treat null as
   * refusal, and the acceptance surface refuses to default to anything.
   */
  candidate: GovernedEffectiveness | null;
  indeterminate_reason: IndeterminateReason | null;
  reason: string;
  /**
   * Always true. A field rather than a comment, so a caller that wants to act
   * on this unattended has to actively ignore something that exists to be read.
   */
  requires_human: true;
  normalizer_version: string;
};

/**
 * The ONLY Layer-1 → Layer-2 bridge in the system, and it is advisory.
 *
 * WHAT IT DELIBERATELY REFUSES TO DO. It never proposes `EFFECTIVE`. Not for
 * `NO_EXCEPTION_NOTED`, which is the one case where proposing it would look
 * obviously right — because "the auditor noted no exception against this
 * control" is a statement about ONE report's testing, and governed
 * effectiveness is a statement SecureLogic makes on its own authority, against
 * everything it knows: the report's scope and period, Type I versus Type II,
 * carve-outs, contradictory evidence, and open findings. A machine that can
 * promote a clean line to EFFECTIVE will eventually promote a clean line that
 * should not have been, silently, and nobody will be able to say when.
 *
 * So the only candidates it will offer are ones that REDUCE what is claimed:
 * INDETERMINATE, with the reason the source itself gave. Everything else
 * returns null and waits for a person.
 *
 * ASSERTIONS DESCRIBING A FINDING GET NO CANDIDATE EITHER. `EXCEPTION_NOTED`,
 * `DEVIATION_NOTED` and `NOT_EFFECTIVE_STATED` are not automatically
 * INEFFECTIVE: whether a noted exception makes the control ineffective is a
 * governed judgement about relevance and materiality, and Layer 3 exists
 * precisely because that judgement is separate. Auto-proposing INEFFECTIVE
 * would prejudge it in the other direction.
 */
export function suggestEffectiveness(assertion: AuditorAssertion): EffectivenessSuggestion {
  const base = { requires_human: true as const, normalizer_version: ASSERTION_NORMALIZER_VERSION };
  switch (assertion) {
    case "NOT_TESTED":
      return { ...base, candidate: "INDETERMINATE", indeterminate_reason: "not_tested",
        reason: "the report states the control was not tested, so this report establishes nothing about it" };
    case "NOT_APPLICABLE":
      return { ...base, candidate: "INDETERMINATE", indeterminate_reason: "not_applicable",
        reason: "the report states the control is not applicable to the service organization" };
    case "DESIGN_ONLY":
      return { ...base, candidate: "INDETERMINATE", indeterminate_reason: "design_only",
        reason: "the report opines on design only; operating effectiveness was not tested" };
    case "INCONCLUSIVE":
      return { ...base, candidate: "INDETERMINATE", indeterminate_reason: "scope_limited",
        reason: "the auditor tested but could not conclude, so assurance is limited" };
    case "NO_EXCEPTION_NOTED":
      return { ...base, candidate: null, indeterminate_reason: null,
        reason: "a clean test result is necessary but not sufficient for governed effectiveness; a person must weigh scope, period and contradictory evidence" };
    case "EXCEPTION_NOTED":
    case "DEVIATION_NOTED":
    case "NOT_EFFECTIVE_STATED":
      return { ...base, candidate: null, indeterminate_reason: null,
        reason: "the report describes a finding against this control; whether it makes the control ineffective is a governed judgement, not a lookup" };
    case "NOT_STATED":
      return { ...base, candidate: null, indeterminate_reason: null,
        reason: "the report states nothing usable about this control; nothing may be inferred from silence" };
    default:
      // Unreachable while the union is exhaustive. Present so that ADDING an
      // assertion value without revisiting this function fails CLOSED — the new
      // value gets no candidate — rather than falling through to a default that
      // claims something.
      return { ...base, candidate: null, indeterminate_reason: null,
        reason: "this assertion has no governed reading; a person must decide" };
  }
}

/* =========================================================================
   LAYER 3 — exception effect.
   ========================================================================= */

/**
 * The smallest vocabulary the investigation supports. TWO values, both
 * witnessed in the corpus on 2026-08-31:
 *
 *   control_deficiency — e.g. "3 of 25 access requests lacked documented
 *                        manager approval"; "the control did not operate
 *                        effectively".
 *   scope_limitation   — e.g. "Scope limitation applied. Sufficient appropriate
 *                        evidence was not available"; "records prior to
 *                        1 June 2025 were not available for inspection".
 *
 * NOT A SEVERITY TAXONOMY, and no third value is invented for convenience. A
 * scope limitation is not a lesser deficiency; it is a different KIND of
 * statement, and conflating them is the specific error the owner ruled against.
 */
export const EXCEPTION_EFFECTS = ["control_deficiency", "scope_limitation"] as const;
export type ExceptionEffect = (typeof EXCEPTION_EFFECTS)[number];

export function isExceptionEffect(v: unknown): v is ExceptionEffect {
  return typeof v === "string" && (EXCEPTION_EFFECTS as readonly string[]).includes(v);
}

/**
 * How an exception came to be linked to a tested control. Recorded on EVERY
 * link, because owner ruling 4 forbids any heuristic that SILENTLY attaches an
 * exception to a control.
 *
 *   extraction_control_refs — the corrected contract's `control_refs` array.
 *                             Authoritative: the model was asked for exactly
 *                             this and answered it.
 *   legacy_control_id       — the pre-v3 scalar `control_id`. Retained so
 *                             historical extractions stay readable. When that
 *                             scalar packed several identifiers into one string
 *                             ("CC6.1, CC6.2, CC6.3"), the raw string is kept
 *                             verbatim in `source_value` so the split is
 *                             inspectable rather than assumed.
 *   human                   — a person made the link.
 *
 * There is no `index_alignment`, and there never will be. The value it would
 * have named is the defect this package removes.
 */
export const EXCEPTION_LINK_SOURCES = ["extraction_control_refs", "legacy_control_id", "human"] as const;
export type ExceptionLinkSource = (typeof EXCEPTION_LINK_SOURCES)[number];

/* =========================================================================
   THE CORRECTED EXTRACTION CONTRACT — reading exceptions and responses.
   ========================================================================= */

/**
 * One exception as the corrected contract represents it.
 *
 * `exception_ref` is the REPORT'S OWN LABEL for the exception ("Exception 1").
 * It is not a control identifier and never was; the pre-v3 contract simply had
 * nowhere else for a labelled exception to go, which is why the corpus contains
 * a management response whose `exception_ref` reads "Exception 1" while every
 * other one reads like a TSC criterion. Renaming that field to `control_ref`
 * would have moved the ambiguity rather than removed it.
 */
export type ParsedException = {
  /** Position in the source array. Provenance only — NEVER an identity. */
  ordinal: number;
  exception_ref: string | null;
  description: string;
  auditor_assessment: string | null;
  source_term: string | null;
  links: ReadonlyArray<{
    control_ref: string;
    link_source: ExceptionLinkSource;
    /** The exact source string the link was read out of. */
    source_value: string;
  }>;
};

export type ParsedManagementResponse = {
  ordinal: number;
  exception_ref: string | null;
  control_refs: readonly string[];
  response: string;
};

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/**
 * Split a legacy scalar `control_id` into the identifiers it actually held.
 *
 * This is PARSING, not inference: the extraction genuinely asserted these
 * identifiers, and the pre-v3 contract gave it one scalar to say them in. The
 * separator set is deliberately narrow — comma, semicolon, and the word "and" —
 * and nothing is invented that the string does not literally contain. The raw
 * string travels with every link it produces, so a reader can always check the
 * split rather than trust it.
 */
export function splitLegacyControlId(raw: string): string[] {
  return raw
    .split(/\s*(?:,|;|\band\b)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Which word the auditor used. Preserved as SOURCE TERMINOLOGY with no severity
 * attached, per the owner ruling. Null when the source used neither word.
 */
export function sourceTermOf(text: string | null): string | null {
  if (text === null) return null;
  if (/\bdeviation/i.test(text) && !/\bexception/i.test(text)) return "deviation";
  if (/\bexception/i.test(text)) return "exception";
  if (/\bdeviation/i.test(text)) return "deviation";
  return null;
}

const MAX_TEXT = 8000;
const clip = (s: string): string => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s);

/**
 * Read the `exceptions` array under BOTH the corrected and the legacy contract.
 *
 * Shape-tolerant rather than version-switched. `prompt_version` is recorded on
 * every extraction and is preserved for provenance, but the reader does not
 * branch on it: a version string is a claim about what was asked for, and the
 * only thing that can be trusted about a historical row is what it actually
 * contains. Reading both key sets unconditionally means an extraction produced
 * under either contract yields the same links, from the same evidence, with the
 * source of each link recorded.
 *
 * PRECEDENCE. `control_refs` wins when present, because the corrected contract
 * asked for it explicitly. `control_id` is consulted only for identifiers
 * `control_refs` did not already supply, so a v3 extraction that emits both
 * never double-links, and a v2 extraction still links.
 */
export function parseExceptions(value: unknown): ParsedException[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, ordinal) => {
    const e = obj(raw);
    const description = str(e["description"]) ?? "";
    const assessment = str(e["auditor_assessment"]);

    const links: Array<{ control_ref: string; link_source: ExceptionLinkSource; source_value: string }> = [];
    const seen = new Set<string>();

    const refs = e["control_refs"];
    if (Array.isArray(refs)) {
      for (const r of refs) {
        const s = str(r);
        if (s === null || seen.has(s.toLowerCase())) continue;
        seen.add(s.toLowerCase());
        links.push({ control_ref: s, link_source: "extraction_control_refs", source_value: s });
      }
    }

    const legacy = str(e["control_id"]);
    if (legacy !== null) {
      for (const s of splitLegacyControlId(legacy)) {
        if (seen.has(s.toLowerCase())) continue;
        seen.add(s.toLowerCase());
        links.push({ control_ref: s, link_source: "legacy_control_id", source_value: legacy });
      }
    }

    return {
      ordinal,
      exception_ref: str(e["exception_ref"]),
      description: clip(description),
      auditor_assessment: assessment === null ? null : clip(assessment),
      source_term: sourceTermOf(assessment ?? description),
      links,
    };
  });
}

export function parseManagementResponses(value: unknown): ParsedManagementResponse[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, ordinal) => {
    const r = obj(raw);
    const refs = Array.isArray(r["control_refs"])
      ? (r["control_refs"] as unknown[]).map(str).filter((s): s is string => s !== null)
      : [];
    return {
      ordinal,
      exception_ref: str(r["exception_ref"]),
      control_refs: refs,
      response: clip(str(r["response"]) ?? ""),
    };
  });
}

/**
 * Pair management responses to exceptions on AUTHORITATIVE linkage only.
 *
 * THE FALLBACK THAT USED TO LIVE HERE IS GONE. `vendorAssuranceExportData.ts`
 * matched `exception_ref == control_id` and, failing that, attached
 * `responses[i]` to `exceptions[i]` BY ARRAY POSITION — silently, with no
 * record that it had guessed. In the corpus that fallback fires on the one
 * document whose response is labelled "Exception 1", because the label matches
 * no control identifier. It happened to attach correctly there, with one
 * response in the array. With two it would not, and nothing would have said so.
 *
 * The three authoritative routes, in order:
 *   1. label      — the response names the exception's own label.
 *   2. control_refs — the corrected contract's explicit control linkage, matched
 *                     as a SET. A partial overlap is not a match: an exception
 *                     spanning CC6.1/CC6.2/CC6.3 and a response about CC6.1
 *                     alone are different scopes, and treating them as the same
 *                     is the guess this function refuses to make.
 *   3. unlinked   — reported as such. An unpaired response is visible, not
 *                   silently absent and not silently misattached.
 */
export type ResponsePairing = {
  exception_ordinal: number;
  response_ordinal: number | null;
  link: "exception_ref" | "control_refs" | "unlinked";
};

export function pairResponsesToExceptions(
  exceptions: readonly ParsedException[],
  responses: readonly ParsedManagementResponse[]
): { pairings: ResponsePairing[]; unmatched_response_ordinals: number[] } {
  const used = new Set<number>();
  const pairings: ResponsePairing[] = [];

  for (const ex of exceptions) {
    let matched: ParsedManagementResponse | null = null;
    let link: ResponsePairing["link"] = "unlinked";

    if (ex.exception_ref !== null) {
      const byLabel = responses.find(
        (r) => r.exception_ref !== null && r.exception_ref.toLowerCase() === ex.exception_ref!.toLowerCase()
      );
      if (byLabel) { matched = byLabel; link = "exception_ref"; }
    }

    if (matched === null && ex.links.length > 0) {
      const want = new Set(ex.links.map((l) => l.control_ref.toLowerCase()));
      const bySet = responses.find((r) => {
        if (r.control_refs.length === 0) return false;
        const got = new Set(r.control_refs.map((c) => c.toLowerCase()));
        if (got.size !== want.size) return false;
        for (const w of want) if (!got.has(w)) return false;
        return true;
      });
      if (bySet) { matched = bySet; link = "control_refs"; }
    }

    if (matched !== null) used.add(matched.ordinal);
    pairings.push({ exception_ordinal: ex.ordinal, response_ordinal: matched?.ordinal ?? null, link });
  }

  return {
    pairings,
    unmatched_response_ordinals: responses.map((r) => r.ordinal).filter((o) => !used.has(o)),
  };
}

/* =========================================================================
   Body validation for the two acceptance surfaces.
   ========================================================================= */

export type ValidationOk<T> = { input: T };
export type ValidationErr = { error: string; detail?: string };

export const MAX_REVIEWER_NOTE = 2000;

export type AcceptEffectivenessInput = {
  decision: EffectivenessDecision;
  effectiveness: GovernedEffectiveness | null;
  indeterminate_reason: IndeterminateReason | null;
  reviewer_note: string | null;
  supersede: boolean;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Validate a governed-effectiveness decision.
 *
 * NOTHING IS DEFAULTED. There is no branch in this function that supplies an
 * effectiveness the caller did not state, and in particular there is no path on
 * which a missing or unrecognised value becomes `EFFECTIVE`. A caller who omits
 * the field gets a 400, which is the fail-closed outcome: no record is written,
 * and no record means no effectiveness.
 *
 * A REVIEWER NOTE IS REQUIRED where the human departs from, or goes beyond, a
 * deterministic explainable rule — same philosophy as the opinion surface:
 *   - `EFFECTIVE`, always, because it is the only value that INCREASES what the
 *     platform claims and the suggestion engine will never propose it;
 *   - any decision that contradicts a non-null suggestion;
 *   - `rejected`, which withdraws a standing governed answer;
 *   - any supersession.
 * Everywhere else a note is optional, because demanding prose on every
 * acceptance produces "n/a" and defends nothing.
 */
export function validateAcceptEffectiveness(
  body: unknown,
  suggestion: EffectivenessSuggestion
): ValidationOk<AcceptEffectivenessInput> | ValidationErr {
  if (!isPlainObject(body)) return { error: "body_must_be_an_object" };

  const rawDecision = body["decision"] === undefined ? "accepted" : body["decision"];
  if (typeof rawDecision !== "string" || !(EFFECTIVENESS_DECISIONS as readonly string[]).includes(rawDecision)) {
    return { error: "decision_invalid", detail: `decision must be one of: ${EFFECTIVENESS_DECISIONS.join(", ")}` };
  }
  const decision = rawDecision as EffectivenessDecision;

  const supersede = body["supersede"] === true;

  let note: string | null = null;
  if (body["reviewer_note"] !== undefined && body["reviewer_note"] !== null) {
    if (typeof body["reviewer_note"] !== "string") return { error: "reviewer_note_must_be_a_string" };
    // sanitizeString TRUNCATES rather than rejecting, so the length is checked
    // against the raw input first: silently swallowing 2001 characters would
    // change what a reviewer believes they recorded.
    if (body["reviewer_note"].length > MAX_REVIEWER_NOTE) {
      return { error: "reviewer_note_too_long", detail: `maximum ${MAX_REVIEWER_NOTE} characters` };
    }
    const cleaned = sanitizeString(body["reviewer_note"], MAX_REVIEWER_NOTE).trim();
    note = cleaned.length === 0 ? null : cleaned;
  }

  if (decision === "rejected") {
    if (body["effectiveness"] !== undefined && body["effectiveness"] !== null) {
      return {
        error: "rejection_must_not_carry_effectiveness",
        detail: "Rejecting withdraws the governed answer; it does not assert a different one.",
      };
    }
    if (note === null) {
      return { error: "reviewer_note_required", detail: "Rejecting a governed effectiveness must say why." };
    }
    return { input: { decision, effectiveness: null, indeterminate_reason: null, reviewer_note: note, supersede } };
  }

  const eff = body["effectiveness"];
  if (eff === undefined || eff === null) {
    // The fail-closed refusal. Never a default.
    return {
      error: "effectiveness_required",
      detail: `effectiveness must be stated explicitly, one of: ${GOVERNED_EFFECTIVENESS.join(", ")}. It is never inferred.`,
    };
  }
  if (!isGovernedEffectiveness(eff)) {
    return { error: "effectiveness_invalid", detail: `must be one of: ${GOVERNED_EFFECTIVENESS.join(", ")}` };
  }

  const rawReason = body["indeterminate_reason"];
  let reason: IndeterminateReason | null = null;
  if (eff === "INDETERMINATE") {
    if (rawReason === undefined || rawReason === null) {
      return {
        error: "indeterminate_reason_required",
        detail: `INDETERMINATE must carry a governed reason, one of: ${INDETERMINATE_REASONS.join(", ")}`,
      };
    }
    if (!isIndeterminateReason(rawReason)) {
      return {
        error: "indeterminate_reason_invalid",
        detail: `must be one of: ${INDETERMINATE_REASONS.join(", ")}. An outcome that fits none of these must be left unaccepted, not absorbed into a catch-all.`,
      };
    }
    reason = rawReason;
  } else if (rawReason !== undefined && rawReason !== null) {
    return {
      error: "indeterminate_reason_not_permitted",
      detail: "A reason explains why effectiveness could NOT be established; it is only meaningful on INDETERMINATE.",
    };
  }

  const contradictsSuggestion =
    suggestion.candidate !== null &&
    (suggestion.candidate !== eff || (eff === "INDETERMINATE" && suggestion.indeterminate_reason !== reason));

  if ((eff === "EFFECTIVE" || contradictsSuggestion || supersede) && note === null) {
    return {
      error: "reviewer_note_required",
      detail:
        eff === "EFFECTIVE"
          ? "EFFECTIVE is the only value that increases what the platform claims and is never proposed automatically. State the basis."
          : supersede
            ? "Re-deciding a governed effectiveness must say what changed."
            : "This decision departs from the deterministic reading. State why.",
    };
  }

  return { input: { decision, effectiveness: eff, indeterminate_reason: reason, reviewer_note: note, supersede } };
}

export type AcceptExceptionEffectInput = {
  governed_effect: ExceptionEffect;
  reviewer_note: string | null;
  supersede: boolean;
};

/**
 * Validate a governed exception effect.
 *
 * The source's own word ("exception" / "deviation") is NEVER consulted here and
 * is never permitted as an input: owner ruling, exception and deviation are
 * report terminology and encoding severity from them is forbidden. The human
 * states the effect; the terminology is preserved separately, untouched.
 */
export function validateAcceptExceptionEffect(
  body: unknown
): ValidationOk<AcceptExceptionEffectInput> | ValidationErr {
  if (!isPlainObject(body)) return { error: "body_must_be_an_object" };

  const raw = body["governed_effect"];
  if (raw === undefined || raw === null) {
    return {
      error: "governed_effect_required",
      detail: `must be stated explicitly, one of: ${EXCEPTION_EFFECTS.join(", ")}`,
    };
  }
  if (!isExceptionEffect(raw)) {
    return {
      error: "governed_effect_invalid",
      detail: `must be one of: ${EXCEPTION_EFFECTS.join(", ")}. This vocabulary carries no severity and has no catch-all.`,
    };
  }

  const supersede = body["supersede"] === true;

  let note: string | null = null;
  if (body["reviewer_note"] !== undefined && body["reviewer_note"] !== null) {
    if (typeof body["reviewer_note"] !== "string") return { error: "reviewer_note_must_be_a_string" };
    // sanitizeString TRUNCATES rather than rejecting, so the length is checked
    // against the raw input first: silently swallowing 2001 characters would
    // change what a reviewer believes they recorded.
    if (body["reviewer_note"].length > MAX_REVIEWER_NOTE) {
      return { error: "reviewer_note_too_long", detail: `maximum ${MAX_REVIEWER_NOTE} characters` };
    }
    const cleaned = sanitizeString(body["reviewer_note"], MAX_REVIEWER_NOTE).trim();
    note = cleaned.length === 0 ? null : cleaned;
  }

  if (supersede && note === null) {
    return { error: "reviewer_note_required", detail: "Re-deciding a governed exception effect must say what changed." };
  }

  return { input: { governed_effect: raw, reviewer_note: note, supersede } };
}
