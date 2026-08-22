/**
 * vendorEngagementSupersedeOnPass.test.ts — the supersede-on-pass ruling
 * (2026-08-22), proven behaviorally against real Postgres with RLS live.
 *
 * A PASS SUPERSEDES NOTHING AUTOMATICALLY — fourth appearance of
 * machines-observe-humans-decide. This suite proves the machine's actual
 * obligations, not just the absence of auto-closure:
 *   - re-promotion after a control flips to pass leaves the finding OPEN and
 *     UNTOUCHED (severity, description),
 *   - and NAMES it, distinctly labeled per current response
 *     (pass vs not_applicable), in the promotion response,
 *   - GET /vendor-engagements/:id derives the same facts fresh at read,
 *   - none of it can cross a tenant boundary.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

let engagementA: string;
let engagementB: string;
let reqPass: string; // SUP-1: fails first, then passes
let reqNa: string; // SUP-2: fails first, then not_applicable

async function seedEngagement(
  orgId: string,
  label: string,
  requirements: Array<{ id: string }>
): Promise<string> {
  const vendor = await seedVendor(pool, orgId, { name: `${label} vendor` });
  const eng = await pool.query<{ id: string }>(
    `INSERT INTO vendor_engagements
       (organization_id, vendor_id, engagement_type, status,
        methodology_version, scope_rule_version, inherent_rating)
     VALUES ($1, $2, 'initial', 'draft', '1.0.0', '1.0.0', 'Moderate')
     RETURNING id`,
    [orgId, vendor]
  );
  const engagementId = eng.rows[0]!.id;
  for (const r of requirements) {
    await pool.query(
      `INSERT INTO vendor_engagement_scope_items
         (organization_id, engagement_id, requirement_id, mandatory, source)
       VALUES ($1, $2, $3, TRUE, 'deterministic')`,
      [orgId, engagementId, r.id]
    );
    await pool.query(
      `INSERT INTO requirement_responses
         (organization_id, requirement_id, assessment_type, subject_id,
          engagement_id, status)
       VALUES ($1, $2, 'vendor', $3, $4, 'fail')`,
      [orgId, r.id, engagementId, engagementId]
    );
  }
  return engagementId;
}

async function setResponse(
  orgId: string,
  engagementId: string,
  requirementId: string,
  status: string
): Promise<void> {
  await pool.query(
    `UPDATE requirement_responses
        SET status = $4, assessed_at = NOW(), updated_at = NOW()
      WHERE organization_id = $1 AND engagement_id = $2 AND requirement_id = $3`,
    [orgId, engagementId, requirementId, status]
  );
}

const promote = (key: string, id: string) =>
  request(app)
    .post(`/api/vendor-engagements/${id}/promote-findings`)
    .set("X-Api-Key", key);
const getEng = (key: string, id: string) =>
  request(app).get(`/api/vendor-engagements/${id}`).set("X-Api-Key", key);

beforeAll(async () => {
  seed = await bootstrapTestDb();
  pool = new Pool({ connectionString: process.env["TEST_DATABASE_URL"], ssl: false });

  const framework = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version)
     VALUES ($1, 'Supersede Harness Framework', '1.0') RETURNING id`,
    [seed.orgA.id]
  );
  const mkReq = async (ref: string): Promise<string> => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO requirements (framework_id, reference_id, title)
       VALUES ($1, $2, $3) RETURNING id`,
      [framework.rows[0]!.id, ref, `${ref} control`]
    );
    return r.rows[0]!.id;
  };
  reqPass = await mkReq("SUP-1");
  reqNa = await mkReq("SUP-2");

  engagementA = await seedEngagement(seed.orgA.id, "Supersede A", [
    { id: reqPass },
    { id: reqNa },
  ]);
  // Org B: its own engagement over the SAME requirement rows (requirements
  // are framework reference data) — the cross-tenant probe.
  engagementB = await seedEngagement(seed.orgB.id, "Supersede B", [{ id: reqPass }]);

  app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
  process.env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"] = "true";
}, 180_000);

afterAll(async () => {
  delete process.env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"];
  await pool?.end();
});

describe("supersede-on-pass: machines observe, humans decide", () => {
  let findingPass: string;
  let severityBefore: string | null;
  let descriptionBefore: string;

  it("first promotion: two failing controls become two findings, nothing superseded", async () => {
    const res = await promote(seed.orgA.apiKey, engagementA);
    expect(res.status).toBe(200);
    expect(res.body.promoted).toBe(2);
    expect(res.body.superseded_by_source).toEqual([]);

    const f = await pool.query<{ id: string; severity: string | null; description: string }>(
      `SELECT id, severity, description FROM findings
        WHERE organization_id = $1 AND source_type = 'vendor_engagement'
          AND source_id = $2 AND requirement_id = $3`,
      [seed.orgA.id, engagementA, reqPass]
    );
    expect(f.rowCount).toBe(1);
    findingPass = f.rows[0]!.id;
    severityBefore = f.rows[0]!.severity;
    descriptionBefore = f.rows[0]!.description;
  });

  it("after the control flips to pass, re-promotion NAMES the finding and closes nothing", async () => {
    await setResponse(seed.orgA.id, engagementA, reqPass, "pass");

    const res = await promote(seed.orgA.apiKey, engagementA);
    expect(res.status).toBe(200);
    // Only SUP-2 still promotes; SUP-1's finding is named, not hidden.
    expect(res.body.promoted).toBe(1);
    expect(res.body.superseded_by_source).toHaveLength(1);
    expect(res.body.superseded_by_source[0]).toMatchObject({
      finding_id: findingPass,
      reference: "SUP-1",
      requirement_id: reqPass,
      current_response: "pass",
    });
    expect(res.body.superseded_by_source[0].as_of).toBeTruthy();

    // The finding is OPEN and UNTOUCHED — no auto-close, no silent rewrite.
    const f = await pool.query<{
      operational_status: string;
      severity: string | null;
      description: string;
    }>(`SELECT operational_status, severity, description FROM findings WHERE id = $1`, [
      findingPass,
    ]);
    expect(f.rows[0]!.operational_status).not.toBe("closed");
    expect(f.rows[0]!.severity).toBe(severityBefore);
    expect(f.rows[0]!.description).toBe(descriptionBefore);
  });

  it("not_applicable supersedes too, labeled distinctly — a different human judgment", async () => {
    await setResponse(seed.orgA.id, engagementA, reqNa, "not_applicable");

    const res = await promote(seed.orgA.apiKey, engagementA);
    expect(res.status).toBe(200);
    expect(res.body.promoted).toBe(0);
    const byRef = Object.fromEntries(
      (res.body.superseded_by_source as Array<{ reference: string; current_response: string }>).map(
        (s) => [s.reference, s.current_response]
      )
    );
    expect(byRef).toEqual({ "SUP-1": "pass", "SUP-2": "not_applicable" });
  });

  it("GET /vendor-engagements/:id derives the same facts fresh at read", async () => {
    const res = await getEng(seed.orgA.apiKey, engagementA);
    expect(res.status).toBe(200);
    expect(res.body.findings.total).toBe(2);
    expect(res.body.findings.open).toBe(2);
    expect(res.body.findings.superseded_by_source).toHaveLength(2);
  });

  it("a human closing through the ordinary gate empties the derived list — no stored marker to go stale", async () => {
    // Owner-side closure stand-in for the human gate: the derived list must
    // track the finding's real state with zero bookkeeping. Both axes move
    // together — findings_closure_axes_agree (20260906) enforces it.
    await pool.query(
      `UPDATE findings SET operational_status = 'closed', status = 'closed' WHERE id = $1`,
      [findingPass]
    );
    const res = await getEng(seed.orgA.apiKey, engagementA);
    expect(res.body.findings.open).toBe(1);
    const refs = (res.body.findings.superseded_by_source as Array<{ reference: string }>).map(
      (s) => s.reference
    );
    expect(refs).toEqual(["SUP-2"]);
  });

  it("cross-tenant: org B sees only its own engagement, and org A's findings never appear", async () => {
    const forbidden = await getEng(seed.orgB.apiKey, engagementA);
    expect(forbidden.status).toBe(404);

    await setResponse(seed.orgB.id, engagementB, reqPass, "pass");
    const res = await getEng(seed.orgB.apiKey, engagementB);
    expect(res.status).toBe(200);
    // Org B never promoted, so the same requirement flipping to pass in ITS
    // engagement derives nothing — and org A's finding ids cannot leak in.
    expect(res.body.findings.total).toBe(0);
    expect(res.body.findings.superseded_by_source).toEqual([]);
  });
});
