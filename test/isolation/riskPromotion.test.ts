/**
 * riskPromotion.test.ts — Finding→Risk promotion (ADR-0004 A) against real Postgres.
 *
 * The #691 lesson: mocked-pg unit tests cannot catch unqualified columns, CHECK
 * violations, or trigger interactions. This suite drives the REAL routes
 * (propose → approve → withdraw → re-approve) and asserts the register rows the
 * promotion service actually writes:
 *
 *   1. an approval with the flag on creates the register risk — the INSERT
 *      survives every risks CHECK (likelihood/impact/rating vocabulary, status
 *      'accepted', source consistency) — and stamps promoted_risk_id;
 *   2. re-acceptance (withdraw → re-propose → re-approve) LINKS to the existing
 *      risk: one risk per finding, both acceptances pointing at it;
 *   3. vocabulary fallbacks survive real constraints (null likelihood/domain);
 *   4. tenant isolation: each org's promotion lands only in its own register,
 *      and the promoted_risk_id stamp never crosses org boundaries;
 *   5. flag off → the approval flows exactly as before, no risk, no stamp.
 *
 * Same-process flag posture as riskAcceptanceLifecycle.test.ts: both flags are
 * set for the whole module (each isolation file runs in its own process). The
 * promotion flag is toggled per-call inside the flag-off test only, which is
 * safe because riskPromotionEnabled() reads the env at call time.
 */

process.env.JWT_SECRET ??= "test-jwt-secret-for-risk-promotion";
process.env.SECURELOGIC_RISK_ACCEPTANCE_ENABLED = "true";
process.env.SECURELOGIC_FINDING_RISK_PROMOTION_ENABLED = "true";

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

let ownerA = "";
let jwtRequesterA = "";
let jwtApproverA = "";
let ownerB = "";
let jwtRequesterB = "";
let jwtApproverB = "";

const auth = (m: "get" | "post", path: string, jwt: string) =>
  request(app)[m](path).set("Authorization", `Bearer ${jwt}`);

interface FindingSeed {
  severity?: string;
  domain?: string | null;
  likelihood?: string | null;
}

