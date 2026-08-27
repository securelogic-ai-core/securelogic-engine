/**
 * vendorCuecFindingLinkageRls.test.ts — the vendor <- finding relationship,
 * over all four linkages, against real Postgres with RLS live.
 *
 * WHAT THIS FILE IS FOR
 * ---------------------
 * A Vendor Assurance CUEC gap promoted to a Finding was correct and fully
 * tracked in Findings, and simultaneously invisible to the vendor: absent from
 * GET /api/vendors/:id/findings, and excluded from the vendor risk score
 * THREE separate times — the resolver could not resolve it, the scoring query
 * independently dropped it, and the promotion scheduled no recompute at all.
 * Fixing any one of those leaves the customer-visible symptom exactly as it was,
 * which is why this file asserts all three and the end-to-end result.
 *
 * THE SQL IS IMPORTED, NOT PARAPHRASED. The linkage fragments come from
 * `src/api/lib/vendorFindingLinkage.ts` itself, so the predicate set under test
 * cannot drift from the shipped one. That is a deliberate strengthening of the
 * pattern in findingVendorProvenanceRls.test.ts, which copies the query by hand.
 *
 * THE LOAD-BEARING ASSERTIONS ARE THE CROSS-WIRED ONES. It is not enough that
 * org B cannot read org A's findings. The CUEC arm is anchored on
 * `promoted_finding_id` and the assessment arm on an UNCONSTRAINED `source_id`,
 * so the questions that matter are: if org B's CUEC claims to have promoted org
 * A's finding, does org A see org B's vendor? And if org B's assessment id
 * collides with the source_id of org A's finding, does either org see the other?
 * Both must be no, and the thing preventing it is the org predicate on the
 * JOINED table — not the finding's own scoping.
 *
 * THE FOURTH ARM RIDES THE SAME HARNESS. Engagement finding promotion writes
 * `source_type='vendor_engagement'`, `source_id=<vendor_engagements.id>` — the
 * defect class this file exists for, recurring one producer later: before the
 * fourth arm, an engagement-promoted finding was invisible on every surface
 * asserted below. Because the SQL is imported, seeding the engagement chain
 * puts the new arm under every existing assertion automatically; the per-arm
 * expectations and the colliding-engagement-id probe are the additions.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool, type PoolClient } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import {
  VENDOR_FINDING_LINKAGE_SQL,
  VENDOR_FINDING_EDGES_SQL,
  vendorFindingLinkagePriority,
} from "../../src/api/lib/vendorFindingLinkage.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

type OrgChain = {
  vendorId: string;
  cuecFindingId: string;
  cuecId: string;
  documentId: string;
  assessmentFindingId: string;
  assessmentId: string;
  cycleFindingId: string;
  reviewId: string;
  engagementFindingId: string;
  engagementId: string;
};

let A: OrgChain;
let B: OrgChain;

/** The resolver's query, as vendorRiskScoreRecompute.resolveVendorIdForFinding runs it. */
const RESOLVE_SQL = `
  SELECT l.vendor_id
    FROM (${VENDOR_FINDING_LINKAGE_SQL}) l
   WHERE l.finding_id      = $1
     AND l.organization_id = $2
   ORDER BY ${vendorFindingLinkagePriority("l.linkage")}
   LIMIT 1`;

/** The scoring query's finding population, as recomputeAndPersistVendorRiskScore runs it. */
const SCORE_POPULATION_SQL = `
  SELECT f.id, f.severity, f.status
    FROM findings f
    JOIN (${VENDOR_FINDING_EDGES_SQL}) l
      ON l.finding_id      = f.id
     AND l.organization_id = f.organization_id
   WHERE l.vendor_id       = $1
     AND f.organization_id = $2
     AND f.operational_status <> 'closed'`;

/**
 * The CUEC arm with the org predicate on the CUEC deliberately REMOVED, run as
 * the owner so RLS is not what answers. This is the mutation check made
 * executable: it shows what `c.organization_id = f.organization_id` is actually
 * preventing, so the assertions above it cannot pass vacuously.
 */
