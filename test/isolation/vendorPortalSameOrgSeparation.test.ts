/**
 * vendorPortalSameOrgSeparation.test.ts — VA-S1a.
 *
 * The gap this closes: every existing portal isolation proof is org A versus
 * org B, and org A versus org B is the case the platform's two strongest
 * mechanisms already handle — the org predicate on every query and RLS behind
 * it. The case NEITHER mechanism helps with is TWO VENDORS INSIDE ONE
 * ORGANIZATION. Alpha and Beta are both org A's suppliers, both hold a portal
 * credential, and both have a live engagement. `organization_id` is identical
 * on every row; the only thing standing between Alpha and Beta's answers,
 * evidence, and conversation is the engagement scoping each handler applies by
 * hand.
 *
 * That is exactly the property the ID-manipulation requirement names:
 * organization_id, vendor_id, engagement_id, requirement_id, response_id,
 * evidence id and invite token must all be un-forgeable into another vendor's
 * data. Here they are all tried, from a real session, over HTTP.
 *
 * Beta's rows carry unmistakable markers (BETA-SECRET-*). Any leak shows up as
 * that string in a response body, not as a subtle field mismatch.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import cookieParser from "cookie-parser";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import {
  generatePortalToken,
  hashPortalToken,
  PORTAL_SESSION_COOKIE,
} from "../../src/api/lib/vendorPortal/portalTokens.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

type Party = {
  vendorId: string;
  engagementId: string;
  requirementId: string;
  token: string;
  inviteId: string;
};

let alpha: Party;
let beta: Party;
let betaEvidenceId: string;

/** Both parties live in org A. That is the whole point of the file. */
async function seedParty(label: string): Promise<Party> {
  const orgId = seed.orgA.id;
  const vendorId = await seedVendor(pool, orgId, { name: `${label} vendor` });
  const eng = await pool.query<{ id: string }>(
    `INSERT INTO vendor_engagements
       (organization_id, vendor_id, engagement_type, status,
        methodology_version, scope_rule_version, title)
     VALUES ($1, $2, 'initial', 'issued', '1.0.0', '1.0.0', $3)
     RETURNING id`,
    [orgId, vendorId, `${label} engagement`]
  );
  const engagementId = eng.rows[0]!.id;

  const token = generatePortalToken();
  const invite = await pool.query<{ id: string }>(
    `INSERT INTO vendor_engagement_invites
       (organization_id, engagement_id, invite_token_hash, contact_email, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      orgId,
      engagementId,
      hashPortalToken(token),
      `${label.toLowerCase()}@vendor.example`,
      new Date(Date.now() + 30 * 24 * 3600_000),
    ]
  );

  const fw = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version) VALUES ($1, $2, '1.0') RETURNING id`,
    [orgId, `${label} framework`]
  );
  const req = await pool.query<{ id: string }>(
    `INSERT INTO requirements (framework_id, reference_id, title)
     VALUES ($1, $2, $3) RETURNING id`,
    [fw.rows[0]!.id, `${label}-REQ`, `${label} requirement`]
  );
  const requirementId = req.rows[0]!.id;
  await pool.query(
    `INSERT INTO vendor_engagement_scope_items
       (organization_id, engagement_id, requirement_id, depth, mandatory, source)
     VALUES ($1, $2, $3, 'full', TRUE, 'deterministic')`,
    [orgId, engagementId, requirementId]
  );

  return { vendorId, engagementId, requirementId, token, inviteId: invite.rows[0]!.id };
}

async function sessionCookie(token: string): Promise<string> {
  const res = await request(app).post("/api/vendor-portal/session").send({ token });
  expect(res.status, `exchange failed: ${JSON.stringify(res.body)}`).toBe(200);
  const raw = res.headers["set-cookie"] as unknown as string[];
  const cookie = raw.find((c) => c.startsWith(PORTAL_SESSION_COOKIE));
  expect(cookie, "no portal cookie was set").toBeTruthy();
  return cookie!.split(";")[0]!;
}

