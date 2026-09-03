/**
 * questionnaireBridgeCoverage.test.ts — VA-Q1 P3 against real Postgres.
 *
 * bridgeAllRequirements() is idempotent and never touches issued engagements;
 * the coverage query counts bridge vs curated correctly and its ratio moves
 * only when a HUMAN-written question evidences a requirement; org B sees none
 * of org A's coverage.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";
import { enforceJsonContentType } from "../../src/api/lib/contentTypeAllowlist.js";
import { withTenant, pg } from "../../src/api/infra/postgres.js";
import { bridgeAllRequirements } from "../../src/api/lib/questionnaire/bridgeAll.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;
let reqA1: string;
let reqA2: string;
let issuedEngagementA: string;

const asA = (m: "get" | "post", p: string) => request(app)[m](p).set("X-Api-Key", seed.orgA.apiKey);
const asB = (m: "get" | "post", p: string) => request(app)[m](p).set("X-Api-Key", seed.orgB.apiKey);

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env.DATABASE_URL = url;
  pool = new Pool({ connectionString: url, ssl: false });

  for (const [org, label] of [[seed.orgA.id, "P3-A"], [seed.orgB.id, "P3-B"]] as const) {
    const fw = await pool.query<{ id: string }>(`INSERT INTO frameworks (organization_id, name, version) VALUES ($1, $2, '1.0') RETURNING id`, [org, `${label} framework`]);
    const r1 = await pool.query<{ id: string }>(`INSERT INTO requirements (framework_id, reference_id, title, description) VALUES ($1, 'R-1', 'First control', 'First guidance') RETURNING id`, [fw.rows[0]!.id]);
    const r2 = await pool.query<{ id: string }>(`INSERT INTO requirements (framework_id, reference_id, title, description) VALUES ($1, 'R-2', 'Second control', NULL) RETURNING id`, [fw.rows[0]!.id]);
    if (org === seed.orgA.id) { reqA1 = r1.rows[0]!.id; reqA2 = r2.rows[0]!.id; }
  }

  // A HISTORICAL issued engagement in org A with an unversioned scope item —
  // written the way every engagement was before P2.
  const vendorId = await seedVendor(pool, seed.orgA.id, { name: "P3 vendor" });
  const e = await pool.query<{ id: string }>(
    `INSERT INTO vendor_engagements (organization_id, vendor_id, engagement_type, status, issued_at, methodology_version, scope_rule_version)
     VALUES ($1, $2, 'initial', 'issued', NOW(), '1.0.0', '1.0.0') RETURNING id`,
    [seed.orgA.id, vendorId]
  );
  issuedEngagementA = e.rows[0]!.id;
  await pool.query(
    `INSERT INTO vendor_engagement_scope_items (organization_id, engagement_id, requirement_id, depth, mandatory, source, reasons)
     VALUES ($1, $2, $3, 'full', TRUE, 'deterministic', '[]'::jsonb)`,
    [seed.orgA.id, issuedEngagementA, reqA1]
  );

  app = express();
  app.use(enforceJsonContentType);
  app.use(express.json());
  app.use(cookieParser());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
}, 180_000);

afterAll(async () => {
  await pool.end();
});

describe("VA-Q1 P3 · bridgeAllRequirements", () => {
  it("bridges every requirement once, and a second run changes nothing", async () => {
    const first = await withTenant(seed.orgA.id, () => bridgeAllRequirements(pg, seed.orgA.id));
    expect(first.requirements).toBe(2);
    expect(first.bridged).toBe(2);
    expect(first.created_or_reversioned).toBe(2);

    const second = await withTenant(seed.orgA.id, () => bridgeAllRequirements(pg, seed.orgA.id));
    expect(second.created_or_reversioned).toBe(0);
    expect(second.unchanged).toBe(2);

    const versions = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM question_versions WHERE organization_id = $1`, [seed.orgA.id]);
    expect(versions.rows[0]!.n).toBe("2");
  });

  it("NEVER stamps a version onto an already-issued engagement (no fabricated history)", async () => {
    const item = await pool.query<{ question_version_id: string | null }>(
      `SELECT question_version_id FROM vendor_engagement_scope_items WHERE engagement_id = $1`, [issuedEngagementA]
    );
    expect(item.rows[0]!.question_version_id).toBeNull();
    const r = await asA("get", `/api/vendor-engagements/${issuedEngagementA}/integrity`);
    expect(r.body.verdict).toBe("unstamped");
  });

  it("an edited requirement re-versions its bridge on the next run; the old version stays", async () => {
    await pool.query(`UPDATE requirements SET title = 'First control (revised)' WHERE id = $1`, [reqA1]);
    const run = await withTenant(seed.orgA.id, () => bridgeAllRequirements(pg, seed.orgA.id));
    expect(run.created_or_reversioned).toBe(1);
    const vs = await pool.query<{ version: number; prompt: string }>(
      `SELECT v.version, v.prompt FROM question_versions v JOIN question_requirement_links l ON l.question_id = v.question_id
        WHERE l.requirement_id = $1 ORDER BY v.version`, [reqA1]
    );
    expect(vs.rows.map((v) => [v.version, v.prompt])).toEqual([[1, "First control"], [2, "First control (revised)"]]);
  });
});

describe("VA-Q1 P3 · coverage", () => {
  it("reports bridge-only coverage and a 0% curated ratio before any human question exists", async () => {
    const r = await asA("get", "/api/questions/coverage");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.summary).toEqual({ requirements: 2, covered_by_curated: 0, covered_by_bridge_only: 2, uncovered: 0, curated_pct: 0 });
    const row = r.body.requirements.find((x: { requirement_id: string }) => x.requirement_id === reqA2);
    expect(row.bridge_questions).toBe(1);
    expect(row.curated_questions).toBe(0);
  });

  it("a curated, active question linked to a requirement moves that requirement to curated coverage", async () => {
    const q = await asA("post", "/api/questions").send({ question_key: "security.human.written", domain: "security" });
    await asA("post", `/api/questions/${q.body.question.id}/links`).send({ requirement_id: reqA2 });
    const pub = await asA("post", `/api/questions/${q.body.question.id}/versions`).send({ prompt: "Written by a person.", answer_type: "attest", activate: true });
    expect(pub.status).toBe(201);

    const r = await asA("get", "/api/questions/coverage");
    expect(r.body.summary.covered_by_curated).toBe(1);
    expect(r.body.summary.covered_by_bridge_only).toBe(1);
    expect(r.body.summary.curated_pct).toBe(50);
  });

  it("a DRAFT curated question does not count — only active questions evidence anything", async () => {
    const q = await asA("post", "/api/questions").send({ question_key: "security.human.draft", domain: "security" });
    await asA("post", `/api/questions/${q.body.question.id}/links`).send({ requirement_id: reqA1 });
    await asA("post", `/api/questions/${q.body.question.id}/versions`).send({ prompt: "Not yet active.", answer_type: "attest" });
    const r = await asA("get", "/api/questions/coverage");
    expect(r.body.summary.covered_by_curated).toBe(1);
  });

  it("org B's coverage is its own: two requirements, none bridged yet, none curated", async () => {
    const r = await asB("get", "/api/questions/coverage");
    expect(r.body.summary).toEqual({ requirements: 2, covered_by_curated: 0, covered_by_bridge_only: 0, uncovered: 2, curated_pct: 0 });
    expect(r.body.requirements.map((x: { requirement_id: string }) => x.requirement_id)).not.toContain(reqA1);
  });
});