const CUEC_ARM_WITHOUT_ORG_PREDICATE = `
  SELECT v.id AS vendor_id, v.organization_id
    FROM findings f
    JOIN vendor_assurance_cuecs c
      ON c.promoted_finding_id = f.id
    JOIN vendor_assurance_documents d
      ON d.id = c.document_id
    JOIN vendors v
      ON v.id = d.vendor_id
   WHERE f.id = $1`;

/** Owner-channel seeding — the import path, not the request path. */
async function seedChain(orgId: string, label: string): Promise<OrgChain> {
  const vendorId = await seedVendor(pool, orgId, {
    name: `${label} vendor`,
    criticality: "high",
  });

  // --- arm 3: the Vendor Assurance document spine ---------------------------
  const doc = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assurance_documents
       (organization_id, vendor_id, original_filename, byte_size, sha256, storage_key, mime_type)
     VALUES ($1, $2, $3, 2048, $4, $5, 'application/pdf')
     RETURNING id`,
    [orgId, vendorId, `${label}-soc2.pdf`, label.padEnd(64, "0").slice(0, 64), `k/${label}`],
  );
  const documentId = doc.rows[0]!.id;

  // Written exactly as promoteVendorAssuranceCuecToFinding writes it: the
  // source_id is the VENDOR id under source_type='vendor_review'. That is the
  // writer semantic this fix deliberately does NOT change.
  const cuecFinding = await pool.query<{ id: string }>(
    `INSERT INTO findings
       (organization_id, source_type, source_id, title, severity, description,
        status, operational_status)
     VALUES ($1, 'vendor_review', $2, $3, 'Critical', 'promoted CUEC gap', 'open', 'open')
     RETURNING id`,
    [orgId, vendorId, `${label} CUEC not met`],
  );
  const cuecFindingId = cuecFinding.rows[0]!.id;

  const cuec = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assurance_cuecs
       (organization_id, document_id, ordinal, cuec_text, review_status,
        review_status_reason, review_status_updated_at, promoted_finding_id)
     VALUES ($1, $2, 1, $3, 'gap', 'not implemented', NOW(), $4)
     RETURNING id`,
    [orgId, documentId, `${label} obligation text`, cuecFindingId],
  );

  // --- arm 1: point-in-time assessment --------------------------------------
  const assessment = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assessments
       (organization_id, vendor_id, assessment_type, overall_severity, performed_at)
     VALUES ($1, $2, 'annual_review', 'High', DATE '2026-03-01')
     RETURNING id`,
    [orgId, vendorId],
  );
  const assessmentId = assessment.rows[0]!.id;
  const assessmentFinding = await pool.query<{ id: string }>(
    `INSERT INTO findings
       (organization_id, source_type, source_id, title, severity, description,
        status, operational_status)
     VALUES ($1, 'vendor_review', $2, $3, 'High', 'assessment finding', 'open', 'open')
     RETURNING id`,
    [orgId, assessmentId, `${label} assessment finding`],
  );

  // --- arm 2: review cycle ---------------------------------------------------
  const review = await pool.query<{ id: string }>(
    `INSERT INTO vendor_reviews
       (organization_id, vendor_id, status, overall_severity, performed_at)
     VALUES ($1, $2, 'concerns_identified', 'Moderate', DATE '2026-04-01')
     RETURNING id`,
    [orgId, vendorId],
  );
  const reviewId = review.rows[0]!.id;
  const cycleFinding = await pool.query<{ id: string }>(
    `INSERT INTO findings
       (organization_id, source_type, source_id, title, severity, description,
        status, operational_status)
     VALUES ($1, 'vendor_cycle_review', $2, $3, 'Moderate', 'cycle finding', 'open', 'open')
     RETURNING id`,
    [orgId, reviewId, `${label} cycle finding`],
  );

  // --- arm 4: engagement spine ----------------------------------------------
  // submitted_at deliberately carries a TIME OF DAY: the linkage arm reads
  // COALESCE(submitted_at, created_at)::date, and the DATE-serialisation test
  // below needs a value that would betray a dropped ::date cast.
  const engagement = await pool.query<{ id: string }>(
    `INSERT INTO vendor_engagements
       (organization_id, vendor_id, engagement_type, status, inherent_rating,
        submitted_at, methodology_version, scope_rule_version)
     VALUES ($1, $2, 'initial', 'in_review', 'High',
             TIMESTAMPTZ '2026-05-01 09:30:00+00', 'test-m1', 'test-s1')
     RETURNING id`,
    [orgId, vendorId],
  );
  const engagementId = engagement.rows[0]!.id;
  // Written exactly as promoteEngagementFindings writes it: the source_id is
  // the ENGAGEMENT id under the dedicated source_type='vendor_engagement'.
  const engagementFinding = await pool.query<{ id: string }>(
    `INSERT INTO findings
       (organization_id, source_type, source_id, title, severity, description,
        status, operational_status)
     VALUES ($1, 'vendor_engagement', $2, $3, 'High', 'engagement finding', 'open', 'open')
     RETURNING id`,
    [orgId, engagementId, `${label} engagement finding`],
  );

  return {
    vendorId,
    cuecFindingId,
    cuecId: cuec.rows[0]!.id,
    documentId,
    assessmentFindingId: assessmentFinding.rows[0]!.id,
    assessmentId,
    cycleFindingId: cycleFinding.rows[0]!.id,
    reviewId,
    engagementFindingId: engagementFinding.rows[0]!.id,
    engagementId,
  };
}

async function asOrg<T>(orgId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE app_request");
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }
}

const asOrgA = {
  get: (path: string) => request(app).get(path).set("X-Api-Key", seed.orgA.apiKey),
};
const asOrgB = {
  get: (path: string) => request(app).get(path).set("X-Api-Key", seed.orgB.apiKey),
};

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the vendor linkage test.");
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

describe("resolution — a finding reaches its vendor by all four linkages", () => {
  it("resolves the vendor for a CUEC-PROMOTED finding (the defect)", async () => {
    const rows = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(RESOLVE_SQL, [A.cuecFindingId, seed.orgA.id])).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].vendor_id).toBe(A.vendorId);
  });

  it("still resolves the vendor for an ASSESSMENT-sourced finding (no regression)", async () => {
    const rows = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(RESOLVE_SQL, [A.assessmentFindingId, seed.orgA.id])).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].vendor_id).toBe(A.vendorId);
  });

  it("still resolves the vendor for a CYCLE-REVIEW finding (third arm intact)", async () => {
    const rows = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(RESOLVE_SQL, [A.cycleFindingId, seed.orgA.id])).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].vendor_id).toBe(A.vendorId);
  });

  it("resolves the vendor for an ENGAGEMENT-PROMOTED finding (the VA-4 defect)", async () => {
    const rows = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(RESOLVE_SQL, [A.engagementFindingId, seed.orgA.id])).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].vendor_id).toBe(A.vendorId);
  });

  it("resolves nothing for a finding that is not vendor-linked at all", async () => {
    const other = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, source_type, title, severity, description,
                             status, operational_status)
       VALUES ($1, 'manual', 'unlinked', 'Low', 'no vendor', 'open', 'open') RETURNING id`,
      [seed.orgA.id],
    );
    const rows = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(RESOLVE_SQL, [other.rows[0]!.id, seed.orgA.id])).rows,
    );
    expect(rows).toHaveLength(0);
  });
});

