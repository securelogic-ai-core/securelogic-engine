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
import { enforceJsonContentType } from "../../src/api/lib/contentTypeAllowlist.js";
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

  // The strict Content-Type gate, in the position createApp() puts it —

  // the VA-E2E-1 rule, enforced by isolationSuitesUseRealGate.test.ts.

  app.use(enforceJsonContentType);
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

describe("STEP 5b — evidence review and finding promotion", () => {
  it("lists the engagement's evidence with its provenance", async () => {
    // Both vendor-supplied and internal evidence are legitimate; conflating
    // them is not. `from_vendor` is what lets a reviewer tell "they gave us
    // this" from "we produced this".
    const res = await asOrgA.get(`/api/vendor-engagements/${flow.engagementId}/evidence`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);
    for (const row of res.body.evidence) {
      expect(typeof row.from_vendor).toBe("boolean");
    }
  });

  it("refuses a review that does not state whether the document supports the claim", async () => {
    // Omitting it must NOT default to yes. A confirmation nobody made is the one
    // thing this route must never produce.
    const list = await asOrgA.get(`/api/vendor-engagements/${flow.engagementId}/evidence`);
    const target = list.body.evidence[0];

    const res = await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/evidence/${target.id}/review`)
      .send({ note: "Looks fine." });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("supports_required");
  });

  it("requires a reason when evidence is REJECTED", async () => {
    const list = await asOrgA.get(`/api/vendor-engagements/${flow.engagementId}/evidence`);
    const target = list.body.evidence[0];

    const res = await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/evidence/${target.id}/review`)
      .send({ supports: false });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("note_required");
  });

  it("a withdrawn confirmation moves the score BACK", async () => {
    // A reviewer who confirmed the wrong file must be able to undo it, and the
    // rating must follow. A one-way ladder would let a mistake become permanent.
    const list = await asOrgA.get(`/api/vendor-engagements/${flow.engagementId}/evidence`);
    const target = list.body.evidence.find((e: { reviewed_at: string | null }) => e.reviewed_at);
    expect(target, "expected a confirmed piece of evidence from STEP 5").toBeTruthy();

    // Compared on the ARITHMETIC score, not the final one. This engagement has
    // a failed mandatory control, so the EF1 cap pins the final score at 40 and
    // would hide the movement entirely — which is the cap working correctly, and
    // precisely why the arithmetic result is exposed alongside it.
    const before = (
      await asOrgA.post(`/api/vendor-engagements/${flow.engagementId}/recompute`).send({})
    ).body.effectiveness.arithmetic_score;

    const withdraw = await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/evidence/${target.id}/review`)
      .send({ supports: false, note: "Wrong document — this covers a different system." });
    expect(withdraw.status).toBe(200);

    const after = (
      await asOrgA.post(`/api/vendor-engagements/${flow.engagementId}/recompute`).send({})
    ).body.effectiveness.arithmetic_score;
    expect(after).toBeLessThan(before);

    // Restore for the remaining steps.
    await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/evidence/${target.id}/review`)
      .send({ supports: true, note: "Confirmed on re-read." });
    await asOrgA.post(`/api/vendor-engagements/${flow.engagementId}/recompute`).send({});
  });

  it("a review cannot reach another engagement's evidence", async () => {
    const other = await pool.query<{ id: string }>(
      `INSERT INTO evidence
         (organization_id, source_type, source_id, title, evidence_type)
       VALUES ($1, 'finding', gen_random_uuid(), 'Unrelated', 'document')
       RETURNING id`,
      [seed.orgA.id]
    );
    const res = await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/evidence/${other.rows[0]!.id}/review`)
      .send({ supports: true });
    expect(res.status).toBe(404);
  });

  it("promotes failed, partial and unanswered controls into canonical Findings", async () => {
    const res = await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/promote-findings`)
      .send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // CP-9 failed and IR-4 was partial. The five passes and the one N/A do not
    // promote.
    const refs = res.body.findings.map((f: { reference: string }) => f.reference).sort();
    expect(refs).toEqual(["CP-9", "IR-4"]);
    expect(res.body.created).toBe(2);
  });

  it("the findings are real rows the rest of the platform can see", async () => {
    const rows = await pool.query<{ severity: string; source_type: string; status: string }>(
      `SELECT severity, source_type, status FROM findings
        WHERE organization_id = $1 AND source_id = $2`,
      [seed.orgA.id, flow.engagementId]
    );
    expect(rows.rowCount).toBe(2);
    for (const row of rows.rows) {
      // A NEW source_type, not a reused one: source_type is a POINTER TYPE, and
      // tagging these `vendor_review` would make source_id resolve against
      // `vendor_assessments` — a dangling reference every consumer follows
      // silently, because both columns are UUIDs.
      expect(row.source_type).toBe("vendor_engagement");
      expect(row.status).toBe("open");
    }
  });

  it("re-promotion UPDATES rather than duplicating", async () => {
    // Two findings for one control means closing one leaves the other open, and
    // the vendor looks unremediated forever.
    const again = await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/promote-findings`)
      .send({});
    expect(again.body.created).toBe(0);
    expect(again.body.updated).toBe(2);

    const count = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM findings
        WHERE organization_id = $1 AND source_id = $2`,
      [seed.orgA.id, flow.engagementId]
    );
    expect(Number(count.rows[0]!.n)).toBe(2);
  });

  it("the vendor's PERSISTED legacy risk score moves when findings are promoted", async () => {
    // Promotion now schedules a recompute of vendors.current_risk_score (the
    // legacy HIGHER = BETTER score, entirely separate from the engagement's
    // residual score) via scheduleVendorScoreRecompute — the same hook CUEC
    // promotion uses. Before the hook this column stayed NULL forever here:
    // promotion scheduled no recompute, so the score only corrected itself the
    // next time some UNRELATED finding on the same vendor changed state.
    //
    // The hook is fire-and-forget (setImmediate + its own tenant scope), so
    // the write lands shortly AFTER the promote response — poll briefly
    // instead of sleeping a fixed amount.
    let score: number | null = null;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const row = await pool.query<{ score: number | null }>(
        `SELECT current_risk_score::float8 AS score
           FROM vendors WHERE id = $1 AND organization_id = $2`,
        [vendorId, seed.orgA.id]
      );
      score = row.rows[0]!.score;
      if (score !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(score).not.toBeNull();
    // Two ACTIVE engagement findings (one Critical) plus 'high' vendor
    // criticality: strictly below the 100 a finding-free vendor scores.
    expect(score!).toBeLessThan(100);
  });

  it("severity reflects THIS vendor, and says why", async () => {
    const rows = await pool.query<{ severity: string; severity_rationale: string }>(
      `SELECT severity, severity_rationale FROM findings
        WHERE organization_id = $1 AND source_id = $2 ORDER BY severity`,
      [seed.orgA.id, flow.engagementId]
    );
    // Critical-inherent vendor: a failed mandatory control lifts to Critical.
    expect(rows.rows.map((r) => r.severity)).toContain("Critical");
    for (const row of rows.rows) {
      expect(row.severity_rationale).toMatch(/inherent risk is Critical/);
    }
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

  it("walks submitted → in_review → analysis_complete → decision_pending over HTTP", async () => {
    // No SQL forcing: the review chain is driven through the same API a
    // reviewer uses. This is part of the LLM-independent end-to-end property.
    const review = await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/begin-review`)
      .send({});
    expect(review.status, JSON.stringify(review.body)).toBe(200);
    expect(review.body.status).toBe("in_review");

    // ── The clarification round-trip, both sides over HTTP. ────────────────
    // An internal-only note never leaves this surface and never moves state.
    const note = await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/comments`)
      .send({ body: "Internal: DR answer looks thin — ask them.", visibility: "internal" });
    expect(note.status).toBe(201);
    expect(note.body.status).toBe("in_review");

    // A vendor-visible comment during review IS the clarification request.
    const ask = await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/comments`)
      .send({ body: "Please confirm the scope of your DR failover test.", visibility: "vendor" });
    expect(ask.status).toBe(201);
    expect(ask.body.status).toBe("clarification_requested");

    // The vendor sees the question but NOT the internal note.
    const vendorThread = await request(app)
      .get("/api/vendor-portal/comments")
      .set("Cookie", flow.cookie!);
    const bodies = JSON.stringify(vendorThread.body);
    expect(bodies).toContain("scope of your DR failover test");
    expect(bodies).not.toContain("looks thin");

    // The vendor re-confirms their answer (same value — the resume is about the
    // TRANSITION, not new data), which reopens the engagement; then resubmits.
    const questions = (
      await request(app).get("/api/vendor-portal/questions").set("Cookie", flow.cookie!)
    ).body.questions as Array<{ requirement_id: string; reference: string }>;
    const cp9 = questions.find((q) => q.reference === "CP-9")!;
    const reconfirm = await request(app)
      .put(`/api/vendor-portal/questions/${cp9.requirement_id}`)
      .set("Cookie", flow.cookie!)
      .send({ answer: "fail", notes: "Confirmed: failover tested annually, single region only." });
    expect(reconfirm.status, JSON.stringify(reconfirm.body)).toBe(200);
    const resubmit = await request(app)
      .post("/api/vendor-portal/submit")
      .set("Cookie", flow.cookie!);
    expect(resubmit.status, JSON.stringify(resubmit.body)).toBe(200);

    const reopened = await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/begin-review`)
      .send({});
    expect(reopened.status).toBe(200);

    const analysis = await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/complete-analysis`)
      .send({});
    expect(analysis.status, JSON.stringify(analysis.body)).toBe(200);
    // RATIFIED — deterministic_only must never imply clean: no AI analysis ran
    // in this walkthrough, and the stamp says so. The value is computed by the
    // system, never accepted from the caller.
    expect(analysis.body.analysis_coverage).toBe("deterministic_only");

    // Residual lands → the machine's one permitted advance.
    const recompute = await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/recompute`)
      .send({});
    expect(recompute.status).toBe(200);
    const row = await pool.query<{ status: string }>(
      `SELECT status FROM vendor_engagements WHERE id = $1`,
      [flow.engagementId]
    );
    expect(row.rows[0]!.status).toBe("decision_pending");
  });

  it("records the decision", async () => {
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

describe("STEP 7 — monitoring and reassessment", () => {
  it("refuses monitoring with no review date — monitoring without a clock is not monitoring", async () => {
    const res = await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/monitoring`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("review_date_required");
  });

  it("starts monitoring from the decision, with a cadence", async () => {
    const res = await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/monitoring`)
      .send({ cadence_days: 90 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe("monitoring");
    expect(res.body.next_review_due).toBeTruthy();
  });

  it("the sweep leaves an engagement alone while its review is not due", async () => {
    const { runEngagementReviewDueSweep } = await import(
      "../../src/api/workers/vendorAssuranceMonitoringWorker.js"
    );
    await runEngagementReviewDueSweep();
    const row = await pool.query<{ review_overdue_notified_at: string | null }>(
      `SELECT review_overdue_notified_at FROM vendor_engagements WHERE id = $1`,
      [flow.engagementId]
    );
    expect(row.rows[0]!.review_overdue_notified_at).toBeNull();
  });

  it("marks the engagement overdue ONCE when the review date passes", async () => {
    const { runEngagementReviewDueSweep } = await import(
      "../../src/api/workers/vendorAssuranceMonitoringWorker.js"
    );
    await pool.query(
      `UPDATE vendor_engagements SET next_review_due = CURRENT_DATE - 1 WHERE id = $1`,
      [flow.engagementId]
    );

    await runEngagementReviewDueSweep();
    const row = await pool.query<{ review_overdue_notified_at: string | null }>(
      `SELECT review_overdue_notified_at FROM vendor_engagements WHERE id = $1`,
      [flow.engagementId]
    );
    expect(row.rows[0]!.review_overdue_notified_at).not.toBeNull();

    // Claim-then-emit: a second run finds nothing left to claim.
    const second = await runEngagementReviewDueSweep();
    expect(second.overdue).toBe(0);

    await new Promise((r) => setTimeout(r, 300));
    const events = await pool.query(
      `SELECT id FROM security_audit_log
        WHERE resource_id = $1 AND event_type = 'vendor_engagement.review_overdue'`,
      [flow.engagementId]
    );
    expect(events.rowCount).toBe(1);
  });

  it("an accepted Critical signal-match after the decision recommends reassessment", async () => {
    const { runEngagementIntelligenceSweep } = await import(
      "../../src/api/workers/vendorAssuranceMonitoringWorker.js"
    );

    const signal = await pool.query<{ id: string }>(
      `INSERT INTO cyber_signals
         (organization_id, source, signal_type, severity, normalized_summary, dedup_hash)
       VALUES ($1, 'e2e-feed', 'breach', 'Critical',
               'Meridian Payments disclosed a breach of its processing environment.',
               'e2e-meridian-breach-1')
       RETURNING id`,
      [seed.orgA.id]
    );
    // A PENDING suggestion for a second signal — must NOT count. An unreviewed
    // machine guess does not page anyone.
    const pending = await pool.query<{ id: string }>(
      `INSERT INTO cyber_signals
         (organization_id, source, signal_type, severity, normalized_summary, dedup_hash)
       VALUES ($1, 'e2e-feed', 'cve', 'Critical', 'Unreviewed CVE guess.', 'e2e-meridian-cve-1')
       RETURNING id`,
      [seed.orgA.id]
    );
    await pool.query(
      `INSERT INTO signal_match_suggestions
         (organization_id, signal_id, target_type, target_id, accepted_at, accepted_link_id)
       VALUES ($1, $2, 'vendor', $3, NOW(), gen_random_uuid()),
              ($1, $4, 'vendor', $3, NULL, NULL)`,
      [seed.orgA.id, signal.rows[0]!.id, vendorId, pending.rows[0]!.id]
    );

    const result = await runEngagementIntelligenceSweep();
    expect(result.recommended).toBeGreaterThanOrEqual(1);

    const row = await pool.query<{
      reassessment_recommended_at: string | null;
      reassessment_reason: string | null;
    }>(
      `SELECT reassessment_recommended_at, reassessment_reason
         FROM vendor_engagements WHERE id = $1`,
      [flow.engagementId]
    );
    expect(row.rows[0]!.reassessment_recommended_at).not.toBeNull();
    // The reason is interrogable: which trigger, how many signals, how severe.
    expect(row.rows[0]!.reassessment_reason).toMatch(/1 accepted intelligence signal/);
    expect(row.rows[0]!.reassessment_reason).toMatch(/highest severity Critical/);

    // Once per engagement until re-armed.
    const second = await runEngagementIntelligenceSweep();
    expect(second.recommended).toBe(0);
  });

  it("recording the completed review re-arms both triggers", async () => {
    const res = await asOrgA
      .post(`/api/vendor-engagements/${flow.engagementId}/monitoring`)
      .send({ cadence_days: 30 });
    expect(res.status).toBe(200);

    const row = await pool.query<{
      review_overdue_notified_at: string | null;
      reassessment_recommended_at: string | null;
      reassessment_reason: string | null;
    }>(
      `SELECT review_overdue_notified_at, reassessment_recommended_at, reassessment_reason
         FROM vendor_engagements WHERE id = $1`,
      [flow.engagementId]
    );
    expect(row.rows[0]!.review_overdue_notified_at).toBeNull();
    expect(row.rows[0]!.reassessment_recommended_at).toBeNull();
    expect(row.rows[0]!.reassessment_reason).toBeNull();
  });

  it("RATIFIED — the sweep recommends; it never changes a risk number or a state", async () => {
    // The whole monitoring chain ran. The residual measurement and the decision
    // are exactly as the human left them.
    const row = await pool.query<{ status: string; residual_rating: string; decision: string }>(
      `SELECT status, residual_rating, decision FROM vendor_engagements WHERE id = $1`,
      [flow.engagementId]
    );
    expect(row.rows[0]!.status).toBe("monitoring");
    expect(row.rows[0]!.residual_rating).toBe(flow.residualRating);
    expect(row.rows[0]!.decision).toBe("approved_with_conditions");
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
      `/api/vendor-engagements/${flow.engagementId}/monitoring`,
      `/api/vendor-engagements/${flow.engagementId}/begin-review`,
      `/api/vendor-engagements/${flow.engagementId}/complete-analysis`,
      `/api/vendor-engagements/${flow.engagementId}/promote-findings`,
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
