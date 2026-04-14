/**
 * evidence.ts — Evidence primitives API
 *
 * Evidence records are org-scoped metadata attachments to assessment/workflow
 * records. They are immutable after creation.
 *
 * IMMUTABILITY:
 *   Evidence records are write-once. There is no PATCH and no DELETE route.
 *   Multiple evidence records may exist for the same source record.
 *
 * LINKAGE TARGETS:
 *   source_type = 'control_test'       -> control_assessments
 *   source_type = 'vendor_review'      -> vendor_assessments
 *   source_type = 'ai_review'          -> governance_reviews
 *   source_type = 'obligation_review'  -> obligation_assessments
 *
 * SCOPE:
 *   Metadata only. No file upload, no blob storage, no binary attachments.
 *
 * Routes:
 *   POST /api/evidence           — create evidence record
 *   GET  /api/evidence           — list by source_type + source_id (both required)
 *   GET  /api/evidence/:id       — get single evidence record
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import {
  validateEvidenceCreate,
  validateEvidenceListQuery
} from "../lib/evidenceValidation.js";

const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

// Maps source_type to the DB table that holds the linked record.
const SOURCE_TYPE_TABLE: Record<string, string> = {
  control_test: "control_assessments",
  vendor_review: "vendor_assessments",
  ai_review: "governance_reviews",
  ai_governance_review: "ai_governance_assessments",
  obligation_review: "obligation_assessments",
  dependency_review: "dependency_assessments",
  risk_treatment: "risk_treatments",
  finding: "findings"
};

// ---------------------------------------------------------------------------
// buildEvidenceSummary — pure aggregation helper (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Aggregate evidence DB rows into a summary object.
 * All canonical source_type keys are always present; missing values default to 0.
 * Exported for unit testing without a live database.
 */
export function buildEvidenceSummary(
  bySourceTypeRows: ReadonlyArray<{ source_type: string; count: string }>
): {
  total: number;
  by_source_type: Record<string, number>;
} {
  const by_source_type: Record<string, number> = {
    control_test: 0,
    vendor_review: 0,
    ai_review: 0,
    ai_governance_review: 0,
    obligation_review: 0,
    dependency_review: 0,
    risk_treatment: 0,
    finding: 0
  };

  for (const row of bySourceTypeRows) {
    if (row.source_type in by_source_type) {
      by_source_type[row.source_type] = parseInt(row.count, 10);
    }
  }

  const total = Object.values(by_source_type).reduce((s, n) => s + n, 0);

  return { total, by_source_type };
}

const EVIDENCE_SELECT = `
  id,
  organization_id,
  source_type,
  source_id,
  title,
  description,
  evidence_type,
  collected_at,
  collected_by,
  external_ref,
  created_at,
  updated_at
`;

/* =========================================================
   GET /api/evidence/summary
   Aggregate evidence counts by source_type for the org.
   All canonical source_type keys are always present (0 when absent).
   ========================================================= */

router.get(
  "/evidence/summary",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    try {
      const result = await pg.query<{ source_type: string; count: string }>(
        `
        SELECT source_type, COUNT(*)::text AS count
        FROM evidence
        WHERE organization_id = $1
        GROUP BY source_type
        `,
        [organizationId]
      );

      const summary = buildEvidenceSummary(result.rows);

      res.status(200).json(summary);
    } catch (err) {
      logger.error(
        { event: "evidence_summary_failed", err },
        "GET /api/evidence/summary failed"
      );
      res.status(500).json({ error: "evidence_summary_failed" });
    }
  }
);

/* =========================================================
   POST /api/evidence
   Create an evidence record.
   Verifies that the linked source record exists and belongs to this org.
   Multiple evidence records are allowed for the same source.
   ========================================================= */

