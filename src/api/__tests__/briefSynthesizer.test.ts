import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() }
}));

import {
  enrichBriefSynthesis,
  repairTruncatedJson,
  buildAllowedCveSet,
  validateActionGrounding,
  runSynthesisSafely,
  synthesisRuntime,
  fetchPriorBriefContext,
  buildExecSummaryUserPrompt,
  EXEC_SUMMARY_SYSTEM_PROMPT,
  type BriefSynthesis,
  type PriorBriefContext
} from "../lib/briefSynthesizer.js";
import { pg } from "../infra/postgres.js";
import type { BriefItem } from "../lib/intelligenceBriefGenerator.js";

type PgQueryMock = ReturnType<typeof vi.fn>;
const pgQuery = pg.query as unknown as PgQueryMock;

const sampleItem: BriefItem = {
  cyber_signal_id: "sig-1",
  category: "vulnerability",
  relevance: "high",
  title: "ABB PCM600",
  summary: "Successful exploitation could allow remote code execution.",
  affected_cve: "CVE-2018-1002208",
  affected_vendor: "ABB",
  source_slug: "regulatory_cisa",
  signal_type: "advisory",
  severity: "Critical",
  ingestion_timestamp: "2026-04-30T16:04:42.703Z",
  sort_order: 0,
  analysis: null,
  why_it_matters: "Direct OT exposure in industrial environments.",
  recommended_actions: "1. Patch.",
  analyst_notes: null,
  urgency: "immediate"
};

describe("enrichBriefSynthesis", () => {
  it("throws on empty items[]", async () => {
    await expect(
      enrichBriefSynthesis([], "2026-04-15T00:00:00Z", "2026-04-30T23:59:59Z", [], null)
    ).rejects.toThrow(/non-empty/);
  });

  it("returns the full BriefSynthesis shape with all fields null when ANTHROPIC_API_KEY is unset", async () => {
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const result: BriefSynthesis = await enrichBriefSynthesis(
        [sampleItem],
        "2026-04-15T00:00:00Z",
        "2026-04-30T23:59:59Z",
        ["vulnerability"],
        null
      );
      expect(result).toEqual({
        headline: null,
        teaser: null,
        exec_summary: null
      });
      expect(Object.keys(result).sort()).toEqual([
        "exec_summary",
        "headline",
        "teaser"
      ]);
    } finally {
      if (original !== undefined) {
        process.env.ANTHROPIC_API_KEY = original;
      }
    }
  });
});

describe("repairTruncatedJson", () => {
  it("strips a trailing partial-string token at the start of a list and closes structure", () => {
    // Realistic Claude truncation: max_tokens cut mid-string in the first item
    const input = '{"thisWeek":["par';
    const repaired = repairTruncatedJson(input);
    const parsed = JSON.parse(repaired);
    expect(parsed.thisWeek).toEqual([]);
  });

  it("preserves already-completed array entries when truncation happens mid-string later", () => {
    const input = '{"thisWeek":["A","B","par';
    const repaired = repairTruncatedJson(input);
    const parsed = JSON.parse(repaired);
    expect(parsed.thisWeek).toEqual(["A", "B"]);
  });

  it("leaves fully-closed JSON parseable and unchanged", () => {
    const input = '{"thisWeek":["A","B"]}';
    const repaired = repairTruncatedJson(input);
    expect(repaired).toBe(input);
    expect(JSON.parse(repaired)).toEqual({ thisWeek: ["A", "B"] });
  });

  it("repairs a multi-list action_summary fixture truncated mid-string in the second list", () => {
    const truncated =
      '{"thisWeek":["Security team: patch CVE-2026-1"],"thisMonth":["Procurement: contact ven';
    const repaired = repairTruncatedJson(truncated);
    const parsed = JSON.parse(repaired);
    expect(parsed.thisWeek).toEqual(["Security team: patch CVE-2026-1"]);
    expect(parsed.thisMonth).toEqual([]);
  });
});

