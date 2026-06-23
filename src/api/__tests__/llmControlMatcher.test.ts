import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockQuery, mockWithTenant } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockWithTenant: vi.fn(async (_org: string, fn: () => Promise<unknown>) => fn())
}));

vi.mock("../infra/postgres.js", () => ({ pg: { query: mockQuery }, withTenant: mockWithTenant }));
vi.mock("../infra/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../infra/providerQuotaAlert.js", () => ({ instrumentAnthropicClient: (c: unknown) => c }));

import {
  buildControlMatcherPrompt,
  validateControlMatcherResponse,
  shouldRunControlMatcher,
  llmControlMatcherEnabled,
  stripJsonFences,
  runLlmControlMatcherForSignal,
  CONTROL_MATCH_MIN_SCORE,
  type LlmCallResult,
  type SignalForControlMatch
} from "../lib/llmControlMatcher.js";

const FLAG = "SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED";
const CTRL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CTRL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const sig = (over: Partial<SignalForControlMatch> = {}): SignalForControlMatch => ({
  id: "33333333-3333-4333-8333-333333333333",
  signal_type: "cve",
  severity: "Critical",
  normalized_summary: "Critical RCE in OpenSSL affecting TLS termination",
  ...over
});

beforeEach(() => { mockQuery.mockReset(); mockWithTenant.mockClear(); });
afterEach(() => { delete process.env[FLAG]; });

// --- pure: flag + gate -----------------------------------------------------

describe("llmControlMatcherEnabled / shouldRunControlMatcher", () => {
  it("flag off by default", () => {
    expect(llmControlMatcherEnabled({})).toBe(false);
    expect(shouldRunControlMatcher(sig(), {})).toBe(false);
  });
  it("gate requires flag + relevant type + Critical/High severity", () => {
    const env = { [FLAG]: "true" };
    expect(shouldRunControlMatcher(sig(), env)).toBe(true);
    expect(shouldRunControlMatcher(sig({ signal_type: "regulatory_change" }), env)).toBe(false); // wrong type
    expect(shouldRunControlMatcher(sig({ severity: "Low" }), env)).toBe(false);                   // low severity
    expect(shouldRunControlMatcher(sig(), {})).toBe(false);                                       // flag off
  });
});

// --- pure: prompt ----------------------------------------------------------

describe("buildControlMatcherPrompt", () => {
  it("includes the signal summary and every control id (verbatim)", () => {
    const p = buildControlMatcherPrompt({
      signal: sig(),
      controls: [
        { id: CTRL_A, name: "Patch Management", description: "Apply security patches" },
        { id: CTRL_B, name: "Access Control", description: null }
      ]
    });
    expect(p).toContain("OpenSSL");
    expect(p).toContain(CTRL_A);
    expect(p).toContain(CTRL_B);
    expect(p).toContain("JSON");
  });
});

// --- pure: validator -------------------------------------------------------

describe("validateControlMatcherResponse", () => {
  const known = new Set([CTRL_A, CTRL_B]);
  it("keeps valid matches, clamps score, lowercases id", () => {
    const r = validateControlMatcherResponse({ matches: [{ control_id: CTRL_A.toUpperCase(), score: 142, reasoning: "x" }] }, known);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.matches[0]!.control_id).toBe(CTRL_A); expect(r.matches[0]!.score).toBe(100); }
  });
  it("drops hallucinated ids, bad scores, and dedups", () => {
    const r = validateControlMatcherResponse({ matches: [
      { control_id: "99999999-9999-4999-8999-999999999999", score: 80 }, // not in known → drop
      { control_id: CTRL_A, score: "high" },                              // bad score → drop
      { control_id: CTRL_B, score: 70 },
      { control_id: CTRL_B, score: 65 }                                   // dup → drop
    ] }, known);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.matches).toHaveLength(1); expect(r.matches[0]!.control_id).toBe(CTRL_B); expect(r.droppedCount).toBe(3); }
  });
  it("rejects non-object / missing matches array", () => {
    expect(validateControlMatcherResponse(null, known).ok).toBe(false);
    expect(validateControlMatcherResponse({ matches: "x" }, known).ok).toBe(false);
  });
  it("stripJsonFences removes code fences", () => {
    expect(stripJsonFences('```json\n{"matches":[]}\n```')).toBe('{"matches":[]}');
  });
});

// --- runner (mocked pg + injected LLM) -------------------------------------

describe("runLlmControlMatcherForSignal", () => {
  const okCall = (text: string) => async (): Promise<LlmCallResult> => ({ ok: true, text });

  it("gated OFF → 0 writes, no LLM call, no query", async () => {
    const llm = vi.fn();
    const n = await runLlmControlMatcherForSignal(sig(), "org-1", llm as never);
    expect(n).toBe(0);
    expect(llm).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("flag ON + valid response → writes control suggestions (>= threshold, capped)", async () => {
    process.env[FLAG] = "true";
    mockQuery
      .mockResolvedValueOnce({ rows: [ { id: CTRL_A, name: "Patch Mgmt", description: "d" }, { id: CTRL_B, name: "Access", description: null } ] }) // controls SELECT
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "s1" }] });  // one suggestion INSERT (the below-threshold one is filtered out)
    const resp = JSON.stringify({ matches: [
      { control_id: CTRL_A, score: 90, reasoning: "patch the CVE" },
      { control_id: CTRL_B, score: CONTROL_MATCH_MIN_SCORE - 10, reasoning: "weak" } // below threshold → not written
    ] });

    const written = await runLlmControlMatcherForSignal(sig(), "org-1", okCall(resp));
    expect(written).toBe(1);
    // suggestion INSERT used target_type 'control' + reason 'control_llm_match'
    const insertCall = mockQuery.mock.calls.find((c) => /INSERT INTO signal_match_suggestions/.test(c[0] as string));
    expect(insertCall![0]).toContain("'control'");
    expect(insertCall![0]).toContain("control_llm_match");
    expect((insertCall![1] as unknown[])[2]).toBe(CTRL_A);   // target_id = the high-score control
  });

  it("invalid JSON → 0 writes (no INSERT)", async () => {
    process.env[FLAG] = "true";
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CTRL_A, name: "x", description: null }] });
    const n = await runLlmControlMatcherForSignal(sig(), "org-1", okCall("not json"));
    expect(n).toBe(0);
    expect(mockQuery.mock.calls.filter((c) => /INSERT/.test(c[0] as string))).toHaveLength(0);
  });

  it("LLM call failure → 0 writes, never throws", async () => {
    process.env[FLAG] = "true";
    mockQuery.mockResolvedValueOnce({ rows: [{ id: CTRL_A, name: "x", description: null }] });
    const failCall = async (): Promise<LlmCallResult> => ({ ok: false, code: "llm_failed", detail: "boom" });
    await expect(runLlmControlMatcherForSignal(sig(), "org-1", failCall)).resolves.toBe(0);
  });

  it("no controls → 0 writes, no LLM call", async () => {
    process.env[FLAG] = "true";
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const llm = vi.fn();
    const n = await runLlmControlMatcherForSignal(sig(), "org-1", llm as never);
    expect(n).toBe(0);
    expect(llm).not.toHaveBeenCalled();
  });
});
