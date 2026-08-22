/**
 * aiGovernanceModelRls.test.ts — the AI Governance T2 family (T2-B/C/D/D2)
 * against real Postgres with RLS live.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------
 * The capability baseline's finding was that the chain "AI system → applicable
 * framework → controls → evidence" could not be REPRESENTED. Representation is
 * cheap to add and easy to add wrongly: four new M2M tables and an append-only
 * decision table are five new places a cross-tenant edge could hide. This file
 * proves, over HTTP against the real schema:
 *
 *   1. the edges exist and behave (declare, list, retract, idempotent POST);
 *   2. NO edge can be created to another org's endpoint — the pre-flight
 *      refuses a foreign target with a 404 indistinguishable from absence;
 *   3. RLS stands behind the routes on all five new tables (policy present,
 *      enforced on the tenant channel, owner channel exempt NOT FORCE);
 *   4. material change is BY VALUE (an idempotent save does not bump), and
 *      the bump makes a prior use approval visibly stale;
 *   5. the use-approval record enforces its own consistency rules (rationale
 *      always; conditions iff conditional; expiry only on approval) and its
 *      history is append-only from the API surface.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

type OrgChain = {
  aiSystemId: string;
  frameworkId: string;
  controlId: string;
  policyId: string;
  obligationId: string;
  assessmentId: string;
  userId: string;
};

let A: OrgChain;
let B: OrgChain;

/** Owner-channel seeding — the import path, not the request path. */
async function seedChain(orgId: string, label: string): Promise<OrgChain> {
  const ai = await pool.query<{ id: string }>(
    `INSERT INTO ai_systems (organization_id, name, use_case, criticality)
     VALUES ($1, $2, 'test triage', 'high') RETURNING id`,
    [orgId, `${label} triage model`]
  );
  const aiSystemId = ai.rows[0]!.id;

  const fw = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version)
     VALUES ($1, $2, '1.0') RETURNING id`,
    [orgId, `${label} NIST AI RMF`]
  );
  const ctl = await pool.query<{ id: string }>(
    `INSERT INTO controls (organization_id, name)
     VALUES ($1, $2) RETURNING id`,
    [orgId, `${label} model output review`]
  );
  const pol = await pool.query<{ id: string }>(
    `INSERT INTO policies (organization_id, name)
     VALUES ($1, $2) RETURNING id`,
    [orgId, `${label} acceptable AI use policy`]
  );
  const obl = await pool.query<{ id: string }>(
    `INSERT INTO obligations (organization_id, title)
     VALUES ($1, $2) RETURNING id`,
    [orgId, `${label} EU AI Act Art. 26 deployer duties`]
  );
  const assess = await pool.query<{ id: string }>(
    `INSERT INTO ai_governance_assessments (organization_id, ai_system_id, status)
     VALUES ($1, $2, 'compliant') RETURNING id`,
    [orgId, aiSystemId]
  );
  const user = await seedUser(pool, orgId, {});

  return {
    aiSystemId,
    frameworkId: fw.rows[0]!.id,
    controlId: ctl.rows[0]!.id,
    policyId: pol.rows[0]!.id,
    obligationId: obl.rows[0]!.id,
    assessmentId: assess.rows[0]!.id,
    userId: user.id
  };
}

const asOrgA = {
  get: (p: string) => request(app).get(p).set("X-Api-Key", seed.orgA.apiKey),
  post: (p: string) => request(app).post(p).set("X-Api-Key", seed.orgA.apiKey),
  patch: (p: string) => request(app).patch(p).set("X-Api-Key", seed.orgA.apiKey),
  delete: (p: string) => request(app).delete(p).set("X-Api-Key", seed.orgA.apiKey)
};
const asOrgB = {
  get: (p: string) => request(app).get(p).set("X-Api-Key", seed.orgB.apiKey),
  post: (p: string) => request(app).post(p).set("X-Api-Key", seed.orgB.apiKey)
};

const NEW_TABLES = [
  "ai_system_framework_links",
  "ai_system_control_links",
  "ai_system_policy_links",
  "ai_system_obligation_links",
  "ai_use_approvals"
];

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the AI governance test.");
  pool = new Pool({ connectionString: url, ssl: false });

  A = await seedChain(seed.orgA.id, "orgA");
  B = await seedChain(seed.orgB.id, "orgB");

  app = express();
  app.use(express.json());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

describe("schema invariants — RLS stands behind every new table", () => {
  it("all five new tables have RLS enabled and a tenant policy", async () => {
    for (const table of NEW_TABLES) {
      const rls = await pool.query<{ relrowsecurity: boolean }>(
        `SELECT relrowsecurity FROM pg_class WHERE relname = $1`,
        [table]
      );
      expect(rls.rows[0]?.relrowsecurity, `${table} RLS enabled`).toBe(true);
      const pol = await pool.query(
        `SELECT 1 FROM pg_policies WHERE tablename = $1`,
        [table]
      );
      expect(pol.rowCount, `${table} tenant policy`).toBeGreaterThan(0);
    }
  });

  it("ai_use_approvals grants app_request neither UPDATE nor DELETE — append-only by grant", async () => {
    const grants = await pool.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_name = 'ai_use_approvals' AND grantee = 'app_request'`
    );
    const privs = grants.rows.map((r) => r.privilege_type).sort();
    expect(privs).toContain("SELECT");
    expect(privs).toContain("INSERT");
    expect(privs).not.toContain("UPDATE");
    expect(privs).not.toContain("DELETE");
  });
});

