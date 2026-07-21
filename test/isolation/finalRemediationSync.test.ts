/**
 * finalRemediationSync.test.ts — the final-remediation read-model synchronization.
 *
 * THE STAGING DEFECT THIS FILE EXISTS FOR. After the last remediation action is
 * completed, the remediation section said "all actions complete" while the finding
 * HEADER still showed "Work in progress" and the lifecycle stayed on Remediation.
 * The header reads the finding's DERIVED operational_status (via the same read
 * model, resolveFindingContext, that the page renders); the remediation section had
 * been deriving "done" from the raw action list. They used DIFFERENT sources.
 *
 * The exact cause is the evidence gate: for a gate-enforcing org
 * (risk_settings.require_evidence_gate = TRUE), completing every action WITHOUT
 * attached evidence correctly holds operational_status at 'in_progress' — the
 * finding is not yet Remediation complete. So the two surfaces MUST reconcile on
 * the derived status, and completing the final action only advances the finding
 * when remediation is genuinely complete (no gate, or evidence present).
 *
 * This drives the REAL PATCH /api/actions/:id route and then asserts the SAME read
 * model the header uses (resolveFindingContext):
 *   1. no gate — completing the final action advances operational_status to
 *      'remediated' (header: "Remediation complete", lifecycle: Governance) and the
 *      finding stays OPEN (decision_state unchanged);
 *   2. a NON-final completion does not advance the finding;
 *   3. gate on + NO evidence — the final completion holds at 'in_progress' (the
 *      staging reproduction — this is correct, not a bug);
 *   4. gate on + evidence present — the final completion advances to 'remediated';
 *   5. Activity carries BOTH the action completion and the finding remediation;
 *   6. a hard refresh (re-reading the model) shows the same persisted state;
 *   7. tenant isolation.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import request from "supertest";
import type { Express } from "express";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { resolveFindingContext, type Queryable } from "../../src/api/lib/findingContextResolver.js";

let seed: TestDbSeed;
let pool: Pool;
let db: Queryable;
let app: Express;

async function seedFinding(orgId: string, title: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, status)
     VALUES ($1, $2, 'High', 'final-sync seed', 'manual', 'open')
     RETURNING id`,
    [orgId, title]
  );
  return r.rows[0]!.id;
}

async function seedAction(orgId: string, findingId: string, title: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO actions (organization_id, title, source_type, source_id, priority, status)
     VALUES ($1, $2, 'finding', $3, 'near_term', 'in_progress')
     RETURNING id`,
    [orgId, title, findingId]
  );
  return r.rows[0]!.id;
}

/** Toggle the org's evidence gate. cadence_by_rating is NOT NULL with no default. */
async function setEvidenceGate(orgId: string, on: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO risk_settings (organization_id, cadence_by_rating, require_evidence_gate)
     VALUES ($1, '{}'::jsonb, $2)
     ON CONFLICT (organization_id) DO UPDATE
       SET require_evidence_gate = EXCLUDED.require_evidence_gate, updated_at = NOW()`,
    [orgId, on]
  );
}

async function seedFindingEvidence(orgId: string, findingId: string): Promise<void> {
  await pool.query(
    `INSERT INTO evidence (organization_id, source_type, source_id, title, evidence_type)
     VALUES ($1, 'finding', $2, 'Remediation proof', 'document')`,
    [orgId, findingId]
  );
}

/** Complete an action through the REAL route (the header's write path). */
function complete(actionId: string, apiKey: string, note?: string) {
  return request(app)
    .patch(`/api/actions/${actionId}`)
    .set("X-Api-Key", apiKey)
    .send(note === undefined ? { status: "closed" } : { status: "closed", completion_note: note });
}

/** The header's READ model — the exact resolver the Decision Workspace renders. */
async function headerState(orgId: string, findingId: string) {
  const ctx = await resolveFindingContext(db, orgId, findingId);
  return ctx!.finding; // { operational_status, decision_state, ... }
}

/** Poll for a fire-and-forget audit event to land. */
async function awaitAudit(orgId: string, eventType: string, resourceId: string): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    const r = await pool.query(
      `SELECT 1 FROM security_audit_log
        WHERE organization_id = $1 AND event_type = $2 AND resource_id = $3 LIMIT 1`,
      [orgId, eventType, resourceId]
    );
    if ((r.rowCount ?? 0) > 0) return true;
    await new Promise((res) => setTimeout(res, 25));
  }
  return false;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the final-remediation-sync test.");
  pool = new Pool({ connectionString: url, ssl: false });
  db = pool as unknown as Queryable;

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

describe("no evidence gate — the final completion advances the header read model", () => {
  it("a NON-final completion does not advance the finding", async () => {
    await setEvidenceGate(seed.orgA.id, false);
    const findingId = await seedFinding(seed.orgA.id, "two-actions");
    const a1 = await seedAction(seed.orgA.id, findingId, "First");
    await seedAction(seed.orgA.id, findingId, "Second"); // stays in_progress

    const res = await complete(a1, seed.orgA.apiKey);
    expect(res.status).toBe(200);

    const f = await headerState(seed.orgA.id, findingId);
    expect(f.operational_status).toBe("in_progress"); // NOT remediated
    expect(f.decision_state).toBe("needs_review");     // finding still open
  });

  it("completing the FINAL action makes the header read model show Remediation complete + Governance, finding still open", async () => {
    await setEvidenceGate(seed.orgA.id, false);
    const findingId = await seedFinding(seed.orgA.id, "single-action-advances");
    const a1 = await seedAction(seed.orgA.id, findingId, "Only remediation");

    const res = await complete(a1, seed.orgA.apiKey, "Rotated key, verified no reuse");
    expect(res.status).toBe(200);
    // The action's wire status is 'closed' — which the UI labels "Completed"
    // (no regression to that labeling).
    expect(res.body.action.status).toBe("closed");

    // The SAME read model the header uses.
    const f = await headerState(seed.orgA.id, findingId);
    expect(f.operational_status).toBe("remediated"); // header: "Remediation complete"
    // lifecycle stage = Governance is derived from (remediated, non-resolved); the
    // finding is NOT auto-closed.
    expect(f.decision_state).toBe("needs_review");

    // Activity carries BOTH the action completion and the finding remediation.
    expect(await awaitAudit(seed.orgA.id, "action.status_changed", a1)).toBe(true);
    expect(await awaitAudit(seed.orgA.id, "finding.remediated", findingId)).toBe(true);
    const ctx = await resolveFindingContext(db, seed.orgA.id, findingId);
    const events = ctx!.activity.map((e) => e.event_type);
    expect(events).toContain("action.status_changed");
    expect(events).toContain("finding.remediated");

    // Hard refresh: re-reading the model shows the SAME persisted state.
    const again = await headerState(seed.orgA.id, findingId);
    expect(again.operational_status).toBe("remediated");
    expect(again.decision_state).toBe("needs_review");
  });
});

describe("evidence gate — the derived status is honored, and the surfaces reconcile", () => {
  it("gate ON + NO evidence — the final completion is HELD at in_progress (the staging reproduction)", async () => {
    await setEvidenceGate(seed.orgB.id, true);
    const findingId = await seedFinding(seed.orgB.id, "gate-holds");
    const a1 = await seedAction(seed.orgB.id, findingId, "Only remediation");

    const res = await complete(a1, seed.orgB.apiKey);
    expect(res.status).toBe(200);

    // The header read model correctly says the work is NOT yet Remediation complete —
    // and the remediation section reads this same value, so the two agree instead of
    // contradicting. Advancing here would bypass a deliberate control.
    const f = await headerState(seed.orgB.id, findingId);
    expect(f.operational_status).toBe("in_progress");
    expect(f.decision_state).toBe("needs_review");
  });

  it("gate ON + evidence present — the final completion advances to Remediation complete", async () => {
    await setEvidenceGate(seed.orgB.id, true);
    const findingId = await seedFinding(seed.orgB.id, "gate-satisfied");
    await seedFindingEvidence(seed.orgB.id, findingId); // proof attached first
    const a1 = await seedAction(seed.orgB.id, findingId, "Only remediation");

    const res = await complete(a1, seed.orgB.apiKey);
    expect(res.status).toBe(200);

    const f = await headerState(seed.orgB.id, findingId);
    expect(f.operational_status).toBe("remediated"); // gate satisfied → advances
    expect(f.decision_state).toBe("needs_review");
  });
});

describe("tenant isolation", () => {
  it("org A cannot complete org B's action (404), and no finding advances", async () => {
    await setEvidenceGate(seed.orgB.id, false);
    const findingId = await seedFinding(seed.orgB.id, "iso-cross-org");
    const a1 = await seedAction(seed.orgB.id, findingId, "org B remediation");

    const res = await complete(a1, seed.orgA.apiKey, "should never apply");
    expect(res.status).toBe(404);

    const action = await pool.query<{ status: string }>(`SELECT status FROM actions WHERE id = $1`, [a1]);
    expect(action.rows[0]!.status).toBe("in_progress");
    expect((await headerState(seed.orgB.id, findingId)).operational_status).not.toBe("remediated");
  });

  it("completing an action in org B does not advance any finding in org A", async () => {
    await setEvidenceGate(seed.orgA.id, false);
    await setEvidenceGate(seed.orgB.id, false);
    const findingA = await seedFinding(seed.orgA.id, "iso-untouched-A");
    await seedAction(seed.orgA.id, findingA, "org A remediation");
    const beforeA = await headerState(seed.orgA.id, findingA);

    const findingB = await seedFinding(seed.orgB.id, "iso-complete-B");
    const b1 = await seedAction(seed.orgB.id, findingB, "org B remediation");
    await complete(b1, seed.orgB.apiKey);

    expect((await headerState(seed.orgB.id, findingB)).operational_status).toBe("remediated");
    const afterA = await headerState(seed.orgA.id, findingA);
    expect(afterA.operational_status).toBe(beforeA.operational_status);
  });
});
