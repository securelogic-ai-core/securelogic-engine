/**
 * vendorEngagementAssignments.test.ts — VA-D1.
 *
 * Delegation adds a third id a caller could cross-wire. VA-P1 had participants
 * and engagements; this adds the REQUIREMENT, and the interesting failures are
 * combinations rather than single ids:
 *
 *   - a requirement that exists, in an engagement that exists, but was never
 *     ISSUED in that engagement's frozen scope;
 *   - a participant of the SAME VENDOR's other engagement;
 *   - a participant of another vendor entirely, inside the same tenant.
 *
 * None of those are caught by an org predicate or by RLS. They are caught by
 * engagement-scoped lookups and by 20261058's trigger, and both are exercised
 * here from live sessions over HTTP.
 *
 * The other half of the file is about honesty rather than isolation: that
 * completion is derived from real response state and cannot drift, that a
 * single-framework assessment refuses to pretend it has sections, and that a
 * revoked participant's work becomes visibly unowned rather than being handed
 * to somebody nobody chose.
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

type Fixture = {
  vendorId: string;
  engagementId: string;
  frameworkA: string;
  frameworkB: string;
  reqA1: string;
  reqA2: string;
  reqB1: string;
  coordinator: { participantId: string; cookie: string };
  worker: { participantId: string; cookie: string };
};

async function seedContact(vendorId: string, name: string, email: string): Promise<string> {
  const res = await request(app)
    .post(`/api/vendors/${vendorId}/contacts`)
    .set("X-Api-Key", seed.orgA.apiKey)
    .send({ full_name: name, email });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.contact.id;
}

async function seedFrameworkWithRequirements(
  orgId: string,
  name: string,
  refs: string[]
): Promise<{ frameworkId: string; requirementIds: string[] }> {
  const fw = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version) VALUES ($1, $2, '1.0') RETURNING id`,
    [orgId, name]
  );
  const frameworkId = fw.rows[0]!.id;
  const requirementIds: string[] = [];
  for (const ref of refs) {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO requirements (framework_id, reference_id, title)
       VALUES ($1, $2, $3) RETURNING id`,
      [frameworkId, ref, `${name} ${ref}`]
    );
    requirementIds.push(r.rows[0]!.id);
  }
  return { frameworkId, requirementIds };
}

async function scopeIn(engagementId: string, requirementIds: string[]): Promise<void> {
  for (const id of requirementIds) {
    await pool.query(
      `INSERT INTO vendor_engagement_scope_items
         (organization_id, engagement_id, requirement_id, depth, mandatory, source)
       VALUES ($1, $2, $3, 'full', TRUE, 'deterministic')`,
      [seed.orgA.id, engagementId, id]
    );
  }
}

async function newEngagement(vendorId: string, title: string): Promise<string> {
  const eng = await pool.query<{ id: string }>(
    `INSERT INTO vendor_engagements
       (organization_id, vendor_id, engagement_type, status,
        methodology_version, scope_rule_version, title)
     VALUES ($1, $2, 'initial', 'issued', '1.0.0', '1.0.0', $3)
     RETURNING id`,
    [seed.orgA.id, vendorId, title]
  );
  return eng.rows[0]!.id;
}

async function addParticipant(
  engagementId: string,
  contactId: string,
  role: "coordinator" | "contributor"
): Promise<{ participantId: string; cookie: string }> {
  const res = await request(app)
    .post(`/api/vendor-engagements/${engagementId}/participants`)
    .set("X-Api-Key", seed.orgA.apiKey)
    .send({ contact_id: contactId, participant_role: role });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const ex = await request(app)
    .post("/api/vendor-portal/session")
    .send({ token: res.body.invite_token });
  expect(ex.status, JSON.stringify(ex.body)).toBe(200);
  const raw = ex.headers["set-cookie"] as unknown as string[];
  const cookie = raw.find((c) => c.startsWith(PORTAL_SESSION_COOKIE))!.split(";")[0]!;
  return { participantId: res.body.participant_id, cookie };
}

/** A two-framework engagement with a coordinator and one worker. */
async function buildFixture(label: string): Promise<Fixture> {
  const vendorId = await seedVendor(pool, seed.orgA.id, { name: `${label} vendor` });
  const engagementId = await newEngagement(vendorId, `${label} engagement`);
  const a = await seedFrameworkWithRequirements(seed.orgA.id, `${label}-ISO`, ["A.1", "A.2"]);
  const b = await seedFrameworkWithRequirements(seed.orgA.id, `${label}-SOC`, ["B.1"]);
  await scopeIn(engagementId, [...a.requirementIds, ...b.requirementIds]);

  const boss = await seedContact(vendorId, `${label} Boss`, `boss@${label.toLowerCase()}.example`);
  const hand = await seedContact(vendorId, `${label} Hand`, `hand@${label.toLowerCase()}.example`);
  return {
    vendorId,
    engagementId,
    frameworkA: a.frameworkId,
    frameworkB: b.frameworkId,
    reqA1: a.requirementIds[0]!,
    reqA2: a.requirementIds[1]!,
    reqB1: b.requirementIds[0]!,
    coordinator: await addParticipant(engagementId, boss, "coordinator"),
    worker: await addParticipant(engagementId, hand, "contributor"),
  };
}

