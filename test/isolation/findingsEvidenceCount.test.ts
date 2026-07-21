/**
 * findingsEvidenceCount.test.ts — the findings list/detail payloads carry
 * `evidence_count` (attached rows with source_type='finding'), org-scoped.
 *
 * Why: Ready-to-Close queue cards state the evidence status before the
 * decision-maker opens the record. The count must be the finding's own
 * evidence — an evidence row in ANOTHER org that happens to reference the same
 * finding id must never inflate it (the subquery is org-scoped exactly like
 * action_count).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, seedFinding, type TestDbSeed } from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let ownerPool: Pool;
let findingA: string;

const INSERT_EVIDENCE = `INSERT INTO evidence
  (organization_id, source_type, source_id, title, evidence_type)
  VALUES ($1, 'finding', $2, $3, 'document')`;

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the evidence-count test.");

  ownerPool = new Pool({ connectionString: url, ssl: false });
  findingA = await seedFinding(ownerPool, seed.orgA.id);

  // Two evidence rows attached to finding A in its own org…
  await ownerPool.query(INSERT_EVIDENCE, [seed.orgA.id, findingA, "Patch report"]);
  await ownerPool.query(INSERT_EVIDENCE, [seed.orgA.id, findingA, "Scan re-run"]);
  // …and one row in org B REFERENCING THE SAME finding id — the cross-tenant
  // poison pill that must never count.
  await ownerPool.query(INSERT_EVIDENCE, [seed.orgB.id, findingA, "Foreign evidence"]);

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 120_000);

afterAll(async () => {
  await ownerPool?.end();
});

describe("findings payloads carry an org-scoped evidence_count", () => {
  it("the list returns the finding's own evidence count — 2, not 3", async () => {
    const res = await request(app)
      .get("/api/findings")
      .set("X-Api-Key", seed.orgA.apiKey);

    expect(res.status).toBe(200);
    const row = (res.body?.findings ?? []).find((f: { id: string }) => f.id === findingA);
    expect(row, "finding A missing from its own org's list").toBeTruthy();
    expect(row.evidence_count).toBe(2);
  });

  it("the single-finding read carries the same count", async () => {
    const res = await request(app)
      .get(`/api/findings/${findingA}`)
      .set("X-Api-Key", seed.orgA.apiKey);

    expect(res.status).toBe(200);
    expect(res.body?.finding?.evidence_count).toBe(2);
  });

  it("a finding with no evidence reports 0, not null", async () => {
    const bare = await seedFinding(ownerPool, seed.orgA.id);
    const res = await request(app)
      .get(`/api/findings/${bare}`)
      .set("X-Api-Key", seed.orgA.apiKey);

    expect(res.status).toBe(200);
    expect(res.body?.finding?.evidence_count).toBe(0);
  });
});
