/**
 * riskAcceptanceLifecycle.test.ts — the accepted-risk lifecycle, end to end, real Postgres.
 *
 * Product ruling 2026-07-12:
 *
 *   decision_state='accepted_risk'  = the explicit human governance decision.
 *   operational_status='closed'     = no remediation work remains, AFTER the required
 *                                     risk-acceptance approval is complete.
 *   The accepted exposure stays GOVERNED — closing the Finding must not remove
 *   organizational visibility of the risk.
 *
 * Proves the six properties the ruling requires:
 *   1. accepted Findings leave Active Findings after approval (and NOT before);
 *   2. accepted risks remain discoverable through accepted-risk reporting;
 *   3. review/expiration dates drive governance workflows;
 *   4. expiration or withdrawal correctly REOPENS the Finding;
 *   5. audit history remains complete (and WORM);
 *   6. tenant isolation is preserved.
 *
 * Plus the two invariants that make it safe to ship:
 *   - a PROPOSAL is not an APPROVAL: proposing leaves the finding fully Active;
 *   - the legacy accepted population does not move, in either flag position.
 */

process.env.JWT_SECRET ??= "test-jwt-secret-for-risk-acceptance";
// Enforcement ON for this suite. Production ships with it OFF; that contract is asserted
// in riskAcceptanceFlagOff.test.ts, which needs its own process to hold the opposite
// position on the same environment variable.
process.env.SECURELOGIC_RISK_ACCEPTANCE_ENABLED = "true";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";
import { signJwt } from "../../src/api/lib/jwt.js";
import { recordAllCurrentConsents } from "../../src/api/lib/legalConsent.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;

let requesterA = "";
let approverA = "";
let ownerA = "";
let jwtRequesterA = "";
let jwtApproverA = "";
let jwtB = "";

/** Findings closed by the LEGACY accepted path, seeded before the migration's backfill view. */
let legacyAcceptedIds: string[] = [];

const auth = (m: "get" | "post", path: string, jwt: string) =>
  request(app)[m](path).set("Authorization", `Bearer ${jwt}`);

async function mkFinding(orgId: string, title: string, status = "open"): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, status)
     VALUES ($1, $2, 'High', 'risk-acceptance seed', 'manual', $3) RETURNING id`,
    [orgId, title, status]
  );
  return r.rows[0]!.id;
}

/** The current Active-Findings population, straight from the canonical predicate. */
async function activeCount(orgId: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM findings
      WHERE organization_id = $1 AND operational_status <> 'closed'`,
    [orgId]
  );
  return Number(r.rows[0]!.n);
}

async function findingRow(id: string) {
  const r = await pool.query<{
    status: string; operational_status: string; decision_state: string;
  }>(`SELECT status, operational_status, decision_state FROM findings WHERE id = $1`, [id]);
  return r.rows[0]!;
}

/** Propose → approve, the happy path. Returns the acceptance id. */
async function acceptAndApprove(findingId: string, expiresAt: string): Promise<string> {
  const proposed = await auth("post", `/api/findings/${findingId}/risk-acceptance`, jwtRequesterA)
    .send({ owner_user_id: ownerA, rationale: "Compensating control in place; cost of fix exceeds exposure.", expires_at: expiresAt });
  expect(proposed.status).toBe(201);

  const approved = await auth("post", `/api/risk-acceptances/${proposed.body.acceptance.id}/approve`, jwtApproverA)
    .send({ decision_rationale: "Reviewed at the risk committee." });
  expect(approved.status).toBe(200);
  return proposed.body.acceptance.id;
}

