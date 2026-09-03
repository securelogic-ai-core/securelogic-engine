/**
 * assuranceCoverage.ts — THE COUNTING PREDICATE (VA-S4 step 5, part 1).
 *
 * Answers one question, fail-closed at every hop:
 *
 *   Which of THIS engagement's requirements already carry sufficient, current,
 *   governed assurance?
 *
 * The answer is consumed by scopeResolver's S4 offset, which REDUCES QUESTION
 * DEPTH to "confirm" and never removes a requirement, never releases a floor,
 * and never touches an obligation's assurance. Those semantics live there and
 * predate this module; this module only decides what COUNTS.
 *
 * ── WHAT COUNTS, PRECISELY ───────────────────────────────────────────────────
 *
 * A requirement counts as covered when EVERY hop below holds. A missing hop
 * excludes the requirement WITH A RECORDED REASON — the exclusions are the
 * assurance-gap report, not a discard pile.
 *
 *   1. a LIVE determination row says SUFFICIENT           (4C-4, human-made,
 *      twelve vetoes, no override — this module re-decides nothing)
 *   2. its document is approved and belongs to THIS engagement's vendor
 *      (a SOC 2 for vendor B cannot cover vendor A — wiring plan §7)
 *   3. the requirement identity (framework_key, version, reference), held by
 *      VALUE on the determination so it survives re-curation, resolves to a
 *      requirement row in THIS org's frameworks
 *   4. the report period end parses, a RATIFIED validity policy exists for the
 *      report's class, and the computed window is CURRENT as of the resolution
 *      date — evaluated through resolveValidityWindow, the same ratified
 *      machinery Step 3 shipped, never a re-implementation
 *
 * Currency is a READ-time question, deliberately: a determination made in March
 * stays truthful about March, and whether it still counts TODAY is decided
 * today, against the policy in force today. The determination row is never
 * edited by any of this.
 *
 * ── WHY report_type MAPS CONSERVATIVELY ──────────────────────────────────────
 *
 * The corpus writes report_type as free-ish text ('SOC 2 Type 2', 'SOC 2 Type
 * II', 'SOC 2 Type I' — measured 4C-4). Only an EXPLICIT Type II marker maps to
 * soc2_type2. A Type I maps to soc2_type1, whose ratified policy establishes NO
 * window (D1 named no number), so it can never be current — which is redundant
 * with the Type I veto and correct twice. Anything unrecognised maps to no
 * class at all and is excluded as unclassifiable, never guessed.
 */

import { pg } from "../../infra/postgres.js";
import { resolveValidityWindow, isWindowCurrent } from "../evidenceValidityPolicy.js";
import { SQL_EVIDENCE_COUNTING, SQL_EVIDENCE_SUPERSEDED } from "../evidenceLifecycleContract.js";
import { loadEffectivePolicy } from "../evidenceLinkWriter.js";

/**
 * 1.1 (2026-09-02): the D2-D14 ratification. Exclusions now report the ACTUAL
 * refusal (a breached customer ceiling and a missing governed bridge were both
 * reported as `policy_establishes_no_window`, which named the wrong cause on a
 * silently-dropped requirement), and every covered row names the ratified
 * policy VERSION that produced its window so a decision basis stays replayable.
 */
export const ASSURANCE_COVERAGE_VERSION = "assurance-coverage-1.1";

export type CoverageExclusionReason =
  | "conflicting_governed_judgement"
  | "requirement_identity_unresolved"
  | "report_type_unclassifiable"
  | "report_period_end_unparseable"
  | "no_ratified_validity_policy"
  | "policy_establishes_no_window"
  | "customer_duration_exceeds_ceiling"
  | "governed_bridge_required"
  | "validity_window_expired";

export type CoveredRequirement = {
  requirementId: string;
  requirementReference: string;
  determinationId: string;
  documentId: string;
  /** ISO date the coverage stays good until, from the ratified policy. */
  validUntil: string;
  /** 'platform' default or a 'customer' D15 override supplied the duration. */
  validitySource: "platform" | "customer";
  reportPeriodEnd: string;
  assuranceClass: string;
  /** The ratified policy VERSION this window came from (G: replayability). */
  policyVersion: number | null;
};

export type CoverageGap = {
  determinationId: string;
  requirementReference: string;
  requirementId: string | null;
  reason: CoverageExclusionReason;
  detail: Record<string, unknown>;
};