describe("scoring — the CUEC-promoted finding is IN the score population", () => {
  it("includes the CUEC and engagement findings alongside the assessment and cycle findings", async () => {
    const rows = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(SCORE_POPULATION_SQL, [A.vendorId, seed.orgA.id])).rows,
    );
    const ids = rows.map((r) => r.id);
    // The whole point: a resolver-only fix passes every test above and fails HERE.
    expect(ids).toContain(A.cuecFindingId);
    expect(ids).toContain(A.assessmentFindingId);
    expect(ids).toContain(A.cycleFindingId);
    expect(ids).toContain(A.engagementFindingId);
  });

  it("counts each finding exactly once", async () => {
    const rows = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(SCORE_POPULATION_SQL, [A.vendorId, seed.orgA.id])).rows,
    );
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("never draws another org's findings into the population", async () => {
    const rows = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(SCORE_POPULATION_SQL, [A.vendorId, seed.orgA.id])).rows,
    );
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(B.cuecFindingId);
    expect(ids).not.toContain(B.assessmentFindingId);
    expect(ids).not.toContain(B.engagementFindingId);
  });
});

describe("API — the vendor page shows the promoted gap", () => {
  it("GET /api/vendors/:id/findings returns the CUEC-promoted finding", async () => {
    const res = await asOrgA.get(`/api/vendors/${A.vendorId}/findings`);
    expect(res.status).toBe(200);
    const returned = res.body.findings as Array<Record<string, unknown>>;
    const cuecRow = returned.find((f) => f.id === A.cuecFindingId);
    expect(cuecRow).toBeDefined();
    // Honest discriminator, and the CUEC id in the compatibility field — not an
    // assessment that never existed.
    expect(cuecRow!.linkage).toBe("vendor_assurance_cuec");
    expect(cuecRow!.assessment_id).toBe(A.cuecId);
    expect(cuecRow!.assessment_type).toBe("vendor_assurance_cuec");
    // Same contract for the engagement arm: honest discriminator, and the
    // engagement id in the compatibility field.
    const engagementRow = returned.find((f) => f.id === A.engagementFindingId);
    expect(engagementRow).toBeDefined();
    expect(engagementRow!.linkage).toBe("vendor_engagement");
    expect(engagementRow!.assessment_id).toBe(A.engagementId);
    expect(engagementRow!.assessment_type).toBe("vendor_engagement");
    // All four linkages on one vendor, each once.
    expect(returned.map((f) => f.id)).toEqual(
      expect.arrayContaining([
        A.cuecFindingId,
        A.assessmentFindingId,
        A.cycleFindingId,
        A.engagementFindingId,
      ]),
    );
    expect(new Set(returned.map((f) => f.id)).size).toBe(returned.length);
  });

  it("keeps performed_at a DATE across all four arms (no silent serialisation change)", async () => {
    // `performed_at` has always been backed by a DATE column, and node-postgres
    // renders a DATE as a JS Date — so the value on the wire is a midnight ISO
    // string, NOT `YYYY-MM-DD`. That is the pre-existing serialisation and is
    // not what this asserts.
    //
    // What it asserts is that the UNION did not widen any arm to TIMESTAMPTZ.
    // The CUEC arm reads `review_status_updated_at`, which IS a timestamptz, and
    // a UNION of DATE with TIMESTAMPTZ resolves to TIMESTAMPTZ — silently
    // changing how every EXISTING assessment row serialises on an endpoint that
    // has always returned a date. The `::date` cast in vendorFindingLinkage.ts
    // is the thing that prevents it, and this is the test that would notice its
    // removal.
    //
    // The expected value is round-tripped through the same pool and the same
    // type parser rather than hardcoded, so the assertion does not depend on the
    // timezone the test process happens to run in.
    const control = await pool.query<{ d: unknown }>(`SELECT DATE '2026-03-01' AS d`);
    const controlWire = JSON.parse(JSON.stringify({ d: control.rows[0]!.d })).d as string;
    const timeOfDay = controlWire.slice(10);

    const res = await asOrgA.get(`/api/vendors/${A.vendorId}/findings`);
    const byId = new Map(
      (res.body.findings as Array<Record<string, string>>).map((f) => [f.id, f]),
    );

    // Byte-for-byte what a DATE column has always produced on this endpoint.
    expect(byId.get(A.assessmentFindingId)!.performed_at).toBe(controlWire);
    // And no other arm carries a time of day. The engagement row was seeded
    // with submitted_at = 09:30:00 precisely so a dropped ::date cast on the
    // fourth arm — whose COALESCE(submitted_at, created_at) is TIMESTAMPTZ —
    // would fail here rather than pass on a lucky midnight.
    expect(byId.get(A.cycleFindingId)!.performed_at.slice(10)).toBe(timeOfDay);
    expect(byId.get(A.cuecFindingId)!.performed_at.slice(10)).toBe(timeOfDay);
    expect(byId.get(A.engagementFindingId)!.performed_at.slice(10)).toBe(timeOfDay);
  });

  it("GET /api/vendors/:id/risk-score counts the CUEC-promoted finding", async () => {
    const res = await asOrgA.get(`/api/vendors/${A.vendorId}/risk-score`);
    expect(res.status).toBe(200);
    // Four ACTIVE findings on this vendor, one per linkage. Before the CUEC fix
    // this was 1 — the assessment arm only — and before the engagement arm it
    // was 3; the score did not move when the gap was recorded either time.
    expect(res.body.finding_count).toBe(4);
    expect(res.body.score).toBeLessThan(100);
  });

  it("org B asking for org A's vendor gets none of org A's findings", async () => {
    const res = await asOrgB.get(`/api/vendors/${A.vendorId}/findings`);
    expect(res.status).toBe(200);
    expect(res.body.findings).toHaveLength(0);
  });
});

