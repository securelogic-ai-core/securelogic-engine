/**
 * questionnaireHardening.test.ts — VA-Q1 P4, the directive's remaining
 * adversarial classes, through the REAL createApp() (every middleware in the
 * chain production runs, including the Content-Type gate and the JWT bridge).
 *
 *   - unauthorised creation/modification: a MEMBER-role session can read the
 *     library but cannot create, publish, link or unlink; an ADMIN can
 *   - issued-snapshot mutation: after issue, every internal write that would
 *     change what was asked is refused with a named reason, and the stamp holds
 *   - identifier manipulation: a vendor cannot choose which version their
 *     answer is recorded against — the body's question_version_id is ignored
 *     and the frozen item's version wins; a foreign requirement id is 404
 *   - mapping tampering on a bridge: the bridge question's only link cannot be
 *     removed while it is active, and publishing a new version on it through
 *     the API leaves the issued item on the old version
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

// The JWT bridge needs a signing secret; the harness provides none (same
// convention as riskAcceptanceFlagOff.test.ts).
process.env.JWT_SECRET ??= "test-jwt-secret-for-questionnaire-hardening";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, seedVendor, type TestDbSeed } from "./testDb.js";
import { signJwt } from "../../src/api/lib/jwt.js";
import { recordAllCurrentConsents } from "../../src/api/lib/legalConsent.js";
import { PORTAL_SESSION_COOKIE } from "../../src/api/lib/vendorPortal/portalTokens.js";

let seed: TestDbSeed;
let pool: Pool;
let app: Express;
let adminJwt: string;
let memberJwt: string;
let vendorId: string;
let requirementId: string;

const TIER1_INTAKE = {
  engagement_type: "initial",
  data_sensitivity: "restricted", data_volume: "large", access_level: "admin",
  operational_dependency: "critical", recoverability: "weeks", business_criticality: "critical",
  regulatory_exposure: "high", regulatory_breach_notification: true,
  ai_involvement: "none", ai_autonomy: "none", hosting_model: "multi_tenant_saas",
  fourth_party_exposure: "low", concentration: "low",
};

const asAdmin = (m: "get" | "post" | "patch" | "delete", p: string) => request(app)[m](p).set("Authorization", `Bearer ${adminJwt}`);
const asMember = (m: "get" | "post" | "patch" | "delete", p: string) => request(app)[m](p).set("Authorization", `Bearer ${memberJwt}`);

async function seedSession(orgId: string, email: string, role: "admin" | "member"): Promise<string> {
  const u = await seedUser(pool, orgId, { email });
  await pool.query(`UPDATE users SET role = $2 WHERE id = $1`, [u.id, role]);
  await recordAllCurrentConsents(pool, { userId: u.id, organizationId: orgId, consentMethod: "admin_recorded" });
  return signJwt(u.id, orgId, role);
}

async function openIssuedEngagement(title: string) {
  const created = await asAdmin("post", "/api/vendor-engagements").send({ ...TIER1_INTAKE, vendor_id: vendorId, title });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.id as string;
  // Pinned to the 1.1.0 corpus this suite proves over its one-requirement
  // library (Assessment Composition v1 stamps new engagements 1.2.0, which
  // provisions the Core Assurance Set; the stamp selects the corpus).
  await pool.query(`UPDATE vendor_engagements SET scope_rule_version = '1.1.0' WHERE id = $1`, [id]);
  expect((await asAdmin("post", `/api/vendor-engagements/${id}/scope`).send({})).status).toBe(200);
  const issued = await asAdmin("post", `/api/vendor-engagements/${id}/issue`).send({ contact_email: `${title}@example.com` });
  expect(issued.status, JSON.stringify(issued.body)).toBe(200);
  return { id, token: issued.body.invite_token as string };
}

async function stampOf(id: string): Promise<string> {
  for (let i = 0; i < 20; i += 1) {
    const r = await asAdmin("get", `/api/vendor-engagements/${id}/integrity`);
    if (typeof r.body.stamped_hash === "string") return r.body.stamped_hash;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error("never stamped");
}

async function portalCookie(token: string): Promise<string> {
  const res = await request(app).post("/api/vendor-portal/session").send({ token });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const raw = res.headers["set-cookie"] as unknown as string[];
  return raw.find((c) => c.startsWith(PORTAL_SESSION_COOKIE))!.split(";")[0]!;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env.DATABASE_URL = url;
  process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "true";
  pool = new Pool({ connectionString: url, ssl: false });

  adminJwt = await seedSession(seed.orgA.id, "p4-admin@a.test", "admin");
  memberJwt = await seedSession(seed.orgA.id, "p4-member@a.test", "member");
  vendorId = await seedVendor(pool, seed.orgA.id, { name: "P4 vendor", criticality: "critical" });
  const fw = await pool.query<{ id: string }>(`INSERT INTO frameworks (organization_id, name, version) VALUES ($1, 'P4 framework', '1.0') RETURNING id`, [seed.orgA.id]);
  const r = await pool.query<{ id: string }>(
    `INSERT INTO requirements (framework_id, reference_id, title, description, scope_tags, scope_tags_source, scope_tags_at)
     VALUES ($1, 'P4-1', 'Change control is enforced', 'Guidance.', '{core}', 'curated', NOW()) RETURNING id`,
    [fw.rows[0]!.id]
  );
  requirementId = r.rows[0]!.id;

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 300_000);

afterAll(async () => {
  await pool.end();
});

describe("P4 · role separation on the question library (real createApp, real JWT bridge)", () => {
  it("a member can read the library but every mutation is 403 — an admin succeeds on the same calls", async () => {
    expect((await asMember("get", "/api/questions")).status).toBe(200);
    expect((await asMember("get", "/api/questions/coverage")).status).toBe(200);

    const denied = await asMember("post", "/api/questions").send({ question_key: "security.member.try", domain: "security" });
    expect(denied.status).toBe(403);

    const ok = await asAdmin("post", "/api/questions").send({ question_key: "security.admin.made", domain: "security" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const qid = ok.body.question.id as string;

    expect((await asMember("post", `/api/questions/${qid}/links`).send({ requirement_id: requirementId })).status).toBe(403);
    expect((await asMember("post", `/api/questions/${qid}/versions`).send({ prompt: "x", answer_type: "attest" })).status).toBe(403);
    expect((await asMember("patch", `/api/questions/${qid}`).send({ status: "retired" })).status).toBe(403);

    const link = await asAdmin("post", `/api/questions/${qid}/links`).send({ requirement_id: requirementId });
    expect(link.status).toBe(201);
    expect((await asMember("delete", `/api/questions/${qid}/links/${link.body.link.id}`)).status).toBe(403);
    expect((await asAdmin("post", `/api/questions/${qid}/versions`).send({ prompt: "Admin published.", answer_type: "attest", activate: true })).status).toBe(201);
  });
});

describe("P4 · an issued questionnaire cannot be mutated through any internal write", () => {
  let issued: { id: string; token: string };
  let stamp: string;

  beforeAll(async () => {
    issued = await openIssuedEngagement("p4-frozen");
    stamp = await stampOf(issued.id);
  });

  it("re-resolving scope after issue is refused as scope_frozen", async () => {
    const r = await asAdmin("post", `/api/vendor-engagements/${issued.id}/scope`).send({});
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("scope_frozen");
  });

  it("overriding inherent risk after issue is refused as inherent_locked", async () => {
    const r = await asAdmin("patch", `/api/vendor-engagements/${issued.id}/inherent`).send({ rating: "Low", rationale: "trying to soften the tier after issue" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("inherent_locked");
  });

  it("issuing again is refused as cannot_issue", async () => {
    const r = await asAdmin("post", `/api/vendor-engagements/${issued.id}/issue`).send({ contact_email: "again@example.com" });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("cannot_issue");
  });

  it("the bridge question's only link cannot be removed while it is active, and publishing a new version on it leaves the issued item where it was", async () => {
    const item = await pool.query<{ question_version_id: string }>(`SELECT question_version_id FROM vendor_engagement_scope_items WHERE engagement_id = $1`, [issued.id]);
    const v1 = item.rows[0]!.question_version_id;
    const q = await pool.query<{ question_id: string }>(`SELECT question_id FROM question_versions WHERE id = $1`, [v1]);
    const qid = q.rows[0]!.question_id;

    const detail = await asAdmin("get", `/api/questions/${qid}`);
    expect(detail.body.question.question_key).toMatch(/^req:/);
    const unlink = await asAdmin("delete", `/api/questions/${qid}/links/${detail.body.links[0].id}`);
    expect(unlink.status).toBe(409);
    expect(unlink.body.error).toBe("last_link_on_active_question");

    const v2 = await asAdmin("post", `/api/questions/${qid}/versions`).send({ prompt: "Rewritten through the API after issue.", answer_type: "attest" });
    expect(v2.status).toBe(201);
    expect(v2.body.version.version).toBe(2);

    const after = await pool.query<{ question_version_id: string }>(`SELECT question_version_id FROM vendor_engagement_scope_items WHERE engagement_id = $1`, [issued.id]);
    expect(after.rows[0]!.question_version_id).toBe(v1);
    const r = await asAdmin("get", `/api/vendor-engagements/${issued.id}/integrity`);
    expect(r.body.verdict).toBe("match");
    expect(r.body.stamped_hash).toBe(stamp);
  });
});

describe("P4 · identifier manipulation from the vendor side", () => {
  it("the body's question_version_id is ignored — the answer is recorded against the frozen item's version", async () => {
    const { id, token } = await openIssuedEngagement("p4-idm");
    const cookie = await portalCookie(token);
    const item = await pool.query<{ question_version_id: string }>(`SELECT question_version_id FROM vendor_engagement_scope_items WHERE engagement_id = $1`, [id]);
    const frozen = item.rows[0]!.question_version_id;

    const r = await request(app).put(`/api/vendor-portal/questions/${requirementId}`).set("Cookie", cookie)
      .send({ answer: "pass", notes: "ok", question_version_id: "00000000-0000-0000-0000-00000000dead" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const resp = await pool.query<{ question_version_id: string }>(`SELECT question_version_id FROM requirement_responses WHERE engagement_id = $1`, [id]);
    expect(resp.rows[0]!.question_version_id).toBe(frozen);
  });

  it("a requirement outside the frozen scope — foreign or unknown — is indistinguishable (404)", async () => {
    const { token } = await openIssuedEngagement("p4-foreign");
    const cookie = await portalCookie(token);
    const foreign = await pool.query<{ id: string }>(
      `INSERT INTO requirements (framework_id, reference_id, title) SELECT id, 'P4-B', 'Org B control' FROM frameworks WHERE organization_id = $1 LIMIT 1 RETURNING id`,
      [seed.orgB.id]
    );
    const foreignId = foreign.rows[0]?.id ?? "00000000-0000-0000-0000-000000000009";
    const a = await request(app).put(`/api/vendor-portal/questions/${foreignId}`).set("Cookie", cookie).send({ answer: "pass" });
    const b = await request(app).put(`/api/vendor-portal/questions/00000000-0000-0000-0000-000000000009`).set("Cookie", cookie).send({ answer: "pass" });
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(a.body).toEqual(b.body);
  });
});
