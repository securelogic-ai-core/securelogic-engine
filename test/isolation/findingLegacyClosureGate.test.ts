/**
 * findingLegacyClosureGate.test.ts — the closure gate, ENFORCING.
 * SECURELOGIC_FINDING_CLOSURE_GATE_ENABLED = true for this suite.
 *
 * THE RULE: a Finding may not close while its remediation Actions remain incomplete,
 * unless the risk is formally accepted.
 *
 * The legacy `status` axis had no gate. Through the compat bridge it force-writes
 * operational_status='closed', so `PATCH {"status":"closed"}` closed a Finding with open
 * remediation outright: operational_status stopped being system-derived (a client dictated
 * it), and the Finding's Actions were left OPEN under a closed parent, still sitting in
 * their owner's My Actions queue. In production the Decision Workspace is dark, so the
 * legacy axis is the ONLY closure path a customer has — which is why the hole mattered.
 *
 * The OFF position — the legacy contract, preserved byte for byte — is asserted in
 * findingClosureGateFlagOff.test.ts, which needs its own process to hold the opposite
 * position on the same environment variable.
 *
 * Proved here, over the REAL app and a REAL Postgres:
 *   1. open remediation ⇒ 409, and the Finding is genuinely NOT closed on either axis;
 *   2. BLOCKED work counts as outstanding;
 *   3. a Finding with NO actions still closes — a false positive is not blocked by a rule
 *      about finishing remediation;
 *   4. once the work is done (derives to 'remediated'), it closes;
 *   5. `accepted` is gated too — the other legacy terminal is not an unguarded synonym;
 *   6. non-closing writes (in_progress, priority) are untouched by the gate;
 *   7. an approved, unexpired acceptance closes it despite open work — the second limb of
 *      the rule, not an exception to it;
 *   8. an EXPIRED acceptance does not — expiry lives in the predicate, so a lapsed
 *      acceptance stops closing its Finding without waiting for the expiry worker to sweep;
 *   9. the APPROVED GOVERNANCE PATH still closes — propose → approve, over the real routes,
 *      with work outstanding. The gate must never block a governance closure;
 *  10. the VALIDATION path (decision_state='resolved') is unchanged in both directions;
 *  11. cross-org: another tenant cannot close this Finding, and gets no 409 either — a
 *      refusal that leaked existence would be its own bug;
 *  12. a refusal mutates NOTHING and writes no lifecycle event; a real close writes one.
 *
 * REQUIRED vs OPTIONAL remediation: the `actions` model does not distinguish them (no
 * required/blocking/mandatory column exists — `priority` is a scheduling hint no closure
 * logic consults). Every linked, non-terminal Action blocks, which is the same set
 * deriveOperationalStatus already refuses to call 'remediated'. There is no optional-action
 * case to test because the domain model cannot express one.
 */

process.env.JWT_SECRET ??= "test-jwt-secret-for-closure-gate";
process.env.SECURELOGIC_FINDING_CLOSURE_GATE_ENABLED = "true";
// The gate's second limb consults acceptances only when the acceptance feature is live,
// and the derivation applies the same condition — the two must agree, so both are on here.
process.env.SECURELOGIC_RISK_ACCEPTANCE_ENABLED = "true";
// The governance axis lives behind the Decision Workspace flag; case 10 drives it.
process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED = "true";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, seedFinding, seedUser, type TestDbSeed } from "./testDb.js";
import { signJwt } from "../../src/api/lib/jwt.js";
import { recordAllCurrentConsents } from "../../src/api/lib/legalConsent.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;

let ownerA = "";
let jwtRequesterA = "";
let jwtApproverA = "";

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the closure-gate test.");
  pool = new Pool({ connectionString: url, ssl: false });

  const uReq = await seedUser(pool, seed.orgA.id, { email: "requester@gate.test" });
  const uApp = await seedUser(pool, seed.orgA.id, { email: "approver@gate.test" });
  const uOwn = await seedUser(pool, seed.orgA.id, { email: "owner@gate.test" });
  ownerA = uOwn.id;

  // requireConsent gates every JWT session app-wide; without current consents each request
  // 403s with consent_required before it ever reaches a route.
  for (const u of [uReq, uApp, uOwn]) {
    await recordAllCurrentConsents(pool, {
      userId: u.id,
      organizationId: seed.orgA.id,
      consentMethod: "admin_recorded",
    });
  }
  jwtRequesterA = signJwt(uReq.id, seed.orgA.id, "admin");
  jwtApproverA = signJwt(uApp.id, seed.orgA.id, "admin");

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

