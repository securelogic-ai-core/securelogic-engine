/**
 * assuranceOpinion.ts — the controlled assurance-opinion vocabulary, and a
 * PROPOSAL normalizer for free-text auditor opinions (VA-S4 Step 4).
 *
 * Owner ruling 4, 2026-08-29:
 *   - a free-text auditor opinion MUST NOT be an assurance eligibility gate;
 *   - a qualified opinion is NOT automatically unusable — it may contribute
 *     coverage only where the exception is demonstrably unrelated to the mapped
 *     control, and FAILS CLOSED where that cannot be established;
 *   - AI alone may not determine that an exception is unrelated.
 *
 * ── Why a normalizer, and why it can only propose ───────────────────────────
 *
 * Every extraction on staging reads, verbatim:
 *
 *   "Unqualified opinion, except for the specific deviations and exception
 *    described in Section IV"
 *
 * `LIKE '%Unqualified%'` returns TRUE. It is a QUALIFIED opinion. That single
 * string is why this file exists and why it returns a candidate rather than a
 * value: a rule good enough to catch "except for" is not good enough to be
 * trusted unattended, because the next report will phrase its carve-out
 * differently and the failure is silent — a questionnaire question that was
 * never asked.
 *
 * So `proposeAssuranceOpinion` is deterministic, pure, explainable, and
 * ADVISORY. Nothing here writes `vendor_assurance_documents.assurance_opinion`;
 * a CHECK constraint on that table makes an opinion without a human acceptor
 * structurally impossible.
 */

/**
 * The closed vocabulary. Five values, chosen to distinguish materially
 * different assurance outcomes rather than to mirror any one framework's
 * wording.
 *
 * `not_evaluated` is the default and is NOT a synonym for clean — absence of an
 * opinion is never coverage. Keeping "we have not established this" separate
 * from "we established it is fine" is the whole point of having a vocabulary.
 */
export const ASSURANCE_OPINIONS = [
  "unmodified",
  "qualified",
  "adverse",
  "disclaimer",
  "not_evaluated",
] as const;
export type AssuranceOpinion = (typeof ASSURANCE_OPINIONS)[number];

export function isAssuranceOpinion(v: unknown): v is AssuranceOpinion {
  return typeof v === "string" && (ASSURANCE_OPINIONS as readonly string[]).includes(v);
}

/**
 * Bumped whenever the rules below change. Recorded alongside an accepted
 * opinion so a past acceptance can be argued against the rules that produced
 * its candidate, not against today's.
 */
export const OPINION_NORMALIZER_VERSION = "opinion-normalizer-1.0";

export type OpinionProposal = {
  /** The candidate. NEVER authoritative. */
  candidate: AssuranceOpinion;
  /** Why, in words a reviewer can check against the source text. */
  reason: string;
  /** Which rule fired, for the audit trail. */
  rule: string;
  /**
   * Always true. Present as a field rather than a comment so a caller that
   * tries to use this without a human has to actively ignore it.
   */
  requires_human: true;
  normalizer_version: string;
};

/**
 * Carve-out language. ORDER MATTERS: these are tested before the clean-opinion
 * patterns, because the dangerous case is a sentence that contains BOTH.
 *
 * "except for" is the standard qualification phrase in an audit opinion; the
 * others are the near-synonyms that appear in practice.
 */
const QUALIFYING_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\bexcept\s+for\b/i, "the opinion carves out matters with 'except for'"],
  [/\bexcept\s+as\s+(?:described|noted|disclosed)\b/i, "the opinion carves out described matters"],
  [/\bwith\s+the\s+exception\s+of\b/i, "the opinion carves out matters"],
  [/\bqualified\s+opinion\b/i, "the opinion states it is qualified"],
  [/\bsubject\s+to\s+the\s+(?:matters|exceptions|deviations)\b/i, "the opinion is subject to identified matters"],
];

