/**
 * vendorPortalResponseCompleteness.test.ts — WA-1, against real Postgres.
 *
 * Two invariants, both from the owner rulings of 2026-09-04.
 *
 * RULING 3 — an assessment cannot be submitted with unexplained answers.
 *
 *   Measured on the owner's walkthrough engagement before this shipped: 37
 *   questions, 37 answered, 5 `partial` + 3 `fail` + 1 `not_applicable`, and
 *   ZERO explanations. The shipped guard counted unanswered MANDATORY items
 *   and nothing else, so that submitted cleanly and promoted findings with no
 *   vendor statement behind any of them.
 *
 * RULING 6 — portal write authorization ends when the engagement concludes,
 *   and it ends ENGAGEMENT-SCOPED.
 *
 *   The window closes at `analysis_complete`: `isPortalRespondable` already
 *   refused writes from `submitted` onward and `isPortalCommentable` stops
 *   here, so this is the state at which the vendor's participation genuinely
 *   ends. Terminating at `submitted` would have broken the clarification loop,
 *   which is the one workflow that state exists for.
 *
 *   The scoping half is the part that needs proving against a real database: a
 *   contact working on TWO engagements must keep the other one. That holds
 *   structurally (a session belongs to one invite and one engagement) but
 *   "structurally true" is what the vendorPortalAdversarial suite exists to
 *   distrust, so it is asserted here on live rows.
 *
 * The tenant boundary itself is not re-proven here — the portal takes no
 * identifier from the caller (requirePortalSession INVARIANT 1) and
 * vendorPortalAdversarial.test.ts owns that surface. What IS asserted is that
 * a concluding engagement in org A leaves org B's credentials alone.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { enforceJsonContentType } from "../../src/api/lib/contentTypeAllowlist.js";
import {
  hashPortalToken,
  generatePortalToken,
  PORTAL_SESSION_COOKIE,
} from "../../src/api/lib/vendorPortal/portalTokens.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

type Fixture = {
  engagementId: string;
  token: string;
  /** requirement ids, in the order they were created. */
  requirements: string[];
};

/**
 * An `issued` engagement with a live invite and N mandatory items.
 *
 * `evidencePolicy` is written onto a real `question_versions` row and pointed
 * at by the scope item, exactly as `ensureBridgeQuestions` does at composition
 * — the completeness gate reads it through that join, and a fixture that
 * skipped the join would prove nothing about the read path.
 */
async function seedIssued(
  orgId: string,
  label: string,
  opts: { items?: number; evidencePolicy?: string } = {}
): Promise<Fixture> {
  const count = opts.items ?? 1;
  const vendorId = await seedVendor(pool, orgId, { name: `${label} vendor` });
  const eng = await pool.query<{ id: string }>(
    `INSERT INTO vendor_engagements
       (organization_id, vendor_id, engagement_type, status, methodology_version, scope_rule_version, title)
     VALUES ($1, $2, 'initial', 'issued', '1.0.0', '1.0.0', $3)
     RETURNING id`,
    [orgId, vendorId, `${label} engagement`]
  );
  const engagementId = eng.rows[0]!.id;

  const token = generatePortalToken();
  await pool.query(
    `INSERT INTO vendor_engagement_invites
       (organization_id, engagement_id, invite_token_hash, contact_email, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      orgId,
      engagementId,
      hashPortalToken(token),
      `${label}@example.com`,
      new Date(Date.now() + 30 * 24 * 3600_000),
    ]
  );

  const fw = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version) VALUES ($1, $2, '1.0') RETURNING id`,
    [orgId, `${label} framework`]
  );

  const requirements: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const req = await pool.query<{ id: string }>(
      `INSERT INTO requirements (framework_id, reference_id, title, description)
       VALUES ($1, $2, $3, 'Guidance text.') RETURNING id`,
      [fw.rows[0]!.id, `${label}-REQ-${i}`, `${label} requirement ${i}`]
    );
    const requirementId = req.rows[0]!.id;
    requirements.push(requirementId);

    let questionVersionId: string | null = null;
    if (opts.evidencePolicy) {
      const q = await pool.query<{ id: string }>(
        `INSERT INTO questions (organization_id, question_key, domain, origin, template_key, status, current_version)
         VALUES ($1, $2, 'security', 'securelogic', 'bridge', 'active', 1) RETURNING id`,
        [orgId, `req:${label}:${i}`.toLowerCase()]
      );
      const qv = await pool.query<{ id: string }>(
        `INSERT INTO question_versions
           (organization_id, question_id, version, prompt, guidance, answer_type,
            evidence_policy, content_hash)
         VALUES ($1, $2, 1, $3, 'Guidance text.', 'attest', $4, $5) RETURNING id`,
        [
          orgId,
          q.rows[0]!.id,
          `${label} requirement ${i}`,
          opts.evidencePolicy,
          // Any distinct 64-hex value: the gate reads evidence_policy, not the hash.
          `${i}`.padStart(64, "a"),
        ]
      );
      questionVersionId = qv.rows[0]!.id;
    }

    await pool.query(
      `INSERT INTO vendor_engagement_scope_items
         (organization_id, engagement_id, requirement_id, depth, mandatory, source, reasons,
          question_version_id)
       VALUES ($1, $2, $3, 'full', TRUE, 'deterministic', $4::jsonb, $5)`,
      [
        orgId,
        engagementId,
        requirementId,
        JSON.stringify([
          { rule_id: "S1.baseline", rule_family: "S1", rationale: "Baseline for this tier." },
        ]),
        questionVersionId,
      ]
    );
  }

  return { engagementId, token, requirements };
}