let alpha: Fixture;

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

  alpha = await buildFixture("Alpha");
}, 240_000);

afterAll(async () => {
  delete process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED;
  delete process.env.SECURELOGIC_VENDOR_PORTAL_ENABLED;
  await pool?.end();
});

const assign = (cookie: string, requirementId: string, participantId: string | null) =>
  request(app)
    .put(`/api/vendor-portal/assignments/${requirementId}`)
    .set("Cookie", cookie)
    .send({ participant_id: participantId });

describe("VA-D1 — delegating one question", () => {
  it("the coordinator assigns, and the assignee sees it in Assigned to Me", async () => {
    const res = await assign(alpha.coordinator.cookie, alpha.reqA1, alpha.worker.participantId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.action).toBe("assigned");

    const mine = await request(app)
      .get("/api/vendor-portal/assignments")
      .set("Cookie", alpha.worker.cookie);
    expect(mine.status).toBe(200);
    expect(mine.body.mine).toHaveLength(1);
    expect(mine.body.mine[0].requirement_id).toBe(alpha.reqA1);
    expect(mine.body.mine[0].complete).toBe(false);
    expect(mine.body.mine_outstanding).toBe(1);

    // The coordinator's own list is empty — Assigned to Me is computed from the
    // session, not from a caller-supplied participant id.
    const bossView = await request(app)
      .get("/api/vendor-portal/assignments")
      .set("Cookie", alpha.coordinator.cookie);
    expect(bossView.body.mine).toHaveLength(0);
    // ...but they see the whole board, including who owns what.
    const item = bossView.body.items.find(
      (i: { requirement_id: string }) => i.requirement_id === alpha.reqA1
    );
    expect(item.assignee_name).toBe("Alpha Hand");
  });

  it("a contributor cannot assign work", async () => {
    const res = await assign(alpha.worker.cookie, alpha.reqA2, alpha.worker.participantId);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_coordinator");
  });

  it("completion is derived from the real answer, not stored", async () => {
    const save = await request(app)
      .put(`/api/vendor-portal/questions/${alpha.reqA1}`)
      .set("Cookie", alpha.worker.cookie)
      .send({ answer: "pass" });
    expect(save.status, JSON.stringify(save.body)).toBe(200);

    const mine = await request(app)
      .get("/api/vendor-portal/assignments")
      .set("Cookie", alpha.worker.cookie);
    expect(mine.body.mine[0].complete).toBe(true);
    expect(mine.body.mine_outstanding).toBe(0);

    // Nothing wrote a completion flag: the only source is the response row.
    const stored = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'vendor_engagement_assignments'
          AND column_name IN ('complete','completed','completed_at','status')`
    );
    expect(stored.rowCount).toBe(0);
  });

  it("answering somebody else's question does NOT rewrite the assignment", async () => {
    // The coordinator answers work assigned to the contributor. Both facts have
    // to survive: the work was Susan's, the answer is the coordinator's.
    const res = await request(app)
      .put(`/api/vendor-portal/questions/${alpha.reqA1}`)
      .set("Cookie", alpha.coordinator.cookie)
      .send({ answer: "fail", notes: "corrected by the lead" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const current = await pool.query<{ assigned_to_participant_id: string }>(
      `SELECT assigned_to_participant_id FROM vendor_engagement_assignments
        WHERE engagement_id = $1 AND requirement_id = $2 AND superseded_at IS NULL`,
      [alpha.engagementId, alpha.reqA1]
    );
    expect(current.rows[0]!.assigned_to_participant_id).toBe(alpha.worker.participantId);

    // ...while authorship moved to the coordinator, through the invite.
    const author = await pool.query<{ full_name: string }>(
      `SELECT c.full_name
         FROM requirement_responses rr
         JOIN vendor_engagement_invites i ON i.id = rr.answered_via_invite_id
         JOIN vendor_engagement_participants p ON p.id = i.participant_id
         JOIN vendor_contacts c ON c.id = p.contact_id
        WHERE rr.engagement_id = $1 AND rr.requirement_id = $2`,
      [alpha.engagementId, alpha.reqA1]
    );
    expect(author.rows[0]!.full_name).toBe("Alpha Boss");
  });

  it("reassignment keeps the whole chain of custody", async () => {
    const res = await assign(
      alpha.coordinator.cookie,
      alpha.reqA1,
      alpha.coordinator.participantId
    );
    expect(res.body.action).toBe("reassigned");

    const history = await request(app)
      .get(`/api/vendor-portal/assignments/${alpha.reqA1}/history`)
      .set("Cookie", alpha.coordinator.cookie);
    expect(history.status).toBe(200);
    const acts = history.body.history;
    expect(acts.length).toBeGreaterThanOrEqual(2);
    expect(acts[0].assignment_action).toBe("assigned");
    expect(acts[0].assignee_name).toBe("Alpha Hand");
    expect(acts[0].superseded_at).toBeTruthy();
    expect(acts[acts.length - 1].assignment_action).toBe("reassigned");
    expect(acts[acts.length - 1].assignee_name).toBe("Alpha Boss");
    expect(acts[acts.length - 1].superseded_at).toBeNull();
    // Who did the reassigning is on the record too.
    expect(acts[acts.length - 1].actor_name).toBe("Alpha Boss");
  });

  it("exactly one current assignment survives per question", async () => {
    const current = await pool.query(
      `SELECT COUNT(*)::int AS n FROM vendor_engagement_assignments
        WHERE engagement_id = $1 AND requirement_id = $2 AND superseded_at IS NULL`,
      [alpha.engagementId, alpha.reqA1]
    );
    expect(current.rows[0]!.n).toBe(1);
  });

  it("unassigning is a recorded act, not a deleted row", async () => {
    const res = await assign(alpha.coordinator.cookie, alpha.reqA1, null);
    expect(res.status).toBe(200);
    expect(res.body.action).toBe("unassigned");

    const rows = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM vendor_engagement_assignments
        WHERE engagement_id = $1 AND requirement_id = $2`,
      [alpha.engagementId, alpha.reqA1]
    );
    expect(Number(rows.rows[0]!.n)).toBeGreaterThanOrEqual(3);
  });

  it("re-sending the same instruction is a no-op, not a duplicate row", async () => {
    await assign(alpha.coordinator.cookie, alpha.reqA2, alpha.worker.participantId);
    const again = await assign(alpha.coordinator.cookie, alpha.reqA2, alpha.worker.participantId);
    expect(again.status).toBe(200);
    expect(again.body.changed).toBe(false);
  });
});

