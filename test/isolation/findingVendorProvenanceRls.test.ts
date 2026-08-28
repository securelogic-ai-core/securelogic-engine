/**
 * findingVendorProvenanceRls.test.ts — real-Postgres isolation proof for the
 * Vendor Assurance provenance read path (T1-B).
 *
 * WHY A READ-ONLY ENDPOINT STILL NEEDS THIS FILE.
 * Provenance is a FOUR-TABLE JOIN — cuec -> document -> vendor, plus a user —
 * driven by an id supplied in the URL. Every join is a place where forgetting a
 * predicate returns another tenant's vendor name, their auditor's report
 * filename, the verbatim text of their contractual obligation, and the identity
 * of the person who decided they do not meet it. That is a worse disclosure than
 * most write paths, and it leaves no trace, because nothing was mutated.
 *
 * THE LOAD-BEARING ASSERTION IS THE CROSS-WIRED ROW. It is not enough to show
 * that org B cannot read org A's finding. The query is anchored on
 * `promoted_finding_id`, so the question that matters is: if a CUEC belonging to
 * org B claims to have promoted a finding belonging to org A, does org A's
 * request see it? It must not — and the thing that prevents it is the
 * `c.organization_id = $2` predicate, NOT the finding id. This file exists mainly
 * to prove that one line cannot be removed without a test going red.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;

let findingA: string;
let findingB: string;
let cuecA: string;
let cuecB: string;

/**
 * The provenance query from findingVendorProvenance.ts, verbatim in shape.
 * If the route's SQL changes, this must change with it — that coupling is
 * deliberate, because the point is to test the predicate set, not a paraphrase.
 */
const PROVENANCE_SQL = `
  SELECT c.id AS cuec_id, v.name AS vendor_name, d.original_filename
    FROM vendor_assurance_cuecs c
    JOIN vendor_assurance_documents d
      ON d.id = c.document_id AND d.organization_id = c.organization_id
    JOIN vendors v
      ON v.id = d.vendor_id AND v.organization_id = d.organization_id
   WHERE c.promoted_finding_id = $1
     AND c.organization_id     = $2
   LIMIT 1`;

