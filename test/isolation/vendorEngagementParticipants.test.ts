/**
 * vendorEngagementParticipants.test.ts — VA-P1.
 *
 * Multi-responder participation is the first time the portal has more than one
 * principal behind one engagement, and that changes which boundaries are load
 * bearing. Three of them are new:
 *
 *   1. PARTICIPANT vs ENGAGEMENT. Being a participant on Alpha's Q1 assessment
 *      must not admit you to Alpha's Q2 assessment. Same org, same vendor, same
 *      person — nothing in the org predicate or in RLS separates these, and
 *      before VA-P1 the question could not even be asked because there was only
 *      ever one credential.
 *   2. COORDINATOR vs CONTRIBUTOR. A contributor may answer; only the
 *      coordinator may invite, revoke and submit. Submission in particular ends
 *      everybody's work at once.
 *   3. PER-PARTICIPANT credential lifecycle. Re-issuing to one person must not
 *      evict the others — the old rule revoked every live invite on the
 *      engagement, which with a team on it would have been a silent outage.
 *
 * Everything is driven over HTTP through the real routes, from real sessions,
 * with cross-wired ids attempted from a live credential rather than asserted
 * about in the abstract. Beta's rows carry BETA-SECRET markers so a leak shows
 * up as that string in a body rather than a subtle field mismatch.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";
import cookieParser from "cookie-parser";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { PORTAL_SESSION_COOKIE } from "../../src/api/lib/vendorPortal/portalTokens.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

type Engagement = { vendorId: string; engagementId: string; requirementId: string };

let alpha: Engagement;
let alphaSecond: Engagement;
let beta: Engagement;

/** Contacts in the supplier directory (VA-C1) — participants point at these. */
async function seedContact(vendorId: string, name: string, email: string): Promise<string> {
  const res = await request(app)
    .post(`/api/vendors/${vendorId}/contacts`)
    .set("X-Api-Key", seed.orgA.apiKey)
    .send({ full_name: name, email });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.contact.id;
}

async function seedEngagement(label: string, vendorId?: string): Promise<Engagement> {
  const orgId = seed.orgA.id;
  const vid = vendorId ?? (await seedVendor(pool, orgId, { name: `${label} vendor` }));
  const eng = await pool.query<{ id: string }>(
    `INSERT INTO vendor_engagements
       (organization_id, vendor_id, engagement_type, status,
        methodology_version, scope_rule_version, title)
     VALUES ($1, $2, 'initial', 'issued', '1.0.0', '1.0.0', $3)
     RETURNING id`,
    [orgId, vid, `${label} engagement`]
  );
  const engagementId = eng.rows[0]!.id;

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
  return { vendorId: vid, engagementId, requirementId };
}

/** Add a participant customer-side and return { participantId, token }. */
async function addParticipantAs(
  apiKey: string,
  engagementId: string,
  contactId: string,
  role: "coordinator" | "contributor"
): Promise<{ participantId: string; token: string }> {
  const res = await request(app)
    .post(`/api/vendor-engagements/${engagementId}/participants`)
    .set("X-Api-Key", apiKey)
    .send({ contact_id: contactId, participant_role: role });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { participantId: res.body.participant_id, token: res.body.invite_token };
}

async function sessionCookie(token: string): Promise<string> {
  const res = await request(app).post("/api/vendor-portal/session").send({ token });
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
  process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED = "true";
  process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED = "true";
  pool = new Pool({ connectionString: url, ssl: false });

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));

  alpha = await seedEngagement("Alpha");
  // A SECOND engagement at the SAME vendor. This is the boundary that org
  // scoping and RLS give no help with whatsoever.
  alphaSecond = await seedEngagement("AlphaQ2", alpha.vendorId);
  beta = await seedEngagement("Beta");
}, 180_000);

afterAll(async () => {
  delete process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED;
  delete process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED;
  await pool?.end();
});

