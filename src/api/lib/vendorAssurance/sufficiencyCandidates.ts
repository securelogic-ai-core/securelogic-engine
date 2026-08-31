/**
 * sufficiencyCandidates.ts - VA-S4-4C-4. Assembling what the twelve vetoes are
 * evaluated against, for one document.
 *
 * A CANDIDATE is one (organisation requirement x tested control x document)
 * triple: 20261073 resolved a tested control to a canonical control, and the
 * governed crosswalk - inverted - says which of the organisation's own
 * requirements that canonical control maps to.
 *
 * Ruling 6: one tested control resolving to eight crosswalk rows produces EIGHT
 * candidates, not one covered requirement and not eight. The fan-out stays
 * visible, and each arm is judged separately.
 *
 * This module reads. It writes nothing and it concludes nothing.
 */

import { evaluateVetoes, type VetoEvaluation, type VetoInput } from "./sufficiencyVetoes.js";

type ClientLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

export type SufficiencyCandidate = {
  resolution_id: string;
  element_key: string;
  canonical_control_id: string;
  /** The vendor-side criterion the tested control IS, e.g. `CC6.1`. */
  tested_control_reference: string;
  /** The organisation-side requirement being judged. */
  requirement_framework_key: string;
  requirement_framework_version: string;
  requirement_reference: string;
  requirement_id: string | null;
  /** The crosswalk row that produced THIS candidate (the org-side mapping). */
  crosswalk_id: string;
  vetoes: VetoEvaluation[];
  determination: {
    id: string;
    determination: string;
    indeterminate_reason: string | null;
    determined_by_user_id: string | null;
    determined_at: string;
    reviewer_note: string | null;
    evaluator_version: string;
  } | null;
};

