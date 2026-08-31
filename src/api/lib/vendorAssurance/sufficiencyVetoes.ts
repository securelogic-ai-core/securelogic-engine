/**
 * sufficiencyVetoes.ts — VA-S4-4C-4. The twelve coverage vetoes, evaluated.
 *
 * 4C-2 answers which canonical control a tested control IS. 4C-3 answers what
 * the auditor said, what SecureLogic governs, and what the exceptions mean.
 * This module answers the last question before step 5: for one candidate
 * (requirement x tested control x document), which of the twelve vetoes in the
 * owner's Ruling-6 table block it?
 *
 * ── THE INVARIANT ──────────────────────────────────────────────────────────
 *
 *   A VETO THAT CANNOT BE COMPUTED IS NOT A VETO THAT PASSED.
 *
 * Three states, never two. `NOT_EVALUABLE` is a first-class recorded value: it
 * means the substrate to answer the question does not exist, or exists and says
 * "unknown". Folding it into `PASSED` would produce a confident answer built on
 * a gap — a vacuous pass that reads as a considered judgement, which is the
 * failure mode this programme has hit repeatedly.
 *
 * ── THIS MODULE HOLDS NO AUTHORITY ─────────────────────────────────────────
 *
 * It is a reading of already-governed facts. It never proposes SUFFICIENT, for
 * the same reason `suggestEffectiveness` never proposes EFFECTIVE: passing ten
 * computable checks is still a statement about one report's testing, and
 * sufficiency is a statement SecureLogic makes on its own authority. The human
 * determination is a separate act, recorded by a separate writer.
 */

/** Bumped whenever a rule below changes, so a stored basis stays explainable. */
export const VETO_EVALUATOR_VERSION = "sufficiency-veto-1.0";

export const COVERAGE_VETOES = [
  "report_scope",
  "report_period",
  "report_type",
  "tested_control_result",
  "control_exception",
  "carve_out",
  "accepted_opinion",
  "contradictory_evidence",
  "open_findings",
  "mapping_authority",
  "human_acceptance",
  "decision_basis",
] as const;
export type CoverageVeto = (typeof COVERAGE_VETOES)[number];

/**
 * The two vetoes this module does not compute. They are preconditions of the
 * determination row EXISTING — `determined_by_user_id NOT NULL` behind an
 * INSERT trigger, and `basis JSONB NOT NULL` — so a row that violated either
 * could not have been written. They are recorded PASSED at write time with the
 * construct that guarantees them named, never silently omitted.
 */
export const STRUCTURAL_VETOES: readonly CoverageVeto[] = ["human_acceptance", "decision_basis"];

/** The ten this module actually evaluates. */
export const EVALUATED_VETOES: readonly CoverageVeto[] = COVERAGE_VETOES.filter(
  (v) => !STRUCTURAL_VETOES.includes(v)
);

export const VETO_STATES = ["PASSED", "FIRED", "NOT_EVALUABLE"] as const;
export type VetoState = (typeof VETO_STATES)[number];

export type VetoEvaluation = {
  veto: CoverageVeto;
  state: VetoState;
  /** Machine-stable reason slug. Always present, including for PASSED. */
  reason: string;
  /** What was actually read, so the verdict is reconstructable later. */
  observed?: Record<string, unknown>;
};

/* ────────────────────────── normalizers ────────────────────────── */

export type ReportTypeClass = "TYPE_I" | "TYPE_II";

/**
 * Measured on staging 2026-08-31 across 17 extractions: `SOC 2 Type 2` (11),
 * `SOC 2 Type II` (5), `SOC 2 Type I` (1).
 *
 * PRECEDENCE IS LOAD-BEARING, exactly as in Layer 1's assertion normalizer:
 * "Type II" contains "Type I" as a prefix, so the two-forms are tested FIRST.
 * Getting this backwards silently downgrades every Type II report in the estate
 * to design-only.
 */
export function normalizeReportType(raw: string | null | undefined): ReportTypeClass | null {
  if (typeof raw !== "string") return null;
  const s = raw.toLowerCase();
  if (/type\s*(?:ii|2)\b/.test(s)) return "TYPE_II";
  if (/type\s*(?:i|1)\b/.test(s)) return "TYPE_I";
  return null;
}