describe("VA-P1 — several people at one supplier, one questionnaire", () => {
  it("a coordinator and a contributor both reach the SAME questionnaire", async () => {
    const jane = await seedContact(alpha.vendorId, "Jane Coordinator", "jane@alpha.example");
    const robert = await seedContact(alpha.vendorId, "Robert Counsel", "robert@alpha.example");

    const j = await addParticipantAs(seed.orgA.apiKey, alpha.engagementId, jane, "coordinator");
    const r = await addParticipantAs(seed.orgA.apiKey, alpha.engagementId, robert, "contributor");

    const jc = await sessionCookie(j.token);
    const rc = await sessionCookie(r.token);

    const jq = await request(app).get("/api/vendor-portal/questions").set("Cookie", jc);
    const rq = await request(app).get("/api/vendor-portal/questions").set("Cookie", rc);
    expect(jq.status).toBe(200);
    expect(rq.status).toBe(200);

    // The SAME questionnaire, not a copy each. One scope, one state.
    expect(jq.body.questions.map((q: { requirement_id: string }) => q.requirement_id)).toEqual(
      rq.body.questions.map((q: { requirement_id: string }) => q.requirement_id)
    );
    expect(jq.body.questions[0].requirement_id).toBe(alpha.requirementId);
  });

  it("one participant's answer is visible to the other, attributed by name", async () => {
    const rows = await pool.query<{ id: string }>(
      `SELECT p.id FROM vendor_engagement_participants p
         JOIN vendor_contacts c ON c.id = p.contact_id
        WHERE p.engagement_id = $1 AND c.email = 'robert@alpha.example'`,
      [alpha.engagementId]
    );
    expect(rows.rowCount).toBe(1);

    // Robert answers.
    const robertInvite = await pool.query<{ id: string }>(
      `SELECT id FROM vendor_engagement_invites
        WHERE participant_id = $1 AND revoked_at IS NULL`,
      [rows.rows[0]!.id]
    );
    expect(robertInvite.rowCount).toBe(1);

    const rc = await sessionCookieForParticipant(rows.rows[0]!.id);
    const save = await request(app)
      .put(`/api/vendor-portal/questions/${alpha.requirementId}`)
      .set("Cookie", rc)
      .send({ answer: "pass", notes: "Answered by counsel" });
    expect(save.status, JSON.stringify(save.body)).toBe(200);

    // Jane sees it, and sees WHOSE it is — attribution resolved through the
    // pre-existing answered_via_invite_id column, not a new one.
    const janeParticipant = await pool.query<{ id: string }>(
      `SELECT p.id FROM vendor_engagement_participants p
         JOIN vendor_contacts c ON c.id = p.contact_id
        WHERE p.engagement_id = $1 AND c.email = 'jane@alpha.example'`,
      [alpha.engagementId]
    );
    const jc = await sessionCookieForParticipant(janeParticipant.rows[0]!.id);
    const q = await request(app).get("/api/vendor-portal/questions").set("Cookie", jc);
    const answered = q.body.questions.find(
      (x: { requirement_id: string }) => x.requirement_id === alpha.requirementId
    );
    expect(answered.answer).toBe("pass");
    expect(answered.answered_by_name).toBe("Robert Counsel");
    expect(answered.answered_by_you).toBe(false);
    expect(answered.answered_at).toBeTruthy();
  });

  it("a stale save is refused rather than silently overwriting a colleague", async () => {
    const jane = await participantIdFor(alpha.engagementId, "jane@alpha.example");
    const jc = await sessionCookieForParticipant(jane);

    const stale = new Date(Date.now() - 3_600_000).toISOString();
    const res = await request(app)
      .put(`/api/vendor-portal/questions/${alpha.requirementId}`)
      .set("Cookie", jc)
      .send({ answer: "fail", notes: "clobber", prev_answered_at: stale });

    expect(res.status).toBe(412);
    expect(res.body.error).toBe("answer_changed");
    expect(res.body.current_answered_by_name).toBe("Robert Counsel");

    // And the colleague's answer is still standing.
    const q = await request(app).get("/api/vendor-portal/questions").set("Cookie", jc);
    const cur = q.body.questions.find(
      (x: { requirement_id: string }) => x.requirement_id === alpha.requirementId
    );
    expect(cur.answer).toBe("pass");

    // Sending the CURRENT token succeeds — the guard is a guard, not a wall.
    const ok = await request(app)
      .put(`/api/vendor-portal/questions/${alpha.requirementId}`)
      .set("Cookie", jc)
      .send({ answer: "fail", notes: "agreed change", prev_answered_at: cur.answered_at });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });
});