const patch = (findingId: string, body: Record<string, unknown>, apiKey = seed.orgA.apiKey) =>
  request(app).patch(`/api/findings/${findingId}`).set("X-Api-Key", apiKey).send(body);

const auth = (m: "get" | "post", path: string, jwt: string) =>
  request(app)[m](path).set("Authorization", `Bearer ${jwt}`);

async function seedAction(findingId: string, status: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO actions (organization_id, title, source_type, source_id, priority, status)
     VALUES ($1, 'Remediate it', 'finding', $2, 'planned', $3)
     RETURNING id`,
    [seed.orgA.id, findingId, status]
  );
  return r.rows[0]!.id;
}

/**
 * Seed an APPROVED acceptance directly. The approval CHECK requires owner + rationale +
 * approver + approved_at + expires_at, and the SoD CHECK forbids approver == requester — so
 * this seeds two distinct users, as a real approval would have. `expiresAt` is the only
 * interesting axis: SQL_ACCEPTANCE_BINDING tests it in the PREDICATE.
 */
async function seedApprovedAcceptance(findingId: string, expiresAt: string): Promise<void> {
  const owner = await seedUser(pool, seed.orgA.id);
  const approver = await seedUser(pool, seed.orgA.id);
  await pool.query(
    `INSERT INTO finding_risk_acceptances
       (organization_id, finding_id, state, owner_user_id, rationale,
        requested_by_user_id, approver_user_id, approved_at, expires_at)
     VALUES ($1, $2, 'approved', $3, 'Compensating control in place', $3, $4, NOW(), $5)`,
    [seed.orgA.id, findingId, owner.id, approver.id, expiresAt]
  );
}

async function axes(findingId: string) {
  const r = await pool.query<{
    status: string;
    operational_status: string;
    decision_state: string;
    updated_at: string;
  }>(
    `SELECT status, operational_status, decision_state, updated_at
       FROM findings WHERE id = $1`,
    [findingId]
  );
  return r.rows[0]!;
}

async function lifecycleEventCount(findingId: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM finding_lifecycle_events WHERE finding_id = $1`,
    [findingId]
  );
  return Number(r.rows[0]!.n);
}

async function actionStatus(actionId: string): Promise<string> {
  const r = await pool.query<{ status: string }>(`SELECT status FROM actions WHERE id = $1`, [
    actionId,
  ]);
  return r.rows[0]!.status;
}

describe("the legacy status axis honours the closure gate (flag ON)", () => {
  it("REFUSES to close a finding that still has open remediation actions", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "Has open work" });
    await seedAction(findingId, "open");
    await seedAction(findingId, "in_progress");

    const res = await patch(findingId, { status: "closed" });

    // The 409 contract. Integrations branch on `error`, so it is a stable string.
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("close_requires_remediation_complete");
    expect(res.body.open_actions).toBe(2);
    // It must tell the reader what to DO, not merely refuse.
    expect(res.body.message).toContain("Close or cancel");
    expect(res.body.message).toContain("risk acceptance");

    // And it must genuinely not be closed — on EITHER axis. A 409 that still wrote
    // operational_status would be the same bug wearing an error code.
    const after = await axes(findingId);
    expect(after.status).not.toBe("closed");
    expect(after.operational_status).not.toBe("closed");
  });

  it("counts BLOCKED work as open — blocked remediation is still outstanding remediation", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "Blocked work" });
    await seedAction(findingId, "blocked");

    const res = await patch(findingId, { status: "closed" });

    expect(res.status).toBe(409);
    expect(res.body.open_actions).toBe(1);
    // Singular, not "1 actions".
    expect(res.body.message).toContain("1 open remediation action.");
  });

  it("still closes a finding with NO actions — a false positive is not blocked", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "False positive" });

    const res = await patch(findingId, { status: "closed" });

    expect(res.status).toBe(200);
    const after = await axes(findingId);
    expect(after.status).toBe("closed");
    // The bridge drags the authoritative axis with it, in the same statement.
    expect(after.operational_status).toBe("closed");
  });

  it("closes once the remediation is genuinely complete", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "Work finished" });
    const a1 = await seedAction(findingId, "open");

    expect((await patch(findingId, { status: "closed" })).status).toBe(409);

    // Finish the work. Closing the last action derives the parent to 'remediated' —
    // remediation done, awaiting the governance call.
    await request(app)
      .patch(`/api/actions/${a1}`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ status: "closed" });
    expect((await axes(findingId)).operational_status).toBe("remediated");

    const res = await patch(findingId, { status: "closed" });
    expect(res.status).toBe(200);
    expect((await axes(findingId)).operational_status).toBe("closed");
  });

  it("gates 'accepted' too — the other legacy terminal is not an unguarded synonym for closed", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "Accept instead" });
    await seedAction(findingId, "open");

    const res = await patch(findingId, { status: "accepted" });

    // 'accepted' writes operational_status='closed' through the same bridge, so gating only
    // 'closed' would leave the door open one word to the left.
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("close_requires_remediation_complete");
    expect((await axes(findingId)).operational_status).not.toBe("closed");
  });

  it("does not interfere with non-closing writes", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "Still working" });
    await seedAction(findingId, "open");

    // The gate is about CLOSURE. Moving a finding to in_progress, or setting its priority,
    // has nothing to do with outstanding remediation and must not be refused.
    expect((await patch(findingId, { status: "in_progress" })).status).toBe(200);
    expect((await patch(findingId, { priority: "immediate" })).status).toBe(200);

    expect((await axes(findingId)).operational_status).not.toBe("closed");
  });
});

