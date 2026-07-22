/**
 * applicabilityAssessments.ts — R4: read routes over the WORM applicability
 * decision store (4b tables). The first PUBLIC surface for a persisted decision:
 * the UI's applicability + evidence views (R5) and any export consume THESE
 * routes — never ad-hoc table reads.
 *
 *   GET /api/applicability-assessments
 *       CURRENT decisions only (latest per (signal, target) by `seq`), org-scoped,
 *       paginated, filterable by decision / target_type / signal_id. Each row
 *       carries its blast-radius count (the list view's "reach" column).
 *
 *   GET /api/applicability-assessments/:id
 *       One decision IN FULL: header + normalized blast radius + by-value
 *       evidence + the S5 explainability rendering (reasoning chain, evidence
 *       used/missing, headline, and the AD-16 #4 reproducibility block that
 *       RE-DERIVES the content hash from what was just read back).
 *
 * Read-only: no mutation, no engine run. The explainability layer is pure and
 * reads only the fetched rows. Route chain mirrors every other ECL route:
 * flag FIRST (404 while dark), then auth, org context, capability, asTenant.
 *
 * Evidence `captured_value` is selected as `::text` (the jsonb canonical
 * rendering) — the exact string the 4c writer hashes since the R4
 * canonicalization fix, so reproducibility verifies byte-for-byte.
 */

import { Router, type Request, type Response } from "express";
import { pg } from "../infra/postgres.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireCapability } from "../lib/enterpriseContextCapability.js";
import { asTenant } from "../middleware/asTenant.js";
import { enterpriseContextFeatureFlag } from "../lib/enterpriseContextFeatureFlag.js";
import { explainAssessment } from "../../engine/applicability/v1/explainability.js";
import type { StoredAssessment } from "../../engine/applicability/v1/explainability.js";
import type { MatchTargetType } from "../../engine/applicability/v1/types.js";
import { APPLICABILITY_DECISIONS, MATCH_TARGET_TYPES } from "../../engine/applicability/v1/types.js";

