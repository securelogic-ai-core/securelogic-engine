/**
 * entityScopedFindings.test.ts — GET /api/obligations/:id/findings,
 *                                GET /api/controls/:id/findings,
 *                                and the per-vendor counts on GET /api/vendors.
 *
 * THE DEFECT THIS FILE EXISTS FOR. Three surfaces resolved entity→findings linkage in
 * the BROWSER, over a page that had already been truncated:
 *
 *   obligations/[id]  getFindings(source_type='obligation_review', limit:100), then
 *                     filtered against an assessment list ITSELF capped at 20;
 *   controls/[id]     the same shape, with source_type='control_test';
 *   vendors + risk    getFindings(domain='Vendor Risk', limit:100), then GROUPED by
 *                     vendor through an assessment map also capped at 100.
 *
 * In each case the cap was applied BEFORE the filter — twice. Past the cap, an
 * entity's real findings fell off the end of the page before the filter ever saw
 * them, and the page printed a confident "0 open findings" for an entity that had
 * them. On the vendor risk board it was worse than a wrong badge: the open-finding
 * count drives the red/orange risk borders, so a truncated count rendered a
 * high-risk vendor with open findings as if it were clean.
 *
 * A truncation is not a zero. The linkage is a join, so it belongs in the join.
 *
 * The test that would have caught it is exactly this: seed the org PAST the old caps
 * with unrelated findings, then ask for one entity's. Every assertion below fails
 * against the old client-side-filter implementation.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import request from "supertest";
import type { Express } from "express";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let app: Express;

/** Comfortably past the old `limit: 100` page, so the truncation is really exercised. */
const ORG_NOISE = 120;

let obligationA: string;
let otherObligationA: string;
let controlA: string;
let otherControlA: string;
let vendorA: string;
let quietVendorA: string;
let obligationB: string; // org B — the cross-org guard

