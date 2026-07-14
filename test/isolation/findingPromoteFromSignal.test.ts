/**
 * findingPromoteFromSignal.test.ts — POST /api/findings/from-signal, the Brief → Finding hop.
 *
 * Findings from intelligence used to be minted ONLY by the ingestion worker, and only for
 * signals matching a vendor or AI system already in the org's registry. Every other signal
 * could be read in the Brief and acted on nowhere: the Decision Workspace, risk acceptance,
 * remediation and closure all sat behind an input the customer had no way to produce.
 *
 * Proves, over the REAL app and a REAL Postgres:
 *   1. a GLOBAL signal (organization_id IS NULL — the fan-out model) promotes to a canonical
 *      Finding in the caller's org, shaped by the shared signal→finding rules;
 *   2. promotion is IDEMPOTENT per (org, signal): a second call returns the SAME finding,
 *      created:false — a double-click must not leave two findings for one signal;
 *   3. it reconciles with the Brief: the promoted finding is exactly what ?intel_ref= then
 *      resolves, so the Brief flips from "Create finding" to "Open the Decision Workspace";
 *   4. an existing finding for the signal is ADOPTED, not duplicated — including one the
 *      ingestion worker already created;
 *   5. tenant isolation: org B cannot promote org A's PRIVATE signal (404, not a leak of its
 *      summary through the finding it would have created);
 *   6. org A's promotion is invisible to org B — promoting the same global signal in two orgs
 *      yields two independent findings, neither visible to the other;
 *   7. a bad signal id → 400; an unknown one → 404 (never a silent no-op).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, seedCyberSignal, type TestDbSeed } from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;

const promote = (key: string, signalId: unknown) =>
  request(app)
    .post("/api/findings/from-signal")
    .set("X-Api-Key", key)
    .send({ signal_id: signalId });

const byIntelRef = (key: string, ref: string) =>
  request(app).get(`/api/findings?intel_ref=${encodeURIComponent(ref)}`).set("X-Api-Key", key);

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the promote test.");
  pool = new Pool({ connectionString: url, ssl: false });
  // The route is dark behind the Decision Workspace flag, like the chain it feeds.
  process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED = "true";
  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

async function findingsForSignal(orgId: string, signalId: string): Promise<string[]> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM findings
      WHERE organization_id = $1 AND source_type = 'cyber_signal' AND source_id = $2::uuid`,
    [orgId, signalId]
  );
  return r.rows.map((row) => row.id);
}

describe("POST /api/findings/from-signal — Brief → Finding promotion", () => {
  it("promotes a GLOBAL signal into a canonical Finding in the caller's org", async () => {
    const signalId = await seedCyberSignal(pool, {
      orgId: null, // global: ingested once, readable by every org
      dedup: "promote-global-1",
      signalType: "cve",
      severity: "Critical",
      cve: "CVE-2026-1234",
      summary: "Critical RCE in a widely deployed reverse proxy",
    });

    const res = await promote(seed.orgA.apiKey, signalId);

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(res.body.finding.source_type).toBe("cyber_signal");
    expect(res.body.finding.source_id).toBe(signalId);
    expect(res.body.finding.severity).toBe("Critical");
    // Shaped by the SHARED signal→finding rules (signalFindingShape), not a second,
    // slightly-different wording invented in the route.
    expect(res.body.finding.title).toBe("CVE-2026-1234 — requires assessment");
    expect(res.body.finding.domain).toBe("Vulnerability");
    // The signal's summary becomes the finding's description — the reader keeps the
    // intelligence they were looking at.
    expect(res.body.finding.description).toBe("Critical RCE in a widely deployed reverse proxy");
    // It lands as live work, not pre-closed.
    expect(res.body.finding.status).toBe("open");
  });

  it("is IDEMPOTENT — a second promotion returns the SAME finding, not a duplicate", async () => {
    const signalId = await seedCyberSignal(pool, {
      orgId: null,
      dedup: "promote-idem-1",
      signalType: "advisory",
      severity: "High",
    });

    const first = await promote(seed.orgA.apiKey, signalId);
    const second = await promote(seed.orgA.apiKey, signalId);

    expect(first.status).toBe(201);
    expect(first.body.created).toBe(true);

    // A double-click (or a second tab) must land in the SAME workspace, not mint a rival
    // finding for the same intelligence.
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(second.body.finding.id).toBe(first.body.finding.id);

    expect(await findingsForSignal(seed.orgA.id, signalId)).toHaveLength(1);
  });

  it("reconciles with the Brief — the promoted finding is what ?intel_ref= then resolves", async () => {
    const signalId = await seedCyberSignal(pool, {
      orgId: null,
      dedup: "promote-reconcile-1",
      severity: "Moderate",
    });

    // Before: the Brief item finds nothing, so it offers "Create a finding".
    const before = await byIntelRef(seed.orgA.apiKey, signalId);
    expect(before.body.findings).toHaveLength(0);

    const promoted = await promote(seed.orgA.apiKey, signalId);

    // After: the SAME lookup the Brief uses now resolves the finding, so the affordance
    // flips to "Open the Decision Workspace". If these two disagreed, the Brief would go on
    // offering to create a finding that already exists.
    const after = await byIntelRef(seed.orgA.apiKey, signalId);
    expect(after.body.findings.map((f: { id: string }) => f.id)).toEqual([
      promoted.body.finding.id,
    ]);
  });

  it("ADOPTS a finding the ingestion worker already created — it never makes a rival", async () => {
    const signalId = await seedCyberSignal(pool, {
      orgId: null,
      dedup: "promote-adopt-1",
      severity: "High",
    });
    // Stand in for the automated path, which creates the finding when the signal matches a
    // registered entity. A reader who clicks "Create finding" anyway must be handed THAT one.
    const existing = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, title, severity, description, source_type, source_id)
       VALUES ($1, 'Worker-created finding', 'High', 'seeded', 'cyber_signal', $2::uuid)
       RETURNING id`,
      [seed.orgA.id, signalId]
    );

    const res = await promote(seed.orgA.apiKey, signalId);

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect(res.body.finding.id).toBe(existing.rows[0].id);
    expect(await findingsForSignal(seed.orgA.id, signalId)).toHaveLength(1);
  });

  it("org B CANNOT promote org A's private signal", async () => {
    const privateSignal = await seedCyberSignal(pool, {
      orgId: seed.orgA.id, // org-scoped, NOT global
      dedup: "promote-private-a",
      severity: "Critical",
      summary: "Org A's confidential incident detail",
    });

    const res = await promote(seed.orgB.apiKey, privateSignal);

    // 404, not 403: org B must not even learn the signal exists. And nothing may be
    // written — a finding would have copied org A's summary into org B's tenant.
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("signal_not_found");
    expect(await findingsForSignal(seed.orgB.id, privateSignal)).toHaveLength(0);
  });

  it("two orgs promoting the same GLOBAL signal get independent, invisible-to-each-other findings", async () => {
    const signalId = await seedCyberSignal(pool, {
      orgId: null,
      dedup: "promote-shared-global-1",
      severity: "High",
    });

    const a = await promote(seed.orgA.apiKey, signalId);
    const b = await promote(seed.orgB.apiKey, signalId);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    // The per-(org,signal) idempotency key must not collapse two TENANTS into one finding.
    expect(a.body.finding.id).not.toBe(b.body.finding.id);

    // Each org sees only its own.
    const aSees = await byIntelRef(seed.orgA.apiKey, signalId);
    const bSees = await byIntelRef(seed.orgB.apiKey, signalId);
    expect(aSees.body.findings.map((f: { id: string }) => f.id)).toEqual([a.body.finding.id]);
    expect(bSees.body.findings.map((f: { id: string }) => f.id)).toEqual([b.body.finding.id]);
  });

  it("rejects a malformed signal id, and 404s an unknown one — never a silent no-op", async () => {
    const bad = await promote(seed.orgA.apiKey, "not-a-uuid");
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("signal_id_must_be_uuid");

    const missing = await promote(seed.orgA.apiKey, "11111111-1111-4111-8111-111111111111");
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("signal_not_found");
  });
});
