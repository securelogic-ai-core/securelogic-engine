/**
 * askGovernedExecution.test.ts — LC-5b governed tools against the REAL route
 * chains on real Postgres.
 *
 * The confirm route's execution step is `executeTool(confirmingReq, tool,
 * frozenInput)`. This suite runs exactly that call against the live router —
 * so what is proven here is what production confirmation will do:
 *
 *   findings.close   the decision-state machine, the remediation gate, the
 *                    false-positive closure ruling, and org-policy SoD
 *                    (remediator ≠ closer) all fire through the tool path;
 *   vendors.decide   the engagement state machine, the residual-measurement
 *                    precondition, decided_by = the EXECUTING user (never
 *                    model input), and the decision changing NOTHING about
 *                    the measured residual risk.
 *
 * Cross-tenant: a governed execution against another org's object is the
 * route's own non-disclosing 404, surfaced as the executor's uniform denial.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Request, type Response } from "express";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, seedFinding, seedUser, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { buildToolRegistry } from "../../src/api/tools/registry.js";
import { executeTool } from "../../src/api/tools/executor.js";
import { requireApiKey } from "../../src/api/middleware/requireApiKey.js";
import { attachOrganizationContext } from "../../src/api/middleware/attachOrganizationContext.js";
import type { ToolDefinition } from "../../src/api/tools/types.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;
/** The product routes with a user-identity injector — for exercising the
 *  IN-PRODUCT half of the acceptance workflow (approve) as a specific user. */
let appAs: express.Express;
let tools: ToolDefinition[];
let closerA: string;
let remediatorA: string;
let userB: string;

const RATIONALE = "Reviewed with the platform team; closure criteria are met in full.";

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env.DATABASE_URL = url;
  // The decision axis and the closure machinery live behind the Decision
  // Workspace flag — exactly as they will in a governed-enabled environment.
  process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED = "true";
  // risks.accept binds the signed acceptance workflow, which has its own flag.
  process.env.SECURELOGIC_RISK_ACCEPTANCE_ENABLED = "true";
  pool = new Pool({ connectionString: url, ssl: false });

  closerA = (await seedUser(pool, seed.orgA.id, { name: "Closer A" })).id;
  remediatorA = (await seedUser(pool, seed.orgA.id, { name: "Remediator A" })).id;
  userB = (await seedUser(pool, seed.orgB.id, { name: "User B" })).id;

  app = express();
  app.use(express.json());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
  tools = buildToolRegistry();

  // Product routes with a user injector BEFORE the router: API-key auth does
  // not set userId, so the injected identity survives the chain — letting the
  // approve step run as a chosen org member.
  appAs = express();
  appAs.use(express.json());
  appAs.use((req, _res, next) => {
    const asUser = req.headers["x-test-user"];
    if (typeof asUser === "string" && asUser) {
      (req as express.Request & { userId?: string }).userId = asUser;
    }
    next();
  });
  appAs.use(buildRoutes({ isDev: false, publicApiDisabled: false }));

  // The confirm route's execution context, faithfully: real API-key auth +
  // org context, with the CONFIRMING user's identity present (the confirm
  // chain requires a human user; here it arrives via header for testability).
  app.post(
    "/__governedtest",
    requireApiKey,
    attachOrganizationContext,
    (req: Request, res: Response) => {
      const asUser = req.headers["x-test-user"];
      if (typeof asUser === "string" && asUser) {
        (req as Request & { userId?: string }).userId = asUser;
      }
      const { tool: toolName, args } = req.body as {
        tool: string;
        args?: Record<string, unknown>;
      };
      const tool = tools.find((t) => t.name === toolName);
      if (!tool) {
        res.status(404).json({ error: "unknown_tool" });
        return;
      }
      void executeTool(req, tool, args ?? {}).then((result) => res.status(200).json(result));
    }
  );
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

const runTool = (
  orgKey: string,
  userId: string,
  tool: string,
  args: Record<string, unknown>
) =>
  request(app)
    .post("/__governedtest")
    .set("x-api-key", orgKey)
    .set("x-test-user", userId)
    .send({ tool, args });

