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
import { PDFParse } from "pdf-parse";

import { bootstrapTestDb, seedFinding, seedRisk, seedPostureSnapshot, type TestDbSeed } from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;

/** GET a PDF report and return its extracted full text. */
async function fetchReportText(apiKey: string): Promise<string> {
  const res = await request(app)
    .get("/api/reports/executive.pdf")
    .set("X-Api-Key", apiKey)
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });
  expect(res.status).toBe(200);
  const parser = new PDFParse(new Uint8Array(res.body as Buffer));
  return (await parser.getText()).text;
}

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

  // Posture snapshots: a prior one (2026-01-01, risk 52 → health 48) and TODAY's
  // latest carrying the reconciled domain breakdown. domain_scores.score is
  // risk-style in the DB (higher = worse); the report and /posture both invert it
  // once to health-style, so risk 60/92/28 render as health 40/8/72. The
  // per-domain finding counts (2 + 23 + 1 = 26) equal the snapshot's
  // open_finding_count — the reconciliation the report must reproduce.
  await seedPostureSnapshot(pool, org, { snapshotDate: "2026-01-01", overallScore: 52 });
  const today = new Date().toISOString().slice(0, 10);
  const latestSnap = await seedPostureSnapshot(pool, org, { snapshotDate: today, overallScore: 60 });
  await pool.query(`UPDATE posture_snapshots SET open_finding_count = 26 WHERE id = $1`, [latestSnap]);
  await pool.query(
    `INSERT INTO domain_scores
       (posture_snapshot_id, domain, score, severity, finding_count, trend_direction, rationale)
     VALUES
       ($1, 'Access Control',  60, 'High',     2,  'stable',    'seed'),
       ($1, 'Data Protection', 92, 'Critical', 23, 'worsening', 'seed'),
       ($1, 'Vendor Risk',     28, 'Low',      1,  'improving', 'seed')`,
    [latestSnap]
  );

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

  it("renders the reconciled domain breakdown whose counts sum to Total Active Findings (26)", async () => {
    const text = await fetchReportText(seed.orgA.apiKey);

    expect(text).toContain("Posture Domain Breakdown");
    // Every domain from the saved snapshot appears…
    for (const domain of ["Access Control", "Data Protection", "Vendor Risk"]) {
      expect(text).toContain(domain);
    }
    // …with health-style scores (higher = better), inverted once from risk-style.
    expect(text).toContain("40/100"); // Access Control  (risk 60)
    expect(text).toContain("8/100");  // Data Protection (risk 92)
    expect(text).toContain("72/100"); // Vendor Risk     (risk 28)
    // The counts reconcile to the snapshot's active-finding total.
    expect(text).toContain("TOTAL ACTIVE FINDINGS");
    expect(text).toContain("26");
    // Deterministic trend wording, no malformed glyphs (health 40 vs prior 48).
    expect(text).toContain("decreased by 8 points");
    expect(text).toContain("higher = better");
    for (const glyph of ["▲", "▼", "◆", "�"]) {
      expect(text.includes(glyph), `report contains malformed char ${JSON.stringify(glyph)}`).toBe(false);
    }
  });

  it("report domain values match the SAME saved snapshot that /posture serves", async () => {
    // Read /posture/latest — the source of truth the dashboard renders.
    const postureRes = await request(app)
      .get("/api/posture/latest")
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(postureRes.status).toBe(200);

    const snapshot = postureRes.body.snapshot;
    const domainScores: Array<{ domain: string; score: number | null; severity: string | null; finding_count: number }> =
      postureRes.body.domainScores;

    // /posture already reports the reconciled total and health-style scores.
    expect(snapshot.openFindingCount).toBe(26);
    const domainSum = domainScores.reduce((s, d) => s + d.finding_count, 0);
    expect(domainSum).toBe(snapshot.openFindingCount);

    // The report must reproduce those exact values off the same snapshot.
    const text = await fetchReportText(seed.orgA.apiKey);
    for (const d of domainScores) {
      expect(text).toContain(d.domain);
      if (d.score !== null) expect(text).toContain(`${d.score}/100`);
    }
    expect(text).toContain(String(snapshot.openFindingCount));
  });

  it("tenant isolation: org B's report never shows org A's domain rows", async () => {
    // Org B has no posture snapshot — its domain section degrades cleanly and
    // cannot contain any of org A's domains.
    const text = await fetchReportText(seed.orgB.apiKey);
    expect(text).toContain("Posture Domain Breakdown");
    expect(text).toContain("No posture snapshot exists yet");
    for (const domain of ["Access Control", "Data Protection", "Vendor Risk"]) {
      expect(text).not.toContain(domain);
    }
  });
});
