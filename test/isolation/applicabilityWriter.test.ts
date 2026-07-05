/**
 * applicabilityWriter.test.ts — Slice 4c: end-to-end persistence of the applicability
 * writer against real Postgres, driving the app_request role (RLS live) inside a tx.
 * Proves: (1) the hash chain is correct across MULTIPLE decisions persisted in ONE tx
 * (the created_at-tie case the `seq` column fixes); (2) each stored row's content_hash
 * verifies against the pure helper; (3) cross-org WITH CHECK rejects a mis-stamped write.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { persistApplicabilityAssessment } from "../../src/api/lib/applicabilityAssessmentWriter.js";
import {
  computeContentHash,
  verifyChain,
  GENESIS_PREV_HASH,
  type AssessmentIdentity,
  type EvidenceSnapshot
} from "../../src/engine/applicability/v1/contentHash.js";
import type { ApplicabilityResult } from "../../src/engine/applicability/v1/types.js";

let seed: TestDbSeed;
let pool: Pool;

function makeResult(decision: ApplicabilityResult["decision"]): ApplicabilityResult {
  return {
    decision,
    confidence: 80,
    confidence_band: "high",
    reasoning_steps: [{ rule_id: "R1", inputs_considered: decision, outcome: decision }],
    affected_entities: [
      { node_type: "application", node_id: crypto.randomUUID(), min_depth: 1, via_target_type: "vendor", via_target_id: crypto.randomUUID() }
    ],
    engine_version: "iae-v1.0.0",
    schema_version: "applicability-result.v1"
  };
}
// NOTE: captured_value here is written in the Postgres jsonb-canonical text
// rendering ('": "' / '", "' spacing) so the writer's R4 canonicalization pass
// is an identity transform and the expected hashes below stay hand-computable.
const evidence: EvidenceSnapshot[] = [
  { evidence_type: "match_candidate", ref_table: "signal_match_suggestions", ref_id: null, captured_value: '{"s": 80}', weight: 1 }
];

async function asOrg<T>(orgId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE app_request");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the applicability writer test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("Slice 4c — persistApplicabilityAssessment (real Postgres)", () => {
  it("chains three decisions persisted in ONE tenant tx (seq-based tail, GENESIS first)", async () => {
    await asOrg(seed.orgA.id, async (client) => {
      const ids: string[] = [];
      const identities: AssessmentIdentity[] = [];
      const results: ApplicabilityResult[] = [];

      const decisions: Array<ApplicabilityResult["decision"]> = ["affected", "potentially_affected", "not_affected"];
      let expectedPrev = GENESIS_PREV_HASH;
      for (const d of decisions) {
        const identity: AssessmentIdentity = {
          organization_id: seed.orgA.id,
          signal_id: crypto.randomUUID(),
          target_type: "vendor",
          target_id: crypto.randomUUID()
        };
        const result = makeResult(d);
        const out = await persistApplicabilityAssessment(client, { identity, result, evidence });
        expect(out.prevHash).toBe(expectedPrev);
        expect(out.contentHash).toBe(computeContentHash(identity, result, evidence, expectedPrev));
        ids.push(out.assessmentId);
        identities.push(identity);
        results.push(result);
        expectedPrev = out.contentHash;
      }

      // Read the persisted rows back in seq order and verify the chain end to end.
      const rows = await client.query(
        `SELECT id, content_hash, prev_hash FROM applicability_assessments
          WHERE organization_id = $1 ORDER BY seq ASC`,
        [seed.orgA.id]
      );
      expect(rows.rowCount).toBe(3);
      const links = rows.rows.map((r, i) => ({
        identity: identities[i],
        result: results[i],
        evidence,
        content_hash: String(r.content_hash),
        prev_hash: String(r.prev_hash)
      }));
      expect(verifyChain(links)).toBe(-1);

      // Each assessment persisted its evidence + affected child rows.
      for (const id of ids) {
        const ev = await client.query("SELECT id FROM applicability_evidence WHERE assessment_id = $1", [id]);
        const af = await client.query("SELECT id FROM applicability_affected_entities WHERE assessment_id = $1", [id]);
        expect(ev.rowCount).toBe(1);
        expect(af.rowCount).toBe(1);
      }
    });
  });

  it("rejects a decision stamped for another org (RLS WITH CHECK)", async () => {
    await asOrg(seed.orgA.id, async (client) => {
      const identity: AssessmentIdentity = {
        organization_id: seed.orgB.id, // mismatched — scoped to org A
        signal_id: crypto.randomUUID(),
        target_type: "vendor",
        target_id: crypto.randomUUID()
      };
      await expect(
        persistApplicabilityAssessment(client, { identity, result: makeResult("affected"), evidence })
      ).rejects.toThrow(/row-level security/i);
    });
  });
});
