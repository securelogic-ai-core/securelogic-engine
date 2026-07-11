/**
 * executiveReport.test.ts — the board PDF must actually generate.
 *
 * Regression: the frameworks CTE contained `);` where `),` was required —
 * a guaranteed runtime SQL syntax error, so GET /api/reports/executive.pdf
 * 500'd for EVERY org. It had zero test coverage; the flagship executive
 * artifact was broken and nothing noticed. This suite drives the real route
 * over real Postgres with every data family seeded so each report query
 * (incl. the frameworks CTE and the new 90-day lifecycle sections) executes.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, seedFinding, seedRisk, seedPostureSnapshot, type TestDbSeed } from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the executive report test.");
  pool = new Pool({ connectionString: url, ssl: false });
  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });

  const org = seed.orgA.id;

  // Framework + requirement — executes the (previously broken) frameworks CTE.
  const fw = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version) VALUES ($1, 'NIST CSF', '2.0') RETURNING id`,
    [org]
  );
  await pool.query(
    `INSERT INTO requirements (framework_id, reference_id, title)
     VALUES ($1, 'GV.OC-01', 'Organizational context')`,
    [fw.rows[0].id]
  );

  // Posture snapshots: one now, one 120 days back (trend comparison).
  await seedPostureSnapshot(pool, org, {});

  // Findings + risks + a lifecycle decision event for the 90-day section.
  const findingId = await seedFinding(pool, org);
  await seedRisk(pool, org, {});
  await pool.query(
    `INSERT INTO finding_lifecycle_events
       (organization_id, finding_id, axis, from_state, to_state, transition)
     VALUES ($1, $2, 'decision', 'mitigating', 'resolved', 'close')`,
    [org, findingId]
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("GET /api/reports/executive.pdf", () => {
  it("generates a PDF (200, pdf content-type, %PDF magic) with all sections' queries executing", async () => {
    const res = await request(app)
      .get("/api/reports/executive.pdf")
      .set("X-Api-Key", seed.orgA.apiKey)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
    // A real multi-page report, not an error stub.
    expect(body.length).toBeGreaterThan(5000);
  });

  it("also generates for an org with NO data (empty program — every section degrades)", async () => {
    const res = await request(app)
      .get("/api/reports/executive.pdf")
      .set("X-Api-Key", seed.orgB.apiKey)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
  });
});
