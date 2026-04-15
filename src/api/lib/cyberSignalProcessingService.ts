/**
 * cyberSignalProcessingService.ts — Signal-to-finding linker, risk exposure
 * flagging, and posture impact hook for cyber signal ingestion.
 *
 * PROCESSING PIPELINE (called after a signal row is committed)
 * ------------------------------------------------------------
 *  1. Vendor matching  — case-insensitive name lookup in vendors table.
 *  2. AI system matching — case-insensitive name lookup in ai_systems table.
 *  3. Finding creation — if any match is found, a finding is created with:
 *       source_type = 'cyber_signal'
 *       source_id   = cyber_signals.id  (NOT the vendor/ai_system id)
 *       domain      = 'Vendor Risk'   (vendor match)
 *                   | 'AI Governance' (AI system match)
 *       severity    = signal.severity
 *  4. Signal update — linked_finding_id + processed = true written back.
 *  5. Risk exposure  — open risks in the matched domain are flagged with
 *       exposure_flagged = TRUE, exposure_signal_id = signal.id
 *     (only risks not already flagged are touched; existing flags preserved).
 *  6. Posture snapshot — a new snapshot is computed and persisted for the
 *     affected org so posture reflects the new finding immediately.
 *     Failure here is non-fatal: the signal and finding are already committed.
 *
 * MATCHING RULES
 * --------------
 * Finding creation is intentionally gated on a platform entity match.
 * A CVE with no known vendor in the platform is stored as a signal but
 * does not generate a finding — it would be noise with no addressable owner.
 * If both a vendor and an AI system match, the vendor match takes precedence
 * for domain routing (Vendor Risk). Both entity IDs are returned for context.
 *
 * NO_MATCH SIGNALS
 * ----------------
 * If no vendor or AI system match is found, the signal is still marked
 * processed = true. It remains visible in the signal list and can be
 * manually linked later via a PATCH if the entity is added to the platform.
 */

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import {
  computePosture,
  FALLBACK_CONTEXT,
  severityToPriority,
  type DbFindingForPosture,
  type OrgContext
} from "./postureComputation.js";
import {
  buildWorkflowSignalBreakdown,
  buildScoringRationaleExtension
} from "./workflowScoringIntegration.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CyberSignalRecord = {
  id: string;
  organization_id: string;
  source: string;
  signal_type: string;
  severity: string;
  normalized_summary: string;
  affected_vendor: string | null;
  affected_cve: string | null;
};

export type ProcessingResult = {
  /** Finding created by this processing run, or null if no entity match. */
  finding: Record<string, unknown> | null;
  /** Vendor ID matched by affected_vendor, or null. */
  matched_vendor_id: string | null;
  /** AI system ID matched by affected_vendor, or null. */
  matched_ai_system_id: string | null;
  /** Number of open risk rows that had exposure_flagged set to TRUE. */
  risks_flagged: number;
  /** Whether the posture snapshot was successfully recomputed after processing. */
  posture_recalculated: boolean;
};

// ---------------------------------------------------------------------------
// Domain routing
// ---------------------------------------------------------------------------

/**
 * Determine the finding domain from signal context.
 *
 * Vendor match always wins over AI system match for domain routing since a
 * vendor signal is scoped to Vendor Risk regardless of whether the vendor
 * also runs AI systems. AI Governance only applies when the matched entity
 * is exclusively an AI system (no vendor record matched the name).
 */
function resolveSignalDomain(
  signalType: string,
  hasVendorMatch: boolean,
  hasAiSystemMatch: boolean
): string {
  if (hasVendorMatch) return "Vendor Risk";
  if (hasAiSystemMatch) return "AI Governance";

  // No platform entity match — route by signal type.
  switch (signalType) {
    case "cve":
    case "patch":
    case "malware":
    case "advisory":
    case "threat_actor":
      return "Vulnerability";
    case "breach":
      return "Vendor Risk";
    case "geopolitical":
    default:
      return "General";
  }
}

// ---------------------------------------------------------------------------
// processSignal
// ---------------------------------------------------------------------------

/**
 * Run the full processing pipeline for a newly ingested (unprocessed) signal.
 *
 * This function is called after the signal row has been committed. It opens
 * its own DB connection and runs vendor matching, finding creation, signal
 * update, risk exposure flagging, and posture snapshot in a single transaction
 * (except the posture snapshot, which is committed separately and is non-fatal
 * if it fails).
 *
 * @param signal  The fully committed cyber_signals row.
 * @returns       A ProcessingResult describing every side effect applied.
 */
