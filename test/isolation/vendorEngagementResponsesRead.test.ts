/**
 * vendorEngagementResponsesRead.test.ts — VA-R1 (authorized 2026-08-23):
 * the reviewer's per-question read surface, proven behaviorally against real
 * Postgres with RLS live.
 *
 * What must be true:
 *   - the reviewer sees the vendor's ANSWERS (status, notes), not just counts,
 *   - the append-only revision ledger is finally readable — every save shows,
 *   - pre-issue (scoped, unissued) the same surface is the "what will be
 *     sent" preview: every response is null (owner ruling on derived scoping),
 *   - none of it can cross a tenant boundary,
 *   - and — the same-org case — engagement 1's read never leaks engagement
 *     2's answers or revisions, even for the same requirement and vendor.
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

let reqShared: string; // REV-1: scoped into BOTH same-org engagements
let engOne: string; // answered + revised
let engTwo: string; // same org, same vendor requirement, different engagement
let engPreIssue: string; // scoped, never issued — the preview case
let engOrgB: string; // org B's own engagement over the same requirement row

async function seedEngagement(
  orgId: string,
  label: string,
  requirementIds: string[],
  vendorId?: string
): Promise<string> {
  const vendor = vendorId ?? (await seedVendor(pool, orgId, { name: `${label} vendor` }));
  const eng = await pool.query<{ id: string }>(
    `INSERT INTO vendor_engagements
       (organization_id, vendor_id, engagement_type, status,
        methodology_version, scope_rule_version, inherent_rating)
     VALUES ($1, $2, 'initial', 'in_progress', '1.0.0', '1.0.0', 'Moderate')
     RETURNING id`,
    [orgId, vendor]
  );
  const engagementId = eng.rows[0]!.id;
  for (const rid of requirementIds) {
    await pool.query(
      `INSERT INTO vendor_engagement_scope_items
         (organization_id, engagement_id, requirement_id, mandatory, source)
       VALUES ($1, $2, $3, TRUE, 'deterministic')`,
      [orgId, engagementId, rid]
    );
  }
  return engagementId;
}

/** Mimic the portal save exactly: upsert + append a revision row. */
async function vendorAnswer(
  orgId: string,
  engagementId: string,
  requirementId: string,
  status: string,
  notes: string
): Promise<void> {
  const vendor = await pool.query<{ vendor_id: string }>(
    `SELECT vendor_id FROM vendor_engagements WHERE id = $1 AND organization_id = $2`,
    [engagementId, orgId]
  );
  const saved = await pool.query<{ id: string }>(
    `INSERT INTO requirement_responses
       (organization_id, requirement_id, assessment_type, subject_id, engagement_id,
        responder_type, status, notes, assessed_at)
     VALUES ($1, $2, 'vendor', $3, $4, 'vendor', $5, $6, NOW())
     ON CONFLICT (organization_id, requirement_id, assessment_type, subject_id,
                  COALESCE(engagement_id, '00000000-0000-0000-0000-000000000000'::uuid))
     DO UPDATE SET status = EXCLUDED.status, notes = EXCLUDED.notes,
                   assessed_at = NOW(), updated_at = NOW()
     RETURNING id`,
    [orgId, requirementId, vendor.rows[0]!.vendor_id, engagementId, status, notes]
  );
  await pool.query(
    `INSERT INTO requirement_response_revisions
       (organization_id, response_id, status, notes, responder_type)
     VALUES ($1, $2, $3, $4, 'vendor')`,
    [orgId, saved.rows[0]!.id, status, notes]
  );
}

const getResponses = (key: string, id: string) =>
  request(app).get(`/api/vendor-engagements/${id}/responses`).set("X-Api-Key", key);