describe("approved governance closure is never blocked by the gate", () => {
  it("closes despite open actions when a binding acceptance carries the risk", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "Accepted, work outstanding" });
    await seedAction(findingId, "open");

    // Without the acceptance this is a 409 (proven above). The gate is not a hard block on
    // outstanding work — it demands the work be finished OR the risk formally carried.
    await seedApprovedAcceptance(findingId, "2027-01-01");

    const res = await patch(findingId, { status: "closed" });

    expect(res.status).toBe(200);
    expect((await axes(findingId)).operational_status).toBe("closed");
  });

  it("REFUSES when the acceptance has EXPIRED — a lapsed acceptance is not an acceptance", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "Acceptance ran out" });
    await seedAction(findingId, "open");

    // Still `state='approved'` — only its review date has passed. If the gate tested the
    // state alone it would treat a permanent pardon as governance, and a customer could
    // close outstanding work behind an acceptance nobody has revisited.
    await seedApprovedAcceptance(findingId, "2020-01-01");

    const res = await patch(findingId, { status: "closed" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("close_requires_remediation_complete");
    expect((await axes(findingId)).operational_status).not.toBe("closed");
  });

  it("the ACCEPTED-RISK ROUTE still closes a finding with work outstanding", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "Route-driven acceptance" });
    await seedAction(findingId, "open");

    // The real governance path, over the real routes: propose, then approve as someone
    // else. This closure does not go through the legacy axis at all — it closes via the
    // derivation's hasBindingAcceptance limb — and the gate must not interfere with it.
    const proposed = await auth("post", `/api/findings/${findingId}/risk-acceptance`, jwtRequesterA)
      .send({
        owner_user_id: ownerA,
        rationale: "Compensating control in place; cost of fix exceeds exposure.",
        expires_at: "2027-01-01",
      });
    expect(proposed.status).toBe(201);

    // A PROPOSAL is not an APPROVAL — still open, still gated.
    expect((await axes(findingId)).operational_status).not.toBe("closed");
    expect((await patch(findingId, { status: "closed" })).status).toBe(409);

    const approved = await auth(
      "post",
      `/api/risk-acceptances/${proposed.body.acceptance.id}/approve`,
      jwtApproverA
    ).send({ decision_rationale: "Reviewed at the risk committee." });
    expect(approved.status).toBe(200);

    // Approval closed it, with the action still open. That is the point of an acceptance.
    expect((await axes(findingId)).operational_status).toBe("closed");
  });

  it("the VALIDATION path is unchanged — gated before remediation, open after", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "Governance close" });
    const a1 = await seedAction(findingId, "open");

    // The governance axis was ALREADY gated (it demands 'remediated'), and this package
    // does not touch it. Refused while work is outstanding...
    const early = await patch(findingId, { decision_state: "resolved" });
    expect(early.status).toBe(409);
    expect((await axes(findingId)).operational_status).not.toBe("closed");

    await request(app)
      .patch(`/api/actions/${a1}`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ status: "closed" });

    // ...and permitted once it is not.
    const ok = await patch(findingId, { decision_state: "resolved" });
    expect(ok.status).toBe(200);
    expect((await axes(findingId)).operational_status).toBe("closed");
  });
});