export const TSC_CATEGORIES = [
  "security",
  "availability",
  "confidentiality",
  "processing_integrity",
  "privacy",
] as const;
export type TscCategory = (typeof TSC_CATEGORIES)[number];

/**
 * The category a TSC criterion belongs to, from its reference prefix.
 *
 * ORDER MATTERS and the longest prefix must win: `CC6.1` is Common Criteria
 * (Security), not Confidentiality; `PI1.1` is Processing Integrity, not
 * Privacy. Testing `C` or `P` first mis-files both.
 */
export function categoryOfCriterion(ref: string | null | undefined): TscCategory | null {
  if (typeof ref !== "string") return null;
  const s = ref.trim().toUpperCase();
  if (/^CC\d/.test(s)) return "security";
  if (/^PI\d/.test(s)) return "processing_integrity";
  if (/^A\d/.test(s)) return "availability";
  if (/^C\d/.test(s)) return "confidentiality";
  if (/^P\d/.test(s)) return "privacy";
  return null;
}

/** The category a scope ENTRY names, when the entry is a category and not a criterion. */
export function categoryOfScopeEntry(entry: string | null | undefined): TscCategory | null {
  if (typeof entry !== "string") return null;
  const s = entry.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (s === "security" || s === "common criteria") return "security";
  if (s === "availability") return "availability";
  if (s === "confidentiality") return "confidentiality";
  if (s === "processing integrity") return "processing_integrity";
  if (s === "privacy") return "privacy";
  return null;
}

export type ScopeMatch =
  | { covered: true; grain: "criterion" | "category" }
  | { covered: false; grain: null };

/**
 * MEASURED: `trust_services_criteria` is MIXED-GRAIN. The staging corpus holds
 * both criteria (`CC6.1`, `A1.1`, `CC7.2`, …) and categories (`Security`,
 * `Availability`, `Confidentiality`) — sometimes in the same array.
 *
 * A report scoped to `Security` covers `CC6.1` without ever naming it. So this
 * is not set membership on strings: criterion match first, then category match
 * through the criterion's own prefix. Neither resolving is NOT covered, and the
 * caller turns that into NOT_EVALUABLE rather than into "out of scope".
 */
export function scopeCoversCriterion(
  scope: readonly string[] | null | undefined,
  criterion: string | null | undefined
): ScopeMatch {
  if (!Array.isArray(scope) || scope.length === 0) return { covered: false, grain: null };
  if (typeof criterion !== "string" || criterion.trim() === "") return { covered: false, grain: null };
  const target = criterion.trim().toUpperCase();

  for (const entry of scope) {
    if (typeof entry === "string" && entry.trim().toUpperCase() === target) {
      return { covered: true, grain: "criterion" };
    }
  }
  const wanted = categoryOfCriterion(target);
  if (wanted !== null) {
    for (const entry of scope) {
      if (categoryOfScopeEntry(entry) === wanted) return { covered: true, grain: "category" };
    }
  }
  return { covered: false, grain: null };
}

export type SubserviceMethodClass = "inclusive" | "carve_out";

/**
 * MEASURED at 17 extractions: `null` 11, `Carve-out` 5, `carve-out` 1. Both the
 * case variance and the NULL majority are real, and the earlier "100% carve-out"
 * note was measured at 5 and is stale.
 */
export function normalizeSubserviceMethod(
  raw: string | null | undefined
): SubserviceMethodClass | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (s === "carve-out" || s === "carveout") return "carve_out";
  if (s === "inclusive") return "inclusive";
  return null;
}

/* ────────────────────────── the evaluation ────────────────────────── */