/** Exchange an invite for a session cookie. Also moves issued -> in_progress. */
async function sessionCookie(token: string): Promise<string> {
  const res = await request(app).post("/api/vendor-portal/session").send({ token });
  expect(res.status, `exchange failed: ${JSON.stringify(res.body)}`).toBe(200);
  const raw = res.headers["set-cookie"] as unknown as string[];
  return raw.find((c) => c.startsWith(PORTAL_SESSION_COOKIE))!.split(";")[0]!;
}

async function answer(
  cookie: string,
  requirementId: string,
  body: { answer: string; notes?: string | null }
): Promise<request.Response> {
  return request(app)
    .put(`/api/vendor-portal/questions/${requirementId}`)
    .set("Cookie", cookie)
    .send({ notes: null, ...body });
}

const submit = (cookie: string) =>
  request(app).post("/api/vendor-portal/submit").set("Cookie", cookie).send({});

const questions = (cookie: string) =>
  request(app).get("/api/vendor-portal/questions").set("Cookie", cookie);

const statusOf = async (id: string) =>
  (
    await pool.query<{ status: string }>(
      `SELECT status FROM vendor_engagements WHERE id = $1`,
      [id]
    )
  ).rows[0]!.status;

const liveCredentials = async (engagementId: string) => {
  const invites = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM vendor_engagement_invites
      WHERE engagement_id = $1 AND revoked_at IS NULL`,
    [engagementId]
  );
  const sessions = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM vendor_portal_sessions
      WHERE engagement_id = $1 AND revoked_at IS NULL`,
    [engagementId]
  );
  return { invites: Number(invites.rows[0]!.n), sessions: Number(sessions.rows[0]!.n) };
};

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env["DATABASE_URL"] = url;
  // The portal defaults OFF everywhere, non-production included
  // (vendorPortalFeatureFlag.ts) — off means a bare 404 before any handler.
  process.env["SECURELOGIC_VENDOR_PORTAL_ENABLED"] = "true";
  pool = new Pool({ connectionString: url });

  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(enforceJsonContentType);
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
});

afterAll(async () => {
  await pool.end();
});

