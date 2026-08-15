/**
 * requirementResponsesUniqueness.test.ts — one vendor can be assessed by two
 * engagements, and each engagement keeps its own answers.
 *
 * WHY THIS EXISTS
 * ---------------
 * 20260924_vendor_engagement_scope.sql set out to replace the original
 * four-column unique key on requirement_responses with one that also includes
 * engagement_id, so a vendor under two engagements can answer the same
 * requirement twice. Its own comment says "strictly WIDER". It then dropped
 *
 *   requirement_responses_organization_id_requirement_id_asses_key      (62 chars)
 *
 * while Postgres had named the constraint
 *
 *   requirement_responses_organization_id_requirement_id_assess_key     (63 chars)
 *
 * One character, and `IF EXISTS` made the miss silent. The old key survived,
 * and because the portal upsert's ON CONFLICT names only the NEW index's
 * expression, a collision on the OLD key raised 23505 instead of upserting.
 * Live symptom on staging: PUT /api/vendor-portal/questions/:id returned a
 * deterministic 500 for any requirement that vendor had already answered, and
 * POST /vendor-portal/submit then refused 422 "incomplete" — the vendor
 * hard-blocked, with nothing in the response explaining why.
 * 20261011_requirement_responses_drop_legacy_unique.sql finishes the job by
 * matching the constraint on its COLUMN SET rather than its name.
 *
 * WHAT THIS TEST ASSERTS, AND WHY IT IS SHAPED THIS WAY
 * ----------------------------------------------------
 * The defect survived review because the migration LOOKED right. So the
 * primary assertions here are behavioural — what the database now permits and
 * forbids — not "does a statement appear in a file". The structural check is
 * included too, because it is the one that localises the failure when the
 * behavioural one breaks.
 *
 * It runs against a database rebuilt from the real migration set by
 * bootstrapTestDb, so it fails if a future migration reintroduces the key.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;

/** Fixture ids created once and reused; engagement B is the whole point. */
let requirementId: string;
let vendorId: string;
let engagementA: string;
let engagementB: string;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  pool = new Pool({ connectionString: process.env["TEST_DATABASE_URL"], ssl: false });

  const org = seed.orgA.id;

  const framework = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version)
     VALUES ($1, 'Uniqueness Harness Framework', '1.0') RETURNING id`,
    [org],
  );
  const requirement = await pool.query<{ id: string }>(
    `INSERT INTO requirements (framework_id, reference_id, title)
     VALUES ($1, 'UNQ-1', 'A requirement answered under two engagements') RETURNING id`,
    [framework.rows[0]!.id],
  );
  requirementId = requirement.rows[0]!.id;

  const vendor = await pool.query<{ id: string }>(
    `INSERT INTO vendors (organization_id, name) VALUES ($1, 'Uniqueness Harness Vendor') RETURNING id`,
    [org],
  );
  vendorId = vendor.rows[0]!.id;

  // Two engagements for the SAME vendor — an initial review and a later
  // periodic one, which is the ordinary lifecycle, not an exotic case.
  const mk = async (type: string): Promise<string> => {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO vendor_engagements
         (organization_id, vendor_id, engagement_type, methodology_version, scope_rule_version)
       VALUES ($1, $2, $3, '1.0.0', '1.0.0') RETURNING id`,
      [org, vendorId, type],
    );
    return r.rows[0]!.id;
  };
  engagementA = await mk("initial");
  engagementB = await mk("periodic");
});

afterAll(async () => {
  await pool?.end();
});

/** The portal's real upsert, reduced to the clause under test. */
async function saveAnswer(
  orgId: string,
  engagementId: string | null,
  assessmentType: "vendor" | "self",
  subjectId: string,
  status: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO requirement_responses
       (organization_id, requirement_id, assessment_type, subject_id, engagement_id, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (organization_id, requirement_id, assessment_type, subject_id,
                  COALESCE(engagement_id, '00000000-0000-0000-0000-000000000000'::uuid))
     DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
    [orgId, requirementId, assessmentType, subjectId, engagementId, status],
  );
}

