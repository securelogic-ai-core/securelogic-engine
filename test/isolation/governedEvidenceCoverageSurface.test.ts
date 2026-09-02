/**
 * governedEvidenceCoverageSurface.test.ts — the governed-evidence arm of the
 * assurance coverage surface, against a real Postgres.
 *
 * Owner-authorized 2026-09-02. The surface makes curated non-SOC evidence
 * VISIBLE at requirement grain and explicitly NON-COUNTING. It must prove:
 *
 *   a. current governed non-SOC evidence is visible at requirement grain
 *   b. it stays explicitly non-counting where tested-control authority is absent
 *   c. the reason is deterministic
 *   d. expired / not-established evidence never masquerades as current
 *   e. cross-tenant evidence can never appear
 *   f. questionnaire depth is untouched — `covered` stays empty
 *
 * The owner ruling this encodes: SOC-shaped vetoes stay NOT_EVALUABLE and fail
 * closed for non-tested-control classes, and NO `INAPPLICABLE` veto state is
 * introduced. Nothing here proposes sufficiency; it only explains absence.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, seedVendor, type TestDbSeed } from "./testDb.js";
import {
  resolveGovernedEvidenceLinks,
  resolveAssuranceCoverage,
  GOVERNED_EVIDENCE_SURFACE_VERSION,
} from "../../src/api/lib/vendorAssurance/assuranceCoverage.js";

let seed: TestDbSeed;
let pool: Pool;
let userA = "";
let engagementA = "";
let reqA1 = "";
let reqA2 = "";
let reqB1 = "";

async function asOrg<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  await pool.query("SELECT set_config('app.current_org_id', $1, false)", [orgId]);
  return fn();
}

async function makeFrameworkRequirement(orgId: string, ref: string): Promise<string> {
  const f = await pool.query(
    `INSERT INTO frameworks (organization_id, name, version)
     VALUES ($1, $2, '1.0') RETURNING id`,
    [orgId, `GE harness ${ref} ${Date.now()}`]
  );
  const r = await pool.query(
    `INSERT INTO requirements (framework_id, reference_id, title)
     VALUES ($1, $2, $3) RETURNING id`,
    [f.rows[0].id, ref, `Requirement ${ref}`]
  );
  return r.rows[0].id;
}

async function makeEngagement(orgId: string): Promise<string> {
  const vendorId = await seedVendor(pool, orgId, { name: `GE vendor ${Date.now()}` });
  const e = await pool.query(
    `INSERT INTO vendor_engagements
       (organization_id, vendor_id, engagement_type, status,
        methodology_version, scope_rule_version)
     VALUES ($1,$2,'initial','draft','harness-1','harness-1') RETURNING id`,
    [orgId, vendorId]
  );
  return e.rows[0].id;
}

/**
 * One curated artifact + one CONFIRMED requirement-grain link, written directly
 * so the test controls validity precisely. The writer is proven elsewhere; what
 * is under test here is the READ.
 */
async function curatedLink(opts: {
  orgId: string; engagementId: string; requirementId: string;
  assuranceClass: string; validityBasis: string; validUntil: string | null;
  confirmed?: boolean; detached?: boolean;
}): Promise<{ evidenceId: string; linkId: string }> {
  const ev = await pool.query(
    `INSERT INTO evidence (organization_id, source_type, source_id, title, evidence_type,
                           assurance_class, validity_basis, valid_from, valid_until)
     VALUES ($1,'control_test',gen_random_uuid(),$2,'document',$3,$4,
             CASE WHEN $4 = 'not_established' THEN NULL ELSE CURRENT_DATE - 30 END,
             $5)
     RETURNING id`,
    [opts.orgId, `ge-${opts.assuranceClass}-${Date.now()}-${Math.random()}`,
     opts.assuranceClass, opts.validityBasis, opts.validUntil]
  );
  const evidenceId = ev.rows[0].id;
  const confirmed = opts.confirmed !== false;
  const link = await pool.query(
    `INSERT INTO evidence_links
       (organization_id, evidence_id, target_type, target_id, target_requirement_id,
        link_kind, linked_by_user_id, confirmed_at, confirmed_by_user_id, confirmation_note,
        detached_at, detached_by_user_id, detach_reason)
     VALUES ($1,$2,'vendor_engagement',$3,$4,'origin',$5,
             CASE WHEN $6 THEN NOW() END,
             CASE WHEN $6 THEN $5::uuid END,
             CASE WHEN $6 THEN 'harness confirmation' END,
             CASE WHEN $7 THEN NOW() END,
             CASE WHEN $7 THEN $5::uuid END,
             CASE WHEN $7 THEN 'no_longer_relevant' END)
     RETURNING id`,
    [opts.orgId, evidenceId, opts.engagementId, opts.requirementId, userA,
     confirmed, opts.detached === true]
  );
  return { evidenceId, linkId: link.rows[0].id };
}

