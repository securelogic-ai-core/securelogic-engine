/**
 * suggestionSurfacedTelemetry.test.ts — the minimum telemetry that makes the
 * deferred Candidate C decision measurable later.
 *
 * The gap this closes: today a suggestion nobody valued and a suggestion nobody
 * ever SAW are indistinguishable — both are a row with NULL accepted_at. Those
 * are opposite conclusions, and one of them would wrongly justify cutting the
 * feature. `first_surfaced_at` separates them.
 *
 * Pinned here:
 *   DEFINITION  — only rows actually returned in a response body are surfaced;
 *                 generation, DB insert and aggregate endpoints are not.
 *   DEDUP       — repeats inside the coalesce window update nothing; the first
 *                 ever surfacing always records.
 *   ISOLATION   — the write is org-predicated and runs on the tenant client.
 *   NON-FATAL   — a telemetry failure cannot fail the request, and crucially
 *                 cannot poison the request transaction (savepoint proof).
 *   MINIMALITY  — no content, no prompts, no model output, no user id.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgElevated: { query: vi.fn() },
  withTenant: vi.fn(async (_o: string, fn: () => Promise<unknown>) => fn()),
  requireTenantContext: vi.fn(() => ({ orgId: "org" }))
}));
vi.mock("../infra/tenantContext.js", () => ({
  createSavepointClient: vi.fn(() => savepointClient)
}));

import { logger } from "../infra/logger.js";
import { requireTenantContext } from "../infra/postgres.js";
import { createSavepointClient } from "../infra/tenantContext.js";
import {
  recordSuggestionsSurfaced,
  SURFACE_COALESCE_WINDOW_MS
} from "../lib/suggestionSurfacedTelemetry.js";

const ORG_A = "0a000000-0000-4000-8000-00000000000a";
const ORG_B = "0b000000-0000-4000-8000-00000000000b";
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

/** Records every statement the recorder issues, so tx control is assertable. */
let statements: Array<{ sql: string; params?: unknown[] }> = [];
let updateResult: { rows: unknown[]; rowCount: number } | Error = { rows: [], rowCount: 1 };

const savepointClient = {
  query: vi.fn(async (sql: string, params?: unknown[]) => {
    statements.push({ sql, params });
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(sql)) return { rows: [], rowCount: 0 };
    if (updateResult instanceof Error) throw updateResult;
    return updateResult;
  })
};

const sqlOf = () => statements.map((s) => s.sql.trim().split(/\s+/)[0]!.toUpperCase());
const updateStmt = () => statements.find((s) => /UPDATE signal_match_suggestions/i.test(s.sql));
const events = (name: string) =>
  [...vi.mocked(logger.info).mock.calls, ...vi.mocked(logger.warn).mock.calls]
    .map((c) => c[0] as { event?: string })
    .filter((o) => o?.event === name);

beforeEach(() => {
  vi.clearAllMocks();
  statements = [];
  updateResult = { rows: [{ id: S1 }], rowCount: 1 };
  vi.mocked(requireTenantContext).mockReturnValue({ orgId: ORG_A } as never);
  vi.mocked(createSavepointClient).mockReturnValue(savepointClient as never);
  vi.mocked(logger.info).mockImplementation((() => {}) as never);
  vi.mocked(logger.warn).mockImplementation((() => {}) as never);
});

// ---------------------------------------------------------------------------

describe("definition of surfaced", () => {
  it("records the ids actually returned, scoped to the org", async () => {
    await recordSuggestionsSurfaced(ORG_A, [S1, S2], "suggestions_list");

    const u = updateStmt()!;
    expect(u.sql).toContain("UPDATE signal_match_suggestions");
    // Org predicate is explicit, on top of RLS.
    expect(u.sql).toContain("organization_id = $1");
    expect(u.params![0]).toBe(ORG_A);
    expect(u.params![1]).toEqual([S1, S2]);
    expect(u.params![3]).toBe("suggestions_list");
  });

  it("an empty result set surfaces nothing and touches no database", async () => {
    // A list call that returns zero rows delivered nothing. Endpoint invocation
    // is explicitly NOT surfacing.
    const n = await recordSuggestionsSurfaced(ORG_A, [], "suggestions_list");

    expect(n).toBe(0);
    expect(savepointClient.query).not.toHaveBeenCalled();
  });

  it("sets first_surfaced_at once and never overwrites it", async () => {
    await recordSuggestionsSurfaced(ORG_A, [S1], "suggestions_list");
    // COALESCE keeps the original value on every later surfacing — the column
    // answers "was it ever shown", so it must be immutable after the first.
    expect(updateStmt()!.sql).toContain("first_surfaced_at     = COALESCE(first_surfaced_at, $3)");
  });
});