const router = Router();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const DEFAULT_OFFSET = 0;
const MAX_OFFSET = 100_000;
const INTEGER_RE = /^-?\d+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Storable applicability targets = the canonical MATCH_TARGET_TYPES (quartet +
// 'asset', EAR-AD-3 / ERG convergence C2): the target_type CHECK admits 'asset'
// (20260804) and the WORM writer persists asset-target assessments, so the
// read/filter surface accepts the same set. Never re-declare this list.
const TARGET_TYPES = new Set<string>(MATCH_TARGET_TYPES);
const DECISIONS = new Set<string>(APPLICABILITY_DECISIONS);

function getOrgId(req: Request): string | null {
  return (
    (req as { organizationContext?: { organizationId?: string | null } })
      .organizationContext?.organizationId ?? null
  );
}

function parseBoundedInt(raw: unknown, def: number, max: number): number | null {
  if (raw === undefined) return def;
  if (typeof raw !== "string" || !INTEGER_RE.test(raw.trim())) return null;
  const n = parseInt(raw.trim(), 10);
  if (n < 0) return null;
  return Math.min(n, max);
}

const HEADER_COLS = `
  id, organization_id, signal_id, target_type, target_id, decision, confidence,
  confidence_band, reasoning_steps, engine_version, schema_version,
  content_hash, prev_hash, created_at
`;

// ---------------------------------------------------------------------------
// LIST — GET /api/applicability-assessments (current decisions only)
// ---------------------------------------------------------------------------
export async function listApplicabilityAssessments(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }

  const limit = parseBoundedInt(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const offset = parseBoundedInt(req.query.offset, DEFAULT_OFFSET, MAX_OFFSET);
  if (limit === null || offset === null) {
    res.status(400).json({ error: "invalid_pagination" });
    return;
  }

  const decision = typeof req.query.decision === "string" && req.query.decision.length > 0 ? req.query.decision : null;
  if (decision !== null && !DECISIONS.has(decision)) {
    res.status(400).json({ error: "invalid_decision" });
    return;
  }
  const targetType = typeof req.query.target_type === "string" && req.query.target_type.length > 0 ? req.query.target_type : null;
  if (targetType !== null && !TARGET_TYPES.has(targetType)) {
    res.status(400).json({ error: "invalid_target_type" });
    return;
  }
  const signalId = typeof req.query.signal_id === "string" && req.query.signal_id.length > 0 ? req.query.signal_id : null;
  if (signalId !== null && !UUID_RE.test(signalId)) {
    res.status(400).json({ error: "invalid_signal_id" });
    return;
  }

  // Current = latest per (signal, target) by seq; filters apply to the CURRENT
  // row (a superseded 'affected' must not surface under decision=affected).
  const rows = await pg.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (signal_id, target_type, target_id) ${HEADER_COLS},
              (SELECT count(*)::int FROM applicability_affected_entities ae
                WHERE ae.assessment_id = applicability_assessments.id
                  AND ae.organization_id = $1) AS affected_count
         FROM applicability_assessments
        WHERE organization_id = $1
        ORDER BY signal_id, target_type, target_id, seq DESC
     ) current
     WHERE ($2::text IS NULL OR current.decision = $2)
       AND ($3::text IS NULL OR current.target_type = $3)
       AND ($4::uuid IS NULL OR current.signal_id = $4)
     ORDER BY current.created_at DESC, current.id DESC
     LIMIT $5 OFFSET $6`,
    [orgId, decision, targetType, signalId, limit, offset]
  );

  res.status(200).json({ applicability_assessments: rows.rows, limit, offset });
}

// ---------------------------------------------------------------------------
// GET ONE — GET /api/applicability-assessments/:id (full record + explanation)
// ---------------------------------------------------------------------------
export async function getApplicabilityAssessment(req: Request, res: Response): Promise<void> {
  const orgId = getOrgId(req);
  if (!orgId) {
    res.status(403).json({ error: "organization_context_missing" });
    return;
  }
  const id = req.params.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    res.status(400).json({ error: "invalid_id" });
    return;
  }

  const head = await pg.query(
    `SELECT ${HEADER_COLS} FROM applicability_assessments
      WHERE id = $1 AND organization_id = $2
      LIMIT 1`,
    [id, orgId]
  );
  if (head.rowCount === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const h = head.rows[0] as Record<string, unknown>;

  const affected = await pg.query(
    `SELECT node_type, node_id, min_depth, via_target_type, via_target_id
       FROM applicability_affected_entities
      WHERE assessment_id = $1 AND organization_id = $2
      ORDER BY node_type ASC, node_id ASC`,
    [id, orgId]
  );

  // captured_value::text = the jsonb canonical rendering — the exact string the
  // writer hashed (R4 canonicalization), so the reproducibility re-derivation works.
  const evidence = await pg.query(
    `SELECT evidence_type, ref_table, ref_id, captured_value::text AS captured_value, weight
       FROM applicability_evidence
      WHERE assessment_id = $1 AND organization_id = $2
      ORDER BY ref_table ASC, ref_id ASC NULLS FIRST, evidence_type ASC`,
    [id, orgId]
  );

  const stored: StoredAssessment = {
    organization_id: String(h.organization_id),
    signal_id: String(h.signal_id),
    target_type: String(h.target_type) as MatchTargetType,
    target_id: String(h.target_id),
    decision: h.decision as StoredAssessment["decision"],
    confidence: Number(h.confidence),
    confidence_band: h.confidence_band as StoredAssessment["confidence_band"],
    reasoning_steps: (Array.isArray(h.reasoning_steps) ? h.reasoning_steps : []) as StoredAssessment["reasoning_steps"],
    affected_entities: affected.rows.map((raw) => {
      const a = raw as Record<string, unknown>;
      return {
        node_type: String(a.node_type),
        node_id: String(a.node_id),
        min_depth: Number(a.min_depth),
        via_target_type: String(a.via_target_type) as MatchTargetType,
        via_target_id: String(a.via_target_id)
      };
    }),
    evidence: evidence.rows.map((raw) => {
      const e = raw as Record<string, unknown>;
      return {
        evidence_type: String(e.evidence_type),
        ref_table: String(e.ref_table),
        ref_id: e.ref_id === null ? null : String(e.ref_id),
        captured_value: String(e.captured_value),
        weight: e.weight === null ? null : Number(e.weight)
      };
    }),
    engine_version: String(h.engine_version),
    schema_version: String(h.schema_version),
    content_hash: String(h.content_hash),
    prev_hash: String(h.prev_hash)
  };

  res.status(200).json({
    applicability_assessment: {
      id: String(h.id),
      created_at: h.created_at,
      ...stored
    },
    explanation: explainAssessment(stored)
  });
}

// ---------------------------------------------------------------------------
// Route wiring — flag FIRST (404 before auth), then the mandatory ECL chain.
// ---------------------------------------------------------------------------
const chain = [
  enterpriseContextFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireCapability("enterprise_context")
];

router.get("/applicability-assessments", ...chain, asTenant(listApplicabilityAssessments));
router.get("/applicability-assessments/:id", ...chain, asTenant(getApplicabilityAssessment));

export default router;