/**
 * ── THE GOVERNED-EVIDENCE SURFACE (added 2026-09-02, owner-authorized) ───────
 *
 * Deliberately NOT versioned with ASSURANCE_COVERAGE_VERSION. That constant
 * identifies the COUNTING rule that produced a stored decision basis, and the
 * counting rule is byte-identical before and after this addition: nothing here
 * touches `covered`, so a basis stamped `assurance-coverage-1.1` means exactly
 * what it meant yesterday. Bumping it would falsely signal that counting
 * changed. The new surface carries its own identity instead.
 */
export const GOVERNED_EVIDENCE_SURFACE_VERSION = "governed-evidence-surface-1.0";

/**
 * The assurance classes that can carry TESTED-CONTROL authority at all.
 *
 * These two are the only classes `assuranceClassForReportType` maps, and the
 * only ones whose artifacts are audit reports that TEST controls. Every other
 * ratified class describes an artifact with no tested control in it, so no
 * `vendor_tested_control_resolutions` row can exist for it, so no
 * `vendor_requirement_sufficiency_determinations` row can be written (that
 * table NOT-NULLs `resolution_id` and `canonical_control_id`), so it can never
 * reach a SUFFICIENT determination. That is a structural fact about the schema,
 * not a policy choice, and it is why this surface never counts.
 */
const TESTED_CONTROL_CAPABLE_CLASSES: ReadonlySet<string> = new Set(["soc1", "soc2_type2"]);

/**
 * Why a governed evidence link does not count. DETERMINISTIC: derived only from
 * the artifact's assurance class, never from a heuristic or a partial read.
 *
 *  - `no_tested_control_authority` — the class cannot produce a tested control,
 *    so the authority chain (tested control -> canonical control -> governed
 *    crosswalk -> requirement) does not exist for it. Owner-ruled 2026-09-02:
 *    these fail CLOSED rather than receive a shortcut, and no INAPPLICABLE veto
 *    state is introduced to let them through.
 *  - `awaiting_sufficiency_determination` — the class COULD carry tested-control
 *    authority, but this link is not a determination. Saying such an artifact
 *    "lacks tested-control authority" would be false; it lacks a determination.
 */
export const GOVERNED_EVIDENCE_NON_COUNTING_REASONS = [
  "no_tested_control_authority",
  "awaiting_sufficiency_determination",
] as const;
export type GovernedEvidenceNonCountingReason =
  (typeof GOVERNED_EVIDENCE_NON_COUNTING_REASONS)[number];

/**
 * One confirmed, current, requirement-grain governed evidence link.
 *
 * `counts` is the literal `false`, not a boolean: this arm has no branch that
 * can make it true. Questionnaire depth reduction reads ONLY
 * `AssuranceCoverage.covered`, which this arm never writes to.
 */
export type GovernedEvidenceLink = {
  linkId: string;
  evidenceId: string;
  requirementId: string;
  /** NULL when the requirement does not resolve inside THIS organization. */
  requirementReference: string | null;
  assuranceClass: string;
  validityBasis: string;
  /** NULL for `perpetual`, which has no end date by ratification. */
  validUntil: string | null;
  confirmedAt: string;
  /** ADR-0012 2.4: a newer version is NAMED beside the row, never auto-detached. */
  supersededByNewerVersion: boolean;
  counts: false;
  reason: GovernedEvidenceNonCountingReason;
};

