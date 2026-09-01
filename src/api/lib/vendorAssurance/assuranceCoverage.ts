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
import { loadEffectivePolicy } from "../evidenceLinkWriter.js";

export const ASSURANCE_COVERAGE_VERSION = "assurance-coverage-1.0";

export type CoverageExclusionReason =
  | "requirement_identity_unresolved"
  | "report_type_unclassifiable"
  | "report_period_end_unparseable"
  | "no_ratified_validity_policy"
  | "policy_establishes_no_window"
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
};

export type CoverageGap = {
  determinationId: string;
  requirementReference: string;
  requirementId: string | null;
  reason: CoverageExclusionReason;
  detail: Record<string, unknown>;
};

export type AssuranceCoverage = {
  version: string;
  asOf: string;
  engagementId: string;
  covered: CoveredRequirement[];
  /** SUFFICIENT determinations that did NOT count, and exactly why. */
  gaps: CoverageGap[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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
      ORDER BY d.determined_at DESC`,
    [organizationId, engagementId]
  );

  const covered: CoveredRequirement[] = [];
  const gaps: CoverageGap[] = [];
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
      gap(
        window.reason === "no_ratified_policy" ? "no_ratified_validity_policy" : "policy_establishes_no_window",
        { assurance_class: assuranceClass, window_reason: window.reason }
      );
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
    });
  }

  return { version: ASSURANCE_COVERAGE_VERSION, asOf, engagementId, covered, gaps };
}