describe("VA-P1 — coordinator authority", () => {
  it("a contributor cannot submit, and the coordinator can", async () => {
    // Self-contained: submission FREEZES the engagement, so this test must not
    // run against a fixture other tests still need open.
    const eng = await seedEngagement("Sigma");
    const boss = await seedContact(eng.vendorId, "Sigma Boss", "boss@sigma.example");
    const hand = await seedContact(eng.vendorId, "Sigma Hand", "hand@sigma.example");
    const b = await addParticipantAs(seed.orgA.apiKey, eng.engagementId, boss, "coordinator");
    const h = await addParticipantAs(seed.orgA.apiKey, eng.engagementId, hand, "contributor");
    const bc = await sessionCookie(b.token);
    const hc = await sessionCookie(h.token);

    // The contributor does the work...
    const save = await request(app)
      .put(`/api/vendor-portal/questions/${eng.requirementId}`)
      .set("Cookie", hc)
      .send({ answer: "pass", notes: "done by the contributor" });
    expect(save.status, JSON.stringify(save.body)).toBe(200);

    // ...and still cannot end everyone's work.
    const denied = await request(app).post("/api/vendor-portal/submit").set("Cookie", hc);
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("not_coordinator");

    const allowed = await request(app).post("/api/vendor-portal/submit").set("Cookie", bc);
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);

    // Attribution: submission used to be recorded against nobody at all.
    // Polled because writeAuditEvent is fire-and-forget — asserting on it
    // immediately is a race, and a race in an isolation suite is a flake that
    // eventually gets explained away rather than fixed.
    const payload = await eventuallyAuditPayload("vendor_portal.submitted");
    expect(payload.participant_id).toBe(b.participantId);
  });

  it("a contributor cannot invite or revoke teammates", async () => {
    const eng = await seedEngagement("Gamma");
    const boss = await seedContact(eng.vendorId, "Gamma Boss", "boss@gamma.example");
    const hand = await seedContact(eng.vendorId, "Gamma Hand", "hand@gamma.example");
    const outsider = await seedContact(eng.vendorId, "Gamma Extra", "extra@gamma.example");

    const b = await addParticipantAs(seed.orgA.apiKey, eng.engagementId, boss, "coordinator");
    const h = await addParticipantAs(seed.orgA.apiKey, eng.engagementId, hand, "contributor");
    const hc = await sessionCookie(h.token);

    const invite = await request(app)
      .post("/api/vendor-portal/participants")
      .set("Cookie", hc)
      .send({ contact_id: outsider });
    expect(invite.status).toBe(403);
    expect(invite.body.error).toBe("not_coordinator");

    const revoke = await request(app)
      .post(`/api/vendor-portal/participants/${b.participantId}/revoke`)
      .set("Cookie", hc)
      .send({});
    expect(revoke.status).toBe(403);

    // The coordinator can do both, which is what makes the above non-vacuous.
    const bc = await sessionCookie(b.token);
    const ok = await request(app)
      .post("/api/vendor-portal/participants")
      .set("Cookie", bc)
      .send({ contact_id: outsider });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.invite_token).toBeTruthy();
  });

  it("a coordinator cannot revoke themselves and strand the engagement", async () => {
    const eng = await seedEngagement("Delta");
    const boss = await seedContact(eng.vendorId, "Delta Boss", "boss@delta.example");
    const b = await addParticipantAs(seed.orgA.apiKey, eng.engagementId, boss, "coordinator");
    const bc = await sessionCookie(b.token);
    const res = await request(app)
      .post(`/api/vendor-portal/participants/${b.participantId}/revoke`)
      .set("Cookie", bc)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("cannot_revoke_self");
  });

  it("the coordinator invites a colleague who is NOT yet in the directory", async () => {
    const eng = await seedEngagement("Epsilon");
    const boss = await seedContact(eng.vendorId, "Eps Boss", "boss@eps.example");
    const b = await addParticipantAs(seed.orgA.apiKey, eng.engagementId, boss, "coordinator");
    const bc = await sessionCookie(b.token);

    const res = await request(app)
      .post("/api/vendor-portal/participants")
      .set("Cookie", bc)
      .send({ full_name: "Eps Newcomer", email: "new@eps.example", title: "DPO" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    // The person landed in the CUSTOMER's directory, bound to the right vendor.
    const contact = await pool.query<{ vendor_id: string; organization_id: string }>(
      `SELECT vendor_id, organization_id FROM vendor_contacts WHERE email = 'new@eps.example'`
    );
    expect(contact.rowCount).toBe(1);
    expect(contact.rows[0]!.vendor_id).toBe(eng.vendorId);
    expect(contact.rows[0]!.organization_id).toBe(seed.orgA.id);
  });
});

