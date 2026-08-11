/**
 * aggregateTruthContracts.test.ts — PR-A: aggregates must describe the
 * population their label implies (real app, real Postgres).
 *
 * Both surfaces under test used to derive a count by arithmetic over a
 * returned page. A page is capped at MAX_LIMIT (100), so past that cap the
 * number silently stopped being a count and became a description of the cap —
 * indistinguishable from a real answer to anyone reading it.
 *
 * The seeds here deliberately exceed 100 rows. That is the entire point: an
 * assertion that passes on 20 vendors proves nothing about the defect, because
 * capped-list arithmetic is CORRECT below the cap. Every exactness test below
 * is built so that a page-derived implementation cannot pass it.
 *
 * The invariant under test, stated once:
 *   - an aggregate covers the whole matching population, never the slice;
 *   - paging changes the slice and must never change the aggregate;
 *   - a filter changes the list and the aggregate identically;
 *   - a rejected filter never widens scope;
 *   - a genuine zero is an answer, shaped like any other answer.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;

const get = (path: string, key: string) => request(app).get(path).set("X-Api-Key", key);

/** Deliberately over the 100-row page cap, so a slice-derived count cannot pass. */
const VENDOR_SEED = {
  critical: 30,
  high: 25,
  medium: 20,
  low: 15,
  uncategorized: 15, // NULL criticality
} as const;
const VENDOR_ACTIVE_TOTAL = 105;

/** Archived vendors — the status filter must move list and aggregate together. */
const ARCHIVED_CRITICAL = 4;
const ARCHIVED_LOW = 3;
const VENDOR_ARCHIVED_TOTAL = ARCHIVED_CRITICAL + ARCHIVED_LOW;

/** Also over the cap: 130 open actions cannot be counted from a 100-row page. */
const OPEN_ACTIONS = 130;

async function seedVendor(orgId: string, name: string, criticality: string | null, status: string) {
  await pool.query(
    `INSERT INTO vendors (organization_id, name, criticality, status)
     VALUES ($1, $2, $3, $4)`,
    [orgId, name, criticality, status]
  );
}

async function seedAction(opts: {
  orgId: string;
  status: string;
  priority?: string;
  dueDate?: string | null;
  title?: string;
}) {
  await pool.query(
    `INSERT INTO actions (organization_id, title, source_type, priority, status, due_date)
     VALUES ($1, $2, 'manual', $3, $4, $5)`,
    [
      opts.orgId,
      opts.title ?? "aggregate-contract seed",
      opts.priority ?? "planned",
      opts.status,
      opts.dueDate ?? null,
    ]
  );
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the aggregate contract test.");
  pool = new Pool({ connectionString: url, ssl: false });

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });

  // ── Vendors, org A: 105 active (over the cap) + 7 archived ──
  let n = 0;
  for (const [band, count] of Object.entries(VENDOR_SEED)) {
    const criticality = band === "uncategorized" ? null : band;
    for (let i = 0; i < count; i++) {
      await seedVendor(seed.orgA.id, `vendor-${band}-${i}-${n++}`, criticality, "active");
    }
  }
  for (let i = 0; i < ARCHIVED_CRITICAL; i++) {
    await seedVendor(seed.orgA.id, `archived-critical-${i}`, "critical", "archived");
  }
  for (let i = 0; i < ARCHIVED_LOW; i++) {
    await seedVendor(seed.orgA.id, `archived-low-${i}`, "low", "archived");
  }

  // ── Actions, org A ──
  // 130 open (over the cap), 40 of them overdue.
  for (let i = 0; i < OPEN_ACTIONS; i++) {
    await seedAction({
      orgId: seed.orgA.id,
      status: "open",
      priority: i % 3 === 0 ? "immediate" : i % 3 === 1 ? "near_term" : "planned",
      dueDate: i < 40 ? "2020-01-01" : null,
      title: `open action ${i}`,
    });
  }
  // A spread of the other statuses, including terminal rows with a past due
  // date: a closed action is NOT overdue (sqlActionOverdue requires ACTIVE),
  // and these rows exist to catch an implementation that forgets that.
  await seedAction({ orgId: seed.orgA.id, status: "in_progress", dueDate: "2020-01-01" });
  await seedAction({ orgId: seed.orgA.id, status: "in_progress" });
  await seedAction({ orgId: seed.orgA.id, status: "blocked", dueDate: "2020-01-01" });
  await seedAction({ orgId: seed.orgA.id, status: "closed", dueDate: "2020-01-01" });
  await seedAction({ orgId: seed.orgA.id, status: "accepted", dueDate: "2020-01-01" });
  // Due exactly TODAY — overdue nowhere (DATE vs CURRENT_DATE).
  const today = (await pool.query<{ d: string }>(`SELECT CURRENT_DATE::text AS d`)).rows[0].d;
  await seedAction({ orgId: seed.orgA.id, status: "open", dueDate: today, title: "due today" });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