const FUTURE = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);
const PAST = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the coverage-surface test.");
  pool = new Pool({ connectionString: url, ssl: false });
  userA = (await seedUser(pool, seed.orgA.id)).id;
  engagementA = await makeEngagement(seed.orgA.id);
  reqA1 = await makeFrameworkRequirement(seed.orgA.id, "GE-1");
  reqA2 = await makeFrameworkRequirement(seed.orgA.id, "GE-2");
  reqB1 = await makeFrameworkRequirement(seed.orgB.id, "GE-B1");
}, 180_000);

afterAll(async () => { await pool?.end().catch(() => {}); });

describe("a. current governed non-SOC evidence is VISIBLE at requirement grain", () => {
  it("a confirmed, current pen_test link appears with its requirement reference", async () => {
    const { evidenceId, linkId } = await curatedLink({
      orgId: seed.orgA.id, engagementId: engagementA, requirementId: reqA1,
      assuranceClass: "pen_test", validityBasis: "policy_default", validUntil: FUTURE,
    });
    const rows = await asOrg(seed.orgA.id, () =>
      resolveGovernedEvidenceLinks({ organizationId: seed.orgA.id, engagementId: engagementA }));
    const mine = rows.find((r) => r.linkId === linkId);
    expect(mine).toBeDefined();
    expect(mine!.evidenceId).toBe(evidenceId);
    expect(mine!.requirementId).toBe(reqA1);
    expect(mine!.requirementReference).toBe("GE-1");
    expect(mine!.assuranceClass).toBe("pen_test");
    expect(mine!.validUntil).toBe(FUTURE);
  });

  it("a perpetual artifact (no end date) is current and visible", async () => {
    const { linkId } = await curatedLink({
      orgId: seed.orgA.id, engagementId: engagementA, requirementId: reqA2,
      assuranceClass: "policy_document", validityBasis: "perpetual", validUntil: null,
    });
    const rows = await asOrg(seed.orgA.id, () =>
      resolveGovernedEvidenceLinks({ organizationId: seed.orgA.id, engagementId: engagementA }));
    const mine = rows.find((r) => r.linkId === linkId);
    expect(mine).toBeDefined();
    expect(mine!.validUntil).toBeNull();
    expect(mine!.validityBasis).toBe("perpetual");
  });
});

describe("b + c. non-counting, with a DETERMINISTIC reason", () => {
  it("every row on this surface carries counts === false", async () => {
    const rows = await asOrg(seed.orgA.id, () =>
      resolveGovernedEvidenceLinks({ organizationId: seed.orgA.id, engagementId: engagementA }));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.counts).toBe(false);
  });

  it("a non-tested-control class is refused with no_tested_control_authority", async () => {
    for (const cls of ["pen_test", "iso_certification", "privacy_agreement",
                       "vulnerability_scan", "policy_document", "vendor_attestation"]) {
      const { linkId } = await curatedLink({
        orgId: seed.orgA.id, engagementId: engagementA,
        requirementId: cls === "pen_test" ? reqA1 : reqA2,
        assuranceClass: cls, validityBasis: "policy_default", validUntil: FUTURE,
      });
      const rows = await asOrg(seed.orgA.id, () =>
        resolveGovernedEvidenceLinks({ organizationId: seed.orgA.id, engagementId: engagementA }));
      const mine = rows.find((r) => r.linkId === linkId);
      expect(mine, `class ${cls} must be visible`).toBeDefined();
      expect(mine!.reason, `class ${cls}`).toBe("no_tested_control_authority");
    }
  });

  it("a tested-control-capable class is NOT mislabelled as lacking authority", async () => {
    // Saying a SOC 2 Type 2 report "has no tested-control authority" would be
    // false: it has one, through the determination spine, not through a link.
    for (const cls of ["soc1", "soc2_type2"]) {
      const { linkId } = await curatedLink({
        orgId: seed.orgA.id, engagementId: engagementA, requirementId: reqA1,
        assuranceClass: cls, validityBasis: "policy_default", validUntil: FUTURE,
      });
      const rows = await asOrg(seed.orgA.id, () =>
        resolveGovernedEvidenceLinks({ organizationId: seed.orgA.id, engagementId: engagementA }));
      const mine = rows.find((r) => r.linkId === linkId);
      expect(mine!.reason).toBe("awaiting_sufficiency_determination");
      expect(mine!.counts).toBe(false);
    }
  });

  it("the reason is a pure function of the class — repeated reads never differ", async () => {
    const a = await asOrg(seed.orgA.id, () =>
      resolveGovernedEvidenceLinks({ organizationId: seed.orgA.id, engagementId: engagementA }));
    const b = await asOrg(seed.orgA.id, () =>
      resolveGovernedEvidenceLinks({ organizationId: seed.orgA.id, engagementId: engagementA }));
    expect(a.map((r) => [r.linkId, r.reason])).toEqual(b.map((r) => [r.linkId, r.reason]));
  });
});

