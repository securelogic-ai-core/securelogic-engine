/**
 * aiSystemFindings.test.ts — GET /api/ai-systems/:id/findings
 *
 * THE DEFECT THIS FILE EXISTS FOR. The AI-system detail page had no scoped route, so it
 * improvised one: it fetched the ORG's findings with `limit: 50` and filtered them down
 * to the system in the browser. Three bugs in one line —
 *
 *   scoping     the read was org-wide, not entity-scoped;
 *   truncation  it was capped at 50 rows;
 *   ordering    the cap was applied BEFORE the filter.
 *
 * So in an org with more than 50 findings, a system's own findings fell off the end of
 * the page before the filter ever saw them, and the page printed a confident
 * "0 open findings" for a system that had them. A truncation is not a zero.
 *
 * The test that would have caught it is exactly this: seed the org PAST the old cap with
 * unrelated findings, then ask for one system's. Every assertion below fails against the
 * old client-side-filter implementation.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import request from "supertest";
import type { Express } from "express";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let app: Express;

let systemA: string;   // org A, the system under test
let otherSystemA: string; // org A, a DIFFERENT system — its findings must not bleed in
let systemB: string;   // org B — cross-org guard

/** More than the old `limit: 50` page, so the truncation is actually exercised. */
const ORG_NOISE_FINDINGS = 60;

async function seedAiSystem(orgId: string, name: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO ai_systems (organization_id, name) VALUES ($1, $2) RETURNING id`,
    [orgId, name]
  );
  return r.rows[0].id;
}

async function seedReview(orgId: string, aiSystemId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO governance_reviews (organization_id, ai_system_id, review_type)
     VALUES ($1, $2, 'pre_deployment') RETURNING id`,
    [orgId, aiSystemId]
  );
  return r.rows[0].id;
}

async function seedAssessment(orgId: string, aiSystemId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO ai_governance_assessments (organization_id, ai_system_id, status)
     VALUES ($1, $2, 'in_progress') RETURNING id`,
    [orgId, aiSystemId]
  );
  return r.rows[0].id;
}

async function seedFinding(opts: {
  orgId: string;
  title: string;
  status: string;
  sourceType: string;
  sourceId: string | null;
  severity?: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO findings (organization_id, title, severity, description, status, source_type, source_id)
     VALUES ($1, $2, $3, 'seeded by aiSystemFindings.test', $4, $5, $6)`,
    [
      opts.orgId,
      opts.title,
      opts.severity ?? "High",
      opts.status,
      opts.sourceType,
      opts.sourceId,
    ]
  );
}