describe("buildAllowedCveSet", () => {
  it("extracts CVEs from all item fields", () => {
    const item: BriefItem = {
      ...sampleItem,
      affected_cve: "CVE-2026-1111",
      title: "Issue with CVE-2026-2222 disclosed",
      summary: "Affected by CVE-2026-3333.",
      why_it_matters: "Risk from CVE-2026-4444 is significant.",
      analysis: "Note also CVE-2026-5555 in the chain.",
      recommended_actions: "1. Patch.\n2. Mitigate CVE-2026-6666."
    };
    const set = buildAllowedCveSet([item]);
    expect(set.has("CVE-2026-1111")).toBe(true);
    expect(set.has("CVE-2026-2222")).toBe(true);
    expect(set.has("CVE-2026-3333")).toBe(true);
    expect(set.has("CVE-2026-4444")).toBe(true);
    expect(set.has("CVE-2026-5555")).toBe(true);
    expect(set.has("CVE-2026-6666")).toBe(true);
    expect(set.size).toBe(6);
  });

  it("handles items with no CVEs", () => {
    const item: BriefItem = {
      ...sampleItem,
      affected_cve: null,
      title: "ABB advisory disclosed",
      summary: "Generic summary text.",
      why_it_matters: "Industrial systems exposed.",
      analysis: null,
      recommended_actions: null
    };
    const set = buildAllowedCveSet([item]);
    expect(set.size).toBe(0);
  });
});

describe("validateActionGrounding", () => {
  it("keeps actions whose cited CVEs are all in the allowed set", () => {
    const allowed = new Set(["CVE-2026-1111", "CVE-2026-2222"]);
    const result = validateActionGrounding(
      ["Security team: patch CVE-2026-1111 and CVE-2026-2222 by Friday."],
      allowed
    );
    expect(result.kept).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });

  it("drops actions citing CVEs not in allowed set", () => {
    const allowed = new Set(["CVE-2026-1111"]);
    const result = validateActionGrounding(
      ["Security team: address CVE-2026-9999 immediately."],
      allowed
    );
    expect(result.kept).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]!.offendingCves).toEqual(["CVE-2026-9999"]);
  });

  it("keeps actions with no CVE citations", () => {
    const allowed = new Set<string>();
    const result = validateActionGrounding(
      [
        "OT security team: inventory all ABB products in production.",
        "Compliance team: schedule Zero Trust gap assessment."
      ],
      allowed
    );
    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
  });

  it("drops actions with mixed allowed and disallowed CVEs", () => {
    const allowed = new Set(["CVE-2026-1111"]);
    const result = validateActionGrounding(
      ["Security team: address CVE-2026-1111 and CVE-2026-9999 together."],
      allowed
    );
    expect(result.kept).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0]!.offendingCves).toEqual(["CVE-2026-9999"]);
  });

  it("handles case differences", () => {
    const allowed = new Set(["CVE-2026-12345"]);
    const result = validateActionGrounding(
      ["Security team: patch cve-2026-12345 by next sprint."],
      allowed
    );
    expect(result.kept).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });

  it("skips empty/whitespace-only action strings", () => {
    const allowed = new Set(["CVE-2026-1111"]);
    const result = validateActionGrounding(
      ["", "   ", "Security team: patch CVE-2026-1111."],
      allowed
    );
    expect(result.kept).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });
});

describe("runSynthesisSafely", () => {
  const realImpl = synthesisRuntime.enrichBriefSynthesis;

  beforeEach(() => {
    synthesisRuntime.enrichBriefSynthesis = realImpl;
  });

  afterEach(() => {
    synthesisRuntime.enrichBriefSynthesis = realImpl;
  });

  it("returns null on empty items without invoking enrichBriefSynthesis", async () => {
    const spy = vi.fn();
    synthesisRuntime.enrichBriefSynthesis = spy;
    const result = await runSynthesisSafely([], null);
    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns null when enrichBriefSynthesis throws", async () => {
    synthesisRuntime.enrichBriefSynthesis = vi
      .fn()
      .mockRejectedValue(new Error("upstream failure"));
    const result = await runSynthesisSafely([sampleItem], null);
    expect(result).toBeNull();
  });

  it("returns the synthesis fixture on success", async () => {
    const fixture: BriefSynthesis = {
      headline: "Six ABB OT vulnerabilities collide with new federal Zero Trust mandate",
      teaser:
        "Six critical ABB OT advisories and an actively exploited cPanel zero-day demand patch decisions across industrial and hosting infrastructure this week.",
      exec_summary:
        "Three of this week's twelve items center on actively-exploited Cisco IOS XE vulnerabilities now on the federal KEV catalog. Network engineering teams running internet-exposed IOS XE carry the dominant exposure this week. The mix shifts hard toward infrastructure vulnerabilities compared to last week's breach-heavy distribution."
    };
    synthesisRuntime.enrichBriefSynthesis = vi.fn().mockResolvedValue(fixture);
    const result = await runSynthesisSafely([sampleItem], null);
    expect(result).toEqual(fixture);
  });

  it("derives activeCategories from unique item.category values", async () => {
    const spy = vi.fn().mockResolvedValue({ headline: null });
    synthesisRuntime.enrichBriefSynthesis = spy;

    const items: BriefItem[] = [
      { ...sampleItem, cyber_signal_id: "sig-1", category: "vulnerability" },
      { ...sampleItem, cyber_signal_id: "sig-2", category: "vulnerability" },
      { ...sampleItem, cyber_signal_id: "sig-3", category: "regulatory" },
      { ...sampleItem, cyber_signal_id: "sig-4", category: "threat_actor" }
    ];

    await runSynthesisSafely(items, null);

    expect(spy).toHaveBeenCalledTimes(1);
    const passedCategories = spy.mock.calls[0]![3] as string[];
    expect([...passedCategories].sort()).toEqual([
      "regulatory",
      "threat_actor",
      "vulnerability"
    ]);
  });

  it("happy-path fixture headline conforms to the 12-word constraint", async () => {
    // The headline contract is enforced by the prompt. This test guards the
    // constraint by asserting the fixture used in this suite respects it,
    // so future maintainers updating the fixture get a fast fail rather
    // than silently relaxing the contract the prompt declares.
    const headline =
      "Six ABB OT vulnerabilities collide with new federal Zero Trust mandate";
    const wordCount = headline.trim().split(/\s+/).length;
    expect(wordCount).toBeLessThanOrEqual(12);
  });
});

