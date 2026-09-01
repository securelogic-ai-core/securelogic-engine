/**
 * evidenceLinkWriter.test.ts — the governed writer against a real Postgres.
 *
 * Steps 2 and 3 proved what the DATABASE refuses. This proves what the WRITER
 * refuses, which is a different question: the database is the backstop, and a
 * caller should get a reason rather than a constraint violation.
 *
 *   1. LINKING DOES NOT CONFIRM. A new link does not count.
 *   2. CONFIRMATION IS THE ACT THAT COUNTS, and it is write-once.
 *   3. DETACH IS TERMINAL.
 *   4. CURATION IS WRITE-ONCE, and an unratified class yields NO window
 *      rather than a guessed one.
 *   5. THE CUSTOMER LAYER BINDS — tighten freely, loosen to the ceiling only.
 *   6. EVERY MUTATION LEFT A RECORD.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";
import {
  linkEvidence, confirmLink, detachLink, establishAssurance,
} from "../../src/api/lib/evidenceLinkWriter.js";

let seed: TestDbSeed;
let pool: Pool;
let userA = "";

async function newEvidence(orgId: string, title: string): Promise<string> {
  const r = await pool.query(
    `INSERT INTO evidence (organization_id, source_type, source_id, title, evidence_type)
     VALUES ($1,'control_test',gen_random_uuid(),$2,'document') RETURNING id`,
    [orgId, title]
  );
  return r.rows[0].id;
}

/** Run a writer call with the tenant pinned, as a route's asTenant wrap does. */
async function asOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  await pool.query("SELECT set_config('app.current_org_id', $1, false)", [orgId]);
  return fn();
}

async function events(evidenceId: string): Promise<string[]> {
  const r = await pool.query(
    `SELECT event_type FROM evidence_lifecycle_events
      WHERE evidence_id = $1 ORDER BY occurred_at, event_type`,
    [evidenceId]
  );
  return r.rows.map((x) => x.event_type);
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the writer test.");
  pool = new Pool({ connectionString: url, ssl: false });
  userA = (await seedUser(pool, seed.orgA.id)).id;
}, 180_000);

afterAll(async () => { await pool?.end().catch(() => {}); });

