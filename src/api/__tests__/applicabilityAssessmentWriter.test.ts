/**
 * applicabilityAssessmentWriter.test.ts — fast, database-free unit tests for the
 * Slice 4c persistence writer, using a recording mock Queryable. Proves: the advisory
 * lock is taken, the tail is looked up, GENESIS is used for an org's first decision,
 * the content_hash matches the pure helper, and evidence + affected rows are written.
 * End-to-end behaviour against real Postgres (RLS/WORM/seq chaining) is covered by
 * test/isolation/applicabilityWriter.test.ts.
 */

import { describe, expect, it } from "vitest";

import {
  persistApplicabilityAssessment,
  type Queryable,
  type PersistApplicabilityArgs
} from "../lib/applicabilityAssessmentWriter.js";
import {
  computeContentHash,
  GENESIS_PREV_HASH,
  type EvidenceSnapshot
} from "../../engine/applicability/v1/contentHash.js";
import type { ApplicabilityResult } from "../../engine/applicability/v1/types.js";

const result: ApplicabilityResult = {
  decision: "affected",
  confidence: 92,
  confidence_band: "high",
  reasoning_steps: [{ rule_id: "R1", inputs_considered: "x", outcome: "affected" }],
  affected_entities: [
    { node_type: "application", node_id: "app-1", min_depth: 1, via_target_type: "vendor", via_target_id: "v-1" }
  ],
  engine_version: "iae-v1.0.0",
  schema_version: "applicability-result.v1"
};
const evidence: EvidenceSnapshot[] = [
  { evidence_type: "match_candidate", ref_table: "signal_match_suggestions", ref_id: "m-1", captured_value: '{"s":92}', weight: 1 }
];
const args: PersistApplicabilityArgs = {
  identity: { organization_id: "org-1", signal_id: "sig-1", target_type: "vendor", target_id: "v-1" },
  result,
  evidence
};

/** A mock Queryable that records every statement and returns scripted tail rows. */
function mockDb(tailRows: Array<Record<string, unknown>>) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const db: Queryable = {
    async query(text: string, params: unknown[] = []) {
      calls.push({ text, params });
      if (/pg_advisory_xact_lock/.test(text)) return { rows: [], rowCount: 0 };
      // R4 canonicalization pass — echo the input (the test evidence is already
      // canonical), so hand-computed expected hashes stay valid.
      if (/\(\$1::jsonb\)::text/.test(text)) {
        return { rows: [{ v: String(params[0]) }], rowCount: 1 };
      }
      if (/SELECT content_hash FROM applicability_assessments/.test(text)) {
        return { rows: tailRows, rowCount: tailRows.length };
      }
      if (/INSERT INTO applicability_assessments/.test(text)) {
        return { rows: [{ id: "new-assessment-id" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    }
  };
  return { db, calls };
}

describe("persistApplicabilityAssessment", () => {
  it("takes the per-org advisory lock before reading the tail", async () => {
    const { db, calls } = mockDb([]);
    await persistApplicabilityAssessment(db, args);
    const lockIdx = calls.findIndex((c) => /pg_advisory_xact_lock/.test(c.text));
    const tailIdx = calls.findIndex((c) => /SELECT content_hash/.test(c.text));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(lockIdx).toBeLessThan(tailIdx);
    expect(calls[lockIdx].params).toEqual(["org-1"]);
  });

  it("uses GENESIS prev_hash + correct content_hash for an org's first decision", async () => {
    const { db, calls } = mockDb([]);
    const out = await persistApplicabilityAssessment(db, args);
    const expectedHash = computeContentHash(args.identity, result, evidence, GENESIS_PREV_HASH);
    expect(out.prevHash).toBe(GENESIS_PREV_HASH);
    expect(out.contentHash).toBe(expectedHash);

    const insert = calls.find((c) => /INSERT INTO applicability_assessments/.test(c.text))!;
    // params: [org, signal, target_type, target_id, asset_id (EAR Phase 2 —
    // registry pointer, deliberately NOT hashed), decision, confidence, band,
    // steps, engine, schema, content_hash, prev_hash]
    expect(insert.params[4]).toBeNull(); // quartet target → no registry pointer
    expect(insert.params[11]).toBe(expectedHash);
    expect(insert.params[12]).toBe(GENESIS_PREV_HASH);
    expect(insert.params[5]).toBe("affected");
  });

  it("chains onto the existing tail content_hash", async () => {
    const prior = "a".repeat(64);
    const { db } = mockDb([{ content_hash: prior }]);
    const out = await persistApplicabilityAssessment(db, args);
    expect(out.prevHash).toBe(prior);
    expect(out.contentHash).toBe(computeContentHash(args.identity, result, evidence, prior));
  });

  it("writes one evidence row and one affected-entity row", async () => {
    const { db, calls } = mockDb([]);
    await persistApplicabilityAssessment(db, args);
    expect(calls.filter((c) => /INSERT INTO applicability_evidence/.test(c.text))).toHaveLength(1);
    expect(calls.filter((c) => /INSERT INTO applicability_affected_entities/.test(c.text))).toHaveLength(1);
  });

  it("returns the new assessment id", async () => {
    const { db } = mockDb([]);
    const out = await persistApplicabilityAssessment(db, args);
    expect(out.assessmentId).toBe("new-assessment-id");
  });
});
