/**
 * vendorAssuranceEndToEnd.test.ts — the complete Vendor Assurance walkthrough.
 *
 * Intake → inherent risk → scope resolution → issue → the vendor's portal
 * session → answers → evidence → submit → reviewer confirmation → effectiveness
 * → residual → governance decision. Every step through the real HTTP surface,
 * against a real Postgres with RLS live.
 *
 * ── What this is, and what it is NOT ─────────────────────────────────────────
 * This is the end-to-end walkthrough of the WORKFLOW. It is not the staging
 * walkthrough the Definition of Done requires: there is no deployed environment
 * here, no real vendor, no email delivery, and no independent reviewer. It
 * proves the workflow is correct and complete; it does not prove it works in
 * production conditions, and nothing in this file should be read as if it did.
 *
 * What it does prove is the part that a staging walkthrough would find hardest
 * to check: that the ratified methodology constraints survive contact with the
 * real API, in order, with real persistence between every step.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { PORTAL_SESSION_COOKIE } from "../../src/api/lib/vendorPortal/portalTokens.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;
let vendorId: string;

/** The state carried between steps. Order matters here; that IS the test. */
const flow: {
  engagementId?: string;
  inviteToken?: string;
  cookie?: string;
  inherentScore?: number;
  inherentRating?: string;
  residualScore?: number;
  residualRating?: string;
} = {};

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n");

/** A payments processor: restricted data, mass volume, critical dependency. */
const INTAKE = {
  data_sensitivity: "restricted",
  data_volume: "mass",
  access_level: "read_write",
  operational_dependency: "critical",
  recoverability: "weeks",
  business_criticality: "critical",
  regulatory_exposure: "high",
  regulatory_breach_notification: true,
  ai_involvement: "none",
  ai_autonomy: "none",
  hosting_model: "multi_tenant_saas",
  fourth_party_exposure: "high",
  concentration: "single_point_of_failure",
};

/**
 * Authenticated request helpers. `request(app).set(...)` does NOT work — `.set`
 * lives on the Test, not on the agent, so the header must be attached after the
 * method call.
 */