describe("isolation, audit, and the no-partial-mutation guarantee", () => {
  it("another tenant cannot close this finding — and gets no 409 either", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "Org A's finding" });
    await seedAction(findingId, "open");

    const res = await patch(findingId, { status: "closed" }, seed.orgB.apiKey);

    // Org B must not close it. It must also NOT receive the gate's 409: that would confirm
    // the finding exists AND leak how much remediation work org A has outstanding. The
    // cross-tenant refusal has to win before the gate is ever consulted.
    expect(res.status).toBe(404);
    expect(res.body.error).not.toBe("close_requires_remediation_complete");
    expect(res.body.open_actions).toBeUndefined();

    const after = await axes(findingId);
    expect(after.status).not.toBe("closed");
    expect(after.operational_status).not.toBe("closed");
  });

  it("a refusal mutates NOTHING and writes no lifecycle event", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "Refusal is inert" });
    const a1 = await seedAction(findingId, "open");

    const before = await axes(findingId);
    const eventsBefore = await lifecycleEventCount(findingId);

    const res = await patch(findingId, { status: "closed" });
    expect(res.status).toBe(409);

    // Every axis byte-identical: the gate refuses BEFORE any write, so there is no partial
    // state to reconcile and no phantom "closed" event in the audit trail. An audit trail
    // that records closures that did not happen is worse than none.
    const after = await axes(findingId);
    expect(after.status).toBe(before.status);
    expect(after.operational_status).toBe(before.operational_status);
    expect(after.decision_state).toBe(before.decision_state);
    expect(after.updated_at).toEqual(before.updated_at);
    expect(await lifecycleEventCount(findingId)).toBe(eventsBefore);

    // The action is untouched too — a refused close must not quietly cancel the work.
    expect(await actionStatus(a1)).toBe("open");
  });

  it("a governance close still writes its lifecycle event — the gate silenced no audit trail", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "Audited close" });

    // The governance axis demands operational_status === 'remediated', and a finding with
    // NO actions derives 'open' — never 'remediated' — so it cannot be closed on that axis
    // at all. (An asymmetry with the legacy axis, which closes a no-action finding happily.
    // Pre-existing, out of scope here, reported separately.) So: give it work, finish it.
    const a1 = await seedAction(findingId, "open");
    await request(app)
      .patch(`/api/actions/${a1}`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ status: "closed" });
    expect((await axes(findingId)).operational_status).toBe("remediated");

    const eventsBefore = await lifecycleEventCount(findingId);
    expect((await patch(findingId, { decision_state: "resolved" })).status).toBe(200);

    expect(await lifecycleEventCount(findingId)).toBeGreaterThan(eventsBefore);
    expect((await axes(findingId)).operational_status).toBe("closed");
  });

  it("documents that a LEGACY close writes no lifecycle event — a pre-existing gap, not this gate's", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "Legacy close, unaudited" });
    const eventsBefore = await lifecycleEventCount(findingId);

    expect((await patch(findingId, { status: "closed" })).status).toBe(200);
    expect((await axes(findingId)).operational_status).toBe("closed");

    // PRE-EXISTING GAP, asserted so it cannot change unnoticed and so nobody reads the gate
    // as its cause. Lifecycle events are written on the DECISION axis only (findings.ts
    // :1529, :1816), and recomputeFindingOperationalStatus emits one only when
    // operational_status actually CHANGES (findingLifecycle.ts:171). The legacy PATCH
    // force-writes operational_status='closed' inline through the compat bridge, so by the
    // time the recompute runs there is no change left to record.
    //
    // Net: the closure path customers actually use in production today — the Decision
    // Workspace being dark — leaves NO audit event. That is worth fixing; it is not in this
    // package's scope, and this gate neither caused it nor made it worse. Raised separately.
    expect(await lifecycleEventCount(findingId)).toBe(eventsBefore);
  });
});
