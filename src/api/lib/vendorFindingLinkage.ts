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
 * THE FOURTH ARM — ENGAGEMENT-PROMOTED FINDINGS
 * ---------------------------------------------
 * The Vendor Assurance engagement spine promotes failed, partial and unanswered
 * controls to findings with `source_type='vendor_engagement'` and
 * `source_id=<vendor_engagements.id>` (promoteEngagementFindings in
 * vendorEngagements.ts). This writer obeys the platform source_id convention
 * EXACTLY — and, unlike 'vendor_review', the tag was deliberately minted with
 * one writer and one target table (20260928_vendor_engagement_findings.sql:
 * source_type is a pointer type, not a label; reusing 'vendor_review' would
 * have made every consumer follow the id into the wrong table, silently,
 * because both columns are UUIDs). That is what makes the join safe: under this
 * tag there is exactly one table a source_id can mean.
 *
 * The arm is still convention-backed, not FK-backed: nothing in the schema
 * stops a `vendor_engagement` source_id from dangling. So — the mirror image of
 * the CUEC arm — the source_type filter here is LOAD-BEARING: the tag is the
 * only thing that gives the id its meaning, and joining without it would let a
 * `vendor_engagements.id` accidentally equal to some other workflow's row id
 * fabricate an edge.
 *
 * TENANCY — EVERY JOIN IS ORG-SCOPED ON BOTH SIDES
 * ------------------------------------------------
 * The two readers this replaces joined `vendor_assessments` / `vendor_reviews`
 * with no org predicate on the joined table. Findings were scoped, so no
 * finding could leak — but a colliding id could have surfaced another org's
 * `assessment_id` / `assessment_type` / `performed_at`, or attributed a foreign
 * assessment's vendor. Random UUIDs made that impractical rather than
 * impossible; the predicate was simply missing. Every join below carries it —
 * the engagement arm included: without `e.organization_id = f.organization_id`,
 * an engagement id colliding across orgs would attach the OTHER org's vendor_id
 * (and surface its submission date) on this org's finding, or hang this org's
 * finding on a foreign vendor.
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
 *   source_record_id  the workflow row: assessment, review cycle, CUEC, or
 *                     engagement
 *   source_label      what to call it on a surface (assessment_type, or the arm)
 *   source_at         when the producing act happened, as a DATE
 *
 * `source_at` is cast to DATE in the CUEC arm on purpose: `performed_at` is a
 * DATE in the first two arms, and a UNION of DATE with TIMESTAMPTZ resolves to
 * TIMESTAMPTZ — which would silently change how every EXISTING row serialises
 * on an endpoint that has always returned a date.
 *
 * The engagement arm's `source_at` is `COALESCE(e.submitted_at, e.created_at)`,
 * cast to DATE for the same UNION reason (both columns are TIMESTAMPTZ).
 * `submitted_at` is the meaningful timestamp: promoted findings are read off
 * the vendor's SUBMITTED answers, so the submission is the producing act —
 * `created_at` predates any answer and `closed_at` postdates the promotion.
 * But `submitted_at` is nullable (promotion is gated on inherent_rating, not on
 * lifecycle position), and an arm that emits NULL where every other arm always
 * emits a date would push that special case onto every surface; `created_at` is
 * NOT NULL and is the honest fallback — the engagement existed, even if its
 * submission was never stamped.
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

  UNION ALL

  SELECT f.id,
         f.organization_id,
         e.vendor_id,
         'vendor_engagement'::text,
         e.id::text,
         'vendor_engagement'::text,
         COALESCE(e.submitted_at, e.created_at)::date
    FROM findings f
    JOIN vendor_engagements e
      ON e.id::text = f.source_id::text
     AND e.organization_id = f.organization_id
   WHERE f.source_type = 'vendor_engagement'
`;

/**
 * The same edges, deduplicated to one row per (finding, vendor).
 *
 * Use this wherever findings are COUNTED or SCORED. The four arms are disjoint
 * in practice — a `vendors.id` written as source_id cannot also match a
 * `vendor_assessments.id`, and the source_type filters keep the two
 * source_id-conventional tags apart — but "in practice" is exactly the
 * reasoning that produced this defect, and a duplicated edge would
 * double-count a finding's severity against its vendor's score. DISTINCT costs
 * nothing here and removes the possibility.
 */
export const VENDOR_FINDING_EDGES_SQL = `
  SELECT DISTINCT finding_id, organization_id, vendor_id
    FROM (${VENDOR_FINDING_LINKAGE_SQL}) linkage_all
`;

/**
 * Preference order when a finding somehow matches more than one arm. Used where
 * a single row must be chosen (resolution, and the vendor findings list).
 *
 *   0  vendor_assurance_cuec — the only FK-enforced relationship. The database
 *      guarantees it, so it outranks every convention-based arm.
 *   1  vendor_engagement — source_id-conventional, so it can never outrank the
 *      FK; but the tag has exactly one writer and resolves to exactly one table
 *      by ratified schema decision (20260928_vendor_engagement_findings.sql),
 *      so a match is unambiguous and outranks the legacy arms.
 *   2  the legacy arms — 'vendor_review' has TWO writers with two different
 *      source_id semantics, which is exactly the ambiguity this file exists to
 *      contain.
 *
 * Takes the column reference so callers can alias the subquery without a
 * string rewrite at the call site.
 */
export function vendorFindingLinkagePriority(linkageColumn: string): string {
  return `CASE ${linkageColumn} WHEN 'vendor_assurance_cuec' THEN 0 WHEN 'vendor_engagement' THEN 1 ELSE 2 END`;
}