function isoInDays(days: number): string {
  // Offsets must be relative to TODAY, not to a fixed anchor. This used to be
  // `Date.UTC(2026, 6, 12)` — a hard-coded 2026-07-12 — so `isoInDays(10)` meant
  // the literal date 2026-07-22 forever. The review-queue summary counts an
  // acceptance only while `expires_at >= CURRENT_DATE` (riskAcceptances.ts:729),
  // so on 2026-07-23 that row silently moved into `lapsed_pending_sweep` and the
  // review-window test began failing on a calendar boundary rather than on a code
  // change. Anchoring to the current UTC date removes that cliff for every offset.
  //
  // Truncated to UTC midnight so the value stays a stable YYYY-MM-DD for the whole
  // run and cannot shift if the clock crosses midnight mid-suite.
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the risk-acceptance test.");
  pool = new Pool({ connectionString: url, ssl: false });

  const uReq = await seedUser(pool, seed.orgA.id, { email: "requester@a.test" });
  const uApp = await seedUser(pool, seed.orgA.id, { email: "approver@a.test" });
  const uOwn = await seedUser(pool, seed.orgA.id, { email: "owner@a.test" });
  const uB = await seedUser(pool, seed.orgB.id, { email: "user@b.test" });
  requesterA = uReq.id; approverA = uApp.id; ownerA = uOwn.id;

  // requireConsent gates every JWT session app-wide. Without current consents each
  // request 403s with consent_required before it ever reaches an acceptance route.
  for (const [u, org] of [
    [uReq, seed.orgA.id],
    [uApp, seed.orgA.id],
    [uOwn, seed.orgA.id],
    [uB, seed.orgB.id],
  ] as const) {
    await recordAllCurrentConsents(pool, {
      userId: u.id,
      organizationId: org,
      consentMethod: "admin_recorded",
    });
  }

  jwtRequesterA = signJwt(requesterA, seed.orgA.id, "admin");
  jwtApproverA = signJwt(approverA, seed.orgA.id, "admin");
  jwtB = signJwt(uB.id, seed.orgB.id, "admin");

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });

  // The LEGACY accepted population — closed by the old `status='accepted'` bridge, with
  // no approver, no rationale and no expiry, because there was nowhere to put them.
  // The migration backfilled these as `legacy_unverified` acceptances.
  legacyAcceptedIds = [
    await mkFinding(seed.orgA.id, "legacy accepted 1", "accepted"),
    await mkFinding(seed.orgA.id, "legacy accepted 2", "accepted"),
  ];
  await pool.query(
    `UPDATE findings SET decision_state = 'accepted_risk' WHERE id = ANY($1::uuid[])`,
    [legacyAcceptedIds]
  );
  // Re-run the migration's backfill for rows created after it ran (the harness applies
  // migrations before this seed). Same statement, same idempotence.
  await pool.query(
    `INSERT INTO finding_risk_acceptances
       (organization_id, finding_id, state, governance_review_required, created_at)
     SELECT f.organization_id, f.id, 'legacy_unverified', TRUE, f.updated_at
       FROM findings f
      WHERE f.decision_state = 'accepted_risk' AND f.operational_status = 'closed'
        AND NOT EXISTS (SELECT 1 FROM finding_risk_acceptances a
                         WHERE a.finding_id = f.id
                           AND a.state IN ('proposed','approved','legacy_unverified'))`
  );
}, 300_000);

afterAll(async () => {
  await pool?.end();
});

describe("Risk acceptance — a proposal is not an approval", () => {
  it("proposing leaves the finding fully ACTIVE", async () => {
    const f = await mkFinding(seed.orgA.id, "prop-only");
    const before = await activeCount(seed.orgA.id);

    const res = await auth("post", `/api/findings/${f}/risk-acceptance`, jwtRequesterA)
      .send({ owner_user_id: ownerA, rationale: "Awaiting committee.", expires_at: isoInDays(90) });

    expect(res.status).toBe(201);
    expect(res.body.acceptance.state).toBe("proposed");

    // The finding has NOT moved. Accepting a risk is a decision that requires sign-off;
    // until it has one, the work is still live. If a mere proposal closed the finding,
    // anyone with PATCH access could retire a Critical finding unilaterally.
    const row = await findingRow(f);
    expect(row.operational_status).not.toBe("closed");
    expect(row.decision_state).not.toBe("accepted_risk");
    expect(await activeCount(seed.orgA.id)).toBe(before);
  });

  it("an acceptance with no expiry is refused — no permanent pardons", async () => {
    const f = await mkFinding(seed.orgA.id, "no-expiry");
    const res = await auth("post", `/api/findings/${f}/risk-acceptance`, jwtRequesterA)
      .send({ owner_user_id: ownerA, rationale: "Forever, please." });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("expires_at_required");
  });

  it("you cannot approve your own acceptance (separation of duties)", async () => {
    const f = await mkFinding(seed.orgA.id, "sod");
    const p = await auth("post", `/api/findings/${f}/risk-acceptance`, jwtRequesterA)
      .send({ owner_user_id: ownerA, rationale: "Mine.", expires_at: isoInDays(30) });
    expect(p.status).toBe(201);

    const self = await auth("post", `/api/risk-acceptances/${p.body.acceptance.id}/approve`, jwtRequesterA)
      .send({});
    expect(self.status).toBe(403);
    expect(self.body.error).toBe("separation_of_duties");

    // ...and the finding is still active, because nothing was approved.
    expect((await findingRow(f)).operational_status).not.toBe("closed");
  });

  it("only ONE live acceptance per finding", async () => {
    const f = await mkFinding(seed.orgA.id, "dup");
    const a = await auth("post", `/api/findings/${f}/risk-acceptance`, jwtRequesterA)
      .send({ owner_user_id: ownerA, rationale: "One.", expires_at: isoInDays(30) });
    expect(a.status).toBe(201);
    const b = await auth("post", `/api/findings/${f}/risk-acceptance`, jwtRequesterA)
      .send({ owner_user_id: ownerA, rationale: "Two.", expires_at: isoInDays(30) });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe("acceptance_already_live_for_finding");
  });
});