beforeAll(async () => {
  seed = await bootstrapTestDb();
  pool = new Pool({ connectionString: process.env["TEST_DATABASE_URL"], ssl: false });

  const framework = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version)
     VALUES ($1, 'Responses Harness Framework', '1.0') RETURNING id`,
    [seed.orgA.id]
  );
  const r = await pool.query<{ id: string }>(
    `INSERT INTO requirements (framework_id, reference_id, title, description)
     VALUES ($1, 'REV-1', 'REV-1 control', 'Show the reviewer this guidance') RETURNING id`,
    [framework.rows[0]!.id]
  );
  reqShared = r.rows[0]!.id;

  const sharedVendor = await seedVendor(pool, seed.orgA.id, { name: "Responses vendor" });
  engOne = await seedEngagement(seed.orgA.id, "Responses one", [reqShared], sharedVendor);
  engTwo = await seedEngagement(seed.orgA.id, "Responses two", [reqShared], sharedVendor);
  engPreIssue = await seedEngagement(seed.orgA.id, "Responses preview", [reqShared]);
  await pool.query(`UPDATE vendor_engagements SET status = 'scoped' WHERE id = $1`, [engPreIssue]);
  engOrgB = await seedEngagement(seed.orgB.id, "Responses org B", [reqShared]);

  // Engagement 1: two saves (a revision trail). Engagement 2: one distinct
  // answer for the SAME requirement — the same-org leak bait.
  await vendorAnswer(seed.orgA.id, engOne, reqShared, "partial", "first draft answer");
  await vendorAnswer(seed.orgA.id, engOne, reqShared, "pass", "final answer with detail");
  await vendorAnswer(seed.orgA.id, engTwo, reqShared, "fail", "ENGAGEMENT-TWO-SECRET");
  await vendorAnswer(seed.orgB.id, engOrgB, reqShared, "fail", "ORG-B-SECRET");

  app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
  process.env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"] = "true";
}, 180_000);

afterAll(async () => {
  delete process.env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"];
  await pool?.end();
});

describe("VA-R1 — the reviewer can finally read the questionnaire", () => {
  it("returns the answer, the notes, and the full revision trail", async () => {
    const res = await getResponses(seed.orgA.apiKey, engOne);
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ scoped: 1, answered: 1, mandatory: 1 });

    const item = res.body.items[0];
    expect(item.requirement.reference).toBe("REV-1");
    expect(item.requirement.description).toBe("Show the reviewer this guidance");
    expect(item.response).toMatchObject({
      status: "pass",
      notes: "final answer with detail",
      responder_type: "vendor",
    });
    // The append-only ledger is readable: both saves, oldest first.
    expect(item.revisions.total).toBe(2);
    expect(item.revisions.truncated).toBe(false);
    expect(item.revisions.entries.map((e: { status: string }) => e.status)).toEqual([
      "partial",
      "pass",
    ]);
    expect(item.revisions.entries[0].notes).toBe("first draft answer");
  });

  it("pre-issue, the same surface is the what-will-be-sent preview: response is null", async () => {
    const res = await getResponses(seed.orgA.apiKey, engPreIssue);
    expect(res.status).toBe(200);
    expect(res.body.engagement_status).toBe("scoped");
    expect(res.body.counts).toMatchObject({ scoped: 1, answered: 0 });
    expect(res.body.items[0].response).toBeNull();
    expect(res.body.items[0].revisions.total).toBe(0);
    // The question itself IS visible before anything is sent.
    expect(res.body.items[0].requirement.title).toBe("REV-1 control");
  });

  it("same-org, same vendor, same requirement: engagement 1's read never shows engagement 2's answer or revisions", async () => {
    const res = await getResponses(seed.orgA.apiKey, engOne);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("ENGAGEMENT-TWO-SECRET");
    // And the reverse read shows only its own single-save trail.
    const two = await getResponses(seed.orgA.apiKey, engTwo);
    expect(two.body.items[0].response.status).toBe("fail");
    expect(two.body.items[0].revisions.total).toBe(1);
    expect(JSON.stringify(two.body)).not.toContain("final answer with detail");
  });

  it("cross-tenant: org B cannot read org A's engagement, and its own read carries no org A content", async () => {
    const forbidden = await getResponses(seed.orgB.apiKey, engOne);
    expect(forbidden.status).toBe(404);

    const own = await getResponses(seed.orgB.apiKey, engOrgB);
    expect(own.status).toBe(200);
    const body = JSON.stringify(own.body);
    expect(body).toContain("ORG-B-SECRET");
    expect(body).not.toContain("final answer with detail");
    expect(body).not.toContain("ENGAGEMENT-TWO-SECRET");
  });

  it("unknown engagement id is 404, indistinguishable from cross-org", async () => {
    const res = await getResponses(
      seed.orgA.apiKey,
      "00000000-0000-4000-8000-000000000000"
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("engagement_not_found");
  });
});