export type AssuranceCoverage = {
  version: string;
  asOf: string;
  engagementId: string;
  covered: CoveredRequirement[];
  /** SUFFICIENT determinations that did NOT count, and exactly why. */
  gaps: CoverageGap[];
  /**
   * Confirmed, current, requirement-grain governed evidence for this engagement.
   * VISIBLE and explicitly NON-COUNTING. Curating a pen test or an ISO
   * certificate used to produce silence on this surface, which reads as "no
   * evidence exists"; it now reads as "evidence exists and here is why it does
   * not reduce depth".
   */
  governedEvidence: GovernedEvidenceLink[];
  governedEvidenceVersion: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolver refusal slug -> the gap reason a reviewer sees. Anything unmapped
 * falls back to `policy_establishes_no_window`, which stays correct for a class
 * ratified to establish nothing.
 */
const REFUSAL_TO_GAP: Record<string, CoverageExclusionReason> = {
  no_ratified_policy: "no_ratified_validity_policy",
  customer_duration_exceeds_ceiling: "customer_duration_exceeds_ceiling",
  governed_bridge_required: "governed_bridge_required",
};

/** Only explicit markers map; anything else is unclassifiable, never guessed. */
export function assuranceClassForReportType(reportType: string | null): string | null {
  if (!reportType) return null;
  const t = reportType.trim().toLowerCase();
  if (/soc\s*2/.test(t) && /(type\s*(2|ii))\b/.test(t)) return "soc2_type2";
  if (/soc\s*2/.test(t) && /(type\s*(1|i))\b/.test(t)) return "soc2_type1";
  if (/soc\s*1/.test(t)) return "soc1";
  return null;
}

/**
 * Enumerate the confirmed, current, requirement-grain governed evidence links
 * for one engagement. READS ONLY. Never counts, by construction.
 *
 * Currency is decided by SQL_EVIDENCE_COUNTING — the SAME predicate the Step-2
 * lifecycle uses, imported rather than re-implemented, so "current" means one
 * thing across the platform. An expired artifact fails that predicate and is
 * therefore ABSENT from this list: it cannot masquerade as current, and it is
 * not silently reported as counting-but-stale either.
 *
 * TENANT ISOLATION. `evidence_links` and `evidence` are org-filtered explicitly
 * at every hop; RLS is the backstop, never the only guard. `requirements` and
 * `frameworks` have RLS DISABLED (measured), so the requirement reference is
 * resolved through `frameworks.organization_id` and yields NULL rather than a
 * foreign organization's text if the requirement does not belong here.
 */
export async function resolveGovernedEvidenceLinks(args: {
  organizationId: string;
  engagementId: string;
}): Promise<GovernedEvidenceLink[]> {
  const { organizationId, engagementId } = args;

  const rows = await pg.query<{
    link_id: string;
    evidence_id: string;
    requirement_id: string;
    requirement_reference: string | null;
    assurance_class: string;
    validity_basis: string;
    valid_until: string | null;
    confirmed_at: string;
    superseded_by_newer: boolean;
  }>(
    `SELECT el.id                          AS link_id,
            el.evidence_id,
            el.target_requirement_id       AS requirement_id,
            CASE WHEN f.id IS NOT NULL THEN r.reference_id END
                                           AS requirement_reference,
            e.assurance_class,
            e.validity_basis,
            e.valid_until::text            AS valid_until,
            el.confirmed_at::text          AS confirmed_at,
            (${SQL_EVIDENCE_SUPERSEDED})   AS superseded_by_newer
       FROM evidence_links el
       JOIN evidence e
         ON e.id = el.evidence_id
        AND e.organization_id = el.organization_id
       LEFT JOIN requirements r
         ON r.id = el.target_requirement_id
       -- The org gate on the reference: frameworks carries organization_id and
       -- requirements does not, and NEITHER has RLS. No match here means the
       -- reference renders NULL rather than another tenant's text.
       LEFT JOIN frameworks f
         ON f.id = r.framework_id
        AND f.organization_id = el.organization_id
      WHERE el.organization_id = $1
        AND el.target_type = 'vendor_engagement'
        AND el.target_id = $2
        AND el.target_requirement_id IS NOT NULL
        AND ${SQL_EVIDENCE_COUNTING}
      ORDER BY el.confirmed_at DESC, el.id`,
    [organizationId, engagementId]
  );

  return rows.rows.map((row) => ({
    linkId: row.link_id,
    evidenceId: row.evidence_id,
    requirementId: row.requirement_id,
    requirementReference: row.requirement_reference,
    assuranceClass: row.assurance_class,
    validityBasis: row.validity_basis,
    validUntil: row.valid_until,
    confirmedAt: row.confirmed_at,
    supersededByNewerVersion: row.superseded_by_newer === true,
    counts: false as const,
    reason: TESTED_CONTROL_CAPABLE_CLASSES.has(row.assurance_class)
      ? ("awaiting_sufficiency_determination" as const)
      : ("no_tested_control_authority" as const),
  }));
}

/**
 * Compute the coverage for one engagement.
 *
 * Runs inside the caller's tenant scope (asTenant / withTenant); every join
 * still carries organization_id at each hop, because RLS is the backstop and
 * never the only guard.
 */
export async function resolveAssuranceCoverage(args: {
  organizationId: string;
  engagementId: string;
  /** ISO date to evaluate currency against. Defaults to today (UTC). */
  asOf?: string;
}): Promise<AssuranceCoverage> {
  const { organizationId, engagementId } = args;
  const asOf =
    args.asOf && ISO_DATE.test(args.asOf) ? args.asOf : new Date().toISOString().slice(0, 10);

  const rows = await pg.query<{
    determination_id: string;
    document_id: string;
    requirement_reference: string;
    requirement_id: string | null;
    report_type: string | null;
    report_period_end: string | null;
  }>(
    `SELECT d.id                    AS determination_id,
            d.document_id,
            d.requirement_reference,
            r.id                    AS requirement_id,
            ex.fields->'report_type'->>'value'        AS report_type,
            ex.fields->'report_period_end'->>'value'  AS report_period_end
       FROM vendor_requirement_sufficiency_determinations d
       JOIN vendor_assurance_documents doc
         ON doc.id = d.document_id
        AND doc.organization_id = d.organization_id
        AND doc.processing_status = 'approved'
       JOIN vendor_engagements ve
         ON ve.id = $2
        AND ve.organization_id = d.organization_id
        AND ve.vendor_id = doc.vendor_id
       JOIN vendor_assurance_extractions ex
         ON ex.id = d.extraction_id
        AND ex.organization_id = d.organization_id
       LEFT JOIN frameworks f
         ON f.organization_id = d.organization_id
        AND f.framework_key = d.requirement_framework_key
        AND f.version = d.requirement_framework_version
       LEFT JOIN requirements r
         ON r.framework_id = f.id
        AND r.reference_id = d.requirement_reference
      WHERE d.organization_id = $1
        AND d.superseded_at IS NULL
        AND d.determination = 'SUFFICIENT'
        -- READ-TIME CONTRADICTION GUARD. The write-time veto blocks a
        -- SUFFICIENT from walking past a live INSUFFICIENT — but the reverse
        -- order (SUFFICIENT first, INSUFFICIENT recorded later from another
        -- resolution) leaves both live, and a requirement whose governed
        -- judgements CONFLICT must not count. Found live on staging by the
        -- step-5 active-phase acceptance, not by inspection: the harness
        -- accidentally built a second chain and the predicate kept counting.
        AND NOT EXISTS (
          SELECT 1
            FROM vendor_requirement_sufficiency_determinations x
            JOIN vendor_assurance_documents xdoc
              ON xdoc.id = x.document_id AND xdoc.organization_id = x.organization_id
           WHERE x.organization_id = d.organization_id
             AND x.superseded_at IS NULL
             AND x.determination = 'INSUFFICIENT'
             AND x.requirement_framework_key = d.requirement_framework_key
             AND x.requirement_framework_version = d.requirement_framework_version
             AND x.requirement_reference = d.requirement_reference
             AND xdoc.vendor_id = doc.vendor_id
        )
      ORDER BY d.determined_at DESC`,
    [organizationId, engagementId]
  );

  const covered: CoveredRequirement[] = [];
  const gaps: CoverageGap[] = [];

  // The conflicted requirements the WHERE above excluded, surfaced as GAPS —
  // a conflict is the most important thing a reviewer can be shown, not a row
  // to quietly drop.
  const conflicted = await pg.query<{ determination_id: string; requirement_reference: string }>(
    `SELECT d.id AS determination_id, d.requirement_reference
       FROM vendor_requirement_sufficiency_determinations d
       JOIN vendor_assurance_documents doc
         ON doc.id = d.document_id AND doc.organization_id = d.organization_id
       JOIN vendor_engagements ve
         ON ve.id = $2 AND ve.organization_id = d.organization_id
        AND ve.vendor_id = doc.vendor_id
      WHERE d.organization_id = $1
        AND d.superseded_at IS NULL
        AND d.determination = 'SUFFICIENT'
        AND EXISTS (
          SELECT 1
            FROM vendor_requirement_sufficiency_determinations x
            JOIN vendor_assurance_documents xdoc
              ON xdoc.id = x.document_id AND xdoc.organization_id = x.organization_id
           WHERE x.organization_id = d.organization_id
             AND x.superseded_at IS NULL
             AND x.determination = 'INSUFFICIENT'
             AND x.requirement_framework_key = d.requirement_framework_key
             AND x.requirement_framework_version = d.requirement_framework_version
             AND x.requirement_reference = d.requirement_reference
             AND xdoc.vendor_id = doc.vendor_id
        )`,
    [organizationId, engagementId]
  );
  for (const row of conflicted.rows) {
    gaps.push({
      determinationId: row.determination_id,
      requirementReference: row.requirement_reference,
      requirementId: null,
      reason: "conflicting_governed_judgement",
      detail: { note: "A live INSUFFICIENT stands on the same requirement identity for this vendor. Conflicting governed judgements never count; resolve the conflict by superseding one of them." },
    });
  }
  /** One requirement counts once; the newest current determination wins. */
  const seen = new Set<string>();

  // The policy lookup is per-class, cached across rows: same machinery as the
  // curation path, one source of truth for what a window is.
  const policyCache = new Map<string, Awaited<ReturnType<typeof loadEffectivePolicy>>>();

  for (const row of rows.rows) {
    const gap = (reason: CoverageExclusionReason, detail: Record<string, unknown> = {}): void => {
      gaps.push({
        determinationId: row.determination_id,
        requirementReference: row.requirement_reference,
        requirementId: row.requirement_id,
        reason,
        detail,
      });
    };

    if (row.requirement_id === null) {
      gap("requirement_identity_unresolved", {
        note: "The determination's framework identity resolves to no requirement in this organization.",
      });
      continue;
    }
    if (seen.has(row.requirement_id)) continue;

    const assuranceClass = assuranceClassForReportType(row.report_type);
    if (assuranceClass === null) {
      gap("report_type_unclassifiable", { report_type: row.report_type });
      continue;
    }
    const periodEnd = row.report_period_end?.trim() ?? "";
    if (!ISO_DATE.test(periodEnd)) {
      gap("report_period_end_unparseable", { report_period_end: row.report_period_end });
      continue;
    }

    let eff = policyCache.get(assuranceClass);
    if (!eff) {
      eff = await loadEffectivePolicy(organizationId, assuranceClass);
      policyCache.set(assuranceClass, eff);
    }

    const window = resolveValidityWindow({
      policy: eff.policy,
      orgDurationMonths: eff.orgDurationMonths,
      anchorDate: periodEnd,
      artifactAssertedUntil: null,
    });

    if (window.basis !== "policy_default") {
      // Report the ACTUAL refusal. Collapsing every non-window outcome into
      // "the policy establishes no window" told a customer the wrong thing
      // about a requirement that had silently stopped counting: a breached
      // ceiling and a missing bridge are both fixable, and neither is the
      // policy declining to establish anything.
      gap(REFUSAL_TO_GAP[window.reason] ?? "policy_establishes_no_window", {
        assurance_class: assuranceClass,
        window_reason: window.reason,
        policy_version: eff.policyVersion,
      });
      continue;
    }
    if (!isWindowCurrent(window, asOf)) {
      gap("validity_window_expired", {
        valid_until: window.validUntil, as_of: asOf, assurance_class: assuranceClass,
      });
      continue;
    }

    seen.add(row.requirement_id);
    covered.push({
      requirementId: row.requirement_id,
      requirementReference: row.requirement_reference,
      determinationId: row.determination_id,
      documentId: row.document_id,
      validUntil: window.validUntil,
      validitySource: window.source,
      reportPeriodEnd: periodEnd,
      assuranceClass,
      policyVersion: eff.policyVersion,
    });
  }

  // The governed-evidence arm is computed LAST and kept in its own field. It is
  // deliberately not merged into `covered` or `gaps`: `covered` drives depth
  // reduction and `gaps` is the determination-side explanation. A read failure
  // here must never lose the coverage answer, so it degrades to an empty list
  // in the safe direction — visible-nothing, never counted-something.
  let governedEvidence: GovernedEvidenceLink[] = [];
  try {
    governedEvidence = await resolveGovernedEvidenceLinks({ organizationId, engagementId });
  } catch {
    governedEvidence = [];
  }

  return {
    version: ASSURANCE_COVERAGE_VERSION,
    asOf,
    engagementId,
    covered,
    gaps,
    governedEvidence,
    governedEvidenceVersion: GOVERNED_EVIDENCE_SURFACE_VERSION,
  };
}
