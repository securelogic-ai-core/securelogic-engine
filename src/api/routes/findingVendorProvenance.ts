/**
 * findingVendorProvenance.ts — GET /api/findings/:id/vendor-provenance
 *
 * T1-B (document/CUEC arm) + VA-10 (engagement arm). The return path of the
 * Vendor Assurance chain — both spines of it, per ADR-0010 Option 4:
 * convergence at the Finding means the Finding must be able to point back at
 * whichever spine produced it.
 *
 * WHY THIS EXISTS
 * ---------------
 * Provenance was one-directional. `CuecDeterminationPanel` links CUEC -> Finding,
 * and nothing linked Finding -> CUEC: `findings/[id]/page.tsx` rendered only a
 * `source_type` label ("Vendor Assessment"). A reader who arrived at a promoted
 * finding could not answer the question the finding exists to answer — *which
 * vendor obligation is this, who decided we do not meet it, and on what basis*.
 * That is VA-3 gate 12, and it is the reason the gate is a predicted FAIL.
 *
 * WHY NOT /findings/:id/context
 * -----------------------------
 * That endpoint is the obvious-looking home and it is the wrong one: it
 * short-circuits to 404 unless SECURELOGIC_DECISION_WORKSPACE_ENABLED === "true",
 * and that flag is false in production. Provenance has to work in the STANDARD
 * findings layout, for the advertised Findings workflow, so it cannot live behind
 * the Decision Workspace flag. This follows `findingAssetOccurrences.ts` and
 * `findingRiskLinks.ts` instead — entitlement-gated, not flag-gated.
 *
 * WHY THE VENDOR IS **NOT** RESOLVED FROM findings.source_id
 * ----------------------------------------------------------
 * READ THIS BEFORE "SIMPLIFYING" THE QUERY BELOW.
 *
 * `source_type = 'vendor_review'` has two writers with INCOMPATIBLE source_id
 * semantics:
 *
 *   vendorAssessments.ts    -> source_id = vendor_assessments.id  ("NOT vendor_id",
 *                              says its own comment)
 *   vendorAssuranceDocuments.ts (CUEC promotion)
 *                           -> source_id = vendors.id
 *
 * So `source_id` is ambiguous for this source type and joining it to `vendors`
 * would produce a plausible-looking wrong answer for assessment-sourced findings.
 * The vendor is therefore resolved along the unambiguous chain
 *
 *     finding <- vendor_assurance_cuecs.promoted_finding_id
 *             -> vendor_assurance_documents.document_id
 *             -> vendors.vendor_id
 *
 * which is true by construction for exactly the findings this endpoint describes.
 *
 * (The same ambiguity is a live defect elsewhere: resolveVendorForFinding() in
 * vendorRiskScoreRecompute.ts joins vendor_assessments on source_id, so it
 * resolves NULL for every CUEC-promoted finding and those gaps never reach the
 * vendor risk score. Reported separately; deliberately NOT fixed here, because
 * this package is read-only.)
 *
 * ABSENCE IS AN ANSWER, NOT AN ERROR
 * ----------------------------------
 * A `vendor_review` finding with no CUEC row is legitimate — it came from a vendor
 * assessment rather than a document review. The response says so
 * (`source: "vendor_assessment"`) rather than 404-ing, for the same reason
 * AffectedAssetsPanel reports "no asset recorded" as a state.
 *
 * TENANCY
 * -------
 * Every join is org-scoped on BOTH sides. A provenance query that scopes only the
 * root row is a cross-tenant read waiting for a mismatched id.
 */

import { Router } from "express";

import { pg } from "../infra/postgres.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { asTenant } from "../middleware/asTenant.js";

const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

function orgOf(req: unknown): string | null {
  return (
    (req as { organizationContext?: { organizationId?: string } })
      .organizationContext?.organizationId ?? null
  );
}

/**
 * Mirrors the guard set on findingRiskLinks / findingAssetOccurrences rather than
 * inventing a read-only variant. denyContributor() is a passthrough while the seat
 * model is dark; keeping the posture identical across the three finding-detail
 * panels means they activate together rather than one of them surprising someone.
 */
const GUARDS = [
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  denyContributor(),
] as const;