/** Exercise the IN-PRODUCT approve step as a specific org-A member. */
const approveAs = (userId: string, acceptanceId: string) =>
  request(appAs)
    .post(`/api/risk-acceptances/${acceptanceId}/approve`)
    .set("x-api-key", seed.orgA.apiKey)
    .set("x-test-user", userId)
    .send({ decision_rationale: "Reviewed and approved for the stated window." });

async function findingDecisionState(id: string): Promise<string> {
  const r = await pool.query(`SELECT decision_state FROM findings WHERE id = $1`, [id]);
  return r.rows[0].decision_state as string;
}

// ─── findings.close ─────────────────────────────────────────────────────────

describe("LC-5b — findings.close executes the real closure machinery", () => {
  it("closes a false-positive finding (no remediation items) and records the lifecycle comment", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, {
      title: "FP: scanner misread banner",
      severity: "Low",
    });
    const res = await runTool(seed.orgA.apiKey, closerA, "findings.close", {
      id: findingId,
      decision_state: "resolved",
      decision_note: RATIONALE,
    });
    expect(res.body.ok, JSON.stringify(res.body)).toBe(true);
    expect(await findingDecisionState(findingId)).toBe("resolved");

    // The rationale landed as the lifecycle event's comment — the WHY on the
    // same trail as the decision.
    const ev = await pool.query(
      `SELECT comment, actor_user_id, to_state FROM finding_lifecycle_events
        WHERE finding_id = $1 AND axis = 'decision' ORDER BY created_at DESC LIMIT 1`,
      [findingId]
    );
    expect(ev.rows[0].to_state).toBe("resolved");
    expect(ev.rows[0].comment).toBe(RATIONALE);
    expect(ev.rows[0].actor_user_id).toBe(closerA);
  });

  it("the remediation gate refuses closure while remediation is incomplete", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "Open remediation" });
    await pool.query(
      `INSERT INTO actions (organization_id, title, source_type, source_id, priority, status)
       VALUES ($1, 'Patch it', 'finding', $2, 'immediate', 'open')`,
      [seed.orgA.id, findingId]
    );
    const res = await runTool(seed.orgA.apiKey, closerA, "findings.close", {
      id: findingId,
      decision_state: "resolved",
      decision_note: RATIONALE,
    });
    expect(res.body.ok).toBe(false);
    expect(await findingDecisionState(findingId)).toBe("needs_review");
  });

  it("org-policy SoD: the remediator cannot also be the closer; a different user can", async () => {
    await pool.query(
      `INSERT INTO risk_settings (organization_id, cadence_by_rating, require_finding_closure_sod)
       VALUES ($1, '{"Critical":30,"High":90,"Moderate":180,"Low":365}'::jsonb, TRUE)
       ON CONFLICT (organization_id) DO UPDATE SET require_finding_closure_sod = TRUE`,
      [seed.orgA.id]
    );
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "SoD closure" });
    await pool.query(
      `INSERT INTO actions (organization_id, title, source_type, source_id, priority, status)
       VALUES ($1, 'Remediate it', 'finding', $2, 'immediate', 'closed')`,
      [seed.orgA.id, findingId]
    );
    await pool.query(`UPDATE findings SET operational_status = 'remediated' WHERE id = $1`, [
      findingId,
    ]);
    await pool.query(
      `INSERT INTO finding_lifecycle_events
         (organization_id, finding_id, axis, from_state, to_state, transition, actor_user_id)
       VALUES ($1, $2, 'operational', 'in_remediation', 'remediated',
               'operational_remediated', $3)`,
      [seed.orgA.id, findingId, remediatorA]
    );

    // The remediator confirming their own closure: refused.
    const asRemediator = await runTool(seed.orgA.apiKey, remediatorA, "findings.close", {
      id: findingId,
      decision_state: "resolved",
      decision_note: RATIONALE,
    });
    expect(asRemediator.body.ok).toBe(false);
    expect(await findingDecisionState(findingId)).toBe("needs_review");

    // A different closer: allowed.
    const asCloser = await runTool(seed.orgA.apiKey, closerA, "findings.close", {
      id: findingId,
      decision_state: "resolved",
      decision_note: RATIONALE,
    });
    expect(asCloser.body.ok, JSON.stringify(asCloser.body)).toBe(true);
    expect(await findingDecisionState(findingId)).toBe("resolved");

    await pool.query(
      `UPDATE risk_settings SET require_finding_closure_sod = FALSE WHERE organization_id = $1`,
      [seed.orgA.id]
    );
  });

  it("cross-tenant: org A cannot close org B's finding through the tool", async () => {
    const findingB = await seedFinding(pool, seed.orgB.id, { title: "ORG-B finding" });
    const res = await runTool(seed.orgA.apiKey, closerA, "findings.close", {
      id: findingB,
      decision_state: "resolved",
      decision_note: RATIONALE,
    });
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("denied");
    expect(await findingDecisionState(findingB)).toBe("needs_review");
  });
});

