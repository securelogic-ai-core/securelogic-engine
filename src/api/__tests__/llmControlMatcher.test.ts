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
//
// The runner now performs verdict-cache I/O around the provider call, so the
// mock routes by SQL instead of by call position: a positional chain would
// break on every internal change and tells the reader nothing about which
// query is which.

type DbState = {
  controls?: Array<{ id: string; name: string; description: string | null }>;
  dedupHash?: string | null;
  /** Row returned by the exact-key verdict lookup, or null for a miss. */
  verdictRow?: Record<string, unknown> | null;
  /** Whether the reservation is won. */
  reserveClaimed?: boolean;
  suggestionInsertRowCount?: number;
};

function routeDb(state: DbState): void {
  const {
    controls = [{ id: CTRL_A, name: "Patch Mgmt", description: "d" }],
    dedupHash = "sha256:signal-hash",
    verdictRow = null,
    reserveClaimed = true,
    suggestionInsertRowCount = 1
  } = state;

  mockQuery.mockImplementation(async (sql: string) => {
    if (/FROM controls/.test(sql)) return { rows: controls, rowCount: controls.length };
    if (/dedup_hash FROM cyber_signals/.test(sql)) {
      return dedupHash === null ? { rows: [], rowCount: 0 } : { rows: [{ dedup_hash: dedupHash }], rowCount: 1 };
    }
    if (/SELECT state, verdict/.test(sql)) {
      return verdictRow ? { rows: [verdictRow], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/SELECT control_inventory_digest/.test(sql)) return { rows: [], rowCount: 0 };
    if (/INSERT INTO llm_control_matcher_verdicts/.test(sql)) {
      return reserveClaimed ? { rows: [{ attempts: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/UPDATE llm_control_matcher_verdicts/.test(sql)) return { rows: [], rowCount: 1 };
    if (/INSERT INTO signal_match_suggestions/.test(sql)) {
      return { rows: [{ id: "s1" }], rowCount: suggestionInsertRowCount };
    }
    return { rows: [], rowCount: 0 };
  });
}

const sqlCalls = (pattern: RegExp) =>
  mockQuery.mock.calls.filter((c) => pattern.test(c[0] as string));

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
    routeDb({
      controls: [
        { id: CTRL_A, name: "Patch Mgmt", description: "d" },
        { id: CTRL_B, name: "Access", description: null }
      ]
    });
    const resp = JSON.stringify({ matches: [
      { control_id: CTRL_A, score: 90, reasoning: "patch the CVE" },
      { control_id: CTRL_B, score: CONTROL_MATCH_MIN_SCORE - 10, reasoning: "weak" } // below threshold → not written
    ] });

    const written = await runLlmControlMatcherForSignal(sig(), "org-1", okCall(resp));
    expect(written).toBe(1);
    const insertCall = sqlCalls(/INSERT INTO signal_match_suggestions/)[0];
    expect(insertCall![0]).toContain("'control'");
    expect(insertCall![0]).toContain("control_llm_match");
    expect((insertCall![1] as unknown[])[2]).toBe(CTRL_A);   // target_id = the high-score control
  });

  it("caches the verdict it just paid for, with the tokens the call consumed", async () => {
    process.env[FLAG] = "true";
    routeDb({});
    const call = async (): Promise<LlmCallResult> => ({
      ok: true,
      text: JSON.stringify({ matches: [{ control_id: CTRL_A, score: 90, reasoning: "r" }] }),
      inputTokens: 1234,
      outputTokens: 56
    });

    await runLlmControlMatcherForSignal(sig(), "org-1", call);

    const update = sqlCalls(/UPDATE llm_control_matcher_verdicts/)[0];
    expect(update![0]).toContain("state = 'answered'");
    expect(update![1] as unknown[]).toContain(1234);
    expect(update![1] as unknown[]).toContain(56);
  });

  it("CACHE HIT → replays the stored verdict and makes NO provider call", async () => {
    process.env[FLAG] = "true";
    routeDb({
      verdictRow: {
        state: "answered",
        verdict: { matches: [{ control_id: CTRL_A, score: 95, reasoning: "cached" }] },
        input_tokens: 900,
        output_tokens: 40,
        model: "claude-sonnet-4-6",
        attempts: 1,
        next_attempt_at: null,
        reserved_at: null
      }
    });
    const llm = vi.fn();

    const written = await runLlmControlMatcherForSignal(sig(), "org-1", llm as never);

    expect(llm).not.toHaveBeenCalled();
    expect(written).toBe(1);
    // It still writes the same suggestion rows — a hit is not a no-op.
    expect(sqlCalls(/INSERT INTO signal_match_suggestions/)).toHaveLength(1);
    // And it never re-reserves or re-answers.
    expect(sqlCalls(/INSERT INTO llm_control_matcher_verdicts/)).toHaveLength(0);
  });

  it("LOSES the reservation race → skips the provider call entirely", async () => {
    process.env[FLAG] = "true";
    routeDb({ reserveClaimed: false });
    const llm = vi.fn();

    const written = await runLlmControlMatcherForSignal(sig(), "org-1", llm as never);

    expect(written).toBe(0);
    expect(llm).not.toHaveBeenCalled();
    expect(sqlCalls(/INSERT INTO signal_match_suggestions/)).toHaveLength(0);
  });

  it("invalid JSON → 0 writes, no suggestion INSERT, and the failure is recorded as unparseable", async () => {
    process.env[FLAG] = "true";
    routeDb({});
    const n = await runLlmControlMatcherForSignal(sig(), "org-1", okCall("not json"));
    expect(n).toBe(0);
    expect(sqlCalls(/INSERT INTO signal_match_suggestions/)).toHaveLength(0);
    const update = sqlCalls(/UPDATE llm_control_matcher_verdicts/)[0];
    expect(update![1] as unknown[]).toContain("unparseable");
    expect(update![1] as unknown[]).toContain("invalid_json");
  });

  it("LLM call failure → 0 writes, never throws, recorded as a transport failure", async () => {
    process.env[FLAG] = "true";
    routeDb({});
    const failCall = async (): Promise<LlmCallResult> => ({ ok: false, code: "llm_failed", detail: "boom" });
    await expect(runLlmControlMatcherForSignal(sig(), "org-1", failCall)).resolves.toBe(0);
    const update = sqlCalls(/UPDATE llm_control_matcher_verdicts/)[0];
    expect(update![1] as unknown[]).toContain("failed");
  });

  it("no controls → 0 writes, no LLM call, no cache I/O", async () => {
    process.env[FLAG] = "true";
    routeDb({ controls: [] });
    const llm = vi.fn();
    const n = await runLlmControlMatcherForSignal(sig(), "org-1", llm as never);
    expect(n).toBe(0);
    expect(llm).not.toHaveBeenCalled();
    expect(sqlCalls(/llm_control_matcher_verdicts/)).toHaveLength(0);
  });
});