type EngagementProvenanceRow = {
  engagement_id: string;
  engagement_title: string | null;
  engagement_type: string;
  engagement_status: string;
  decision: string | null;
  decided_at: string | null;
  submitted_at: string | null;
  methodology_version: string;
  vendor_id: string;
  vendor_name: string;
  requirement_id: string | null;
  requirement_reference: string | null;
  requirement_title: string | null;
  severity_rationale: string | null;
  current_response: string | null;
  response_as_of: string | null;
  responder_type: string | null;
};

type ProvenanceRow = {
  cuec_id: string;
  ordinal: number;
  cuec_text: string;
  review_status: string;
  review_status_reason: string | null;
  review_status_updated_at: string | null;
  gap_basis: unknown;
  reviewer_user_id: string | null;
  reviewer_email: string | null;
  reviewer_name: string | null;
  document_id: string;
  original_filename: string;
  document_sha256: string;
  document_type_hint: string | null;
  document_status: string;
  vendor_id: string;
  vendor_name: string;
};

/* =========================================================
   GET /api/findings/:id/vendor-provenance
   Where a promoted finding came from: vendor -> document -> CUEC -> reviewer.
   ========================================================= */

router.get(
  "/findings/:id/vendor-provenance",
  ...GUARDS,
  asTenant(async (req, res) => {
    const organizationId = orgOf(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const findingId = String(req.params.id ?? "").trim();
    if (!isUuid(findingId)) {
      res.status(400).json({ error: "invalid_finding_id" });
      return;
    }

    // Same-org existence check first, so a cross-org id is 404 and not an empty
    // provenance payload that reads like "this finding has no source".
    const finding = await pg.query<{ source_type: string }>(
      `SELECT source_type FROM findings
        WHERE id = $1 AND organization_id = $2 LIMIT 1`,
      [findingId, organizationId]
    );
    if ((finding.rowCount ?? 0) === 0) {
      res.status(404).json({ error: "finding_not_found" });
      return;
    }
    const sourceType = finding.rows[0]!.source_type;

    /* ---------------------------------------------------------
       VA-10 — the engagement arm.

       `source_type='vendor_engagement'` obeys the platform source_id
       convention exactly (one writer, one target table, ratified by the
       20260928 schema decision), so HERE — unlike the vendor_review branch
       below — joining source_id IS the correct resolution, with the
       source_type filter load-bearing exactly as it is in
       vendorFindingLinkage.ts arm 4. The arm is convention-backed, not
       FK-backed: a dangling source_id legitimately resolves to nothing, and
       the response says so rather than 404-ing.

       The current requirement_responses row is included DELIBERATELY and
       labeled as current: per the supersede-on-pass ruling (2026-08-22), a
       control that now reports pass/not_applicable never closes the finding
       — but the divergence must be NAMED everywhere a human looks, and the
       finding detail page is exactly such a place. severity_rationale is the
       promotion-time snapshot; the response row is today's source assertion.
       The panel labels which is which.
       --------------------------------------------------------- */
    if (sourceType === "vendor_engagement") {
      const eng = await pg.query<EngagementProvenanceRow>(
        `SELECT e.id                    AS engagement_id,
                e.title                 AS engagement_title,
                e.engagement_type       AS engagement_type,
                e.status                AS engagement_status,
                e.decision              AS decision,
                e.decided_at            AS decided_at,
                e.submitted_at          AS submitted_at,
                e.methodology_version   AS methodology_version,
                v.id                    AS vendor_id,
                v.name                  AS vendor_name,
                r.id                    AS requirement_id,
                r.reference_id          AS requirement_reference,
                r.title                 AS requirement_title,
                f.severity_rationale    AS severity_rationale,
                rr.status               AS current_response,
                rr.assessed_at          AS response_as_of,
                rr.responder_type       AS responder_type
           FROM findings f
           JOIN vendor_engagements e
             ON e.id::text = f.source_id::text
            AND e.organization_id = f.organization_id
           JOIN vendors v
             ON v.id = e.vendor_id
            AND v.organization_id = e.organization_id
           LEFT JOIN requirements r
             ON r.id = f.requirement_id
           LEFT JOIN requirement_responses rr
             ON rr.organization_id = f.organization_id
            AND rr.engagement_id   = e.id
            AND rr.requirement_id  = f.requirement_id
          WHERE f.id = $1
            AND f.organization_id = $2
            AND f.source_type = 'vendor_engagement'
          LIMIT 1`,
        [findingId, organizationId]
      );

      if ((eng.rowCount ?? 0) === 0) {
        // Dangling source_id — the convention arm's honest failure mode.
        res.json({
          finding_id: findingId,
          source_type: sourceType,
          source: "vendor_engagement",
          provenance: null,
          engagement_provenance: null,
        });
        return;
      }

      const e = eng.rows[0]!;
      res.json({
        finding_id: findingId,
        source_type: sourceType,
        source: "vendor_engagement",
        provenance: null,
        engagement_provenance: {
          vendor: { id: e.vendor_id, name: e.vendor_name },
          engagement: {
            id: e.engagement_id,
            title: e.engagement_title,
            engagement_type: e.engagement_type,
            status: e.engagement_status,
            decision: e.decision,
            decided_at: e.decided_at,
            submitted_at: e.submitted_at,
            methodology_version: e.methodology_version,
          },
          requirement: e.requirement_id
            ? {
                id: e.requirement_id,
                reference: e.requirement_reference,
                title: e.requirement_title,
              }
            : null,
          severity_rationale: e.severity_rationale,
          current_response: e.current_response
            ? {
                status: e.current_response,
                as_of: e.response_as_of,
                responder_type: e.responder_type,
              }
            : null,
        },
      });
      return;
    }

    // Not a vendor-sourced finding at all: say so plainly. The panel renders
    // nothing rather than an empty box.
    if (sourceType !== "vendor_review") {
      res.json({
        finding_id: findingId,
        source_type: sourceType,
        source: "not_applicable",
        provenance: null,
      });
      return;
    }

    const result = await pg.query<ProvenanceRow>(
      `SELECT c.id                                   AS cuec_id,
              c.ordinal                              AS ordinal,
              c.cuec_text                            AS cuec_text,
              c.review_status                        AS review_status,
              c.review_status_reason                 AS review_status_reason,
              c.review_status_updated_at             AS review_status_updated_at,
              c.gap_basis                            AS gap_basis,
              c.review_status_updated_by_user_id     AS reviewer_user_id,
              u.email                                AS reviewer_email,
              u.name                                 AS reviewer_name,
              d.id                                   AS document_id,
              d.original_filename                    AS original_filename,
              d.sha256                               AS document_sha256,
              d.document_type_hint                   AS document_type_hint,
              d.processing_status                    AS document_status,
              v.id                                   AS vendor_id,
              v.name                                 AS vendor_name
         FROM vendor_assurance_cuecs c
         JOIN vendor_assurance_documents d
           ON d.id = c.document_id
          AND d.organization_id = c.organization_id
         JOIN vendors v
           ON v.id = d.vendor_id
          AND v.organization_id = d.organization_id
         LEFT JOIN users u
           ON u.id = c.review_status_updated_by_user_id
          AND u.organization_id = c.organization_id
        WHERE c.promoted_finding_id = $1
          AND c.organization_id     = $2
        LIMIT 1`,
      [findingId, organizationId]
    );

    if ((result.rowCount ?? 0) === 0) {
      // A vendor_review finding with no CUEC came from a vendor assessment.
      // Legitimate, and deliberately not an error.
      res.json({
        finding_id: findingId,
        source_type: sourceType,
        source: "vendor_assessment",
        provenance: null,
      });
      return;
    }

    const r = result.rows[0]!;
    res.json({
      finding_id: findingId,
      source_type: sourceType,
      source: "vendor_assurance_cuec",
      provenance: {
        vendor: { id: r.vendor_id, name: r.vendor_name },
        document: {
          id: r.document_id,
          original_filename: r.original_filename,
          sha256: r.document_sha256,
          document_type_hint: r.document_type_hint,
          processing_status: r.document_status,
        },
        cuec: {
          id: r.cuec_id,
          ordinal: r.ordinal,
          text: r.cuec_text,
          review_status: r.review_status,
        },
        determination: {
          review_status: r.review_status,
          reason: r.review_status_reason,
          decided_at: r.review_status_updated_at,
          decided_by: r.reviewer_user_id
            ? {
                user_id: r.reviewer_user_id,
                email: r.reviewer_email,
                name: r.reviewer_name,
              }
            : null,
          basis: r.gap_basis ?? null,
        },
      },
    });
  })
);

export default router;