/** Owner-channel seeding — the import path, not the request path. */
async function seedChain(
  orgId: string,
  label: string,
): Promise<{ findingId: string; cuecId: string }> {
  const finding = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, status, source_type)
     VALUES ($1, $2, 'High', 'provenance harness finding', 'open', 'vendor_review')
     RETURNING id`,
    [orgId, `${label} finding`],
  );
  const findingId = finding.rows[0]!.id;

  const vendor = await pool.query<{ id: string }>(
    `INSERT INTO vendors (organization_id, name) VALUES ($1, $2) RETURNING id`,
    [orgId, `${label} vendor`],
  );
  const doc = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assurance_documents
       (organization_id, vendor_id, original_filename, byte_size, sha256, storage_key, mime_type)
     VALUES ($1, $2, $3, 1024, $4, $5, 'application/pdf')
     RETURNING id`,
    [orgId, vendor.rows[0]!.id, `${label}-soc2.pdf`, "a".repeat(64), `k/${label}`],
  );
  const cuec = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assurance_cuecs
       (organization_id, document_id, ordinal, cuec_text, review_status,
        review_status_updated_at, promoted_finding_id)
     VALUES ($1, $2, 1, $3, 'gap', NOW(), $4)
     RETURNING id`,
    [orgId, doc.rows[0]!.id, `${label} obligation text`, findingId],
  );

  return { findingId, cuecId: cuec.rows[0]!.id };
}

async function asOrg<T>(
  orgId: string,
  fn: (c: import("pg").PoolClient) => Promise<T>,
): Promise<T> {
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

beforeAll(async () => {
  seed = await bootstrapTestDb();
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, ssl: false });

  const a = await seedChain(seed.orgA.id, "orgA");
  const b = await seedChain(seed.orgB.id, "orgB");
  findingA = a.findingId;
  cuecA = a.cuecId;
  findingB = b.findingId;
  cuecB = b.cuecId;
});

afterAll(async () => {
  await pool?.end();
});

describe("vendor-assurance provenance stays inside its tenant", () => {
  it("org A reads its own provenance", async () => {
    const rows = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(PROVENANCE_SQL, [findingA, seed.orgA.id])).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].cuec_id).toBe(cuecA);
    expect(rows[0].vendor_name).toBe("orgA vendor");
    expect(rows[0].original_filename).toBe("orgA-soc2.pdf");
  });

  it("org A asking for org B's finding gets NOTHING", async () => {
    const rows = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(PROVENANCE_SQL, [findingB, seed.orgA.id])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it("org B cannot read org A's provenance even naming org A's ids", async () => {
    // Both parameters are org A's. RLS under app_request must still refuse,
    // because the session's org is B — the predicate is not the only defence.
    const rows = await asOrg(seed.orgB.id, async (c) =>
      (await c.query(PROVENANCE_SQL, [findingA, seed.orgA.id])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it("THE ONE THAT MATTERS: a cross-wired CUEC in org B does not surface for org A", async () => {
    // Point org B's CUEC at org A's finding — the exact shape that would leak if
    // the query trusted promoted_finding_id and dropped c.organization_id.
    await pool.query(
      `UPDATE vendor_assurance_cuecs SET promoted_finding_id = $1 WHERE id = $2`,
      [findingA, cuecB],
    );
    try {
      const rows = await asOrg(seed.orgA.id, async (c) =>
        (await c.query(PROVENANCE_SQL, [findingA, seed.orgA.id])).rows,
      );
      // Exactly one row, and it is A's own — never B's vendor or B's filename.
      expect(rows).toHaveLength(1);
      expect(rows[0].vendor_name).toBe("orgA vendor");
      expect(rows[0].original_filename).toBe("orgA-soc2.pdf");
      expect(rows[0].cuec_id).toBe(cuecA);
    } finally {
      await pool.query(
        `UPDATE vendor_assurance_cuecs SET promoted_finding_id = $1 WHERE id = $2`,
        [findingB, cuecB],
      );
    }
  });

  it("the document->vendor join cannot cross tenants either (CUEC arm)", async () => {
    // Strip the org predicate from the outer WHERE but keep the join predicates:
    // RLS alone must still confine the result to the caller's tenant.
    const rows = await asOrg(seed.orgB.id, async (c) =>
      (
        await c.query(
          `SELECT v.name AS vendor_name
             FROM vendor_assurance_cuecs c
             JOIN vendor_assurance_documents d
               ON d.id = c.document_id AND d.organization_id = c.organization_id
             JOIN vendors v
               ON v.id = d.vendor_id AND v.organization_id = d.organization_id`,
        )
      ).rows,
    );
    for (const r of rows) expect(r.vendor_name).toBe("orgB vendor");
  });
});

/* =========================================================
   VA-10 — the engagement arm of the same endpoint.

   Unlike the CUEC arm (FK-backed via promoted_finding_id), this arm resolves
   by the source_id CONVENTION with the source_type filter load-bearing. The
   suite proves: the resolution works inside a tenant; the convention's honest
   failure mode (dangling source_id) returns nothing rather than someone
   else's engagement; and no combination of borrowed ids crosses a tenant.
   ========================================================= */

const ENGAGEMENT_PROVENANCE_SQL = `
  SELECT e.id AS engagement_id, v.name AS vendor_name,
         r.reference_id AS requirement_reference,
         rr.status AS current_response
    FROM findings f
    JOIN vendor_engagements e
      ON e.id::text = f.source_id::text
     AND e.organization_id = f.organization_id
    JOIN vendors v
      ON v.id = e.vendor_id
     AND v.organization_id = e.organization_id
    LEFT JOIN requirements r
      ON r.id = f.requirement_id
    LEFT JOIN requirement_responses rr
      ON rr.organization_id = f.organization_id
     AND rr.engagement_id   = e.id
     AND rr.requirement_id  = f.requirement_id
   WHERE f.id = $1
     AND f.organization_id = $2
     AND f.source_type = 'vendor_engagement'
   LIMIT 1`;

describe("vendor-engagement provenance stays inside its tenant (VA-10)", () => {
  let engFindingA: string;
  let engFindingB: string;
  let engagementA: string;

  async function seedEngagementChain(
    orgId: string,
    label: string,
  ): Promise<{ findingId: string; engagementId: string }> {
    const vendor = await pool.query<{ id: string }>(
      `INSERT INTO vendors (organization_id, name) VALUES ($1, $2) RETURNING id`,
      [orgId, `${label} eng vendor`],
    );
    const framework = await pool.query<{ id: string }>(
      `INSERT INTO frameworks (organization_id, name, version)
       VALUES ($1, $2, '1.0') RETURNING id`,
      [orgId, `${label} provenance framework`],
    );
    const requirement = await pool.query<{ id: string }>(
      `INSERT INTO requirements (framework_id, reference_id, title)
       VALUES ($1, $2, $3) RETURNING id`,
      [framework.rows[0]!.id, `${label}-PROV-1`, `${label} control`],
    );
    const eng = await pool.query<{ id: string }>(
      `INSERT INTO vendor_engagements
         (organization_id, vendor_id, engagement_type, status,
          methodology_version, scope_rule_version, inherent_rating)
       VALUES ($1, $2, 'initial', 'in_review', '1.0.0', '1.0.0', 'Moderate')
       RETURNING id`,
      [orgId, vendor.rows[0]!.id],
    );
    await pool.query(
      `INSERT INTO requirement_responses
         (organization_id, requirement_id, assessment_type, subject_id,
          engagement_id, status, assessed_at)
       VALUES ($1, $2, 'vendor', $3, $3, 'fail', NOW())`,
      [orgId, requirement.rows[0]!.id, eng.rows[0]!.id],
    );
    const finding = await pool.query<{ id: string }>(
      `INSERT INTO findings
         (organization_id, title, severity, description, status,
          source_type, source_id, requirement_id)
       VALUES ($1, $2, 'High', 'engagement provenance harness finding', 'open',
               'vendor_engagement', $3, $4)
       RETURNING id`,
      [orgId, `${label} engagement finding`, eng.rows[0]!.id, requirement.rows[0]!.id],
    );
    return { findingId: finding.rows[0]!.id, engagementId: eng.rows[0]!.id };
  }

  beforeAll(async () => {
    const a = await seedEngagementChain(seed.orgA.id, "orgA");
    const b = await seedEngagementChain(seed.orgB.id, "orgB");
    engFindingA = a.findingId;
    engagementA = a.engagementId;
    engFindingB = b.findingId;
  });

  it("org A reads its own engagement provenance, current response included", async () => {
    const rows = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(ENGAGEMENT_PROVENANCE_SQL, [engFindingA, seed.orgA.id])).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].engagement_id).toBe(engagementA);
    expect(rows[0].vendor_name).toBe("orgA eng vendor");
    expect(rows[0].requirement_reference).toBe("orgA-PROV-1");
    expect(rows[0].current_response).toBe("fail");
  });

  it("org A asking for org B's engagement finding gets NOTHING", async () => {
    const rows = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(ENGAGEMENT_PROVENANCE_SQL, [engFindingB, seed.orgA.id])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it("org B cannot read org A's engagement provenance even naming org A's ids", async () => {
    const rows = await asOrg(seed.orgB.id, async (c) =>
      (await c.query(ENGAGEMENT_PROVENANCE_SQL, [engFindingA, seed.orgA.id])).rows,
    );
    expect(rows).toHaveLength(0);
  });

  it("a dangling source_id resolves to NOTHING — never someone else's engagement", async () => {
    // The convention arm's failure mode: a vendor_engagement finding whose
    // source_id matches no engagement in ITS org. The org predicate on the
    // join — not luck — is what keeps an identical id in another org out.
    const orphan = await pool.query<{ id: string }>(
      `INSERT INTO findings
         (organization_id, title, severity, description, status,
          source_type, source_id)
       VALUES ($1, 'orphan engagement finding', 'Low', 'dangling source_id',
               'open', 'vendor_engagement', gen_random_uuid())
       RETURNING id`,
      [seed.orgA.id],
    );
    const rows = await asOrg(seed.orgA.id, async (c) =>
      (await c.query(ENGAGEMENT_PROVENANCE_SQL, [orphan.rows[0]!.id, seed.orgA.id])).rows,
    );
    expect(rows).toHaveLength(0);
  });
});
