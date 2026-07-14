/**
 * findingClosureGateFlagOff.test.ts — the OFF position of the closure gate.
 * SECURELOGIC_FINDING_CLOSURE_GATE_ENABLED is UNSET for this suite.
 *
 * This is the contract production ships with. The gate changes a customer-reachable API
 * response — a PATCH that returns 200 today returns 409 with the gate on — so the OFF
 * position is not a formality to be assumed. It is the behaviour every existing customer
 * and integration depends on tomorrow morning, and it gets its own assertions, in its own
 * process, so that a mistake in the flag plumbing FAILS rather than passing quietly.
 *
 * ON is asserted in findingLegacyClosureGate.test.ts. Two files, because two processes are
 * needed to hold opposite positions on one environment variable — the same split
 * riskAcceptanceFlagOff.test.ts uses.
 *
 * The flag is left UNSET rather than set to "false" deliberately: absent must read false.
 * Production omits the var entirely on any service that never received it, so "absent" is
 * the position that actually ships, and it is the one worth proving.
 */

// Deliberately NOT set: process.env.SECURELOGIC_FINDING_CLOSURE_GATE_ENABLED
// Acceptance enforcement is on, so this suite differs from the ON suite in exactly one
// variable — the gate — and nothing else can explain a behavioural difference.
process.env.SECURELOGIC_RISK_ACCEPTANCE_ENABLED = "true";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, seedFinding, type TestDbSeed } from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the closure-gate flag-off test.");
  pool = new Pool({ connectionString: url, ssl: false });
  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

const patch = (findingId: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/findings/${findingId}`).set("X-Api-Key", seed.orgA.apiKey).send(body);

async function seedAction(findingId: string, status: string): Promise<void> {
  await pool.query(
    `INSERT INTO actions (organization_id, title, source_type, source_id, priority, status)
     VALUES ($1, 'Remediate it', 'finding', $2, 'planned', $3)`,
    [seed.orgA.id, findingId, status]
  );
}

async function axes(findingId: string): Promise<{ status: string; operational: string }> {
  const r = await pool.query<{ status: string; operational_status: string }>(
    `SELECT status, operational_status FROM findings WHERE id = $1`,
    [findingId]
  );
  return { status: r.rows[0]!.status, operational: r.rows[0]!.operational_status };
}

describe("closure gate OFF — the legacy contract, byte for byte", () => {
  it("closes a finding with OPEN remediation actions, exactly as it always did", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "Legacy close" });
    await seedAction(findingId, "open");
    await seedAction(findingId, "in_progress");

    const res = await patch(findingId, { status: "closed" });

    // THE assertion of this file. With the gate on this is a 409; with it off it is the
    // 200 every existing client gets today. If this ever flips, the rollout broke prod.
    expect(res.status).toBe(200);

    const after = await axes(findingId);
    expect(after.status).toBe("closed");
    expect(after.operational).toBe("closed");
  });

  it("never produces the 409 — the new error code cannot reach a client with the flag off", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "No 409 here" });
    await seedAction(findingId, "blocked");

    for (const status of ["closed", "accepted"]) {
      const res = await patch(findingId, { status });
      expect(res.status).not.toBe(409);
      expect(res.body.error).not.toBe("close_requires_remediation_complete");
    }
  });

  it("closes via 'accepted' with work outstanding, as before", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "Legacy accept" });
    await seedAction(findingId, "open");

    expect((await patch(findingId, { status: "accepted" })).status).toBe(200);
    expect((await axes(findingId)).operational).toBe("closed");
  });

  it("leaves every non-closing write alone", async () => {
    const findingId = await seedFinding(pool, seed.orgA.id, { title: "Untouched" });
    await seedAction(findingId, "open");

    expect((await patch(findingId, { status: "in_progress" })).status).toBe(200);
    expect((await patch(findingId, { priority: "immediate" })).status).toBe(200);
    expect((await axes(findingId)).operational).not.toBe("closed");
  });
});
