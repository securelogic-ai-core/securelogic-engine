/**
 * applicabilityChallenge.test.ts — WA-2 / owner ruling 2, against real Postgres.
 *
 * THE INVARIANT THIS EXISTS TO DEFEND:
 *
 *   A challenge is a RECORD, not a mechanism. Raising one must not remove a
 *   requirement, change a scope item, alter a tier, or weaken the SecureLogic
 *   Core Assurance floor — with a reason, with a second approver, or at all.
 *
 * The ruling permits challenging a determination, supplying corrected facts,
 * supplying evidence, adding requirements and raising the tier by policy. It
 * forbids suppressing a requirement that remains factually applicable. So the
 * tests below assert both halves: that the disagreement is durably recorded
 * with its author and SecureLogic's original determination, and that the
 * composition is byte-identical afterwards.
 *
 * The second group covers the ruling's other half — a fact-corrected
 * non-applicability is an APPLICABILITY DETERMINATION WITH PROVENANCE, reached
 * by re-intake and re-composition, never by an override. That path already
 * existed; what WA-2 added is the reason it now carries.
 */

// Set BEFORE the route/jwt modules are imported: signJwt reads the secret at
// call time but the auth middleware refuses to build without one.
process.env["JWT_SECRET"] ??= "test-jwt-secret-for-applicability-challenge";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, seedUser, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { signJwt } from "../../src/api/lib/jwt.js";
import { recordAllCurrentConsents } from "../../src/api/lib/legalConsent.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;
/** A real human. A challenge with no author is refused by design. */
let actorToken: string;
let orgBToken: string;

const post = (token: string, path: string, body: unknown) =>
  request(app).post(path).set("Authorization", `Bearer ${token}`).send(body);
const get = (token: string, path: string) =>
  request(app).get(path).set("Authorization", `Bearer ${token}`);

/** Vendor → relationship → intake → engagement → composed scope. */
async function composedEngagement(
  token: string,
  orgId: string,
  label: string
): Promise<{ vendorId: string; relationshipId: string; engagementId: string }> {
  const vendorId = await seedVendor(pool, orgId, { name: `${label} vendor` });
  const rel = await post(token, `/api/vendors/${vendorId}/relationships`, {
    name: `${label} service`,
    service_description: "Under assessment",
  });
  expect(rel.status, JSON.stringify(rel.body)).toBe(201);
  const relationshipId = rel.body.relationship.id;

  const intake = await post(token, `/api/vendors/${vendorId}/relationships/${relationshipId}/intake`, {
    max_tolerable_disruption: "lt_24_hours", operational_dependency: "essential",
    business_reach: "enterprise_wide", substitutability: "replaceable_months",
    process_coupling: "in_critical_path", concentration: "moderate",
    data_sensitivity: "restricted", data_volume: "large", access_level: "read_write",
    regulatory_exposure: "high", regulatory_breach_notification: false,
    ai_involvement: "none", ai_autonomy: "none", hosting_model: "saas",
    fourth_party_exposure: "moderate",
  });
  expect(intake.status, JSON.stringify(intake.body)).toBe(201);

  const eng = await post(token, "/api/vendor-engagements", {
    vendor_id: vendorId, relationship_id: relationshipId,
    engagement_type: "initial", title: `${label} engagement`,
  });
  expect(eng.status, JSON.stringify(eng.body)).toBe(201);
  const engagementId = eng.body.id;

  const scope = await post(token, `/api/vendor-engagements/${engagementId}/scope`, {});
  expect(scope.status, JSON.stringify(scope.body)).toBe(200);
  return { vendorId, relationshipId, engagementId };
}

const compositionOf = (token: string, engagementId: string) =>
  get(token, `/api/vendor-engagements/${engagementId}/composition`);