describe("1. linking records a USE and nothing more", () => {
  it("a new link is unconfirmed and does not count", async () => {
    const ev = await newEvidence(seed.orgA.id, "w-link");
    const out = await asOrg(seed.orgA.id, () => linkEvidence({
      organizationId: seed.orgA.id, evidenceId: ev, targetType: "finding",
      targetId: crypto.randomUUID(), targetRequirementId: null,
      linkKind: "origin", actorUserId: userA,
    }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const r = await pool.query("SELECT confirmed_at FROM evidence_links WHERE id=$1", [out.value.linkId]);
    expect(r.rows[0].confirmed_at).toBeNull();
    expect(await events(ev)).toEqual(["linked"]);
  });

  it("refuses a requirement grain on a non-engagement target", async () => {
    const ev = await newEvidence(seed.orgA.id, "w-grain");
    const out = await asOrg(seed.orgA.id, () => linkEvidence({
      organizationId: seed.orgA.id, evidenceId: ev, targetType: "finding",
      targetId: crypto.randomUUID(), targetRequirementId: crypto.randomUUID(),
      linkKind: "origin", actorUserId: userA,
    }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("requirement_grain_not_allowed");
  });

  it("refuses a second LIVE link in the same context with a reason, not a raw error", async () => {
    const ev = await newEvidence(seed.orgA.id, "w-dupe");
    const target = crypto.randomUUID();
    const args = {
      organizationId: seed.orgA.id, evidenceId: ev, targetType: "finding" as const,
      targetId: target, targetRequirementId: null, linkKind: "origin" as const, actorUserId: userA,
    };
    expect((await asOrg(seed.orgA.id, () => linkEvidence(args))).ok).toBe(true);
    const second = await asOrg(seed.orgA.id, () => linkEvidence(args));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("duplicate_live_link");
  });

  it("refuses an artifact in another organization", async () => {
    const ev = await newEvidence(seed.orgB.id, "w-crossorg");
    const out = await asOrg(seed.orgA.id, () => linkEvidence({
      organizationId: seed.orgA.id, evidenceId: ev, targetType: "finding",
      targetId: crypto.randomUUID(), targetRequirementId: null,
      linkKind: "origin", actorUserId: userA,
    }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("evidence_not_found");
  });
});

describe("2. confirmation is the act that counts, and it is write-once", () => {
  it("confirms once, then refuses", async () => {
    const ev = await newEvidence(seed.orgA.id, "w-confirm");
    const link = await asOrg(seed.orgA.id, () => linkEvidence({
      organizationId: seed.orgA.id, evidenceId: ev, targetType: "finding",
      targetId: crypto.randomUUID(), targetRequirementId: null,
      linkKind: "origin", actorUserId: userA,
    }));
    expect(link.ok).toBe(true);
    if (!link.ok) return;

    const first = await asOrg(seed.orgA.id, () => confirmLink({
      organizationId: seed.orgA.id, linkId: link.value.linkId, actorUserId: userA, note: "reviewed",
    }));
    expect(first.ok).toBe(true);

    const second = await asOrg(seed.orgA.id, () => confirmLink({
      organizationId: seed.orgA.id, linkId: link.value.linkId, actorUserId: userA, note: "again",
    }));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("link_already_confirmed");
    expect(await events(ev)).toEqual(["linked", "confirmed"]);
  });
});

describe("3. detach is terminal", () => {
  it("detaches once, then refuses; a detached link cannot be confirmed", async () => {
    const ev = await newEvidence(seed.orgA.id, "w-detach");
    const link = await asOrg(seed.orgA.id, () => linkEvidence({
      organizationId: seed.orgA.id, evidenceId: ev, targetType: "finding",
      targetId: crypto.randomUUID(), targetRequirementId: null,
      linkKind: "origin", actorUserId: userA,
    }));
    if (!link.ok) throw new Error("fixture failed to build");

    const d1 = await asOrg(seed.orgA.id, () => detachLink({
      organizationId: seed.orgA.id, linkId: link.value.linkId, actorUserId: userA,
      reason: "no_longer_relevant", note: "superseded by a newer report",
    }));
    expect(d1.ok).toBe(true);

    const d2 = await asOrg(seed.orgA.id, () => detachLink({
      organizationId: seed.orgA.id, linkId: link.value.linkId, actorUserId: userA, reason: "no_longer_relevant",
    }));
    expect(d2.ok).toBe(false);
    if (!d2.ok) expect(d2.reason).toBe("link_already_detached");

    const c = await asOrg(seed.orgA.id, () => confirmLink({
      organizationId: seed.orgA.id, linkId: link.value.linkId, actorUserId: userA, note: "too late",
    }));
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toBe("link_already_detached");
  });
});

describe("4. curation is write-once and never guesses a window", () => {
  it("establishes a SOC 2 Type II window from the ratified 12-month policy", async () => {
    const ev = await newEvidence(seed.orgA.id, "w-soc2");
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "soc2_type2",
      anchorDate: "2025-12-31", artifactAssertedUntil: null, actorUserId: userA,
    }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.validityBasis).toBe("policy_default");
    expect(out.value.validUntil).toBe("2026-12-31");
    expect(await events(ev)).toEqual(["assurance_class_established", "validity_established"]);
  });

  it("a Type I gets its CLASS but NO window — D1 named no duration", async () => {
    const ev = await newEvidence(seed.orgA.id, "w-type1");
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "soc2_type1",
      anchorDate: "2025-12-31", artifactAssertedUntil: null, actorUserId: userA,
    }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.validityBasis).toBe("not_established");
    expect(out.value.reason).toBe("policy_establishes_no_window");
    const r = await pool.query("SELECT assurance_class, validity_basis FROM evidence WHERE id=$1", [ev]);
    expect(r.rows[0]).toMatchObject({ assurance_class: "soc2_type1", validity_basis: "not_established" });
  });

  it("an UNRATIFIED class (D2-D14) gets no window either", async () => {
    const ev = await newEvidence(seed.orgA.id, "w-pentest");
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "pen_test",
      anchorDate: "2025-12-31", artifactAssertedUntil: null, actorUserId: userA,
    }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.reason).toBe("no_ratified_policy");
  });

  it("the artifact's own end caps the policy window", async () => {
    const ev = await newEvidence(seed.orgA.id, "w-capped");
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "soc2_type2",
      anchorDate: "2025-12-31", artifactAssertedUntil: "2026-06-30", actorUserId: userA,
    }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.validUntil).toBe("2026-06-30");
  });

  it("refuses a SECOND establishment — supersede the artifact instead", async () => {
    const ev = await newEvidence(seed.orgA.id, "w-writeonce");
    await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "soc2_type2",
      anchorDate: "2025-12-31", artifactAssertedUntil: null, actorUserId: userA,
    }));
    const again = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "soc1",
      anchorDate: "2025-12-31", artifactAssertedUntil: null, actorUserId: userA,
    }));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("assurance_class_already_established");
  });

  it("the DATABASE refuses a restatement even if the writer is bypassed", async () => {
    const ev = await newEvidence(seed.orgA.id, "w-dbguard");
    await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "soc2_type2",
      anchorDate: "2025-12-31", artifactAssertedUntil: null, actorUserId: userA,
    }));
    await expect(
      pool.query("UPDATE evidence SET assurance_class='soc1' WHERE id=$1", [ev])
    ).rejects.toThrow(/write-once/);
    await expect(
      pool.query("UPDATE evidence SET valid_until='2030-01-01' WHERE id=$1", [ev])
    ).rejects.toThrow(/frozen once established/);
  });
});