// ─── vendors.decide ─────────────────────────────────────────────────────────

async function seedEngagement(
  orgId: string,
  vendorId: string,
  opts: { status?: string; residual?: number | null } = {}
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO vendor_engagements
       (organization_id, vendor_id, engagement_type, status,
        residual_score, residual_rating, methodology_version, scope_rule_version)
     VALUES ($1, $2, 'initial', $3, $4, $5, 'v1', 'v1')
     RETURNING id`,
    [
      orgId,
      vendorId,
      opts.status ?? "decision_pending",
      opts.residual === undefined ? 62 : opts.residual,
      opts.residual === null ? null : "High",
    ]
  );
  return r.rows[0]!.id;
}

describe("LC-5b — vendors.decide executes the real decision machinery", () => {
  let vendorA: string;

  beforeAll(async () => {
    vendorA = await seedVendor(pool, seed.orgA.id, { name: "Decide Corp" });
  });

  it("records the decision; decided_by is the EXECUTING user; residual is untouched", async () => {
    const engagementId = await seedEngagement(seed.orgA.id, vendorA);
    const res = await runTool(seed.orgA.apiKey, closerA, "vendors.decide", {
      id: engagementId,
      decision: "approved",
      rationale: RATIONALE,
      // Attempted identity injection — the route has no such body field and
      // reads userOf(req) only; additionalProperties:false already forbids
      // this at the schema, but even raw it must be inert.
      decided_by_user_id: remediatorA,
    });
    expect(res.body.ok, JSON.stringify(res.body)).toBe(true);
    expect(res.body.data.residual_score).toBe(62);

    const row = await pool.query(
      `SELECT status, decision, decision_rationale, decided_by_user_id,
              residual_score, residual_rating
         FROM vendor_engagements WHERE id = $1`,
      [engagementId]
    );
    expect(row.rows[0]).toMatchObject({
      status: "decided",
      decision: "approved",
      decision_rationale: RATIONALE,
      decided_by_user_id: closerA, // NOT remediatorA — identity is the request's
      residual_score: 62,
      residual_rating: "High",
    });
  });

  it("the state machine refuses a decision on an engagement that is not decision_pending", async () => {
    const engagementId = await seedEngagement(seed.orgA.id, vendorA, { status: "draft" });
    const res = await runTool(seed.orgA.apiKey, closerA, "vendors.decide", {
      id: engagementId,
      decision: "approved",
      rationale: RATIONALE,
    });
    expect(res.body.ok).toBe(false);
    // The refusal carries the route's OWN reason — this is what the confirm
    // route records in the audit digest (stop-gate fidelity fix).
    expect(res.body.message).toBe("cannot_decide");
    const row = await pool.query(`SELECT status FROM vendor_engagements WHERE id = $1`, [
      engagementId,
    ]);
    expect(row.rows[0].status).toBe("draft");
  });

  it("a decision without a computed residual is refused — a decision about nothing", async () => {
    const engagementId = await seedEngagement(seed.orgA.id, vendorA, { residual: null });
    const res = await runTool(seed.orgA.apiKey, closerA, "vendors.decide", {
      id: engagementId,
      decision: "approved",
      rationale: RATIONALE,
    });
    expect(res.body.ok).toBe(false);
  });

  it("cross-tenant: org B cannot decide org A's engagement through the tool", async () => {
    const engagementId = await seedEngagement(seed.orgA.id, vendorA);
    const res = await runTool(seed.orgB.apiKey, userB, "vendors.decide", {
      id: engagementId,
      decision: "rejected",
      rationale: RATIONALE,
    });
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("denied");
    const row = await pool.query(`SELECT status FROM vendor_engagements WHERE id = $1`, [
      engagementId,
    ]);
    expect(row.rows[0].status).toBe("decision_pending");
  });
});

// ─── risks.accept ───────────────────────────────────────────────────────────

describe("LC-5b — risks.accept binds the signed workflow's PROPOSE step", () => {
  const ACCEPT_ARGS = (findingId: string, ownerUserId: string) => ({
    id: findingId,
    owner_user_id: ownerUserId, // frozen by applyDefaults in the live path
    rationale: "Compensating network controls cover this exposure through the review date.",
    expires_at: "2027-06-30",
  });

  it("the FULL workflow round trip: tool proposes; self-approval refused; a second user approves; severity never changes", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, {
      title: "Legacy cipher on internal service",
      severity: "Moderate",
    });

    // 1. The tool call the confirm route would execute: creates the PROPOSAL.
    //    The finding stays fully active — proposing closes nothing.
    const proposed = await runTool(
      seed.orgA.apiKey,
      closerA,
      "risks.accept",
      ACCEPT_ARGS(findingId, closerA)
    );
    expect(proposed.body.ok, JSON.stringify(proposed.body)).toBe(true);
    const acceptanceId = proposed.body.data.acceptance.id as string;
    expect(proposed.body.data.acceptance.state).toBe("proposed");
    expect(proposed.body.data.acceptance.requested_by_user_id).toBe(closerA);
    expect(await findingDecisionState(findingId)).toBe("needs_review");

    // 2. APPROVER SEMANTICS PRESERVED: the proposer (== the Ask confirmer)
    //    cannot approve their own acceptance — the product route's SoD.
    const approveAsProposer = await approveAs(closerA, acceptanceId);
    expect(approveAsProposer.status).toBe(403);
    expect(approveAsProposer.body.error).toBe("separation_of_duties");
    expect(await findingDecisionState(findingId)).toBe("needs_review");

    // 3. A DIFFERENT authorized user approves — the workflow's own act closes
    //    the finding.
    const approveAsOther = await approveAs(remediatorA, acceptanceId);
    expect(approveAsOther.status, JSON.stringify(approveAsOther.body)).toBe(200);
    expect(await findingDecisionState(findingId)).toBe("accepted_risk");

    // 4. Acceptance NEVER changes the measurement: severity is untouched
    //    through proposal and approval.
    const f = await pool.query(`SELECT severity FROM findings WHERE id = $1`, [findingId]);
    expect(f.rows[0].severity).toBe("Moderate");
  });

  it("a second live acceptance for the same finding is refused with the route's own reason", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "Dup acceptance" });
    const first = await runTool(seed.orgA.apiKey, closerA, "risks.accept", ACCEPT_ARGS(findingId, closerA));
    expect(first.body.ok).toBe(true);
    const second = await runTool(seed.orgA.apiKey, closerA, "risks.accept", ACCEPT_ARGS(findingId, closerA));
    expect(second.body.ok).toBe(false);
    // The stop-gate fidelity fix at work: the WHY survives into the result.
    expect(second.body.message).toBe("acceptance_already_live_for_finding");
  });

  it("an owner outside the org is refused at execution (and would never render a card)", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "Foreign owner attempt" });
    const res = await runTool(seed.orgA.apiKey, closerA, "risks.accept", ACCEPT_ARGS(findingId, userB));
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toBe("owner_not_in_organization");
  });

  it("cross-tenant: org B cannot propose acceptance of org A's finding", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "Org A exposure" });
    const res = await runTool(seed.orgB.apiKey, userB, "risks.accept", ACCEPT_ARGS(findingId, userB));
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("denied");
  });
});