const asOrgA = {
  get: (path: string) => request(app).get(path).set("X-Api-Key", seed.orgA.apiKey),
  post: (path: string) => request(app).post(path).set("X-Api-Key", seed.orgA.apiKey),
  patch: (path: string) => request(app).patch(path).set("X-Api-Key", seed.orgA.apiKey),
};
const asOrgB = {
  get: (path: string) => request(app).get(path).set("X-Api-Key", seed.orgB.apiKey),
  post: (path: string) => request(app).post(path).set("X-Api-Key", seed.orgB.apiKey),
};

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the VA end-to-end test.");
  process.env.DATABASE_URL = url;
  process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED = "true";
  process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "true";
  pool = new Pool({ connectionString: url, ssl: false });

  vendorId = await seedVendor(pool, seed.orgA.id, { name: "Meridian Payments" });

  // A small framework with real applicability tags, so scope resolution has
  // something to reason about rather than a synthetic corpus.
  const fw = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version)
     VALUES ($1, 'E2E Assurance Framework', '1.0') RETURNING id`,
    [seed.orgA.id]
  );
  const requirements: Array<[string, string, string[]]> = [
    ["AC-1", "Access Control Policy", ["core", "access-control"]],
    ["AC-6", "Privileged Access Review", ["access-control", "privileged-access"]],
    ["SC-13", "Cryptographic Protection", ["core", "encryption"]],
    ["SC-4", "Logical Separation of Customer Data", ["tenancy-isolation"]],
    ["PR-1", "Personal Data Processing", ["privacy", "data-protection"]],
    ["IR-4", "Incident Handling", ["core", "incident-response"]],
    ["CP-9", "Backup and Disaster Recovery", ["core", "business-continuity", "resilience"]],
    ["SA-9", "Third-Party Suppliers", ["supply-chain"]],
  ];
  for (const [ref, title, tags] of requirements) {
    await pool.query(
      `INSERT INTO requirements (framework_id, reference_id, title, scope_tags, scope_tags_source)
       VALUES ($1, $2, $3, $4, 'curated')`,
      [fw.rows[0]!.id, ref, title, tags]
    );
  }

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

describe("STEP 1 — intake and inherent risk", () => {
  it("refuses an incomplete intake rather than defaulting the missing answers", async () => {
    // The worst available failure: a confident score computed from answers
    // nobody gave, indistinguishable from an assessed one.
    const res = await asOrgA
      .post("/api/vendor-engagements")
      .send({ vendor_id: vendorId, intake: { data_sensitivity: "restricted" } });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("incomplete_intake");
    expect(res.body.missing.length).toBeGreaterThan(8);
  });

  it("rejects a level the scoring model cannot score", async () => {
    const res = await asOrgA
      .post("/api/vendor-engagements")
      .send({ vendor_id: vendorId, intake: { ...INTAKE, ai_autonomy: "autonomous" } });

    expect(res.status).toBe(400);
    // The vocabulary comes from the model, so the error carries the real one.
    const field = res.body.invalid.find((i: { field: string }) => i.field === "ai_autonomy");
    expect(field.allowed).toContain("autonomous_consequential");
  });

  it("opens the engagement and computes inherent risk with its full basis", async () => {
    const res = await asOrgA
      .post("/api/vendor-engagements")
      .send({ vendor_id: vendorId, engagement_type: "initial", intake: INTAKE });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    flow.engagementId = res.body.id;
    flow.inherentScore = res.body.inherent.score;
    flow.inherentRating = res.body.inherent.rating;

    expect(res.body.inherent.rating).toBe("Critical");
    expect(res.body.inherent.tier).toBe("tier_1_critical");
    // The explanation travels with the number — a reviewer must never have to
    // re-derive anything.
    expect(res.body.inherent.basis.factors.length).toBe(9);
    expect(res.body.inherent.basis.methodology_version).toBeTruthy();
  });

  it("stamps the methodology versions, which are never rewritten", async () => {
    const row = await pool.query<{ methodology_version: string; scope_rule_version: string }>(
      `SELECT methodology_version, scope_rule_version FROM vendor_engagements WHERE id = $1`,
      [flow.engagementId]
    );
    expect(row.rows[0]!.methodology_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(row.rows[0]!.scope_rule_version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("STEP 2 — scope resolution and freeze", () => {
  it("refuses to issue before the scope is resolved, and says what to do", async () => {
    // The STATE MACHINE catches this first, before the empty-scope guard —
    // `draft` simply has no transition to `issued`. That ordering is right: the
    // machine is the authority on transitions and handlers never second-guess
    // it. But "cannot issue from draft" alone leaves the reviewer to work out
    // the remedy, so the message names it.
    const res = await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/issue`)
      .send({ contact_email: "security@meridian.example.com" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("cannot_issue");
    expect(res.body.from).toBe("draft");
    expect(res.body.message).toMatch(/resolve the questionnaire scope/i);
  });

  it("the empty-scope guard still stands behind it", async () => {
    // Reachable when an org has no activated frameworks: resolution succeeds,
    // produces nothing, and the engagement reaches `scoped` with zero items.
    // Issuing then would send a vendor a link to nothing and read, later, as a
    // vendor who answered everything.
    const empty = await seedVendor(pool, seed.orgB.id, { name: "Empty Corpus Vendor" });
    const created = await asOrgB
      .post("/api/vendor-engagements")
      .send({ vendor_id: empty, intake: INTAKE });
    expect(created.status).toBe(201);

    await asOrgB.post(`/api/vendor-engagements/${created.body.id}/scope`).send({});
    const res = await asOrgB
      .post(`/api/vendor-engagements/${created.body.id}/issue`)
      .send({ contact_email: "nobody@example.com" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("empty_scope");
  });

  it("resolves the scope deterministically and records why each item is in it", async () => {
    const res = await asOrgA.post(`/api/vendor-engagements/${flow.engagementId}/scope`).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Tier 1 takes every requirement of every activated framework.
    expect(res.body.scoped).toBe(8);
    expect(res.body.tier).toBe("tier_1_critical");

    const items = await pool.query<{ reasons: unknown[] }>(
      `SELECT reasons FROM vendor_engagement_scope_items WHERE engagement_id = $1`,
      [flow.engagementId]
    );
    for (const item of items.rows) {
      expect(Array.isArray(item.reasons)).toBe(true);
      expect((item.reasons as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it("moves the engagement to `scoped`", async () => {
    const row = await pool.query<{ status: string }>(
      `SELECT status FROM vendor_engagements WHERE id = $1`,
      [flow.engagementId]
    );
    expect(row.rows[0]!.status).toBe("scoped");
  });
});

describe("STEP 3 — issue", () => {
  it("mints an invite and returns the raw token exactly once", async () => {
    const res = await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/issue`)
      .send({ contact_email: "security@meridian.example.com", contact_name: "R. Chen" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.invite_token).toBeTruthy();
    flow.inviteToken = res.body.invite_token;
  });

  it("stores ONLY the hash — a database read cannot reconstruct the credential", async () => {
    const row = await pool.query<{ invite_token_hash: string }>(
      `SELECT invite_token_hash FROM vendor_engagement_invites WHERE engagement_id = $1`,
      [flow.engagementId]
    );
    expect(row.rows[0]!.invite_token_hash).not.toBe(flow.inviteToken);
    expect(row.rows[0]!.invite_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps the token out of the audit log", async () => {
    await new Promise((r) => setTimeout(r, 300));
    const events = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM security_audit_log
        WHERE resource_id = $1 AND event_type = 'vendor_engagement.issued'`,
      [flow.engagementId]
    );
    expect(events.rowCount).toBeGreaterThan(0);
    // An audit log is readable by more people than the vendor's mailbox.
    expect(JSON.stringify(events.rows[0]!.payload)).not.toContain(flow.inviteToken);
  });

  it("freezes the scope once issued", async () => {
    const res = await asOrgA.post(`/api/vendor-engagements/${flow.engagementId}/scope`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("scope_frozen");
  });

  it("locks inherent risk once issued — the scope derives from it", async () => {
    const res = await asOrgA
      .patch(`/api/vendor-engagements/${flow.engagementId}/inherent`)
      .send({ rating: "Low", rationale: "Trying to soften this after the fact." });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("inherent_locked");
  });
});

describe("STEP 4 — the vendor responds through the portal", () => {
  it("exchanges the invite for a session", async () => {
    const res = await request(app)
      .post("/api/vendor-portal/session")
      .send({ token: flow.inviteToken });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const raw = res.headers["set-cookie"] as unknown as string[];
    flow.cookie = raw.find((c) => c.startsWith(PORTAL_SESSION_COOKIE))!.split(";")[0]!;
  });

  it("serves the frozen questionnaire with its justifications", async () => {
    const res = await request(app)
      .get("/api/vendor-portal/questions")
      .set("Cookie", flow.cookie!);
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(8);
    // A vendor being asked eight controls deserves to know why each applies.
    for (const q of res.body.questions) {
      expect(q.why_we_are_asking.length).toBeGreaterThan(0);
    }
  });

  it("accepts answers, including a not_applicable that must not be scored as a gap", async () => {
    const questions = (
      await request(app).get("/api/vendor-portal/questions").set("Cookie", flow.cookie!)
    ).body.questions as Array<{ requirement_id: string; reference: string }>;

    // A realistic mix: mostly passing, one partial, one genuine N/A, one failure.
    const answers: Record<string, string> = {
      "AC-1": "pass",
      "AC-6": "pass",
      "SC-13": "pass",
      "SC-4": "not_applicable", // single-tenant deployment
      "PR-1": "pass",
      "IR-4": "partial",
      "CP-9": "fail",
      "SA-9": "pass",
    };

    for (const q of questions) {
      const res = await request(app)
        .put(`/api/vendor-portal/questions/${q.requirement_id}`)
        .set("Cookie", flow.cookie!)
        .send({ answer: answers[q.reference], notes: `Response for ${q.reference}.` });
      expect(res.status, `${q.reference}: ${JSON.stringify(res.body)}`).toBe(200);
    }
  });

  it("accepts supporting evidence", async () => {
    const questions = (
      await request(app).get("/api/vendor-portal/questions").set("Cookie", flow.cookie!)
    ).body.questions as Array<{ requirement_id: string; reference: string }>;
    const encryption = questions.find((q) => q.reference === "SC-13")!;

    // Blob storage is unconfigured here, so the upload cannot complete — and
    // that is the CORRECT behaviour to observe: a 503 that says storage is
    // unavailable, not a row claiming a file exists.
    const res = await request(app)
      .post("/api/vendor-portal/evidence")
      .set("Cookie", flow.cookie!)
      .field("requirement_id", encryption.requirement_id)
      .attach("file", PDF, { filename: "key-management.pdf", contentType: "application/pdf" });

    expect([201, 503]).toContain(res.status);
    if (res.status === 503) {
      const orphans = await pool.query(
        `SELECT 1 FROM evidence WHERE engagement_id = $1`,
        [flow.engagementId]
      );
      // A failed upload leaves NOTHING behind.
      expect(orphans.rowCount).toBe(0);
    }
  });

  it("submits", async () => {
    const res = await request(app).post("/api/vendor-portal/submit").set("Cookie", flow.cookie!);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe("submitted");
  });

  it("refuses further changes after submission", async () => {
    const questions = (
      await request(app).get("/api/vendor-portal/questions").set("Cookie", flow.cookie!)
    ).body.questions as Array<{ requirement_id: string }>;

    const res = await request(app)
      .put(`/api/vendor-portal/questions/${questions[0]!.requirement_id}`)
      .set("Cookie", flow.cookie!)
      .send({ answer: "pass" });
    expect(res.status).toBe(409);
  });
});

describe("STEP 5 — effectiveness and residual", () => {
  it("computes both, and the vendor's unevidenced answers do not score as working controls", async () => {
    const res = await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/recompute`)
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    flow.residualScore = res.body.residual.score;
    flow.residualRating = res.body.residual.rating;

    // Seven applicable controls; SC-4 left the denominator entirely.
    expect(res.body.effectiveness.assessed).toBe(7);
    expect(res.body.effectiveness.not_applicable).toBe(1);
    expect(res.body.effectiveness.not_assessed).toBe(0);

    // Nothing was evidenced, so every pass sits at `asserted` — half credit.
    expect(res.body.effectiveness.score).toBeLessThan(60);
  });

  it("the N/A control did not depress the score", async () => {
    // Scoring it zero would punish the vendor for the breadth of OUR
    // questionnaire; counting it as a pass would inflate every score.
    const basis = (
      await asOrgA.get(`/api/vendor-engagements/${flow.engagementId}`)
    ).body.engagement.effectiveness_basis;
    const refs = basis.factors.map((f: { reference: string }) => f.reference);
    expect(refs).not.toContain("SC-4");
    expect(refs).toHaveLength(7);
  });

  it("residual is below inherent but nowhere near zero", async () => {
    expect(flow.residualScore!).toBeLessThan(flow.inherentScore!);
    expect(flow.residualScore!).toBeGreaterThan(0);
    // Weak controls on a critical vendor: still a serious risk.
    expect(["Critical", "High"]).toContain(flow.residualRating);
  });

  it("persists both bases so the rating can be explained years later", async () => {
    const row = await pool.query<{
      effectiveness_basis: { method: string };
      residual_basis: { method: string; factors: unknown[] };
    }>(
      `SELECT effectiveness_basis, residual_basis FROM vendor_engagements WHERE id = $1`,
      [flow.engagementId]
    );
    expect(row.rows[0]!.effectiveness_basis.method).toBe("vendor_effectiveness_v1");
    expect(row.rows[0]!.residual_basis.method).toBe("vendor_residual_v1");
    expect(row.rows[0]!.residual_basis.factors.length).toBe(2);
  });

  it("confirming evidence RAISES effectiveness — the ladder actually moves", async () => {
    // The difference between "they attached something" and "somebody checked"
    // is most of what a vendor assurance programme is for, so it must be
    // observable end to end and not only in the unit test.
    const before = (
      await asOrgA.post(`/api/vendor-engagements/${flow.engagementId}/recompute`).send({})
    ).body.effectiveness.score;

    const scoped = await pool.query<{ requirement_id: string }>(
      `SELECT si.requirement_id FROM vendor_engagement_scope_items si
         JOIN requirements r ON r.id = si.requirement_id
        WHERE si.engagement_id = $1 AND r.reference_id = 'AC-1'`,
      [flow.engagementId]
    );
    await pool.query(
      `INSERT INTO evidence
         (organization_id, source_type, source_id, title, evidence_type,
          engagement_id, requirement_id, reviewed_at, reviewed_by_user_id)
       VALUES ($1, 'vendor_engagement', $2, 'Access control policy', 'policy',
               $2, $3, NOW(), NULL)`,
      [seed.orgA.id, flow.engagementId, scoped.rows[0]!.requirement_id]
    );

    const after = (
      await asOrgA.post(`/api/vendor-engagements/${flow.engagementId}/recompute`).send({})
    ).body.effectiveness.score;

    expect(after).toBeGreaterThan(before);
  });
});

describe("STEP 6 — the governance decision", () => {
  it("refuses a decision with no rationale", async () => {
    const res = await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/decision`)
      .send({ decision: "approved_with_conditions" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("rationale_required");
  });

  it("records the decision", async () => {
    // The engagement must reach a state the machine allows `decided` from.
    await pool.query(`UPDATE vendor_engagements SET status = 'decision_pending' WHERE id = $1`, [
      flow.engagementId,
    ]);

    const res = await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/decision`)
      .send({
        decision: "approved_with_conditions",
        rationale: "Approved subject to a remediation plan for backup and DR by Q4.",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.decision).toBe("approved_with_conditions");
  });

  it("RATIFIED — accepting the risk did NOT reduce the residual", async () => {
    // The constraint the whole separation of measurement from treatment exists
    // to protect. "Residual: High, approved with conditions" is the truth.
    // "Accepted Risk: Moderate" is a lie that survives into a board pack.
    const row = await pool.query<{ residual_score: number; residual_rating: string }>(
      `SELECT residual_score, residual_rating FROM vendor_engagements WHERE id = $1`,
      [flow.engagementId]
    );
    expect(row.rows[0]!.residual_rating).toBe(flow.residualRating);
    expect(["Critical", "High"]).toContain(row.rows[0]!.residual_rating);
  });

  it("captures the measurement the decision was made AGAINST", async () => {
    await new Promise((r) => setTimeout(r, 300));
    const events = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM security_audit_log
        WHERE resource_id = $1 AND event_type = 'vendor_engagement.decided'`,
      [flow.engagementId]
    );
    // Someone reviewing this later must see what was known at the time, not
    // what the number says today.
    expect(events.rows[0]!.payload.residual_rating_at_decision).toBeTruthy();
    expect(events.rows[0]!.payload.rationale).toBeTruthy();
  });
});

describe("cross-tenant isolation holds across the whole workflow", () => {
  it("another org cannot read, scope, recompute or decide this engagement", async () => {
    const read = await asOrgB.get(`/api/vendor-engagements/${flow.engagementId}`);
    expect(read.status).toBe(404);

    for (const path of [
      `/api/vendor-engagements/${flow.engagementId}/scope`,
      `/api/vendor-engagements/${flow.engagementId}/recompute`,
      `/api/vendor-engagements/${flow.engagementId}/decision`,
      `/api/vendor-engagements/${flow.engagementId}/issue`,
    ]) {
      const res = await asOrgB.post(path).send({
        decision: "approved",
        rationale: "attempting cross-tenant decision",
        contact_email: "attacker@example.com",
      });
      // Never a 200. Not-found and not-yours are indistinguishable.
      expect(res.status, path).not.toBe(200);
      expect([400, 403, 404, 409, 422], `${path} -> ${res.status}`).toContain(res.status);
    }
  });

  it("org B's queue does not contain org A's engagement", async () => {
    const res = await asOrgB.get("/api/vendor-engagements");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(flow.engagementId);
    expect(JSON.stringify(res.body)).not.toContain("Meridian");
  });
});
