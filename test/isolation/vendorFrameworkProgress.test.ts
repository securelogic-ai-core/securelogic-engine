/**
 * vendorFrameworkProgress.test.ts — the one-read replacement for
 * `GET /frameworks` + N × `GET /frameworks/:id/requirements?subject_id=vendor`.
 *
 * Three boundaries, all proven through the route:
 *   org A vs org B            — vendor ownership (404) and framework scoping
 *   Alpha vs Beta, same org   — responses attach to ONE vendor (subject_id)
 *   numbers                   — identical to the per-framework requirements
 *                               summary the page used to assemble by hand
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

let alphaVendor: string;
let betaVendor: string;
let orgBVendor: string;
let fwA1: string;
let fwA2: string;
let fwB: string;

const progress = (key: string, vendorId: string) =>
  request(app).get(`/api/vendors/${vendorId}/framework-progress`).set("X-Api-Key", key);
const requirementsSummary = (key: string, frameworkId: string, vendorId: string) =>
  request(app)
    .get(`/api/frameworks/${frameworkId}/requirements?assessment_type=vendor&subject_id=${vendorId}`)
    .set("X-Api-Key", key);

async function seedFramework(orgId: string, name: string, refs: string[]): Promise<{ id: string; reqs: string[] }> {
  const fw = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version) VALUES ($1, $2, '1.0') RETURNING id`,
    [orgId, name],
  );
  const reqs: string[] = [];
  for (const ref of refs) {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO requirements (framework_id, reference_id, title) VALUES ($1, $2, $3) RETURNING id`,
      [fw.rows[0]!.id, ref, `Requirement ${ref}`],
    );
    reqs.push(r.rows[0]!.id);
  }
  return { id: fw.rows[0]!.id, reqs };
}

async function respond(orgId: string, requirementId: string, vendorId: string, status: string) {
  await pool.query(
    `INSERT INTO requirement_responses (organization_id, requirement_id, assessment_type, subject_id, status, assessed_at)
     VALUES ($1, $2, 'vendor', $3, $4, NOW())`,
    [orgId, requirementId, vendorId, status],
  );
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env.DATABASE_URL = url;
  pool = new Pool({ connectionString: url, ssl: false });

  alphaVendor = await seedVendor(pool, seed.orgA.id, { name: "Alpha Supplies" });
  betaVendor = await seedVendor(pool, seed.orgA.id, { name: "Beta Systems" });
  orgBVendor = await seedVendor(pool, seed.orgB.id, { name: "Org B Supplier" });

  // Org A: two frameworks. Alpha has started FW-A1 (2 pass, 1 fail, 1 untouched)
  // and has a stored `not_assessed` on FW-A2 (which must NOT count as started).
  // Beta has started FW-A2 only.
  const a1 = await seedFramework(seed.orgA.id, "Progress FW A1", ["A1-1", "A1-2", "A1-3", "A1-4"]);
  const a2 = await seedFramework(seed.orgA.id, "Progress FW A2", ["A2-1", "A2-2"]);
  fwA1 = a1.id; fwA2 = a2.id;
  await respond(seed.orgA.id, a1.reqs[0]!, alphaVendor, "pass");
  await respond(seed.orgA.id, a1.reqs[1]!, alphaVendor, "pass");
  await respond(seed.orgA.id, a1.reqs[2]!, alphaVendor, "fail");
  await respond(seed.orgA.id, a2.reqs[0]!, alphaVendor, "not_assessed");
  await respond(seed.orgA.id, a2.reqs[0]!, betaVendor, "partial");

  // Org B: its own framework, its own vendor's responses.
  const b = await seedFramework(seed.orgB.id, "Progress FW B", ["B-1"]);
  fwB = b.id;
  await respond(seed.orgB.id, b.reqs[0]!, orgBVendor, "pass");

  app = express();
  app.use(express.json());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

describe("GET /api/vendors/:id/framework-progress — the numbers", () => {
  it("lists only frameworks where THIS vendor's assessment has started, with the summary the requirements route computes", async () => {
    const res = await progress(seed.orgA.apiKey, alphaVendor);
    expect(res.status).toBe(200);
    expect(res.body.vendor_id).toBe(alphaVendor);
    expect(res.body.frameworks).toHaveLength(1);
    const [entry] = res.body.frameworks;
    expect(entry.framework).toEqual({ id: fwA1, name: "Progress FW A1", version: "1.0" });
    expect(entry.summary).toMatchObject({ total: 4, pass: 2, partial: 0, fail: 1, not_assessed: 1, progress_pct: 75 });
    expect(typeof entry.summary.last_response_at).toBe("string");

    // Byte-for-byte agreement with the read it replaces.
    const direct = await requirementsSummary(seed.orgA.apiKey, fwA1, alphaVendor);
    expect(direct.status).toBe(200);
    expect(entry.summary).toEqual(direct.body.summary);
  });

  it("a stored not_assessed response does not make a framework 'started'", async () => {
    const res = await progress(seed.orgA.apiKey, alphaVendor);
    expect(res.body.frameworks.map((f: { framework: { id: string } }) => f.framework.id)).not.toContain(fwA2);
  });

  it("same org, other vendor: Beta sees its own framework only — Alpha's responses never leak across subject_id", async () => {
    const res = await progress(seed.orgA.apiKey, betaVendor);
    expect(res.status).toBe(200);
    expect(res.body.frameworks).toHaveLength(1);
    expect(res.body.frameworks[0].framework.id).toBe(fwA2);
    expect(res.body.frameworks[0].summary).toMatchObject({ total: 2, pass: 0, partial: 1, fail: 0, not_assessed: 1, progress_pct: 50 });
  });
});

describe("GET /api/vendors/:id/framework-progress — the tenant boundary", () => {
  it("org B cannot read org A's vendor (404, no hint)", async () => {
    const res = await progress(seed.orgB.apiKey, alphaVendor);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "vendor_not_found" });
  });

  it("org A cannot read org B's vendor (404, no hint)", async () => {
    const res = await progress(seed.orgA.apiKey, orgBVendor);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "vendor_not_found" });
  });

  it("org B's own read never contains an org A framework", async () => {
    const res = await progress(seed.orgB.apiKey, orgBVendor);
    expect(res.status).toBe(200);
    expect(res.body.frameworks.map((f: { framework: { id: string } }) => f.framework.id)).toEqual([fwB]);
  });

  it("a malformed id is a 404, not a 500", async () => {
    const res = await progress(seed.orgA.apiKey, "not-a-uuid");
    expect(res.status).toBe(404);
  });

  it("no credential → 401", async () => {
    const res = await request(app).get(`/api/vendors/${alphaVendor}/framework-progress`);
    expect(res.status).toBe(401);
  });
});