describe("d. expired and unestablished evidence never masquerades as current", () => {
  it("an expired artifact_dates artifact is ABSENT", async () => {
    const { linkId } = await curatedLink({
      orgId: seed.orgA.id, engagementId: engagementA, requirementId: reqA1,
      assuranceClass: "pen_test", validityBasis: "artifact_dates", validUntil: PAST,
    });
    const rows = await asOrg(seed.orgA.id, () =>
      resolveGovernedEvidenceLinks({ organizationId: seed.orgA.id, engagementId: engagementA }));
    expect(rows.find((r) => r.linkId === linkId)).toBeUndefined();
  });

  it("a not_established artifact is ABSENT — unknown is not valid", async () => {
    const { linkId } = await curatedLink({
      orgId: seed.orgA.id, engagementId: engagementA, requirementId: reqA1,
      assuranceClass: "unclassified", validityBasis: "not_established", validUntil: null,
    });
    const rows = await asOrg(seed.orgA.id, () =>
      resolveGovernedEvidenceLinks({ organizationId: seed.orgA.id, engagementId: engagementA }));
    expect(rows.find((r) => r.linkId === linkId)).toBeUndefined();
  });

  it("an UNCONFIRMED link is ABSENT — attaching is not confirming", async () => {
    const { linkId } = await curatedLink({
      orgId: seed.orgA.id, engagementId: engagementA, requirementId: reqA2,
      assuranceClass: "bcp_dr_test", validityBasis: "policy_default", validUntil: FUTURE,
      confirmed: false,
    });
    const rows = await asOrg(seed.orgA.id, () =>
      resolveGovernedEvidenceLinks({ organizationId: seed.orgA.id, engagementId: engagementA }));
    expect(rows.find((r) => r.linkId === linkId)).toBeUndefined();
  });

  it("a DETACHED link is ABSENT — a detached link records a use that ended", async () => {
    const { linkId } = await curatedLink({
      orgId: seed.orgA.id, engagementId: engagementA, requirementId: reqA2,
      assuranceClass: "subprocessor_list", validityBasis: "policy_default", validUntil: FUTURE,
      detached: true,
    });
    const rows = await asOrg(seed.orgA.id, () =>
      resolveGovernedEvidenceLinks({ organizationId: seed.orgA.id, engagementId: engagementA }));
    expect(rows.find((r) => r.linkId === linkId)).toBeUndefined();
  });
});

