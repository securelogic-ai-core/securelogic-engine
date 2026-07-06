/**
 * briefApplicabilityCitations.test.ts — EAR P11 on real Postgres: the Brief
 * citation lookup returns the org's CURRENT applicability decisions.
 *
 * Uses the REAL WORM writer (persistApplicabilityAssessment) so the ledger
 * shape is authentic: two decisions for the SAME (signal, target) prove the
 * DISTINCT ON … seq DESC "current" selection picks the newer one; a second
 * target on the same signal proves grouping; org B proves cross-org denial.
 */

import { afterAll, beforeAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { persistApplicabilityAssessment } from "../../src/api/lib/applicabilityAssessmentWriter.js";
import { fetchApplicabilityCitations } from "../../src/api/lib/briefApplicabilityCitations.js";
import type { AssessmentIdentity, EvidenceSnapshot } from "../../src/engine/applicability/v1/contentHash.js";
import type { ApplicabilityResult } from "../../src/engine/applicability/v1/types.js";

const CITATION_FLAG = "SECURELOGIC_BRIEF_APPLICABILITY_CITATION_ENABLED";
const ECL_FLAG = "SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED";

let seed: TestDbSeed;
let pool: Pool;

const signalId = crypto.randomUUID();
const vendorTargetId = crypto.randomUUID();
const controlTargetId = crypto.randomUUID();
let newerAssessmentId: string;

function makeResult(decision: ApplicabilityResult["decision"]): ApplicabilityResult {
  return {
    decision,
    confidence: 75,
    confidence_band: "high",
    reasoning_steps: [{ rule_id: "R1", inputs_considered: decision, outcome: decision }],
    affected_entities: [],
    engine_version: "iae-v1.0.0",
    schema_version: "applicability-result.v1"
  };
}

const evidence: EvidenceSnapshot[] = [
  { evidence_type: "match_candidate", ref_table: "signal_match_suggestions", ref_id: null, captured_value: '{"s": 75}', weight: 1 }
];

async function persistAsOrg(
  orgId: string,
  identity: AssessmentIdentity,
  decision: ApplicabilityResult["decision"]
): Promise<string> {
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE app_request");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    const out = await persistApplicabilityAssessment(client, {
      identity,
      result: makeResult(decision),
      evidence
    });
    await client.query("COMMIT");
    return out.assessmentId;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

let savedCitation: string | undefined;
let savedEcl: string | undefined;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the brief citations test.");
  pool = new Pool({ connectionString: url, ssl: false });

  // Ledger: vendor target decided twice (affected → not_affected); control once.
  await persistAsOrg(seed.orgA.id, {
    organization_id: seed.orgA.id,
    signal_id: signalId,
    target_type: "vendor",
    target_id: vendorTargetId
  }, "affected");
  newerAssessmentId = await persistAsOrg(seed.orgA.id, {
    organization_id: seed.orgA.id,
    signal_id: signalId,
    target_type: "vendor",
    target_id: vendorTargetId
  }, "not_affected");
  await persistAsOrg(seed.orgA.id, {
    organization_id: seed.orgA.id,
    signal_id: signalId,
    target_type: "control",
    target_id: controlTargetId
  }, "potentially_affected");
}, 120_000);

afterAll(async () => { await pool?.end(); });

beforeEach(() => {
  savedCitation = process.env[CITATION_FLAG];
  savedEcl = process.env[ECL_FLAG];
  process.env[CITATION_FLAG] = "true";
  process.env[ECL_FLAG] = "true";
});
afterEach(() => {
  if (savedCitation === undefined) delete process.env[CITATION_FLAG];
  else process.env[CITATION_FLAG] = savedCitation;
  if (savedEcl === undefined) delete process.env[ECL_FLAG];
  else process.env[ECL_FLAG] = savedEcl;
});

describe("EAR P11 — brief applicability citations (real ledger)", () => {
  it("returns the CURRENT decision per (signal, target), grouped by signal", async () => {
    const map = await withTenant(seed.orgA.id, () =>
      fetchApplicabilityCitations(seed.orgA.id, [signalId])
    );

    const citations = map[signalId];
    expect(citations).toBeDefined();
    expect(citations).toHaveLength(2);

    const vendor = citations!.find((c) => c.target_type === "vendor");
    expect(vendor).toMatchObject({
      assessment_id: newerAssessmentId,
      target_id: vendorTargetId,
      decision: "not_affected" // the SECOND decision — seq DESC wins, WORM history ignored
    });

    const control = citations!.find((c) => c.target_type === "control");
    expect(control).toMatchObject({
      target_id: controlTargetId,
      decision: "potentially_affected",
      confidence_band: "high"
    });
  });

  it("cross-org: org B sees no citations for org A's ledger", async () => {
    const map = await withTenant(seed.orgB.id, () =>
      fetchApplicabilityCitations(seed.orgB.id, [signalId])
    );
    expect(map).toEqual({});
  });

  it("dark (either flag off) → {} even with a populated ledger", async () => {
    delete process.env[CITATION_FLAG];
    const noFeature = await withTenant(seed.orgA.id, () =>
      fetchApplicabilityCitations(seed.orgA.id, [signalId])
    );
    expect(noFeature).toEqual({});

    process.env[CITATION_FLAG] = "true";
    delete process.env[ECL_FLAG];
    const noEcl = await withTenant(seed.orgA.id, () =>
      fetchApplicabilityCitations(seed.orgA.id, [signalId])
    );
    expect(noEcl).toEqual({});
  });
});
