/**
 * vendorPortalAdversarial.test.ts — Stop Gate B evidence for the routes that
 * exist today (session exchange, sign-out, engagement read).
 *
 * The portal is the first unauthenticated write path in the platform that
 * touches tenant data, so this suite is written from the attacker's side: every
 * test is something someone would actually try.
 *
 * Run against a real Postgres with RLS enabled, because the properties under
 * test are database-layer ones. A mocked cross-tenant probe proves nothing.
 *
 * NOTE ON COVERAGE: evidence-upload and comment routes are not built yet, so
 * upload-abuse cases (oversize, MIME mismatch, traversal, zip bomb, quota race)
 * are absent. Stop Gate B is NOT passed until those land with their own cases —
 * and it also requires an independent security review and a real external tester
 * on staging, neither of which a test file can provide.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import {
  hashPortalToken,
  generatePortalToken,
  PORTAL_SESSION_COOKIE,
} from "../../src/api/lib/vendorPortal/portalTokens.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

/** Raw invite tokens per org — these are what a vendor receives by email. */
const tokens: Record<string, string> = {};
const engagements: Record<string, string> = {};
const requirements: Record<string, string> = {};

async function seedEngagementWithInvite(
  orgId: string,
  label: string,
  opts: { expiresInMs?: number; revoked?: boolean; withQuestion?: boolean } = {}
): Promise<{ engagementId: string; token: string; requirementId: string }> {
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
       (organization_id, engagement_id, invite_token_hash, contact_email,
        expires_at, revoked_at, revocation_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      orgId,
      engagementId,
      hashPortalToken(token),
      `${label}@example.com`,
      new Date(Date.now() + (opts.expiresInMs ?? 30 * 24 * 3600_000)),
      opts.revoked ? new Date() : null,
      opts.revoked ? "revoked for test" : null,
    ]
  );

  // A framework + requirement + FROZEN scope item, so the questionnaire routes
  // have something real to serve. `reference_id` carries the org label so a
  // cross-tenant leak is unmistakable in the assertion output.
  const fw = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version) VALUES ($1, $2, '1.0') RETURNING id`,
    [orgId, `${label} framework`]
  );
  const req = await pool.query<{ id: string }>(
    `INSERT INTO requirements (framework_id, reference_id, title, description)
     VALUES ($1, $2, $3, 'Guidance text.') RETURNING id`,
    [fw.rows[0]!.id, `${label}-REQ`, `${label} requirement`]
  );
  const requirementId = req.rows[0]!.id;

  await pool.query(
    `INSERT INTO vendor_engagement_scope_items
       (organization_id, engagement_id, requirement_id, depth, mandatory, source, reasons)
     VALUES ($1, $2, $3, 'full', TRUE, 'deterministic', $4::jsonb)`,
    [
      orgId,
      engagementId,
      requirementId,
      JSON.stringify([
        { rule_id: "S1.baseline", rule_family: "S1", rationale: "Baseline for this tier." },
      ]),
    ]
  );

  return { engagementId, token, requirementId };
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the portal adversarial test.");
  process.env.DATABASE_URL = url;
  process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "true";
  pool = new Pool({ connectionString: url, ssl: false });

  const a = await seedEngagementWithInvite(seed.orgA.id, "A-ONLY-1");
  const b = await seedEngagementWithInvite(seed.orgB.id, "B-SECRET-1");
  tokens.a = a.token;
  tokens.b = b.token;
  engagements.a = a.engagementId;
  engagements.b = b.engagementId;
  requirements.a = a.requirementId;
  requirements.b = b.requirementId;

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

beforeEach(() => {
  process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "true";
});

/** Exchange an invite token and return the session cookie. */
async function sessionCookie(token: string): Promise<string> {
  const res = await request(app).post("/api/vendor-portal/session").send({ token });
  expect(res.status, `exchange failed: ${JSON.stringify(res.body)}`).toBe(200);
  const raw = res.headers["set-cookie"] as unknown as string[];
  const cookie = raw.find((c) => c.startsWith(PORTAL_SESSION_COOKIE));
  expect(cookie, "no portal cookie was set").toBeTruthy();
  return cookie!.split(";")[0]!;
}

// ─── The exchange ───────────────────────────────────────────────────────────

describe("Stop Gate B — invite exchange", () => {
  it("a valid invite yields a session, and the raw token is NEVER echoed", async () => {
    const res = await request(app).post("/api/vendor-portal/session").send({ token: tokens.a });
    expect(res.status).toBe(200);
    // The secret lives only in the cookie. Echoing it would put it back in a
    // place the client might log or render — the exact thing the exchange exists
    // to prevent.
    expect(JSON.stringify(res.body)).not.toContain(tokens.a!);
    expect(res.body).toEqual({ ok: true });
  });

  it("the cookie is httpOnly and PATH-SCOPED to the portal API mount", async () => {
    const res = await request(app).post("/api/vendor-portal/session").send({ token: tokens.a });
    const cookie = (res.headers["set-cookie"] as unknown as string[]).find((c) =>
      c.startsWith(PORTAL_SESSION_COOKIE)
    )!;
    expect(cookie).toMatch(/HttpOnly/i);
    // Must sit UNDER the real route mount (/api/vendor-portal): RFC 6265 sends
    // a cookie only to requests under its path, so any other value means a
    // browser never attaches it and every authenticated portal call 401s.
    expect(cookie).toMatch(/Path=\/api\/vendor-portal/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("the cookie value is NOT the invite token", async () => {
    const cookie = await sessionCookie(tokens.a!);
    expect(cookie).not.toContain(tokens.a!);
  });

  it("an unknown token is refused", async () => {
    const res = await request(app)
      .post("/api/vendor-portal/session")
      .send({ token: generatePortalToken() });
    expect(res.status).toBe(401);
  });

  it("a malformed / missing token is refused without a stack trace", async () => {
    for (const body of [{}, { token: "" }, { token: 123 }, { token: null }]) {
      const res = await request(app).post("/api/vendor-portal/session").send(body);
      expect(res.status).toBe(401);
      expect(JSON.stringify(res.body)).not.toMatch(/stack|at Object|node_modules/i);
    }
  });

  it("a REVOKED invite is refused, indistinguishably from an unknown one", async () => {
    const revoked = await seedEngagementWithInvite(seed.orgA.id, "REVOKED", { revoked: true });
    const res = await request(app).post("/api/vendor-portal/session").send({ token: revoked.token });
    const unknown = await request(app)
      .post("/api/vendor-portal/session")
      .send({ token: generatePortalToken() });

    expect(res.status).toBe(unknown.status);
    expect(res.body).toEqual(unknown.body);
  });

  it("an EXPIRED invite says so — actionable, and not a useful oracle", async () => {
    // An attacker holding a valid 256-bit token learns nothing from being told
    // it aged out; a legitimate vendor needs to know to ask for a new link.
    const expired = await seedEngagementWithInvite(seed.orgA.id, "EXPIRED", { expiresInMs: -1000 });
    const res = await request(app).post("/api/vendor-portal/session").send({ token: expired.token });
    expect(res.status).toBe(410);
    expect(res.body.error).toBe("portal_link_expired");
  });

  it("records the exchange on the invite for audit", async () => {
    const fresh = await seedEngagementWithInvite(seed.orgA.id, "COUNTED");
    await sessionCookie(fresh.token);
    const row = await pool.query<{ exchange_count: number; first_exchanged_at: string | null }>(
      `SELECT exchange_count, first_exchanged_at FROM vendor_engagement_invites
        WHERE invite_token_hash = $1`,
      [hashPortalToken(fresh.token)]
    );
    expect(row.rows[0]!.exchange_count).toBe(1);
    expect(row.rows[0]!.first_exchanged_at).not.toBeNull();
  });
});

// ─── Cross-tenant ───────────────────────────────────────────────────────────

describe("Stop Gate B — a portal session reaches EXACTLY one engagement", () => {
  it("org A's session sees org A's engagement", async () => {
    const cookie = await sessionCookie(tokens.a!);
    const res = await request(app).get("/api/vendor-portal/engagement").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.vendor_name).toMatch(/A-ONLY-1/);
  });

  it("org A's session NEVER sees org B's data", async () => {
    const cookie = await sessionCookie(tokens.a!);
    const res = await request(app).get("/api/vendor-portal/engagement").set("Cookie", cookie);
    expect(JSON.stringify(res.body)).not.toMatch(/B-SECRET-1/);
  });

  it("and org B's session sees only its own — the previous test is not vacuous", async () => {
    const cookie = await sessionCookie(tokens.b!);
    const res = await request(app).get("/api/vendor-portal/engagement").set("Cookie", cookie);
    expect(res.body.vendor_name).toMatch(/B-SECRET-1/);
    expect(JSON.stringify(res.body)).not.toMatch(/A-ONLY-1/);
  });

  it("supplying another engagement's id as a PARAMETER changes nothing", async () => {
    // There is no parameter to supply — but a caller (or an attacker probing the
    // shape) will try anyway. Identity comes from the session row.
    const cookie = await sessionCookie(tokens.a!);
    const res = await request(app)
      .get("/api/vendor-portal/engagement")
      .query({
        engagement_id: engagements.b,
        engagementId: engagements.b,
        organization_id: seed.orgB.id,
      })
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/B-SECRET-1/);
  });

  it("the response never leaks internal risk data to the vendor", async () => {
    // A vendor is shown who is asking and what state the request is in — never
    // ratings, findings, reviewer identities, or other vendors.
    const cookie = await sessionCookie(tokens.a!);
    const res = await request(app).get("/api/vendor-portal/engagement").set("Cookie", cookie);
    const keys = Object.keys(res.body);
    for (const forbidden of [
      "residual_rating", "residual_score", "inherent_rating", "inherent_score",
      "decision", "findings", "organization_id", "vendor_id", "engagement_id",
    ]) {
      expect(keys, `leaked ${forbidden}`).not.toContain(forbidden);
    }
  });
});

// ─── Session credentials ────────────────────────────────────────────────────

describe("Stop Gate B — session credentials", () => {
  it("no cookie is refused", async () => {
    const res = await request(app).get("/api/vendor-portal/engagement");
    expect(res.status).toBe(401);
  });

  it("a forged cookie is refused", async () => {
    const res = await request(app)
      .get("/api/vendor-portal/engagement")
      .set("Cookie", `${PORTAL_SESSION_COOKIE}=${generatePortalToken()}`);
    expect(res.status).toBe(401);
  });

  it("a REVOKED session stops working immediately — the kill switch", async () => {
    const cookie = await sessionCookie(tokens.a!);
    expect((await request(app).get("/api/vendor-portal/engagement").set("Cookie", cookie)).status).toBe(200);

    // Mass revocation: one UPDATE, as an operator would run it.
    await pool.query(
      `UPDATE vendor_portal_sessions SET revoked_at = NOW() WHERE engagement_id = $1`,
      [engagements.a]
    );

    const after = await request(app).get("/api/vendor-portal/engagement").set("Cookie", cookie);
    expect(after.status).toBe(401);
  });

  it("signing out revokes the session so the cookie cannot be replayed", async () => {
    const fresh = await seedEngagementWithInvite(seed.orgA.id, "SIGNOUT");
    const cookie = await sessionCookie(fresh.token);

    expect((await request(app).delete("/api/vendor-portal/session").set("Cookie", cookie)).status).toBe(200);
    const replay = await request(app).get("/api/vendor-portal/engagement").set("Cookie", cookie);
    expect(replay.status).toBe(401);
  });

  it("a session token is NEVER stored raw — the DB holds only hashes", async () => {
    const fresh = await seedEngagementWithInvite(seed.orgA.id, "HASHONLY");
    const cookie = await sessionCookie(fresh.token);
    const rawValue = cookie.split("=")[1]!;

    const rows = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM vendor_portal_sessions WHERE session_token_hash = $1`,
      [rawValue]
    );
    // The raw value must match NOTHING; only its hash is stored.
    expect(rows.rows[0]!.n).toBe("0");

    const byHash = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM vendor_portal_sessions WHERE session_token_hash = $1`,
      [hashPortalToken(rawValue)]
    );
    expect(byHash.rows[0]!.n).toBe("1");
  });
});

// ─── The kill switch ────────────────────────────────────────────────────────

describe("Stop Gate B — the flag is a real kill switch", () => {
  it("OFF 404s every portal route, including the exchange", async () => {
    process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "false";

    const exchange = await request(app).post("/api/vendor-portal/session").send({ token: tokens.a });
    expect(exchange.status).toBe(404);

    const read = await request(app).get("/api/vendor-portal/engagement");
    expect(read.status).toBe(404);
  });

  it("OFF is the DEFAULT — an unset variable does not open the boundary", async () => {
    // Unlike vendorAssuranceFeatureFlag, which opens off-production. An external
    // write path must never be open by accident on a dev box or preview env.
    delete process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED;
    const res = await request(app).post("/api/vendor-portal/session").send({ token: tokens.a });
    expect(res.status).toBe(404);
  });

  it("turning it back ON restores service with no data change", async () => {
    process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "true";
    const fresh = await seedEngagementWithInvite(seed.orgA.id, "RESTORED");
    const res = await request(app).post("/api/vendor-portal/session").send({ token: fresh.token });
    expect(res.status).toBe(200);
  });
});

// ─── Auth-world separation ──────────────────────────────────────────────────

// ─── IDOR across the questionnaire ──────────────────────────────────────────

describe("Stop Gate B — IDOR sweep across questionnaire objects", () => {
  it("a vendor sees ONLY their own engagement's questions", async () => {
    const cookieA = await sessionCookie(tokens.a!);
    const res = await request(app).get("/api/vendor-portal/questions").set("Cookie", cookieA);
    expect(res.status).toBe(200);
    const refs = (res.body.questions as Array<{ reference: string }>).map((q) => q.reference);
    expect(refs.some((r) => r.includes("A-ONLY-1"))).toBe(true);
    expect(refs.some((r) => r.includes("B-SECRET-1"))).toBe(false);
  });

  it("and org B sees only theirs — the previous test is not vacuous", async () => {
    const cookieB = await sessionCookie(tokens.b!);
    const res = await request(app).get("/api/vendor-portal/questions").set("Cookie", cookieB);
    const refs = (res.body.questions as Array<{ reference: string }>).map((q) => q.reference);
    expect(refs.some((r) => r.includes("B-SECRET-1"))).toBe(true);
    expect(refs.some((r) => r.includes("A-ONLY-1"))).toBe(false);
  });

  it("answering ANOTHER engagement's requirement by id is refused", async () => {
    // The core IDOR. The requirement genuinely exists — it is simply not in this
    // engagement's frozen scope.
    const cookieA = await sessionCookie(tokens.a!);
    const res = await request(app)
      .put(`/api/vendor-portal/questions/${requirements.b}`)
      .set("Cookie", cookieA)
      .send({ answer: "pass" });
    expect(res.status).toBe(404);
  });

  it("not-in-scope is INDISTINGUISHABLE from does-not-exist", async () => {
    // Otherwise a vendor could probe which requirements another engagement covers.
    const cookieA = await sessionCookie(tokens.a!);
    const real = await request(app)
      .put(`/api/vendor-portal/questions/${requirements.b}`)
      .set("Cookie", cookieA)
      .send({ answer: "pass" });
    const fake = await request(app)
      .put("/api/vendor-portal/questions/00000000-0000-4000-8000-000000000000")
      .set("Cookie", cookieA)
      .send({ answer: "pass" });
    expect(real.status).toBe(fake.status);
    expect(real.body).toEqual(fake.body);
  });

  it("an answer is never written under another org", async () => {
    const cookieA = await sessionCookie(tokens.a!);
    await request(app)
      .put(`/api/vendor-portal/questions/${requirements.a}`)
      .set("Cookie", cookieA)
      .send({ answer: "pass", organization_id: seed.orgB.id, engagement_id: engagements.b });

    const leaked = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM requirement_responses
        WHERE organization_id = $1 AND responder_type = 'vendor'`,
      [seed.orgB.id]
    );
    expect(leaked.rows[0]!.n).toBe("0");
  });
});

