/**
 * briefingChangesEvidenceRecent.test.ts — runtime cross-org proof for the two
 * EG2 read surfaces that shipped with source-pin tests only (release-review
 * gate B1):
 *
 *   GET /api/briefing/changes   (EG2 slice 10 — "Since Your Last Visit")
 *   GET /api/evidence/recent    (EG2 slice 8 — org-wide evidence inventory)
 *
 * The source-pin suites (briefingChangesRoute.test.ts, evidenceRecentRoute.
 * test.ts) assert that `organization_id = $1` appears in the route source —
 * a tripwire that survives a refactor moving the SQL elsewhere while the
 * literal string still matches. TENANT_ISOLATION_STANDARD requires the
 * runtime proof: seed real cross-org data, drive the REAL routes over real
 * Postgres, and assert the foreign org's rows never surface.
 *
 * Shape mirrors evidenceFileUpload.test.ts (owner-pool seeding + supertest
 * against createApp): the property under test is WHERE-clause org scoping
 * through the full middleware chain, not the app_request role split.
 *
 * Each negative assertion is paired with a positive control on the OWNING
 * org — zeros are only proof of isolation if the same seeds are visible to
 * their owner through the same route.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import request from "supertest";
import type { Express } from "express";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let seed: TestDbSeed;
let pool: Pool;
let app: Express;
let originalBriefingFlag: string | undefined;

/** ISO timestamp 7 days ago — inside the route's 90-day clamp window. */
const SINCE = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

let orgAEvidenceId: string;
let orgBEvidenceIds: string[] = [];

async function seedEvidence(orgId: string, title: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO evidence (organization_id, source_type, source_id, title, evidence_type)
     VALUES ($1, 'control_test', gen_random_uuid(), $2, 'document') RETURNING id`,
    [orgId, title]
  );
  return r.rows[0]!.id;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the briefing/evidence isolation test.");
  pool = new Pool({ connectionString: url, ssl: false });

  // /briefing/changes is dark behind the engine Briefing flag (404 when off) —
  // light it for the isolation proof, restore in afterAll. Read per-request,
  // so no import-order dependency.
  originalBriefingFlag = process.env.SECURELOGIC_DASHBOARD_BRIEFING_ENABLED;
  process.env.SECURELOGIC_DASHBOARD_BRIEFING_ENABLED = "true";

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });

  // ── Org B: one of everything /briefing/changes counts. ────────────────────
  // Active Critical finding created now (inside the window).
  const finding = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, status)
     VALUES ($1, 'org-B critical finding', 'Critical', 'isolation seed', 'manual', 'open')
     RETURNING id`,
    [seed.orgB.id]
  );
  const findingBId = finding.rows[0]!.id;

  // Lifecycle transitions in the window: remediation completed + resolved.
  await pool.query(
    `INSERT INTO finding_lifecycle_events
       (organization_id, finding_id, axis, from_state, to_state, transition)
     VALUES
       ($1, $2, 'operational', 'in_progress', 'remediated', 'operational_remediated'),
       ($1, $2, 'decision', 'needs_review', 'resolved', 'close')`,
    [seed.orgB.id, findingBId]
  );

  // Action that BECAME overdue inside the window (due yesterday, still active).
  await pool.query(
    `INSERT INTO actions (organization_id, title, source_type, source_id, priority, status, due_date)
     VALUES ($1, 'org-B overdue action', 'finding', $2, 'near_term', 'in_progress', CURRENT_DATE - 1)`,
    [seed.orgB.id, findingBId]
  );

  // Brief published inside the window.
  await pool.query(
    `INSERT INTO intelligence_briefs (organization_id, period_start, period_end, status, published_at)
     VALUES ($1, NOW() - INTERVAL '8 days', NOW() - INTERVAL '1 day', 'published', NOW())`,
    [seed.orgB.id]
  );

  // Evidence rows for /evidence/recent.
  orgBEvidenceIds = [
    await seedEvidence(seed.orgB.id, "org-B evidence 1"),
    await seedEvidence(seed.orgB.id, "org-B evidence 2"),
  ];

  // ── Org A: one evidence row and NOTHING else. ─────────────────────────────
  orgAEvidenceId = await seedEvidence(seed.orgA.id, "org-A evidence");
}, 180_000);

