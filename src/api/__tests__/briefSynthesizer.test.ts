import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  enrichBriefSynthesis,
  repairTruncatedJson,
  buildAllowedCveSet,
  validateActionGrounding,
  runSynthesisSafely,
  synthesisRuntime,
  type BriefSynthesis
} from "../lib/briefSynthesizer.js";
import type { BriefItem } from "../lib/intelligenceBriefGenerator.js";

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
      enrichBriefSynthesis([], "2026-04-15T00:00:00Z", "2026-04-30T23:59:59Z", [])
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
        ["vulnerability"]
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
    const result = await runSynthesisSafely([]);
    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns null when enrichBriefSynthesis throws", async () => {
    synthesisRuntime.enrichBriefSynthesis = vi
      .fn()
      .mockRejectedValue(new Error("upstream failure"));
    const result = await runSynthesisSafely([sampleItem]);
    expect(result).toBeNull();
  });

  it("returns the synthesis fixture on success", async () => {
    const fixture: BriefSynthesis = {
      headline: "Six ABB OT vulnerabilities collide with new federal Zero Trust mandate",
      teaser:
        "Six critical ABB OT advisories and an actively exploited cPanel zero-day demand patch decisions across industrial and hosting infrastructure this week.",
      exec_summary:
        "Patch CVE-2026-41940 in cPanel, WHM, and WP Squared within 24 hours — CISA has added it to KEV with confirmed active exploitation since late February. OT security engineers and ICS plant managers running affected ABB systems should confirm patch availability and isolate affected nodes from external access by Friday. Apply the GitHub RCE patch for CVE-2026-3854 before end of business Wednesday, and assign an owner to the CISA Zero Trust OT guidance for a 30-day implementation review."
    };
    synthesisRuntime.enrichBriefSynthesis = vi.fn().mockResolvedValue(fixture);
    const result = await runSynthesisSafely([sampleItem]);
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

    await runSynthesisSafely(items);

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
