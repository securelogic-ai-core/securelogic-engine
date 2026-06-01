/**
 * vendorAssuranceCuecMatcher.test.ts — unit tests for the LLM CUEC matcher.
 *
 * Pure functions (normalizeCuecList, buildCuecMatcherPrompt,
 * validateCuecMatcherResponse) are tested directly. runCuecMatcherForDocument
 * and syncCuecRowsForDocument are tested with mocked pg and an injected llmCall
 * so the matcher's DB behaviour (delete-suggested-then-insert, ON CONFLICT
 * skip, threshold filter, no_cuecs / no_controls / llm_unavailable /
 * invalid_response branches) is deterministic without a real database or LLM.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { pgQuerySpy, clientQuerySpy, clientReleaseSpy } = vi.hoisted(() => ({
  pgQuerySpy: vi.fn(),
  clientQuerySpy: vi.fn(),
  clientReleaseSpy: vi.fn()
}));

vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: pgQuerySpy,
    connect: vi.fn().mockResolvedValue({ query: clientQuerySpy, release: clientReleaseSpy })
  },
  // Split-phase RLS wrap (C3-3): transparent passthrough in unit context so the
  // wrapped reads/writes run against the mocked pg exactly as before.
  withTenant: (_orgId: string, fn: () => Promise<unknown>) => fn()
}));

import {
  normalizeCuecList,
  buildCuecMatcherPrompt,
  validateCuecMatcherResponse,
  runCuecMatcherForDocument,
  syncCuecRowsForDocument,
  MATCH_SCORE_MIN_THRESHOLD,
  type CuecMatcherLlmResult
} from "../lib/vendorAssuranceCuecMatcher.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const DOC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  pgQuerySpy.mockReset();
  clientQuerySpy.mockReset();
  clientReleaseSpy.mockReset();
});

// ---------------------------------------------------------------------------
// normalizeCuecList
// ---------------------------------------------------------------------------

describe("normalizeCuecList", () => {
  it("trims, drops empties, re-indexes 0..n-1, drops non-strings", () => {
    expect(normalizeCuecList(["  a ", "", "  b", 5, null, "c"])).toEqual([
      { ordinal: 0, text: "a" },
      { ordinal: 1, text: "b" },
      { ordinal: 2, text: "c" }
    ]);
  });
  it("non-array / null → []", () => {
    expect(normalizeCuecList("nope")).toEqual([]);
    expect(normalizeCuecList(null)).toEqual([]);
    expect(normalizeCuecList(undefined)).toEqual([]);
    expect(normalizeCuecList([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildCuecMatcherPrompt
// ---------------------------------------------------------------------------

describe("buildCuecMatcherPrompt", () => {
  it("includes cuec ordinals, control ids, and a JSON-only instruction", () => {
    const p = buildCuecMatcherPrompt({
      cuecs: [
        { id: "c0", ordinal: 0, cuec_text: "Restrict physical access to facilities" },
        { id: "c1", ordinal: 1, cuec_text: "Review access logs monthly" }
      ],
      controls: [
        { id: "ctl-a", name: "Physical Access Control", description: "Badge entry, visitor logs" },
        { id: "ctl-b", name: "Log Review", description: null }
      ]
    });
    expect(p).toContain("[cuec 0]");
    expect(p).toContain("[cuec 1]");
    expect(p).toContain("[control ctl-a]");
    expect(p).toContain("[control ctl-b]");
    expect(p).toContain("Physical Access Control");
    expect(p).toMatch(/valid JSON only/i);
    expect(p).toContain('"matches"');
  });
});

// ---------------------------------------------------------------------------
// validateCuecMatcherResponse
// ---------------------------------------------------------------------------

describe("validateCuecMatcherResponse", () => {
  const ords = new Set([0, 1]);
  const ctls = new Set(["ctl-a", "ctl-b"]); // lowercased

  it("keeps valid entries, drops bad ordinals / controls / scores, de-dups pairs", () => {
    const raw = {
      matches: [
        { cuec_ordinal: 0, control_id: "CTL-A", score: 91.4, reasoning: "good" }, // uppercased control id → matched + lowercased
        { cuec_ordinal: 1, control_id: "ctl-b", score: 60, reasoning: "ok" },
        { cuec_ordinal: 0, control_id: "ctl-a", score: 80 }, // duplicate pair → dropped
        { cuec_ordinal: 5, control_id: "ctl-a", score: 70 }, // unknown ordinal → dropped
        { cuec_ordinal: 1, control_id: "ctl-zzz", score: 70 }, // unknown control → dropped
        { cuec_ordinal: 0, control_id: "ctl-b", score: "high" }, // bad score → dropped
        "junk" // non-object → dropped
      ]
    };
    const r = validateCuecMatcherResponse(raw, ords, ctls);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.matches).toEqual([
        { cuec_ordinal: 0, control_id: "ctl-a", score: 91, reasoning: "good" },
        { cuec_ordinal: 1, control_id: "ctl-b", score: 60, reasoning: "ok" }
      ]);
      expect(r.droppedCount).toBe(5);
    }
  });

  it("clamps score to 0..100", () => {
    const r = validateCuecMatcherResponse({ matches: [{ cuec_ordinal: 0, control_id: "ctl-a", score: 250 }] }, ords, ctls);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.matches[0]?.score).toBe(100);
  });

  it("rejects non-object / non-array-matches shapes", () => {
    expect(validateCuecMatcherResponse("nope", ords, ctls)).toEqual({ ok: false, error: "response_not_object" });
    expect(validateCuecMatcherResponse({ matches: "x" }, ords, ctls)).toEqual({ ok: false, error: "matches_not_array" });
  });

  it("empty matches array → ok with no matches", () => {
    const r = validateCuecMatcherResponse({ matches: [] }, ords, ctls);
    expect(r).toEqual({ ok: true, matches: [], droppedCount: 0 });
  });
});

// ---------------------------------------------------------------------------
// runCuecMatcherForDocument
// ---------------------------------------------------------------------------

function llm(text: string): () => Promise<CuecMatcherLlmResult> {
  return vi.fn().mockResolvedValue({ ok: true, text });
}

describe("runCuecMatcherForDocument", () => {
  it("no cuec rows → reason 'no_cuecs', LLM never called", async () => {
    pgQuerySpy.mockResolvedValueOnce({ rows: [] }); // cuecs
    const llmCall = vi.fn();
    const r = await runCuecMatcherForDocument(DOC, ORG, { llmCall });
    expect(r).toMatchObject({ matched: false, reason: "no_cuecs", cuecCount: 0, suggestionsWritten: 0 });
    expect(llmCall).not.toHaveBeenCalled();
  });

  it("no active controls → clears stale suggestions, reason 'no_controls', LLM never called", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rows: [{ id: "cuec-0", ordinal: 0, cuec_text: "x" }] }) // cuecs
      .mockResolvedValueOnce({ rows: [] }) // controls
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // DELETE stale suggested
    const llmCall = vi.fn();
    const r = await runCuecMatcherForDocument(DOC, ORG, { llmCall });
    expect(r).toMatchObject({ matched: false, reason: "no_controls", controlCount: 0 });
    expect(llmCall).not.toHaveBeenCalled();
    const delSql = pgQuerySpy.mock.calls[2]?.[0] as string;
    expect(delSql).toMatch(/DELETE FROM vendor_assurance_cuec_control_mappings/);
    expect(delSql).toMatch(/mapping_status = 'suggested'/);
  });

  it("llm unavailable → reason 'llm_unavailable', no mapping writes", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rows: [{ id: "cuec-0", ordinal: 0, cuec_text: "x" }] })
      .mockResolvedValueOnce({ rows: [{ id: "ctl-a", name: "A", description: null }] });
    const llmCall = vi.fn().mockResolvedValue({ ok: false, code: "llm_unavailable", detail: "no key" });
    const r = await runCuecMatcherForDocument(DOC, ORG, { llmCall });
    expect(r).toMatchObject({ matched: false, reason: "llm_unavailable" });
    expect(clientQuerySpy).not.toHaveBeenCalled(); // no transaction
    expect(pgQuerySpy).toHaveBeenCalledTimes(2); // cuecs + controls only
  });

  it("unparseable LLM text → reason 'invalid_response', no mapping writes", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rows: [{ id: "cuec-0", ordinal: 0, cuec_text: "x" }] })
      .mockResolvedValueOnce({ rows: [{ id: "ctl-a", name: "A", description: null }] });
    const llmCall = llm("this is not json");
    const r = await runCuecMatcherForDocument(DOC, ORG, { llmCall });
    expect(r).toMatchObject({ matched: false, reason: "invalid_response" });
    expect(clientQuerySpy).not.toHaveBeenCalled();
  });

  it("happy path: filters below threshold, drops invalid entries, deletes 'suggested' then inserts 'auto' suggestions", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rows: [
        { id: "cuec-0", ordinal: 0, cuec_text: "Restrict physical access" },
        { id: "cuec-1", ordinal: 1, cuec_text: "Review logs" }
      ] })
      .mockResolvedValueOnce({ rows: [
        { id: "ctl-a", name: "Physical Access", description: "badges" },
        { id: "ctl-b", name: "Log Review", description: "siem" }
      ] });
    clientQuerySpy
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 2, rows: [] }) // DELETE suggested
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "m-1" }] }) // INSERT (0, ctl-a)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "m-2" }] }) // INSERT (1, ctl-b)
      .mockResolvedValueOnce({}); // COMMIT
    const llmCall = llm(JSON.stringify({ matches: [
      { cuec_ordinal: 0, control_id: "ctl-a", score: 92, reasoning: "physical access" },
      { cuec_ordinal: 1, control_id: "ctl-b", score: 70, reasoning: "log review" },
      { cuec_ordinal: 0, control_id: "ctl-b", score: 30, reasoning: "below threshold" }, // dropped: < MIN
      { cuec_ordinal: 9, control_id: "ctl-a", score: 80, reasoning: "bad ordinal" } // dropped: unknown ordinal
    ] }));

    const r = await runCuecMatcherForDocument(DOC, ORG, { llmCall });
    expect(r).toMatchObject({ matched: true, cuecCount: 2, controlCount: 2, suggestionsConsidered: 2, suggestionsWritten: 2 });
    expect(MATCH_SCORE_MIN_THRESHOLD).toBe(60);

    const deleteCall = clientQuerySpy.mock.calls[1]?.[0] as string;
    expect(deleteCall).toMatch(/DELETE FROM vendor_assurance_cuec_control_mappings/);
    expect(deleteCall).toMatch(/mapping_status = 'suggested'/);

    const insert1Sql = clientQuerySpy.mock.calls[2]?.[0] as string;
    const insert1Params = clientQuerySpy.mock.calls[2]?.[1] as unknown[];
    expect(insert1Sql).toMatch(/INSERT INTO vendor_assurance_cuec_control_mappings/);
    expect(insert1Sql).toMatch(/'suggested', \$4, 'auto'/);
    expect(insert1Sql).toMatch(/ON CONFLICT \(cuec_id, control_id\) DO NOTHING/);
    expect(insert1Params[0]).toBe(ORG);
    expect(insert1Params[1]).toBe("cuec-0");
    expect(insert1Params[2]).toBe("ctl-a");
    expect(insert1Params[3]).toBe(92);
    const insert2Params = clientQuerySpy.mock.calls[3]?.[1] as unknown[];
    expect(insert2Params[1]).toBe("cuec-1");
    expect(insert2Params[2]).toBe("ctl-b");
    expect(insert2Params[3]).toBe(70);
  });

  it("ON CONFLICT skip: a pair that already exists (accepted/dismissed) is not re-suggested", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rows: [{ id: "cuec-0", ordinal: 0, cuec_text: "x" }] })
      .mockResolvedValueOnce({ rows: [{ id: "ctl-a", name: "A", description: null }, { id: "ctl-b", name: "B", description: null }] });
    clientQuerySpy
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // DELETE suggested
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // INSERT (0, ctl-a) — conflict, DO NOTHING
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "m-2" }] }) // INSERT (0, ctl-b) — fresh
      .mockResolvedValueOnce({}); // COMMIT
    const llmCall = llm(JSON.stringify({ matches: [
      { cuec_ordinal: 0, control_id: "ctl-a", score: 88, reasoning: "previously dismissed pair" },
      { cuec_ordinal: 0, control_id: "ctl-b", score: 75, reasoning: "fresh" }
    ] }));
    const r = await runCuecMatcherForDocument(DOC, ORG, { llmCall });
    expect(r).toMatchObject({ matched: true, suggestionsConsidered: 2, suggestionsWritten: 1 });
  });
});

// ---------------------------------------------------------------------------
// syncCuecRowsForDocument
// ---------------------------------------------------------------------------

describe("syncCuecRowsForDocument", () => {
  it("uses the extraction value when no cuecs override exists; DELETE-then-INSERT, ordinals 0..n-1, trimmed", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // no cuecs override
      .mockResolvedValueOnce({ rows: [{ fields: { cuecs: { value: ["  CUEC one ", "CUEC two", "", "CUEC three"] } } }] }); // extraction
    clientQuerySpy
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // DELETE
      .mockResolvedValueOnce({}) // INSERT (bulk)
      .mockResolvedValueOnce({}); // COMMIT
    const r = await syncCuecRowsForDocument(DOC, ORG);
    expect(r).toEqual({ cuecCount: 3 });

    const deleteSql = clientQuerySpy.mock.calls[1]?.[0] as string;
    expect(deleteSql).toMatch(/DELETE FROM vendor_assurance_cuecs WHERE document_id = \$1 AND organization_id = \$2/);
    const insertSql = clientQuerySpy.mock.calls[2]?.[0] as string;
    const insertParams = clientQuerySpy.mock.calls[2]?.[1] as unknown[];
    expect(insertSql).toMatch(/INSERT INTO vendor_assurance_cuecs/);
    // 3 rows × 4 params each
    expect(insertParams).toHaveLength(12);
    expect(insertParams.slice(0, 4)).toEqual([ORG, DOC, 0, "CUEC one"]);
    expect(insertParams.slice(4, 8)).toEqual([ORG, DOC, 1, "CUEC two"]);
    expect(insertParams.slice(8, 12)).toEqual([ORG, DOC, 2, "CUEC three"]);
  });

  it("uses the latest cuecs field-override value when one exists; does NOT read the extraction", async () => {
    pgQuerySpy.mockResolvedValueOnce({ rowCount: 1, rows: [{ override_value: ["Override A", "Override B"] }] }); // cuecs override
    clientQuerySpy
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // DELETE
      .mockResolvedValueOnce({}) // INSERT
      .mockResolvedValueOnce({}); // COMMIT
    const r = await syncCuecRowsForDocument(DOC, ORG);
    expect(r).toEqual({ cuecCount: 2 });
    expect(pgQuerySpy).toHaveBeenCalledTimes(1); // only the override lookup; no extraction SELECT
  });

  it("empty / absent cuecs → deletes existing rows, inserts nothing", async () => {
    pgQuerySpy
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // no override
      .mockResolvedValueOnce({ rows: [{ fields: { cuecs: { value: null } } }] }); // extraction with null cuecs
    clientQuerySpy
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({}) // DELETE
      .mockResolvedValueOnce({}); // COMMIT
    const r = await syncCuecRowsForDocument(DOC, ORG);
    expect(r).toEqual({ cuecCount: 0 });
    // only BEGIN, DELETE, COMMIT — no INSERT
    expect(clientQuerySpy).toHaveBeenCalledTimes(3);
  });
});