describe("the OTHER vendor readers count the promoted gap too", () => {
  // A shared definition only helps if every reader selects from it. These two
  // surfaces kept their own local joins and are where the hole would have
  // reopened: the list badge is what a customer looks at immediately after
  // promoting a gap, and the summary backs the vendor risk board.
  it("GET /api/vendors counts all four linkages on the vendor card", async () => {
    const res = await asOrgA.get("/api/vendors?limit=100");
    expect(res.status).toBe(200);
    const vendor = (res.body.vendors as Array<Record<string, unknown>>).find(
      (v) => v.id === A.vendorId,
    );
    expect(vendor).toBeDefined();
    // Four ACTIVE findings, one per linkage. This badge counted only the
    // assessment arm, so it printed 1 — and printed nothing at all for a vendor
    // whose only findings were a promoted CUEC or an engagement promotion.
    expect(vendor!.active_findings_count).toBe(4);
    expect(vendor!.open_findings_count).toBe(4);
  });

  it("GET /api/vendors/summary answers at all, and counts the promoted gap", async () => {
    const res = await asOrgA.get("/api/vendors/summary");
    // 200 IS THE ASSERTION. This endpoint referenced f.operational_status on a
    // derived table that never selected it, so Postgres rejected the statement
    // and every call returned 500 — for every organisation, since the Active
    // Findings convergence (#645) rewrote the predicate.
    expect(res.status).toBe(200);
    const top = res.body.summary.top_vendors_by_risk as Array<Record<string, unknown>>;
    const vendor = top.find((v) => v.id === A.vendorId);
    expect(vendor).toBeDefined();
    expect(Number(vendor!.open_findings)).toBe(4);
    expect(res.body.summary.vendors_with_findings).toBeGreaterThanOrEqual(1);
  });

  it("neither reader draws org B's findings onto org A's vendor", async () => {
    const list = await asOrgA.get("/api/vendors?limit=100");
    const vendorA = (list.body.vendors as Array<Record<string, unknown>>).find(
      (v) => v.id === A.vendorId,
    );
    // Both orgs seed an identical four-arm chain. Eight would mean a join lost
    // its org predicate; four is each org seeing only its own.
    expect(vendorA!.active_findings_count).toBe(4);

    const summary = await asOrgB.get("/api/vendors/summary");
    const ids = (summary.body.summary.top_vendors_by_risk as Array<Record<string, unknown>>)
      .map((v) => v.id);
    expect(ids).not.toContain(A.vendorId);
  });
});

