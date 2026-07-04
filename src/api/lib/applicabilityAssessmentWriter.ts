/**
 * applicabilityAssessmentWriter.ts — Slice 4c: the transactional persistence writer
 * for an applicability decision (header + by-value evidence + normalized blast radius).
 *
 * This is the bridge between the pure engine (4a, `ApplicabilityEngineV1`) and the
 * WORM tables (4b). It does NOT decide anything — it persists a decision already
 * produced by the engine. It runs INSIDE a tenant transaction: the caller (the
 * worker, Slice 4d) invokes it as `withTenant(orgId, () => persistApplicabilityAssessment(pg, args))`,
 * so `app.current_org_id` is set and every write is org-scoped. For testability it
 * takes an injectable `Queryable` (the `pg` proxy in prod; a raw app_request client in
 * the isolation test) rather than reaching for a global handle.
 *
 * Hash chain (AD-16): a per-org `pg_advisory_xact_lock` serializes chain appends so
 * two concurrent writers cannot read the same `prev_hash` and fork the chain; the
 * `UNIQUE (organization_id, prev_hash)` index is the durable backstop if the lock is
 * ever bypassed. `content_hash`/`prev_hash` are computed by the pure helper (4b).
 *
 * INERT: nothing calls this yet (the worker is Slice 4d). Behind the ECL feature flag
 * at the eventual call site; this module has no side effects until invoked.
 */

import {
  computeContentHash,
  GENESIS_PREV_HASH,
  type AssessmentIdentity,
  type EvidenceSnapshot
} from "../../engine/applicability/v1/contentHash.js";
import type { ApplicabilityResult } from "../../engine/applicability/v1/types.js";

/** Minimal query surface — satisfied by pg.Pool, pg.PoolClient, and the `pg` proxy. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
}

export interface PersistApplicabilityArgs {
  /** organization_id + what the decision is about. organization_id MUST equal the tenant scope. */
  identity: AssessmentIdentity;
  /** The pure engine's output (decision, confidence, reasoning_steps, affected_entities, versions). */
  result: ApplicabilityResult;
  /**
   * By-value evidence snapshots. `captured_value` MUST be a JSON string (stored as
   * JSONB, and hashed as-is). Order does not matter — the hash sorts internally.
   */
  evidence: EvidenceSnapshot[];
}

export interface PersistApplicabilityResult {
  assessmentId: string;
  contentHash: string;
  prevHash: string;
}

/**
 * Persist one applicability decision as an immutable, hash-chained record. Must be
 * called inside a tenant transaction (withTenant) whose org matches
 * `args.identity.organization_id`. Returns the new assessment id + chain hashes.
 */
export async function persistApplicabilityAssessment(
  db: Queryable,
  args: PersistApplicabilityArgs
): Promise<PersistApplicabilityResult> {
  const { identity, result, evidence } = args;
  const orgId = identity.organization_id;

  // Serialize per-org chain appends: the advisory lock is held to COMMIT, so a
  // concurrent writer for the same org waits and then reads our committed tail.
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [orgId]);

  // The chain tail = the org's most-recent decision (or GENESIS). Ordered by the
  // monotonic `seq` (not created_at, which ties within a single tx — see migration
  // 20260727) so persisting several decisions in one tenant tx chains correctly.
  const tail = await db.query(
    `SELECT content_hash FROM applicability_assessments
      WHERE organization_id = $1
      ORDER BY seq DESC
      LIMIT 1`,
    [orgId]
  );
  const tailRow = tail.rows[0];
  const prevHash = tailRow ? String(tailRow.content_hash) : GENESIS_PREV_HASH;

  const contentHash = computeContentHash(identity, result, evidence, prevHash);

  const inserted = await db.query(
    `INSERT INTO applicability_assessments
       (organization_id, signal_id, target_type, target_id, decision, confidence,
        confidence_band, reasoning_steps, engine_version, schema_version, content_hash, prev_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)
     RETURNING id`,
    [
      orgId,
      identity.signal_id,
      identity.target_type,
      identity.target_id,
      result.decision,
      result.confidence,
      result.confidence_band,
      JSON.stringify(result.reasoning_steps),
      result.engine_version,
      result.schema_version,
      contentHash,
      prevHash
    ]
  );
  const insertedRow = inserted.rows[0];
  if (!insertedRow) throw new Error("applicability_assessments INSERT returned no row");
  const assessmentId = String(insertedRow.id);

  // By-value evidence snapshots.
  for (const e of evidence) {
    await db.query(
      `INSERT INTO applicability_evidence
         (assessment_id, organization_id, evidence_type, ref_table, ref_id, captured_value, weight)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [assessmentId, orgId, e.evidence_type, e.ref_table, e.ref_id, e.captured_value, e.weight]
    );
  }

  // Normalized blast radius (from the engine's affected_entities).
  for (const a of result.affected_entities) {
    await db.query(
      `INSERT INTO applicability_affected_entities
         (assessment_id, organization_id, node_type, node_id, min_depth, via_target_type, via_target_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [assessmentId, orgId, a.node_type, a.node_id, a.min_depth, a.via_target_type, a.via_target_id]
    );
  }

  return { assessmentId, contentHash, prevHash };
}