describe("deduplication semantics", () => {
  it("suppresses a repeat inside the coalesce window via the WHERE clause", async () => {
    const now = new Date("2026-08-18T12:00:00Z");
    await recordSuggestionsSurfaced(ORG_A, [S1], "suggestions_list", now);

    const u = updateStmt()!;
    // Only rows never surfaced, or last surfaced before the window, are updated.
    expect(u.sql).toContain("last_surfaced_at IS NULL OR last_surfaced_at <= $5");
    expect(u.params![4]).toEqual(new Date(now.getTime() - SURFACE_COALESCE_WINDOW_MS));
  });

  it("reports how many rows the coalescing rule counted, not how many were returned", async () => {
    // Three ids returned; Postgres updated one — the other two were re-renders.
    updateResult = { rows: [{ id: S1 }], rowCount: 1 };
    const counted = await recordSuggestionsSurfaced(ORG_A, [S1, S2, S1], "suggestions_list");

    expect(counted).toBe(1);
    const ev = events("suggestion_surfaced")[0] as Record<string, unknown>;
    expect(ev).toMatchObject({ suggestions_returned: 3, suggestions_counted: 1 });
  });

  it("emits nothing when every id was a suppressed re-render", async () => {
    updateResult = { rows: [], rowCount: 0 };
    const counted = await recordSuggestionsSurfaced(ORG_A, [S1, S2], "suggestions_list");

    expect(counted).toBe(0);
    // No event: a re-render is not a surfacing, and logging it would be the
    // inflation this design exists to avoid.
    expect(events("suggestion_surfaced")).toHaveLength(0);
  });

  it("the window is 30 minutes — a documented product rule, asserted not assumed", () => {
    expect(SURFACE_COALESCE_WINDOW_MS).toBe(30 * 60 * 1000);
  });
});

describe("tenant isolation", () => {
  it("writes through the request-scoped tenant client, never an elevated pool", async () => {
    await recordSuggestionsSurfaced(ORG_A, [S1], "suggestions_list");

    // The savepoint client is derived from the ambient tenant context, so RLS
    // applies exactly as it does to the read that produced these ids.
    expect(vi.mocked(createSavepointClient)).toHaveBeenCalledTimes(1);
    const { pgElevated } = await import("../infra/postgres.js");
    expect(vi.mocked(pgElevated.query)).not.toHaveBeenCalled();
  });

  it("a colliding id from another org cannot be written: the org predicate binds", async () => {
    await recordSuggestionsSurfaced(ORG_B, [S1], "suggestions_list");

    // Same suggestion id, different org — the statement is bound to ORG_B, so
    // even an id collision cannot reach ORG_A's row (and RLS blocks it too).
    expect(updateStmt()!.params![0]).toBe(ORG_B);
    expect(updateStmt()!.sql).toContain("organization_id = $1");
  });

  it("outside a tenant scope it declines to write rather than escalating", async () => {
    vi.mocked(createSavepointClient).mockImplementation(() => {
      throw new Error("no tenant context");
    });

    const n = await recordSuggestionsSurfaced(ORG_A, [S1], "suggestions_list");

    expect(n).toBe(0);
    expect(events("suggestion_surfaced_no_tenant_scope")).toHaveLength(1);
  });
});

describe("failure is never load-bearing", () => {
  it("a write failure resolves quietly instead of throwing at the request", async () => {
    updateResult = new Error("column missing");

    await expect(
      recordSuggestionsSurfaced(ORG_A, [S1], "suggestions_list")
    ).resolves.toBe(0);
    expect(events("suggestion_surfaced_write_failed")).toHaveLength(1);
  });

  it("a write failure ROLLS BACK to the savepoint, keeping the request tx committable", async () => {
    updateResult = new Error("column missing");

    await recordSuggestionsSurfaced(ORG_A, [S1], "suggestions_list");

    // This is the point of the savepoint. asTenant runs the whole request in
    // one transaction and buffers the response until COMMIT succeeds; a
    // poisoned transaction would mean the user never receives the suggestions
    // they asked for. Catching the JS error alone would NOT prevent that.
    expect(sqlOf()).toEqual(["BEGIN", "UPDATE", "ROLLBACK"]);
  });

  it("the happy path releases the savepoint rather than leaving it open", async () => {
    await recordSuggestionsSurfaced(ORG_A, [S1], "suggestions_list");
    expect(sqlOf()).toEqual(["BEGIN", "UPDATE", "COMMIT"]);
  });
});

describe("data minimality", () => {
  it("writes ids, timestamps and a surface key — no content, no user identity", async () => {
    await recordSuggestionsSurfaced(ORG_A, [S1], "suggestions_list");

    const u = updateStmt()!;
    // No content columns are touched...
    for (const forbidden of ["reasoning", "match_reason", "normalized_summary", "description", "prompt", "response"]) {
      expect(u.sql).not.toContain(forbidden);
    }
    // ...and no user/session identity is recorded.
    expect(u.sql).not.toMatch(/user_id|session/);
    expect(u.params).toEqual([ORG_A, [S1], expect.any(Date), "suggestions_list", expect.any(Date)]);
  });

  it("the logged event carries counts and a surface key, never suggestion content", async () => {
    await recordSuggestionsSurfaced(ORG_A, [S1, S2], "suggestions_list");

    const ev = events("suggestion_surfaced")[0] as Record<string, unknown>;
    expect(Object.keys(ev).sort()).toEqual(
      ["event", "organization_id", "suggestions_counted", "suggestions_returned", "surface"].sort()
    );
  });
});

describe("the surfacing path is the only one wired", () => {
  it("the list route records; /counts and the stats rollup do not", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const route = readFileSync(path.resolve(here, "../routes/signalMatchSuggestions.ts"), "utf8");
    const stats = readFileSync(path.resolve(here, "../routes/enterpriseContextStats.ts"), "utf8");

    // Exactly ONE call site, in the handler that returns suggestion rows.
    expect(route.match(/recordSuggestionsSurfaced\(/g)).toHaveLength(1);
    // It sits before the response is written, on the returned rows.
    const callIdx = route.indexOf("await recordSuggestionsSurfaced(");
    const jsonIdx = route.indexOf("suggestions: result.rows");
    expect(callIdx).toBeGreaterThan(0);
    expect(jsonIdx).toBeGreaterThan(callIdx);

    // Aggregate-only surfaces deliver no suggestion, so they must not record.
    expect(stats).not.toContain("recordSuggestionsSurfaced");
  });
});