describe("VA-P1 — revocation: access ends, history stays", () => {
  it("a revoked participant loses access immediately and keeps their authorship", async () => {
    const eng = await seedEngagement("Zeta");
    const boss = await seedContact(eng.vendorId, "Zeta Boss", "boss@zeta.example");
    const hand = await seedContact(eng.vendorId, "Zeta Hand", "hand@zeta.example");
    await addParticipantAs(seed.orgA.apiKey, eng.engagementId, boss, "coordinator");
    const h = await addParticipantAs(seed.orgA.apiKey, eng.engagementId, hand, "contributor");
    const hc = await sessionCookie(h.token);

    // They contribute first — the history that must survive.
    const save = await request(app)
      .put(`/api/vendor-portal/questions/${eng.requirementId}`)
      .set("Cookie", hc)
      .send({ answer: "pass", notes: "ZETA-CONTRIBUTION" });
    expect(save.status).toBe(200);

    const revoke = await request(app)
      .post(`/api/vendor-engagements/${eng.engagementId}/participants/${h.participantId}/revoke`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ reason: "left the company" });
    expect(revoke.status, JSON.stringify(revoke.body)).toBe(200);
    expect(revoke.body.sessions_revoked).toBeGreaterThanOrEqual(1);

    // The LIVE session is dead on the very next request — not eventually.
    const after = await request(app).get("/api/vendor-portal/questions").set("Cookie", hc);
    expect(after.status).toBe(401);

    // The old invite token no longer exchanges either.
    const reuse = await request(app).post("/api/vendor-portal/session").send({ token: h.token });
    expect(reuse.status).toBe(401);

    // History: the answer, its revision, and the attribution all remain.
    const answer = await pool.query<{ notes: string; answered_via_invite_id: string }>(
      `SELECT notes, answered_via_invite_id FROM requirement_responses
        WHERE engagement_id = $1 AND requirement_id = $2`,
      [eng.engagementId, eng.requirementId]
    );
    expect(answer.rows[0]!.notes).toBe("ZETA-CONTRIBUTION");
    expect(answer.rows[0]!.answered_via_invite_id).toBeTruthy();

    const stillResolves = await pool.query<{ full_name: string }>(
      `SELECT c.full_name
         FROM requirement_responses rr
         JOIN vendor_engagement_invites i ON i.id = rr.answered_via_invite_id
         JOIN vendor_engagement_participants p ON p.id = i.participant_id
         JOIN vendor_contacts c ON c.id = p.contact_id
        WHERE rr.engagement_id = $1`,
      [eng.engagementId]
    );
    expect(stillResolves.rows[0]!.full_name).toBe("Zeta Hand");

    const revisions = await pool.query(
      `SELECT 1 FROM requirement_response_revisions WHERE organization_id = $1`,
      [seed.orgA.id]
    );
    expect(revisions.rowCount).toBeGreaterThan(0);

    // The participant row survives, marked revoked — never deleted.
    const row = await pool.query<{ status: string; revocation_reason: string }>(
      `SELECT status, revocation_reason FROM vendor_engagement_participants WHERE id = $1`,
      [h.participantId]
    );
    expect(row.rows[0]!.status).toBe("revoked");
    expect(row.rows[0]!.revocation_reason).toBe("left the company");
  });

  it("revoking one participant does NOT evict the others", async () => {
    const eng = await seedEngagement("Eta");
    const boss = await seedContact(eng.vendorId, "Eta Boss", "boss@eta.example");
    const keep = await seedContact(eng.vendorId, "Eta Keeper", "keep@eta.example");
    const drop = await seedContact(eng.vendorId, "Eta Dropped", "drop@eta.example");
    const b = await addParticipantAs(seed.orgA.apiKey, eng.engagementId, boss, "coordinator");
    const k = await addParticipantAs(seed.orgA.apiKey, eng.engagementId, keep, "contributor");
    const d = await addParticipantAs(seed.orgA.apiKey, eng.engagementId, drop, "contributor");

    const bc = await sessionCookie(b.token);
    const kc = await sessionCookie(k.token);
    const dc = await sessionCookie(d.token);

    await request(app)
      .post(`/api/vendor-engagements/${eng.engagementId}/participants/${d.participantId}/revoke`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({});

    expect((await request(app).get("/api/vendor-portal/questions").set("Cookie", dc)).status).toBe(401);
    expect((await request(app).get("/api/vendor-portal/questions").set("Cookie", kc)).status).toBe(200);
    expect((await request(app).get("/api/vendor-portal/questions").set("Cookie", bc)).status).toBe(200);
  });

  it("re-inviting one participant supersedes only THEIR link", async () => {
    const eng = await seedEngagement("Theta");
    const boss = await seedContact(eng.vendorId, "Theta Boss", "boss@theta.example");
    const mate = await seedContact(eng.vendorId, "Theta Mate", "mate@theta.example");
    const b = await addParticipantAs(seed.orgA.apiKey, eng.engagementId, boss, "coordinator");
    const m = await addParticipantAs(seed.orgA.apiKey, eng.engagementId, mate, "contributor");
    const bc = await sessionCookie(b.token);
    const mc = await sessionCookie(m.token);

    // Re-invite the mate: same person, same participation row, new credential.
    const again = await request(app)
      .post(`/api/vendor-engagements/${eng.engagementId}/participants`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ contact_id: mate });
    expect(again.status).toBe(201);
    expect(again.body.reused).toBe(true);
    expect(again.body.participant_id).toBe(m.participantId);

    // Their OLD credential is dead...
    expect((await request(app).post("/api/vendor-portal/session").send({ token: m.token })).status).toBe(401);
    expect((await request(app).get("/api/vendor-portal/questions").set("Cookie", mc)).status).toBe(401);
    // ...the new one works...
    const fresh = await sessionCookie(again.body.invite_token);
    expect((await request(app).get("/api/vendor-portal/questions").set("Cookie", fresh)).status).toBe(200);
    // ...and the coordinator was never touched. This is the regression the old
    // engagement-wide single-active-invite rule would have caused.
    expect((await request(app).get("/api/vendor-portal/questions").set("Cookie", bc)).status).toBe(200);

    // One participation row for one human, not two.
    const count = await pool.query(
      `SELECT COUNT(*)::int AS n FROM vendor_engagement_participants
        WHERE engagement_id = $1 AND contact_id = $2`,
      [eng.engagementId, mate]
    );
    expect(count.rows[0]!.n).toBe(1);
  });

  it("an expired invite does not exchange", async () => {
    const eng = await seedEngagement("Iota");
    const c = await seedContact(eng.vendorId, "Iota Person", "p@iota.example");
    const p = await addParticipantAs(seed.orgA.apiKey, eng.engagementId, c, "coordinator");
    await pool.query(
      `UPDATE vendor_engagement_invites SET expires_at = NOW() - INTERVAL '1 day'
        WHERE participant_id = $1`,
      [p.participantId]
    );
    const res = await request(app).post("/api/vendor-portal/session").send({ token: p.token });
    expect(res.status).toBe(410);
    expect(res.body.error).toBe("portal_link_expired");
  });

  it("an inactive contact cannot be made a participant", async () => {
    const eng = await seedEngagement("Kappa");
    const c = await seedContact(eng.vendorId, "Kappa Gone", "gone@kappa.example");
    await request(app)
      .patch(`/api/vendors/${eng.vendorId}/contacts/${c}`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ status: "inactive" });

    const res = await request(app)
      .post(`/api/vendor-engagements/${eng.engagementId}/participants`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ contact_id: c });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("contact_inactive");
  });
});