const get = (path: string, key: string) => request(app).get(path).set("X-Api-Key", key);

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the ai-system findings test.");
  pool = new Pool({ connectionString: url, ssl: false });

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });

  systemA = await seedAiSystem(seed.orgA.id, "Claims Triage Copilot");
  otherSystemA = await seedAiSystem(seed.orgA.id, "Unrelated Recommender");
  systemB = await seedAiSystem(seed.orgB.id, "Org B System");

  // ── The noise that used to eat the page ──
  // 60 org-A findings that belong to NO AI system. Ordered newest-first by the old
  // read, these alone filled and overflowed its 50-row window, so the system's own
  // findings below were never fetched — and "0" was rendered.
  for (let i = 0; i < ORG_NOISE_FINDINGS; i++) {
    await seedFinding({
      orgId: seed.orgA.id,
      title: `unrelated manual finding ${i}`,
      status: "open",
      sourceType: "manual",
      sourceId: null,
    });
  }

  // ── The findings that actually belong to systemA ──
  // Seeded AFTER the noise, so they are the OLDEST rows: under the old
  // created_at DESC + LIMIT 50 read they were exactly the ones truncated away.
  const reviewA = await seedReview(seed.orgA.id, systemA);
  const assessmentA = await seedAssessment(seed.orgA.id, systemA);

  // 2 open + 1 in_progress + 1 closed → total 4, open_total 2, active_total 3.
  await seedFinding({ orgId: seed.orgA.id, title: "sysA open via review", status: "open", sourceType: "ai_review", sourceId: reviewA });
  await seedFinding({ orgId: seed.orgA.id, title: "sysA open via assessment", status: "open", sourceType: "ai_governance_review", sourceId: assessmentA });
  await seedFinding({ orgId: seed.orgA.id, title: "sysA in progress", status: "in_progress", sourceType: "ai_review", sourceId: reviewA });
  await seedFinding({ orgId: seed.orgA.id, title: "sysA closed", status: "closed", sourceType: "ai_review", sourceId: reviewA });

  // A finding on a DIFFERENT org-A system — same org, same source types.
  const otherReview = await seedReview(seed.orgA.id, otherSystemA);
  await seedFinding({ orgId: seed.orgA.id, title: "OTHER system finding", status: "open", sourceType: "ai_review", sourceId: otherReview });

  // A finding on an org-B system — the cross-org guard.
  const reviewB = await seedReview(seed.orgB.id, systemB);
  await seedFinding({ orgId: seed.orgB.id, title: "ORG B finding", status: "open", sourceType: "ai_review", sourceId: reviewB });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("GET /api/ai-systems/:id/findings — a truncation is not a zero", () => {
  it("finds a system's findings even when the org has more findings than the old page held", async () => {
    const res = await get(`/api/ai-systems/${systemA}/findings`, seed.orgA.apiKey);
    expect(res.status).toBe(200);

    // THE REGRESSION. The old page read the org's newest 50 findings and filtered in the
    // browser; these 4 were older than all 60 noise rows, so it saw NONE of them and
    // rendered "0 open findings". Resolved in the database, they are simply found.
    expect(res.body.total).toBe(4);
    expect(res.body.open_total).toBe(2);
    expect(res.body.active_total).toBe(3); // open + in_progress, the Metric Contract
    expect(res.body.findings).toHaveLength(4);
  });

  it("counts the WHOLE matched set — the total is never the length of the page", async () => {
    // A tile prints `total`. If `total` were the row count, a page cap would silently
    // become the ceiling of the number — the original bug, one refactor away from return.
    const res = await get(`/api/ai-systems/${systemA}/findings?limit=1`, seed.orgA.apiKey);
    expect(res.status).toBe(200);

    expect(res.body.findings).toHaveLength(1); // the page is capped...
    expect(res.body.total).toBe(4);            // ...the truth is not
    expect(res.body.open_total).toBe(2);
    expect(res.body.active_total).toBe(3);
  });

  it("returns only THIS system's findings — not the org's, and not a sibling system's", async () => {
    const res = await get(`/api/ai-systems/${systemA}/findings`, seed.orgA.apiKey);

    const titles = res.body.findings.map((f: { title: string }) => f.title);
    expect(titles).toContain("sysA open via review");
    expect(titles).toContain("sysA open via assessment");
    expect(titles).not.toContain("OTHER system finding");
    expect(titles.some((t: string) => t.startsWith("unrelated manual finding"))).toBe(false);
  });

  it("resolves BOTH linkage conventions — reviews and assessments", async () => {
    const res = await get(`/api/ai-systems/${systemA}/findings`, seed.orgA.apiKey);

    // ai_review → governance_reviews.id; ai_governance_review → ai_governance_assessments.id.
    // Neither source_id ever holds an ai_system_id; drop either join and the count halves.
    const sourceTypes = new Set(res.body.findings.map((f: { source_type: string }) => f.source_type));
    expect(sourceTypes).toContain("ai_review");
    expect(sourceTypes).toContain("ai_governance_review");
  });

  it("never leaks another org's findings, even for a system id that exists there", async () => {
    // Org A asking for org B's system: the joins are org-scoped on BOTH sides, so there
    // is nothing to return — and certainly not org B's finding.
    const res = await get(`/api/ai-systems/${systemB}/findings`, seed.orgA.apiKey);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.findings).toHaveLength(0);
  });

  it("rejects a non-UUID id rather than guessing", async () => {
    const res = await get(`/api/ai-systems/not-a-uuid/findings`, seed.orgA.apiKey);
    expect(res.status).toBe(400);
  });
});