describe("Risk acceptance — approval closes the Finding (ruling steps 4 & 5)", () => {
  it("an approved acceptance sets BOTH axes and leaves Active Findings", async () => {
    const f = await mkFinding(seed.orgA.id, "approve-closes");
    const before = await activeCount(seed.orgA.id);

    await acceptAndApprove(f, isoInDays(180));

    const row = await findingRow(f);
    // Ruling step 4: decision_state and operational_status, together.
    expect(row.decision_state).toBe("accepted_risk");
    expect(row.operational_status).toBe("closed");
    // The legacy compat axis agrees — findings_closure_axes_agree is non-deferrable, so
    // if these ever disagreed the UPDATE above would have thrown instead of returning 200.
    expect(["closed", "accepted"]).toContain(row.status);

    // Ruling step 5: it left the Active population.
    expect(await activeCount(seed.orgA.id)).toBe(before - 1);
  });

  it("it disappears from the Active list and from the remediation queues", async () => {
    const f = await mkFinding(seed.orgA.id, "queues-drop-it");
    await acceptAndApprove(f, isoInDays(180));

    const active = await auth("get", "/api/findings?active=true", jwtRequesterA);
    expect(active.status).toBe(200);
    const ids = active.body.findings.map((x: { id: string }) => x.id);
    expect(ids).not.toContain(f);

    // The ops-center work queues are all built on the Active predicate, so the summary's
    // active_total is the one number that governs every one of them.
    const sum = await auth("get", "/api/findings/summary", jwtRequesterA);
    const listed = await auth("get", "/api/findings?active=true", jwtRequesterA);
    expect(listed.body.total).toBe(sum.body.summary.active_total);
  });
});

describe("Risk acceptance — the exposure stays GOVERNED (ruling step 6)", () => {
  it("a closed accepted-risk Finding is still discoverable in accepted-risk reporting", async () => {
    const f = await mkFinding(seed.orgA.id, "still-visible");
    const acceptanceId = await acceptAndApprove(f, isoInDays(120));

    // THE durable-visibility property. Closing the operational Finding must not remove
    // organizational visibility of the accepted exposure — otherwise "accept" would just
    // be a delete with extra steps.
    const reg = await auth("get", "/api/risk-acceptances?state=approved", jwtRequesterA);
    expect(reg.status).toBe(200);

    const mine = reg.body.acceptances.find((a: { id: string }) => a.id === acceptanceId);
    expect(mine).toBeTruthy();
    // ...carrying everything a governance record has to carry.
    expect(mine.owner_user_id).toBe(ownerA);
    expect(mine.approver_user_id).toBe(approverA);
    expect(mine.rationale).toBeTruthy();
    expect(mine.approved_at).toBeTruthy();
    expect(mine.expires_at).toBeTruthy();
    // ...and it still names the finding it retired, which is now closed.
    expect(mine.finding_id).toBe(f);
    expect(mine.finding_operational_status).toBe("closed");
    expect(mine.finding_title).toBe("still-visible");
  });

  it("the decision_state=accepted_risk filter still finds it (it is not erased by closure)", async () => {
    const f = await mkFinding(seed.orgA.id, "decision-state-survives");
    await acceptAndApprove(f, isoInDays(120));

    // Before this package the governance CLOSE path overwrote accepted_risk with
    // 'resolved' — accepting a risk erased the fact that it had been accepted. It doesn't.
    const res = await auth("get", "/api/findings?decision_state=accepted_risk", jwtRequesterA);
    expect(res.status).toBe(200);
    expect(res.body.findings.map((x: { id: string }) => x.id)).toContain(f);

    const sum = await auth("get", "/api/findings/summary", jwtRequesterA);
    expect(sum.body.summary.accepted_risk_total).toBeGreaterThan(0);
  });
});

