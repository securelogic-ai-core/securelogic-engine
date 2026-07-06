/**
 * briefApplicabilityCitations.test.ts — EAR P11: the Brief ↔ applicability
 * citation is double-fenced dark, fail-open on error, and shapes the
 * signal → current-decisions map correctly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgElevated: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  withTenant: vi.fn(),
  requireTenantContext: vi.fn()
}));

import { pg } from "../infra/postgres.js";
import {
  briefApplicabilityCitationsEnabled,
  fetchApplicabilityCitations
} from "../lib/briefApplicabilityCitations.js";

const q = pg.query as unknown as ReturnType<typeof vi.fn>;

const CITATION_FLAG = "SECURELOGIC_BRIEF_APPLICABILITY_CITATION_ENABLED";
const ECL_FLAG = "SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED";
const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SIG_1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SIG_2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

let saved: Record<string, string | undefined>;
beforeEach(() => {
  q.mockReset();
  saved = { c: process.env[CITATION_FLAG], e: process.env[ECL_FLAG] };
});
afterEach(() => {
  if (saved.c === undefined) delete process.env[CITATION_FLAG];
  else process.env[CITATION_FLAG] = saved.c;
  if (saved.e === undefined) delete process.env[ECL_FLAG];
  else process.env[ECL_FLAG] = saved.e;
});

function armFlags(citation: string | null, ecl: string | null): void {
  if (citation === null) delete process.env[CITATION_FLAG];
  else process.env[CITATION_FLAG] = citation;
  if (ecl === null) delete process.env[ECL_FLAG];
  else process.env[ECL_FLAG] = ecl;
}

describe("double-fenced flag", () => {
  it("requires BOTH flags === 'true'", () => {
    for (const [c, e, want] of [
      [null, null, false],
      ["true", null, false],
      [null, "true", false],
      ["true", "false", false],
      ["false", "true", false],
      ["true", "true", true]
    ] as const) {
      armFlags(c, e);
      expect(briefApplicabilityCitationsEnabled(), `${c}/${e}`).toBe(want);
    }
  });

  it("dark → {} with ZERO DB access (byte-identical Brief response)", async () => {
    armFlags(null, null);
    expect(await fetchApplicabilityCitations(ORG, [SIG_1])).toEqual({});
    expect(q).not.toHaveBeenCalled();
  });
});

describe("fetchApplicabilityCitations — flag on", () => {
  beforeEach(() => armFlags("true", "true"));

  it("empty/null signal ids short-circuit without DB access", async () => {
    expect(await fetchApplicabilityCitations(ORG, [])).toEqual({});
    expect(await fetchApplicabilityCitations(ORG, [null, null])).toEqual({});
    expect(q).not.toHaveBeenCalled();
  });

  it("groups current decisions by signal and dedupes input ids", async () => {
    q.mockResolvedValueOnce({
      rows: [
        {
          id: "a1", signal_id: SIG_1, target_type: "vendor", target_id: "v1",
          decision: "affected", confidence_band: "high", created_at: "2026-07-01T00:00:00Z"
        },
        {
          id: "a2", signal_id: SIG_1, target_type: "control", target_id: "c1",
          decision: "not_affected", confidence_band: null, created_at: "2026-07-02T00:00:00Z"
        },
        {
          id: "a3", signal_id: SIG_2, target_type: "ai_system", target_id: "s1",
          decision: "potentially_affected", confidence_band: "medium", created_at: "2026-07-03T00:00:00Z"
        }
      ],
      rowCount: 3
    });

    const map = await fetchApplicabilityCitations(ORG, [SIG_1, SIG_1, SIG_2, null]);
    expect(q).toHaveBeenCalledTimes(1);
    expect(q.mock.calls[0]![1]).toEqual([ORG, [SIG_1, SIG_2]]); // deduped, null-stripped
    expect(Object.keys(map).sort()).toEqual([SIG_1, SIG_2].sort());
    expect(map[SIG_1]).toHaveLength(2);
    expect(map[SIG_1]![0]).toEqual({
      assessment_id: "a1",
      target_type: "vendor",
      target_id: "v1",
      decision: "affected",
      confidence_band: "high",
      decided_at: "2026-07-01T00:00:00Z"
    });
    expect(map[SIG_2]![0]!.decision).toBe("potentially_affected");
  });

  it("fails OPEN: a lookup error returns {} (the Brief must still serve)", async () => {
    q.mockRejectedValueOnce(new Error("db down"));
    expect(await fetchApplicabilityCitations(ORG, [SIG_1])).toEqual({});
  });

  it("the query selects CURRENT decisions via DISTINCT ON … seq DESC, org-scoped", async () => {
    q.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await fetchApplicabilityCitations(ORG, [SIG_1]);
    const sql = String(q.mock.calls[0]![0]);
    expect(sql).toContain("DISTINCT ON (signal_id, target_type, target_id)");
    expect(sql).toContain("seq DESC");
    expect(sql).toContain("organization_id = $1");
  });
});
