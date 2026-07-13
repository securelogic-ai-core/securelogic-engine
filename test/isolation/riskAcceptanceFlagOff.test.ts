/**
 * riskAcceptanceFlagOff.test.ts — the contract PRODUCTION actually ships with.
 *
 * SECURELOGIC_RISK_ACCEPTANCE_ENABLED is OFF on the day this package merges, so
 * flag-off is not a fallback path — it is the live one. It gets its own file because
 * the flag is read from the environment at request time and the sibling suite
 * (riskAcceptanceLifecycle) sets it to "true" for the whole module; one process cannot
 * honestly assert both positions.
 *
 * The promise being tested is narrow and total: with the flag off, this package is
 * INVISIBLE. Not degraded, not partially wired — indistinguishable from the commit
 * before it, for every customer, on every existing surface.
 *
 *   1. every acceptance route 404s — a disabled feature does not admit it exists;
 *   2. an approved acceptance row does NOT close its finding — the derivation ignores it,
 *      so the Active Findings population cannot move;
 *   3. the legacy accepted population stays closed anyway — because it is held by the
 *      legacy compat bridge (status='accepted' is terminal), NOT by this flag.
 *
 * (3) is the one that would bite hardest if it were wrong. If legacy closure depended on
 * the flag, turning it off in an incident would REOPEN a customer's historical closed
 * findings — a posture regression caused by the safety switch itself.
 */

process.env.JWT_SECRET ??= "test-jwt-secret-for-risk-acceptance-off";
// The production position. Explicitly deleted rather than set to "false" so the test
// also covers the unset-variable case, which is how a real prod box is configured.
delete process.env.SECURELOGIC_RISK_ACCEPTANCE_ENABLED;

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";
import { signJwt } from "../../src/api/lib/jwt.js";
import { recordAllCurrentConsents } from "../../src/api/lib/legalConsent.js";
import { recomputeFindingOperationalStatus } from "../../src/api/lib/findingLifecycle.js";
import { hasBindingAcceptance } from "../../src/api/lib/riskAcceptance.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;
let userA = "";
let jwtA = "";

const ACTOR = { actorUserId: null, actorApiKeyId: null };

async function mkFinding(orgId: string, title: string, status = "open"): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, status)
     VALUES ($1, $2, 'High', 'flag-off seed', 'manual', $3) RETURNING id`,
    [orgId, title, status]
  );
  return r.rows[0]!.id;
}

async function findingRow(id: string) {
  const r = await pool.query<{ status: string; operational_status: string; decision_state: string }>(
    `SELECT status, operational_status, decision_state FROM findings WHERE id = $1`,
    [id]
  );
  return r.rows[0]!;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the flag-off test.");
  pool = new Pool({ connectionString: url, ssl: false });

  const u = await seedUser(pool, seed.orgA.id, { email: "flagoff@a.test" });
  userA = u.id;
  await recordAllCurrentConsents(pool, {
    userId: userA,
    organizationId: seed.orgA.id,
    consentMethod: "admin_recorded",
  });
  jwtA = signJwt(userA, seed.orgA.id, "admin");

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 300_000);

afterAll(async () => {
  await pool?.end();
});

describe("Risk acceptance, flag OFF — the feature is invisible", () => {
  it("every acceptance route 404s", async () => {
    const f = await mkFinding(seed.orgA.id, "flagoff-routes");
    const bearer = `Bearer ${jwtA}`;

    const routes: Array<[("get" | "post"), string]> = [
      ["get", "/api/risk-acceptances"],
      ["get", "/api/risk-acceptances/summary"],
      ["post", `/api/findings/${f}/risk-acceptance`],
      ["post", `/api/risk-acceptances/${f}/approve`],
      ["post", `/api/risk-acceptances/${f}/withdraw`],
    ];

    for (const [method, path] of routes) {
      const res = await request(app)[method](path).set("Authorization", bearer).send({});
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(404);
    }
  });
});

describe("Risk acceptance, flag OFF — the Active Findings population cannot move", () => {
  it("an APPROVED acceptance does not close its finding", async () => {
    const f = await mkFinding(seed.orgA.id, "flagoff-approved-inert");

    // The row a fully-approved acceptance would leave behind — written directly, because
    // with the flag off there is no route that could create one. This is the strongest
    // form of the claim: even if acceptance data EXISTS (staging rehearsal, a flag that
    // was on and got turned off), flag-off derivation ignores it completely.
    const approver = await seedUser(pool, seed.orgA.id, { email: "flagoff-approver@a.test" });
    await pool.query(
      `INSERT INTO finding_risk_acceptances
         (organization_id, finding_id, state, owner_user_id, rationale,
          requested_by_user_id, approver_user_id, approved_at, expires_at)
       VALUES ($1, $2, 'approved', $3, 'inert while the flag is off',
               $3, $4, NOW(), CURRENT_DATE + 90)`,
      [seed.orgA.id, f, userA, approver.id]
    );

    // The contract, at the seam the derivation actually reads.
    expect(await hasBindingAcceptance(seed.orgA.id, f)).toBe(false);

    await recomputeFindingOperationalStatus(seed.orgA.id, f, ACTOR);

    const row = await findingRow(f);
    expect(row.operational_status).toBe("open");
    expect(row.status).not.toBe("accepted");
    expect(row.decision_state).not.toBe("accepted_risk");
  });
});

describe("Risk acceptance, flag OFF — the legacy closed population is NOT held by the flag", () => {
  it("legacy accepted findings stay closed with the flag off", async () => {
    // Closed by the legacy bridge exactly as it was before this package existed.
    const f = await mkFinding(seed.orgA.id, "flagoff-legacy", "accepted");
    await pool.query(
      `UPDATE findings SET decision_state = 'accepted_risk' WHERE id = $1`, [f]
    );
    expect((await findingRow(f)).operational_status).toBe("closed");

    // A recompute with the flag off must not disturb it. If closure here depended on the
    // acceptance table, flipping the flag off would reopen a customer's history — the
    // safety switch would itself be the regression.
    await recomputeFindingOperationalStatus(seed.orgA.id, f, ACTOR);

    const row = await findingRow(f);
    expect(row.operational_status).toBe("closed");
    expect(row.decision_state).toBe("accepted_risk");
  });
});