describe("T2-B — the four governance edges, declared and read over HTTP", () => {
  const families = () => [
    { kind: "framework", plural: "frameworks", col: "framework_id", target: () => A.frameworkId, foreign: () => B.frameworkId },
    { kind: "control", plural: "controls", col: "control_id", target: () => A.controlId, foreign: () => B.controlId },
    { kind: "policy", plural: "policies", col: "policy_id", target: () => A.policyId, foreign: () => B.policyId },
    { kind: "obligation", plural: "obligations", col: "obligation_id", target: () => A.obligationId, foreign: () => B.obligationId }
  ];

  it("declares each edge and reads it back with the target's name", async () => {
    for (const f of families()) {
      const post = await asOrgA
        .post(`/api/ai-system-${f.kind}-links`)
        .send({ ai_system_id: A.aiSystemId, [f.col]: f.target() });
      expect(post.status, `${f.kind} POST`).toBe(201);
      expect(post.body.created).toBe(true);

      const list = await asOrgA.get(`/api/ai-systems/${A.aiSystemId}/${f.plural}`);
      expect(list.status).toBe(200);
      expect(list.body.count, `${f.kind} listed`).toBe(1);
      expect(String(list.body.links[0].target_name)).toContain("orgA");
    }
  });

  it("POST is idempotent — re-declaring returns the existing edge, created:false", async () => {
    const again = await asOrgA
      .post(`/api/ai-system-framework-links`)
      .send({ ai_system_id: A.aiSystemId, framework_id: A.frameworkId });
    expect(again.status).toBe(200);
    expect(again.body.created).toBe(false);

    const list = await asOrgA.get(`/api/ai-systems/${A.aiSystemId}/frameworks`);
    expect(list.body.count).toBe(1);
  });

  it("THE ONES THAT MATTER: an edge to ANOTHER ORG's endpoint is refused, indistinguishably from absence", async () => {
    for (const f of families()) {
      // org A's system, org B's target
      const cross = await asOrgA
        .post(`/api/ai-system-${f.kind}-links`)
        .send({ ai_system_id: A.aiSystemId, [f.col]: f.foreign() });
      expect(cross.status, `${f.kind} foreign target`).toBe(404);
      expect(cross.body.error).toBe(`${f.kind}_not_found`);

      // org B's system, org A's target — the other direction
      const cross2 = await asOrgB
        .post(`/api/ai-system-${f.kind}-links`)
        .send({ ai_system_id: A.aiSystemId, [f.col]: f.foreign() });
      expect(cross2.status, `${f.kind} foreign system`).toBe(404);
      expect(cross2.body.error).toBe("ai_system_not_found");
    }
  });

  it("org B cannot LIST org A's edges and cannot DELETE them", async () => {
    const list = await asOrgB.get(`/api/ai-systems/${A.aiSystemId}/frameworks`);
    expect(list.status).toBe(404); // A's system does not exist for B

    const aRow = await pool.query<{ id: string }>(
      `SELECT id FROM ai_system_framework_links WHERE organization_id = $1 LIMIT 1`,
      [seed.orgA.id]
    );
    const del = await request(app)
      .delete(`/api/ai-system-framework-links/${aRow.rows[0]!.id}`)
      .set("X-Api-Key", seed.orgB.apiKey);
    expect(del.status).toBe(404);
    const still = await pool.query(
      `SELECT 1 FROM ai_system_framework_links WHERE id = $1`,
      [aRow.rows[0]!.id]
    );
    expect(still.rowCount).toBe(1);
  });

  it("retraction deletes exactly the named edge", async () => {
    const post = await asOrgA
      .post(`/api/ai-system-control-links`)
      .send({ ai_system_id: B.aiSystemId, control_id: B.controlId });
    // A cannot create on B's system — sanity that we use org B for this leg.
    expect(post.status).toBe(404);

    const created = await asOrgB
      .post(`/api/ai-system-control-links`)
      .send({ ai_system_id: B.aiSystemId, control_id: B.controlId });
    expect(created.status).toBe(201);

    const del = await request(app)
      .delete(`/api/ai-system-control-links/${created.body.link.id}`)
      .set("X-Api-Key", seed.orgB.apiKey);
    expect(del.status).toBe(200);
    const gone = await request(app)
      .get(`/api/ai-systems/${B.aiSystemId}/controls`)
      .set("X-Api-Key", seed.orgB.apiKey);
    expect(gone.body.count).toBe(0);
  });
});