async function insertFinding(
  orgId: string,
  title: string,
  sourceType: string,
  sourceId: string | null,
  status = "open"
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, domain,
                           source_type, source_id, status)
     VALUES ($1, $2, 'High', 'entity-scoped seed', 'Vendor Risk', $3, $4, $5)
     RETURNING id`,
    [orgId, title, sourceType, sourceId, status]
  );
  return r.rows[0]!.id;
}

async function seedObligation(orgId: string, title: string): Promise<{ id: string; assessmentId: string }> {
  const o = await pool.query<{ id: string }>(
    `INSERT INTO obligations (organization_id, title, description, source_regulation,
                              jurisdiction, domain, status, priority)
     VALUES ($1, $2, 'seed', 'HIPAA', 'US', 'Regulatory', 'active', 'planned')
     RETURNING id`,
    [orgId, title]
  );
  const a = await pool.query<{ id: string }>(
    `INSERT INTO obligation_assessments (organization_id, obligation_id, status)
     VALUES ($1, $2, 'in_progress') RETURNING id`,
    [orgId, o.rows[0]!.id]
  );
  return { id: o.rows[0]!.id, assessmentId: a.rows[0]!.id };
}

async function seedControl(orgId: string, name: string): Promise<{ id: string; assessmentId: string }> {
  const c = await pool.query<{ id: string }>(
    `INSERT INTO controls (organization_id, name, description, domain, status)
     VALUES ($1, $2, 'seed', 'Cyber', 'active') RETURNING id`,
    [orgId, name]
  );
  const a = await pool.query<{ id: string }>(
    `INSERT INTO control_assessments (organization_id, control_id, status)
     VALUES ($1, $2, 'in_progress') RETURNING id`,
    [orgId, c.rows[0]!.id]
  );
  return { id: c.rows[0]!.id, assessmentId: a.rows[0]!.id };
}

async function seedVendor(
  orgId: string,
  name: string,
  criticality = "critical"
): Promise<{ id: string; assessmentId: string }> {
  const v = await pool.query<{ id: string }>(
    `INSERT INTO vendors (organization_id, name, criticality, status)
     VALUES ($1, $2, $3, 'active') RETURNING id`,
    [orgId, name, criticality]
  );
  const a = await pool.query<{ id: string }>(
    `INSERT INTO vendor_assessments (organization_id, vendor_id, assessment_type, overall_severity)
     VALUES ($1, $2, 'security', 'High') RETURNING id`,
    [orgId, v.rows[0]!.id]
  );
  return { id: v.rows[0]!.id, assessmentId: a.rows[0]!.id };
}

const get = (path: string, key: string) => request(app).get(path).set("X-Api-Key", key);

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the entity-scoped findings test.");
  pool = new Pool({ connectionString: url, ssl: false });

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });

  const o = await seedObligation(seed.orgA.id, "esf-obligation");
  const o2 = await seedObligation(seed.orgA.id, "esf-other-obligation");
  const c = await seedControl(seed.orgA.id, "esf-control");
  const c2 = await seedControl(seed.orgA.id, "esf-other-control");
  const v = await seedVendor(seed.orgA.id, "esf-vendor");
  const qv = await seedVendor(seed.orgA.id, "esf-quiet-vendor");
  obligationA = o.id; otherObligationA = o2.id;
  controlA = c.id;    otherControlA = c2.id;
  vendorA = v.id;     quietVendorA = qv.id;

  // ── The noise. More than the old cap, seeded FIRST so that under the old
  // implementation the real findings below would be pushed off the page entirely.
  for (let i = 0; i < ORG_NOISE; i++) {
    await insertFinding(seed.orgA.id, `noise obligation ${i}`, "obligation_review", o2.assessmentId);
    await insertFinding(seed.orgA.id, `noise control ${i}`, "control_test", c2.assessmentId);
    await insertFinding(seed.orgA.id, `noise vendor ${i}`, "vendor_review", (await seedVendorNoise()).assessmentId);
  }

  // ── The findings that actually belong to our entities.
  await insertFinding(seed.orgA.id, "ob real open 1", "obligation_review", o.assessmentId, "open");
  await insertFinding(seed.orgA.id, "ob real open 2", "obligation_review", o.assessmentId, "open");
  await insertFinding(seed.orgA.id, "ob real in_progress", "obligation_review", o.assessmentId, "in_progress");
  await insertFinding(seed.orgA.id, "ob real closed", "obligation_review", o.assessmentId, "closed");

  await insertFinding(seed.orgA.id, "ctl real open 1", "control_test", c.assessmentId, "open");
  await insertFinding(seed.orgA.id, "ctl real in_progress", "control_test", c.assessmentId, "in_progress");
  await insertFinding(seed.orgA.id, "ctl real closed", "control_test", c.assessmentId, "closed");

  await insertFinding(seed.orgA.id, "vnd real open 1", "vendor_review", v.assessmentId, "open");
  await insertFinding(seed.orgA.id, "vnd real open 2", "vendor_review", v.assessmentId, "open");
  await insertFinding(seed.orgA.id, "vnd real closed", "vendor_review", v.assessmentId, "closed");

  // ── Org B: same shape, must never appear in org A's answers.
  const ob = await seedObligation(seed.orgB.id, "esf-org-b-obligation");
  obligationB = ob.id;
  await insertFinding(seed.orgB.id, "org B finding", "obligation_review", ob.assessmentId, "open");
}, 300_000);

/**
 * A throwaway vendor per noise finding, so the noise is spread across vendors rather
 * than landing on ours. Seeded 'low' so the list's criticality-first ordering keeps the
 * critical vendors under test on the first page — the noise is here to bury the
 * FINDINGS, which is the defect, not to exercise vendor pagination, which is not.
 */
async function seedVendorNoise(): Promise<{ id: string; assessmentId: string }> {
  noiseVendorCounter += 1;
  return seedVendor(seed.orgA.id, `esf-noise-vendor-${noiseVendorCounter}`, "low");
}
let noiseVendorCounter = 0;

afterAll(async () => {
  await pool?.end();
});

describe("GET /api/obligations/:id/findings — the linkage is resolved in the database", () => {
  it("returns THIS obligation's findings from an org seeded far past the old cap", async () => {
    const res = await get(`/api/obligations/${obligationA}/findings`, seed.orgA.apiKey);
    expect(res.status).toBe(200);

    // 4 real findings. Under the old implementation these were invisible: 120 noise
    // findings filled the limit:100 page before the browser-side filter ever ran.
    expect(res.body.total).toBe(4);
    expect(res.body.open_total).toBe(2);
    // active = operational_status <> 'closed' → the 2 open + the 1 in_progress.
    expect(res.body.active_total).toBe(3);

    const titles = (res.body.findings as Array<{ title: string }>).map((f) => f.title);
    expect(titles).toEqual(expect.arrayContaining(["ob real open 1", "ob real in_progress"]));
    expect(titles.every((t) => t.startsWith("ob real"))).toBe(true);
  });

  it("counts are COUNT(*) over the whole matched set, never the length of the page", async () => {
    const res = await get(`/api/obligations/${obligationA}/findings?limit=1`, seed.orgA.apiKey);
    expect(res.status).toBe(200);
    expect(res.body.findings).toHaveLength(1); // the page is bounded
    expect(res.body.total).toBe(4);            // the count is not
    expect(res.body.open_total).toBe(2);
  });

  it("another obligation's findings do not bleed in", async () => {
    const res = await get(`/api/obligations/${otherObligationA}/findings`, seed.orgA.apiKey);
    expect(res.body.total).toBe(ORG_NOISE);
  });

  it("tenant isolation: org A cannot read org B's obligation findings", async () => {
    const res = await get(`/api/obligations/${obligationB}/findings`, seed.orgA.apiKey);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0); // the obligation is not org A's; nothing matches
    expect(res.body.findings).toEqual([]);
  });

  it("rejects a non-UUID id rather than guessing", async () => {
    const res = await get(`/api/obligations/not-a-uuid/findings`, seed.orgA.apiKey);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/controls/:id/findings — the linkage is resolved in the database", () => {
  it("returns THIS control's findings from an org seeded far past the old cap", async () => {
    const res = await get(`/api/controls/${controlA}/findings`, seed.orgA.apiKey);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.open_total).toBe(1);
    expect(res.body.active_total).toBe(2); // open + in_progress; the closed one is not Active

    const titles = (res.body.findings as Array<{ title: string }>).map((f) => f.title);
    expect(titles.every((t) => t.startsWith("ctl real"))).toBe(true);
  });

  it("another control's findings do not bleed in", async () => {
    const res = await get(`/api/controls/${otherControlA}/findings`, seed.orgA.apiKey);
    expect(res.body.total).toBe(ORG_NOISE);
  });

  it("counts do not collapse to the page length", async () => {
    const res = await get(`/api/controls/${controlA}/findings?limit=1`, seed.orgA.apiKey);
    expect(res.body.findings).toHaveLength(1);
    expect(res.body.total).toBe(3);
  });
});

describe("GET /api/vendors — per-vendor finding counts come from the database", () => {
  it("each vendor carries its OWN true count, not a share of a truncated page", async () => {
    const res = await get(`/api/vendors?limit=100`, seed.orgA.apiKey);
    expect(res.status).toBe(200);

    const vendors = res.body.vendors as Array<{
      id: string;
      open_findings_count: number;
      active_findings_count: number;
    }>;

    const mine = vendors.find((v) => v.id === vendorA);
    expect(mine).toBeDefined();
    // 2 open + 1 closed. Under the old grouping these were invisible: 120 noise
    // findings filled the limit:100 page, so this vendor's card showed NO badge —
    // a confident zero on a critical vendor that had open findings.
    expect(mine!.open_findings_count).toBe(2);
    expect(mine!.active_findings_count).toBe(2); // the closed one is not Active

    // And a vendor with genuinely none really reads zero — the count is not merely
    // "whatever survived the page".
    const quiet = vendors.find((v) => v.id === quietVendorA);
    expect(quiet!.open_findings_count).toBe(0);
  });

  it("tenant isolation: org B's vendors carry none of org A's counts", async () => {
    const res = await get(`/api/vendors?limit=100`, seed.orgB.apiKey);
    expect(res.status).toBe(200);
    const vendors = res.body.vendors as Array<{ id: string; open_findings_count: number }>;
    expect(vendors.find((v) => v.id === vendorA)).toBeUndefined();
    for (const v of vendors) expect(v.open_findings_count).toBe(0);
  });
});