async function mkFinding(
  orgId: string,
  title: string,
  { severity = "High", domain = null, likelihood = null }: FindingSeed = {}
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, status, domain, likelihood)
     VALUES ($1, $2, $3, 'risk-promotion seed', 'manual', 'open', $4, $5) RETURNING id`,
    [orgId, title, severity, domain, likelihood]
  );
  return r.rows[0]!.id;
}

function isoInDays(days: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Propose → approve through the real routes. Returns the acceptance id. */
async function acceptAndApprove(
  findingId: string,
  opts: { ownerUserId: string; jwtRequester: string; jwtApprover: string; rationale?: string }
): Promise<string> {
  const proposed = await auth("post", `/api/findings/${findingId}/risk-acceptance`, opts.jwtRequester).send({
    owner_user_id: opts.ownerUserId,
    rationale: opts.rationale ?? "Compensating control in place; cost of fix exceeds exposure.",
    expires_at: isoInDays(90),
  });
  expect(proposed.status).toBe(201);

  const approved = await auth(
    "post",
    `/api/risk-acceptances/${proposed.body.acceptance.id}/approve`,
    opts.jwtApprover
  ).send({ decision_rationale: "Reviewed at the risk committee." });
  expect(approved.status).toBe(200);
  return proposed.body.acceptance.id;
}

async function promotedRisksFor(orgId: string, findingId: string) {
  const r = await pool.query<{
    id: string;
    organization_id: string;
    title: string;
    description: string | null;
    domain: string;
    likelihood: string;
    impact: string;
    risk_rating: string;
    status: string;
    owner: string | null;
    lifecycle_state: string | null;
  }>(
    `SELECT id, organization_id, title, description, domain, likelihood, impact,
            risk_rating, status, owner, lifecycle_state
       FROM risks
      WHERE organization_id = $1 AND source_type = 'finding_promotion' AND source_id = $2`,
    [orgId, findingId]
  );
  return r.rows;
}

async function acceptanceStamp(acceptanceId: string): Promise<string | null> {
  const r = await pool.query<{ promoted_risk_id: string | null }>(
    `SELECT promoted_risk_id FROM finding_risk_acceptances WHERE id = $1`,
    [acceptanceId]
  );
  return r.rows[0]!.promoted_risk_id;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the risk-promotion test.");
  pool = new Pool({ connectionString: url, ssl: false });

  const uReqA = await seedUser(pool, seed.orgA.id, { email: "requester@a.test" });
  const uAppA = await seedUser(pool, seed.orgA.id, { email: "approver@a.test" });
  const uOwnA = await seedUser(pool, seed.orgA.id, { email: "owner@a.test", name: "Ada Owner" });
  const uReqB = await seedUser(pool, seed.orgB.id, { email: "requester@b.test" });
  const uAppB = await seedUser(pool, seed.orgB.id, { email: "approver@b.test" });
  const uOwnB = await seedUser(pool, seed.orgB.id, { email: "owner@b.test", name: "Bea Owner" });
  ownerA = uOwnA.id;
  ownerB = uOwnB.id;

  for (const [u, org] of [
    [uReqA, seed.orgA.id],
    [uAppA, seed.orgA.id],
    [uOwnA, seed.orgA.id],
    [uReqB, seed.orgB.id],
    [uAppB, seed.orgB.id],
    [uOwnB, seed.orgB.id],
  ] as const) {
    await recordAllCurrentConsents(pool, {
      userId: u.id,
      organizationId: org,
      consentMethod: "admin_recorded",
    });
  }

  jwtRequesterA = signJwt(uReqA.id, seed.orgA.id, "admin");
  jwtApproverA = signJwt(uAppA.id, seed.orgA.id, "admin");
  jwtRequesterB = signJwt(uReqB.id, seed.orgB.id, "admin");
  jwtApproverB = signJwt(uAppB.id, seed.orgB.id, "admin");

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 300_000);

afterAll(async () => {
  await pool?.end();
});

describe("Promotion — approval creates the register risk (real INSERT, real CHECKs)", () => {
  it("approve → risk exists with mapped fields; promoted_risk_id stamped", async () => {
    const f = await mkFinding(seed.orgA.id, "Public S3 bucket", {
      severity: "High",
      domain: "Cloud",
      likelihood: "high",
    });
    const acceptanceId = await acceptAndApprove(f, {
      ownerUserId: ownerA,
      jwtRequester: jwtRequesterA,
      jwtApprover: jwtApproverA,
      rationale: "Bucket only serves public marketing assets.",
    });

    const risks = await promotedRisksFor(seed.orgA.id, f);
    expect(risks).toHaveLength(1);
    const risk = risks[0]!;
    expect(risk.organization_id).toBe(seed.orgA.id);
    expect(risk.title).toBe("Public S3 bucket");
    expect(risk.domain).toBe("Cloud");
    expect(risk.likelihood).toBe("likely"); // finding 'high' → risks 'likely'
    expect(risk.impact).toBe("High");
    expect(risk.risk_rating).toBe("High");
    expect(risk.status).toBe("accepted");
    expect(risk.owner).toBe("Ada Owner");
    expect(risk.description).toContain("Bucket only serves public marketing assets.");
    // lifecycle stays dark: no lifecycle_state until R1 enables (memo §5)
    expect(risk.lifecycle_state).toBeNull();

    expect(await acceptanceStamp(acceptanceId)).toBe(risk.id);
  });

  it("null likelihood/domain fall back to 'possible'/'General' and pass the CHECKs", async () => {
    const f = await mkFinding(seed.orgA.id, "Unscored exposure", {
      severity: "Moderate",
      domain: null,
      likelihood: null,
    });
    await acceptAndApprove(f, {
      ownerUserId: ownerA,
      jwtRequester: jwtRequesterA,
      jwtApprover: jwtApproverA,
    });

    const risks = await promotedRisksFor(seed.orgA.id, f);
    expect(risks).toHaveLength(1);
    expect(risks[0]!.likelihood).toBe("possible");
    expect(risks[0]!.domain).toBe("General");
    expect(risks[0]!.risk_rating).toBe("Moderate");
  });
});

describe("Promotion — re-acceptance links, never duplicates (one risk per finding)", () => {
  it("withdraw → re-propose → re-approve points the new acceptance at the SAME risk", async () => {
    const f = await mkFinding(seed.orgA.id, "Legacy TLS endpoint", {
      severity: "High",
      domain: "Network",
      likelihood: "medium",
    });
    const firstAcceptance = await acceptAndApprove(f, {
      ownerUserId: ownerA,
      jwtRequester: jwtRequesterA,
      jwtApprover: jwtApproverA,
    });
    const [firstRisk] = await promotedRisksFor(seed.orgA.id, f);
    expect(firstRisk).toBeDefined();

    const withdrawn = await auth(
      "post",
      `/api/risk-acceptances/${firstAcceptance}/withdraw`,
      jwtRequesterA
    ).send({ reason: "Compensating control was decommissioned." });
    expect(withdrawn.status).toBe(200);

    const secondAcceptance = await acceptAndApprove(f, {
      ownerUserId: ownerA,
      jwtRequester: jwtRequesterA,
      jwtApprover: jwtApproverA,
      rationale: "New compensating control validated.",
    });

    // Still exactly one register risk for this finding — the link path fired.
    const risks = await promotedRisksFor(seed.orgA.id, f);
    expect(risks).toHaveLength(1);
    expect(risks[0]!.id).toBe(firstRisk!.id);

    // Both acceptances point at it.
    expect(await acceptanceStamp(firstAcceptance)).toBe(firstRisk!.id);
    expect(await acceptanceStamp(secondAcceptance)).toBe(firstRisk!.id);
  });
});

describe("Promotion — tenant isolation", () => {
  it("each org's promotion lands only in its own register; stamps never cross orgs", async () => {
    const beforeA = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM risks WHERE organization_id = $1`,
      [seed.orgA.id]
    );

    const fB = await mkFinding(seed.orgB.id, "Org-B exposure", {
      severity: "Critical",
      domain: "Identity",
      likelihood: "very_high",
    });
    const acceptanceB = await acceptAndApprove(fB, {
      ownerUserId: ownerB,
      jwtRequester: jwtRequesterB,
      jwtApprover: jwtApproverB,
    });

    // Org B got exactly one risk, in org B.
    const risksB = await promotedRisksFor(seed.orgB.id, fB);
    expect(risksB).toHaveLength(1);
    expect(risksB[0]!.organization_id).toBe(seed.orgB.id);
    expect(risksB[0]!.likelihood).toBe("very_likely");
    expect(risksB[0]!.risk_rating).toBe("Critical");

    // Nothing about org B's flow touched org A's register.
    const afterA = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM risks WHERE organization_id = $1`,
      [seed.orgA.id]
    );
    expect(afterA.rows[0]!.n).toBe(beforeA.rows[0]!.n);

    // The stamp resolves to a risk in the SAME org as the acceptance.
    const joined = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n
         FROM finding_risk_acceptances a
         JOIN risks r ON r.id = a.promoted_risk_id
        WHERE a.id = $1 AND r.organization_id = a.organization_id`,
      [acceptanceB]
    );
    expect(joined.rows[0]!.n).toBe("1");
  });
});

describe("Promotion — flag off is a pure no-op on the approval path", () => {
  it("approval succeeds, no risk row, no stamp", async () => {
    const f = await mkFinding(seed.orgA.id, "Dark-flag exposure", {
      severity: "Low",
      domain: "General",
      likelihood: "low",
    });

    delete process.env.SECURELOGIC_FINDING_RISK_PROMOTION_ENABLED;
    let acceptanceId: string;
    try {
      acceptanceId = await acceptAndApprove(f, {
        ownerUserId: ownerA,
        jwtRequester: jwtRequesterA,
        jwtApprover: jwtApproverA,
      });
    } finally {
      process.env.SECURELOGIC_FINDING_RISK_PROMOTION_ENABLED = "true";
    }

    expect(await promotedRisksFor(seed.orgA.id, f)).toHaveLength(0);
    expect(await acceptanceStamp(acceptanceId)).toBeNull();
  });
});
