/**
 * readinessVsAssessmentProgress.test.ts — O-5 ruling E2E (2026-07-16).
 *
 * Readiness Score means "how much of this framework is actually implemented
 * and satisfied" — satisfied control mappings ONLY. Assessment responses are
 * PROGRESS ("how much have we assessed?") and must never move readiness.
 *
 * Drives the REAL app (createApp) over real Postgres and proves:
 *   1. answering the questionnaire (pass/partial/fail responses over HTTP)
 *      leaves readiness_score at 0 while assessment progress rises;
 *   2. a framework with responses but no satisfied controls reads
 *      readiness = 0, progress > 0;
 *   3. a satisfied control mapping DOES raise readiness_score — and leaves
 *      progress untouched;
 *   4. the old blended `readiness_score` field is gone from both
 *      response-based endpoints (framework detail, requirements summary) —
 *      no surface can still consume it;
 *   5. framework detail, requirements summary, readiness, and the audit
 *      package (report surface) reconcile;
 *   6. empty framework renders honest zeros;
 *   7. tenant isolation: org B cannot read or write org A's framework, and
 *      org A's metrics are unmoved by org B's attempts.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;

let frameworkId: string;
const requirementIds: string[] = [];

const get = (path: string, key: string) => request(app).get(path).set("X-Api-Key", key);

async function seedFramework(orgId: string, name: string, requirementCount: number) {
  const f = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version) VALUES ($1, $2, '1.0') RETURNING id`,
    [orgId, name]
  );
  const fid = f.rows[0].id;
  const reqIds: string[] = [];
  for (let i = 1; i <= requirementCount; i++) {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO requirements (framework_id, reference_id, title) VALUES ($1, $2, $3) RETURNING id`,
      [fid, `REQ-${i}`, `Requirement ${i}`]
    );
    reqIds.push(r.rows[0].id);
  }
  return { fid, reqIds };
}

async function postResponse(
  apiKey: string,
  requirementId: string,
  subjectId: string,
  status: string
) {
  return request(app)
    .post("/api/requirement-responses")
    .set("X-Api-Key", apiKey)
    .send({
      requirement_id: requirementId,
      assessment_type: "self",
      subject_id: subjectId,
      status,
    });
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the O-5 readiness/progress test.");
  pool = new Pool({ connectionString: url, ssl: false });

  // createApp imported only now — infra/postgres.ts needs DATABASE_URL at import.
  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });

  const seeded = await seedFramework(seed.orgA.id, "O-5 Test Framework", 4);
  frameworkId = seeded.fid;
  requirementIds.push(...seeded.reqIds);
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("O-5: assessment responses never move Readiness Score", () => {
  it("answering the questionnaire raises progress but leaves readiness at 0", async () => {
    // Answer 3 of 4 requirements over the real write path — including a pass.
    expect((await postResponse(seed.orgA.apiKey, requirementIds[0], seed.orgA.id, "pass")).status).toBe(200);
    expect((await postResponse(seed.orgA.apiKey, requirementIds[1], seed.orgA.id, "partial")).status).toBe(200);
    expect((await postResponse(seed.orgA.apiKey, requirementIds[2], seed.orgA.id, "fail")).status).toBe(200);

    // Readiness: no control mappings exist → 0, all 4 unmapped.
    const readiness = await get(`/api/frameworks/${frameworkId}/readiness`, seed.orgA.apiKey);
    expect(readiness.status).toBe(200);
    expect(readiness.body.readiness_score).toBe(0);
    expect(readiness.body.satisfied).toBe(0);
    expect(readiness.body.unmapped).toBe(4);

    // Progress: 3 of 4 assessed = 75. Under the old blended formula this
    // combination would have shown (1 + 0.5)/4 = 37.5% as "readiness".
    const detail = await get(`/api/frameworks/${frameworkId}`, seed.orgA.apiKey);
    expect(detail.status).toBe(200);
    expect(detail.body.assessment_progress.self).toEqual({
      total: 4,
      pass: 1,
      partial: 1,
      fail: 1,
      not_assessed: 1,
      progress_pct: 75,
    });
  });

  it("the blended readiness_score field is GONE from both response-based endpoints", async () => {
    const detail = await get(`/api/frameworks/${frameworkId}`, seed.orgA.apiKey);
    expect(detail.body.assessment_readiness).toBeUndefined();
    expect(JSON.stringify(detail.body)).not.toContain("readiness_score");

    const reqs = await get(
      `/api/frameworks/${frameworkId}/requirements?assessment_type=self`,
      seed.orgA.apiKey
    );
    expect(reqs.status).toBe(200);
    expect(reqs.body.summary.progress_pct).toBe(75);
    expect(reqs.body.summary.readiness_score).toBeUndefined();
  });

  it("a satisfied control mapping DOES raise readiness — and leaves progress untouched", async () => {
    const control = await pool.query<{ id: string }>(
      `INSERT INTO controls (organization_id, name) VALUES ($1, 'O-5 encryption control') RETURNING id`,
      [seed.orgA.id]
    );
    const controlId = control.rows[0].id;
    await pool.query(
      `INSERT INTO control_assessments (organization_id, control_id, status) VALUES ($1, $2, 'passed')`,
      [seed.orgA.id, controlId]
    );
    await pool.query(
      `INSERT INTO control_mappings (control_id, requirement_id) VALUES ($1, $2)`,
      [controlId, requirementIds[3]]
    );

    // Readiness: 1 of 4 requirements satisfied → 25.
    const readiness = await get(`/api/frameworks/${frameworkId}/readiness`, seed.orgA.apiKey);
    expect(readiness.body.readiness_score).toBe(25);
    expect(readiness.body.satisfied).toBe(1);

    // Progress unmoved: mapping a control answers no questionnaire item.
    const detail = await get(`/api/frameworks/${frameworkId}`, seed.orgA.apiKey);
    expect(detail.body.assessment_progress.self.progress_pct).toBe(75);
  });

  it("readiness, requirements summary, and the audit package report reconcile", async () => {
    const readiness = await get(`/api/frameworks/${frameworkId}/readiness`, seed.orgA.apiKey);
    const auditPkg = await get(`/api/frameworks/${frameworkId}/audit-package`, seed.orgA.apiKey);
    expect(auditPkg.status).toBe(200);
    expect(auditPkg.body.readiness_summary.readiness_score).toBe(readiness.body.readiness_score);
    expect(auditPkg.body.readiness_summary.satisfied).toBe(readiness.body.satisfied);

    const reqs = await get(
      `/api/frameworks/${frameworkId}/requirements?assessment_type=self`,
      seed.orgA.apiKey
    );
    const detail = await get(`/api/frameworks/${frameworkId}`, seed.orgA.apiKey);
    const s = reqs.body.summary;
    const p = detail.body.assessment_progress.self;
    expect({ total: s.total, pass: s.pass, partial: s.partial, fail: s.fail, progress: s.progress_pct })
      .toEqual({ total: p.total, pass: p.pass, partial: p.partial, fail: p.fail, progress: p.progress_pct });
  });

  it("an empty framework renders honest zeros on both metrics", async () => {
    const { fid } = await seedFramework(seed.orgA.id, "O-5 Empty Framework", 0);

    const readiness = await get(`/api/frameworks/${fid}/readiness`, seed.orgA.apiKey);
    expect(readiness.body.readiness_score).toBe(0);
    expect(readiness.body.total_requirements).toBe(0);

    const detail = await get(`/api/frameworks/${fid}`, seed.orgA.apiKey);
    expect(detail.body.assessment_progress.self).toEqual({
      total: 0, pass: 0, partial: 0, fail: 0, not_assessed: 0, progress_pct: 0,
    });
  });

  it("tenant isolation: org B can neither read nor move org A's metrics", async () => {
    // Reads are 404 — no existence leak either.
    expect((await get(`/api/frameworks/${frameworkId}`, seed.orgB.apiKey)).status).toBe(404);
    expect((await get(`/api/frameworks/${frameworkId}/readiness`, seed.orgB.apiKey)).status).toBe(404);

    // Writes against org A's requirement are rejected.
    const attack = await postResponse(seed.orgB.apiKey, requirementIds[3], seed.orgB.id, "pass");
    expect(attack.status).toBe(404);

    // Org A's numbers are exactly where the previous tests left them.
    const readiness = await get(`/api/frameworks/${frameworkId}/readiness`, seed.orgA.apiKey);
    expect(readiness.body.readiness_score).toBe(25);
    const detail = await get(`/api/frameworks/${frameworkId}`, seed.orgA.apiKey);
    expect(detail.body.assessment_progress.self.progress_pct).toBe(75);
  });
});
