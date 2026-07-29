/**
 * resourceHistory.test.ts — real-Postgres proof for the shared per-object
 * audit-trail reader (src/api/lib/resourceHistory.ts) behind the
 * /:id/history endpoints on risks, vendors, controls, obligations, and
 * AI systems.
 *
 * Proves, against the real schema:
 *   - root + satellite events are returned newest-first with a stable
 *     (created_at DESC, id DESC) order and actor enrichment;
 *   - total_count is the whole matched set, not the page length, and
 *     limit/offset paginate without drift;
 *   - org isolation: an identical resource_id logged under another org
 *     never appears (org scope), and a satellite of a DIFFERENT parent in
 *     the same org never appears (parent scope);
 *   - every register spec resolves its satellite tables/columns against
 *     the live schema (the query executes for all five specs).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import {
  AI_SYSTEM_HISTORY_SPEC,
  CONTROL_HISTORY_SPEC,
  FINDING_HISTORY_SPEC,
  OBLIGATION_HISTORY_SPEC,
  RISK_HISTORY_SPEC,
  VENDOR_HISTORY_SPEC,
  fetchResourceHistory,
} from "../../src/api/lib/resourceHistory.js";

let seed: TestDbSeed;
let pool: Pool;

async function seedUser(orgId: string, email: string, name: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO users (organization_id, email, name) VALUES ($1, $2, $3) RETURNING id`,
    [orgId, email, name]
  );
  return r.rows[0]!.id;
}

async function seedVendor(orgId: string, name: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO vendors (organization_id, name) VALUES ($1, $2) RETURNING id`,
    [orgId, name]
  );
  return r.rows[0]!.id;
}

async function seedVendorReview(orgId: string, vendorId: string): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO vendor_reviews (organization_id, vendor_id) VALUES ($1, $2) RETURNING id`,
    [orgId, vendorId]
  );
  return r.rows[0]!.id;
}

async function seedAudit(opts: {
  orgId: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  actorUserId?: string | null;
  createdAt: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO security_audit_log
       (organization_id, actor_user_id, event_type, resource_type, resource_id, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6)`,
    [
      opts.orgId,
      opts.actorUserId ?? null,
      opts.eventType,
      opts.resourceType,
      opts.resourceId,
      opts.createdAt,
    ]
  );
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the resource-history test.");
  pool = new Pool({ connectionString: url, ssl: false });
});

afterAll(async () => {
  await pool?.end();
});

describe("fetchResourceHistory — vendor register", () => {
  let orgA: string;
  let orgB: string;
  let actor: string;
  let vendorA: string;
  let vendorA2: string;
  let vendorB: string;
  let reviewA: string;
  let reviewA2: string;

  beforeAll(async () => {
    orgA = seed.orgA.id;
    orgB = seed.orgB.id;
    actor = await seedUser(orgA, "history-actor@a.example", "History Actor");
    vendorA = await seedVendor(orgA, "Vendor A");
    vendorA2 = await seedVendor(orgA, "Vendor A2");
    vendorB = await seedVendor(orgB, "Vendor B");
    reviewA = await seedVendorReview(orgA, vendorA);
    reviewA2 = await seedVendorReview(orgA, vendorA2);

    // Root events, spaced timestamps for deterministic ordering.
    await seedAudit({ orgId: orgA, eventType: "vendor.created", resourceType: "vendor", resourceId: vendorA, actorUserId: actor, createdAt: "2026-07-01T10:00:00Z" });
    await seedAudit({ orgId: orgA, eventType: "vendor.updated", resourceType: "vendor", resourceId: vendorA, actorUserId: actor, createdAt: "2026-07-02T10:00:00Z" });
    // Satellite event on vendorA's review.
    await seedAudit({ orgId: orgA, eventType: "vendor_review.created", resourceType: "vendor_review", resourceId: reviewA, actorUserId: actor, createdAt: "2026-07-03T10:00:00Z" });
    // Parent-scope decoy: a review of a DIFFERENT orgA vendor.
    await seedAudit({ orgId: orgA, eventType: "vendor_review.created", resourceType: "vendor_review", resourceId: reviewA2, createdAt: "2026-07-04T10:00:00Z" });
    // Org-scope decoy: the SAME resource_id logged under orgB.
    await seedAudit({ orgId: orgB, eventType: "vendor.updated", resourceType: "vendor", resourceId: vendorA, createdAt: "2026-07-05T10:00:00Z" });
    // Unrelated orgB traffic.
    await seedAudit({ orgId: orgB, eventType: "vendor.created", resourceType: "vendor", resourceId: vendorB, createdAt: "2026-07-05T11:00:00Z" });
  });

  it("returns root + satellite events newest-first with actor enrichment", async () => {
    const page = await fetchResourceHistory(VENDOR_HISTORY_SPEC, orgA, vendorA, 20, 0);
    expect(page.total_count).toBe(3);
    expect(page.events.map((e) => e.event_type)).toEqual([
      "vendor_review.created",
      "vendor.updated",
      "vendor.created",
    ]);
    expect(page.events[0]!.actor_name).toBe("History Actor");
    expect(page.events[0]!.actor_email).toBe("history-actor@a.example");
  });

  it("excludes same-org satellites of a different parent (parent scope)", async () => {
    const page = await fetchResourceHistory(VENDOR_HISTORY_SPEC, orgA, vendorA, 20, 0);
    expect(page.events.every((e) => e.resource_id !== reviewA2)).toBe(true);
  });

  it("excludes the same resource_id logged under another org (org scope)", async () => {
    // orgB's log has a row with resource_id = vendorA; orgA's view of
    // vendorA must not include it (2026-07-05 would sort first if leaked)
    const page = await fetchResourceHistory(VENDOR_HISTORY_SPEC, orgA, vendorA, 20, 0);
    expect(page.events.every((e) => e.created_at < new Date("2026-07-05T00:00:00Z"))).toBe(true);

    // And orgB looking at ITS copy of the id sees only its own row.
    const pageB = await fetchResourceHistory(VENDOR_HISTORY_SPEC, orgB, vendorA, 20, 0);
    expect(pageB.total_count).toBe(1);
    expect(pageB.events[0]!.event_type).toBe("vendor.updated");
  });

  it("paginates with a stable total_count", async () => {
    const p1 = await fetchResourceHistory(VENDOR_HISTORY_SPEC, orgA, vendorA, 2, 0);
    const p2 = await fetchResourceHistory(VENDOR_HISTORY_SPEC, orgA, vendorA, 2, 2);
    expect(p1.total_count).toBe(3);
    expect(p2.total_count).toBe(3);
    expect(p1.events).toHaveLength(2);
    expect(p2.events).toHaveLength(1);
    const ids = [...p1.events, ...p2.events].map((e) => e.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("fetchResourceHistory — ai_system register (two satellite tables)", () => {
  let orgA: string;
  let orgB: string;
  let systemA: string;
  let assessmentA: string;

  beforeAll(async () => {
    orgA = seed.orgA.id;
    orgB = seed.orgB.id;
    const sysR = await pool.query<{ id: string }>(
      `INSERT INTO ai_systems (organization_id, name) VALUES ($1, 'History System') RETURNING id`,
      [orgA]
    );
    systemA = sysR.rows[0]!.id;
    const asmR = await pool.query<{ id: string }>(
      `INSERT INTO ai_governance_assessments (organization_id, ai_system_id) VALUES ($1, $2) RETURNING id`,
      [orgA, systemA]
    );
    assessmentA = asmR.rows[0]!.id;
    const revR = await pool.query<{ id: string }>(
      `INSERT INTO governance_reviews (organization_id, ai_system_id, review_type) VALUES ($1, $2, 'initial') RETURNING id`,
      [orgA, systemA]
    );
    const reviewA = revR.rows[0]!.id;

    await seedAudit({ orgId: orgA, eventType: "ai_system.created", resourceType: "ai_system", resourceId: systemA, createdAt: "2026-07-10T10:00:00Z" });
    await seedAudit({ orgId: orgA, eventType: "governance_review.created", resourceType: "governance_review", resourceId: reviewA, createdAt: "2026-07-11T10:00:00Z" });
    await seedAudit({ orgId: orgA, eventType: "ai_governance_assessment.created", resourceType: "ai_governance_assessment", resourceId: assessmentA, createdAt: "2026-07-12T10:00:00Z" });
    // Org-scope decoy: same assessment id logged under orgB.
    await seedAudit({ orgId: orgB, eventType: "ai_governance_assessment.updated", resourceType: "ai_governance_assessment", resourceId: assessmentA, createdAt: "2026-07-13T10:00:00Z" });
  });

  it("merges events from both satellite tables with the root, newest first", async () => {
    const page = await fetchResourceHistory(AI_SYSTEM_HISTORY_SPEC, orgA, systemA, 20, 0);
    expect(page.total_count).toBe(3);
    expect(page.events.map((e) => e.event_type)).toEqual([
      "ai_governance_assessment.created",
      "governance_review.created",
      "ai_system.created",
    ]);
  });

  it("org-scope decoy on the assessment id does not leak in", async () => {
    const page = await fetchResourceHistory(AI_SYSTEM_HISTORY_SPEC, orgA, systemA, 20, 0);
    expect(page.events.every((e) => e.event_type !== "ai_governance_assessment.updated")).toBe(true);
  });
});

describe("fetchResourceHistory — finding register (polymorphic action satellite)", () => {
  let orgA: string;
  let findingA: string;

  beforeAll(async () => {
    orgA = seed.orgA.id;
    const fR = await pool.query<{ id: string }>(
      `INSERT INTO findings (organization_id, title, severity, description, source_type)
       VALUES ($1, 'History Finding', 'high', 'seeded for history', 'manual') RETURNING id`,
      [orgA]
    );
    findingA = fR.rows[0]!.id;

    // Action genuinely spawned by this finding.
    const aR = await pool.query<{ id: string }>(
      `INSERT INTO actions (organization_id, title, source_type, source_id, priority)
       VALUES ($1, 'Remediate', 'finding', $2, 'immediate') RETURNING id`,
      [orgA, findingA]
    );
    const actionFromFinding = aR.rows[0]!.id;

    // Polymorphism decoy: an action whose source_id equals the finding id
    // but whose source_type is 'signal' — must NOT appear in the trail.
    const dR = await pool.query<{ id: string }>(
      `INSERT INTO actions (organization_id, title, source_type, source_id, priority)
       VALUES ($1, 'Signal action decoy', 'signal', $2, 'planned') RETURNING id`,
      [orgA, findingA]
    );
    const decoyAction = dR.rows[0]!.id;

    await seedAudit({ orgId: orgA, eventType: "finding.created", resourceType: "finding", resourceId: findingA, createdAt: "2026-07-10T10:00:00Z" });
    await seedAudit({ orgId: orgA, eventType: "action.created", resourceType: "action", resourceId: actionFromFinding, createdAt: "2026-07-11T10:00:00Z" });
    await seedAudit({ orgId: orgA, eventType: "action.created", resourceType: "action", resourceId: decoyAction, createdAt: "2026-07-12T10:00:00Z" });
  });

  it("includes the finding's own events and its spawned action's events", async () => {
    const page = await fetchResourceHistory(FINDING_HISTORY_SPEC, orgA, findingA, 20, 0);
    expect(page.total_count).toBe(2);
    expect(page.events.map((e) => e.event_type)).toEqual([
      "action.created",
      "finding.created",
    ]);
  });

  it("source_type decoy: a signal-sourced action sharing the id does not leak in", async () => {
    const page = await fetchResourceHistory(FINDING_HISTORY_SPEC, orgA, findingA, 20, 0);
    // Only ONE action event (the finding-sourced one) — the decoy's
    // audit row exists but its action fails the source_type pin.
    const actionEvents = page.events.filter((e) => e.resource_type === "action");
    expect(actionEvents).toHaveLength(1);
  });
});

describe("fetchResourceHistory — all register specs execute against the live schema", () => {
  it("risk / finding / control / obligation / ai_system specs run clean on an empty target", async () => {
    // Nonexistent-but-valid UUID: routes 404 before ever calling the
    // reader, but the reader itself must still execute (this is the
    // guard that every satellite table/FK in the specs exists).
    const ghost = "00000000-0000-4000-8000-000000000000";
    for (const spec of [RISK_HISTORY_SPEC, FINDING_HISTORY_SPEC, CONTROL_HISTORY_SPEC, OBLIGATION_HISTORY_SPEC, AI_SYSTEM_HISTORY_SPEC]) {
      const page = await fetchResourceHistory(spec, seed.orgA.id, ghost, 5, 0);
      expect(page.total_count).toBe(0);
      expect(page.events).toEqual([]);
    }
  });
});
