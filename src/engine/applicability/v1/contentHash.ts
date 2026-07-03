/**
 * contentHash.ts — deterministic, tamper-evident content hashing for the
 * applicability-decision record (AD-16). Pure and I/O-free; unit-tested now,
 * wired at write time by the later worker slice (4c).
 *
 * Reproducibility rule (AD-16 #4): the hash is computed over an EXPLICIT,
 * field-ordered, pipe-delimited canonical string — NEVER `JSON.stringify` (whose
 * key order / unicode escaping is not stable across engines). This copies the
 * `buildDedupHash` construction in cyberSignalNormalizer.ts byte-for-byte in
 * spirit. `created_at` is deliberately EXCLUDED from the content so a decision can
 * be re-derived and re-hashed to the identical value; ordering/tamper-evidence
 * comes from the `prev_hash` chain, not the timestamp.
 *
 * Chain: each org's decision sequence is linked by
 *   content_hash = sha256( canonical(content) | prev_hash )
 * so altering or deleting any link is detectable by re-verifying downstream links.
 * The first decision for an org uses GENESIS_PREV_HASH.
 */

import { createHash } from "crypto";

import type { ApplicabilityResult, MatchTargetType } from "./types.js";

/** The predecessor hash of an org's first-ever decision (64 zeros). */
export const GENESIS_PREV_HASH = "0".repeat(64);

/**
 * The identity of the thing a decision is about, plus the org it belongs to.
 * These are NOT on `ApplicabilityResult` (the pure engine is org-agnostic); the
 * writer supplies them at persist time. They ARE hashed — the record must bind
 * the decision to its org + signal + target.
 */
export interface AssessmentIdentity {
  organization_id: string;
  signal_id: string;
  target_type: MatchTargetType;
  target_id: string;
}

/** One by-value evidence snapshot, hashed so the record binds its inputs. */
export interface EvidenceSnapshot {
  evidence_type: string;
  ref_table: string;
  ref_id: string | null;
  /** The value at decision time (already serialized to a stable string by the caller). */
  captured_value: string;
  weight: number | null;
}

function esc(v: string): string {
  // Escape the field delimiters so values can never forge a boundary.
  return v.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "\\n");
}

/**
 * Build the canonical, deterministic string for a decision's hashable content.
 * Field order is fixed and load-bearing; changing it is a breaking hash change
 * and MUST come with an engine_version bump.
 */
export function serializeCanonical(
  identity: AssessmentIdentity,
  result: ApplicabilityResult,
  evidence: EvidenceSnapshot[]
): string {
  const parts: string[] = [
    "v1",
    esc(result.schema_version),
    esc(result.engine_version),
    esc(identity.organization_id),
    esc(identity.signal_id),
    esc(identity.target_type),
    esc(identity.target_id),
    esc(result.decision),
    String(result.confidence),
    esc(result.confidence_band)
  ];

  // reasoning_steps in engine order (order is itself part of the meaning).
  parts.push(`steps:${result.reasoning_steps.length}`);
  for (const s of result.reasoning_steps) {
    parts.push(`${esc(s.rule_id)}=${esc(s.inputs_considered)}=>${esc(s.outcome)}`);
  }

  // affected_entities sorted to a total order (persistence order must not matter).
  const affected = [...result.affected_entities].sort((a, b) => {
    const ka = `${a.node_type} ${a.node_id}`;
    const kb = `${b.node_type} ${b.node_id}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  parts.push(`affected:${affected.length}`);
  for (const a of affected) {
    parts.push(
      `${esc(a.node_type)}:${esc(a.node_id)}@${a.min_depth}<${esc(a.via_target_type)}:${esc(a.via_target_id)}`
    );
  }

  // evidence sorted by (ref_table, ref_id) — the audit-query key.
  const ev = [...evidence].sort((a, b) => {
    const ka = `${a.ref_table} ${a.ref_id ?? ""}`;
    const kb = `${b.ref_table} ${b.ref_id ?? ""}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  parts.push(`evidence:${ev.length}`);
  for (const e of ev) {
    parts.push(
      `${esc(e.evidence_type)}:${esc(e.ref_table)}:${esc(e.ref_id ?? "")}=${esc(e.captured_value)}#${e.weight ?? ""}`
    );
  }

  return parts.join("|");
}

/**
 * Compute the tamper-evident content hash for a decision, chained to its
 * predecessor. `prevHash` is GENESIS_PREV_HASH for an org's first decision.
 */
export function computeContentHash(
  identity: AssessmentIdentity,
  result: ApplicabilityResult,
  evidence: EvidenceSnapshot[],
  prevHash: string
): string {
  const canonical = serializeCanonical(identity, result, evidence);
  return createHash("sha256").update(`${canonical}|prev:${prevHash}`, "utf8").digest("hex");
}

/**
 * Re-verify a chain: given decisions in insertion order (each with its stored
 * content_hash + prev_hash), returns the 0-based index of the first broken link,
 * or -1 if the whole chain verifies. Pure — used by audit tooling + tests.
 */
export function verifyChain(
  links: Array<{
    identity: AssessmentIdentity;
    result: ApplicabilityResult;
    evidence: EvidenceSnapshot[];
    content_hash: string;
    prev_hash: string;
  }>
): number {
  let expectedPrev = GENESIS_PREV_HASH;
  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    if (!link) return i;
    if (link.prev_hash !== expectedPrev) return i;
    const recomputed = computeContentHash(link.identity, link.result, link.evidence, link.prev_hash);
    if (recomputed !== link.content_hash) return i;
    expectedPrev = link.content_hash;
  }
  return -1;
}