describe("VA-P1 — isolation: tenant, vendor, engagement", () => {
  it("a participant of one engagement cannot reach the SAME VENDOR's other engagement", async () => {
    // The boundary neither the org predicate nor RLS helps with at all.
    const person = await seedContact(alpha.vendorId, "Q1 Only", "q1only@alpha.example");
    const p = await addParticipantAs(seed.orgA.apiKey, alphaSecond.engagementId, person, "coordinator");
    const cookie = await sessionCookie(p.token);

    const q = await request(app).get("/api/vendor-portal/questions").set("Cookie", cookie);
    expect(q.status).toBe(200);
    const ids = q.body.questions.map((x: { requirement_id: string }) => x.requirement_id);
    // Sees ONLY Q2's question, never Q1's, though both belong to one vendor.
    expect(ids).toContain(alphaSecond.requirementId);
    expect(ids).not.toContain(alpha.requirementId);

    // And cannot answer the other engagement's requirement by naming its id.
    const cross = await request(app)
      .put(`/api/vendor-portal/questions/${alpha.requirementId}`)
      .set("Cookie", cookie)
      .send({ answer: "pass" });
    expect(cross.status).toBe(404);
  });

  it("a coordinator cannot revoke a participant of another engagement", async () => {
    const q1Jane = await participantIdFor(alpha.engagementId, "jane@alpha.example");
    const q2 = await participantIdFor(alphaSecond.engagementId, "q1only@alpha.example");
    const cookie = await sessionCookieForParticipant(q2);

    const res = await request(app)
      .post(`/api/vendor-portal/participants/${q1Jane}/revoke`)
      .set("Cookie", cookie)
      .send({});
    // Indistinguishable from a participant that never existed.
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("participant_not_found");

    // Jane is untouched.
    const jane = await pool.query<{ status: string }>(
      `SELECT status FROM vendor_engagement_participants WHERE id = $1`,
      [q1Jane]
    );
    expect(jane.rows[0]!.status).not.toBe("revoked");
  });

  it("a coordinator cannot invite ANOTHER supplier's contact into their engagement", async () => {
    const betaSecret = await seedContact(beta.vendorId, "BETA-SECRET Person", "secret@beta.example");
    const eng = await seedEngagement("Omega");
    const boss = await seedContact(eng.vendorId, "Omega Boss", "boss@omega.example");
    const b = await addParticipantAs(seed.orgA.apiKey, eng.engagementId, boss, "coordinator");
    const cookie = await sessionCookie(b.token);

    // Both suppliers belong to the SAME customer, so organization_id is
    // identical on both contact rows and proves nothing. vendor_id is the only
    // thing refusing this.
    const res = await request(app)
      .post("/api/vendor-portal/participants")
      .set("Cookie", cookie)
      .send({ contact_id: betaSecret });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("BETA-SECRET");

    // And nothing was created for the other supplier's person.
    const leaked = await pool.query(
      `SELECT 1 FROM vendor_engagement_participants WHERE contact_id = $1`,
      [betaSecret]
    );
    expect(leaked.rowCount).toBe(0);
  });

  it("the customer cannot add another supplier's contact to this engagement either", async () => {
    const betaContact = await seedContact(beta.vendorId, "Beta Other", "other@beta.example");
    const res = await request(app)
      .post(`/api/vendor-engagements/${alpha.engagementId}/participants`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ contact_id: betaContact });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("contact_not_found");
  });

  it("org B cannot see, add to, or revoke org A's participants", async () => {
    const list = await request(app)
      .get(`/api/vendor-engagements/${alpha.engagementId}/participants`)
      .set("X-Api-Key", seed.orgB.apiKey);
    expect(list.status).toBe(404);

    const jane = await participantIdFor(alpha.engagementId, "jane@alpha.example");
    const revoke = await request(app)
      .post(`/api/vendor-engagements/${alpha.engagementId}/participants/${jane}/revoke`)
      .set("X-Api-Key", seed.orgB.apiKey)
      .send({});
    expect(revoke.status).toBe(404);

    const stillLive = await pool.query<{ status: string }>(
      `SELECT status FROM vendor_engagement_participants WHERE id = $1`,
      [jane]
    );
    expect(stillLive.rows[0]!.status).not.toBe("revoked");
  });

  it("no api key, no participant list", async () => {
    const res = await request(app).get(
      `/api/vendor-engagements/${alpha.engagementId}/participants`
    );
    expect([401, 403]).toContain(res.status);
  });

  it("a portal session cannot reach the CUSTOMER participant routes", async () => {
    // The two auth worlds are structurally disjoint: a portal cookie carries no
    // organizationContext, so it cannot satisfy an API route's guards.
    const jane = await participantIdFor(alpha.engagementId, "jane@alpha.example");
    const cookie = await sessionCookieForParticipant(jane);
    const res = await request(app)
      .get(`/api/vendor-engagements/${alpha.engagementId}/participants`)
      .set("Cookie", cookie);
    expect([401, 403]).toContain(res.status);
  });
});

