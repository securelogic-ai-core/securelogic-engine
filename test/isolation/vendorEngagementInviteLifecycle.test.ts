/**
 * vendorEngagementInviteLifecycle.test.ts — VA-L1 (authorized 2026-08-23):
 * the invite finally has a lifecycle, proven end-to-end over HTTP against
 * real Postgres.
 *
 * The owner ruling under test: ACCESS IS REVOKED, HISTORY IS PRESERVED.
 *   - revoke kills the invite AND its live sessions immediately (the portal
 *     middleware re-checks session revocation on every request),
 *   - a revoked invite exchanges like a token that never existed (no oracle),
 *   - answers, revisions and audit rows survive revocation untouched,
 *   - re-issue mints a replacement (the resend path — only a hash survives
 *     issuance) and kills every prior credential,
 *   - an EXPIRED invite no longer strands the engagement — re-issue recovers,
 *   - none of it crosses a tenant boundary,
 *   - and no customer-facing read ever contains token material.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import cookieParser from "cookie-parser";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import {
  PORTAL_SESSION_COOKIE,
  mintSessionToken,
} from "../../src/api/lib/vendorPortal/portalTokens.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

let engagementA: string; // the main lifecycle subject (org A)
let engagementExpired: string; // org A, invite aged out — the recovery case
let requirementId: string;

async function seedScopedEngagement(orgId: string, label: string): Promise<string> {
  const vendor = await seedVendor(pool, orgId, { name: `${label} vendor` });
  const eng = await pool.query<{ id: string }>(
    `INSERT INTO vendor_engagements
       (organization_id, vendor_id, engagement_type, status,
        methodology_version, scope_rule_version, inherent_rating)
     VALUES ($1, $2, 'initial', 'scoped', '1.0.0', '1.0.0', 'Moderate')
     RETURNING id`,
    [orgId, vendor]
  );
  const engagementId = eng.rows[0]!.id;
  await pool.query(
    `INSERT INTO vendor_engagement_scope_items
       (organization_id, engagement_id, requirement_id, mandatory, source)
     VALUES ($1, $2, $3, TRUE, 'deterministic')`,
    [orgId, engagementId, requirementId]
  );
  return engagementId;
}

const issue = (key: string, id: string, email: string) =>
  request(app)
    .post(`/api/vendor-engagements/${id}/issue`)
    .set("X-Api-Key", key)
    .send({ contact_email: email, contact_name: "Jane Lifecycle" });
const revoke = (key: string, id: string, reason?: string) =>
  request(app)
    .post(`/api/vendor-engagements/${id}/invite/revoke`)
    .set("X-Api-Key", key)
    .send(reason ? { reason } : {});
const reissue = (key: string, id: string, email: string) =>
  request(app)
    .post(`/api/vendor-engagements/${id}/invite/reissue`)
    .set("X-Api-Key", key)
    .send({ contact_email: email });
const getDetail = (key: string, id: string) =>
  request(app).get(`/api/vendor-engagements/${id}`).set("X-Api-Key", key);
const exchange = (token: string) =>
  request(app).post("/api/vendor-portal/session").send({ token });

async function sessionCookieFor(token: string): Promise<string> {
  const res = await exchange(token);
  expect(res.status, `exchange failed: ${JSON.stringify(res.body)}`).toBe(200);
  const raw = res.headers["set-cookie"] as unknown as string[];
  const cookie = raw.find((c) => c.startsWith(PORTAL_SESSION_COOKIE));
  expect(cookie, "no portal cookie was set").toBeTruthy();
  return cookie!.split(";")[0]!;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env.DATABASE_URL = url;
  process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "true";
  process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED = "true";
  pool = new Pool({ connectionString: url, ssl: false });

  const framework = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version)
     VALUES ($1, 'Lifecycle Harness Framework', '1.0') RETURNING id`,
    [seed.orgA.id]
  );
  const r = await pool.query<{ id: string }>(
    `INSERT INTO requirements (framework_id, reference_id, title)
     VALUES ($1, 'LIFE-1', 'LIFE-1 control') RETURNING id`,
    [framework.rows[0]!.id]
  );
  requirementId = r.rows[0]!.id;

  engagementA = await seedScopedEngagement(seed.orgA.id, "Lifecycle A");
  engagementExpired = await seedScopedEngagement(seed.orgA.id, "Lifecycle expired");

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
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

let firstToken: string;
let firstCookie: string;
let secondToken: string;

describe("VA-L1 — invitation lifecycle: access revoked, history preserved", () => {
  it("issue reports email delivery truthfully (flag unset → disabled) and the customer can see invite status", async () => {
    const res = await issue(seed.orgA.apiKey, engagementA, "jane@vendor.example");
    expect(res.status).toBe(200);
    expect(res.body.invite_token).toBeTruthy();
    // No send site is armed in this environment — the route says so instead
    // of implying an email happened.
    expect(res.body.email_delivery).toBe("disabled");
    firstToken = res.body.invite_token;

    const detail = await getDetail(seed.orgA.apiKey, engagementA);
    expect(detail.status).toBe(200);
    expect(detail.body.invite.active).toMatchObject({
      contact_email: "jane@vendor.example",
      exchange_count: 0,
      revoked_at: null,
    });
    expect(detail.body.invite.active.first_exchanged_at).toBeNull();
    // Token material never appears in a customer read.
    expect(JSON.stringify(detail.body)).not.toContain(firstToken);
    expect(JSON.stringify(detail.body)).not.toContain("token_hash");
  });

  it("the vendor answers; opening the link shows up in invite status", async () => {
    firstCookie = await sessionCookieFor(firstToken);
    const save = await request(app)
      .put(`/api/vendor-portal/questions/${requirementId}`)
      .set("Cookie", firstCookie)
      .send({ answer: "fail", notes: "PRESERVE-ME answer before revocation" });
    expect(save.status).toBe(200);

    const detail = await getDetail(seed.orgA.apiKey, engagementA);
    expect(detail.body.invite.active.exchange_count).toBe(1);
    expect(detail.body.invite.active.first_exchanged_at).not.toBeNull();
  });

  it("revoke: the live session dies immediately, the token dies like it never existed, and every historical row survives", async () => {
    const res = await revoke(seed.orgA.apiKey, engagementA, "contact left the vendor");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, invites_revoked: 1, sessions_revoked: 1 });

    // Live session: immediate uniform 401 — the ruling's "terminate future
    // access", not eventual consistency.
    const afterRevoke = await request(app)
      .get("/api/vendor-portal/engagement")
      .set("Cookie", firstCookie);
    expect(afterRevoke.status).toBe(401);

    // The revoked token exchanges like an unknown one — no oracle.
    const reExchange = await exchange(firstToken);
    expect(reExchange.status).toBe(401);

    // History preserved: the answer, its revision, and the audit trail are
    // exactly as the vendor left them, still attributed to the invite.
    const answer = await pool.query<{ notes: string; answered_via_invite_id: string | null }>(
      `SELECT rr.notes, rr.answered_via_invite_id
         FROM requirement_responses rr
        WHERE rr.organization_id = $1 AND rr.engagement_id = $2`,
      [seed.orgA.id, engagementA]
    );
    expect(answer.rows[0]!.notes).toBe("PRESERVE-ME answer before revocation");
    expect(answer.rows[0]!.answered_via_invite_id).not.toBeNull();
    const revisions = await pool.query(
      `SELECT 1 FROM requirement_response_revisions rev
         JOIN requirement_responses rr ON rr.id = rev.response_id
        WHERE rev.organization_id = $1 AND rr.engagement_id = $2`,
      [seed.orgA.id, engagementA]
    );
    expect(revisions.rowCount).toBe(1);
    const audit = await pool.query<{ payload: { reason?: string } }>(
      `SELECT payload FROM security_audit_log
        WHERE organization_id = $1 AND event_type = 'vendor_engagement.invite_revoked'
          AND resource_id = $2`,
      [seed.orgA.id, engagementA]
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]!.payload.reason).toBe("contact left the vendor");
  });

  it("revoking again refuses: there is no active invite", async () => {
    const res = await revoke(seed.orgA.apiKey, engagementA);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("no_active_invite");
  });

  it("re-issue mints a working replacement; the engagement is un-stranded and the old token stays dead", async () => {
    const res = await reissue(seed.orgA.apiKey, engagementA, "robert@vendor.example");
    expect(res.status).toBe(200);
    expect(res.body.invite_token).toBeTruthy();
    expect(res.body.invite_token).not.toBe(firstToken);
    secondToken = res.body.invite_token;

    const cookie = await sessionCookieFor(secondToken);
    const view = await request(app)
      .get("/api/vendor-portal/engagement")
      .set("Cookie", cookie);
    expect(view.status).toBe(200);

    // The vendor's pre-revocation answer is still there for the new holder —
    // history survived the credential swap.
    const questions = await request(app)
      .get("/api/vendor-portal/questions")
      .set("Cookie", cookie);
    expect(JSON.stringify(questions.body)).toContain("PRESERVE-ME");

    const dead = await exchange(firstToken);
    expect(dead.status).toBe(401);

    const detail = await getDetail(seed.orgA.apiKey, engagementA);
    expect(detail.body.invite.active.contact_email).toBe("robert@vendor.example");
    expect(detail.body.invite.history_count).toBe(2);
  });

  it("an expired invite no longer strands the engagement: exchange 410s, re-issue recovers", async () => {
    const issued = await issue(seed.orgA.apiKey, engagementExpired, "old@vendor.example");
    expect(issued.status).toBe(200);
    await pool.query(
      `UPDATE vendor_engagement_invites SET expires_at = NOW() - INTERVAL '1 day'
        WHERE engagement_id = $1`,
      [engagementExpired]
    );
    const expired = await exchange(issued.body.invite_token);
    expect(expired.status).toBe(410);

    const recovered = await reissue(seed.orgA.apiKey, engagementExpired, "new@vendor.example");
    expect(recovered.status).toBe(200);
    const cookie = await sessionCookieFor(recovered.body.invite_token);
    const view = await request(app)
      .get("/api/vendor-portal/engagement")
      .set("Cookie", cookie);
    expect(view.status).toBe(200);
  });

  it("re-issue refuses states with nothing for a vendor to do", async () => {
    const draft = await seedScopedEngagement(seed.orgA.id, "Lifecycle never-issued");
    const res = await reissue(seed.orgA.apiKey, draft, "x@vendor.example");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("cannot_reissue");
  });

  it("revoking without a reason succeeds and records the default — the UI marks it optional", async () => {
    const eng = await seedScopedEngagement(seed.orgA.id, "Lifecycle no-reason");
    const issued = await issue(seed.orgA.apiKey, eng, "noreason@vendor.example");
    expect(issued.status).toBe(200);

    // The schema CHECKs that a revoked invite carries a non-empty reason; an
    // omitted reason must not become a 23514 the customer cannot act on.
    const res = await revoke(seed.orgA.apiKey, eng);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ ok: true, invites_revoked: 1 });

    const stored = await pool.query<{ revocation_reason: string }>(
      `SELECT revocation_reason FROM vendor_engagement_invites WHERE engagement_id = $1`,
      [eng]
    );
    expect(stored.rows[0]!.revocation_reason).toBe("revoked by customer");
    expect(await (await exchange(issued.body.invite_token)).status).toBe(401);
  });

  it("a session that races the revocation is still dead: the invite is authoritative", async () => {
    const eng = await seedScopedEngagement(seed.orgA.id, "Lifecycle race");
    const issued = await issue(seed.orgA.apiKey, eng, "race@vendor.example");
    const inviteRow = await pool.query<{ id: string }>(
      `SELECT id FROM vendor_engagement_invites WHERE engagement_id = $1`,
      [eng]
    );
    const inviteId = inviteRow.rows[0]!.id;
    expect(issued.status).toBe(200);

    const revoked = await revoke(seed.orgA.apiKey, eng, "racing revocation");
    expect(revoked.status).toBe(200);
    // Zero live sessions existed when the sweep ran...
    expect(revoked.body.sessions_revoked).toBe(0);

    // ...and now the exchange that read the invite BEFORE the revocation
    // committed lands its session row, exactly as the race would.
    const session = mintSessionToken();
    await pool.query(
      `INSERT INTO vendor_portal_sessions
         (organization_id, invite_id, engagement_id, session_token_hash,
          idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        seed.orgA.id,
        inviteId,
        eng,
        session.tokenHash,
        session.idleExpiresAt,
        session.absoluteExpiresAt,
      ]
    );

    const res = await request(app)
      .get("/api/vendor-portal/engagement")
      .set("Cookie", `${PORTAL_SESSION_COOKIE}=${session.token}`);
    expect(res.status).toBe(401);
  });

  it("cross-tenant: org B can neither revoke nor re-issue nor read org A's invite", async () => {
    const r1 = await revoke(seed.orgB.apiKey, engagementA);
    expect(r1.status).toBe(404);
    const r2 = await reissue(seed.orgB.apiKey, engagementA, "b@vendor.example");
    expect(r2.status).toBe(404);
    const r3 = await getDetail(seed.orgB.apiKey, engagementA);
    expect(r3.status).toBe(404);
    // And org A's replacement credential still works after the attempts.
    const cookie = await sessionCookieFor(secondToken);
    const view = await request(app)
      .get("/api/vendor-portal/engagement")
      .set("Cookie", cookie);
    expect(view.status).toBe(200);
  });
});