describe("Risk acceptance — per-finding read (?finding_id, the Decision Workspace surface)", () => {
  it("returns a finding's live acceptance AND its terminal history, and composes with ?state", async () => {
    const f = await mkFinding(seed.orgA.id, "finding-history");

    // A first proposal, rejected — this is now terminal audit history.
    const p1 = await auth("post", `/api/findings/${f}/risk-acceptance`, jwtRequesterA)
      .send({ owner_user_id: ownerA, rationale: "first attempt", expires_at: isoInDays(90) });
    expect(p1.status).toBe(201);
    const rej = await auth("post", `/api/risk-acceptances/${p1.body.acceptance.id}/reject`, jwtApproverA)
      .send({ decision_rationale: "insufficient compensating control" });
    expect(rej.status).toBe(200);

    // A second proposal, still live (the partial unique index allowed it because the
    // first is terminal).
    const p2 = await auth("post", `/api/findings/${f}/risk-acceptance`, jwtRequesterA)
      .send({ owner_user_id: ownerA, rationale: "second attempt", expires_at: isoInDays(120) });
    expect(p2.status).toBe(201);

    const all = await auth("get", `/api/risk-acceptances?finding_id=${f}`, jwtRequesterA);
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);
    expect(all.body.acceptances.map((a: { id: string }) => a.id).sort()).toEqual(
      [p1.body.acceptance.id, p2.body.acceptance.id].sort()
    );
    for (const a of all.body.acceptances) expect(a.finding_id).toBe(f);

    // Composes with ?state: only the live proposal.
    const live = await auth("get", `/api/risk-acceptances?finding_id=${f}&state=proposed`, jwtRequesterA);
    expect(live.status).toBe(200);
    expect(live.body.acceptances.map((a: { id: string }) => a.id)).toEqual([p2.body.acceptance.id]);
  });

  it("is org-scoped: another tenant cannot read a finding's acceptances by id", async () => {
    const f = await mkFinding(seed.orgA.id, "cross-org-finding-read");
    await acceptAndApprove(f, isoInDays(90));

    // Org B guesses org A's finding id — the org predicate makes the result empty, never
    // another tenant's governance record.
    const res = await auth("get", `/api/risk-acceptances?finding_id=${f}`, jwtB);
    expect(res.status).toBe(200);
    expect(res.body.acceptances).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it("rejects a non-uuid finding_id with 400", async () => {
    const res = await auth("get", "/api/risk-acceptances?finding_id=not-a-uuid", jwtRequesterA);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_finding_id");
  });

  it("a finding with NO acceptance returns [] even when the org register is non-empty", async () => {
    // The empty case, which the tests above do not cover — and it is the one the Decision
    // Workspace is most exposed to. Before the filter existed, the register answered with
    // the org's OTHER acceptances here, and the panel rendered a stranger's binding record
    // as this finding's own: a phantom accepted risk, on which approve/withdraw then acted.
    // [] must read as "none for THIS finding", never as "the feature is off".
    const accepted = await mkFinding(seed.orgA.id, "register-populated");
    await acceptAndApprove(accepted, isoInDays(90));
    const bare = await mkFinding(seed.orgA.id, "no-acceptance-yet");

    const res = await auth("get", `/api/risk-acceptances?finding_id=${bare}`, jwtRequesterA);
    expect(res.status).toBe(200);
    expect(res.body.acceptances).toEqual([]);
    expect(res.body.total).toBe(0);

    // ...while the unfiltered register still holds the other finding's acceptance, so the
    // emptiness above is the filter working, not an empty org.
    const reg = await auth("get", "/api/risk-acceptances", jwtRequesterA);
    expect(reg.body.acceptances.length).toBeGreaterThan(0);
  });
});

describe("Risk acceptance — review and expiration drive governance (ruling step 3)", () => {
  it("an acceptance nearing its review date appears in the review queue", async () => {
    const f = await mkFinding(seed.orgA.id, "review-soon");
    await acceptAndApprove(f, isoInDays(10)); // inside the 30-day review window

    const summary = await auth("get", "/api/risk-acceptances/summary", jwtRequesterA);
    expect(summary.status).toBe(200);
    expect(summary.body.summary.review_due_30d).toBeGreaterThan(0);

    const due = await auth("get", "/api/risk-acceptances?expiring_within_days=30", jwtRequesterA);
    expect(due.body.acceptances.map((a: { finding_id: string }) => a.finding_id)).toContain(f);
  });

  it("a LAPSED acceptance stops closing its finding immediately — before the worker runs", async () => {
    const f = await mkFinding(seed.orgA.id, "lapsed-derivation");
    const acceptanceId = await acceptAndApprove(f, isoInDays(30));
    expect((await findingRow(f)).operational_status).toBe("closed");

    // Backdate the expiry directly. (The WORM trigger freezes decision content on an
    // approved row, so this is done as the DB owner — simulating the passage of time,
    // which is the one thing a test cannot actually wait for.)
    await pool.query(
      `ALTER TABLE finding_risk_acceptances DISABLE TRIGGER trg_finding_risk_acceptances_worm`
    );
    await pool.query(
      `UPDATE finding_risk_acceptances SET expires_at = CURRENT_DATE - 1 WHERE id = $1`,
      [acceptanceId]
    );
    await pool.query(
      `ALTER TABLE finding_risk_acceptances ENABLE TRIGGER trg_finding_risk_acceptances_worm`
    );

    // The derivation is time-aware, so the acceptance is no longer binding RIGHT NOW —
    // posture does not wait for a cron job. Any recompute reopens the finding.
    const { runRiskAcceptanceExpirySweep } = await import(
      "../../src/api/workers/riskAcceptanceExpiryWorker.js"
    );
    const result = await runRiskAcceptanceExpirySweep();
    expect(result.expired).toBeGreaterThan(0);

    const row = await findingRow(f);
    expect(row.operational_status).not.toBe("closed");
  });
});

describe("Risk acceptance — expiry and withdrawal REOPEN the Finding (ruling step 7)", () => {
  it("expiry reopens the finding, clears BOTH axes, and returns it to Active", async () => {
    const f = await mkFinding(seed.orgA.id, "expiry-reopens");
    const acceptanceId = await acceptAndApprove(f, isoInDays(30));
    const closedActive = await activeCount(seed.orgA.id);

    await pool.query(`ALTER TABLE finding_risk_acceptances DISABLE TRIGGER trg_finding_risk_acceptances_worm`);
    await pool.query(`UPDATE finding_risk_acceptances SET expires_at = CURRENT_DATE - 1 WHERE id = $1`, [acceptanceId]);
    await pool.query(`ALTER TABLE finding_risk_acceptances ENABLE TRIGGER trg_finding_risk_acceptances_worm`);

    const { runRiskAcceptanceExpirySweep } = await import(
      "../../src/api/workers/riskAcceptanceExpiryWorker.js"
    );
    await runRiskAcceptanceExpirySweep();

    const row = await findingRow(f);
    // BOTH axes cleared together. If only one were cleared, the legacy compat bridge
    // would re-close the finding on the very next derivation and it would spring shut
    // the instant it reopened — a real deadlock, and the reason reopen is one function.
    expect(row.operational_status).not.toBe("closed");
    expect(row.status).not.toBe("closed");
    expect(row.status).not.toBe("accepted");
    // The acceptance is gone, so the finding genuinely needs a new decision.
    expect(row.decision_state).toBe("needs_review");

    expect(await activeCount(seed.orgA.id)).toBe(closedActive + 1);

    // The record itself is NOT deleted — it is the audit history.
    const rec = await pool.query<{ state: string }>(
      `SELECT state FROM finding_risk_acceptances WHERE id = $1`, [acceptanceId]
    );
    expect(rec.rows[0]!.state).toBe("expired");
  });

  it("withdrawal reopens the finding", async () => {
    const f = await mkFinding(seed.orgA.id, "withdraw-reopens");
    const acceptanceId = await acceptAndApprove(f, isoInDays(365));
    expect((await findingRow(f)).operational_status).toBe("closed");

    const res = await auth("post", `/api/risk-acceptances/${acceptanceId}/withdraw`, jwtApproverA)
      .send({ reason: "Compensating control was decommissioned." });
    expect(res.status).toBe(200);
    expect(res.body.finding_reopened).toBe(true);

    const row = await findingRow(f);
    expect(row.operational_status).not.toBe("closed");
    expect(row.decision_state).toBe("needs_review");
  });

  it("a reopened finding returns to its REAL state, not a fresh 'open'", async () => {
    // A finding whose remediation was half-done must come back as in_progress. Reopening
    // to 'open' would silently discard the fact that work was already underway.
    const f = await mkFinding(seed.orgA.id, "reopen-in-progress");
    await pool.query(
      `INSERT INTO actions (organization_id, title, source_type, source_id, priority, status)
       VALUES ($1, 'remediation', 'finding', $2, 'planned', 'in_progress')`,
      [seed.orgA.id, f]
    );

    const acceptanceId = await acceptAndApprove(f, isoInDays(365));
    expect((await findingRow(f)).operational_status).toBe("closed");

    await auth("post", `/api/risk-acceptances/${acceptanceId}/withdraw`, jwtApproverA).send({});

    // Derived from the linked Action, which is still in_progress.
    expect((await findingRow(f)).operational_status).toBe("in_progress");
  });
});

describe("Risk acceptance — audit history is complete and WORM (ruling step 5)", () => {
  it("the full decision trail survives, and the record cannot be deleted", async () => {
    const f = await mkFinding(seed.orgA.id, "audit-trail");
    const acceptanceId = await acceptAndApprove(f, isoInDays(200));

    // The acceptance record itself is append-only.
    await expect(
      pool.query(`DELETE FROM finding_risk_acceptances WHERE id = $1`, [acceptanceId])
    ).rejects.toThrow(/append-only/i);

    // ...and its decision content is frozen. An approved acceptance's expiry can never be
    // quietly extended — the whole governance value of the object depends on this.
    await expect(
      pool.query(`UPDATE finding_risk_acceptances SET expires_at = CURRENT_DATE + 3650 WHERE id = $1`, [acceptanceId])
    ).rejects.toThrow(/immutable|WORM/i);

    // The finding's own axis history is in the append-only lifecycle stream.
    const events = await pool.query<{ transition: string; axis: string }>(
      `SELECT transition, axis FROM finding_lifecycle_events WHERE finding_id = $1 ORDER BY created_at`,
      [f]
    );
    const transitions = events.rows.map((e) => e.transition);
    expect(transitions).toContain("accept_risk");        // the decision
    expect(transitions).toContain("operational_closed"); // its consequence
  });
});

describe("Risk acceptance — the legacy population does not move", () => {
  it("legacy accepted findings stay CLOSED and are flagged for governance review", async () => {
    for (const id of legacyAcceptedIds) {
      const row = await findingRow(id);
      // Not reopened. We do not reopen a customer's historical closed population.
      expect(row.operational_status).toBe("closed");
      expect(row.decision_state).toBe("accepted_risk");
    }

    // ...but every one of them is marked for a human, because NONE of them carries an
    // approver, a rationale or an expiry — there was never anywhere to store them, and
    // the ruling forbids fabricating what was never captured.
    const flagged = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM finding_risk_acceptances
        WHERE organization_id = $1 AND state = 'legacy_unverified'
          AND governance_review_required = TRUE`,
      [seed.orgA.id]
    );
    expect(Number(flagged.rows[0]!.n)).toBe(legacyAcceptedIds.length);

    const rows = await pool.query<{ approver_user_id: string | null; rationale: string | null; expires_at: string | null }>(
      `SELECT approver_user_id, rationale, expires_at FROM finding_risk_acceptances
        WHERE state = 'legacy_unverified'`
    );
    for (const r of rows.rows) {
      expect(r.approver_user_id).toBeNull();
      expect(r.rationale).toBeNull();
      expect(r.expires_at).toBeNull();
    }

    const summary = await auth("get", "/api/risk-acceptances/summary", jwtRequesterA);
    expect(summary.body.summary.governance_review_required).toBe(legacyAcceptedIds.length);
  });

  it("a legacy acceptance cannot be rubber-stamped into an approval", async () => {
    const a = await pool.query<{ id: string }>(
      `SELECT id FROM finding_risk_acceptances
        WHERE organization_id = $1 AND state = 'legacy_unverified' LIMIT 1`,
      [seed.orgA.id]
    );
    const res = await auth("post", `/api/risk-acceptances/${a.rows[0]!.id}/approve`, jwtApproverA).send({});
    // It has no owner, rationale or expiry, and inventing them is exactly what the ruling
    // forbids. Completing it means withdrawing (which reopens the finding) and proposing
    // a real acceptance.
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("legacy_acceptance_requires_completion");
  });
});

describe("Risk acceptance — the APPROVER QUEUE (?state=proposed, the /approvals surface)", () => {
  /* The subsystem shipped complete and was still not executable end-to-end: nothing in the
     app read the org-wide register, and /approvals reads risk_approvals (a different table,
     a different object). An approver could only reach a proposal via a hand-passed URL.
     These prove the contract /approvals now depends on. */

  const queue = (jwt: string) => auth("get", "/api/risk-acceptances?state=proposed", jwt);

  it("a pending proposal appears in the approver's queue, named — not as uuids", async () => {
    const f = await mkFinding(seed.orgA.id, "queue-pending");
    const p = await auth("post", `/api/findings/${f}/risk-acceptance`, jwtRequesterA)
      .send({ owner_user_id: ownerA, rationale: "Compensating control pending Q4.", expires_at: isoInDays(90) });
    expect(p.status).toBe(201);

    // The APPROVER — a different user — sees it without anyone handing them a URL.
    const res = await queue(jwtApproverA);
    expect(res.status).toBe(200);

    const row = res.body.acceptances.find((a: { id: string }) => a.id === p.body.acceptance.id);
    expect(row).toBeTruthy();
    // Everything the approver must review, and PEOPLE, not internal ids.
    expect(row.finding_title).toBe("queue-pending");
    expect(row.finding_severity).toBe("High");
    expect(row.rationale).toBe("Compensating control pending Q4.");
    expect(row.expires_at).toBeTruthy();
    expect(row.created_at).toBeTruthy();
    expect(row.requested_by_email).toBe("requester@a.test");
    expect(row.owner_email).toBe("owner@a.test");
    expect(row.evidence_count).toBe(0);
    // Not the proposer, so the approver may decide it.
    expect(row.is_self_proposed).toBe(false);
  });

  it("the proposer sees their own proposal flagged as self-proposed, and cannot approve it", async () => {
    const f = await mkFinding(seed.orgA.id, "queue-sod");
    const p = await auth("post", `/api/findings/${f}/risk-acceptance`, jwtRequesterA)
      .send({ owner_user_id: ownerA, rationale: "Mine.", expires_at: isoInDays(90) });

    // The queue TELLS the proposer why they cannot act — the UI disables on this flag.
    const mine = await queue(jwtRequesterA);
    const row = mine.body.acceptances.find((a: { id: string }) => a.id === p.body.acceptance.id);
    expect(row.is_self_proposed).toBe(true);

    // ...and the engine refuses regardless of what any UI shows. Belt and suspenders.
    // NB 403 separation_of_duties, NOT the Risk-REGISTER route's 409 sod_violation: these
    // are two different subsystems and they do not share an error contract.
    const self = await auth("post", `/api/risk-acceptances/${p.body.acceptance.id}/approve`, jwtRequesterA)
      .send({ decision_rationale: "approving my own" });
    expect(self.status).toBe(403);
    expect(self.body.error).toBe("separation_of_duties");
  });

  it("another tenant's proposal NEVER appears in the queue", async () => {
    const f = await mkFinding(seed.orgA.id, "queue-cross-org");
    const p = await auth("post", `/api/findings/${f}/risk-acceptance`, jwtRequesterA)
      .send({ owner_user_id: ownerA, rationale: "org A only.", expires_at: isoInDays(90) });

    const res = await queue(jwtB);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(p.body.acceptance.id);
    expect(JSON.stringify(res.body)).not.toContain("org A only.");
    expect(res.body.acceptances.every((a: { organization_id: string }) => a.organization_id === seed.orgB.id)).toBe(true);
  });

  it("APPROVE removes it from the queue, closes the finding, and keeps it governed", async () => {
    const f = await mkFinding(seed.orgA.id, "queue-approve");

    // Active BEFORE the decision — a proposal is not an approval, so it is live work.
    const activeBefore = await auth("get", "/api/findings?active=true", jwtApproverA);
    expect(activeBefore.body.findings.map((x: { id: string }) => x.id)).toContain(f);

    const acceptanceId = await acceptAndApprove(f, isoInDays(90));

    // Left the pending queue...
    const q = await queue(jwtApproverA);
    expect(q.body.acceptances.map((a: { id: string }) => a.id)).not.toContain(acceptanceId);

    // ...because it is decided: BOTH axes set together.
    const row = await findingRow(f);
    expect(row.decision_state).toBe("accepted_risk");
    expect(row.operational_status).toBe("closed");

    // ...and it has LEFT Active Findings. Asserted per-finding, not via a global counter:
    // this suite shares one org, so a org-wide count is a function of every other test's
    // rows and would fail for reasons that have nothing to do with this decision.
    const activeAfter = await auth("get", "/api/findings?active=true", jwtApproverA);
    expect(activeAfter.body.findings.map((x: { id: string }) => x.id)).not.toContain(f);

    // ...and still governed, not erased.
    const reg = await auth("get", "/api/risk-acceptances?state=approved", jwtApproverA);
    expect(reg.body.acceptances.map((a: { id: string }) => a.id)).toContain(acceptanceId);
  });

  it("REJECT removes it from the queue and leaves the finding ACTIVE", async () => {
    const f = await mkFinding(seed.orgA.id, "queue-reject");
    const p = await auth("post", `/api/findings/${f}/risk-acceptance`, jwtRequesterA)
      .send({ owner_user_id: ownerA, rationale: "Not good enough.", expires_at: isoInDays(90) });

    const rej = await auth("post", `/api/risk-acceptances/${p.body.acceptance.id}/reject`, jwtApproverA)
      .send({ decision_rationale: "Compensating control is not sufficient." });
    expect(rej.status).toBe(200);

    const q = await queue(jwtApproverA);
    expect(q.body.acceptances.map((a: { id: string }) => a.id)).not.toContain(p.body.acceptance.id);

    // Rejection is not closure. The work is still live.
    const row = await findingRow(f);
    expect(row.operational_status).not.toBe("closed");
    expect(row.decision_state).not.toBe("accepted_risk");

    // The rejection and its rationale are audited (the record is WORM, not deleted).
    const hist = await auth("get", `/api/risk-acceptances?finding_id=${f}`, jwtApproverA);
    const rejected = hist.body.acceptances.find((a: { id: string }) => a.id === p.body.acceptance.id);
    expect(rejected.state).toBe("rejected");
    expect(rejected.decision_rationale).toBe("Compensating control is not sufficient.");
  });

  it("WITHDRAWN and EXPIRED records are not in the pending queue", async () => {
    // Withdrawn: approved, then withdrawn — reopens the finding, leaves the queue.
    const fw = await mkFinding(seed.orgA.id, "queue-withdrawn");
    const wId = await acceptAndApprove(fw, isoInDays(90));
    const wd = await auth("post", `/api/risk-acceptances/${wId}/withdraw`, jwtApproverA)
      .send({ reason: "Compensating control failed." });
    expect(wd.status).toBe(200);
    expect((await findingRow(fw)).operational_status).not.toBe("closed"); // REOPENED

    // Expired: backdate past its review date (WORM freezes decision content, so as owner).
    const fe = await mkFinding(seed.orgA.id, "queue-expired");
    const eId = await acceptAndApprove(fe, isoInDays(30));
    await pool.query(`ALTER TABLE finding_risk_acceptances DISABLE TRIGGER trg_finding_risk_acceptances_worm`);
    await pool.query(`UPDATE finding_risk_acceptances SET state = 'expired', expires_at = CURRENT_DATE - 1 WHERE id = $1`, [eId]);
    await pool.query(`ALTER TABLE finding_risk_acceptances ENABLE TRIGGER trg_finding_risk_acceptances_worm`);

    const q = await queue(jwtApproverA);
    const ids = q.body.acceptances.map((a: { id: string }) => a.id);
    // Neither is awaiting a decision. They hold a terminal state, so the state machine —
    // not any UI filtering — is what keeps them out.
    expect(ids).not.toContain(wId);
    expect(ids).not.toContain(eId);
    expect(q.body.acceptances.every((a: { state: string }) => a.state === "proposed")).toBe(true);
  });

  it("the queue total reconciles with the summary's awaiting_approval counter", async () => {
    // The two numbers the /approvals header and the list are drawn from. If they disagree,
    // the page shows a count that does not match the rows under it.
    const q = await queue(jwtApproverA);
    const s = await auth("get", "/api/risk-acceptances/summary", jwtApproverA);
    expect(q.status).toBe(200);
    expect(s.status).toBe(200);
    expect(q.body.total).toBe(s.body.summary.awaiting_approval);
  });

  it("paginates server-side: total is the whole set, never the page length", async () => {
    // A governance queue that silently truncates reads as "that's all of them".
    const page = await auth("get", "/api/risk-acceptances?state=proposed&limit=1&offset=0", jwtApproverA);
    expect(page.status).toBe(200);
    expect(page.body.acceptances.length).toBeLessThanOrEqual(1);
    expect(page.body.limit).toBe(1);
    expect(page.body.offset).toBe(0);

    const all = await queue(jwtApproverA);
    // total must be the FULL matched set even when one row was returned.
    expect(page.body.total).toBe(all.body.total);
    expect(all.body.total).toBeGreaterThan(1);

    // The second page is a different row, not the same one again.
    const p2 = await auth("get", "/api/risk-acceptances?state=proposed&limit=1&offset=1", jwtApproverA);
    expect(p2.body.acceptances[0]?.id).not.toBe(page.body.acceptances[0]?.id);
  });

  it("refuses a nonsense page window rather than silently clamping it", async () => {
    const bad = await auth("get", "/api/risk-acceptances?state=proposed&limit=0", jwtApproverA);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_limit");

    const neg = await auth("get", "/api/risk-acceptances?state=proposed&offset=-1", jwtApproverA);
    expect(neg.status).toBe(400);
    expect(neg.body.error).toBe("invalid_offset");
  });
});

describe("Risk acceptance — tenant isolation", () => {
  it("org B cannot see, approve, or withdraw org A's acceptances", async () => {
    const f = await mkFinding(seed.orgA.id, "tenant-isolation");
    const acceptanceId = await acceptAndApprove(f, isoInDays(90));

    // Org B's register is empty — it has no acceptances of its own and must see none of A's.
    const listB = await auth("get", "/api/risk-acceptances", jwtB);
    expect(listB.status).toBe(200);
    expect(listB.body.total).toBe(0);
    expect(listB.body.acceptances).toHaveLength(0);

    const summaryB = await auth("get", "/api/risk-acceptances/summary", jwtB);
    expect(summaryB.body.summary.active_acceptances).toBe(0);
    expect(summaryB.body.summary.governance_review_required).toBe(0);

    // A direct id from org A is a 404 for org B — not a 403, and certainly not a 200.
    const approveB = await auth("post", `/api/risk-acceptances/${acceptanceId}/approve`, jwtB).send({});
    expect(approveB.status).toBe(404);

    const withdrawB = await auth("post", `/api/risk-acceptances/${acceptanceId}/withdraw`, jwtB).send({});
    expect(withdrawB.status).toBe(404);

    // Org A's finding is untouched by any of it.
    expect((await findingRow(f)).operational_status).toBe("closed");
  });

  it("org B cannot propose an acceptance against org A's finding", async () => {
    const f = await mkFinding(seed.orgA.id, "cross-tenant-propose");
    const res = await auth("post", `/api/findings/${f}/risk-acceptance`, jwtB)
      .send({ owner_user_id: ownerA, rationale: "not mine", expires_at: isoInDays(30) });
    expect(res.status).toBe(404); // the finding does not exist, as far as org B is concerned
  });

  it("the accountable owner must belong to the acceptance's own organization", async () => {
    const fB = await mkFinding(seed.orgB.id, "b-finding");
    // ownerA is an org-A user. Naming them as org B's accountable owner would put a
    // foreign user on a governance record.
    const res = await auth("post", `/api/findings/${fB}/risk-acceptance`, jwtB)
      .send({ owner_user_id: ownerA, rationale: "borrowing your owner", expires_at: isoInDays(30) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("owner_not_in_organization");
  });
});