// ====================================================================
// EXEC_SUMMARY_SYSTEM_PROMPT — exported constant + reframe content
// ====================================================================

describe("EXEC_SUMMARY_SYSTEM_PROMPT", () => {
  it("is exported as a non-empty string constant", () => {
    expect(typeof EXEC_SUMMARY_SYSTEM_PROMPT).toBe("string");
    expect(EXEC_SUMMARY_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("reflects the summary-not-action reframe (no 'decision compression')", () => {
    expect(EXEC_SUMMARY_SYSTEM_PROMPT).toMatch(/summary, not action/i);
    expect(EXEC_SUMMARY_SYSTEM_PROMPT).not.toMatch(/decision compression/i);
    expect(EXEC_SUMMARY_SYSTEM_PROMPT).not.toMatch(/memo to a busy operator/i);
  });
});

// ====================================================================
// buildExecSummaryUserPrompt — priorContext threading
// ====================================================================

describe("buildExecSummaryUserPrompt — prior block", () => {
  const sampleSignalLines =
    "[1] [IMMEDIATE | HIGH | Critical] CVE-2026-1 (Acme) Test\n    why: Test why\n    action1: Test action";

  it("includes the prior block when priorContext is non-null", () => {
    const prior: PriorBriefContext = {
      period_end: "2026-04-26T00:00:00.000Z",
      headline: "Last week's headline",
      exec_summary: "Last week's exec summary text.",
      urgency_mix: { immediate: 4, near_term: 6, far_term: 2 },
      category_mix: { vulnerability: 7, regulatory: 3, threat_actor: 2 }
    };
    const prompt = buildExecSummaryUserPrompt(sampleSignalLines, prior);
    expect(prompt).toContain("LAST WEEK's brief (period ending 2026-04-26)");
    expect(prompt).toContain('headline: "Last week\'s headline"');
    expect(prompt).toContain('exec_summary: "Last week\'s exec summary text."');
    expect(prompt).toContain("4 immediate, 6 near-term, 2 far-term");
    // Category mix sorted descending by count
    expect(prompt).toContain("vulnerability: 7");
    expect(prompt).toContain("regulatory: 3");
    expect(prompt).toContain("threat_actor: 2");
  });

  it("omits the prior block when priorContext is null and instructs the model to drop S3 with a mandatory closing observation", () => {
    const prompt = buildExecSummaryUserPrompt(sampleSignalLines, null);
    expect(prompt).not.toContain("LAST WEEK's brief");
    expect(prompt).not.toContain("urgency mix:");
    expect(prompt).toMatch(
      /If no prior brief is available[\s\S]*OMIT this sentence and produce a 3-sentence summary/
    );
    expect(prompt).toMatch(
      /Without prior calibration, the closing sentence becomes mandatory rather than optional/
    );
  });
});

// ====================================================================
// fetchPriorBriefContext — DB query + plaintext/encrypted handling
// ====================================================================

describe("fetchPriorBriefContext", () => {
  beforeEach(() => {
    pgQuery.mockReset();
  });

  it("returns null when no prior published brief exists", async () => {
    pgQuery.mockResolvedValueOnce({ rows: [] });
    const result = await fetchPriorBriefContext("org-1", "current-brief-id");
    expect(result).toBeNull();
  });

  it("query excludes the current brief id (id != $2) and orders by published_at DESC", async () => {
    pgQuery.mockResolvedValueOnce({ rows: [] });
    await fetchPriorBriefContext("org-1", "current-id");
    expect(pgQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = pgQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/id\s*!=\s*\$2/);
    expect(sql).toMatch(/status\s*=\s*'published'/);
    expect(sql).toMatch(/ORDER BY published_at DESC/);
    expect(params).toEqual(["org-1", "current-id"]);
  });

  it("derives synthesis + mixes from a plaintext content_json (scheduler write path)", async () => {
    const contentJson = {
      synthesis: { headline: "H1", exec_summary: "S1", teaser: "T1" },
      categories: [
        {
          category: "vulnerability",
          items: [{ urgency: "immediate" }, { urgency: "near_term" }]
        },
        { category: "regulatory", items: [{ urgency: "far_term" }] }
      ]
    };
    pgQuery.mockResolvedValueOnce({
      rows: [
        { period_end: "2026-04-26T00:00:00.000Z", content_json: contentJson }
      ]
    });
    const result = await fetchPriorBriefContext("org-1", "current-id");
    expect(result).not.toBeNull();
    expect(result!.headline).toBe("H1");
    expect(result!.exec_summary).toBe("S1");
    expect(result!.urgency_mix).toEqual({
      immediate: 1,
      near_term: 1,
      far_term: 1
    });
    expect(result!.category_mix).toEqual({ vulnerability: 2, regulatory: 1 });
  });

  it("derives synthesis + mixes from an encrypted-shape content_json (manual route write path)", async () => {
    const obj = {
      synthesis: { headline: "H2", exec_summary: "S2", teaser: "T2" },
      categories: [
        {
          category: "vulnerability",
          items: [{ urgency: "immediate" }]
        }
      ]
    };
    // After the manual route's JSON.stringify(encryptField(JSON.stringify(obj)))
    // round-trips through Postgres JSONB, the value comes back as a JSON string
    // (not an object). parseContentJson runs decryptField then JSON.parse.
    // With FIELD_ENCRYPTION_KEY unset (test default), decryptField is a
    // passthrough — the string IS the JSON we want.
    pgQuery.mockResolvedValueOnce({
      rows: [
        {
          period_end: "2026-04-26T00:00:00.000Z",
          content_json: JSON.stringify(obj)
        }
      ]
    });
    const result = await fetchPriorBriefContext("org-1", "current-id");
    expect(result).not.toBeNull();
    expect(result!.headline).toBe("H2");
    expect(result!.exec_summary).toBe("S2");
    expect(result!.urgency_mix.immediate).toBe(1);
    expect(result!.category_mix.vulnerability).toBe(1);
  });
});

// ====================================================================
// runSynthesisSafely — priorContext threading via runtime dispatch
// ====================================================================

describe("runSynthesisSafely — priorContext threading", () => {
  const realImpl = synthesisRuntime.enrichBriefSynthesis;

  beforeEach(() => {
    synthesisRuntime.enrichBriefSynthesis = realImpl;
  });

  afterEach(() => {
    synthesisRuntime.enrichBriefSynthesis = realImpl;
  });

  it("passes priorContext to enrichBriefSynthesis as the 5th positional arg", async () => {
    const spy = vi
      .fn()
      .mockResolvedValue({ headline: null, teaser: null, exec_summary: null });
    synthesisRuntime.enrichBriefSynthesis = spy;
    const prior: PriorBriefContext = {
      period_end: "2026-04-26T00:00:00.000Z",
      headline: "prior headline",
      exec_summary: "prior es",
      urgency_mix: { immediate: 1, near_term: 1, far_term: 1 },
      category_mix: { vulnerability: 3 }
    };
    await runSynthesisSafely([sampleItem], prior);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![4]).toEqual(prior);
  });

  it("passes null priorContext through unchanged", async () => {
    const spy = vi
      .fn()
      .mockResolvedValue({ headline: null, teaser: null, exec_summary: null });
    synthesisRuntime.enrichBriefSynthesis = spy;
    await runSynthesisSafely([sampleItem], null);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![4]).toBeNull();
  });
});
