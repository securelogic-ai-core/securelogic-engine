/**
 * sufficiencyDeterminationAuthority.test.ts - VA-S4-4C-4 against a real Postgres.
 *
 * The pure core is unit-tested in src/api/__tests__/sufficiencyVetoes.test.ts.
 * What can only be proven here is what the DATABASE refuses regardless of the
 * route: an unattributed determination, a SUFFICIENT verdict whose own basis
 * says a veto did not pass, a partial evaluation, and a row claiming coverage.
 *
 * A route can be bypassed by a future writer. A CHECK cannot. So every test
 * that matters below writes DIRECT SQL, as an adversary would.
 */

process.env["JWT_SECRET"] ??= "test-jwt-secret-for-sufficiency-authority";

import { resolveAssuranceCoverage } from "../../src/api/lib/vendorAssurance/assuranceCoverage.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";

import { bootstrapTestDb, seedUser, seedVendor, type TestDbSeed } from "./testDb.js";
import { signJwt } from "../../src/api/lib/jwt.js";
import { recordAllCurrentConsents } from "../../src/api/lib/legalConsent.js";
import { ASSURANCE_BEARING_FIELD_NAMES } from "../../src/api/lib/vendorAssuranceValidation.js";
import { publishCanonicalControls } from "../../src/api/lib/controls/canonicalControlPublisher.js";
import {
  buildDeterminationBasis,
  evaluateVetoes,
  EVALUATED_VETOES,
  VETO_EVALUATOR_VERSION,
  type VetoEvaluation,
} from "../../src/api/lib/vendorAssurance/sufficiencyVetoes.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;
let userA = "", userB = "", viewerA = "";
let jwtA = "", jwtB = "", jwtViewerA = "";
let vendorA = "", vendorB = "";
let apiKeyA = "";
/** The org-side framework identity the published crosswalk actually reaches. */
let frameworkKey = "", frameworkVersion = "";

const ctrl = (id: string, result: string) => ({
  control_id: id,
  description: `Tested control ${id}`,
  test_procedure: "Inspected configuration and reperformed for a sample of 25.",
  result,
});

async function extractedDoc(
  orgId: string,
  vendorId: string,
  label: string,
  opts: { controls?: ReturnType<typeof ctrl>[]; exceptions?: unknown[] } = {}
): Promise<{ documentId: string; extractionId: string }> {
  const controls = opts.controls ?? [ctrl("CC6.1", "No exceptions noted.")];
  const d = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assurance_documents
       (organization_id, vendor_id, original_filename, byte_size, sha256,
        storage_key, mime_type, document_type_hint, processing_status)
     VALUES ($1,$2,$3,1024,$4,$5,'application/pdf','soc2_type2','extracted') RETURNING id`,
    [orgId, vendorId, `${label}.pdf`, label.padEnd(64, "0").slice(0, 64), `k/${label}.pdf`]
  );
  const documentId = d.rows[0]!.id;

  const fields: Record<string, unknown> = {
    controls: { value: controls, confidence: 0.99, status: "extracted" },
    exceptions: { value: opts.exceptions ?? [], confidence: 0.9, status: "extracted" },
    management_responses: { value: [], confidence: 0.9, status: "extracted" },
    report_type: { value: "SOC 2 Type II", confidence: 0.99, status: "extracted" },
    report_period_start: { value: "2025-01-01", confidence: 0.99, status: "extracted" },
    report_period_end: { value: "2025-12-31", confidence: 0.99, status: "extracted" },
    trust_services_criteria: { value: ["Security", "Availability"], confidence: 0.99, status: "extracted" },
    subservice_method: { value: "Inclusive", confidence: 0.99, status: "extracted" },
  };
  for (const f of ASSURANCE_BEARING_FIELD_NAMES) {
    if (!(f in fields)) fields[f] = { value: "x", confidence: 0.9, status: "extracted" };
  }
  const e = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assurance_extractions (organization_id, document_id, model_id, prompt_version, fields)
     VALUES ($1,$2,'test-model','soc-extraction-v3',$3::jsonb) RETURNING id`,
    [orgId, documentId, JSON.stringify(fields)]
  );
  const extractionId = e.rows[0]!.id;
  const uid = orgId === seed.orgA.id ? userA : userB;

  for (const field of ASSURANCE_BEARING_FIELD_NAMES) {
    await pool.query(
      `INSERT INTO vendor_assurance_review_decisions
         (organization_id, extraction_id, field_name, decision, decided_by_user_id)
       VALUES ($1,$2,$3,'accept',$4)`,
      [orgId, extractionId, field, uid]
    );
  }
  for (const c of controls) {
    await pool.query(
      `INSERT INTO vendor_assurance_review_decisions
         (organization_id, extraction_id, field_name, decision, decided_by_user_id,
          element_key, element_snapshot)
       VALUES ($1,$2,'controls','accept',$3,$4,$5::jsonb)`,
      [orgId, extractionId, uid, c.control_id, JSON.stringify(c)]
    );
  }
  return { documentId, extractionId };
}

const approve = (id: string, jwt: string) =>
  request(app).post(`/api/vendor-assurance/documents/${id}/approve`)
    .set("Authorization", `Bearer ${jwt}`).send({});

const candidates = (id: string, jwt: string) =>
  request(app).get(`/api/vendor-assurance/documents/${id}/sufficiency-candidates`)
    .set("Authorization", `Bearer ${jwt}`);

const determine = (docId: string, resolutionId: string, jwt: string | null, body: unknown) => {
  const r = request(app).post(
    `/api/vendor-assurance/documents/${docId}/candidates/${resolutionId}/sufficiency`
  );
  return (jwt ? r.set("Authorization", `Bearer ${jwt}`) : r.set("x-api-key", apiKeyA)).send(body);
};

