/**
 * assessmentEngine.ts — the spec-driven assessment engine (EAR P10, EAR-AD-7).
 *
 * Owns the two transactions every status-machine assessment stack shares:
 * create-with-subject-check and transition-with-finding-on-first-entry. In
 * P10 the ONLY consumer is the generic asset path (ASSESSMENT_TYPE_SPECS.asset
 * / asset_assessments); the seven legacy stacks keep their inline SQL until
 * the staged collapse reaches them (memo §2, one stack per PR).
 *
 * Tenancy: callers run under asTenant (route) or withTenant (workers/tests) —
 * `pg.connect()` then hands back the tenant client and BEGIN/COMMIT become
 * savepoints on the tenant transaction (the P8-verified proxy behavior), so
 * every statement carries the org GUC and RLS holds as defense-in-depth.
 * Explicit `organization_id = $n` predicates remain the primary control.
 *
 * Subject resolution is the org-scoped asset_registry_v lookup — the AssetRef
 * (asset_type, asset_id) has no FK (a view cannot be an FK target), so this
 * read IS the referential-integrity check (memo EAR-AD-6).
 */

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { severityToPriority } from "./postureComputation.js";
import { ASSESSMENT_TYPE_SPECS } from "./assessmentSpec.js";
import type {
  AssetAssessmentCreateInput,
  AssetAssessmentStatusTransitionInput
} from "./assetAssessmentValidation.js";
import {
  TERMINAL_STATUSES,
  FINDING_STATUSES,
  isValidTransition
} from "./assetAssessmentValidation.js";

const SPEC = ASSESSMENT_TYPE_SPECS.asset;

const ASSESSMENT_SELECT = `
  id,
  organization_id,
  asset_type,
  asset_id,
  status,
  overall_severity,
  summary,
  notes,
  performed_at,
  reviewer_uuid AS reviewer_id,
  created_at,
  updated_at
`;

const FINDING_SELECT = `
  id,
  organization_id,
  assessment_id,
  source_type,
  source_id,
  title,
  description,
  severity,
  domain,
  priority,
  status,
  created_at,
  updated_at
`;

export type AssessmentRow = Record<string, unknown>;
export type FindingRow = Record<string, unknown>;

export type CreateAssetAssessmentResult =
  | { assessment: AssessmentRow }
  | { error: "asset_not_found" };

/**
 * POST semantics (mirrors the legacy status-machine stacks): verify the
 * subject exists org-scoped, insert the record. No finding at create.
 */