afterAll(async () => {
  if (originalBriefingFlag === undefined) delete process.env.SECURELOGIC_DASHBOARD_BRIEFING_ENABLED;
  else process.env.SECURELOGIC_DASHBOARD_BRIEFING_ENABLED = originalBriefingFlag;
  await pool?.end();
});

describe("GET /api/briefing/changes — cross-org isolation (runtime proof)", () => {
  it("positive control: org B sees its own seeded activity through the route", async () => {
    const res = await request(app)
      .get(`/api/briefing/changes?since=${encodeURIComponent(SINCE())}`)
      .set("X-Api-Key", seed.orgB.apiKey);

    expect(res.status).toBe(200);
    expect(res.body.clamped).toBe(false);
    const c = res.body.changes;
    expect(c.new_active_findings).toBeGreaterThanOrEqual(1);
    expect(c.new_critical_high).toBeGreaterThanOrEqual(1);
    expect(c.remediation_completed).toBeGreaterThanOrEqual(1);
    expect(c.resolved).toBeGreaterThanOrEqual(1);
    expect(c.newly_overdue_actions).toBeGreaterThanOrEqual(1);
    expect(c.briefs_published).toBeGreaterThanOrEqual(1);
  });

  it("org A's delta is all zeros despite org B's activity in the same window", async () => {
    const res = await request(app)
      .get(`/api/briefing/changes?since=${encodeURIComponent(SINCE())}`)
      .set("X-Api-Key", seed.orgA.apiKey);

    expect(res.status).toBe(200);
    expect(
      res.body.changes,
      "org B activity leaked into org A's briefing delta — org scoping failed on /briefing/changes"
    ).toEqual({
      new_active_findings: 0,
      new_critical_high: 0,
      remediation_completed: 0,
      resolved: 0,
      newly_overdue_actions: 0,
      briefs_published: 0,
    });
  });
});

describe("GET /api/evidence/recent — cross-org isolation (runtime proof)", () => {
  it("org A sees exactly its own evidence, never org B's", async () => {
    const res = await request(app)
      .get("/api/evidence/recent")
      .set("X-Api-Key", seed.orgA.apiKey);

    expect(res.status).toBe(200);
    expect(res.body.organizationId).toBe(seed.orgA.id);
    const ids = (res.body.evidence as Array<{ id: string }>).map((e) => e.id);
    expect(ids).toContain(orgAEvidenceId);
    for (const foreignId of orgBEvidenceIds) {
      expect(
        ids,
        "org B evidence leaked into org A's /evidence/recent — org scoping failed"
      ).not.toContain(foreignId);
    }
    // Every returned row belongs to org A, and the storage key never surfaces.
    for (const row of res.body.evidence as Array<Record<string, unknown>>) {
      expect(row["organization_id"]).toBe(seed.orgA.id);
      expect(row).not.toHaveProperty("storage_key");
    }
  });

  it("org B sees its own evidence and not org A's (symmetry)", async () => {
    const res = await request(app)
      .get("/api/evidence/recent")
      .set("X-Api-Key", seed.orgB.apiKey);

    expect(res.status).toBe(200);
    expect(res.body.organizationId).toBe(seed.orgB.id);
    const ids = (res.body.evidence as Array<{ id: string }>).map((e) => e.id);
    for (const ownId of orgBEvidenceIds) expect(ids).toContain(ownId);
    expect(ids).not.toContain(orgAEvidenceId);
  });
});

describe("flag posture guard", () => {
  it("/briefing/changes returns 404 while the Briefing flag is off (dark-by-default contract)", async () => {
    const saved = process.env.SECURELOGIC_DASHBOARD_BRIEFING_ENABLED;
    delete process.env.SECURELOGIC_DASHBOARD_BRIEFING_ENABLED;
    try {
      const res = await request(app)
        .get(`/api/briefing/changes?since=${encodeURIComponent(SINCE())}`)
        .set("X-Api-Key", seed.orgA.apiKey);
      expect(res.status).toBe(404);
    } finally {
      process.env.SECURELOGIC_DASHBOARD_BRIEFING_ENABLED = saved;
    }
  });
});