describe("5. the customer layer binds", () => {
  it("a customer TIGHTENING shortens the established window", async () => {
    await pool.query(
      `INSERT INTO organization_evidence_validity_settings
         (organization_id, assurance_class, duration_months, version, set_by_user_id, reason)
       VALUES ($1,'soc2_type2',6,1,$2,'stricter appetite')`,
      [seed.orgA.id, userA]
    );
    const ev = await newEvidence(seed.orgA.id, "w-tightened");
    const out = await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "soc2_type2",
      anchorDate: "2025-12-31", artifactAssertedUntil: null, actorUserId: userA,
    }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value.validUntil).toBe("2026-06-30");

    await pool.query(
      `UPDATE organization_evidence_validity_settings SET superseded_at = NOW()
        WHERE organization_id = $1 AND assurance_class = 'soc2_type2'`,
      [seed.orgA.id]
    );
  });

  it("the ceiling is enforced by the database on the customer layer", async () => {
    await expect(
      pool.query(
        `INSERT INTO organization_evidence_validity_settings
           (organization_id, assurance_class, duration_months, version, set_by_user_id, reason)
         VALUES ($1,'soc2_type2',24,9,$2,'too long')`,
        [seed.orgA.id, userA]
      )
    ).rejects.toThrow(/exceeds the platform ceiling/);
  });
});

describe("6. every mutation left a record", () => {
  it("the event stream reconstructs the whole life of an artifact", async () => {
    const ev = await newEvidence(seed.orgA.id, "w-story");
    const link = await asOrg(seed.orgA.id, () => linkEvidence({
      organizationId: seed.orgA.id, evidenceId: ev, targetType: "finding",
      targetId: crypto.randomUUID(), targetRequirementId: null,
      linkKind: "origin", actorUserId: userA,
    }));
    if (!link.ok) throw new Error("fixture failed to build");
    await asOrg(seed.orgA.id, () => confirmLink({
      organizationId: seed.orgA.id, linkId: link.value.linkId, actorUserId: userA, note: "good",
    }));
    await asOrg(seed.orgA.id, () => establishAssurance({
      organizationId: seed.orgA.id, evidenceId: ev, assuranceClass: "soc2_type2",
      anchorDate: "2025-12-31", artifactAssertedUntil: null, actorUserId: userA,
    }));
    await asOrg(seed.orgA.id, () => detachLink({
      organizationId: seed.orgA.id, linkId: link.value.linkId, actorUserId: userA, reason: "superseded",
    }));

    expect((await events(ev)).sort()).toEqual(
      ["assurance_class_established", "confirmed", "detached", "linked", "validity_established"]
    );
    const attributed = await pool.query(
      `SELECT count(*)::int n FROM evidence_lifecycle_events
        WHERE evidence_id=$1 AND actor_user_id IS NULL`, [ev]
    );
    expect(attributed.rows[0].n).toBe(0);
  });
});