describe("VA-D1 — framework is the section, and only when it means something", () => {
  it("bulk-assigns every scoped requirement of one framework", async () => {
    const fx = await buildFixture("Bulk");
    const res = await request(app)
      .post("/api/vendor-portal/assignments/framework")
      .set("Cookie", fx.coordinator.cookie)
      .send({ framework_id: fx.frameworkA, participant_id: fx.worker.participantId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.assigned).toBe(2);

    const board = await request(app)
      .get("/api/vendor-portal/assignments")
      .set("Cookie", fx.worker.cookie);
    expect(board.body.mine).toHaveLength(2);
    // The OTHER framework's question is untouched.
    const other = board.body.items.find(
      (i: { requirement_id: string }) => i.requirement_id === fx.reqB1
    );
    expect(other.assigned_to_participant_id).toBeNull();

    // No section object was stored — assignment is per requirement.
    const stored = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'vendor_engagement_assignments'
          AND column_name IN ('framework_id','section','section_id','group_key')`
    );
    expect(stored.rowCount).toBe(0);
  });

  it("a single-framework assessment refuses to pretend it has sections", async () => {
    const vendorId = await seedVendor(pool, seed.orgA.id, { name: "Solo vendor" });
    const engagementId = await newEngagement(vendorId, "Solo engagement");
    const only = await seedFrameworkWithRequirements(seed.orgA.id, "Solo-ISO", ["S.1", "S.2"]);
    await scopeIn(engagementId, only.requirementIds);
    const boss = await seedContact(vendorId, "Solo Boss", "boss@solo.example");
    const coord = await addParticipant(engagementId, boss, "coordinator");

    const board = await request(app)
      .get("/api/vendor-portal/assignments")
      .set("Cookie", coord.cookie);
    expect(board.body.framework_grouping_available).toBe(false);
    expect(board.body.assignable_frameworks).toBeNull();

    const bulk = await request(app)
      .post("/api/vendor-portal/assignments/framework")
      .set("Cookie", coord.cookie)
      .send({ framework_id: only.frameworkId, participant_id: coord.participantId });
    expect(bulk.status).toBe(422);
    expect(bulk.body.error).toBe("framework_grouping_unavailable");

    // Individual assignment still works — the refusal is about honesty, not capability.
    const one = await assign(coord.cookie, only.requirementIds[0]!, coord.participantId);
    expect(one.status).toBe(200);

    const progress = await request(app)
      .get("/api/vendor-portal/progress")
      .set("Cookie", coord.cookie);
    expect(progress.body.by_framework).toBeNull();
    expect(progress.body.framework_grouping_available).toBe(false);
  });

  it("the coordinator's board counts against one denominator", async () => {
    const fx = await buildFixture("Board");
    await assign(fx.coordinator.cookie, fx.reqA1, fx.worker.participantId);
    await assign(fx.coordinator.cookie, fx.reqA2, fx.worker.participantId);
    await request(app)
      .put(`/api/vendor-portal/questions/${fx.reqA1}`)
      .set("Cookie", fx.worker.cookie)
      .send({ answer: "pass" });

    const p = await request(app).get("/api/vendor-portal/progress").set("Cookie", fx.coordinator.cookie);
    expect(p.status).toBe(200);
    expect(p.body.total).toBe(3);
    expect(p.body.complete).toBe(1);
    expect(p.body.outstanding).toBe(2);
    expect(p.body.assigned).toBe(2);
    expect(p.body.unassigned).toBe(1);

    const worker = p.body.by_participant.find(
      (x: { participant_id: string }) => x.participant_id === fx.worker.participantId
    );
    // Measured against THEIR OWN assigned work, not the whole questionnaire.
    expect(worker.assigned).toBe(2);
    expect(worker.complete).toBe(1);
    expect(worker.outstanding).toBe(1);

    // Framework rows sum to the same total as the overall figure.
    const sum = p.body.by_framework.reduce((n: number, f: { total: number }) => n + f.total, 0);
    expect(sum).toBe(p.body.total);
  });

  it("a reviewer clarification makes answered work outstanding again", async () => {
    // There is NO per-question reopen flag in this schema: clarification is an
    // engagement state plus a reviewer comment optionally anchored to one
    // question. So "outstanding again" is derived from a reviewer comment on
    // this question that is newer than the vendor's last answer to it — a
    // second, separately-named fact, never a mutation of `complete`.
    const fx = await buildFixture("Reopen");
    await assign(fx.coordinator.cookie, fx.reqA1, fx.worker.participantId);
    await request(app)
      .put(`/api/vendor-portal/questions/${fx.reqA1}`)
      .set("Cookie", fx.worker.cookie)
      .send({ answer: "pass" });

    let board = await request(app)
      .get("/api/vendor-portal/assignments")
      .set("Cookie", fx.worker.cookie);
    expect(board.body.mine[0].complete).toBe(true);
    expect(board.body.mine[0].clarification_open).toBe(false);
    expect(board.body.mine_outstanding).toBe(0);

    // The reviewer comes back on that specific question.
    await pool.query(
      `INSERT INTO vendor_engagement_comments
         (organization_id, engagement_id, requirement_id, author_type, visibility, body)
       VALUES ($1, $2, $3, 'internal', 'vendor', 'Please attach the policy you referenced.')`,
      [seed.orgA.id, fx.engagementId, fx.reqA1]
    );

    board = await request(app)
      .get("/api/vendor-portal/assignments")
      .set("Cookie", fx.worker.cookie);
    // Still answered — the answer did not vanish — but the work is live again.
    expect(board.body.mine[0].complete).toBe(true);
    expect(board.body.mine[0].clarification_open).toBe(true);
    expect(board.body.mine_outstanding).toBe(1);

    // Answering again settles it: the response is now newer than the comment.
    await request(app)
      .put(`/api/vendor-portal/questions/${fx.reqA1}`)
      .set("Cookie", fx.worker.cookie)
      .send({ answer: "pass", notes: "policy attached" });
    board = await request(app)
      .get("/api/vendor-portal/assignments")
      .set("Cookie", fx.worker.cookie);
    expect(board.body.mine[0].clarification_open).toBe(false);
    expect(board.body.mine_outstanding).toBe(0);
  });

  it("an INTERNAL-only reviewer note never reaches the vendor's work list", async () => {
    // internal-visibility comments are reviewer-only. Leaking one through the
    // clarification signal would tell the vendor a private note exists.
    const fx = await buildFixture("Private");
    await assign(fx.coordinator.cookie, fx.reqA1, fx.worker.participantId);
    await request(app)
      .put(`/api/vendor-portal/questions/${fx.reqA1}`)
      .set("Cookie", fx.worker.cookie)
      .send({ answer: "pass" });
    await pool.query(
      `INSERT INTO vendor_engagement_comments
         (organization_id, engagement_id, requirement_id, author_type, visibility, body)
       VALUES ($1, $2, $3, 'internal', 'internal', 'INTERNAL-ONLY: weak answer, chase later')`,
      [seed.orgA.id, fx.engagementId, fx.reqA1]
    );

    const board = await request(app)
      .get("/api/vendor-portal/assignments")
      .set("Cookie", fx.worker.cookie);
    expect(board.body.mine[0].clarification_open).toBe(false);
    expect(board.body.mine_outstanding).toBe(0);
    expect(JSON.stringify(board.body)).not.toContain("INTERNAL-ONLY");
  });
});

describe("VA-D1 — revocation releases work without guessing a successor", () => {
  it("a revoked participant's assignments become visibly unassigned", async () => {
    const fx = await buildFixture("Revoke");
    await assign(fx.coordinator.cookie, fx.reqA1, fx.worker.participantId);
    await assign(fx.coordinator.cookie, fx.reqA2, fx.worker.participantId);
    await request(app)
      .put(`/api/vendor-portal/questions/${fx.reqA1}`)
      .set("Cookie", fx.worker.cookie)
      .send({ answer: "pass", notes: "REVOKE-FIXTURE-ANSWER" });

    const revoke = await request(app)
      .post(`/api/vendor-engagements/${fx.engagementId}/participants/${fx.worker.participantId}/revoke`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ reason: "left the company" });
    expect(revoke.status, JSON.stringify(revoke.body)).toBe(200);
    expect(revoke.body.assignments_vacated).toBe(2);

    // Unowned, with the reason on the record — never handed to someone else.
    const rows = await pool.query<{ assigned_to_participant_id: string | null; assignment_action: string }>(
      `SELECT assigned_to_participant_id, assignment_action
         FROM vendor_engagement_assignments
        WHERE engagement_id = $1 AND superseded_at IS NULL
          AND requirement_id IN ($2, $3)`,
      [fx.engagementId, fx.reqA1, fx.reqA2]
    );
    expect(rows.rowCount).toBe(2);
    for (const r of rows.rows) {
      expect(r.assigned_to_participant_id).toBeNull();
      expect(r.assignment_action).toBe("vacated_on_revocation");
    }

    // Their answer and its attribution survive untouched.
    const answer = await pool.query<{ notes: string }>(
      `SELECT notes FROM requirement_responses WHERE engagement_id = $1 AND requirement_id = $2`,
      [fx.engagementId, fx.reqA1]
    );
    expect(answer.rows[0]!.notes).toBe("REVOKE-FIXTURE-ANSWER");

    // And the coordinator can see the work needs a home.
    const board = await request(app)
      .get("/api/vendor-portal/assignments")
      .set("Cookie", fx.coordinator.cookie);
    expect(board.body.unassigned).toBe(3);
  });

  it("a revoked participant cannot read assignments at all", async () => {
    const fx = await buildFixture("Locked");
    await assign(fx.coordinator.cookie, fx.reqA1, fx.worker.participantId);
    await request(app)
      .post(`/api/vendor-engagements/${fx.engagementId}/participants/${fx.worker.participantId}/revoke`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({});

    const res = await request(app)
      .get("/api/vendor-portal/assignments")
      .set("Cookie", fx.worker.cookie);
    expect(res.status).toBe(401);
  });

  it("work cannot be assigned TO a revoked participant", async () => {
    const fx = await buildFixture("Dead");
    await request(app)
      .post(`/api/vendor-engagements/${fx.engagementId}/participants/${fx.worker.participantId}/revoke`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({});
    const res = await assign(fx.coordinator.cookie, fx.reqA1, fx.worker.participantId);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("participant_revoked");
  });
});

describe("VA-D1 — isolation: tenant, vendor, engagement, requirement", () => {
  it("a requirement outside the FROZEN issued scope cannot be assigned", async () => {
    const fx = await buildFixture("Scope");
    // A real requirement, in the same org, in a framework this engagement uses
    // — but never issued into this engagement's scope.
    const unissued = await seedFrameworkWithRequirements(seed.orgA.id, "Scope-Extra", ["X.9"]);
    const res = await assign(fx.coordinator.cookie, unissued.requirementIds[0]!, fx.worker.participantId);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("requirement_not_in_scope");
  });

  it("a participant of the SAME VENDOR's other engagement cannot be assigned here", async () => {
    const vendorId = await seedVendor(pool, seed.orgA.id, { name: "TwoEng vendor" });
    const q1 = await newEngagement(vendorId, "TwoEng Q1");
    const q2 = await newEngagement(vendorId, "TwoEng Q2");
    const fwA = await seedFrameworkWithRequirements(seed.orgA.id, "TwoEng-A", ["T.1"]);
    const fwB = await seedFrameworkWithRequirements(seed.orgA.id, "TwoEng-B", ["T.2"]);
    await scopeIn(q1, [fwA.requirementIds[0]!]);
    await scopeIn(q1, [fwB.requirementIds[0]!]);
    await scopeIn(q2, [fwA.requirementIds[0]!]);

    const bossC = await seedContact(vendorId, "TwoEng Boss", "boss@twoeng.example");
    const otherC = await seedContact(vendorId, "TwoEng Other", "other@twoeng.example");
    const q1boss = await addParticipant(q1, bossC, "coordinator");
    const q2other = await addParticipant(q2, otherC, "coordinator");

    // Same vendor, same org, real participant — but of the OTHER engagement.
    const res = await assign(q1boss.cookie, fwA.requirementIds[0]!, q2other.participantId);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("participant_not_on_engagement");

    // And the trigger refuses it even below the route.
    await expect(
      pool.query(
        `INSERT INTO vendor_engagement_assignments
           (organization_id, vendor_id, engagement_id, requirement_id,
            assigned_to_participant_id, assignment_action)
         VALUES ($1, $2, $3, $4, $5, 'assigned')`,
        [seed.orgA.id, vendorId, q1, fwA.requirementIds[0]!, q2other.participantId]
      )
    ).rejects.toThrow(/not a participant of engagement/);
  });

  it("a coordinator cannot assign ANOTHER vendor's participant", async () => {
    const beta = await buildFixture("Beta");
    const res = await assign(alpha.coordinator.cookie, alpha.reqA2, beta.worker.participantId);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("participant_not_on_engagement");
  });

  it("a coordinator cannot assign a requirement from another engagement", async () => {
    const beta = await buildFixture("Cross");
    const res = await assign(alpha.coordinator.cookie, beta.reqA1, alpha.worker.participantId);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("requirement_not_in_scope");
  });

  it("a coordinator cannot bulk-assign another engagement's framework", async () => {
    const beta = await buildFixture("BulkCross");
    const res = await request(app)
      .post("/api/vendor-portal/assignments/framework")
      .set("Cookie", alpha.coordinator.cookie)
      .send({ framework_id: beta.frameworkA, participant_id: alpha.worker.participantId });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("framework_not_in_scope");

    // Nothing was written for the other engagement's questions.
    const leaked = await pool.query(
      `SELECT 1 FROM vendor_engagement_assignments WHERE requirement_id = $1`,
      [beta.reqA1]
    );
    expect(leaked.rowCount).toBe(0);
  });

  it("a participant cannot enumerate another engagement's assignments", async () => {
    const beta = await buildFixture("Enum");
    await assign(beta.coordinator.cookie, beta.reqA1, beta.worker.participantId);

    const board = await request(app)
      .get("/api/vendor-portal/assignments")
      .set("Cookie", alpha.coordinator.cookie);
    const ids = board.body.items.map((i: { requirement_id: string }) => i.requirement_id);
    expect(ids).not.toContain(beta.reqA1);
    expect(JSON.stringify(board.body)).not.toContain("Enum Hand");
  });

  it("org B cannot read org A's progress or participants", async () => {
    const res = await request(app)
      .get(`/api/vendor-engagements/${alpha.engagementId}/progress`)
      .set("X-Api-Key", seed.orgB.apiKey);
    expect(res.status).toBe(404);
  });

  it("the customer progress read works for the owning org — the previous test is not vacuous", async () => {
    const res = await request(app)
      .get(`/api/vendor-engagements/${alpha.engagementId}/progress`)
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    // The customer sees contribution shape, never the per-question delegation map.
    expect(res.body).not.toHaveProperty("items");
    expect(Array.isArray(res.body.contributors)).toBe(true);
  });

  it("a portal session cannot reach the customer progress route", async () => {
    const res = await request(app)
      .get(`/api/vendor-engagements/${alpha.engagementId}/progress`)
      .set("Cookie", alpha.coordinator.cookie);
    expect([401, 403]).toContain(res.status);
  });
});