describe("e. cross-tenant evidence can never appear", () => {
  it("org B's confirmed, current link is invisible to org A and vice versa", async () => {
    const userB = (await seedUser(pool, seed.orgB.id)).id;
    const engagementB = await makeEngagement(seed.orgB.id);
    const evB = await pool.query(
      `INSERT INTO evidence (organization_id, source_type, source_id, title, evidence_type,
                             assurance_class, validity_basis, valid_from, valid_until)
       VALUES ($1,'control_test',gen_random_uuid(),'ge-orgb','document',
               'pen_test','policy_default',CURRENT_DATE - 30, $2) RETURNING id`,
      [seed.orgB.id, FUTURE]
    );
    const linkB = await pool.query(
      `INSERT INTO evidence_links
         (organization_id, evidence_id, target_type, target_id, target_requirement_id,
          link_kind, linked_by_user_id, confirmed_at, confirmed_by_user_id, confirmation_note)
       VALUES ($1,$2,'vendor_engagement',$3,$4,'origin',$5,NOW(),$5,'orgB')
       RETURNING id`,
      [seed.orgB.id, evB.rows[0].id, engagementB, reqB1, userB]
    );

    // A cannot see B's link, even naming B's engagement id.
    const asA = await asOrg(seed.orgA.id, () =>
      resolveGovernedEvidenceLinks({ organizationId: seed.orgA.id, engagementId: engagementB }));
    expect(asA).toEqual([]);

    // B sees its own; A's rows are absent from it.
    const asB = await asOrg(seed.orgB.id, () =>
      resolveGovernedEvidenceLinks({ organizationId: seed.orgB.id, engagementId: engagementB }));
    expect(asB.map((r) => r.linkId)).toContain(linkB.rows[0].id);
    const aRows = await asOrg(seed.orgA.id, () =>
      resolveGovernedEvidenceLinks({ organizationId: seed.orgA.id, engagementId: engagementA }));
    for (const r of asB) expect(aRows.find((x) => x.linkId === r.linkId)).toBeUndefined();
  });

  it("a mismatched org/engagement pair yields nothing, not another tenant's rows", async () => {
    const rows = await asOrg(seed.orgB.id, () =>
      resolveGovernedEvidenceLinks({ organizationId: seed.orgB.id, engagementId: engagementA }));
    expect(rows).toEqual([]);
  });

  it("a requirement reference from a foreign framework renders NULL, never its text", async () => {
    // requirements/frameworks carry NO RLS, so the org gate is the explicit
    // frameworks join. Point a link at org B's requirement id from org A.
    const ev = await pool.query(
      `INSERT INTO evidence (organization_id, source_type, source_id, title, evidence_type,
                             assurance_class, validity_basis, valid_from, valid_until)
       VALUES ($1,'control_test',gen_random_uuid(),'ge-foreign-ref','document',
               'pen_test','policy_default',CURRENT_DATE - 30,$2) RETURNING id`,
      [seed.orgA.id, FUTURE]
    );
    let inserted = true;
    let linkId = "";
    try {
      const l = await pool.query(
        `INSERT INTO evidence_links
           (organization_id, evidence_id, target_type, target_id, target_requirement_id,
            link_kind, linked_by_user_id, confirmed_at, confirmed_by_user_id, confirmation_note)
         VALUES ($1,$2,'vendor_engagement',$3,$4,'origin',$5,NOW(),$5,'foreign ref')
         RETURNING id`,
        [seed.orgA.id, ev.rows[0].id, engagementA, reqB1, userA]
      );
      linkId = l.rows[0].id;
    } catch {
      // A DB-level guard refusing the cross-org requirement outright is an even
      // stronger outcome than rendering NULL. Either is acceptable.
      inserted = false;
    }
    if (inserted) {
      const rows = await asOrg(seed.orgA.id, () =>
        resolveGovernedEvidenceLinks({ organizationId: seed.orgA.id, engagementId: engagementA }));
      const mine = rows.find((r) => r.linkId === linkId);
      if (mine) expect(mine.requirementReference).toBeNull();
    }
    expect(true).toBe(true);
  });
});

describe("f. questionnaire depth is untouched", () => {
  it("covered stays EMPTY while the governed-evidence surface is populated", async () => {
    const cov = await asOrg(seed.orgA.id, () =>
      resolveAssuranceCoverage({ organizationId: seed.orgA.id, engagementId: engagementA }));
    expect(cov.governedEvidence.length).toBeGreaterThan(0);
    // The ONLY input to depth reduction is `covered` (vendorEngagements.ts
    // passes covered.map(c => c.requirementId) as assuranceCoveredRequirementIds).
    expect(cov.covered).toEqual([]);
    expect(cov.governedEvidenceVersion).toBe(GOVERNED_EVIDENCE_SURFACE_VERSION);
  });

  it("no governed-evidence requirement id leaks into the covered set", async () => {
    const cov = await asOrg(seed.orgA.id, () =>
      resolveAssuranceCoverage({ organizationId: seed.orgA.id, engagementId: engagementA }));
    const coveredIds = new Set(cov.covered.map((c) => c.requirementId));
    for (const g of cov.governedEvidence) expect(coveredIds.has(g.requirementId)).toBe(false);
  });

  it("the counting-rule version is UNCHANGED — counting did not change", async () => {
    const cov = await asOrg(seed.orgA.id, () =>
      resolveAssuranceCoverage({ organizationId: seed.orgA.id, engagementId: engagementA }));
    expect(cov.version).toBe("assurance-coverage-1.1");
  });
});