export async function createAssetAssessment(
  organizationId: string,
  input: AssetAssessmentCreateInput
): Promise<CreateAssetAssessmentResult> {
  const client = await pg.connect();
  try {
    await client.query("BEGIN");

    // Registry existence check — the AssetRef integrity gate (EAR-AD-6).
    // asset_registry_v is a view (not lockable); an asset deleted between this
    // check and COMMIT leaves a dangling ref, same exposure the polymorphic
    // quartet accepts (signal_match_suggestions precedent).
    const assetResult = await client.query(
      `
      SELECT asset_id, name
      FROM asset_registry_v
      WHERE organization_id = $1
        AND asset_type = $2
        AND asset_id = $3
      LIMIT 1
      `,
      [organizationId, input.asset_type, input.asset_id]
    );

    if ((assetResult.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return { error: "asset_not_found" };
    }

    const inserted = await client.query(
      `
      INSERT INTO asset_assessments (
        organization_id,
        asset_type,
        asset_id,
        status,
        overall_severity,
        summary,
        notes,
        performed_at,
        reviewer_uuid
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING ${ASSESSMENT_SELECT}
      `,
      [
        organizationId,
        input.asset_type,
        input.asset_id,
        input.status,
        input.overall_severity,
        input.summary,
        input.notes,
        input.performed_at,
        input.reviewer_id
      ]
    );

    await client.query("COMMIT");
    return { assessment: inserted.rows[0] as AssessmentRow };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    throw err;
  } finally {
    client.release();
  }
}

export type TransitionAssetAssessmentResult =
  | { assessment: AssessmentRow; finding: FindingRow | null; from: string }
  | { error: "not_found" }
  | { error: "workflow_terminal" }
  | { error: "invalid_transition" };

/**
 * PATCH semantics (the shared finding-on-first-transition transaction the
 * five legacy PATCH handlers copy-paste, spec-parameterized): lock the row,
 * terminal guard, transition guard, partial update, and — on the FIRST
 * transition into a finding status with a resolvable severity — exactly one
 * finding with source_type = spec.findingSourceType.
 */
export async function transitionAssetAssessment(
  organizationId: string,
  assessmentId: string,
  input: AssetAssessmentStatusTransitionInput
): Promise<TransitionAssetAssessmentResult> {
  const client = await pg.connect();
  try {
    await client.query("BEGIN");

    const existingResult = await client.query(
      `
      SELECT id, asset_type, asset_id, status, overall_severity
      FROM asset_assessments
      WHERE id = $1
        AND organization_id = $2
      FOR UPDATE
      `,
      [assessmentId, organizationId]
    );

    if ((existingResult.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return { error: "not_found" };
    }

    const existing = existingResult.rows[0];

    if (TERMINAL_STATUSES.has(existing.status)) {
      await client.query("ROLLBACK");
      return { error: "workflow_terminal" };
    }

    if (!isValidTransition(existing.status, input.status)) {
      await client.query("ROLLBACK");
      return { error: "invalid_transition" };
    }

    const resolvedSeverity: string | null =
      input.overall_severity ?? existing.overall_severity ?? null;

    const setClauses: string[] = ["status = $1", "updated_at = NOW()"];
    const updateParams: unknown[] = [input.status];

    setClauses.push(`overall_severity = COALESCE($${updateParams.length + 1}, overall_severity)`);
    updateParams.push(input.overall_severity);

    if (input.summary !== null) {
      updateParams.push(input.summary);
      setClauses.push(`summary = $${updateParams.length}`);
    }
    if (input.notes !== null) {
      updateParams.push(input.notes);
      setClauses.push(`notes = $${updateParams.length}`);
    }
    if (input.performed_at !== null) {
      updateParams.push(input.performed_at);
      setClauses.push(`performed_at = $${updateParams.length}`);
    }
    if (input.reviewer_id !== null) {
      updateParams.push(input.reviewer_id);
      setClauses.push(`reviewer_uuid = $${updateParams.length}`);
    }

    updateParams.push(assessmentId, organizationId);
    const idParam = updateParams.length - 1;
    const orgParam = updateParams.length;

    const updatedResult = await client.query(
      `
      UPDATE asset_assessments
      SET ${setClauses.join(", ")}
      WHERE id = $${idParam}
        AND organization_id = $${orgParam}
      RETURNING ${ASSESSMENT_SELECT}
      `,
      updateParams
    );

    const assessment = updatedResult.rows[0] as AssessmentRow;

    let finding: FindingRow | null = null;

    if (FINDING_STATUSES.has(input.status)) {
      const existingFinding = await client.query(
        `
        SELECT ${FINDING_SELECT}
        FROM findings
        WHERE organization_id = $1
          AND source_type = $2
          AND source_id = $3::uuid
        ORDER BY created_at ASC, id ASC
        LIMIT 1
        `,
        [organizationId, SPEC.findingSourceType, assessmentId]
      );

      if ((existingFinding.rowCount ?? 0) > 0) {
        // Finding already exists from a prior transition — never a second one.
        finding = existingFinding.rows[0] as FindingRow;
      } else if (resolvedSeverity !== null) {
        // First transition into a finding-triggering status — create finding.
        const assetName =
          ((
            await client.query(
              `
              SELECT name
              FROM asset_registry_v
              WHERE organization_id = $1
                AND asset_type = $2
                AND asset_id = $3
              LIMIT 1
              `,
              [organizationId, existing.asset_type, existing.asset_id]
            )
          ).rows[0]?.name as string | undefined) ?? "Unknown Asset";

        const priority = severityToPriority(resolvedSeverity);
        const findingTitle = `Asset Assessment Gap: ${assetName} — ${resolvedSeverity} severity`;
        const findingDescription =
          assessment["summary"] != null &&
          String(assessment["summary"]).trim().length > 0
            ? String(assessment["summary"]).trim()
            : `Asset assessment gap. Status: ${input.status}.`;

        const findingResult = await client.query(
          `
          INSERT INTO findings (
            organization_id,
            assessment_id,
            source_type,
            source_id,
            title,
            description,
            severity,
            domain,
            priority,
            status
          )
          VALUES ($1, NULL, $2, $3::uuid, $4, $5, $6, $7, $8, 'open')
          RETURNING ${FINDING_SELECT}
          `,
          [
            organizationId,
            SPEC.findingSourceType,
            assessmentId,
            findingTitle,
            findingDescription,
            resolvedSeverity,
            "Asset Management",
            priority
          ]
        );

        finding = findingResult.rows[0] as FindingRow;
      } else {
        // Validation enforces overall_severity on finding statuses, so this
        // branch should not be reached in normal operation. Log and continue
        // rather than aborting the status update (legacy-stack behavior).
        logger.warn(
          {
            event: "asset_assessment_finding_skipped_no_severity",
            organizationId,
            assessmentId,
            status: input.status
          },
          "Finding-triggering status transition with no resolvable severity; finding not created"
        );
      }
    }

    await client.query("COMMIT");
    return { assessment, finding, from: existing.status as string };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    throw err;
  } finally {
    client.release();
  }
}
