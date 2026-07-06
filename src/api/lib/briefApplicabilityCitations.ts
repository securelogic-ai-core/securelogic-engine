/**
 * briefApplicabilityCitations.ts — EAR P11: Brief ↔ asset applicability
 * citation (the ARCHITECTURE.md §Phase-5 optional convergence item).
 *
 * Direction is fixed by the roadmap: applicability decisions (platform data)
 * flow INTO the Brief — never Brief-shaped platform work. At Brief SERVE time
 * (read-only; the generation pipeline is untouched), items that reference a
 * cyber signal MAY carry the org's CURRENT applicability decisions for that
 * signal: decision-grade, auditor-backed context ("your applicability engine
 * ruled vendor X affected on this signal") attached to the executive output.
 *
 * DOUBLE-FENCED dark:
 *   - SECURELOGIC_BRIEF_APPLICABILITY_CITATION_ENABLED (new, default off) —
 *     the citation feature itself;
 *   - SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED — the data being cited is ECL
 *     data; while the ECL is dark the citation must be too.
 * With either flag off the Brief response is byte-identical to today (the
 * field is absent, not empty).
 *
 * FAIL-OPEN on error BY DESIGN: a citation lookup failure must never break
 * the Brief read — log and return no citations.
 *
 * "Current" reuses the canonical pattern from applicabilityAssessments.ts:
 * DISTINCT ON (signal_id, target_type, target_id) … ORDER BY seq DESC over
 * the WORM ledger (no is_current column can exist under WORM).
 */

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { enterpriseContextEnabled } from "./enterpriseContextFeatureFlag.js";

export function briefApplicabilityCitationsEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    env["SECURELOGIC_BRIEF_APPLICABILITY_CITATION_ENABLED"] === "true" &&
    enterpriseContextEnabled(env)
  );
}

export interface ApplicabilityCitation {
  assessment_id: string;
  target_type: string;
  target_id: string;
  decision: string;
  confidence_band: string | null;
  decided_at: string;
}

/** signal_id → the org's current decisions for that signal (all targets). */
export type CitationsBySignal = Record<string, ApplicabilityCitation[]>;

/**
 * Fetch the org's CURRENT applicability decisions for a set of signals.
 * Returns {} when the feature is dark, the input is empty, or the lookup
 * fails (fail-open — see header). Callers run under asTenant/withTenant.
 */
export async function fetchApplicabilityCitations(
  organizationId: string,
  signalIds: readonly (string | null)[]
): Promise<CitationsBySignal> {
  if (!briefApplicabilityCitationsEnabled()) return {};

  const ids = [...new Set(signalIds.filter((s): s is string => typeof s === "string" && s.length > 0))];
  if (ids.length === 0) return {};

  try {
    const result = await pg.query<{
      id: string;
      signal_id: string;
      target_type: string;
      target_id: string;
      decision: string;
      confidence_band: string | null;
      created_at: string;
    }>(
      `
      SELECT DISTINCT ON (signal_id, target_type, target_id)
        id, signal_id, target_type, target_id, decision, confidence_band, created_at
      FROM applicability_assessments
      WHERE organization_id = $1
        AND signal_id = ANY($2::uuid[])
      ORDER BY signal_id, target_type, target_id, seq DESC
      `,
      [organizationId, ids]
    );

    const bySignal: CitationsBySignal = {};
    for (const row of result.rows) {
      (bySignal[row.signal_id] ??= []).push({
        assessment_id: row.id,
        target_type: row.target_type,
        target_id: row.target_id,
        decision: row.decision,
        confidence_band: row.confidence_band,
        decided_at: row.created_at
      });
    }
    return bySignal;
  } catch (err) {
    logger.warn(
      { event: "brief_applicability_citation_lookup_failed", organizationId, err },
      "Applicability citation lookup failed — serving the Brief without citations"
    );
    return {};
  }
}