/** Unwrap the `{ value, status, confidence }` envelope every extracted field carries. */
function fieldValue(fields: Record<string, any> | null, name: string): unknown {
  return (fields ?? {})[name]?.value;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function asStringArray(v: unknown): string[] | null {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
}

export type CandidateLoadArgs = {
  organizationId: string;
  documentId: string;
  extractionId: string;
  /** The document's human-accepted report-level opinion (20261066/20261070). */
  acceptedOpinion: string | null;
  asOf?: Date;
};

const OVERRIDABLE_REPORT_FIELDS = [
  "report_type",
  "report_period_start",
  "report_period_end",
  "trust_services_criteria",
  "subservice_method",
];

export async function loadSufficiencyCandidates(
  client: ClientLike,
  args: CandidateLoadArgs
): Promise<SufficiencyCandidate[]> {
  const asOf = args.asOf ?? new Date();

  const ex = await client.query(
    `SELECT fields FROM vendor_assurance_extractions
      WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [args.extractionId, args.organizationId]
  );
  const fields: Record<string, any> | null = ex.rows[0]?.fields ?? null;
  if (fields === null) return [];

  // Report-level values, taking a live field override over the extraction where
  // one exists - the override is the GOVERNED value, and 20261072 required a
  // human to review every one of these fields before approval.
  const overrideRes = await client.query(
    `SELECT DISTINCT ON (field_name) field_name, override_value
       FROM vendor_assurance_field_overrides
      WHERE document_id = $1 AND organization_id = $2
        AND field_name = ANY($3::text[])
      ORDER BY field_name, overridden_at DESC, id DESC`,
    [args.documentId, args.organizationId, OVERRIDABLE_REPORT_FIELDS]
  );
  const overrides = new Map<string, unknown>();
  for (const row of overrideRes.rows) overrides.set(row.field_name, row.override_value);
  const effective = (name: string): unknown =>
    overrides.has(name) ? overrides.get(name) : fieldValue(fields, name);

  const reportType = asString(effective("report_type"));
  const reportPeriodStart = asString(effective("report_period_start"));
  const reportPeriodEnd = asString(effective("report_period_end"));
  const trustServicesCriteria = asStringArray(effective("trust_services_criteria"));
  const subserviceMethod = asString(effective("subservice_method"));
  const exceptionsFieldPresent = Object.prototype.hasOwnProperty.call(fields, "exceptions");

  // The candidate set. Inverting the governed crosswalk onto the organisation's
  // OWN frameworks is what turns a canonical control into a requirement it must
  // answer for.
  const candidateRes = await client.query(
    `SELECT r.id                     AS resolution_id,
            r.element_key,
            r.canonical_control_id,
            r.requirement_reference  AS tested_control_reference,
            cw.id                    AS crosswalk_id,
            cw.framework_key         AS requirement_framework_key,
            cw.framework_version     AS requirement_framework_version,
            cw.requirement_reference AS requirement_reference,
            cw.mapping_source,
            cw.status                AS mapping_status,
            (cw.approved_by_user_id IS NOT NULL) AS mapping_approved,
            req.id                   AS requirement_id
       FROM vendor_tested_control_resolutions r
       JOIN canonical_control_crosswalk cw
         ON cw.canonical_control_id = r.canonical_control_id
        AND cw.superseded_at IS NULL
       JOIN frameworks f
         ON f.organization_id = $2
        AND f.framework_key = cw.framework_key
        AND f.version = cw.framework_version
       LEFT JOIN requirements req
         ON req.framework_id = f.id
        AND req.reference_id = cw.requirement_reference
      WHERE r.document_id = $1
        AND r.organization_id = $2
        AND r.superseded_at IS NULL
        AND r.resolution_state = 'resolved'
      ORDER BY r.element_key, cw.framework_key, cw.framework_version, cw.requirement_reference`,
    [args.documentId, args.organizationId]
  );
  if (candidateRes.rows.length === 0) return [];

  // Layer 2, per tested control.
  const effRes = await client.query(
    `SELECT element_key, decision, governed_effectiveness
       FROM vendor_tested_control_effectiveness
      WHERE extraction_id = $1 AND organization_id = $2 AND superseded_at IS NULL`,
    [args.extractionId, args.organizationId]
  );
  const effectiveness = new Map<string, { decision: string; governed: string | null }>();
  for (const row of effRes.rows) {
    effectiveness.set(row.element_key, {
      decision: row.decision,
      governed: row.governed_effectiveness,
    });
  }

  // Layer 3, per tested control, through the many-to-many link table.
  const excRes = await client.query(
    `SELECT ec.element_key, e.governed_effect
       FROM vendor_assurance_exception_controls ec
       JOIN vendor_assurance_exceptions e ON e.id = ec.exception_id
      WHERE e.extraction_id = $1 AND e.organization_id = $2 AND e.superseded_at IS NULL`,
    [args.extractionId, args.organizationId]
  );
  const linkedExceptions = new Map<string, { governedEffect: string | null }[]>();
  for (const row of excRes.rows) {
    const list = linkedExceptions.get(row.element_key) ?? [];
    list.push({ governedEffect: row.governed_effect });
    linkedExceptions.set(row.element_key, list);
  }

  // Veto 9's substrate check, and the reason it is a check at all.
  //
  // `findings.framework_control_id` is TEXT, carries no foreign key and is NULL
  // on every finding measured on staging. If nothing in this organisation
  // populates it, a per-control count of zero means "the dimension is empty",
  // NOT "this control is clean" - so we pass null and the veto records
  // NOT_EVALUABLE instead of a vacuous PASSED.
  const dimensionRes = await client.query(
    `SELECT COUNT(*)::int AS dimensioned
       FROM findings
      WHERE organization_id = $1
        AND status IN ('open', 'in_progress')
        AND framework_control_id IS NOT NULL`,
    [args.organizationId]
  );
  const dimensionPopulated = (dimensionRes.rows[0]?.dimensioned ?? 0) > 0;

  const findingCounts = new Map<string, number>();
  if (dimensionPopulated) {
    const canonicalIds = [...new Set(candidateRes.rows.map((r) => r.canonical_control_id))];
    const countRes = await client.query(
      `SELECT cci.canonical_control_id, COUNT(*)::int AS n
         FROM findings fi
         JOIN control_canonical_identities cci
           ON cci.control_id::text = fi.framework_control_id
          AND cci.organization_id = $1
        WHERE fi.organization_id = $1
          AND fi.status IN ('open', 'in_progress')
          AND cci.canonical_control_id = ANY($2::uuid[])
        GROUP BY 1`,
      [args.organizationId, canonicalIds]
    );
    for (const row of countRes.rows) findingCounts.set(row.canonical_control_id, row.n);
  }

  // Any live determination already recorded, so the reader sees the decision
  // beside the evaluation rather than having to join it back.
  const detRes = await client.query(
    `SELECT id, resolution_id, requirement_framework_key, requirement_framework_version,
            requirement_reference, determination, indeterminate_reason,
            determined_by_user_id, determined_at, reviewer_note, evaluator_version
       FROM vendor_requirement_sufficiency_determinations
      WHERE document_id = $1 AND organization_id = $2 AND superseded_at IS NULL`,
    [args.documentId, args.organizationId]
  );
  const determinationKey = (
    resolutionId: string,
    key: string,
    version: string,
    ref: string
  ): string => `${resolutionId} ${key} ${version} ${ref}`;
  const determinations = new Map<string, SufficiencyCandidate["determination"]>();
  for (const row of detRes.rows) {
    determinations.set(
      determinationKey(
        row.resolution_id,
        row.requirement_framework_key,
        row.requirement_framework_version,
        row.requirement_reference
      ),
      {
        id: row.id,
        determination: row.determination,
        indeterminate_reason: row.indeterminate_reason,
        determined_by_user_id: row.determined_by_user_id,
        determined_at:
          row.determined_at instanceof Date
            ? row.determined_at.toISOString()
            : String(row.determined_at),
        reviewer_note: row.reviewer_note,
        evaluator_version: row.evaluator_version,
      }
    );
  }

  return candidateRes.rows.map((row): SufficiencyCandidate => {
    const eff = effectiveness.get(row.element_key) ?? null;
    const input: VetoInput = {
      // Scope is judged against the criterion the TESTED CONTROL is - the
      // report scopes itself in vendor-side terms, never in the customer's.
      requirementReference: row.tested_control_reference,
      reportType,
      reportPeriodStart,
      reportPeriodEnd,
      trustServicesCriteria,
      subserviceMethod,
      exceptionsFieldPresent,
      linkedExceptions: linkedExceptions.get(row.element_key) ?? [],
      acceptedOpinion: args.acceptedOpinion,
      effectivenessDecision: eff?.decision ?? null,
      governedEffectiveness: eff?.governed ?? null,
      mappingSource: row.mapping_source ?? null,
      mappingStatus: row.mapping_status ?? null,
      mappingApproved: row.mapping_approved === true,
      openFindingsOnCanonicalControl: dimensionPopulated
        ? findingCounts.get(row.canonical_control_id) ?? 0
        : null,
      contradictoryEvidenceQueryable: false,
      asOf,
    };
    return {
      resolution_id: row.resolution_id,
      element_key: row.element_key,
      canonical_control_id: row.canonical_control_id,
      tested_control_reference: row.tested_control_reference,
      requirement_framework_key: row.requirement_framework_key,
      requirement_framework_version: row.requirement_framework_version,
      requirement_reference: row.requirement_reference,
      requirement_id: row.requirement_id ?? null,
      crosswalk_id: row.crosswalk_id,
      vetoes: evaluateVetoes(input),
      determination:
        determinations.get(
          determinationKey(
            row.resolution_id,
            row.requirement_framework_key,
            row.requirement_framework_version,
            row.requirement_reference
          )
        ) ?? null,
    };
  });
}
