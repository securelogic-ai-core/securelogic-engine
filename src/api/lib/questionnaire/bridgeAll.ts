/**
 * bridgeAll.ts — VA-Q1 P3: bridge EVERY activated requirement of an org, and
 * measure how much of the library a curated question already covers.
 *
 * ensureBridgeQuestions() runs lazily at composition, which is enough for
 * correctness. Two things want the bridge eagerly:
 *   - the coverage query — "how many of our requirements does a human-written
 *     question evidence?" is only meaningful once every requirement has at
 *     least its bridge, so the ratio has a denominator;
 *   - operators — a library that fills in on first use reads as empty.
 *
 * What this deliberately does NOT do: it never stamps a question version onto
 * an ALREADY-ISSUED engagement's scope items. Those items were frozen against
 * requirement text as it stood at issue time, and that text may have changed
 * since. Stamping today's text as "what was asked" would be a fabricated
 * history — the exact thing ADR-0013 R3 exists to prevent. Historical issued
 * engagements stay `unstamped`, render through the requirement fallback, and
 * say so in /integrity. Pre-issue engagements (draft/scoping/scoped) need
 * nothing: their next scope resolution versions them.
 *
 * Runs inside the caller's tenant context (withTenant / asTenant).
 */

import type { Pool, PoolClient } from "pg";
import { ensureBridgeQuestions, type BridgeableRequirement } from "./bridgeQuestions.js";

type Queryable = Pick<Pool | PoolClient, "query">;

export type BridgeAllResult = {
  requirements: number;
  bridged: number;
  /** Bridge questions that already existed with current text (no-op). */
  unchanged: number;
  /** Bridge questions created or re-versioned because the text differed. */
  created_or_reversioned: number;
};

/** Bridge every requirement of every activated framework in ONE org. Idempotent. */
export async function bridgeAllRequirements(db: Queryable, organizationId: string): Promise<BridgeAllResult> {
  const rows = await db.query<BridgeableRequirement>(
    `SELECT r.id AS requirement_id, r.framework_id, r.reference_id, r.title, r.description,
            COALESCE(r.scope_tags, '{}') AS scope_tags
       FROM requirements r
       JOIN frameworks f ON f.id = r.framework_id
      WHERE f.organization_id = $1
      ORDER BY f.name, r.reference_id`,
    [organizationId]
  );
  const before = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM question_versions WHERE organization_id = $1`,
    [organizationId]
  );
  const map = await ensureBridgeQuestions(db, organizationId, rows.rows);
  const after = await db.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM question_versions WHERE organization_id = $1`,
    [organizationId]
  );
  const delta = Number(after.rows[0]!.n) - Number(before.rows[0]!.n);
  return {
    requirements: rows.rows.length,
    bridged: map.size,
    created_or_reversioned: delta,
    unchanged: map.size - delta,
  };
}

export type RequirementCoverageRow = {
  requirement_id: string;
  framework_id: string;
  framework_name: string;
  reference_id: string;
  title: string;
  /** Active questions that evidence this requirement, by origin. */
  bridge_questions: number;
  curated_questions: number;
};

export type CoverageSummary = {
  requirements: number;
  covered_by_curated: number;
  covered_by_bridge_only: number;
  uncovered: number;
  curated_pct: number;
};

/** Per-requirement question coverage for the org, plus the summary that matters. */
export async function requirementQuestionCoverage(
  db: Queryable,
  organizationId: string
): Promise<{ summary: CoverageSummary; requirements: RequirementCoverageRow[] }> {
  const rows = await db.query<{
    requirement_id: string; framework_id: string; framework_name: string; reference_id: string; title: string;
    bridge_questions: string; curated_questions: string;
  }>(
    `SELECT r.id AS requirement_id, r.framework_id, f.name AS framework_name, r.reference_id, r.title,
            COUNT(q.id) FILTER (WHERE q.status = 'active' AND q.question_key LIKE 'req:%')::text AS bridge_questions,
            COUNT(q.id) FILTER (WHERE q.status = 'active' AND q.question_key NOT LIKE 'req:%')::text AS curated_questions
       FROM requirements r
       JOIN frameworks f ON f.id = r.framework_id
       LEFT JOIN question_requirement_links l
              ON l.requirement_id = r.id AND l.organization_id = f.organization_id
       LEFT JOIN questions q
              ON q.id = l.question_id AND q.organization_id = l.organization_id
      WHERE f.organization_id = $1
      GROUP BY r.id, r.framework_id, f.name, r.reference_id, r.title
      ORDER BY f.name, r.reference_id`,
    [organizationId]
  );
  const requirements = rows.rows.map((r) => ({
    ...r,
    bridge_questions: Number(r.bridge_questions),
    curated_questions: Number(r.curated_questions),
  }));
  const covered_by_curated = requirements.filter((r) => r.curated_questions > 0).length;
  const covered_by_bridge_only = requirements.filter((r) => r.curated_questions === 0 && r.bridge_questions > 0).length;
  const uncovered = requirements.length - covered_by_curated - covered_by_bridge_only;
  return {
    summary: {
      requirements: requirements.length,
      covered_by_curated,
      covered_by_bridge_only,
      uncovered,
      curated_pct: requirements.length === 0 ? 0 : Math.round((covered_by_curated / requirements.length) * 100),
    },
    requirements,
  };
}