const ADVERSE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\badverse\s+opinion\b/i, "the auditor states an adverse opinion"],
  [/\bdid\s+not\s+operate\s+effectively\b/i, "the auditor concludes controls did not operate effectively"],
  [/\bwere\s+not\s+(?:suitably\s+designed|operating\s+effectively)\b/i, "the auditor concludes controls were not effective"],
];

const DISCLAIMER_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\bdisclaimer\s+of\s+opinion\b/i, "the auditor disclaims an opinion"],
  [/\b(?:do|does|did)\s+not\s+express\s+an\s+opinion\b/i, "the auditor does not express an opinion"],
  [/\bunable\s+to\s+(?:form|express|obtain\s+sufficient)\b/i, "the auditor was unable to conclude"],
];

const CLEAN_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\bunqualified\s+opinion\b/i, "the opinion states it is unqualified"],
  [/\bunmodified\s+opinion\b/i, "the opinion states it is unmodified"],
  [/\bfairly\s+presented\b/i, "the auditor states fair presentation"],
  [/\boperated\s+effectively\b/i, "the auditor states controls operated effectively"],
];

const first = (
  text: string,
  table: ReadonlyArray<[RegExp, string]>
): { reason: string; rule: string } | null => {
  for (const [re, reason] of table) {
    if (re.test(text)) return { reason, rule: re.source };
  }
  return null;
};

/**
 * Propose a canonical opinion for free text. Deterministic and pure.
 *
 * PRECEDENCE, and the reason for it: adverse and disclaimer beat everything
 * because they are unambiguous statements of failure. **Qualification is tested
 * BEFORE cleanliness**, so a sentence containing both "Unqualified opinion" and
 * "except for" resolves to `qualified` — that is the staging string, and
 * getting it the other way round is the specific failure this function exists
 * to prevent. Anything unrecognised is `not_evaluated`, never a guess: an
 * unreadable opinion must not become coverage.
 */
export function proposeAssuranceOpinion(text: string | null | undefined): OpinionProposal {
  const base = { requires_human: true as const, normalizer_version: OPINION_NORMALIZER_VERSION };
  const t = (text ?? "").trim();

  if (t === "") {
    return { ...base, candidate: "not_evaluated", rule: "empty", reason: "no opinion text was supplied" };
  }

  const adverse = first(t, ADVERSE_PATTERNS);
  if (adverse) return { ...base, candidate: "adverse", ...adverse };

  const disclaimer = first(t, DISCLAIMER_PATTERNS);
  if (disclaimer) return { ...base, candidate: "disclaimer", ...disclaimer };

  // BEFORE the clean patterns. See the precedence note above.
  const qualified = first(t, QUALIFYING_PATTERNS);
  if (qualified) return { ...base, candidate: "qualified", ...qualified };

  const clean = first(t, CLEAN_PATTERNS);
  if (clean) return { ...base, candidate: "unmodified", ...clean };

  return {
    ...base,
    candidate: "not_evaluated",
    rule: "unrecognised",
    reason: "the opinion text matched no known pattern; it must be read by a person",
  };
}

/**
 * May an opinion contribute assurance coverage AT ALL, before any
 * control-specific reasoning?
 *
 * This is the coarse gate only. Ruling 4 is explicit that a `qualified` opinion
 * is not automatically unusable — so `qualified` returns `conditional`, not
 * `false`. What it may NOT do is contribute coverage silently: the caller must
 * establish that the exception is unrelated to the specific mapped control,
 * through the governed path, and FAIL CLOSED if it cannot.
 *
 * Nothing here can make that determination, and it deliberately offers no way
 * to.
 */
export function opinionCoverageGate(
  opinion: AssuranceOpinion | null
): "eligible" | "conditional" | "ineligible" {
  switch (opinion) {
    case "unmodified":
      return "eligible";
    case "qualified":
      // Conditional on a governed, control-specific unrelatedness finding.
      return "conditional";
    case "adverse":
    case "disclaimer":
      return "ineligible";
    case "not_evaluated":
    case null:
    default:
      // Absence is never coverage.
      return "ineligible";
  }
}