describe("WA-1 ruling 3 — an answer that needs words cannot be submitted without them", () => {
  it("refuses a `partial` with no explanation, and names the item", async () => {
    const f = await seedIssued(seed.orgA.id, "wa1-partial");
    const cookie = await sessionCookie(f.token);
    const saved = await answer(cookie, f.requirements[0]!, { answer: "partial" });
    // The SAVE is permissive on purpose: a vendor must be able to choose the
    // answer and then type why. The gate is at submit.
    expect(saved.status).toBe(200);

    const res = await submit(cookie);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("incomplete");
    expect(res.body.explanations_missing).toBe(1);
    expect(res.body.unanswered_required).toBe(0);
    expect(res.body.items).toEqual([
      {
        requirement_id: f.requirements[0],
        reference: "wa1-partial-REQ-0",
        reason: "explanation_missing",
      },
    ]);
    expect(res.body.message).toMatch(/need an explanation/i);
    // Refused means REFUSED: the authoritative state did not move.
    expect(await statusOf(f.engagementId)).toBe("in_progress");
  });

  it("refuses `fail` and `not_applicable` with no explanation", async () => {
    for (const value of ["fail", "not_applicable"]) {
      const f = await seedIssued(seed.orgA.id, `wa1-${value}`);
      const cookie = await sessionCookie(f.token);
      await answer(cookie, f.requirements[0]!, { answer: value });
      const res = await submit(cookie);
      expect(res.status, `${value} should be refused`).toBe(422);
      expect(res.body.explanations_missing).toBe(1);
    }
  });

  it("treats whitespace as no explanation", async () => {
    const f = await seedIssued(seed.orgA.id, "wa1-blank");
    const cookie = await sessionCookie(f.token);
    await answer(cookie, f.requirements[0]!, { answer: "fail", notes: "    \n  " });
    const res = await submit(cookie);
    expect(res.status).toBe(422);
    expect(res.body.explanations_missing).toBe(1);
  });

  it("accepts the same answers once they are explained", async () => {
    const f = await seedIssued(seed.orgA.id, "wa1-explained", { items: 3 });
    const cookie = await sessionCookie(f.token);
    await answer(cookie, f.requirements[0]!, { answer: "partial", notes: "MFA on admins only." });
    await answer(cookie, f.requirements[1]!, { answer: "fail", notes: "No process; Q3 plan." });
    await answer(cookie, f.requirements[2]!, {
      answer: "not_applicable",
      notes: "We process no personal data for this service.",
    });

    const res = await submit(cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await statusOf(f.engagementId)).toBe("submitted");
  });

  it("still lets an affirmative answer through with no explanation", async () => {
    // The rule must not become "explain everything": that trains vendors to
    // paste filler into 200 boxes, which is worse evidence than silence.
    const f = await seedIssued(seed.orgA.id, "wa1-pass");
    const cookie = await sessionCookie(f.token);
    await answer(cookie, f.requirements[0]!, { answer: "pass" });
    expect((await submit(cookie)).status).toBe(200);
  });

  it("keeps the shipped unanswered-mandatory guard, and reports both reasons apart", async () => {
    const f = await seedIssued(seed.orgA.id, "wa1-mixed", { items: 2 });
    const cookie = await sessionCookie(f.token);
    await answer(cookie, f.requirements[0]!, { answer: "fail" });
    // requirements[1] left unanswered.

    const res = await submit(cookie);
    expect(res.status).toBe(422);
    expect(res.body.unanswered_required).toBe(1);
    expect(res.body.explanations_missing).toBe(1);
    // Back-compatible: a client reading only the shipped keys still works.
    expect(res.body.error).toBe("incomplete");
  });

  it("requires an explanation on a `pass` only where the question's policy asks for more", async () => {
    const f = await seedIssued(seed.orgA.id, "wa1-policy", { evidencePolicy: "required_on_pass" });
    const cookie = await sessionCookie(f.token);
    await answer(cookie, f.requirements[0]!, { answer: "pass" });

    const refused = await submit(cookie);
    expect(refused.status).toBe(422);
    expect(refused.body.explanations_missing).toBe(1);

    // With words but no artifact, the SAME policy now blocks on the evidence.
    await answer(cookie, f.requirements[0]!, { answer: "pass", notes: "AES-256 at rest." });
    const stillRefused = await submit(cookie);
    expect(stillRefused.status).toBe(422);
    expect(stillRefused.body.evidence_missing).toBe(1);
    expect(stillRefused.body.items[0].reason).toBe("evidence_missing");
  });

  it("counts an attached artifact against the question it was attached to", async () => {
    const f = await seedIssued(seed.orgA.id, "wa1-evidence", { evidencePolicy: "required_always" });
    const cookie = await sessionCookie(f.token);
    await answer(cookie, f.requirements[0]!, { answer: "pass", notes: "See attached." });
    expect((await submit(cookie)).body.evidence_missing).toBe(1);

    // The CANONICAL evidence row, at the engagement x requirement grain the
    // portal upload writes (vendorPortal.ts uploadPortalEvidence). Inserted
    // directly rather than through the multipart route because blob storage is
    // not configured in the isolation harness — the storage path is owned by
    // vendorPortalUploadAdversarial; what is proven here is the GATE.
    await pool.query(
      `INSERT INTO evidence
         (organization_id, source_type, source_id, title, evidence_type, storage_key,
          original_filename, mime_type, byte_size, sha256, engagement_id, requirement_id)
       VALUES ($1, 'vendor_engagement', $2, 'SOC 2 Type II', 'document', $3,
               'soc2.pdf', 'application/pdf', 1024, $4, $2, $5)`,
      [seed.orgA.id, f.engagementId, `orgs/${seed.orgA.id}/evidence/wa1`, "a".repeat(64), f.requirements[0]]
    );

    const res = await submit(cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("reports the completeness contract on the read surface the vendor renders from", async () => {
    const f = await seedIssued(seed.orgA.id, "wa1-read", { items: 2 });
    const cookie = await sessionCookie(f.token);
    await answer(cookie, f.requirements[0]!, { answer: "partial" });

    const res = await questions(cookie);
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(
      (res.body.questions as Array<Record<string, unknown>>).map((q) => [q.requirement_id, q])
    );
    // Answered negatively -> the requirement is asserted.
    expect(byId[f.requirements[0]!]!.explanation_required).toBe(true);
    expect(byId[f.requirements[0]!]!.evidence_required).toBe(false);
    expect(byId[f.requirements[0]!]!.evidence_count).toBe(0);
    // UNANSWERED -> null, not false. The requirement is a property of the
    // answer, and asserting one before there is an answer would light the whole
    // form up before the vendor has done anything.
    expect(byId[f.requirements[1]!]!.explanation_required).toBeNull();
    expect(byId[f.requirements[1]!]!.evidence_policy).toBe("optional");
  });
});

describe("WA-1 ruling 6 — portal authorization ends at analysis_complete, engagement-scoped", () => {
  /** Drive the engagement to `submitted` with one explained answer. */
  async function submitted(orgId: string, label: string): Promise<Fixture & { cookie: string }> {
    const f = await seedIssued(orgId, label);
    const cookie = await sessionCookie(f.token);
    await answer(cookie, f.requirements[0]!, { answer: "pass", notes: "Implemented." });
    expect((await submit(cookie)).status).toBe(200);
    return { ...f, cookie };
  }

  const beginReview = (apiKey: string, id: string) =>
    request(app)
      .post(`/api/vendor-engagements/${id}/begin-review`)
      .set("X-Api-Key", apiKey)
      .send({});
  const completeAnalysis = (apiKey: string, id: string) =>
    request(app)
      .post(`/api/vendor-engagements/${id}/complete-analysis`)
      .set("X-Api-Key", apiKey)
      .send({});

  it("revokes the concluding engagement's invite and sessions, and says how many", async () => {
    const f = await submitted(seed.orgA.id, "wa1-conclude");
    expect(await liveCredentials(f.engagementId)).toEqual({ invites: 1, sessions: 1 });

    expect((await beginReview(seed.orgA.apiKey, f.engagementId)).status).toBe(200);
    const res = await completeAnalysis(seed.orgA.apiKey, f.engagementId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe("analysis_complete");
    expect(res.body.portal_access_revoked).toEqual({ invites: 1, sessions: 1 });

    expect(await liveCredentials(f.engagementId)).toEqual({ invites: 0, sessions: 0 });
  });

  it("makes the vendor's live cookie stop working immediately", async () => {
    const f = await submitted(seed.orgA.id, "wa1-cookie");
    // Reads still worked between submit and conclusion — that is the tail the
    // ruling closes.
    expect((await questions(f.cookie)).status).toBe(200);

    await beginReview(seed.orgA.apiKey, f.engagementId);
    await completeAnalysis(seed.orgA.apiKey, f.engagementId);

    expect((await questions(f.cookie)).status).toBe(401);
  });

  it("does not let a revoked invite mint a fresh session", async () => {
    // Revoking sessions alone would be theatre: the emailed link is still in an
    // inbox and would hand out a new one.
    const f = await submitted(seed.orgA.id, "wa1-remint");
    await beginReview(seed.orgA.apiKey, f.engagementId);
    await completeAnalysis(seed.orgA.apiKey, f.engagementId);

    const res = await request(app).post("/api/vendor-portal/session").send({ token: f.token });
    expect(res.status).toBe(401);
  });

  it("leaves the SAME contact's other active engagement untouched", async () => {
    // The ruling's other half: authorization is engagement-scoped, so
    // concluding one assessment must not evict a responder from another.
    const done = await submitted(seed.orgA.id, "wa1-scope-done");
    const other = await seedIssued(seed.orgA.id, "wa1-scope-other");
    const otherCookie = await sessionCookie(other.token);

    await beginReview(seed.orgA.apiKey, done.engagementId);
    await completeAnalysis(seed.orgA.apiKey, done.engagementId);

    expect(await liveCredentials(other.engagementId)).toEqual({ invites: 1, sessions: 1 });
    expect((await questions(otherCookie)).status).toBe(200);
    // And it is still WRITABLE — this is write authorization, not just a read.
    const w = await answer(otherCookie, other.requirements[0]!, {
      answer: "pass",
      notes: "Still working on the other assessment.",
    });
    expect(w.status).toBe(200);
  });

  it("leaves another organization's credentials alone", async () => {
    const a = await submitted(seed.orgA.id, "wa1-xorg-a");
    const b = await seedIssued(seed.orgB.id, "wa1-xorg-b");
    const bCookie = await sessionCookie(b.token);

    await beginReview(seed.orgA.apiKey, a.engagementId);
    await completeAnalysis(seed.orgA.apiKey, a.engagementId);

    expect(await liveCredentials(b.engagementId)).toEqual({ invites: 1, sessions: 1 });
    expect((await questions(bCookie)).status).toBe(200);
  });

  it("records the revocation on the analysis-completed audit event", async () => {
    const f = await submitted(seed.orgA.id, "wa1-audit");
    await beginReview(seed.orgA.apiKey, f.engagementId);
    await completeAnalysis(seed.orgA.apiKey, f.engagementId);

    // writeAuditEvent is fire-and-forget; wait for it rather than racing it.
    let payload: Record<string, unknown> | null = null;
    for (let i = 0; i < 120; i += 1) {
      const r = await pool.query<{ payload: Record<string, unknown> }>(
        `SELECT payload FROM security_audit_log
          WHERE resource_id = $1 AND event_type = 'vendor_engagement.analysis_completed'
          LIMIT 1`,
        [f.engagementId]
      );
      if (r.rowCount) {
        payload = r.rows[0]!.payload;
        break;
      }
      await new Promise((res) => setTimeout(res, 25));
    }
    expect(payload).not.toBeNull();
    expect(payload!.portal_invites_revoked).toBe(1);
    expect(payload!.portal_sessions_revoked).toBe(1);
  });
});

describe("WA-3 ruling 1 — the vendor is told WHY, never SecureLogic's rule id", () => {
  /**
   * A presentation-boundary change, so it is proven at the boundary: against a
   * real scope item whose stored `si.reasons` carries a rule_id, the portal
   * payload must contain the rationale and no internal identifier, and the
   * stored provenance must be exactly as it was.
   *
   * Both halves matter. Dropping the fields from the RESPONSE rather than only
   * from the markup is what stops a vendor reading them out of the network
   * tab; keeping them in the ROW is what preserves composition determinism,
   * analyst explainability and historical reconstruction.
   */
  it("serves the rationale, ships no rule_id, and leaves si.reasons untouched", async () => {
    const f = await seedIssued(seed.orgA.id, "wa3-reasons");
    const cookie = await sessionCookie(f.token);

    const before = await pool.query<{ reasons: unknown }>(
      `SELECT reasons FROM vendor_engagement_scope_items WHERE engagement_id = $1`,
      [f.engagementId]
    );
    // The fixture stores a real rule id, so neither assertion below is vacuous.
    expect(JSON.stringify(before.rows)).toContain("S1.baseline");

    const res = await request(app).get("/api/vendor-portal/questions").set("Cookie", cookie);
    expect(res.status).toBe(200);

    const wire = JSON.stringify(res.body);
    expect(wire).toContain("Baseline for this tier.");
    expect(wire).not.toContain("S1.baseline");
    expect(wire).not.toContain("rule_id");
    expect(wire).not.toContain("rule_family");

    const question = res.body.questions[0];
    expect(question.why_we_are_asking).toEqual([{ rationale: "Baseline for this tier." }]);

    // Reading the portal must not rewrite the provenance it read from.
    const after = await pool.query<{ reasons: unknown }>(
      `SELECT reasons FROM vendor_engagement_scope_items WHERE engagement_id = $1`,
      [f.engagementId]
    );
    expect(after.rows).toEqual(before.rows);
  });
});