describe("tenancy — cross-wired ids cannot cross the boundary", () => {
  it("THE ONE THAT MATTERS: org B's CUEC pointed at org A's finding does not surface for org A", async () => {
    await pool.query(
      `UPDATE vendor_assurance_cuecs SET promoted_finding_id = $1 WHERE id = $2`,
      [A.cuecFindingId, B.cuecId],
    );
    try {
      const resolved = await asOrg(seed.orgA.id, async (c) =>
        (await c.query(RESOLVE_SQL, [A.cuecFindingId, seed.orgA.id])).rows,
      );
      expect(resolved).toHaveLength(1);
      // A's own vendor, never B's.
      expect(resolved[0].vendor_id).toBe(A.vendorId);

      // And org A's vendor findings list is unchanged in size and content.
      const res = await asOrgA.get(`/api/vendors/${A.vendorId}/findings`);
      const linkages = (res.body.findings as Array<Record<string, string>>)
        .filter((f) => f.id === A.cuecFindingId)
        .map((f) => f.assessment_id);
      expect(linkages).toEqual([A.cuecId]);
    } finally {
      await pool.query(
        `UPDATE vendor_assurance_cuecs SET promoted_finding_id = $1 WHERE id = $2`,
        [B.cuecFindingId, B.cuecId],
      );
    }
  });

  it("org B's CUEC pointed at org A's finding does not surface for org B either", async () => {
    await pool.query(
      `UPDATE vendor_assurance_cuecs SET promoted_finding_id = $1 WHERE id = $2`,
      [A.cuecFindingId, B.cuecId],
    );
    try {
      const rows = await asOrg(seed.orgB.id, async (c) =>
        (await c.query(RESOLVE_SQL, [A.cuecFindingId, seed.orgB.id])).rows,
      );
      // A's finding is not org B's to resolve, whichever org's id it names.
      expect(rows).toHaveLength(0);
    } finally {
      await pool.query(
        `UPDATE vendor_assurance_cuecs SET promoted_finding_id = $1 WHERE id = $2`,
        [B.cuecFindingId, B.cuecId],
      );
    }
  });

  it("closes the §F gap: a COLLIDING assessment id in org B does not attach org A's finding to org B's vendor", async () => {
    // The assessment arm joins on an UNCONSTRAINED source_id. Force the exact
    // collision the random-UUID space makes unlikely but nothing forbids: give
    // org B an assessment whose id IS the id of org A's assessment.
    const collidingFinding = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, source_type, source_id, title, severity,
                             description, status, operational_status)
       VALUES ($1, 'vendor_review', $2, 'collision probe', 'High', 'probe', 'open', 'open')
       RETURNING id`,
      [seed.orgB.id, A.assessmentId],
    );
    const probeId = collidingFinding.rows[0]!.id;
    try {
      // Org B's finding names org A's assessment id. It must resolve to NOTHING —
      // not to org A's vendor — because the join is org-scoped on both sides.
      const rows = await asOrg(seed.orgB.id, async (c) =>
        (await c.query(RESOLVE_SQL, [probeId, seed.orgB.id])).rows,
      );
      expect(rows).toHaveLength(0);

      // And org A's vendor must not acquire org B's finding.
      const res = await asOrgA.get(`/api/vendors/${A.vendorId}/findings`);
      expect((res.body.findings as Array<{ id: string }>).map((f) => f.id)).not.toContain(probeId);
    } finally {
      await pool.query(`DELETE FROM findings WHERE id = $1`, [probeId]);
    }
  });

  it("a COLLIDING engagement id in org B does not attach org A's finding to org B's vendor", async () => {
    // The engagement arm joins on the same UNCONSTRAINED source_id convention
    // as the assessment arm, so it earns the same probe: give org B a finding
    // whose source_id IS the id of org A's engagement.
    const collidingFinding = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, source_type, source_id, title, severity,
                             description, status, operational_status)
       VALUES ($1, 'vendor_engagement', $2, 'engagement collision probe', 'High', 'probe',
               'open', 'open')
       RETURNING id`,
      [seed.orgB.id, A.engagementId],
    );
    const probeId = collidingFinding.rows[0]!.id;
    try {
      // Org B's finding names org A's engagement id. It must resolve to NOTHING —
      // not to org A's vendor — because `e.organization_id = f.organization_id`
      // sits on the joined table, not only on the finding.
      const rows = await asOrg(seed.orgB.id, async (c) =>
        (await c.query(RESOLVE_SQL, [probeId, seed.orgB.id])).rows,
      );
      expect(rows).toHaveLength(0);

      // And org A's vendor must not acquire org B's finding.
      const res = await asOrgA.get(`/api/vendors/${A.vendorId}/findings`);
      expect((res.body.findings as Array<{ id: string }>).map((f) => f.id)).not.toContain(probeId);
    } finally {
      await pool.query(`DELETE FROM findings WHERE id = $1`, [probeId]);
    }
  });

  it("org B's engagement finding never resolves through org A's scope, and vice versa", async () => {
    // The plain cross-tenant read on the fourth arm: each org's engagement
    // finding is invisible to the other, in both directions.
    const forA = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(RESOLVE_SQL, [B.engagementFindingId, seed.orgA.id])).rows,
    );
    expect(forA).toHaveLength(0);

    const forB = await asOrg(seed.orgB.id, async (c) =>
      (await c.query(RESOLVE_SQL, [A.engagementFindingId, seed.orgB.id])).rows,
    );
    expect(forB).toHaveLength(0);
  });

  it("MUTATION CHECK: the org predicate is what prevents it, not RLS alone", async () => {
    // Same cross-wiring, but run against the CUEC arm with the org predicate
    // stripped, as the OWNER so RLS is not the thing answering. This is the
    // control: it must find the cross-tenant row that the shipped query refuses.
    await pool.query(
      `UPDATE vendor_assurance_cuecs SET promoted_finding_id = $1 WHERE id = $2`,
      [A.cuecFindingId, B.cuecId],
    );
    try {
      const leaked = await pool.query(CUEC_ARM_WITHOUT_ORG_PREDICATE, [A.cuecFindingId]);
      const orgs = new Set(leaked.rows.map((r) => r.organization_id));
      // Without the predicate the join reaches BOTH orgs' vendors from one
      // finding — which is exactly the disclosure the shipped predicate stops.
      expect(orgs.has(seed.orgB.id)).toBe(true);
      expect(orgs.size).toBeGreaterThan(1);
    } finally {
      await pool.query(
        `UPDATE vendor_assurance_cuecs SET promoted_finding_id = $1 WHERE id = $2`,
        [B.cuecFindingId, B.cuecId],
      );
    }
  });
});