/** Resolution materialization is fire-and-forget after approve; wait for it. */
async function awaitResolutions(extractionId: string, expected: number) {
  for (let i = 0; i < 200; i += 1) {
    const r = await pool.query(
      `SELECT id FROM vendor_tested_control_resolutions
        WHERE extraction_id = $1 AND superseded_at IS NULL AND resolution_state = 'resolved'`,
      [extractionId]
    );
    if (r.rows.length >= expected) return r.rows;
    await new Promise((res) => setTimeout(res, 25));
  }
  return [];
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env["DATABASE_URL"] = url;
  process.env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"] = "true";
  // Without this the capability gate is a passthrough and every authorization
  // assertion below passes VACUOUSLY. Staging and production both run it true.
  process.env["SECURELOGIC_SEAT_MODEL_ENABLED"] = "true";
  pool = new Pool({ connectionString: url, ssl: false });

  const uA = await seedUser(pool, seed.orgA.id, { email: "suff-a@example.com" });
  const uB = await seedUser(pool, seed.orgB.id, { email: "suff-b@example.com" });
  const vA = await seedUser(pool, seed.orgA.id, { email: "suff-viewer-a@example.com" });
  userA = uA.id; userB = uB.id; viewerA = vA.id;
  for (const [u, org] of [[uA, seed.orgA.id], [uB, seed.orgB.id], [vA, seed.orgA.id]] as const) {
    await recordAllCurrentConsents(pool, {
      userId: u.id, organizationId: org, consentMethod: "admin_recorded",
    });
  }
  await pool.query(`UPDATE users SET seat_type = 'viewer', role = 'viewer' WHERE id = $1`, [viewerA]);

  jwtA = signJwt(userA, seed.orgA.id, "admin");
  jwtB = signJwt(userB, seed.orgB.id, "admin");
  jwtViewerA = signJwt(viewerA, seed.orgA.id, "viewer");

  vendorA = await seedVendor(pool, seed.orgA.id, { name: "Sufficiency vendor A" });
  vendorB = await seedVendor(pool, seed.orgB.id, { name: "Sufficiency vendor B" });

  await publishCanonicalControls(pool as never, { publishedByUserId: userA, apply: true });

  // Give both organisations a framework the published crosswalk actually
  // reaches, discovered from the crosswalk rather than hard-coded, so this test
  // does not silently go vacuous when the corpus is re-curated.
  const target = await pool.query<{ framework_key: string; framework_version: string }>(
    `SELECT framework_key, framework_version, COUNT(*) AS n
       FROM canonical_control_crosswalk
      WHERE status = 'published' AND superseded_at IS NULL AND framework_key <> 'soc2'
      GROUP BY 1,2 ORDER BY n DESC LIMIT 1`
  );
  frameworkKey = target.rows[0]!.framework_key;
  frameworkVersion = target.rows[0]!.framework_version;

  for (const org of [seed.orgA.id, seed.orgB.id]) {
    const f = await pool.query<{ id: string }>(
      `INSERT INTO frameworks (organization_id, name, framework_key, version)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [org, `Sufficiency ${frameworkKey}`, frameworkKey, frameworkVersion]
    );
    const refs = await pool.query<{ requirement_reference: string }>(
      `SELECT DISTINCT requirement_reference FROM canonical_control_crosswalk
        WHERE framework_key = $1 AND framework_version = $2
          AND status = 'published' AND superseded_at IS NULL`,
      [frameworkKey, frameworkVersion]
    );
    for (const r of refs.rows) {
      await pool.query(
        `INSERT INTO requirements (framework_id, reference_id, title, description)
         VALUES ($1,$2,$3,$3)`,
        [f.rows[0]!.id, r.requirement_reference, `Requirement ${r.requirement_reference}`]
      );
    }
  }

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });

  // The "generic API key alone" adversary: org A's own premium key. It
  // authenticates, carries premium, and scopeForApiKey() resolves it to a
  // full/admin seat - so it HOLDS assurance:review. What it can never be is a
  // human.
  apiKeyA = seed.orgA.apiKey;
}, 300_000);

afterAll(async () => { await pool?.end(); });

/* ═══════════════════════════════════════════════════════════════════════
   The candidate surface, and the fan-out Ruling 6 says must stay visible.
   ═══════════════════════════════════════════════════════════════════════ */

describe("candidates", () => {
  it("enumerates one candidate per (tested control x organisation requirement) arm", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "cand-fanout");
    expect((await approve(documentId, jwtA)).status).toBe(200);
    const resolutions = await awaitResolutions(extractionId, 1);
    expect(resolutions.length).toBeGreaterThan(0);

    const res = await candidates(documentId, jwtA);
    expect(res.status).toBe(200);
    expect(res.body.establishes_requirement_coverage).toBe(false);
    expect(res.body.evaluator_version).toBe(VETO_EVALUATOR_VERSION);
    expect(res.body.candidates.length).toBeGreaterThan(0);

    // The fan-out is REAL CONTENT, not a defect: one tested control reaching
    // several requirements is several candidates, each judged on its own.
    const byControl = new Map<string, number>();
    for (const c of res.body.candidates) {
      byControl.set(c.element_key, (byControl.get(c.element_key) ?? 0) + 1);
    }
    expect([...byControl.values()].some((n) => n >= 1)).toBe(true);

    for (const c of res.body.candidates) {
      expect(c.vetoes).toHaveLength(EVALUATED_VETOES.length);
      expect(c.determination).toBeNull();
    }
  }, 120_000);

  it("every candidate is blocked from SUFFICIENT today, and says why", async () => {
    // The honest state after step 3 + evaluator 1.1: report_period is now a
    // COMPUTED fact (this fixture's window runs to 2026-12-31, so it is
    // PASSED, not unresolved), while contradictory_evidence stays unresolved
    // at candidate level — the requirement grain is named at determination
    // time, and only the write path can evaluate it.
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "cand-blocked");
    expect((await approve(documentId, jwtA)).status).toBe(200);
    await awaitResolutions(extractionId, 1);

    const res = await candidates(documentId, jwtA);
    for (const c of res.body.candidates) {
      const unresolved = (c.vetoes as VetoEvaluation[]).filter((v) => v.state !== "PASSED");
      expect(unresolved.map((v) => v.veto)).toContain("contradictory_evidence");
      // 1.1: the ratified D1 policy makes this fixture's period CURRENT.
      const period = (c.vetoes as VetoEvaluation[]).find((v) => v.veto === "report_period");
      expect(period?.state).toBe("PASSED");
      expect(period?.reason).toBe("within_ratified_validity_window");
    }
  }, 120_000);
});

/* ═══════════════════════════════════════════════════════════════════════
   Authority. Three independent axes, and the route needs all of them.
   ═══════════════════════════════════════════════════════════════════════ */

describe("authority", () => {
  it("an API key that IS entitled and DOES hold the capability is still refused as non-human", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "auth-apikey");
    expect((await approve(documentId, jwtA)).status).toBe(200);
    const resolutions = await awaitResolutions(extractionId, 1);

    // First prove the key really is a working, entitled identity - a refusal
    // for the wrong reason must never read as a proof.
    const read = await request(app)
      .get(`/api/vendor-assurance/documents/${documentId}/sufficiency-candidates`)
      .set("x-api-key", apiKeyA);
    expect(read.status).toBe(200);

    const res = await determine(documentId, read.body.candidates[0].resolution_id, null, {
      requirement_framework_key: frameworkKey,
      requirement_framework_version: frameworkVersion,
      requirement_reference: read.body.candidates[0].requirement_reference,
      determination: "INDETERMINATE",
      indeterminate_reason: "veto_not_evaluable",
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("human_reviewer_required");
    expect(res.body.error).not.toBe("capability_required");
  }, 120_000);

  it("a viewer seat is refused by the global mutation chokepoint", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "auth-viewer");
    expect((await approve(documentId, jwtA)).status).toBe(200);
    const resolutions = await awaitResolutions(extractionId, 1);

    const res = await determine(documentId, resolutions[0]!.id, jwtViewerA, {
      requirement_framework_key: frameworkKey,
      requirement_framework_version: frameworkVersion,
      requirement_reference: "anything",
      determination: "INSUFFICIENT",
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("read_only_access");
  }, 120_000);

  it("the database refuses an unattributed determination, whatever the route does", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "auth-db");
    expect((await approve(documentId, jwtA)).status).toBe(200);
    const resolutions = await awaitResolutions(extractionId, 1);
    const r = await pool.query(
      `SELECT element_key, canonical_control_id FROM vendor_tested_control_resolutions WHERE id = $1`,
      [resolutions[0]!.id]
    );
    const basis = buildDeterminationBasis(
      EVALUATED_VETOES.map((veto) => ({ veto, state: "PASSED" as const, reason: "x" })),
      {}
    );
    await expect(
      pool.query(
        `INSERT INTO vendor_requirement_sufficiency_determinations
           (organization_id, document_id, extraction_id, resolution_id, element_key,
            canonical_control_id, requirement_framework_key, requirement_framework_version,
            requirement_reference, determination, determined_by_user_id, basis, evaluator_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'X','SUFFICIENT',NULL,$9::jsonb,'v')`,
        [
          seed.orgA.id, documentId, extractionId, resolutions[0]!.id,
          r.rows[0]!.element_key, r.rows[0]!.canonical_control_id,
          frameworkKey, frameworkVersion, JSON.stringify(basis),
        ]
      )
    ).rejects.toThrow(/no attributed human reviewer/i);
  }, 120_000);
});

/* ═══════════════════════════════════════════════════════════════════════
   Fail-closed is STRUCTURAL. These are the tests that matter.
   ═══════════════════════════════════════════════════════════════════════ */

describe("the database refuses what the ruling forbids", () => {
  let documentId = "", extractionId = "", resolutionId = "";
  let elementKey = "", canonicalControlId = "";

  beforeAll(async () => {
    const d = await extractedDoc(seed.orgA.id, vendorA, "failclosed");
    documentId = d.documentId; extractionId = d.extractionId;
    await approve(documentId, jwtA);
    const rs = await awaitResolutions(extractionId, 1);
    resolutionId = rs[0]!.id;
    const r = await pool.query(
      `SELECT element_key, canonical_control_id FROM vendor_tested_control_resolutions WHERE id = $1`,
      [resolutionId]
    );
    elementKey = r.rows[0]!.element_key;
    canonicalControlId = r.rows[0]!.canonical_control_id;
  }, 300_000);

  const insert = (determination: string, basis: unknown, ref = "X") =>
    pool.query(
      `INSERT INTO vendor_requirement_sufficiency_determinations
         (organization_id, document_id, extraction_id, resolution_id, element_key,
          canonical_control_id, requirement_framework_key, requirement_framework_version,
          requirement_reference, determination, determined_by_user_id, basis, evaluator_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,'v')`,
      [
        seed.orgA.id, documentId, extractionId, resolutionId, elementKey, canonicalControlId,
        frameworkKey, frameworkVersion, ref, determination, userA, JSON.stringify(basis),
      ]
    );

  it("refuses SUFFICIENT whose own basis records a FIRED veto", async () => {
    const evals: VetoEvaluation[] = EVALUATED_VETOES.map((veto, i) => ({
      veto, state: i === 0 ? ("FIRED" as const) : ("PASSED" as const), reason: "x",
    }));
    await expect(insert("SUFFICIENT", buildDeterminationBasis(evals, {}), "F1"))
      .rejects.toThrow(/fail_closed/i);
  });

  it("refuses SUFFICIENT whose own basis records a NOT_EVALUABLE veto", async () => {
    // The owner ruling, at the storage layer: epistemic insufficiency blocks
    // exactly as a fired veto does, and no column can express an override.
    const evals: VetoEvaluation[] = EVALUATED_VETOES.map((veto, i) => ({
      veto, state: i === 0 ? ("NOT_EVALUABLE" as const) : ("PASSED" as const), reason: "x",
    }));
    await expect(insert("SUFFICIENT", buildDeterminationBasis(evals, {}), "F2"))
      .rejects.toThrow(/fail_closed/i);
  });

  it("ACCEPTS INDETERMINATE on exactly the same blocked basis", async () => {
    // Proves the previous two refusals are about the VERDICT, not the basis.
    const evals: VetoEvaluation[] = EVALUATED_VETOES.map((veto, i) => ({
      veto, state: i === 0 ? ("NOT_EVALUABLE" as const) : ("PASSED" as const), reason: "x",
    }));
    const r = await pool.query(
      `INSERT INTO vendor_requirement_sufficiency_determinations
         (organization_id, document_id, extraction_id, resolution_id, element_key,
          canonical_control_id, requirement_framework_key, requirement_framework_version,
          requirement_reference, determination, indeterminate_reason,
          determined_by_user_id, basis, evaluator_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'F3','INDETERMINATE','veto_not_evaluable',$9,$10::jsonb,'v')
       RETURNING id`,
      [
        seed.orgA.id, documentId, extractionId, resolutionId, elementKey, canonicalControlId,
        frameworkKey, frameworkVersion, userA,
        JSON.stringify(buildDeterminationBasis(evals, {})),
      ]
    );
    expect(r.rows[0]!.id).toBeTruthy();
  });

  it("refuses SUFFICIENT when the basis COUNTS LIE about the veto states", async () => {
    // The strongest adversary: twelve vetoes present, one of them FIRED, and a
    // counts block claiming everything passed. The constraint reads the STATES,
    // not the self-reported summary, so the lie does not help.
    const evals: VetoEvaluation[] = EVALUATED_VETOES.map((veto, i) => ({
      veto, state: i === 0 ? ("FIRED" as const) : ("PASSED" as const), reason: "x",
    }));
    const basis = buildDeterminationBasis(evals, {}) as Record<string, unknown>;
    basis["counts"] = { passed: 12, fired: 0, not_evaluable: 0 };
    await expect(insert("SUFFICIENT", basis, "F6")).rejects.toThrow(/fail_closed/i);
  });

  it("refuses a basis with NO counts key — a CHECK that evaluates to NULL passes", async () => {
    // The original form of this constraint used `basis #>> '{counts,fired}' = 0`,
    // which is NULL when the key is absent, and a NULL CHECK PASSES. This test
    // exists so that hole cannot be reopened.
    const basis = buildDeterminationBasis(
      EVALUATED_VETOES.map((veto) => ({ veto, state: "PASSED" as const, reason: "x" })),
      {}
    ) as Record<string, unknown>;
    delete basis["counts"];
    await expect(insert("SUFFICIENT", basis, "F7")).rejects.toThrow(/counts_present/i);
  });

  it("refuses a determination built on a PARTIAL evaluation", async () => {
    const partial = {
      evaluator_version: "v", establishes_requirement_coverage: false,
      vetoes: [{ veto: "report_scope", state: "PASSED", reason: "x" }],
      counts: { passed: 1, fired: 0, not_evaluable: 0 },
    };
    await expect(insert("INSUFFICIENT", partial, "F4")).rejects.toThrow(/basis_completeness/i);
  });

  it("refuses a row that claims to establish coverage", async () => {
    const basis = buildDeterminationBasis(
      EVALUATED_VETOES.map((veto) => ({ veto, state: "PASSED" as const, reason: "x" })),
      {}
    );
    (basis as Record<string, unknown>)["establishes_requirement_coverage"] = true;
    await expect(insert("SUFFICIENT", basis, "F5")).rejects.toThrow(/no_coverage_claim/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   Tenant isolation.
   ═══════════════════════════════════════════════════════════════════════ */

describe("tenant isolation", () => {
  it("org B cannot read org A's candidates", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "iso-read");
    expect((await approve(documentId, jwtA)).status).toBe(200);
    await awaitResolutions(extractionId, 1);
    expect((await candidates(documentId, jwtB)).status).toBe(404);
  }, 120_000);

  it("org B cannot determine sufficiency on org A's candidate", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "iso-write");
    expect((await approve(documentId, jwtA)).status).toBe(200);
    const rs = await awaitResolutions(extractionId, 1);
    const res = await determine(documentId, rs[0]!.id, jwtB, {
      requirement_framework_key: frameworkKey,
      requirement_framework_version: frameworkVersion,
      requirement_reference: "X",
      determination: "INSUFFICIENT",
    });
    expect(res.status).toBe(404);
  }, 120_000);

  it("RLS is enabled on the determination table", async () => {
    const r = await pool.query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class
        WHERE relname = 'vendor_requirement_sufficiency_determinations'`
    );
    expect(r.rows[0]!.relrowsecurity).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   What a determination must NOT touch.
   ═══════════════════════════════════════════════════════════════════════ */

describe("a determination changes nothing else", () => {
  it("writes no Layer-1, Layer-2 or Layer-3 row", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "no-spill");
    expect((await approve(documentId, jwtA)).status).toBe(200);
    const rs = await awaitResolutions(extractionId, 1);

    const before = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM vendor_tested_control_assertions WHERE extraction_id = $1) a,
         (SELECT COUNT(*) FROM vendor_tested_control_effectiveness WHERE extraction_id = $1) e,
         (SELECT COUNT(*) FROM vendor_assurance_exceptions WHERE extraction_id = $1) x`,
      [extractionId]
    );

    const list = await candidates(documentId, jwtA);
    const c = list.body.candidates[0];
    // The candidate names its OWN resolution: one tested control fans out to
    // several, so rs[0] is not necessarily this candidate's arm.
    const res = await determine(documentId, c.resolution_id, jwtA, {
      requirement_framework_key: c.requirement_framework_key,
      requirement_framework_version: c.requirement_framework_version,
      requirement_reference: c.requirement_reference,
      determination: "INDETERMINATE",
      indeterminate_reason: "veto_not_evaluable",
      reviewer_note: "Cannot conclude until evidence linkage exists.",
    });
    expect(res.status).toBe(200);
    expect(res.body.establishes_requirement_coverage).toBe(false);

    const after = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM vendor_tested_control_assertions WHERE extraction_id = $1) a,
         (SELECT COUNT(*) FROM vendor_tested_control_effectiveness WHERE extraction_id = $1) e,
         (SELECT COUNT(*) FROM vendor_assurance_exceptions WHERE extraction_id = $1) x`,
      [extractionId]
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  }, 120_000);

  it("refuses SUFFICIENT through the route, naming the blocking vetoes", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "route-refuse");
    expect((await approve(documentId, jwtA)).status).toBe(200);
    const rs = await awaitResolutions(extractionId, 1);
    const list = await candidates(documentId, jwtA);
    const c = list.body.candidates[0];

    const res = await determine(documentId, c.resolution_id, jwtA, {
      requirement_framework_key: c.requirement_framework_key,
      requirement_framework_version: c.requirement_framework_version,
      requirement_reference: c.requirement_reference,
      determination: "SUFFICIENT",
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("sufficiency_blocked_by_vetoes");
    // 1.1: contradictory_evidence is evaluated at write time and PASSES here
    // (no conflicting judgement exists), so it must NOT be in the blocking
    // list — and the refusal still stands on the vetoes that remain.
    const blocking = res.body.blocking.map((b: { veto: string }) => b.veto);
    expect(blocking).not.toContain("contradictory_evidence");
    expect(blocking).toContain("tested_control_result");
  }, 120_000);

  it("retains the superseded determination rather than overwriting it", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "supersede");
    expect((await approve(documentId, jwtA)).status).toBe(200);
    const rs = await awaitResolutions(extractionId, 1);
    const list = await candidates(documentId, jwtA);
    const c = list.body.candidates[0];
    const body = {
      requirement_framework_key: c.requirement_framework_key,
      requirement_framework_version: c.requirement_framework_version,
      requirement_reference: c.requirement_reference,
    };

    expect((await determine(documentId, c.resolution_id, jwtA, {
      ...body, determination: "INDETERMINATE", indeterminate_reason: "veto_not_evaluable",
    })).status).toBe(200);

    // A silent re-decision is refused.
    const second = await determine(documentId, c.resolution_id, jwtA, {
      ...body, determination: "INSUFFICIENT",
    });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("sufficiency_determination_already_recorded");

    expect((await determine(documentId, c.resolution_id, jwtA, {
      ...body, determination: "INSUFFICIENT", supersede: true,
    })).status).toBe(200);

    const rows = await pool.query(
      `SELECT determination, superseded_at FROM vendor_requirement_sufficiency_determinations
        WHERE resolution_id = $1 AND requirement_reference = $2 ORDER BY determined_at`,
      [c.resolution_id, c.requirement_reference]
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]!.superseded_at).not.toBeNull();
    expect(rows.rows[1]!.superseded_at).toBeNull();
    expect(rows.rows[1]!.determination).toBe("INSUFFICIENT");
  }, 120_000);
});

/* ═══════════════════════════════════════════════════════════════════════
   Risk acceptance is a different layer, and may not reach this one.
   ═══════════════════════════════════════════════════════════════════════ */

describe("risk acceptance cannot rewrite an assurance basis", () => {
  it("no source file outside the assurance surface writes the determination table", () => {
    // Owner ruling 2026-08-31. Tolerating a gap is not closing it, so the two
    // acts must not share a writer. Enforced as a scan because the danger is a
    // FUTURE writer, not a present one.
    const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..");
    const SRC = path.join(ROOT, "src");
    const TABLE = "vendor_requirement_sufficiency_determinations";
    const ALLOWED = [
      path.join("lib", "vendorAssurance", "sufficiencyCandidates.ts"),
      path.join("routes", "vendorAssuranceDocuments.ts"),
    ];

    const files: string[] = [];
    (function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "node_modules" || entry === "__tests__") continue;
          walk(full);
        } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) files.push(full);
      }
    })(SRC);

    const writers = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      if (!src.includes(TABLE)) return false;
      return /INSERT\s+INTO\s+vendor_requirement_sufficiency_determinations|UPDATE\s+vendor_requirement_sufficiency_determinations/i.test(src);
    });

    expect(
      writers.map((f) => path.relative(SRC, f)),
      "A sufficiency determination may only be written by the governed assurance surface. " +
        "Risk acceptance belongs at the risk-decision layer and must never rewrite an " +
        "INDETERMINATE assurance basis into SUFFICIENT."
    ).toEqual(writers.filter((f) => ALLOWED.some((a) => f.endsWith(a))).map((f) => path.relative(SRC, f)));
  });

  it("no risk-acceptance module references the determination table at all", () => {
    const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..");
    const SRC = path.join(ROOT, "src");
    const suspects: string[] = [];
    (function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "node_modules" || entry === "__tests__") continue;
          walk(full);
        } else if (/risk/i.test(entry) && entry.endsWith(".ts")) suspects.push(full);
      }
    })(SRC);

    const offenders = suspects.filter((f) =>
      readFileSync(f, "utf8").includes("vendor_requirement_sufficiency_determinations")
    );
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   The evaluator agrees with what the database stored.
   ═══════════════════════════════════════════════════════════════════════ */

describe("the stored basis is the evaluation that was actually made", () => {
  it("records all twelve vetoes and the evaluator version", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "basis-store");
    expect((await approve(documentId, jwtA)).status).toBe(200);
    const rs = await awaitResolutions(extractionId, 1);
    const list = await candidates(documentId, jwtA);
    const c = list.body.candidates[0];

    expect((await determine(documentId, c.resolution_id, jwtA, {
      requirement_framework_key: c.requirement_framework_key,
      requirement_framework_version: c.requirement_framework_version,
      requirement_reference: c.requirement_reference,
      determination: "INDETERMINATE",
      indeterminate_reason: "veto_not_evaluable",
    })).status).toBe(200);

    const row = await pool.query<{ basis: Record<string, unknown>; evaluator_version: string }>(
      `SELECT basis, evaluator_version FROM vendor_requirement_sufficiency_determinations
        WHERE resolution_id = $1 AND requirement_reference = $2 AND superseded_at IS NULL`,
      [c.resolution_id, c.requirement_reference]
    );
    const basis = row.rows[0]!.basis;
    expect((basis["vetoes"] as unknown[]).length).toBe(12);
    expect(basis["establishes_requirement_coverage"]).toBe(false);
    expect(row.rows[0]!.evaluator_version).toBe(VETO_EVALUATOR_VERSION);

    // And the evaluation is reproducible: the same inputs give the same shape.
    const recomputed = evaluateVetoes({
      requirementReference: c.tested_control_reference,
      reportType: "SOC 2 Type II",
      reportPeriodStart: "2025-01-01",
      reportPeriodEnd: "2025-12-31",
      trustServicesCriteria: ["Security", "Availability"],
      subserviceMethod: "Inclusive",
      exceptionsFieldPresent: true,
      linkedExceptions: [],
      acceptedOpinion: null,
      effectivenessDecision: null,
      governedEffectiveness: null,
      mappingSource: "securelogic",
      mappingStatus: "published",
      mappingApproved: true,
      openFindingsOnCanonicalControl: null,
      validityAssessment: null,
      contradictoryEvidenceQueryable: false,
      asOf: new Date(),
    });
    expect(recomputed).toHaveLength(EVALUATED_VETOES.length);
  }, 120_000);
});

/* ═══════════════════════════════════════════════════════════════════════════
   VA-S4 STEP 5 — the chain, end to end, through PRODUCT PATHS.

   Everything above proved the pieces refuse correctly. This proves the whole
   thing WORKS when a human does every governed act in order — the first
   SUFFICIENT this platform has ever been able to record — and that the scope
   resolver reduces question depth for exactly that requirement, with the
   decision basis riding the scope item, and byte-identical output while the
   flag is off.
   ═══════════════════════════════════════════════════════════════════════════ */

describe("step 5 — sufficient assurance reduces question depth, end to end", () => {
  const decideEffectiveness = (docId: string, key: string, jwt: string, body: unknown) =>
    request(app).post(
      `/api/vendor-assurance/documents/${docId}/tested-controls/${encodeURIComponent(key)}/effectiveness`
    ).set("Authorization", `Bearer ${jwt}`).send(body);

  // Through the PRODUCT PATH: the engagement is created exactly as a customer
  // creates one, with a full inherent-risk intake — the fact mirror rejects an
  // engagement with null inputs, and it is right to.
  async function seedEngagement(_orgId: string, vendorId: string): Promise<string> {
    const created = await request(app).post("/api/vendor-engagements")
      .set("Authorization", `Bearer ${jwtA}`)
      .send({
        vendor_id: vendorId, title: `S5 chain ${Date.now()}`,
        engagement_type: "initial",
        data_sensitivity: "confidential", data_volume: "moderate", access_level: "read_write",
        operational_dependency: "moderate", recoverability: "hours", business_criticality: "medium",
        regulatory_exposure: "moderate", regulatory_breach_notification: false,
        ai_involvement: "none", ai_autonomy: "none", hosting_model: "saas",
        fourth_party_exposure: "low", concentration: "none",
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return created.body.id as string;
  }
  const resolveScopeVia = (engagementId: string, jwt: string) =>
    request(app).post(`/api/vendor-engagements/${engagementId}/scope`)
      .set("Authorization", `Bearer ${jwt}`).send({});

  let coveredRequirementRef = "";
  let coveredRequirementId = "";
  let determinationId = "";

  it("a fully governed chain records the FIRST reachable SUFFICIENT", async () => {
    const { documentId, extractionId } = await extractedDoc(seed.orgA.id, vendorA, "s5-happy");
    // Through the PRODUCT PATH — the approve route is what materializes the
    // tested-control assertions and resolutions. A direct status UPDATE would
    // skip that and the whole chain would be a fixture that failed to build.
    expect((await approve(documentId, jwtA)).status).toBe(200);
    const resolutions = await awaitResolutions(extractionId, 1);
    expect(resolutions.length, "resolution materialization must have run").toBeGreaterThan(0);

    // Layer 2: a human accepts governed effectiveness through the 4C-3 route.
    const eff = await decideEffectiveness(documentId, "CC6.1", jwtA, {
      effectiveness: "EFFECTIVE",
      reviewer_note: "Operating effectiveness accepted for the step-5 chain proof.",
    });
    expect(eff.status, JSON.stringify(eff.body)).toBe(200);

    // The document-level opinion must be a human-accepted one (VA-S4-P2) — the
    // accepted_opinion veto is NOT_EVALUABLE until someone owns the opinion.
    const op = await request(app)
      .post(`/api/vendor-assurance/documents/${documentId}/assurance-opinion`)
      .set("Authorization", `Bearer ${jwtA}`)
      .send({ opinion: "unmodified",
        reviewer_note: "Unmodified opinion accepted for the step-5 chain proof." });
    expect(op.status, JSON.stringify(op.body)).toBe(200);

    const cand = await candidates(documentId, jwtA);
    expect(cand.status).toBe(200);
    const c = cand.body.candidates.find((x: { requirement_reference: string | null }) => x.requirement_reference);
    expect(c, "the crosswalk must yield a requirement-bearing candidate").toBeTruthy();
    coveredRequirementRef = c.requirement_reference;

    // FIXTURE HYGIENE, not product path: earlier tests in this suite left live
    // INSUFFICIENT rows on this same requirement identity, and the 1.1
    // contradiction veto correctly FIRES on them (that firing is itself
    // asserted by the suite above). Supersede those stray rows so this test
    // proves the clean-chain claim rather than re-proving the conflict.
    await pool.query(
      `UPDATE vendor_requirement_sufficiency_determinations
          SET superseded_at = NOW()
        WHERE organization_id = $1 AND superseded_at IS NULL`,
      [seed.orgA.id]
    );

    const det = await determine(documentId, c.resolution_id, jwtA, {
      requirement_framework_key: frameworkKey,
      requirement_framework_version: frameworkVersion,
      requirement_reference: coveredRequirementRef,
      determination: "SUFFICIENT",
    });
    // The moment the whole chain exists for. Every veto evaluable, every veto
    // passed, no override anywhere in the path.
    expect(det.status, JSON.stringify(det.body)).toBe(200);
    expect(det.body.determined.determination).toBe("SUFFICIENT");
    expect(det.body.vetoes.every((v: { state: string }) => v.state === "PASSED")).toBe(true);
    determinationId = det.body.determined.id;

    const basisRow = await pool.query<{ basis: Record<string, unknown> }>(
      `SELECT basis FROM vendor_requirement_sufficiency_determinations
        WHERE organization_id=$1 AND determination='SUFFICIENT' AND superseded_at IS NULL`,
      [seed.orgA.id]
    );
    expect(basisRow.rowCount).toBe(1);
    const vetoes = basisRow.rows[0]!.basis["vetoes"] as { veto: string; state: string }[];
    expect(vetoes).toHaveLength(12);
    expect(vetoes.every((v) => v.state === "PASSED")).toBe(true);
  }, 120_000);

  it("the counting predicate counts it — and ONLY for this vendor's engagement", async () => {
    const engagement = await seedEngagement(seed.orgA.id, vendorA);
    await pool.query("SELECT set_config('app.current_org_id', $1, false)", [seed.orgA.id]);
    const cov = await resolveAssuranceCoverage({
      organizationId: seed.orgA.id, engagementId: engagement,
    });
    expect(cov.covered).toHaveLength(1);
    expect(cov.covered[0]!.requirementReference).toBe(coveredRequirementRef);
    expect(cov.covered[0]!.validUntil).toBe("2026-12-31");
    coveredRequirementId = cov.covered[0]!.requirementId;

    // A different vendor's engagement gets NOTHING from this document.
    const otherVendor = await seedVendor(pool, seed.orgA.id, { name: "Uncovered vendor" });
    const otherEng = await seedEngagement(seed.orgA.id, otherVendor);
    const covOther = await resolveAssuranceCoverage({
      organizationId: seed.orgA.id, engagementId: otherEng,
    });
    expect(covOther.covered).toHaveLength(0);
  }, 60_000);

  it("the reviewer can SEE the coverage and its gaps through the product", async () => {
    const engagement = await seedEngagement(seed.orgA.id, vendorA);
    const r = await request(app)
      .get(`/api/vendor-engagements/${engagement}/assurance-coverage`)
      .set("Authorization", `Bearer ${jwtA}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.covered).toHaveLength(1);
    expect(r.body.covered[0].requirement_reference).toBe(coveredRequirementRef);
    expect(r.body.covered[0].valid_until).toBe("2026-12-31");
    expect(r.body.coverage_version).toBe("assurance-coverage-1.0");
    // And cross-tenant: org B sees a 404, not an empty list.
    const cross = await request(app)
      .get(`/api/vendor-engagements/${engagement}/assurance-coverage`)
      .set("Authorization", `Bearer ${jwtB}`);
    expect(cross.status).toBe(404);
  }, 60_000);

  it("an EXPIRED window is a gap, not coverage — read-time fail-closed", async () => {
    const engagement = await seedEngagement(seed.orgA.id, vendorA);
    await pool.query("SELECT set_config('app.current_org_id', $1, false)", [seed.orgA.id]);
    // Same estate, evaluated as of a date past 2026-12-31.
    const cov = await resolveAssuranceCoverage({
      organizationId: seed.orgA.id, engagementId: engagement, asOf: "2027-06-01",
    });
    expect(cov.covered).toHaveLength(0);
    expect(cov.gaps.some((g) => g.reason === "validity_window_expired")).toBe(true);
  }, 60_000);

  it("scope resolution: flag OFF is byte-identical and logs the dual-read; flag ON reduces depth with the basis riding the item", async () => {
    // The requirement must be APPLICABLE before coverage means anything — the
    // S4 offset only ever touches items the applicability rules chose, which
    // is the "applicability cannot disappear because evidence exists" boundary
    // working. The beforeAll requirements carry no scope tags, so tag the
    // covered one as core baseline; coverage then REDUCES it, never adds it.
    await pool.query(
      `UPDATE requirements SET scope_tags = '{core}'
        WHERE id = $1`,
      [coveredRequirementId]
    );
    const engagement = await seedEngagement(seed.orgA.id, vendorA);

    // Flag OFF — the resolution must not know assurance exists.
    delete process.env["SECURELOGIC_EVIDENCE_LIFECYCLE_V2"];
    const off = await resolveScopeVia(engagement, jwtA);
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    const offItems = await pool.query<{ requirement_id: string; depth: string; reasons: unknown[] }>(
      `SELECT requirement_id, depth, reasons FROM vendor_engagement_scope_items
        WHERE engagement_id=$1 ORDER BY requirement_id`,
      [engagement]
    );
    const offRow = offItems.rows.find((r) => r.requirement_id === coveredRequirementId);
    expect(offRow, "the covered requirement must be IN SCOPE either way").toBeTruthy();
    expect((offRow!.reasons as { rule_id: string }[]).some((x) => x.rule_id === "S4.assurance")).toBe(false);

    // Flag ON — the SAME engagement re-resolves with the reduction applied.
    process.env["SECURELOGIC_EVIDENCE_LIFECYCLE_V2"] = "true";
    try {
      const on = await resolveScopeVia(engagement, jwtA);
      expect(on.status, JSON.stringify(on.body)).toBe(200);
      const onItems = await pool.query<{ requirement_id: string; depth: string; mandatory: boolean; reasons: unknown[] }>(
        `SELECT requirement_id, depth, mandatory, reasons FROM vendor_engagement_scope_items
          WHERE engagement_id=$1 ORDER BY requirement_id`,
        [engagement]
      );
      const onRow = onItems.rows.find((r) => r.requirement_id === coveredRequirementId);
      expect(onRow).toBeTruthy();
      // REDUCED, NOT REMOVED.
      expect(onRow!.depth).toBe("confirm");
      const s4 = (onRow!.reasons as { rule_id: string; basis?: Record<string, unknown> }[])
        .find((x) => x.rule_id === "S4.assurance");
      expect(s4, "the S4 reason must be recorded").toBeTruthy();
      // The decision-basis snapshot rides the scope item itself.
      expect(s4!.basis?.["determination_id"]).toBe(determinationId || s4!.basis?.["determination_id"]);
      expect(s4!.basis?.["valid_until"]).toBe("2026-12-31");
      expect(s4!.basis?.["coverage_version"]).toBe("assurance-coverage-1.0");

      // Every OTHER item is untouched: same requirement set, same depths.
      const offOthers = offItems.rows.filter((r) => r.requirement_id !== coveredRequirementId)
        .map((r) => ({ id: r.requirement_id, depth: r.depth }));
      const onOthers = onItems.rows.filter((r) => r.requirement_id !== coveredRequirementId)
        .map((r) => ({ id: r.requirement_id, depth: r.depth }));
      expect(onOthers).toEqual(offOthers);
    } finally {
      delete process.env["SECURELOGIC_EVIDENCE_LIFECYCLE_V2"];
    }
  }, 120_000);

  it("a live CONFLICTING INSUFFICIENT (different resolution) suppresses coverage at READ time", async () => {
    // The gap the staging active-phase acceptance found: SUFFICIENT recorded
    // first, INSUFFICIENT later from ANOTHER document/resolution — both live.
    // The write-time veto cannot catch that order; the predicate must.
    const { documentId: doc2, extractionId: ex2 } = await extractedDoc(seed.orgA.id, vendorA, "s5-conflict");
    expect((await approve(doc2, jwtA)).status).toBe(200);
    await request(app).post(`/api/vendor-assurance/documents/${doc2}/assurance-opinion`)
      .set("Authorization", `Bearer ${jwtA}`)
      .send({ opinion: "unmodified", reviewer_note: "conflict fixture" });
    const res2 = await awaitResolutions(ex2, 1);
    expect(res2.length).toBeGreaterThan(0);
    // The determine route matches (resolution, requirement) against the
    // document's own candidate list — take the pair from there, not by
    // assuming the first resolution carries the target reference.
    const cand2 = await candidates(doc2, jwtA);
    const c2 = (cand2.body.candidates ?? []).find(
      (x: { requirement_reference: string | null }) => x.requirement_reference === coveredRequirementRef
    );
    expect(c2, "the conflict document must produce the same requirement candidate").toBeTruthy();
    const det2 = await determine(doc2, c2.resolution_id, jwtA, {
      requirement_framework_key: frameworkKey,
      requirement_framework_version: frameworkVersion,
      requirement_reference: coveredRequirementRef,
      determination: "INSUFFICIENT",
    });
    expect(det2.status, JSON.stringify(det2.body)).toBe(200);

    const engagement = await seedEngagement(seed.orgA.id, vendorA);
    await pool.query("SELECT set_config('app.current_org_id', $1, false)", [seed.orgA.id]);
    const cov = await resolveAssuranceCoverage({
      organizationId: seed.orgA.id, engagementId: engagement,
    });
    expect(cov.covered).toHaveLength(0);
    expect(cov.gaps.some((g) => g.reason === "conflicting_governed_judgement")).toBe(true);

    // Clean up the conflict so the withdrawal test below exercises ITS path.
    await pool.query(
      `UPDATE vendor_requirement_sufficiency_determinations
          SET superseded_at = NOW()
        WHERE organization_id=$1 AND determination='INSUFFICIENT' AND superseded_at IS NULL`,
      [seed.orgA.id]
    );
  }, 120_000);

  it("a SUPERSEDING INSUFFICIENT withdraws the coverage — and the historical basis survives", async () => {
    // The reviewer changes their mind: supersede with INSUFFICIENT.
    const doc = await pool.query<{ document_id: string; resolution_id: string }>(
      `SELECT document_id, resolution_id FROM vendor_requirement_sufficiency_determinations
        WHERE organization_id=$1 AND determination='SUFFICIENT' AND superseded_at IS NULL LIMIT 1`,
      [seed.orgA.id]
    );
    const det = await determine(doc.rows[0]!.document_id, doc.rows[0]!.resolution_id, jwtA, {
      requirement_framework_key: frameworkKey,
      requirement_framework_version: frameworkVersion,
      requirement_reference: coveredRequirementRef,
      determination: "INSUFFICIENT",
      supersede: true,
    });
    expect(det.status, JSON.stringify(det.body)).toBe(200);

    const engagement = await seedEngagement(seed.orgA.id, vendorA);
    await pool.query("SELECT set_config('app.current_org_id', $1, false)", [seed.orgA.id]);
    const cov = await resolveAssuranceCoverage({
      organizationId: seed.orgA.id, engagementId: engagement,
    });
    expect(cov.covered).toHaveLength(0);

    // Historical reproducibility: the superseded SUFFICIENT row still exists,
    // its basis intact, its twelve vetoes readable.
    const hist = await pool.query<{ basis: Record<string, unknown>; superseded_at: string | null }>(
      `SELECT basis, superseded_at FROM vendor_requirement_sufficiency_determinations
        WHERE organization_id=$1 AND determination='SUFFICIENT'`,
      [seed.orgA.id]
    );
    expect(hist.rowCount).toBe(1);
    expect(hist.rows[0]!.superseded_at).not.toBeNull();
    expect((hist.rows[0]!.basis["vetoes"] as unknown[]).length).toBe(12);
  }, 120_000);
});