/* ═══════════════════════════════ VENDORS ═══════════════════════════════ */

describe("GET /api/vendors — aggregates describe the population, not the page", () => {
  it("returns an exact total for >100 vendors while the page stays capped", async () => {
    const res = await get("/api/vendors?limit=100", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    // The slice is capped...
    expect(res.body.vendors).toHaveLength(100);
    expect(res.body.count).toBe(100);
    // ...the total is not. A page-derived count could only ever say 100.
    expect(res.body.total).toBe(VENDOR_ACTIVE_TOTAL);
  });

  it("by_criticality counts records that never appear in the returned page", async () => {
    // Default limit is 25, so 80 of the 105 active vendors are outside the slice.
    const res = await get("/api/vendors", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    expect(res.body.vendors.length).toBeLessThan(VENDOR_ACTIVE_TOTAL);
    expect(res.body.by_criticality).toEqual({
      critical: VENDOR_SEED.critical,
      high: VENDOR_SEED.high,
      medium: VENDOR_SEED.medium,
      low: VENDOR_SEED.low,
      uncategorized: VENDOR_SEED.uncategorized,
    });
    // The ordering is criticality-first, so the 25-row page is ALL critical —
    // a slice-derived breakdown would report high/medium/low as zero.
    const bands = new Set(res.body.vendors.map((v: { criticality: string | null }) => v.criticality));
    expect(bands).toEqual(new Set(["critical"]));
  });

  it("the parts always sum to the total", async () => {
    const res = await get("/api/vendors", seed.orgA.apiKey);
    const b = res.body.by_criticality;
    expect(b.critical + b.high + b.medium + b.low + b.uncategorized).toBe(res.body.total);
  });

  it("paging changes the slice and leaves the aggregates untouched", async () => {
    const page1 = await get("/api/vendors?limit=10", seed.orgA.apiKey);
    expect(page1.status).toBe(200);
    const cursor = page1.body.nextCursor;
    expect(cursor).not.toBeNull();

    const page2 = await get(
      `/api/vendors?limit=10&before_created_at=${encodeURIComponent(cursor.created_at)}&before_id=${cursor.id}`,
      seed.orgA.apiKey
    );
    expect(page2.status).toBe(200);

    // Different rows...
    const ids1 = page1.body.vendors.map((v: { id: string }) => v.id);
    const ids2 = page2.body.vendors.map((v: { id: string }) => v.id);
    expect(ids1.some((id: string) => ids2.includes(id))).toBe(false);

    // ...identical aggregates. Asserted against the seeded truth, not just
    // against each other: `expect(page2.total).toBe(page1.total)` alone also
    // holds when BOTH are undefined, which is exactly the pre-change response.
    // An invariance test that passes on a missing field proves nothing.
    expect(page1.body.total).toBe(VENDOR_ACTIVE_TOTAL);
    expect(page2.body.total).toBe(VENDOR_ACTIVE_TOTAL);
    expect(page2.body.by_criticality).toEqual(page1.body.by_criticality);
    expect(page2.body.by_criticality.critical).toBe(VENDOR_SEED.critical);
  });

  it("a status filter moves the list and the aggregates identically", async () => {
    const res = await get("/api/vendors?status=archived&limit=100", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(VENDOR_ARCHIVED_TOTAL);
    expect(res.body.vendors).toHaveLength(VENDOR_ARCHIVED_TOTAL);
    expect(res.body.by_criticality).toEqual({
      critical: ARCHIVED_CRITICAL,
      high: 0,
      medium: 0,
      low: ARCHIVED_LOW,
      uncategorized: 0,
    });
    // The aggregate describes the SAME population the list returned.
    expect(res.body.total).toBe(res.body.count);
  });

  it("a criticality filter narrows the aggregate to that same population", async () => {
    // The contract: aggregates mirror the list's filter set. A caller wanting
    // the full breakdown omits the filter (which is what the vendors page does).
    const res = await get("/api/vendors?criticality=high&limit=100", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(VENDOR_SEED.high);
    expect(res.body.by_criticality).toEqual({
      critical: 0,
      high: VENDOR_SEED.high,
      medium: 0,
      low: 0,
      uncategorized: 0,
    });
  });

  it("tenant isolation: org B sees none of org A's vendors", async () => {
    const res = await get("/api/vendors?limit=100", seed.orgB.apiKey);
    expect(res.status).toBe(200);
    expect(res.body.vendors).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it("a true zero is an answer: every band present and 0, never undefined", async () => {
    const res = await get("/api/vendors?limit=100", seed.orgB.apiKey);
    expect(res.body.total).toBe(0);
    expect(res.body.by_criticality).toEqual({
      critical: 0, high: 0, medium: 0, low: 0, uncategorized: 0,
    });
    for (const v of Object.values(res.body.by_criticality)) {
      expect(typeof v).toBe("number");
    }
  });

  it("a search that matches nothing returns zeroed aggregates, not missing keys", async () => {
    const res = await get("/api/vendors?q=no-such-vendor-anywhere", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    expect(res.body.vendors).toHaveLength(0);
    expect(res.body.total).toBe(0);
    expect(res.body.by_criticality).toEqual({
      critical: 0, high: 0, medium: 0, low: 0, uncategorized: 0,
    });
  });

  it("preserves the pre-existing response fields", async () => {
    const res = await get("/api/vendors", seed.orgA.apiKey);
    expect(res.body).toMatchObject({
      count: expect.any(Number),
      limit: expect.any(Number),
      organizationId: seed.orgA.id,
      statusFilter: "active",
    });
    expect(Array.isArray(res.body.vendors)).toBe(true);
    expect(res.body).toHaveProperty("nextCursor");
  });
});

/* ═══════════════════════════════ ACTIONS ═══════════════════════════════ */

describe("GET /api/actions/summary — filter-scoped counts that match the list", () => {
  it("Open is exact past the page cap (a 100-row page cannot produce it)", async () => {
    const sum = await get("/api/actions/summary?status=open", seed.orgA.apiKey);
    expect(sum.status).toBe(200);
    // 130 seeded open + 1 due-today open.
    expect(sum.body.summary.open_only_count).toBe(OPEN_ACTIONS + 1);
    expect(sum.body.summary.open_only_count).toBeGreaterThan(100);

    // And it agrees with the list's own exact total for the same filter.
    const list = await get("/api/actions?status=open&limit=1", seed.orgA.apiKey);
    expect(list.body.actions).toHaveLength(1);
    expect(list.body.total).toBe(sum.body.summary.open_only_count);
  });

  it("Overdue is exact and excludes terminal rows with a past due date", async () => {
    const sum = await get("/api/actions/summary", seed.orgA.apiKey);
    // 40 overdue open + 1 in_progress + 1 blocked = 42 ACTIVE overdue.
    // The closed and accepted rows are also past due and must NOT count.
    expect(sum.body.summary.overdue_count).toBe(42);

    const list = await get("/api/actions?overdue=true&limit=1", seed.orgA.apiKey);
    expect(list.body.total).toBe(42);
  });

  it("summary counts reconcile with the list total under the SAME filter", async () => {
    for (const qs of ["", "?status=open", "?status=blocked", "?overdue=true", "?active=true", "?priority=immediate"]) {
      const [list, sum] = await Promise.all([
        get(`/api/actions${qs}${qs ? "&" : "?"}limit=1`, seed.orgA.apiKey),
        get(`/api/actions/summary${qs}`, seed.orgA.apiKey),
      ]);
      expect(list.status).toBe(200);
      expect(sum.status).toBe(200);

      // open_count is the ACTIVE population (open|in_progress|blocked) of the
      // filtered set; where the filter already restricts to active rows, the
      // list total must equal it exactly.
      if (qs === "?status=open" || qs === "?status=blocked" || qs === "?overdue=true" || qs === "?active=true") {
        expect(sum.body.summary.open_count).toBe(list.body.total);
      }
    }
  });

  it("changing a filter changes the summary consistently", async () => {
    const all = await get("/api/actions/summary", seed.orgA.apiKey);
    const open = await get("/api/actions/summary?status=open", seed.orgA.apiKey);
    const blocked = await get("/api/actions/summary?status=blocked", seed.orgA.apiKey);

    // Filtering to one status zeroes the sibling parts — the population moved.
    expect(open.body.summary.in_progress_count).toBe(0);
    expect(open.body.summary.blocked_count).toBe(0);
    expect(blocked.body.summary.open_only_count).toBe(0);
    expect(blocked.body.summary.blocked_count).toBe(1);

    // And the parts of the unfiltered call still add up to its own active total.
    const s = all.body.summary;
    expect(s.open_only_count + s.in_progress_count + s.blocked_count).toBe(s.open_count);
  });

  it("pagination params cannot move the summary", async () => {
    const plain = await get("/api/actions/summary?status=open", seed.orgA.apiKey);
    const paged = await get(
      "/api/actions/summary?status=open&limit=1&before_created_at=2020-01-01T00:00:00Z&before_id=00000000-0000-0000-0000-000000000000",
      seed.orgA.apiKey
    );
    expect(paged.status).toBe(200);
    expect(paged.body.summary).toEqual(plain.body.summary);
  });

  it("an unfiltered call is unchanged for existing consumers", async () => {
    const sum = await get("/api/actions/summary", seed.orgA.apiKey);
    expect(sum.status).toBe(200);
    // Whole-org populations, exactly as before this change.
    expect(sum.body.summary.open_only_count).toBe(OPEN_ACTIONS + 1);
    expect(sum.body.summary.in_progress_count).toBe(2);
    expect(sum.body.summary.blocked_count).toBe(1);
    expect(sum.body.summary.closed_count).toBe(1);
    expect(sum.body.summary.open_count).toBe(OPEN_ACTIONS + 1 + 2 + 1);
  });

  it("tenant isolation: org B's summary sees none of org A's actions", async () => {
    const sum = await get("/api/actions/summary", seed.orgB.apiKey);
    expect(sum.status).toBe(200);
    expect(sum.body.summary.open_count).toBe(0);
    expect(sum.body.summary.overdue_count).toBe(0);
  });

  it("an empty population returns a true zero, not a missing field", async () => {
    const sum = await get("/api/actions/summary?status=accepted", seed.orgB.apiKey);
    expect(sum.status).toBe(200);
    for (const key of [
      "open_count", "open_only_count", "in_progress_count",
      "blocked_count", "overdue_count", "immediate_count", "closed_count",
    ]) {
      expect(sum.body.summary[key]).toBe(0);
      expect(typeof sum.body.summary[key]).toBe("number");
    }
  });

  it("an invalid filter is REJECTED, never silently widened to the whole org", async () => {
    const bad = await get("/api/actions/summary?status=not_a_status", seed.orgA.apiKey);
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("invalid_status_filter");
    expect(bad.body.allowed).toContain("open");
    // The failure mode that matters: it must not answer with org-wide counts.
    expect(bad.body.summary).toBeUndefined();

    const badPriority = await get("/api/actions/summary?priority=urgent", seed.orgA.apiKey);
    expect(badPriority.status).toBe(400);
    expect(badPriority.body.error).toBe("invalid_priority_filter");

    const badUuid = await get("/api/actions/summary?source_id=not-a-uuid", seed.orgA.apiKey);
    expect(badUuid.status).toBe(400);
    expect(badUuid.body.error).toBe("source_id_must_be_uuid");
  });

  it("owner=me from an API key is rejected on BOTH routes, never defaulted to org-wide", async () => {
    const sum = await get("/api/actions/summary?owner=me", seed.orgA.apiKey);
    const list = await get("/api/actions?owner=me", seed.orgA.apiKey);
    expect(sum.status).toBe(400);
    expect(list.status).toBe(400);
    expect(sum.body.error).toBe("owner_me_requires_user_identity");
    expect(sum.body.error).toBe(list.body.error);
    expect(sum.body.summary).toBeUndefined();
  });

  it("the list rejects exactly what the summary rejects (one filter definition)", async () => {
    for (const qs of ["status=nope", "priority=nope", "source_id=nope", "owner=someone"]) {
      const [list, sum] = await Promise.all([
        get(`/api/actions?${qs}`, seed.orgA.apiKey),
        get(`/api/actions/summary?${qs}`, seed.orgA.apiKey),
      ]);
      expect(sum.status).toBe(list.status);
      expect(sum.body.error).toBe(list.body.error);
    }
  });
});