/* ===========================================================================
   The two count populations are DIFFERENT PREDICATES, and the CUEC arm obeys
   both.

   Added during the 2026-08-27 integration reconciliation. The cases above seed
   all three findings `status='open'` AND `operational_status='open'`, so
   active_findings_count and open_findings_count are both 3 and the file cannot
   tell them apart: a regression that answered one predicate with the other
   would pass every assertion above it.

   That matters more here than it usually would. `active_findings_count`
   (operational_status <> 'closed') is the canonical enterprise metric and
   `open_findings_count` (status = 'open') is what these surfaces display today,
   and this package rewrites the join underneath BOTH of them on a live
   production spine.

   The two axes are NOT free of each other — `findings_closure_axes_agree`
   (migration 20260906) makes CLOSURE identical on both by CHECK:

       (operational_status = 'closed') = (status IN ('closed','accepted'))

   so the honest divergence to test is the NON-closed one the constraint
   deliberately leaves open: a finding moved to `in_progress` is still ACTIVE
   (it has not been closed) but is no longer strictly OPEN. That is precisely
   the distinction the two counts exist to express, and it is the case where a
   join rewrite could quietly answer one question with the other.

   Mutations are applied here and left in place: this is the last block in the
   file, and every count it asserts is computed fresh from the database.
   =========================================================================== */

