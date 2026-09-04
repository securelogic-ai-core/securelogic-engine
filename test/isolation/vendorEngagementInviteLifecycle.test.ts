/**
 * vendorEngagementInviteLifecycle.test.ts — contact-based issuance, sent from
 * SecureLogic, with a lifecycle (goal §A/§B, 2026-09-04; lineage VA-L1).
 *
 * Proven end-to-end over HTTP against real Postgres:
 *   - the recipient is a canonical vendor CONTACT; the invite binds to it for
 *     provenance and keeps its own address/name snapshot;
 *   - the Vendor Contact and the portal credential stay separate concepts
 *     (deleting/editing neither rewrites the other);
 *   - the invitation is COMPOSED (message + due date) and SENT through the
 *     shared mailer; the row records what happened; dark = `disabled`;
 *   - a failed send never strands the issuance — reissue recovers;
 *   - duplicate prevention: one issue per engagement, one ACTIVE invite at a
 *     time; reissue supersedes and revokes prior sessions;
 *   - revocation kills access immediately, history survives;
 *   - nothing crosses a tenant boundary; no read carries token material.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import cookieParser from "cookie-parser";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { PORTAL_SESSION_COOKIE, mintSessionToken } from "../../src/api/lib/vendorPortal/portalTokens.js";
import { enforceJsonContentType } from "../../src/api/lib/contentTypeAllowlist.js";

// The shared mailer is mocked at the module boundary: this suite proves the
// INVITE path's contract with it (purpose, correlation, result handling) and
// what the invite row records; the transport has its own suites.
const { mockSendEmail } = vi.hoisted(() => ({ mockSendEmail: vi.fn() }));
vi.mock("../../src/api/infra/email.js", () => ({ sendEmail: mockSendEmail }));

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

let vendorA: string;
let vendorA2: string;
let vendorB: string;
let requirementId: string;
let contactJane: string;
let contactRaj: string;
let contactOtherVendor: string;
let contactOrgB: string;

async function seedScopedEngagement(orgId: string, vendorId: string, label: string): Promise<string> {
  const eng = await pool.query<{ id: string }>(
    `INSERT INTO vendor_engagements
       (organization_id, vendor_id, engagement_type, status, title,
        methodology_version, scope_rule_version, inherent_rating)
     VALUES ($1, $2, 'initial', 'scoped', $3, '1.0.0', '1.0.0', 'Moderate')
     RETURNING id`,
    [orgId, vendorId, label]
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

const post = (key: string, path: string, body: Record<string, unknown> = {}) =>
  request(app).post(path).set("X-Api-Key", key).send(body);
const issue = (key: string, id: string, body: Record<string, unknown>) =>
  post(key, `/api/vendor-engagements/${id}/issue`, body);
const reissue = (key: string, id: string, body: Record<string, unknown>) =>
  post(key, `/api/vendor-engagements/${id}/invite/reissue`, body);
const revoke = (key: string, id: string, reason?: string) =>
  post(key, `/api/vendor-engagements/${id}/invite/revoke`, reason ? { reason } : {});
const getDetail = (key: string, id: string) =>
  request(app).get(`/api/vendor-engagements/${id}`).set("X-Api-Key", key);
const exchange = (token: string) => request(app).post("/api/vendor-portal/session").send({ token });

async function sessionCookieFor(token: string): Promise<string> {
  const res = await exchange(token);
  expect(res.status, `exchange failed: ${JSON.stringify(res.body)}`).toBe(200);
  const raw = res.headers["set-cookie"] as unknown as string[];
  const cookie = raw.find((c) => c.startsWith(PORTAL_SESSION_COOKIE));
  expect(cookie, "no portal cookie was set").toBeTruthy();
  return cookie!.split(";")[0]!;
}

async function inviteRow(engagementId: string) {
  const r = await pool.query<{
    id: string; contact_id: string | null; contact_email: string; contact_name: string | null;
    message: string | null; due_date: string | null; email_delivery_state: string;
    email_provider_message_id: string | null; email_delivery_detail: string | null; revoked_at: string | null;
  }>(
    `SELECT id, contact_id, contact_email, contact_name, message, due_date::text AS due_date,
            email_delivery_state, email_provider_message_id, email_delivery_detail, revoked_at
       FROM vendor_engagement_invites WHERE engagement_id = $1 ORDER BY created_at DESC`,
    [engagementId]
  );
  return r.rows;
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

  vendorA = await seedVendor(pool, seed.orgA.id, { name: "Lifecycle vendor A" });
  vendorA2 = await seedVendor(pool, seed.orgA.id, { name: "Lifecycle other vendor A" });
  vendorB = await seedVendor(pool, seed.orgB.id, { name: "Lifecycle vendor B" });

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(enforceJsonContentType);
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));

  const c1 = await post(seed.orgA.apiKey, `/api/vendors/${vendorA}/contacts`, {
    full_name: "Jane Security", email: "jane@vendor.example", title: "CISO", contact_role: "security", is_primary_contact: true,
  });
  expect(c1.status, JSON.stringify(c1.body)).toBe(201);
  contactJane = c1.body.contact.id;
  const c2 = await post(seed.orgA.apiKey, `/api/vendors/${vendorA}/contacts`, {
    full_name: "Raj Privacy", email: "raj@vendor.example", contact_role: "privacy",
  });
  contactRaj = c2.body.contact.id;
  const c3 = await post(seed.orgA.apiKey, `/api/vendors/${vendorA2}/contacts`, {
    full_name: "Other Vendor Person", email: "other@vendor2.example", contact_role: "security",
  });
  contactOtherVendor = c3.body.contact.id;
  const c4 = await post(seed.orgB.apiKey, `/api/vendors/${vendorB}/contacts`, {
    full_name: "Org B Person", email: "b@vendorb.example", contact_role: "security",
  });
  contactOrgB = c4.body.contact.id;
}, 180_000);

afterAll(async () => {
  delete process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED;
  delete process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED;
  delete process.env.SECURELOGIC_VENDOR_INVITE_EMAIL_ENABLED;
  await pool?.end();
});

beforeEach(() => {
  process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "true";
  process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED = "true";
  mockSendEmail.mockReset();
  mockSendEmail.mockResolvedValue({ ok: true, id: "re_test_message" });
});

describe("contact-based issuance, sent from SecureLogic", () => {
  let engagement: string;
  let firstToken: string;

  it("issues to a directory CONTACT with a composed message and due date; the invite binds the contact and records `sent`", async () => {
    process.env.SECURELOGIC_VENDOR_INVITE_EMAIL_ENABLED = "true";
    engagement = await seedScopedEngagement(seed.orgA.id, vendorA, "Contact issuance");
    const res = await issue(seed.orgA.apiKey, engagement, {
      contact_id: contactJane,
      message: "Hello Jane,\n\nPlease complete our assessment.\n\nThanks",
      due_date: "2030-01-15",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      ok: true, status: "issued", contact_id: contactJane, contact_email: "jane@vendor.example",
      due_date: "2030-01-15", email_delivery: "sent", email_delivery_detail: null,
    });
    expect(res.body.invite_token).toBeTruthy();
    firstToken = res.body.invite_token;

    // The mailer was called ONCE, with the invite path's contract.
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const call = mockSendEmail.mock.calls[0]![0];
    expect(call.to).toBe("jane@vendor.example");
    expect(call.purpose).toBe("vendor.invite");
    expect(call.orgId).toBe(seed.orgA.id);
    expect(call.correlationId).toBe(res.body.invite_id);
    expect(call.html).toContain(`/portal/accept/${firstToken}`);
    expect(call.html).toContain("Please complete our assessment.");
    expect(call.subject).toContain("Lifecycle vendor A");

    const [row] = await inviteRow(engagement);
    expect(row).toMatchObject({
      contact_id: contactJane, contact_email: "jane@vendor.example", contact_name: "Jane Security",
      message: "Hello Jane,\n\nPlease complete our assessment.\n\nThanks", due_date: "2030-01-15",
      email_delivery_state: "sent", email_provider_message_id: "re_test_message",
    });

    const detail = await getDetail(seed.orgA.apiKey, engagement);
    expect(detail.status).toBe(200);
    expect(detail.body.invite.active).toMatchObject({
      contact_id: contactJane, contact_email: "jane@vendor.example", email_delivery_state: "sent",
      due_date: "2030-01-15", exchange_count: 0, revoked_at: null,
    });
    expect(detail.body.invite.history_count).toBe(1);
    const text = JSON.stringify(detail.body);
    expect(text).not.toContain(firstToken);
    expect(text).not.toContain("token_hash");
  });

  it("the vendor opens the link: the portal shows the customer's due date, and the customer sees the exchange", async () => {
    const cookie = await sessionCookieFor(firstToken);
    const view = await request(app).get("/api/vendor-portal/engagement").set("Cookie", cookie);
    expect(view.status).toBe(200);
    expect(view.body.due_date).toBe("2030-01-15");
    const save = await request(app)
      .put(`/api/vendor-portal/questions/${requirementId}`)
      .set("Cookie", cookie)
      .send({ answer: "pass", notes: "PRESERVE-ME" });
    expect(save.status).toBe(200);
    const detail = await getDetail(seed.orgA.apiKey, engagement);
    expect(detail.body.invite.active.exchange_count).toBe(1);
  });

  it("contact and credential stay separate: editing the contact never rewrites the invite snapshot; the contact cannot be deleted while an invite references it", async () => {
    const patch = await request(app)
      .patch(`/api/vendors/${vendorA}/contacts/${contactJane}`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ full_name: "Jane Renamed", email: "jane.renamed@vendor.example" });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    const [row] = await inviteRow(engagement);
    expect(row!.contact_email).toBe("jane@vendor.example");
    expect(row!.contact_name).toBe("Jane Security");
    expect(row!.contact_id).toBe(contactJane);
    const del = await request(app)
      .delete(`/api/vendors/${vendorA}/contacts/${contactJane}`)
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(del.status).toBe(409);
    expect(del.body.error).toBe("contact_in_use");
  });

  it("duplicate prevention: a second issue is refused by the lifecycle, and a contact of ANOTHER vendor or tenant is unaddressable", async () => {
    const again = await issue(seed.orgA.apiKey, engagement, { contact_id: contactRaj });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("cannot_issue");
    expect(await inviteRow(engagement)).toHaveLength(1);

    const fresh = await seedScopedEngagement(seed.orgA.id, vendorA, "Wrong contact");
    const otherVendor = await issue(seed.orgA.apiKey, fresh, { contact_id: contactOtherVendor });
    expect(otherVendor.status).toBe(404);
    expect(otherVendor.body.error).toBe("contact_not_found");
    const otherOrg = await issue(seed.orgA.apiKey, fresh, { contact_id: contactOrgB });
    expect(otherOrg.status).toBe(404);
    expect(await inviteRow(fresh)).toHaveLength(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("an inactive contact is refused with an actionable 409", async () => {
    const deact = await request(app)
      .patch(`/api/vendors/${vendorA}/contacts/${contactRaj}`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ status: "inactive" });
    expect(deact.status).toBe(200);
    const fresh = await seedScopedEngagement(seed.orgA.id, vendorA, "Inactive contact");
    const res = await issue(seed.orgA.apiKey, fresh, { contact_id: contactRaj });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("contact_inactive");
    await request(app)
      .patch(`/api/vendors/${vendorA}/contacts/${contactRaj}`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ status: "active" });
  });

  it("invitation composition is validated: a past due date and an oversized message are refused before anything is minted", async () => {
    const fresh = await seedScopedEngagement(seed.orgA.id, vendorA, "Bad composition");
    const past = await issue(seed.orgA.apiKey, fresh, { contact_id: contactJane, due_date: "2020-01-01" });
    expect(past.status).toBe(400);
    expect(past.body.error).toBe("due_date_in_past");
    const shape = await issue(seed.orgA.apiKey, fresh, { contact_id: contactJane, due_date: "next week" });
    expect(shape.status).toBe(400);
    expect(shape.body.error).toBe("invalid_due_date");
    const long = await issue(seed.orgA.apiKey, fresh, { contact_id: contactJane, message: "x".repeat(4001) });
    expect(long.status).toBe(400);
    expect(long.body.error).toBe("message_too_long");
    expect(await inviteRow(fresh)).toHaveLength(0);
    const status = await pool.query<{ status: string }>(`SELECT status FROM vendor_engagements WHERE id = $1`, [fresh]);
    expect(status.rows[0]!.status).toBe("scoped");
  });

  it("the default message is used when none is given, and a raw address still works for a customer without a directory entry", async () => {
    const fresh = await seedScopedEngagement(seed.orgA.id, vendorA, "Defaults");
    const res = await issue(seed.orgA.apiKey, fresh, { contact_email: "adhoc@vendor.example", contact_name: "Ad Hoc" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.contact_id).toBeNull();
    const [row] = await inviteRow(fresh);
    expect(row!.contact_id).toBeNull();
    expect(row!.message).toContain("Hello Ad,");
    expect(row!.message).toContain("Lifecycle vendor A has been selected for an assessment");
    expect(row!.email_delivery_state).toBe("sent");
  });
});

describe("delivery truthfulness and failed-send recovery", () => {
  it("dark flag: issuing works, the row records `disabled`, and the mailer is never called", async () => {
    delete process.env.SECURELOGIC_VENDOR_INVITE_EMAIL_ENABLED;
    const eng = await seedScopedEngagement(seed.orgA.id, vendorA, "Dark");
    const res = await issue(seed.orgA.apiKey, eng, { contact_id: contactJane });
    expect(res.status).toBe(200);
    expect(res.body.email_delivery).toBe("disabled");
    expect(res.body.invite_token).toBeTruthy();
    expect(mockSendEmail).not.toHaveBeenCalled();
    const [row] = await inviteRow(eng);
    expect(row!.email_delivery_state).toBe("disabled");
    // and the credential is real: the shown-once link is the delivery path
    expect((await exchange(res.body.invite_token)).status).toBe(200);
  });

  it("send_email:false is the explicit copy-link-only path and records `not_attempted`", async () => {
    process.env.SECURELOGIC_VENDOR_INVITE_EMAIL_ENABLED = "true";
    const eng = await seedScopedEngagement(seed.orgA.id, vendorA, "Copy link only");
    const res = await issue(seed.orgA.apiKey, eng, { contact_id: contactJane, send_email: false });
    expect(res.status).toBe(200);
    expect(res.body.email_delivery).toBe("not_attempted");
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("a provider failure never strands the issuance: the engagement is issued, the row says `failed`, and re-issue to the same contact recovers with a fresh send", async () => {
    process.env.SECURELOGIC_VENDOR_INVITE_EMAIL_ENABLED = "true";
    mockSendEmail.mockResolvedValueOnce({ ok: false, reason: "failed", detail: "provider 500" });
    const eng = await seedScopedEngagement(seed.orgA.id, vendorA, "Failed send");
    const res = await issue(seed.orgA.apiKey, eng, { contact_id: contactJane });
    expect(res.status).toBe(200);
    expect(res.body.email_delivery).toBe("failed");
    expect(res.body.email_delivery_detail).toBe("failed: provider 500");
    expect(res.body.invite_token).toBeTruthy();
    const status = await pool.query<{ status: string }>(`SELECT status FROM vendor_engagements WHERE id = $1`, [eng]);
    expect(status.rows[0]!.status).toBe("issued");
    let rows = await inviteRow(eng);
    expect(rows[0]!.email_delivery_state).toBe("failed");
    expect(rows[0]!.email_delivery_detail).toBe("failed: provider 500");

    // Recovery: resend = re-issue. Same contact, new credential, prior one revoked.
    const again = await reissue(seed.orgA.apiKey, eng, { contact_id: contactJane, message: "Second attempt" });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.email_delivery).toBe("sent");
    expect(again.body.prior_invites_revoked).toBe(1);
    expect(again.body.invite_token).not.toBe(res.body.invite_token);
    rows = await inviteRow(eng);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.email_delivery_state).toBe("sent");
    expect(rows[0]!.message).toBe("Second attempt");
    expect(rows[1]!.revoked_at).not.toBeNull();
    expect((await exchange(res.body.invite_token)).status).toBe(401);
    expect((await exchange(again.body.invite_token)).status).toBe(200);
    // the historical invite still names the contact it was for
    expect(rows[1]!.contact_id).toBe(contactJane);
  });

  it("a suppressed recipient is reported as `suppressed`, not silently `sent`", async () => {
    process.env.SECURELOGIC_VENDOR_INVITE_EMAIL_ENABLED = "true";
    mockSendEmail.mockResolvedValueOnce({ ok: false, reason: "suppressed" });
    const eng = await seedScopedEngagement(seed.orgA.id, vendorA, "Suppressed");
    const res = await issue(seed.orgA.apiKey, eng, { contact_id: contactJane });
    expect(res.status).toBe(200);
    expect(res.body.email_delivery).toBe("suppressed");
  });
});

describe("revocation and re-issue: access revoked, history preserved", () => {
  let eng: string;
  let token: string;
  let cookie: string;

  it("revoke: the live session dies immediately, the token dies like it never existed, and the vendor's answer survives", async () => {
    process.env.SECURELOGIC_VENDOR_INVITE_EMAIL_ENABLED = "true";
    eng = await seedScopedEngagement(seed.orgA.id, vendorA, "Revoke");
    const issued = await issue(seed.orgA.apiKey, eng, { contact_id: contactJane });
    token = issued.body.invite_token;
    cookie = await sessionCookieFor(token);
    const save = await request(app)
      .put(`/api/vendor-portal/questions/${requirementId}`)
      .set("Cookie", cookie)
      .send({ answer: "fail", notes: "PRESERVE-ME answer before revocation" });
    expect(save.status).toBe(200);

    const res = await revoke(seed.orgA.apiKey, eng, "contact left the vendor");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, invites_revoked: 1, sessions_revoked: 1 });
    expect((await request(app).get("/api/vendor-portal/engagement").set("Cookie", cookie)).status).toBe(401);
    expect((await exchange(token)).status).toBe(401);

    const answer = await pool.query<{ notes: string; answered_via_invite_id: string | null }>(
      `SELECT notes, answered_via_invite_id FROM requirement_responses WHERE organization_id = $1 AND engagement_id = $2`,
      [seed.orgA.id, eng]
    );
    expect(answer.rows[0]!.notes).toBe("PRESERVE-ME answer before revocation");
    expect(answer.rows[0]!.answered_via_invite_id).not.toBeNull();
    const detail = await getDetail(seed.orgA.apiKey, eng);
    expect(detail.body.invite.active).toBeNull();
    expect(detail.body.invite.latest.revoked_at).not.toBeNull();
    expect(detail.body.invite.latest.revocation_reason).toBe("contact left the vendor");
  });

  it("revoking again refuses; re-issue to a different contact mints a replacement that sees the preserved answer", async () => {
    expect((await revoke(seed.orgA.apiKey, eng)).status).toBe(404);
    const res = await reissue(seed.orgA.apiKey, eng, { contact_id: contactRaj });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.contact_email).toBe("raj@vendor.example");
    const c = await sessionCookieFor(res.body.invite_token);
    const questions = await request(app).get("/api/vendor-portal/questions").set("Cookie", c);
    expect(JSON.stringify(questions.body)).toContain("PRESERVE-ME");
    const detail = await getDetail(seed.orgA.apiKey, eng);
    expect(detail.body.invite.active.contact_id).toBe(contactRaj);
    expect(detail.body.invite.history_count).toBe(2);
  });

  it("an expired invite exchanges 410 and re-issue recovers; re-issue refuses a never-issued engagement", async () => {
    const e2 = await seedScopedEngagement(seed.orgA.id, vendorA, "Expired");
    const issued = await issue(seed.orgA.apiKey, e2, { contact_id: contactJane });
    await pool.query(`UPDATE vendor_engagement_invites SET expires_at = NOW() - INTERVAL '1 day' WHERE engagement_id = $1`, [e2]);
    expect((await exchange(issued.body.invite_token)).status).toBe(410);
    const detail = await getDetail(seed.orgA.apiKey, e2);
    expect(detail.body.invite.active).toBeNull();
    const recovered = await reissue(seed.orgA.apiKey, e2, { contact_id: contactJane });
    expect(recovered.status).toBe(200);
    expect((await exchange(recovered.body.invite_token)).status).toBe(200);

    const draft = await seedScopedEngagement(seed.orgA.id, vendorA, "Never issued");
    const res = await reissue(seed.orgA.apiKey, draft, { contact_id: contactJane });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("cannot_reissue");
  });

  it("a session that races the revocation is still dead: the invite is authoritative", async () => {
    const e3 = await seedScopedEngagement(seed.orgA.id, vendorA, "Race");
    const issued = await issue(seed.orgA.apiKey, e3, { contact_id: contactJane });
    expect(issued.status).toBe(200);
    const [row] = await inviteRow(e3);
    expect((await revoke(seed.orgA.apiKey, e3, "racing")).body.sessions_revoked).toBe(0);
    const session = mintSessionToken();
    await pool.query(
      `INSERT INTO vendor_portal_sessions
         (organization_id, invite_id, engagement_id, session_token_hash, idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [seed.orgA.id, row!.id, e3, session.tokenHash, session.idleExpiresAt, session.absoluteExpiresAt]
    );
    const res = await request(app)
      .get("/api/vendor-portal/engagement")
      .set("Cookie", `${PORTAL_SESSION_COOKIE}=${session.token}`);
    expect(res.status).toBe(401);
  });

  it("cross-tenant: org B can neither issue, revoke, re-issue nor read org A's engagement", async () => {
    const e4 = await seedScopedEngagement(seed.orgA.id, vendorA, "Tenant");
    expect((await issue(seed.orgB.apiKey, e4, { contact_id: contactJane })).status).toBe(404);
    expect((await issue(seed.orgB.apiKey, e4, { contact_email: "b@x.example" })).status).toBe(404);
    expect((await revoke(seed.orgB.apiKey, e4)).status).toBe(404);
    expect((await reissue(seed.orgB.apiKey, e4, { contact_email: "b@x.example" })).status).toBe(404);
    expect((await getDetail(seed.orgB.apiKey, e4)).status).toBe(404);
    expect(await inviteRow(e4)).toHaveLength(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("the audit trail records issue, revoke and re-issue with contact and delivery — and never a token", async () => {
    const audit = await pool.query<{ event_type: string; payload: Record<string, unknown> }>(
      `SELECT event_type, payload FROM security_audit_log
        WHERE organization_id = $1 AND resource_id = $2 ORDER BY created_at`,
      [seed.orgA.id, eng]
    );
    const types = audit.rows.map((r) => r.event_type);
    expect(types).toContain("vendor_engagement.issued");
    expect(types).toContain("vendor_engagement.invite_revoked");
    expect(types).toContain("vendor_engagement.invite_reissued");
    const issued = audit.rows.find((r) => r.event_type === "vendor_engagement.issued")!;
    expect(issued.payload).toMatchObject({ contact_id: contactJane, email_delivery: "sent" });
    expect(JSON.stringify(audit.rows)).not.toMatch(/[0-9a-f]{64}/);
  });
});
