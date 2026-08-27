/**
 * vendorFindingLinkage.ts — the ONE definition of "which vendor does this
 * finding belong to".
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `findings.source_id` is a POLYMORPHIC ASSOCIATION WITH NO FOREIGN KEY. Its
 * meaning is decided by `source_type`, by convention, in comments. The platform
 * convention is "source_id is the id of the row in the workflow table that
 * produced the finding" — and every writer obeys it except the Vendor Assurance
 * CUEC promotion, which writes a `vendors.id` under `source_type='vendor_review'`,
 * a source type whose other writer writes a `vendor_assessments.id`.
 *
 * The consequence was a silent relational hole, not a data error: a CUEC gap
 * promoted to a finding was correct and fully tracked in Findings, but
 *
 *   - did not appear on GET /api/vendors/:id/findings — the vendor page showed
 *     nothing, which reads as "the promotion failed";
 *   - was excluded from the vendor risk score TWICE, independently — once
 *     because the finding could not be resolved to a vendor at all, and again
 *     because the scoring query's own join dropped it.
 *
 * Fixing one reader and not the others is how that hole reopens. So the joins
 * live HERE, once, and the readers select from them.
 *
 * WHY THE CUEC ARM DOES NOT USE source_id
 * ---------------------------------------
 * READ THIS BEFORE "SIMPLIFYING" THE THIRD ARM.
 *
 * The authoritative relationship for a promoted CUEC is
 * `vendor_assurance_cuecs.promoted_finding_id`, and it is the STRONGEST link in
 * this area precisely because it is not source_id: it is a real foreign key
 * (`REFERENCES findings(id) ON DELETE SET NULL`), it carries a CHECK that only a
 * `gap` may hold one, and every hop onward to the vendor is FK-backed too:
 *
 *     findings.id
 *       <- vendor_assurance_cuecs.promoted_finding_id     (FK)
 *       -> vendor_assurance_documents.id via document_id  (FK)
 *       -> vendors.id via vendor_id                       (FK)
 *
 * source_id is deliberately NOT consulted for this arm, now or later. What the
 * promotion writes is not changed either: rewriting it to a fabricated
 * assessment id would invent an assessment that never happened.
 *
 * WHY THE ARM IS NOT FILTERED BY source_type
 * ------------------------------------------
 * `promoted_finding_id` is FK-enforced and single-purpose, so it already answers
 * the question on its own. Adding `AND f.source_type = 'vendor_review'` would
 * make a correct, database-guaranteed relationship depend on the same
 * convention-by-comment that caused this defect.
 *
 * TENANCY — EVERY JOIN IS ORG-SCOPED ON BOTH SIDES
 * ------------------------------------------------
 * The two readers this replaces joined `vendor_assessments` / `vendor_reviews`
 * with no org predicate on the joined table. Findings were scoped, so no
 * finding could leak — but a colliding id could have surfaced another org's
 * `assessment_id` / `assessment_type` / `performed_at`, or attributed a foreign
 * assessment's vendor. Random UUIDs made that impractical rather than
 * impossible; the predicate was simply missing. Every join below carries it.
 *
 * CALLERS MUST STILL SCOPE THE OUTER QUERY to the caller's organization
 * (`l.organization_id = $n`) and run inside a tenant scope. These fragments are
 * self-consistent, not self-authorising.
 */

/**
 * Every vendor <- finding edge in the platform, with the record that produced it.
 *
 * Columns:
 *   finding_id        findings.id
 *   organization_id   the org both sides belong to (equal across every join)
 *   vendor_id         vendors.id
 *   linkage           which relationship produced the edge
 *   source_record_id  the workflow row: assessment, review cycle, or CUEC
 *   source_label      what to call it on a surface (assessment_type, or the arm)
 *   source_at         when the producing act happened, as a DATE
 *
 * `source_at` is cast to DATE in the CUEC arm on purpose: `performed_at` is a
 * DATE in both other arms, and a UNION of DATE with TIMESTAMPTZ resolves to
 * TIMESTAMPTZ — which would silently change how every EXISTING row serialises
 * on an endpoint that has always returned a date.
 */
export const VENDOR_FINDING_LINKAGE_SQL = `
  SELECT f.id                      AS finding_id,
         f.organization_id         AS organization_id,
         va.vendor_id              AS vendor_id,
         'vendor_assessment'::text AS linkage,
         va.id::text               AS source_record_id,
         va.assessment_type::text  AS source_label,
         va.performed_at           AS source_at
    FROM findings f
    JOIN vendor_assessments va
      ON va.id::text = f.source_id::text
     AND va.organization_id = f.organization_id
   WHERE f.source_type = 'vendor_review'

  UNION ALL

  SELECT f.id,
         f.organization_id,
         vr.vendor_id,
         'vendor_cycle_review'::text,
         vr.id::text,
         'vendor_cycle_review'::text,
         vr.performed_at
    FROM findings f
    JOIN vendor_reviews vr
      ON vr.id::text = f.source_id::text
     AND vr.organization_id = f.organization_id
   WHERE f.source_type = 'vendor_cycle_review'

  UNION ALL

  SELECT f.id,
         f.organization_id,
         v.id,
         'vendor_assurance_cuec'::text,
         c.id::text,
         'vendor_assurance_cuec'::text,
         c.review_status_updated_at::date
    FROM findings f
    JOIN vendor_assurance_cuecs c
      ON c.promoted_finding_id = f.id
     AND c.organization_id = f.organization_id
    JOIN vendor_assurance_documents d
      ON d.id = c.document_id
     AND d.organization_id = c.organization_id
    JOIN vendors v
      ON v.id = d.vendor_id
     AND v.organization_id = d.organization_id
`;

/**
 * The same edges, deduplicated to one row per (finding, vendor).
 *
 * Use this wherever findings are COUNTED or SCORED. The three arms are disjoint
 * in practice — a `vendors.id` written as source_id cannot also match a
 * `vendor_assessments.id` — but "in practice" is exactly the reasoning that
 * produced this defect, and a duplicated edge would double-count a finding's
 * severity against its vendor's score. DISTINCT costs nothing here and removes
 * the possibility.
 */
export const VENDOR_FINDING_EDGES_SQL = `
  SELECT DISTINCT finding_id, organization_id, vendor_id
    FROM (${VENDOR_FINDING_LINKAGE_SQL}) linkage_all
`;

/**
 * Preference order when a finding somehow matches more than one arm: the
 * FK-enforced relationship wins over the convention-based ones. Used where a
 * single row must be chosen (resolution, and the vendor findings list).
 *
 * Takes the column reference so callers can alias the subquery without a
 * string rewrite at the call site.
 */
export function vendorFindingLinkagePriority(linkageColumn: string): string {
  return `CASE ${linkageColumn} WHEN 'vendor_assurance_cuec' THEN 0 ELSE 1 END`;
}