export type VetoInput = {
  /** The vendor-side criterion the tested control IS, e.g. `CC6.1`. */
  requirementReference: string;

  /** Report-level assurance-bearing values, already unwrapped from `{value}`. */
  reportType: string | null;
  reportPeriodStart: string | null;
  reportPeriodEnd: string | null;
  trustServicesCriteria: readonly string[] | null;
  subserviceMethod: string | null;

  /** True when the extraction carried an `exceptions` field at all (even empty). */
  exceptionsFieldPresent: boolean;
  /** Live Layer-3 exceptions LINKED to this tested control. */
  linkedExceptions: readonly { governedEffect: string | null }[];

  /** Document-level accepted opinion (20261066/20261070). Null = not accepted. */
  acceptedOpinion: string | null;

  /** Layer 2. Null decision or null effectiveness = not established. */
  effectivenessDecision: string | null;
  governedEffectiveness: string | null;

  /** The crosswalk row that justified the candidate. */
  mappingSource: string | null;
  mappingStatus: string | null;
  mappingApproved: boolean;

  /**
   * Open findings on the SAME canonical control.
   *
   * Null = COULD NOT BE COUNTED, which includes the case measured on staging
   * today: no open finding in the organisation carries a
   * `framework_control_id` at all, so a count of zero would mean "nothing
   * populates this column", not "this control is clean". Pass a number only
   * when the dimension is actually populated for the organisation.
   */
  openFindingsOnCanonicalControl: number | null;

  /**
   * Whether the evidence-link substrate exists. ADR-0012 (step 2) is not built,
   * so this is false today and veto 8 is permanently NOT_EVALUABLE. It is an
   * input rather than a constant so that shipping step 2 flips it honestly.
   */
  contradictoryEvidenceQueryable: boolean;

  asOf: Date;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

export function evaluateVetoes(input: VetoInput): VetoEvaluation[] {
  const out: VetoEvaluation[] = [];

  // 1. report / TSC scope — a control outside the report's scope was never tested.
  {
    const scope = input.trustServicesCriteria;
    if (!Array.isArray(scope) || scope.length === 0) {
      out.push({ veto: "report_scope", state: "NOT_EVALUABLE", reason: "scope_not_stated" });
    } else {
      const m = scopeCoversCriterion(scope, input.requirementReference);
      if (m.covered) {
        out.push({
          veto: "report_scope",
          state: "PASSED",
          reason: `in_scope_by_${m.grain}`,
          observed: { criterion: input.requirementReference, grain: m.grain },
        });
      } else if (categoryOfCriterion(input.requirementReference) === null) {
        // We cannot even place the criterion in a category, so we cannot say it
        // is out of scope — only that we could not tell.
        out.push({
          veto: "report_scope",
          state: "NOT_EVALUABLE",
          reason: "criterion_grain_unrecognized",
          observed: { criterion: input.requirementReference },
        });
      } else {
        out.push({
          veto: "report_scope",
          state: "FIRED",
          reason: "criterion_outside_report_scope",
          observed: { criterion: input.requirementReference, scope },
        });
      }
    }
  }

  // 2. report period / validity — assurance is a statement about a window.
  //
  // The dates are computable; the JUDGEMENT is not. Nothing in the platform
  // says how long a SOC 2 Type II report remains current: that is step 3
  // (evidence-validity policy), which depends on step 2 (ADR-0012), and
  // `evidence` has no valid_from / valid_until / assurance_class at all. So
  // this veto records the measured staleness as a FACT and stays
  // NOT_EVALUABLE. It must never read PASSED merely because a date parsed.
  {
    const end = input.reportPeriodEnd;
    if (typeof end !== "string" || !ISO_DATE.test(end.trim())) {
      out.push({
        veto: "report_period",
        state: "NOT_EVALUABLE",
        reason: "period_end_unparseable",
        observed: { report_period_end: end },
      });
    } else {
      const endDate = new Date(`${end.trim()}T00:00:00Z`);
      out.push({
        veto: "report_period",
        state: "NOT_EVALUABLE",
        reason: "no_ratified_validity_policy",
        observed: {
          report_period_start: input.reportPeriodStart,
          report_period_end: end,
          days_since_period_end: daysBetween(endDate, input.asOf),
          blocked_on: "ADR-0012 evidence validity (step 2) and the validity policy (step 3)",
        },
      });
    }
  }

  // 3. Type I vs Type II — design and operation are different claims.
  {
    const cls = normalizeReportType(input.reportType);
    if (cls === null) {
      out.push({
        veto: "report_type",
        state: "NOT_EVALUABLE",
        reason: "report_type_unrecognized",
        observed: { report_type: input.reportType },
      });
    } else if (cls === "TYPE_I") {
      out.push({
        veto: "report_type",
        state: "FIRED",
        reason: "type_i_reports_design_only",
        observed: { report_type: input.reportType },
      });
    } else {
      out.push({ veto: "report_type", state: "PASSED", reason: "type_ii", observed: { report_type: input.reportType } });
    }
  }

  // 4. tested-control result — a control that failed is not coverage.
  //
    // Reads LAYER 2, never Layer 1: the auditor's reading carries no authority,
    // and absence of a governed effectiveness is absence of effectiveness.
  {
    const decision = input.effectivenessDecision;
    const eff = input.governedEffectiveness;
    if (decision !== "accepted" || eff === null) {
      out.push({
        veto: "tested_control_result",
        state: "NOT_EVALUABLE",
        reason: "governed_effectiveness_not_established",
        observed: { decision, governed_effectiveness: eff },
      });
    } else if (eff === "EFFECTIVE") {
      out.push({ veto: "tested_control_result", state: "PASSED", reason: "governed_effective" });
    } else if (eff === "INEFFECTIVE") {
      out.push({ veto: "tested_control_result", state: "FIRED", reason: "governed_ineffective" });
    } else {
      out.push({
        veto: "tested_control_result",
        state: "NOT_EVALUABLE",
        reason: "governed_effectiveness_indeterminate",
      });
    }
  }

  // 5. control exception / deviation — the matter the auditor carved out.
  //
  // Ruling 6's single most important line: an exception must not be erased by a
  // clean report-level opinion. So this veto is evaluated independently of
  // veto 7 and neither can satisfy the other.
  {
    const linked = input.linkedExceptions ?? [];
    if (!input.exceptionsFieldPresent) {
      out.push({ veto: "control_exception", state: "NOT_EVALUABLE", reason: "exceptions_field_absent" });
    } else if (linked.length === 0) {
      out.push({ veto: "control_exception", state: "PASSED", reason: "no_exception_linked_to_control" });
    } else if (linked.some((e) => e.governedEffect === null)) {
      out.push({
        veto: "control_exception",
        state: "NOT_EVALUABLE",
        reason: "linked_exception_uninterpreted",
        observed: { linked: linked.length },
      });
    } else {
      out.push({
        veto: "control_exception",
        state: "FIRED",
        reason: "linked_exception_interpreted",
        observed: { effects: linked.map((e) => e.governedEffect) },
      });
    }
  }

  // 6. carve-out / subservice — the work may have been done by someone else.
  //
  // OWNER RULING 2026-08-31: missing or null carve-out information is
  // NOT_EVALUABLE, never PASSED. Absence of a stated carve-out is not evidence
  // that none exists — and NULL is the MAJORITY of the measured corpus (11/17).
  //
  // A stated carve-out is also not FIRED: the extraction cannot say whether the
  // carved-out work touches THIS control, only that untested delegated work
  // exists. So this veto passes only on an explicitly inclusive report.
  {
    const cls = normalizeSubserviceMethod(input.subserviceMethod);
    if (cls === null) {
      out.push({
        veto: "carve_out",
        state: "NOT_EVALUABLE",
        reason: "subservice_method_not_stated",
        observed: { subservice_method: input.subserviceMethod },
      });
    } else if (cls === "carve_out") {
      out.push({
        veto: "carve_out",
        state: "NOT_EVALUABLE",
        reason: "carve_out_present_control_attribution_unknown",
        observed: { subservice_method: input.subserviceMethod },
      });
    } else {
      out.push({ veto: "carve_out", state: "PASSED", reason: "inclusive_method" });
    }
  }

  // 7. accepted auditor opinion — report-level, human-accepted (step 4b).
  //
  // One veto among twelve. Passing it proves only that this one did not fire.
  {
    const op = input.acceptedOpinion;
    if (op === null) {
      out.push({ veto: "accepted_opinion", state: "NOT_EVALUABLE", reason: "no_accepted_opinion" });
    } else if (op === "unmodified") {
      out.push({ veto: "accepted_opinion", state: "PASSED", reason: "unmodified" });
    } else if (op === "not_evaluated") {
      out.push({ veto: "accepted_opinion", state: "NOT_EVALUABLE", reason: "opinion_not_evaluated" });
    } else {
      out.push({
        veto: "accepted_opinion",
        state: "FIRED",
        reason: "opinion_not_unmodified",
        observed: { assurance_opinion: op },
      });
    }
  }

  // 8. contradictory evidence — other evidence saying the opposite.
  //
  // NO SUBSTRATE. `evidence_links` does not exist and `evidence` carries no
  // validity columns; ADR-0012 is step 2 and is not built. Permanently
  // NOT_EVALUABLE until it is, which is precisely why no candidate can reach
  // SUFFICIENT today — see the design doc.
  {
    out.push(
      input.contradictoryEvidenceQueryable
        ? { veto: "contradictory_evidence", state: "PASSED", reason: "no_contradictory_evidence_linked" }
        : {
            veto: "contradictory_evidence",
            state: "NOT_EVALUABLE",
            reason: "no_evidence_link_substrate",
            observed: { blocked_on: "ADR-0012 evidence_links (step 2)" },
          }
    );
  }

  // 9. relevant open findings — a live gap on the same control.
  //
  // The pivot is the canonical control identity: findings.framework_control_id
  // -> control_canonical_identities.control_id -> the candidate's canonical
  // control. First consumer of Step 1's identity table outside the crosswalk.
  //
  // MEASURED 2026-08-31, AND IT IS A TRAP: `findings.framework_control_id` is
  // TEXT, carries NO foreign key, and is NULL on all 5,478 staging findings.
  // The column exists; the dimension is unpopulated. A join on it therefore
  // returns zero for every candidate, and a zero read as PASSED would be a
  // confident "no live gap" built on a column nothing writes — the exact
  // vacuous pass this module exists to prevent.
  //
  // So the caller MUST pass null unless at least one open finding in the
  // organisation actually carries the dimension. Zero-because-unpopulated and
  // zero-because-clean are different facts and must not share a state.
  {
    const n = input.openFindingsOnCanonicalControl;
    if (n === null) {
      out.push({ veto: "open_findings", state: "NOT_EVALUABLE", reason: "open_findings_not_countable" });
    } else if (n > 0) {
      out.push({
        veto: "open_findings",
        state: "FIRED",
        reason: "open_finding_on_same_canonical_control",
        observed: { open_findings: n },
      });
    } else {
      out.push({ veto: "open_findings", state: "PASSED", reason: "no_open_finding_on_canonical_control" });
    }
  }

  // 10. mapping authority — who asserted the mapping, and may they.
  //
  // MEASURED UNIFORM: all 162 published crosswalk rows are `securelogic` +
  // `published`, so this veto can never fire observationally on today's corpus.
  // It is therefore enforced STRUCTURALLY and asserted with a negative fixture.
  // Ruling 1: SecureLogic owns the canonical crosswalk. Ruling 2: customer
  // mappings augment. An `ai_proposed` mapping may never establish coverage.
  {
    const src = input.mappingSource;
    const status = input.mappingStatus;
    if (src === null || status === null) {
      out.push({ veto: "mapping_authority", state: "NOT_EVALUABLE", reason: "mapping_provenance_absent" });
    } else if (status !== "published") {
      out.push({
        veto: "mapping_authority",
        state: "FIRED",
        reason: "mapping_not_published",
        observed: { status },
      });
    } else if (src === "ai_proposed") {
      out.push({
        veto: "mapping_authority",
        state: "FIRED",
        reason: "ai_proposed_mapping_cannot_establish_coverage",
        observed: { mapping_source: src },
      });
    } else if (!input.mappingApproved) {
      out.push({ veto: "mapping_authority", state: "FIRED", reason: "mapping_has_no_human_approver" });
    } else {
      out.push({
        veto: "mapping_authority",
        state: "PASSED",
        reason: "published_and_approved",
        observed: { mapping_source: src },
      });
    }
  }

  return out;
}

/* ────────────────────────── the determination ────────────────────────── */

export const SUFFICIENCY_DETERMINATIONS = ["SUFFICIENT", "INSUFFICIENT", "INDETERMINATE"] as const;
export type SufficiencyDetermination = (typeof SUFFICIENCY_DETERMINATIONS)[number];

export function isSufficiencyDetermination(v: unknown): v is SufficiencyDetermination {
  return typeof v === "string" && (SUFFICIENCY_DETERMINATIONS as readonly string[]).includes(v);
}

export const SUFFICIENCY_INDETERMINATE_REASONS = [
  "veto_not_evaluable",
  "veto_fired",
  "scope_unclear",
  "conflicting_evidence",
] as const;
export type SufficiencyIndeterminateReason = (typeof SUFFICIENCY_INDETERMINATE_REASONS)[number];

export function isSufficiencyIndeterminateReason(v: unknown): v is SufficiencyIndeterminateReason {
  return (
    typeof v === "string" && (SUFFICIENCY_INDETERMINATE_REASONS as readonly string[]).includes(v)
  );
}

export type DeterminationPrecondition =
  | { ok: true }
  | {
      ok: false;
      code: "blocking_vetoes";
      blocking: { veto: CoverageVeto; state: VetoState; reason: string }[];
    };

/**
 * May this determination be recorded?
 *
 * OWNER RULING 2026-08-31: `SUFFICIENT` hard-refuses if ANY evaluated veto is
 * `FIRED` **or** `NOT_EVALUABLE`. There is NO HUMAN OVERRIDE of epistemic
 * insufficiency, and no column through which one could be expressed. A reviewer
 * who believes the assurance is adequate anyway is describing a risk they are
 * willing to accept, and risk acceptance is a different layer that must never
 * rewrite an INDETERMINATE assurance basis into SUFFICIENT.
 *
 * `INSUFFICIENT` and `INDETERMINATE` are always recordable — refusing to let a
 * reviewer say "no" or "cannot tell" would be the wrong direction of caution.
 */
export function determinationPrecondition(
  requested: SufficiencyDetermination,
  evaluations: readonly VetoEvaluation[]
): DeterminationPrecondition {
  if (requested !== "SUFFICIENT") return { ok: true };
  const blocking = evaluations
    .filter((e) => e.state !== "PASSED")
    .map((e) => ({ veto: e.veto, state: e.state, reason: e.reason }));
  return blocking.length === 0 ? { ok: true } : { ok: false, code: "blocking_vetoes", blocking };
}

/**
 * The basis snapshotted onto the determination row (veto 12). Records all
 * TWELVE by value — the ten evaluated, plus the two the schema guarantees —
 * so the verdict stays reconstructable after the crosswalk, the corpus and the
 * evaluator have all moved.
 */
export function buildDeterminationBasis(
  evaluations: readonly VetoEvaluation[],
  context: Record<string, unknown>
): Record<string, unknown> {
  const structural: VetoEvaluation[] = [
    {
      veto: "human_acceptance",
      state: "PASSED",
      reason: "attributed_human_determiner",
      observed: { enforced_by: "determined_by_user_id NOT NULL + INSERT trigger" },
    },
    {
      veto: "decision_basis",
      state: "PASSED",
      reason: "basis_snapshotted_by_value",
      observed: { enforced_by: "basis JSONB NOT NULL" },
    },
  ];
  const all = [...evaluations, ...structural];
  return {
    evaluator_version: VETO_EVALUATOR_VERSION,
    establishes_requirement_coverage: false,
    vetoes: all,
    counts: {
      passed: all.filter((e) => e.state === "PASSED").length,
      fired: all.filter((e) => e.state === "FIRED").length,
      not_evaluable: all.filter((e) => e.state === "NOT_EVALUABLE").length,
    },
    ...context,
  };
}