let alphaCookie: string;
let betaCookie: string;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env.DATABASE_URL = url;
  process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "true";
  process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED = "true";
  pool = new Pool({ connectionString: url, ssl: false });

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));

  alpha = await seedParty("ALPHA");
  beta = await seedParty("BETA");

  alphaCookie = await sessionCookie(alpha.token);
  betaCookie = await sessionCookie(beta.token);

  // Beta does real work: an answer, an attachment and a message. Every one of
  // them is something Alpha must never see.
  const answered = await request(app)
    .put(`/api/vendor-portal/questions/${beta.requirementId}`)
    .set("Cookie", betaCookie)
    .send({ answer: "fail", notes: "BETA-SECRET-ANSWER" });
  expect(answered.status).toBe(200);

  const commented = await request(app)
    .post("/api/vendor-portal/comments")
    .set("Cookie", betaCookie)
    .send({ body: "BETA-SECRET-COMMENT about our control gap." });
  expect(commented.status).toBe(201);

  // Evidence is inserted directly: the upload path has its own adversarial
  // suite, and what is under test here is who can READ and DELETE the row.
  const ev = await pool.query<{ id: string }>(
    `INSERT INTO evidence
       (organization_id, source_type, source_id, title, evidence_type,
        engagement_id, uploaded_via_invite_id, original_filename,
        storage_key, mime_type, byte_size, sha256)
     VALUES ($1, 'vendor_engagement', $2, 'BETA-SECRET-EVIDENCE.pdf', 'document',
             $2, $3, 'BETA-SECRET-EVIDENCE.pdf', $4, 'application/pdf', 1024, $5)
     RETURNING id`,
    [
      seed.orgA.id,
      beta.engagementId,
      beta.inviteId,
      `org/${seed.orgA.id}/beta-secret.pdf`,
      "b".repeat(64),
    ]
  );
  betaEvidenceId = ev.rows[0]!.id;
}, 180_000);

afterAll(async () => {
  delete process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED;
  delete process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED;
  await pool?.end();
});

beforeEach(() => {
  process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "true";
  process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED = "true";
});

describe("VA-S1a — two vendors, ONE organization: reads", () => {
  it("Alpha's engagement view is Alpha's, and never names Beta", async () => {
    const res = await request(app)
      .get("/api/vendor-portal/engagement")
      .set("Cookie", alphaCookie);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("BETA");
    expect(body).not.toContain(beta.engagementId);
    expect(body).not.toContain(beta.vendorId);
  });

  it("and Beta's view IS Beta's — the previous assertion is not vacuous", async () => {
    const res = await request(app)
      .get("/api/vendor-portal/engagement")
      .set("Cookie", betaCookie);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain("BETA");
  });

  it("Alpha's questionnaire contains only Alpha's questions and none of Beta's answers", async () => {
    const res = await request(app).get("/api/vendor-portal/questions").set("Cookie", alphaCookie);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).toContain("ALPHA-REQ");
    expect(body).not.toContain("BETA-REQ");
    expect(body).not.toContain("BETA-SECRET-ANSWER");
  });

  it("Alpha's attachment list never contains Beta's evidence", async () => {
    const res = await request(app).get("/api/vendor-portal/evidence").set("Cookie", alphaCookie);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("BETA-SECRET-EVIDENCE");
    expect(JSON.stringify(res.body)).not.toContain(betaEvidenceId);
  });

  it("Alpha's conversation never contains Beta's message", async () => {
    const res = await request(app).get("/api/vendor-portal/comments").set("Cookie", alphaCookie);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("BETA-SECRET-COMMENT");
  });
});