// ─── The structured-answer contract ─────────────────────────────────────────

describe("Stop Gate B — a structured answer is REQUIRED", () => {
  it("rejects free text with no structured answer", async () => {
    // The effectiveness ladder consumes this value deterministically. Prose
    // alone would make effectiveness un-computable without an LLM and break the
    // LLM-independence invariant.
    const cookie = await sessionCookie(tokens.a!);
    const res = await request(app)
      .put(`/api/vendor-portal/questions/${requirements.a}`)
      .set("Cookie", cookie)
      .send({ notes: "We do this, mostly." });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_answer");
  });

  it("rejects an answer outside the closed vocabulary", async () => {
    const cookie = await sessionCookie(tokens.a!);
    for (const answer of ["yes", "PASS", "true", "", "compliant"]) {
      const res = await request(app)
        .put(`/api/vendor-portal/questions/${requirements.a}`)
        .set("Cookie", cookie)
        .send({ answer });
      expect(res.status, `accepted ${answer}`).toBe(400);
    }
  });

  it("accepts each legal answer and records a revision every time", async () => {
    const cookie = await sessionCookie(tokens.a!);
    for (const answer of ["pass", "partial", "fail", "not_applicable"]) {
      const res = await request(app)
        .put(`/api/vendor-portal/questions/${requirements.a}`)
        .set("Cookie", cookie)
        .send({ answer });
      expect(res.status, `rejected ${answer}`).toBe(200);
    }
    // Four saves, four revisions — the history the old destructive upsert could
    // not provide.
    const revs = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
         FROM requirement_response_revisions rev
         JOIN requirement_responses rr ON rr.id = rev.response_id
        WHERE rr.requirement_id = $1 AND rr.engagement_id = $2`,
      [requirements.a, engagements.a]
    );
    expect(Number(revs.rows[0]!.n)).toBeGreaterThanOrEqual(4);
  });
});

// ─── State machine + post-submit ────────────────────────────────────────────

describe("Stop Gate B — the state machine bounds what a vendor can do", () => {
  it("submitting with a required question unanswered is refused", async () => {
    const fresh = await seedEngagementWithInvite(seed.orgA.id, "INCOMPLETE", { withQuestion: true });
    const cookie = await sessionCookie(fresh.token);
    const res = await request(app).post("/api/vendor-portal/submit").set("Cookie", cookie);
    expect(res.status).toBe(422);
    expect(res.body.unanswered_required).toBeGreaterThan(0);
  });

  it("submitting once complete moves the engagement to submitted", async () => {
    const fresh = await seedEngagementWithInvite(seed.orgA.id, "COMPLETE", { withQuestion: true });
    const cookie = await sessionCookie(fresh.token);
    await request(app)
      .put(`/api/vendor-portal/questions/${fresh.requirementId}`)
      .set("Cookie", cookie)
      .send({ answer: "pass" });

    const res = await request(app).post("/api/vendor-portal/submit").set("Cookie", cookie);
    expect(res.status).toBe(200);

    const state = await pool.query<{ status: string }>(
      `SELECT status FROM vendor_engagements WHERE id = $1`,
      [fresh.engagementId]
    );
    expect(state.rows[0]!.status).toBe("submitted");
  });

  it("POST-SUBMIT WRITES ARE REFUSED — evidence that can still change is not evidence", async () => {
    const fresh = await seedEngagementWithInvite(seed.orgA.id, "LOCKED", { withQuestion: true });
    const cookie = await sessionCookie(fresh.token);
    await request(app)
      .put(`/api/vendor-portal/questions/${fresh.requirementId}`)
      .set("Cookie", cookie)
      .send({ answer: "pass" });
    await request(app).post("/api/vendor-portal/submit").set("Cookie", cookie);

    const after = await request(app)
      .put(`/api/vendor-portal/questions/${fresh.requirementId}`)
      .set("Cookie", cookie)
      .send({ answer: "fail" });
    expect(after.status).toBe(409);
    expect(after.body.error).toBe("responses_closed");
  });

  it("an answer edit during clarification_requested SAVES and resumes the engagement", async () => {
    // The state exists to invite exactly this edit: the reviewer asked the
    // vendor to change an answer, and the state machine's
    // clarification_requested -> in_progress transition is caused by the write.
    // Regression: this route once gated on the narrow write window and 409'd
    // every answer edit during a clarification, leaving evidence uploads as the
    // only way to reopen the engagement.
    const fresh = await seedEngagementWithInvite(seed.orgA.id, "CLARIFY", { withQuestion: true });
    const cookie = await sessionCookie(fresh.token);
    await request(app)
      .put(`/api/vendor-portal/questions/${fresh.requirementId}`)
      .set("Cookie", cookie)
      .send({ answer: "pass" });
    await pool.query(`UPDATE vendor_engagements SET status = 'clarification_requested' WHERE id = $1`, [
      fresh.engagementId,
    ]);

    const edit = await request(app)
      .put(`/api/vendor-portal/questions/${fresh.requirementId}`)
      .set("Cookie", cookie)
      .send({ answer: "fail", notes: "Corrected after the reviewer's question." });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);

    const after = await pool.query<{ status: string }>(
      `SELECT status FROM vendor_engagements WHERE id = $1`,
      [fresh.engagementId]
    );
    expect(after.rows[0]!.status).toBe("in_progress");
  });

  it("double submission is refused rather than silently repeated", async () => {
    const fresh = await seedEngagementWithInvite(seed.orgA.id, "DOUBLE", { withQuestion: true });
    const cookie = await sessionCookie(fresh.token);
    await request(app)
      .put(`/api/vendor-portal/questions/${fresh.requirementId}`)
      .set("Cookie", cookie)
      .send({ answer: "pass" });
    expect((await request(app).post("/api/vendor-portal/submit").set("Cookie", cookie)).status).toBe(200);
    expect((await request(app).post("/api/vendor-portal/submit").set("Cookie", cookie)).status).toBe(409);
  });

  it("a vendor cannot drive the engagement past submitted", async () => {
    // The state machine permits a portal actor exactly three transitions. There
    // is no route to a decision, and there must never be one.
    const cookie = await sessionCookie(tokens.a!);
    for (const path of ["/api/vendor-portal/decide", "/api/vendor-portal/approve"]) {
      const res = await request(app).post(path).set("Cookie", cookie).send({});
      expect([404, 405]).toContain(res.status);
    }
  });
});

describe("Stop Gate B — the two authentication worlds cannot mix", () => {
  it("a portal session cannot reach a normal authenticated API route", async () => {
    const cookie = await sessionCookie(tokens.a!);
    for (const route of ["/api/vendors", "/api/findings", "/api/risks", "/api/ask"]) {
      const res = await request(app).get(route).set("Cookie", cookie);
      expect([401, 403, 404], `${route} accepted a portal cookie`).toContain(res.status);
    }
  });

  it("an org API key cannot drive a portal route", async () => {
    // The reverse direction. requirePortalSession reads a cookie and nothing
    // else, so an API key is simply not a portal credential.
    const res = await request(app)
      .get("/api/vendor-portal/engagement")
      .set("x-api-key", seed.orgA.apiKey);
    expect(res.status).toBe(401);
  });
});