describe("requirement_responses uniqueness", () => {
  it("no longer carries the legacy four-column unique constraint", async () => {
    const r = await pool.query<{ conname: string; cols: string }>(
      `SELECT c.conname,
              (SELECT string_agg(a.attname::text, ',' ORDER BY a.attname::text)
                 FROM unnest(c.conkey) AS k(attnum)
                 JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS cols
         FROM pg_constraint c
        WHERE c.conrelid = 'requirement_responses'::regclass AND c.contype = 'u'`,
    );
    const legacy = r.rows.filter(
      (row) => row.cols === "assessment_type,organization_id,requirement_id,subject_id",
    );
    // Named in the failure message because the whole defect was a name nobody checked.
    expect(
      legacy.map((l) => l.conname),
      "the pre-engagement unique key is back; two engagements per vendor will 23505",
    ).toEqual([]);
  });

  it("still enforces uniqueness through the wider scoped index", async () => {
    const r = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'requirement_responses'
          AND indexname = 'idx_requirement_responses_unique_scoped'`,
    );
    expect(r.rowCount, "the replacement index is missing — uniqueness is now unguarded").toBe(1);
    expect(r.rows[0]!.indexdef).toContain("UNIQUE");
    expect(r.rows[0]!.indexdef).toContain("engagement_id");
  });

  it("lets ONE vendor answer the SAME requirement under TWO engagements", async () => {
    // This is the capability 20260924 was written to deliver and did not.
    await saveAnswer(seed.orgA.id, engagementA, "vendor", vendorId, "pass");
    await saveAnswer(seed.orgA.id, engagementB, "vendor", vendorId, "fail");

    const r = await pool.query<{ engagement_id: string; status: string }>(
      `SELECT engagement_id, status FROM requirement_responses
        WHERE organization_id = $1 AND requirement_id = $2 AND subject_id = $3
          AND assessment_type = 'vendor'
        ORDER BY engagement_id`,
      [seed.orgA.id, requirementId, vendorId],
    );
    expect(r.rowCount).toBe(2);
    // Each engagement keeps ITS OWN answer — the second must not have
    // overwritten the first, which is the other half of "strictly wider".
    const byEngagement = Object.fromEntries(r.rows.map((row) => [row.engagement_id, row.status]));
    expect(byEngagement[engagementA]).toBe("pass");
    expect(byEngagement[engagementB]).toBe("fail");
  });

  it("still upserts rather than duplicates within a single engagement", async () => {
    await saveAnswer(seed.orgA.id, engagementA, "vendor", vendorId, "partial");

    const r = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM requirement_responses
        WHERE organization_id = $1 AND requirement_id = $2 AND subject_id = $3
          AND assessment_type = 'vendor' AND engagement_id = $4`,
      [seed.orgA.id, requirementId, vendorId, engagementA],
    );
    expect(r.rows[0]!.count).toBe("1");

    const status = await pool.query<{ status: string }>(
      `SELECT status FROM requirement_responses
        WHERE engagement_id = $1 AND requirement_id = $2 AND subject_id = $3`,
      [engagementA, requirementId, vendorId],
    );
    expect(status.rows[0]!.status).toBe("partial");
  });

  it("keeps self-assessment rows unique even though engagement_id is NULL", async () => {
    // Self rows carry engagement_id NULL, which the scoped index collapses to
    // the zero UUID. Losing this would let one org hold two answers to the same
    // requirement with nothing to tell them apart.
    await saveAnswer(seed.orgA.id, null, "self", seed.orgA.id, "pass");
    await saveAnswer(seed.orgA.id, null, "self", seed.orgA.id, "fail");

    const r = await pool.query<{ count: string; status: string }>(
      `SELECT count(*) AS count, max(status) AS status FROM requirement_responses
        WHERE organization_id = $1 AND requirement_id = $2 AND assessment_type = 'self'`,
      [seed.orgA.id, requirementId],
    );
    expect(r.rows[0]!.count).toBe("1");
    expect(r.rows[0]!.status).toBe("fail");
  });

  it("keeps the two orgs' answers apart", async () => {
    // Same requirement id, different tenant: the org column is part of every
    // uniqueness rule here, so orgB's answer must be its own row.
    await saveAnswer(seed.orgB.id, null, "self", seed.orgB.id, "pass");

    const r = await pool.query<{ count: string }>(
      `SELECT count(*) AS count FROM requirement_responses
        WHERE requirement_id = $1 AND assessment_type = 'self'`,
      [requirementId],
    );
    expect(r.rows[0]!.count).toBe("2");
  });
});
