/**
 * frameworkReadiness.ts — Framework compliance readiness scoring
 *
 * Computes how ready an organization is to pass an audit against a framework,
 * based on their control mappings and latest control assessment statuses.
 *
 * Algorithm:
 *   1. Verify the framework belongs to the requesting org.
 *   2. Fetch all requirements for the framework.
 *   3. Fetch all control_mappings for those requirements (bulk lookup).
 *   4. Fetch the latest control_assessment status per mapped control.
 *   5. Classify each requirement:
 *        - satisfied: ≥1 mapped control whose latest assessment = 'passed'
 *        - partial:   ≥1 mapped control exists but none passed
 *        - unmapped:  no control_mappings exist
 *   6. readiness_score = round((satisfied / total_requirements) * 100)
 *
 * Routes:
 *   GET /api/frameworks/:id/readiness
 */

import { Router } from "express";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";

const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

/* =========================================================
   GET /api/frameworks/:id/readiness
   Compute control coverage and readiness score for a framework.
   ========================================================= */

router.get(
  "/frameworks/:id/readiness",
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

    const frameworkId = String(req.params["id"] ?? "").trim();
    if (!frameworkId) {
      res.status(400).json({ error: "framework_id_required" });
      return;
    }
    if (!isUuid(frameworkId)) {
      res.status(400).json({ error: "framework_id_must_be_uuid" });
      return;
    }

    try {
      // Step 1: Verify framework belongs to org
      const frameworkResult = await pg.query<{
        id: string; name: string; version: string;
      }>(
        `SELECT id, name, version FROM frameworks WHERE id = $1 AND organization_id = $2`,
        [frameworkId, organizationId]
      );

      if ((frameworkResult.rowCount ?? 0) === 0) {
        res.status(404).json({ error: "framework_not_found" });
        return;
      }

      const framework = frameworkResult.rows[0]!;

      // Step 2: Fetch all requirements for this framework (no limit — bounded by design)
      const requirementsResult = await pg.query<{
        id: string; reference_id: string; title: string;
      }>(
        `SELECT id, reference_id, title
         FROM requirements
         WHERE framework_id = $1
         ORDER BY created_at ASC, id ASC`,
        [frameworkId]
      );

      const requirements = requirementsResult.rows;

      if (requirements.length === 0) {
        res.status(200).json({
          framework: { id: framework.id, name: framework.name, version: framework.version },
          readiness_score: 0,
          total_requirements: 0,
          satisfied: 0,
          partial: 0,
          unmapped: 0,
          requirements: [],
        });
        return;
      }

      const requirementIds = requirements.map((r) => r.id);

      // Step 3: Bulk fetch control_mappings for all requirements
      const mappingsResult = await pg.query<{
        requirement_id: string; control_id: string; control_name: string;
      }>(
        `SELECT cm.requirement_id, cm.control_id, c.name AS control_name
         FROM control_mappings cm
         JOIN controls c ON c.id = cm.control_id
         WHERE cm.requirement_id = ANY($1::uuid[])
           AND c.organization_id = $2`,
        [requirementIds, organizationId]
      );

      // Build requirement_id → [{control_id, control_name}]
      const mappingsByRequirement = new Map<
        string,
        Array<{ control_id: string; control_name: string }>
      >();
      for (const row of mappingsResult.rows) {
        const existing = mappingsByRequirement.get(row.requirement_id) ?? [];
        existing.push({ control_id: row.control_id, control_name: row.control_name });
        mappingsByRequirement.set(row.requirement_id, existing);
      }

      // Collect all unique control IDs that have at least one mapping
      const allControlIds = [...new Set(mappingsResult.rows.map((r) => r.control_id))];

      // Step 4: Fetch latest assessment status per control (DISTINCT ON pattern)
      // Also fetch next_test_due and testing_frequency for overdue degradation.
      const latestStatusByControl = new Map<string, string>();
      const overdueByControl = new Map<string, boolean>();

      if (allControlIds.length > 0) {
        const assessmentsResult = await pg.query<{
          control_id: string; latest_status: string;
        }>(
          `SELECT DISTINCT ON (ca.control_id)
             ca.control_id,
             ca.status AS latest_status
           FROM control_assessments ca
           WHERE ca.control_id = ANY($1::uuid[])
             AND ca.organization_id = $2
           ORDER BY ca.control_id, ca.created_at DESC, ca.id DESC`,
          [allControlIds, organizationId]
        );

        for (const row of assessmentsResult.rows) {
          latestStatusByControl.set(row.control_id, row.latest_status);
        }

        // Fetch overdue status for each mapped control
        const controlsResult = await pg.query<{
          id: string;
          is_overdue: boolean;
        }>(
          `SELECT id,
             (next_test_due IS NOT NULL
              AND next_test_due < CURRENT_DATE
              AND testing_frequency IS NOT NULL
              AND testing_frequency != 'ad_hoc'
             ) AS is_overdue
           FROM controls
           WHERE id = ANY($1::uuid[])
             AND organization_id = $2`,
          [allControlIds, organizationId]
        );

        for (const row of controlsResult.rows) {
          overdueByControl.set(row.id, row.is_overdue);
        }
      }

      // Step 5: Classify each requirement and build response
      // A passed control counts as 'satisfied' only if it is NOT overdue.
      // A passed-but-overdue control counts as 'partial' (cadence degradation).
      type ReqStatus = "satisfied" | "partial" | "unmapped";

      let satisfiedCount = 0;
      let partialCount = 0;
      let unmappedCount = 0;

      const requirementDetails = requirements.map((req) => {
        const controls = mappingsByRequirement.get(req.id) ?? [];

        let status: ReqStatus;
        if (controls.length === 0) {
          status = "unmapped";
          unmappedCount++;
        } else {
          // satisfied = at least one mapped control with latest assessment = 'passed'
          //             AND that control is not overdue for re-testing
          const hasPassedAndFresh = controls.some(
            (c) =>
              latestStatusByControl.get(c.control_id) === "passed" &&
              !overdueByControl.get(c.control_id)
          );
          if (hasPassedAndFresh) {
            status = "satisfied";
            satisfiedCount++;
          } else {
            status = "partial";
            partialCount++;
          }
        }

        const mapped_controls = controls.map((c) => ({
          control_id: c.control_id,
          control_name: c.control_name,
          latest_assessment_status: latestStatusByControl.get(c.control_id) ?? null,
        }));

        return {
          id: req.id,
          reference_id: req.reference_id,
          title: req.title,
          status,
          mapped_controls,
        };
      });

      const total = requirements.length;
      const readiness_score =
        total === 0 ? 0 : Math.round((satisfiedCount / total) * 100);

      res.status(200).json({
        framework: { id: framework.id, name: framework.name, version: framework.version },
        readiness_score,
        total_requirements: total,
        satisfied: satisfiedCount,
        partial: partialCount,
        unmapped: unmappedCount,
        requirements: requirementDetails,
      });
    } catch (err) {
      logger.error(
        { event: "framework_readiness_failed", err },
        "GET /api/frameworks/:id/readiness failed"
      );
      res.status(500).json({ error: "framework_readiness_failed" });
    }
  }
);

export default router;
