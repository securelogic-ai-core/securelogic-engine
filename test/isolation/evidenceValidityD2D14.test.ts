/**
 * evidenceValidityD2D14.test.ts — the owner's D2-D14 rulings against a real
 * Postgres, through the governed writer.
 *
 * Every test here is adversarial. Each one is an attempt to make the platform
 * assert something it cannot know, to slip past a ratified ceiling, or to reach
 * across a tenant boundary. The expected outcome is always a refusal with a
 * named reason, or a window narrower than the attacker asked for.
 *
 *   1. D9  — the observation date is a FACT, not a caller's claim.
 *   2. D10 — the linked engagement's cadence binds, and the 24-month ceiling
 *             outranks any cadence a customer sets.
 *   3. D7  — the linked policy's cadence binds; unlinked establishes nothing.
 *   4. CROSS-TENANT — another org's object can never supply a cadence.
 *   5. D13/D14 — the human-committed artifact basis, and where it is refused.
 *   6. D3  — a required certificate expiry fails closed.
 *   7. NO PARTIAL STATE — a refused window never strands an artifact.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";
import { establishAssurance } from "../../src/api/lib/evidenceLinkWriter.js";

let seed: TestDbSeed;
let pool: Pool;
let userA = "";

async function newEvidence(
  orgId: string, title: string,
  opts: {
    sourceType?: string; sourceId?: string; collectedAt?: string | null;
    engagementId?: string | null;
  } = {}
): Promise<string> {
  const r = await pool.query(
    `INSERT INTO evidence
       (organization_id, source_type, source_id, title, evidence_type, collected_at, engagement_id)
     VALUES ($1,$2,COALESCE($3::uuid, gen_random_uuid()),$4,'document',$5::date,$6::uuid)
     RETURNING id`,
    [orgId, opts.sourceType ?? "control_test", opts.sourceId ?? null, title,
     opts.collectedAt ?? null, opts.engagementId ?? null]
  );
  return r.rows[0].id;
}

async function newPolicyObject(orgId: string, lastReviewed: string, nextReview: string): Promise<string> {
  const r = await pool.query(
    `INSERT INTO policies (organization_id, name, status, last_reviewed_at, next_review_at)
     VALUES ($1,'D7 fixture ' || gen_random_uuid()::text,'active',$2::date,$3::date) RETURNING id`,
    [orgId, lastReviewed, nextReview]
  );
  return r.rows[0].id;
}

async function newEngagement(orgId: string, decidedAt: string, nextReviewDue: string): Promise<string> {
  const v = await pool.query(
    `INSERT INTO vendors (organization_id, name)
     VALUES ($1,'D10 vendor ' || gen_random_uuid()::text) RETURNING id`, [orgId]
  );
  const r = await pool.query(
    `INSERT INTO vendor_engagements
       (organization_id, vendor_id, engagement_type, status,
        methodology_version, scope_rule_version,
        decision, decision_rationale, decided_at, next_review_due)
     VALUES ($1,$2,'periodic','decided','1.0','1.0',
             'approved','D10 fixture',$3::timestamptz,$4::date)
     RETURNING id`,
    [orgId, v.rows[0].id, decidedAt, nextReviewDue]
  );
  return r.rows[0].id;
}

async function asOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  await pool.query("SELECT set_config('app.current_org_id', $1, false)", [orgId]);
  return fn();
}

async function row(evidenceId: string) {
  const r = await pool.query(
    `SELECT assurance_class, validity_basis,
            to_char(valid_from,'YYYY-MM-DD')  AS valid_from,
            to_char(valid_until,'YYYY-MM-DD') AS valid_until
       FROM evidence WHERE id = $1`,
    [evidenceId]
  );
  return r.rows[0];
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the D2-D14 test.");
  pool = new Pool({ connectionString: url, ssl: false });
  userA = (await seedUser(pool, seed.orgA.id)).id;
}, 180_000);

afterAll(async () => { await pool?.end().catch(() => {}); });

describe("1. D9 — a caller cannot manufacture freshness", () => {
  it("IGNORES a caller-supplied anchor and uses evidence.collected_at", async () => {
    const ev = await newEvidence(seed.orgA.id, "d9-bound", { collectedAt: "2026-07-01" });
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev,
      assuranceClass: "technical_configuration",
      // A caller claiming the export was taken today. It was taken in July.
      anchorDate: "2026-09-02", artifactAssertedUntil: null, actorUserId: userA,
    }));
    expect(out.ok).toBe(true);
    const r = await row(ev);
    expect(r.valid_from).toBe("2026-07-01");
    expect(r.valid_until).toBe("2026-10-01");
  });

  it("no collected_at means NO window — uploaded_at never substitutes", async () => {
    const ev = await newEvidence(seed.orgA.id, "d9-nodate", { collectedAt: null });
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev,
      assuranceClass: "technical_configuration",
      anchorDate: "2026-09-02", artifactAssertedUntil: null, actorUserId: userA,
    }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.reason).toBe("collected_at_required");
    const r = await row(ev);
    // The CLASS is recorded — knowing what an artifact is stays useful.
    expect(r.assurance_class).toBe("technical_configuration");
    expect(r.validity_basis).toBe("not_established");
    expect(r.valid_until).toBeNull();
  });

  it("a stale scan is excluded on its own dates, not on when it was filed", async () => {
    const ev = await newEvidence(seed.orgA.id, "d6-stale", { collectedAt: "2025-01-01" });
    await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev,
      assuranceClass: "vulnerability_scan",
      anchorDate: null, artifactAssertedUntil: null, actorUserId: userA,
    }));
    const r = await row(ev);
    expect(r.valid_until).toBe("2025-04-01");
    expect(new Date(r.valid_until) < new Date()).toBe(true);
  });
});

describe("2. D10 — the ceiling outranks any cadence a customer sets", () => {
  it("a SHORTER engagement cadence binds", async () => {
    const eng = await newEngagement(seed.orgA.id, "2026-01-01", "2026-07-01");
    const ev = await newEvidence(seed.orgA.id, "d10-short", {
      sourceType: "vendor_engagement", sourceId: eng, engagementId: eng,
    });
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev,
      assuranceClass: "vendor_attestation",
      anchorDate: null, artifactAssertedUntil: null, actorUserId: userA,
    }));
    expect(out.ok).toBe(true);
    expect((await row(ev)).valid_until).toBe("2026-07-01");
  });

  it("a 120-MONTH cadence cannot keep an attestation current past 24 months", async () => {
    const eng = await newEngagement(seed.orgA.id, "2026-01-01", "2036-01-01");
    const ev = await newEvidence(seed.orgA.id, "d10-forever", {
      sourceType: "vendor_engagement", sourceId: eng, engagementId: eng,
    });
    await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev,
      assuranceClass: "vendor_attestation",
      anchorDate: null, artifactAssertedUntil: null, actorUserId: userA,
    }));
    // The absolute SecureLogic assurance ceiling, not the customer's schedule.
    expect((await row(ev)).valid_until).toBe("2028-01-01");
  });

  it("an attestation with no engagement establishes nothing", async () => {
    const ev = await newEvidence(seed.orgA.id, "d10-unlinked");
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev,
      assuranceClass: "vendor_attestation",
      anchorDate: "2026-01-01", artifactAssertedUntil: null, actorUserId: userA,
    }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.reason).toBe("no_linked_object_cadence");
    expect((await row(ev)).validity_basis).toBe("not_established");
  });
});

describe("3. D7 — the policy object's own cadence, and nothing else", () => {
  it("follows the linked policy's next review date", async () => {
    const pol = await newPolicyObject(seed.orgA.id, "2026-03-01", "2027-03-01");
    const ev = await newEvidence(seed.orgA.id, "d7-linked", {
      sourceType: "policy_review", sourceId: pol,
    });
    await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev,
      assuranceClass: "policy_document",
      anchorDate: null, artifactAssertedUntil: null, actorUserId: userA,
    }));
    expect((await row(ev)).valid_until).toBe("2027-03-01");
  });

  it("a policy review cadence beyond 24 months is capped at the ceiling", async () => {
    const pol = await newPolicyObject(seed.orgA.id, "2026-03-01", "2030-03-01");
    const ev = await newEvidence(seed.orgA.id, "d7-longcadence", {
      sourceType: "policy_review", sourceId: pol,
    });
    await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev,
      assuranceClass: "policy_document",
      anchorDate: null, artifactAssertedUntil: null, actorUserId: userA,
    }));
    expect((await row(ev)).valid_until).toBe("2028-03-01");
  });

  it("an UNLINKED policy document establishes nothing", async () => {
    const ev = await newEvidence(seed.orgA.id, "d7-unlinked");
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev,
      assuranceClass: "policy_document",
      anchorDate: "2026-03-01", artifactAssertedUntil: null, actorUserId: userA,
    }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.reason).toBe("no_linked_object_cadence");
  });

  it("a policy object with no review dates establishes nothing", async () => {
    const r = await pool.query(
      `INSERT INTO policies (organization_id, name, status)
       VALUES ($1,'no dates ' || gen_random_uuid()::text,'draft') RETURNING id`,
      [seed.orgA.id]
    );
    const ev = await newEvidence(seed.orgA.id, "d7-nodates", {
      sourceType: "policy_review", sourceId: r.rows[0].id,
    });
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev,
      assuranceClass: "policy_document",
      anchorDate: null, artifactAssertedUntil: null, actorUserId: userA,
    }));
    if (!out.ok) return;
    expect(out.value.reason).toBe("no_linked_object_cadence");
  });
});

describe("4. CROSS-TENANT — another org's object supplies nothing", () => {
  it("org A cannot borrow org B's policy cadence", async () => {
    const polB = await newPolicyObject(seed.orgB.id, "2026-03-01", "2027-03-01");
    // Org A's evidence pointing at org B's policy id.
    const ev = await newEvidence(seed.orgA.id, "xt-policy", {
      sourceType: "policy_review", sourceId: polB,
    });
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev,
      assuranceClass: "policy_document",
      anchorDate: null, artifactAssertedUntil: null, actorUserId: userA,
    }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.reason).toBe("no_linked_object_cadence");
    expect((await row(ev)).valid_until).toBeNull();
  });

  it("org A cannot borrow org B's engagement cadence", async () => {
    const engB = await newEngagement(seed.orgB.id, "2026-01-01", "2026-07-01");
    const ev = await newEvidence(seed.orgA.id, "xt-engagement", {
      sourceType: "vendor_engagement", sourceId: engB, engagementId: engB,
    });
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev,
      assuranceClass: "vendor_attestation",
      anchorDate: null, artifactAssertedUntil: null, actorUserId: userA,
    }));
    if (!out.ok) return;
    expect(out.value.reason).toBe("no_linked_object_cadence");
  });

  it("the writer refuses another org's evidence outright", async () => {
    const evB = await newEvidence(seed.orgB.id, "xt-evidence", { collectedAt: "2026-07-01" });
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: evB,
      assuranceClass: "technical_configuration",
      anchorDate: null, artifactAssertedUntil: null, actorUserId: userA,
    }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("evidence_not_found");
  });
});

describe("5. D13 / D14 — the human-committed artifact basis", () => {
  it("a contract takes the term the ARTIFACT states", async () => {
    const ev = await newEvidence(seed.orgA.id, "d13-term");
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "contract",
      anchorDate: "2026-01-01", artifactAssertedUntil: "2029-01-01",
      basis: "artifact_dates", actorUserId: userA,
    }));
    expect(out.ok).toBe(true);
    const r = await row(ev);
    expect(r.validity_basis).toBe("artifact_dates");
    expect(r.valid_until).toBe("2029-01-01");
  });

  it("artifact_dates with NO stated end is refused — not silently perpetual", async () => {
    const ev = await newEvidence(seed.orgA.id, "d13-noend");
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "contract",
      anchorDate: "2026-01-01", artifactAssertedUntil: null,
      basis: "artifact_dates", actorUserId: userA,
    }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("artifact_dates_require_end");
    // And nothing was written: the class is NOT established either.
    expect((await row(ev)).assurance_class).toBe("unclassified");
  });

  it("perpetual requires an explicit assertion — a missing date is not one", async () => {
    const ev = await newEvidence(seed.orgA.id, "d13-perp-bare");
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "contract",
      anchorDate: "2026-01-01", artifactAssertedUntil: null,
      basis: "perpetual", perpetualAssertion: "  ", actorUserId: userA,
    }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("perpetual_requires_assertion");
    expect((await row(ev)).assurance_class).toBe("unclassified");
  });

  it("an explicit perpetual assertion is accepted and recorded", async () => {
    const ev = await newEvidence(seed.orgA.id, "d13-perp");
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "contract",
      anchorDate: "2026-01-01", artifactAssertedUntil: null, basis: "perpetual",
      perpetualAssertion: "Clause 14: continues until terminated on 90 days notice.",
      actorUserId: userA,
    }));
    expect(out.ok).toBe(true);
    const r = await row(ev);
    expect(r.validity_basis).toBe("perpetual");
    expect(r.valid_until).toBeNull();
  });

  it("other_assurance_report may commit its own term — no catch-all TTL exists", async () => {
    const ev = await newEvidence(seed.orgA.id, "d14-aoc");
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "other_assurance_report",
      anchorDate: "2026-02-01", artifactAssertedUntil: "2027-02-01",
      basis: "artifact_dates", actorUserId: userA,
    }));
    expect(out.ok).toBe(true);
    expect((await row(ev)).valid_until).toBe("2027-02-01");
  });

  it("other_assurance_report with NO term establishes nothing under the policy path", async () => {
    const ev = await newEvidence(seed.orgA.id, "d14-noterm");
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "other_assurance_report",
      anchorDate: "2026-02-01", artifactAssertedUntil: null, actorUserId: userA,
    }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.reason).toBe("no_ratified_policy");
    expect((await row(ev)).validity_basis).toBe("not_established");
  });

  it("a GOVERNED class refuses the artifact basis — it cannot route around the window", async () => {
    const ev = await newEvidence(seed.orgA.id, "d11-escape");
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "privacy_agreement",
      anchorDate: "2020-01-01", artifactAssertedUntil: null, basis: "perpetual",
      perpetualAssertion: "evergreen DPA", actorUserId: userA,
    }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("artifact_basis_not_permitted");
    expect((await row(ev)).assurance_class).toBe("unclassified");
  });
});

describe("6. D3 — a required certificate expiry fails closed", () => {
  it("no recorded expiry means NO window", async () => {
    const ev = await newEvidence(seed.orgA.id, "d3-noexpiry");
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "iso_certification",
      anchorDate: "2026-01-15", artifactAssertedUntil: null, actorUserId: userA,
    }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.reason).toBe("artifact_end_required");
  });

  it("a recorded expiry gives the annual re-evidence window inside the term", async () => {
    const ev = await newEvidence(seed.orgA.id, "d3-term");
    await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "iso_certification",
      anchorDate: "2026-01-15", artifactAssertedUntil: "2029-01-14", actorUserId: userA,
    }));
    expect((await row(ev)).valid_until).toBe("2027-01-15");
  });

  it("an expiry inside the cadence caps the window at the certificate", async () => {
    const ev = await newEvidence(seed.orgA.id, "d3-shortterm");
    await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "iso_certification",
      anchorDate: "2026-01-15", artifactAssertedUntil: "2026-06-30", actorUserId: userA,
    }));
    expect((await row(ev)).valid_until).toBe("2026-06-30");
  });
});

describe("7. no partial state, ever", () => {
  it("a refused window leaves the class recorded and the validity honest", async () => {
    const ev = await newEvidence(seed.orgA.id, "partial-1");
    await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "vendor_attestation",
      anchorDate: null, artifactAssertedUntil: null, actorUserId: userA,
    }));
    const r = await row(ev);
    expect(r.assurance_class).toBe("vendor_attestation");
    expect(r.validity_basis).toBe("not_established");
    expect(r.valid_from).toBeNull();
    expect(r.valid_until).toBeNull();
  });

  it("curation stays write-once — a second attempt is refused", async () => {
    const ev = await newEvidence(seed.orgA.id, "partial-2", { collectedAt: "2026-07-01" });
    await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "technical_configuration",
      anchorDate: null, artifactAssertedUntil: null, actorUserId: userA,
    }));
    const again = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "vulnerability_scan",
      anchorDate: null, artifactAssertedUntil: null, actorUserId: userA,
    }));
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.reason).toBe("assurance_class_already_established");
  });
});