/* ── helpers that need `app`/`pool`, declared last for readability ───────── */

/**
 * The most recent audit payload for an event type, waited for rather than
 * assumed. writeAuditEvent is deliberately fire-and-forget so a failed audit
 * write cannot fail a vendor's submission; that makes the row eventually
 * present, not immediately present.
 */
async function eventuallyAuditPayload(
  eventType: string,
  timeoutMs = 5000
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM security_audit_log
        WHERE organization_id = $1 AND event_type = $2
        ORDER BY created_at DESC LIMIT 1`,
      [seed.orgA.id, eventType]
    );
    if (res.rowCount) return res.rows[0]!.payload;
    if (Date.now() > deadline) throw new Error(`no ${eventType} audit row within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function participantIdFor(engagementId: string, email: string): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `SELECT p.id FROM vendor_engagement_participants p
       JOIN vendor_contacts c ON c.id = p.contact_id
      WHERE p.engagement_id = $1 AND c.email = $2`,
    [engagementId, email]
  );
  expect(res.rowCount, `no participant for ${email}`).toBe(1);
  return res.rows[0]!.id;
}

/**
 * A live session for an existing participant.
 *
 * Mints a fresh credential by re-inviting them, which is the only way to get a
 * usable token: only a hash is ever stored, so a test cannot recover the
 * original. That is the property under test elsewhere, so it is not worked
 * around here.
 */
async function sessionCookieForParticipant(participantId: string): Promise<string> {
  const row = await pool.query<{ engagement_id: string; contact_id: string }>(
    `SELECT engagement_id, contact_id FROM vendor_engagement_participants WHERE id = $1`,
    [participantId]
  );
  const res = await request(app)
    .post(`/api/vendor-engagements/${row.rows[0]!.engagement_id}/participants`)
    .set("X-Api-Key", seed.orgA.apiKey)
    .send({ contact_id: row.rows[0]!.contact_id });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return sessionCookie(res.body.invite_token);
}