describe("the two vendor-card counts answer different questions", () => {
  const cardCounts = async (): Promise<{ active: number; open: number }> => {
    const res = await asOrgA.get("/api/vendors?limit=100");
    expect(res.status).toBe(200);
    const vendor = (res.body.vendors as Array<Record<string, unknown>>).find(
      (v) => v.id === A.vendorId,
    );
    expect(vendor).toBeDefined();
    return {
      active: Number(vendor!.active_findings_count),
      open: Number(vendor!.open_findings_count),
    };
  };

  it("starts from the three-arm baseline, both populations agreeing", async () => {
    expect(await cardCounts()).toEqual({ active: 3, open: 3 });
  });

  it("CLOSING the CUEC finding drops BOTH counts — closure is one fact, per the CHECK", async () => {
    // The CUEC arm deliberately, because it is the arm this package adds: if it
    // were wired in a way that ignored the finding's own lifecycle columns, a
    // promoted gap would count forever and a vendor could never be cleared.
    await pool.query(
      `UPDATE findings SET status = 'closed', operational_status = 'closed' WHERE id = $1`,
      [A.cuecFindingId],
    );
    expect(await cardCounts()).toEqual({ active: 2, open: 2 });
  });

  it("a closed CUEC gap leaves the vendor's risk-score population", async () => {
    const population = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(SCORE_POPULATION_SQL, [A.vendorId, seed.orgA.id])).rows,
    );
    expect(population.map((r) => r.id)).not.toContain(A.cuecFindingId);
    expect(population).toHaveLength(2);
  });

  it("but it is STILL LISTED on the vendor page — closed is a state, not a deletion", async () => {
    // The list is the audit surface. A gap that stops being counted must not
    // also stop being visible, or a reader cannot tell "remediated" from
    // "never happened".
    const res = await asOrgA.get(`/api/vendors/${A.vendorId}/findings`);
    expect(res.status).toBe(200);
    const ids = (res.body.findings as Array<{ id: string }>).map((f) => f.id);
    expect(ids).toContain(A.cuecFindingId);
  });

  it("moving the assessment finding to IN_PROGRESS drops OPEN but not ACTIVE", async () => {
    // The divergence the CHECK permits, and the reason there are two counts.
    // Work started is not work finished: it must leave the strictly-open display
    // population without leaving the canonical enterprise metric.
    await pool.query(
      `UPDATE findings SET status = 'in_progress', operational_status = 'in_progress'
        WHERE id = $1`,
      [A.assessmentFindingId],
    );
    expect(await cardCounts()).toEqual({ active: 2, open: 1 });
  });

  it("the summary shares the LINKAGE but not the word: its `open_findings` is Active", async () => {
    // NAMING COLLISION, PRE-EXISTING AND NOW VISIBLE — pinned here deliberately.
    //
    //   GET /api/vendors        open_findings_count   = status = 'open'          -> 1
    //   GET /api/vendors        active_findings_count = operational_status<>closed -> 2
    //   GET /api/vendors/summary open_findings        = operational_status<>closed -> 2
    //
    // The summary's field is named `open_findings` but computes ACTIVE. That
    // came from the #645 Active-Findings convergence rewriting the predicate
    // without renaming the field — the same rewrite that left it selecting a
    // column the derived table did not expose, which is why this endpoint has
    // answered 500 ever since and nobody has seen the number.
    //
    // This package makes the endpoint answer. It does NOT rename the field:
    // that is a wire change on a live surface and belongs to its own decision.
    // What it must not do is let the collision go unrecorded, so the expectation
    // below states the real semantics. If the field is ever renamed or its
    // predicate changed, this fails and the change is deliberate.
    const res = await asOrgA.get("/api/vendors/summary");
    expect(res.status).toBe(200);
    const vendor = (res.body.summary.top_vendors_by_risk as Array<Record<string, unknown>>)
      .find((v) => v.id === A.vendorId);
    expect(vendor).toBeDefined();
    expect(Number(vendor!.open_findings)).toBe(2);

    // The card, same org, same vendor, same instant: 1. Two live surfaces, one
    // word, two populations.
    expect((await cardCounts()).open).toBe(1);
  });

  it("neither mutation reached org B — its identical chain still counts 3 and 3", async () => {
    const res = await asOrgB.get("/api/vendors?limit=100");
    expect(res.status).toBe(200);
    const vendorB = (res.body.vendors as Array<Record<string, unknown>>).find(
      (v) => v.id === B.vendorId,
    );
    expect(vendorB).toBeDefined();
    expect(Number(vendorB!.active_findings_count)).toBe(3);
    expect(Number(vendorB!.open_findings_count)).toBe(3);
  });
});