export async function processSignal(
  signal: CyberSignalRecord
): Promise<ProcessingResult> {
  const { id: signalId, organization_id: orgId, signal_type: signalType, severity } = signal;

  let matchedVendorId: string | null = null;
  let matchedVendorName: string | null = null;
  let matchedAiSystemId: string | null = null;
  let matchedAiSystemName: string | null = null;
  let createdFinding: Record<string, unknown> | null = null;
  let risksUpdated = 0;

  const client = await pg.connect();

  try {
    await client.query("BEGIN");

    // ---------------------------------------------------------------
    // 1. Vendor matching — active vendors only, case-insensitive name
    // ---------------------------------------------------------------

    if (signal.affected_vendor !== null) {
      const vendorResult = await client.query<{ id: string; name: string }>(
        `
        SELECT id, name
        FROM vendors
        WHERE organization_id = $1
          AND status = 'active'
          AND name ILIKE $2
        LIMIT 1
        `,
        [orgId, signal.affected_vendor]
      );

      if ((vendorResult.rowCount ?? 0) > 0) {
        matchedVendorId = vendorResult.rows[0]!.id;
        matchedVendorName = vendorResult.rows[0]!.name;
      }

      // ---------------------------------------------------------------
      // 2. AI system matching — if no vendor match, try ai_systems
      // ---------------------------------------------------------------

      if (matchedVendorId === null) {
        const aiResult = await client.query<{ id: string; name: string }>(
          `
          SELECT id, name
          FROM ai_systems
          WHERE organization_id = $1
            AND name ILIKE $2
          LIMIT 1
          `,
          [orgId, signal.affected_vendor]
        );

        if ((aiResult.rowCount ?? 0) > 0) {
          matchedAiSystemId = aiResult.rows[0]!.id;
          matchedAiSystemName = aiResult.rows[0]!.name;
        }
      }
    }

    const hasVendorMatch = matchedVendorId !== null;
    const hasAiMatch = matchedAiSystemId !== null;
    const domain = resolveSignalDomain(signalType, hasVendorMatch, hasAiMatch);

    // ---------------------------------------------------------------
    // 3. Finding creation — only when a platform entity is matched
    // ---------------------------------------------------------------

    if (hasVendorMatch || hasAiMatch) {
      const entityName = matchedVendorName ?? matchedAiSystemName ?? "Unknown";
      const priority = severityToPriority(severity);

      let findingTitle: string;
      if (hasVendorMatch) {
        findingTitle = signal.affected_cve !== null
          ? `${signal.affected_cve} affects vendor: ${entityName}`
          : `Cyber signal (${signalType}): ${entityName} — ${severity} severity`;
      } else {
        findingTitle = signal.affected_cve !== null
          ? `${signal.affected_cve} affects AI system: ${entityName}`
          : `Cyber signal (${signalType}): ${entityName} — ${severity} severity`;
      }

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
        VALUES ($1, NULL, 'cyber_signal', $2::uuid, $3, $4, $5, $6, $7, 'open')
        RETURNING
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
        `,
        [
          orgId,
          signalId,
          findingTitle,
          signal.normalized_summary,
          severity,
          domain,
          priority
        ]
      );

      createdFinding = findingResult.rows[0] ?? null;
    }

    // ---------------------------------------------------------------
    // 4. Update signal: linked_finding_id + processed = true
    // ---------------------------------------------------------------

    await client.query(
      `
      UPDATE cyber_signals
      SET processed         = TRUE,
          linked_finding_id = $1,
          updated_at        = NOW()
      WHERE id = $2
        AND organization_id = $3
      `,
      [
        createdFinding !== null ? (createdFinding.id as string) : null,
        signalId,
        orgId
      ]
    );

    // ---------------------------------------------------------------
    // 5. Risk exposure flagging
    //    Flag open risks in the matched domain that are not already
    //    exposure-flagged. Only touches risks that need updating.
    // ---------------------------------------------------------------

    const riskUpdateResult = await client.query<{ id: string }>(
      `
      UPDATE risks
      SET exposure_flagged   = TRUE,
          exposure_signal_id = $1::uuid,
          updated_at         = NOW()
      WHERE organization_id    = $2
        AND status             = 'open'
        AND domain             = $3
        AND exposure_flagged   = FALSE
      RETURNING id
      `,
      [signalId, orgId, domain]
    );

    risksUpdated = riskUpdateResult.rowCount ?? 0;

    await client.query("COMMIT");

    logger.info(
      {
        event: "cyber_signal_processed",
        orgId,
        signalId,
        matchedVendorId,
        matchedAiSystemId,
        findingId: createdFinding !== null ? (createdFinding.id as string) : null,
        domain,
        risksUpdated
      },
      "Cyber signal processed"
    );
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback error
    }

    logger.error(
      { event: "cyber_signal_processing_failed", signalId, orgId, err },
      "Cyber signal processing failed — signal stored but not fully processed"
    );

    // Return a partial result rather than throwing — the signal row is
    // committed and the caller can surface this in the response.
    return {
      finding: null,
      matched_vendor_id: null,
      matched_ai_system_id: null,
      risks_flagged: 0,
      posture_recalculated: false
    };
  } finally {
    client.release();
  }

  // ---------------------------------------------------------------
  // 6. Posture snapshot trigger (non-fatal)
  //    Run after the main transaction commits so the new finding
  //    is visible to the snapshot query.
  // ---------------------------------------------------------------

  let postureRecalculated = false;

  if (createdFinding !== null) {
    try {
      await computeAndPersistPostureSnapshot(orgId);
      postureRecalculated = true;
    } catch (postureErr) {
      logger.warn(
        {
          event: "cyber_signal_posture_snapshot_failed",
          orgId,
          signalId,
          err: postureErr
        },
        "Posture snapshot trigger failed after signal processing — snapshot will be stale until next explicit recompute"
      );
    }
  }

  return {
    finding: createdFinding,
    matched_vendor_id: matchedVendorId,
    matched_ai_system_id: matchedAiSystemId,
    risks_flagged: risksUpdated,
    posture_recalculated: postureRecalculated
  };
}

// ---------------------------------------------------------------------------
// computeAndPersistPostureSnapshot
// ---------------------------------------------------------------------------

/**
 * Compute and persist a posture snapshot for the given org.
 *
 * Replicates the computation performed by POST /api/posture/snapshot but
 * is callable programmatically after signal processing so that posture
 * reflects the new finding without requiring a separate API call.
 *
 * Uses the same engines (computePosture, buildWorkflowSignalBreakdown) and
 * the same upsert pattern (one snapshot per org per calendar day).
 */
async function computeAndPersistPostureSnapshot(orgId: string): Promise<void> {
  // Fetch org profile for context-weighted scoring.
  const orgProfileResult = await pg.query<{
    regulated: boolean;
    handles_pii: boolean;
    safety_critical: boolean;
    scale: string;
  }>(
    `
    SELECT regulated, handles_pii, safety_critical, scale
    FROM organizations
    WHERE id = $1
    `,
    [orgId]
  );

  let orgContext: OrgContext;

  if ((orgProfileResult.rowCount ?? 0) === 0) {
    logger.warn(
      { event: "posture_trigger_org_not_found", orgId },
      "Org profile not found for posture trigger — using fallback context"
    );
    orgContext = FALLBACK_CONTEXT;
  } else {
    const row = orgProfileResult.rows[0]!;
    const validScales = new Set(["Small", "Medium", "Enterprise"]);
    orgContext = {
      regulated: row.regulated,
      handlesPII: row.handles_pii,
      safetyCritical: row.safety_critical,
      scale: validScales.has(row.scale) ? (row.scale as OrgContext["scale"]) : "Small"
    };
  }

  // Parallel fetch: findings, risks, signal breakdown, active treatment count.
  const [findingsResult, risksResult, findingBreakdownResult, treatedRiskResult] =
    await Promise.all([
      pg.query<DbFindingForPosture>(
        `
        SELECT id, title, domain, severity
        FROM findings
        WHERE organization_id = $1
          AND status = 'open'
        `,
        [orgId]
      ),
      pg.query<{ id: string; title: string; domain: string; risk_rating: string }>(
        `
        SELECT id, title, domain, risk_rating
        FROM risks
        WHERE organization_id = $1
          AND status = 'open'
        `,
        [orgId]
      ),
      pg.query<{ source_type: string; count: string }>(
        `
        SELECT source_type, COUNT(*)::text AS count
        FROM findings
        WHERE organization_id = $1
          AND status = 'open'
        GROUP BY source_type
        `,
        [orgId]
      ),
      pg.query<{ count: string }>(
        `
        SELECT COUNT(DISTINCT r.id)::text AS count
        FROM risks r
        JOIN risk_treatments rt
          ON rt.risk_id = r.id
         AND rt.organization_id = $1
         AND rt.status IN ('not_started', 'in_progress')
        WHERE r.organization_id = $1
          AND r.status = 'open'
        `,
        [orgId]
      )
    ]);

  const riskSignals: DbFindingForPosture[] = risksResult.rows.map((r) => ({
    id: r.id,
    title: r.title,
    domain: r.domain,
    severity: r.risk_rating
  }));

  const openFindings = [...findingsResult.rows, ...riskSignals];
  const riskSignalCount = riskSignals.length;

  // Count open and overdue actions.
  const actionCountResult = await pg.query<{
    open_count: string;
    overdue_count: string;
  }>(
    `
    SELECT
      COUNT(*)::text AS open_count,
      COUNT(*) FILTER (
        WHERE due_date < CURRENT_DATE
          AND status NOT IN ('closed', 'accepted')
      )::text AS overdue_count
    FROM actions
    WHERE organization_id = $1
      AND status NOT IN ('closed', 'accepted')
    `,
    [orgId]
  );

  const actionRow = actionCountResult.rows[0];
  const openActionCount = actionRow != null ? parseInt(actionRow.open_count, 10) : 0;
  const overdueActionCount =
    actionRow != null ? parseInt(actionRow.overdue_count, 10) : 0;

  const risksWithActiveTreatment = parseInt(
    treatedRiskResult.rows[0]?.count ?? "0",
    10
  );

  const signalBreakdown = buildWorkflowSignalBreakdown(
    findingBreakdownResult.rows,
    riskSignalCount,
    risksWithActiveTreatment
  );

  const rationaleExtension = buildScoringRationaleExtension(signalBreakdown);
  const computed = computePosture(
    openFindings,
    openActionCount,
    overdueActionCount,
    orgContext,
    riskSignalCount
  );

  const enrichedRationale = { ...computed.computation_rationale, ...rationaleExtension };

  // Persist snapshot + domain scores.
  const snapshotClient = await pg.connect();

  try {
    await snapshotClient.query("BEGIN");

    const snapshotResult = await snapshotClient.query(
      `
      INSERT INTO posture_snapshots (
        organization_id,
        snapshot_date,
        overall_score,
        overall_severity,
        open_finding_count,
        open_action_count,
        overdue_action_count,
        computation_rationale
      )
      VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (organization_id, snapshot_date) DO UPDATE SET
        overall_score        = EXCLUDED.overall_score,
        overall_severity     = EXCLUDED.overall_severity,
        open_finding_count   = EXCLUDED.open_finding_count,
        open_action_count    = EXCLUDED.open_action_count,
        overdue_action_count = EXCLUDED.overdue_action_count,
        computation_rationale = EXCLUDED.computation_rationale,
        created_at           = NOW()
      RETURNING id
      `,
      [
        orgId,
        computed.overall_score,
        computed.overall_severity,
        computed.open_finding_count,
        computed.open_action_count,
        computed.overdue_action_count,
        JSON.stringify(enrichedRationale)
      ]
    );

    const snapshotId = snapshotResult.rows[0]?.id as string | undefined;

    if (snapshotId == null) {
      throw new Error("posture_snapshot_upsert_returned_no_row");
    }

    // Replace domain scores for this snapshot.
    await snapshotClient.query(
      `DELETE FROM domain_scores WHERE posture_snapshot_id = $1`,
      [snapshotId]
    );

    if (computed.domain_scores.length > 0) {
      const domainValues: unknown[] = [];
      const domainPlaceholders: string[] = [];

      computed.domain_scores.forEach((ds, i) => {
        const base = i * 6;
        domainPlaceholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
        );
        domainValues.push(snapshotId, ds.domain, ds.score, ds.severity, ds.finding_count, ds.rationale);
      });

      await snapshotClient.query(
        `
        INSERT INTO domain_scores (
          posture_snapshot_id, domain, score, severity, finding_count, rationale
        )
        VALUES ${domainPlaceholders.join(", ")}
        `,
        domainValues
      );
    }

    await snapshotClient.query("COMMIT");

    logger.info(
      {
        event: "posture_snapshot_triggered_by_signal",
        orgId,
        snapshotId,
        overallScore: computed.overall_score,
        domainCount: computed.domain_scores.length
      },
      "Posture snapshot recomputed after signal ingestion"
    );
  } catch (err) {
    try {
      await snapshotClient.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw err;
  } finally {
    snapshotClient.release();
  }
}