describe("VA-S1a — two vendors, ONE organization: id manipulation", () => {
  it("answering BETA's requirement by id is refused, and writes nothing", async () => {
    const res = await request(app)
      .put(`/api/vendor-portal/questions/${beta.requirementId}`)
      .set("Cookie", alphaCookie)
      .send({ answer: "pass", notes: "ALPHA-TRIED-TO-ANSWER-BETA" });
    // Indistinguishable from a requirement that does not exist: not-in-scope
    // must not confirm that another vendor was asked this question.
    expect(res.status).toBe(404);

    const rows = await pool.query(
      `SELECT 1 FROM requirement_responses
        WHERE engagement_id = $1 AND notes = 'ALPHA-TRIED-TO-ANSWER-BETA'`,
      [beta.engagementId]
    );
    expect(rows.rowCount).toBe(0);
  });

  it("naming Beta's org/vendor/engagement in the BODY changes nothing — the row lands on Alpha", async () => {
    const res = await request(app)
      .put(`/api/vendor-portal/questions/${alpha.requirementId}`)
      .set("Cookie", alphaCookie)
      .send({
        answer: "pass",
        notes: "ALPHA-OWN-ANSWER",
        organization_id: seed.orgB.id,
        vendor_id: beta.vendorId,
        engagement_id: beta.engagementId,
        requirement_id: beta.requirementId,
        invite_id: beta.inviteId,
      });
    expect(res.status).toBe(200);

    const landed = await pool.query<{ engagement_id: string; subject_id: string }>(
      `SELECT engagement_id, subject_id FROM requirement_responses
        WHERE notes = 'ALPHA-OWN-ANSWER'`,
      []
    );
    expect(landed.rowCount).toBe(1);
    expect(landed.rows[0]!.engagement_id).toBe(alpha.engagementId);
    // subject_id is the ENGAGEMENT'S vendor, resolved server-side — a body
    // field cannot redirect an answer onto another supplier's record.
    expect(landed.rows[0]!.subject_id).toBe(alpha.vendorId);
  });

  it("deleting Beta's evidence by id is refused, and Beta's row survives", async () => {
    const res = await request(app)
      .delete(`/api/vendor-portal/evidence/${betaEvidenceId}`)
      .set("Cookie", alphaCookie);
    expect(res.status).toBe(404);

    const still = await pool.query(`SELECT 1 FROM evidence WHERE id = $1`, [betaEvidenceId]);
    expect(still.rowCount).toBe(1);
  });

  it("commenting against BETA's requirement is refused, and lands nothing on Beta's thread", async () => {
    const res = await request(app)
      .post("/api/vendor-portal/comments")
      .set("Cookie", alphaCookie)
      .send({ body: "ALPHA-TRIED-TO-COMMENT-ON-BETA", requirement_id: beta.requirementId });
    expect(res.status).toBe(404);

    const rows = await pool.query(
      `SELECT 1 FROM vendor_engagement_comments
        WHERE engagement_id = $1 AND body = 'ALPHA-TRIED-TO-COMMENT-ON-BETA'`,
      [beta.engagementId]
    );
    expect(rows.rowCount).toBe(0);
  });

  it("Beta's INVITE TOKEN in Alpha's hands buys Beta's session, not a merged one", async () => {
    // Holding another supplier's link is holding their credential — there is no
    // way to combine two engagements into one view, which is the property the
    // future multi-participant model has to preserve.
    const stolen = await sessionCookie(beta.token);
    const res = await request(app).get("/api/vendor-portal/engagement").set("Cookie", stolen);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain("BETA");
    expect(JSON.stringify(res.body)).not.toContain("ALPHA");
  });

  it("sending BOTH cookies resolves to exactly one session, never a union", async () => {
    const res = await request(app)
      .get("/api/vendor-portal/questions")
      .set("Cookie", `${alphaCookie}; ${betaCookie}`);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    const sawAlpha = body.includes("ALPHA-REQ");
    const sawBeta = body.includes("BETA-REQ");
    expect(sawAlpha || sawBeta).toBe(true);
    expect(sawAlpha && sawBeta).toBe(false);
  });
});

describe("VA-S1a — two vendors, ONE organization: writes stay on their own engagement", () => {
  it("Alpha submitting does not move Beta's engagement", async () => {
    const before = await pool.query<{ status: string }>(
      `SELECT status FROM vendor_engagements WHERE id = $1`,
      [beta.engagementId]
    );

    const res = await request(app).post("/api/vendor-portal/submit").set("Cookie", alphaCookie);
    expect(res.status).toBe(200);

    const alphaState = await pool.query<{ status: string }>(
      `SELECT status FROM vendor_engagements WHERE id = $1`,
      [alpha.engagementId]
    );
    expect(alphaState.rows[0]!.status).toBe("submitted");

    const after = await pool.query<{ status: string }>(
      `SELECT status FROM vendor_engagements WHERE id = $1`,
      [beta.engagementId]
    );
    expect(after.rows[0]!.status).toBe(before.rows[0]!.status);
  });

  it("Beta can still work after Alpha's questionnaire closed", async () => {
    const res = await request(app)
      .put(`/api/vendor-portal/questions/${beta.requirementId}`)
      .set("Cookie", betaCookie)
      .send({ answer: "partial", notes: "BETA-STILL-WORKING" });
    expect(res.status).toBe(200);
  });

  it("revoking ALPHA's invite leaves Beta's session alive — revocation is per engagement", async () => {
    const revoked = await request(app)
      .post(`/api/vendor-engagements/${alpha.engagementId}/invite/revoke`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ reason: "separation check" });
    expect(revoked.status).toBe(200);

    const alphaAfter = await request(app)
      .get("/api/vendor-portal/engagement")
      .set("Cookie", alphaCookie);
    expect(alphaAfter.status).toBe(401);

    const betaAfter = await request(app)
      .get("/api/vendor-portal/engagement")
      .set("Cookie", betaCookie);
    expect(betaAfter.status).toBe(200);
  });
});