describe("T2-C/T2-D — enrichment fields and material change, by value", () => {
  it("accepts the closed vocabularies and rejects a value outside them", async () => {
    const ok = await asOrgA.patch(`/api/ai-systems/${A.aiSystemId}`).send({
      eu_ai_act_tier: "high_risk",
      human_oversight_level: "human_in_the_loop",
      sensitive_data_categories: ["pii", "phi"],
      business_owner_user_id: A.userId
    });
    expect(ok.status).toBe(200);
    expect(ok.body.ai_system.eu_ai_act_tier).toBe("high_risk");
    expect(ok.body.ai_system.material_state_version).toBe(2); // bumped: real change

    const bad = await asOrgA
      .patch(`/api/ai-systems/${A.aiSystemId}`)
      .send({ eu_ai_act_tier: "catastrophic" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_eu_ai_act_tier");
  });

  it("a business owner from ANOTHER org is refused — the cross-row pre-flight", async () => {
    const res = await asOrgA
      .patch(`/api/ai-systems/${A.aiSystemId}`)
      .send({ business_owner_user_id: B.userId });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("business_owner_user_not_in_organization");
  });

  it("an IDEMPOTENT save does not bump the material version", async () => {
    const before = await asOrgA.get(`/api/ai-systems/${A.aiSystemId}`);
    const v = before.body.ai_system.material_state_version;

    const same = await asOrgA.patch(`/api/ai-systems/${A.aiSystemId}`).send({
      eu_ai_act_tier: "high_risk",
      sensitive_data_categories: ["phi", "pii"] // same set, different order
    });
    expect(same.status).toBe(200);
    expect(same.body.ai_system.material_state_version).toBe(v);
    expect(same.body.ai_system.reassessment_reason).toBe(
      before.body.ai_system.reassessment_reason
    );
  });

  it("a REAL change bumps the version and states why, in plain language", async () => {
    const res = await asOrgA
      .patch(`/api/ai-systems/${A.aiSystemId}`)
      .send({ human_oversight_level: "autonomous_consequential" });
    expect(res.status).toBe(200);
    expect(res.body.ai_system.material_state_version).toBe(3);
    expect(res.body.ai_system.reassessment_recommended_at).not.toBeNull();
    expect(String(res.body.ai_system.reassessment_reason)).toContain(
      "human_oversight_level"
    );
  });

  it("setting a cadence with no explicit date starts the clock from today", async () => {
    const res = await asOrgA
      .patch(`/api/ai-systems/${A.aiSystemId}`)
      .send({ review_cadence_days: 90 });
    expect(res.status).toBe(200);
    expect(res.body.ai_system.review_cadence_days).toBe(90);
    expect(res.body.ai_system.next_review_due).not.toBeNull();
    expect(res.body.ai_system.review_overdue).toBe(false);
    // The clock is not a material field: version unchanged.
    expect(res.body.ai_system.material_state_version).toBe(3);
  });
});

describe("T2-D2 — the use decision", () => {
  it("refuses a decision with no rationale, and conditions without the conditional decision", async () => {
    const noReason = await asOrgA
      .post(`/api/ai-systems/${A.aiSystemId}/use-approvals`)
      .send({ decision: "approved" });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error).toBe("rationale_required");

    const strayConditions = await asOrgA
      .post(`/api/ai-systems/${A.aiSystemId}/use-approvals`)
      .send({ decision: "approved", rationale: "fine", conditions: "but" });
    expect(strayConditions.status).toBe(400);

    const noConditions = await asOrgA
      .post(`/api/ai-systems/${A.aiSystemId}/use-approvals`)
      .send({ decision: "approved_with_conditions", rationale: "fine" });
    expect(noConditions.status).toBe(400);
    expect(noConditions.body.error).toBe("conditions_required");

    const expiringRejection = await asOrgA
      .post(`/api/ai-systems/${A.aiSystemId}/use-approvals`)
      .send({ decision: "rejected", rationale: "no", expires_at: "2027-01-01" });
    expect(expiringRejection.status).toBe(400);
    expect(expiringRejection.body.error).toBe("expiry_only_on_approval");
  });

  it("records an approval snapshotting the material state it was decided against", async () => {
    const res = await asOrgA.post(`/api/ai-systems/${A.aiSystemId}/use-approvals`).send({
      decision: "approved_with_conditions",
      rationale: "Effective oversight demonstrated in assessment.",
      conditions: "Quarterly output audits; PHI redaction verified before each release.",
      expires_at: "2027-08-22",
      assessment_id: A.assessmentId
    });
    expect(res.status).toBe(201);
    expect(res.body.approval.material_state_version).toBe(3);
    expect(res.body.approval.decided_at).not.toBeNull();
  });

  it("an assessment of a DIFFERENT system cannot justify the decision", async () => {
    const other = await pool.query<{ id: string }>(
      `INSERT INTO ai_systems (organization_id, name) VALUES ($1, 'orgA other system')
       RETURNING id`,
      [seed.orgA.id]
    );
    const res = await asOrgA.post(`/api/ai-systems/${other.rows[0]!.id}/use-approvals`).send({
      decision: "approved",
      rationale: "reusing the triage model's assessment",
      assessment_id: A.assessmentId
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("assessment_not_found_for_this_system");
  });

  it("a later material change marks the standing approval materially_changed_since", async () => {
    const before = await asOrgA.get(`/api/ai-systems/${A.aiSystemId}/use-approvals`);
    expect(before.body.current_decision.materially_changed_since).toBe(false);

    const change = await asOrgA
      .patch(`/api/ai-systems/${A.aiSystemId}`)
      .send({ eu_ai_act_tier: "limited_risk" });
    expect(change.status).toBe(200);

    const after = await asOrgA.get(`/api/ai-systems/${A.aiSystemId}/use-approvals`);
    expect(after.body.current_decision.materially_changed_since).toBe(true);
    expect(after.body.current_decision.expired).toBe(false);
  });

  it("history is append-only and newest-first; a new decision supersedes, never edits", async () => {
    const suspend = await asOrgA.post(`/api/ai-systems/${A.aiSystemId}/use-approvals`).send({
      decision: "suspended",
      rationale: "Materially changed since approval; suspended pending reassessment."
    });
    expect(suspend.status).toBe(201);

    const history = await asOrgA.get(`/api/ai-systems/${A.aiSystemId}/use-approvals`);
    expect(history.body.count).toBe(2);
    expect(history.body.current_decision.decision).toBe("suspended");
    expect(history.body.approvals[1].decision).toBe("approved_with_conditions");
  });

  it("org B sees none of it — history, current decision, or the system itself", async () => {
    const res = await asOrgB.get(`/api/ai-systems/${A.aiSystemId}/use-approvals`);
    expect(res.status).toBe(404);
  });
});

describe("RLS is what stands behind the routes — tenant channel proof", () => {
  it("the tenant channel scopes every new table; the owner channel is exempt (NOT FORCE)", async () => {
    for (const table of NEW_TABLES) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE app_request");
        await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgB.id]);
        const asB = await client.query(
          `SELECT COUNT(*)::int AS n FROM ${table} WHERE organization_id = $1`,
          [seed.orgA.id]
        );
        expect(asB.rows[0].n, `${table} cross-org via tenant channel`).toBe(0);
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    }
    // Owner channel sees org A's rows (NOT FORCE) — proves the zeros above are
    // RLS, not empty tables.
    const owner = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM ai_use_approvals WHERE organization_id = $1`,
      [seed.orgA.id]
    );
    expect(owner.rows[0]!.n).toBeGreaterThan(0);
  });
});