const scopeItemCount = async (engagementId: string) =>
  Number(
    (
      await pool.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM vendor_engagement_scope_items WHERE engagement_id = $1`,
        [engagementId]
      )
    ).rows[0]!.n
  );

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env["TEST_DATABASE_URL"];
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env["DATABASE_URL"] = url;
  pool = new Pool({ connectionString: url });

  app = express();
  app.use(express.json());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));

  // A challenge is recorded against a PERSON, so these tests need a real user
  // session — an API key alone is refused by design (see the guards test).
  const uA = await seedUser(pool, seed.orgA.id, { email: "challenge-a@example.com" });
  const uB = await seedUser(pool, seed.orgB.id, { email: "challenge-b@example.com" });
  await recordAllCurrentConsents(pool, { userId: uA.id, organizationId: seed.orgA.id, consentMethod: "admin_recorded" });
  await recordAllCurrentConsents(pool, { userId: uB.id, organizationId: seed.orgB.id, consentMethod: "admin_recorded" });
  actorToken = signJwt(uA.id, seed.orgA.id, "admin");
  orgBToken = signJwt(uB.id, seed.orgB.id, "admin");
});

afterAll(async () => {
  await pool.end();
});

describe("WA-2 ruling 2 — a challenge records a disagreement and changes NOTHING", () => {
  it("records the objection with SecureLogic's own determination beside it", async () => {
    const { engagementId } = await composedEngagement(actorToken, seed.orgA.id, "chal-record");
    const before = await compositionOf(actorToken, engagementId);
    const objective = before.body.composition.core_assurance.objectives[0];

    const res = await post(actorToken, `/api/vendor-engagements/${engagementId}/applicability-challenges`, {
      requirement_reference: objective.reference,
      reason: "We have no subprocessors for this service; the declared facts are stale.",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // Said explicitly in the response, because the one thing a challenge must
    // never imply is that the questionnaire just changed.
    expect(res.body.composition_unchanged).toBe(true);
    // The resolution text must describe what ACTUALLY happens: a corrected
    // intake moves the relationship, and reassessing this engagement on the new
    // facts means opening a new one. See the frozen-facts test below.
    expect(res.body.resolution).toMatch(/does not change the assessment/i);
    expect(res.body.resolution).toMatch(/opening a new engagement from the relationship/i);

    const rows = await pool.query(
      `SELECT challenged_outcome, challenged_rationale, reason, snapshot_hash, raised_by_user_id
         FROM vendor_engagement_applicability_challenges WHERE engagement_id = $1`,
      [engagementId]
    );
    expect(rows.rowCount).toBe(1);
    const row = rows.rows[0]!;
    // SecureLogic's ORIGINAL determination, taken from the snapshot rather than
    // from the caller — the record must preserve what the platform said, not
    // the objector's account of it.
    expect(row.challenged_outcome).toBe(objective.outcome);
    expect(row.challenged_rationale).toBe(objective.rationale);
    expect(row.snapshot_hash).toBe(before.body.composition.hash);
    expect(row.raised_by_user_id).toBeTruthy();
  });

  it("leaves the composition byte-identical — same hash, same scope, same tier", async () => {
    const { engagementId } = await composedEngagement(actorToken, seed.orgA.id, "chal-inert");
    const before = await compositionOf(actorToken, engagementId);
    const itemsBefore = await scopeItemCount(engagementId);

    const objective = before.body.composition.core_assurance.objectives.find(
      (o: { outcome: string }) => o.outcome === "asked"
    );
    expect(objective, "an applicable objective is needed for this test to mean anything").toBeTruthy();

    const res = await post(actorToken, `/api/vendor-engagements/${engagementId}/applicability-challenges`, {
      requirement_reference: objective.reference,
      reason: "This objective should not apply to a service of this shape.",
    });
    expect(res.status).toBe(201);

    const after = await compositionOf(actorToken, engagementId);
    // THE FLOOR. An applicable Core Assurance objective is still applicable, is
    // still asked, and the snapshot that says so is the same snapshot.
    expect(after.body.composition.hash).toBe(before.body.composition.hash);
    expect(after.body.composition.summary).toEqual(before.body.composition.summary);
    expect(
      after.body.composition.core_assurance.objectives.find(
        (o: { reference: string }) => o.reference === objective.reference
      ).outcome
    ).toBe("asked");
    expect(await scopeItemCount(engagementId)).toBe(itemsBefore);
  });

  it("offers no route that removes a requirement", async () => {
    // The ruling forbids suppression outright, so the absence of a removal path
    // is the control. If someone ever adds DELETE here, this fails.
    const { engagementId } = await composedEngagement(actorToken, seed.orgA.id, "chal-noremove");
    const before = await compositionOf(actorToken, engagementId);
    const reference = before.body.composition.core_assurance.objectives[0].reference;

    const del = await request(app)
      .delete(`/api/vendor-engagements/${engagementId}/applicability-challenges`)
      .set("Authorization", `Bearer ${actorToken}`);
    expect([404, 405]).toContain(del.status);

    const suppress = await post(actorToken, `/api/vendor-engagements/${engagementId}/applicability-challenges`, {
      requirement_reference: reference,
      reason: "Attempting to suppress this requirement outright.",
      // A caller trying to make the challenge DO something. Ignored: the route
      // reads only the reference and the reason.
      remove: true,
      suppress: true,
      outcome: "not_applicable",
    });
    expect(suppress.status).toBe(201);
    const after = await compositionOf(actorToken, engagementId);
    expect(after.body.composition.hash).toBe(before.body.composition.hash);
  });

  it("refuses a challenge with no reason, and one with no human behind it", async () => {
    const { engagementId } = await composedEngagement(actorToken, seed.orgA.id, "chal-guards");
    const before = await compositionOf(actorToken, engagementId);
    const reference = before.body.composition.core_assurance.objectives[0].reference;

    const thin = await post(actorToken, `/api/vendor-engagements/${engagementId}/applicability-challenges`, {
      requirement_reference: reference,
      reason: "wrong",
    });
    expect(thin.status).toBe(400);
    expect(thin.body.error).toBe("reason_required");

    // An API key alone is not a person. An anonymous objection in an audit
    // trail is worse than no record.
    const anonymous = await request(app)
      .post(`/api/vendor-engagements/${engagementId}/applicability-challenges`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ requirement_reference: reference, reason: "Raised by an integration, not a person." });
    expect(anonymous.status).toBe(403);
    expect(anonymous.body.error).toBe("human_actor_required");

    expect(
      Number(
        (
          await pool.query<{ n: string }>(
            `SELECT COUNT(*)::text AS n FROM vendor_engagement_applicability_challenges WHERE engagement_id = $1`,
            [engagementId]
          )
        ).rows[0]!.n
      )
    ).toBe(0);
  });

  it("refuses a reference that is not part of this composition", async () => {
    const { engagementId } = await composedEngagement(actorToken, seed.orgA.id, "chal-unknown");
    const res = await post(actorToken, `/api/vendor-engagements/${engagementId}/applicability-challenges`, {
      requirement_reference: "CAS-99",
      reason: "Challenging something that was never part of this assessment.",
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("determination_not_found");
  });

  it("is append-only — a recorded objection cannot be edited or deleted away", async () => {
    const { engagementId } = await composedEngagement(actorToken, seed.orgA.id, "chal-worm");
    const before = await compositionOf(actorToken, engagementId);
    await post(actorToken, `/api/vendor-engagements/${engagementId}/applicability-challenges`, {
      requirement_reference: before.body.composition.core_assurance.objectives[0].reference,
      reason: "An objection that must outlive whoever is embarrassed by it.",
    });

    await expect(
      pool.query(
        `UPDATE vendor_engagement_applicability_challenges SET reason = 'softened' WHERE engagement_id = $1`,
        [engagementId]
      )
    ).rejects.toThrow();
    await expect(
      pool.query(`DELETE FROM vendor_engagement_applicability_challenges WHERE engagement_id = $1`, [engagementId])
    ).rejects.toThrow();
  });

  it("a re-intake does NOT reach an existing engagement — OPEN RULING, pinned here", async () => {
    // ── WHAT THIS TEST DOCUMENTS ────────────────────────────────────────
    //
    // Ruling 2 names the resolution path for a challenged determination:
    // "correct the relationship's facts and compose again". For an engagement
    // that ALREADY EXISTS, that path does not work, and this pins why so the
    // gap cannot be lost:
    //
    //   createEngagement copies the relationship's facts onto
    //   `vendor_engagements` (data_sensitivity, access_level, … and
    //   `assessment_tier`) at CREATE time, and resolveScope composes from
    //   THOSE columns. No route updates them afterwards — the only writes to
    //   vendor_engagements after creation are status transitions, the
    //   inherent-rating override, and residual/decision.
    //
    // So a corrected intake re-classifies the RELATIONSHIP and applies to
    // engagements opened after it, while this one keeps composing on the facts
    // it was opened with. Whether a not-yet-issued engagement should re-read
    // current facts is a methodology decision, not a bug fix, so it is
    // reported rather than changed here.
    const { vendorId, relationshipId, engagementId } = await composedEngagement(
      actorToken, seed.orgA.id, "chal-facts-frozen"
    );
    const before = await compositionOf(actorToken, engagementId);
    await post(actorToken, `/api/vendor-engagements/${engagementId}/applicability-challenges`, {
      requirement_reference: before.body.composition.core_assurance.objectives[0].reference,
      reason: "Raised against the first composition of this engagement.",
    });

    const reintake = await post(actorToken, `/api/vendors/${vendorId}/relationships/${relationshipId}/intake`, {
      max_tolerable_disruption: "gt_1_month", operational_dependency: "incidental",
      business_reach: "single_team", substitutability: "interchangeable",
      process_coupling: "peripheral", concentration: "none",
      data_sensitivity: "none", data_volume: "minimal", access_level: "none",
      regulatory_exposure: "none", regulatory_breach_notification: false,
      ai_involvement: "none", ai_autonomy: "none", hosting_model: "saas",
      fourth_party_exposure: "none",
      change_reason: "The service was re-scoped: it no longer touches customer data or systems.",
    });
    expect(reintake.status, JSON.stringify(reintake.body)).toBe(201);
    // The RELATIONSHIP did move — the corrected facts were applied there.
    expect(reintake.body.relationship.assessment_tier).toBe("tier_4_low");

    await post(actorToken, `/api/vendor-engagements/${engagementId}/scope`, {});
    const after = await compositionOf(actorToken, engagementId);
    // The ENGAGEMENT did not. Same determination, same hash.
    expect(after.body.composition.hash).toBe(before.body.composition.hash);
    expect(after.body.composition.tier).toBe(before.body.composition.tier);

    // And therefore the challenge is still live. `superseded` is derived from
    // the snapshot hash, so it flips only when the determination actually
    // changes — reachable through governed evidence (an objective becoming
    // `evidence_satisfied`) or a requirement-library change, not through a
    // re-intake on this engagement.
    const list = await get(actorToken, `/api/vendor-engagements/${engagementId}/applicability-challenges`);
    expect(list.body.challenges[0].superseded).toBe(false);
    expect(list.body.challenges[0].reason).toBe("Raised against the first composition of this engagement.");
    expect(list.body.challenges[0].raised_by_email).toBeTruthy();
  });

  it("does not leak, or accept, across organizations", async () => {
    const a = await composedEngagement(actorToken, seed.orgA.id, "chal-xorg-a");
    const before = await compositionOf(actorToken, a.engagementId);
    await post(actorToken, `/api/vendor-engagements/${a.engagementId}/applicability-challenges`, {
      requirement_reference: before.body.composition.core_assurance.objectives[0].reference,
      reason: "Org A's internal disagreement, which is nobody else's business.",
    });

    // Org B cannot read it, and cannot raise one against org A's engagement.
    // Both answer 404 — indistinguishable from an engagement that never existed.
    const read = await get(orgBToken, `/api/vendor-engagements/${a.engagementId}/applicability-challenges`);
    expect(read.status).toBe(404);
    const write = await post(orgBToken, `/api/vendor-engagements/${a.engagementId}/applicability-challenges`, {
      requirement_reference: "CAS-01",
      reason: "Reaching into another tenant's assessment.",
    });
    expect(write.status).toBe(404);

    // And org A still has exactly its own one.
    const mine = await get(actorToken, `/api/vendor-engagements/${a.engagementId}/applicability-challenges`);
    expect(mine.body.count).toBe(1);
  });
});

describe("WA-2 ruling 2 — a fact-corrected determination carries its reason", () => {
  it("requires a reason on a RE-intake and keeps it with the new facts", async () => {
    const { vendorId, relationshipId } = await composedEngagement(actorToken, seed.orgA.id, "reason-required");

    const bare = await post(actorToken, `/api/vendors/${vendorId}/relationships/${relationshipId}/intake`, {
      max_tolerable_disruption: "gt_1_month", operational_dependency: "incidental",
      business_reach: "single_team", substitutability: "interchangeable",
      process_coupling: "peripheral", concentration: "none",
      data_sensitivity: "none", data_volume: "minimal", access_level: "none",
      regulatory_exposure: "none", regulatory_breach_notification: false,
      ai_involvement: "none", ai_autonomy: "none", hosting_model: "saas",
      fourth_party_exposure: "none",
    });
    expect(bare.status).toBe(400);
    expect(bare.body.error).toBe("change_reason_required");

    const withReason = await post(actorToken, `/api/vendors/${vendorId}/relationships/${relationshipId}/intake`, {
      max_tolerable_disruption: "gt_1_month", operational_dependency: "incidental",
      business_reach: "single_team", substitutability: "interchangeable",
      process_coupling: "peripheral", concentration: "none",
      data_sensitivity: "none", data_volume: "minimal", access_level: "none",
      regulatory_exposure: "none", regulatory_breach_notification: false,
      ai_involvement: "none", ai_autonomy: "none", hosting_model: "saas",
      fourth_party_exposure: "none",
      change_reason: "Contract amended: the vendor no longer receives customer data.",
    });
    expect(withReason.status, JSON.stringify(withReason.body)).toBe(201);

    const history = await get(actorToken, `/api/vendors/${vendorId}/relationships/${relationshipId}/intake`);
    expect(history.status).toBe(200);
    const versions = history.body.intake;
    // Both versions survive — the ruling's "preserve the changed factual basis".
    expect(versions).toHaveLength(2);
    expect(versions[0].change_reason).toBe("Contract amended: the vendor no longer receives customer data.");
    // The FIRST intake has no reason and is not made to invent one: there is no
    // prior state for a baseline to explain.
    expect(versions[1].change_reason).toBeNull();
  });

  it("does not demand a reason for the FIRST intake on a relationship", async () => {
    const vendorId = await seedVendor(pool, seed.orgA.id, { name: "reason-baseline vendor" });
    const rel = await post(actorToken, `/api/vendors/${vendorId}/relationships`, { name: "Baseline service" });
    const res = await post(actorToken, `/api/vendors/${vendorId}/relationships/${rel.body.relationship.id}/intake`, {
      max_tolerable_disruption: "1_to_7_days", operational_dependency: "significant",
      business_reach: "multi_function", substitutability: "replaceable_months",
      process_coupling: "supports_critical_path", concentration: "low",
      data_sensitivity: "confidential", data_volume: "moderate", access_level: "read_only",
      regulatory_exposure: "moderate", regulatory_breach_notification: false,
      ai_involvement: "none", ai_autonomy: "none", hosting_model: "saas",
      fourth_party_exposure: "low",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it("corrected facts re-derive the RELATIONSHIP, and the reason is kept with them", async () => {
    // The half of ruling 2's resolution path that DOES work today: a corrected
    // intake re-derives criticality, inherent risk and the tier on the
    // relationship, both versions survive, and the new one carries its reason.
    // An engagement opened AFTER this composes on the corrected facts.
    const { vendorId, relationshipId, engagementId } = await composedEngagement(
      actorToken, seed.orgA.id, "reason-determination"
    );
    const before = await compositionOf(actorToken, engagementId);
    expect(before.body.composition.summary.core_applicable).toBeGreaterThan(0);

    const corrected = await post(actorToken, `/api/vendors/${vendorId}/relationships/${relationshipId}/intake`, {
      max_tolerable_disruption: "gt_1_month", operational_dependency: "incidental",
      business_reach: "single_team", substitutability: "interchangeable",
      process_coupling: "peripheral", concentration: "none",
      data_sensitivity: "none", data_volume: "minimal", access_level: "none",
      regulatory_exposure: "none", regulatory_breach_notification: false,
      ai_involvement: "none", ai_autonomy: "none", hosting_model: "saas",
      fourth_party_exposure: "none",
      change_reason: "The integration was decommissioned; no data and no access remain.",
    });
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(201);
    expect(corrected.body.relationship.assessment_tier).toBe("tier_4_low");
    // A DETERMINATION with provenance: the derived rating carries its basis and
    // its methodology stamp, and the previous classification is not edited —
    // it is superseded by a new intake version.
    expect(corrected.body.relationship.criticality_basis).toBeTruthy();
    expect(corrected.body.relationship.tier_basis).toBeTruthy();

    // A NEW engagement on the corrected relationship composes on the new facts,
    // which is what makes this the resolution path rather than a dead end.
    const fresh = await post(actorToken, "/api/vendor-engagements", {
      vendor_id: vendorId, relationship_id: relationshipId,
      engagement_type: "periodic", title: "After the correction",
    });
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(201);
    await post(actorToken, `/api/vendor-engagements/${fresh.body.id}/scope`, {});
    const freshComposition = await compositionOf(actorToken, fresh.body.id);
    const nowNa = freshComposition.body.composition.core_assurance.objectives.filter(
      (o: { outcome: string }) => o.outcome === "not_applicable"
    );
    expect(nowNa.length).toBeGreaterThan(before.body.composition.summary.core_not_applicable);
    // The rule's OWN rationale and the facts it read — not a human's assertion.
    expect(nowNa[0].rationale).toBeTruthy();
    expect(nowNa[0].basis).toBeTruthy();
    // And the original engagement's determination is untouched beside it.
    const original = await compositionOf(actorToken, engagementId);
    expect(original.body.composition.hash).toBe(before.body.composition.hash);
  });
});