router.post(
  "/evidence",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const validated = validateEvidenceCreate(req.body);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;
    const targetTable = SOURCE_TYPE_TABLE[input.source_type];

    const client = await pg.connect();
    try {
      await client.query("BEGIN");

      // Verify the linked source record exists and belongs to this org.
      const sourceResult = await client.query(
        `SELECT id FROM ${targetTable} WHERE id = $1 AND organization_id = $2 LIMIT 1`,
        [input.source_id, organizationId]
      );

      if ((sourceResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "source_record_not_found" });
        return;
      }

      const evidenceResult = await client.query(
        `
        INSERT INTO evidence (
          organization_id,
          source_type,
          source_id,
          title,
          description,
          evidence_type,
          collected_at,
          collected_by,
          external_ref
        )
        VALUES ($1, $2, $3::uuid, $4, $5, $6, $7, $8, $9)
        RETURNING ${EVIDENCE_SELECT}
        `,
        [
          organizationId,
          input.source_type,
          input.source_id,
          input.title,
          input.description ?? null,
          input.evidence_type,
          input.collected_at ?? null,
          input.collected_by ?? null,
          input.external_ref ?? null
        ]
      );

      const evidence = evidenceResult.rows[0];

      await client.query("COMMIT");

      logger.info(
        {
          event: "evidence_created",
          organizationId,
          evidenceId: evidence.id,
          sourceType: input.source_type,
          sourceId: input.source_id,
          evidenceType: input.evidence_type
        },
        "Evidence record created"
      );

      res.status(201).json({ evidence });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure
      }

      logger.error(
        { event: "evidence_create_failed", err },
        "POST /api/evidence failed"
      );
      res.status(500).json({ error: "evidence_create_failed" });
    } finally {
      client.release();
    }
  }
);

/* =========================================================
   GET /api/evidence
   List all evidence for a given source record.
   Both source_type and source_id query params are required.
   Returns all matching evidence ordered by created_at DESC.
   ========================================================= */

router.get(
  "/evidence",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const validated = validateEvidenceListQuery(req.query);
    if ("error" in validated) {
      res.status(400).json(validated);
      return;
    }

    const { input } = validated;

    try {
      const result = await pg.query(
        `
        SELECT ${EVIDENCE_SELECT}
        FROM evidence
        WHERE organization_id = $1
          AND source_type = $2
          AND source_id = $3::uuid
        ORDER BY created_at DESC, id DESC
        `,
        [organizationId, input.source_type, input.source_id]
      );

      const evidenceList = result.rows;

      res.status(200).json({
        count: evidenceList.length,
        organizationId,
        source_type: input.source_type,
        source_id: input.source_id,
        evidence: evidenceList
      });
    } catch (err) {
      logger.error(
        { event: "evidence_list_failed", err },
        "GET /api/evidence failed"
      );
      res.status(500).json({ error: "evidence_list_failed" });
    }
  }
);

/* =========================================================
   GET /api/evidence/:id
   Get a single evidence record by id.
   Returns 404 if not found or belongs to a different org.
   ========================================================= */

router.get(
  "/evidence/:id",
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("standard"),
  async (req, res) => {
    const organizationContext = (req as any).organizationContext ?? null;
    const organizationId = organizationContext?.organizationId ?? null;

    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }

    const evidenceId = String(req.params.id ?? "").trim();
    if (!evidenceId) {
      res.status(400).json({ error: "evidence_id_required" });
      return;
    }
    if (!isUuid(evidenceId)) {
      res.status(400).json({ error: "evidence_id_must_be_uuid" });
      return;
    }

    try {
      const result = await pg.query(
        `
        SELECT ${EVIDENCE_SELECT}
        FROM evidence
        WHERE id = $1
          AND organization_id = $2
        `,
        [evidenceId, organizationId]
      );

      if ((result.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "evidence_not_found" });
        return;
      }

      res.status(200).json({ evidence: result.rows[0] });
    } catch (err) {
      logger.error(
        { event: "evidence_get_failed", err },
        "GET /api/evidence/:id failed"
      );
      res.status(500).json({ error: "evidence_get_failed" });
    }
  }
);

export default router;
