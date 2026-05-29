import { describe, it, expect, vi } from "vitest";

// Mock postgres before importing insightGenerator to avoid DATABASE_URL throw.
// insightGenerator now runs elevated (pgElevated); same handle for both.
vi.mock("../../../../../src/api/infra/postgres.js", () => {
  const handle = { query: vi.fn() };
  return { pg: handle, pgElevated: handle };
});

import { deriveAnalysis, deriveRiskImplication, deriveRecommendation } from "../insightGenerator.js";

type Signal = {
  id: string;
  organization_id: string | null;
  category: string | null;
  title: string;
  summary: string | null;
  raw_content: string | null;
  source: string;
  source_url: string;
};

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: "sig-1",
    organization_id: null,
    category: null,
    title: "Test signal",
    summary: "A brief summary",
    raw_content: "Full raw source content from the original article",
    source: "test-source",
    source_url: "https://example.com",
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// deriveAnalysis — must return raw content, not a template string
// ---------------------------------------------------------------------------

describe("deriveAnalysis", () => {
  it("returns raw_content when present", () => {
    const signal = makeSignal({ raw_content: "Detailed raw article text" });
    const result = deriveAnalysis(signal, "irrelevant text");
    expect(result).toBe("Detailed raw article text");
  });

  it("falls back to summary when raw_content is null", () => {
    const signal = makeSignal({ raw_content: null, summary: "Summary text" });
    const result = deriveAnalysis(signal, "irrelevant text");
    expect(result).toBe("Summary text");
  });

  it("falls back to title when both raw_content and summary are null", () => {
    const signal = makeSignal({ raw_content: null, summary: null, title: "Signal title" });
    const result = deriveAnalysis(signal, "irrelevant text");
    expect(result).toBe("Signal title");
  });

  it("does NOT return a template string containing 'actively exploited'", () => {
    const signal = makeSignal({ raw_content: "Raw content about zero-day exploit" });
    const result = deriveAnalysis(signal, "zero-day actively exploited");
    expect(result).not.toMatch(/represents an actively exploitable security condition/i);
    expect(result).toBe("Raw content about zero-day exploit");
  });

  it("does NOT return a template string for phishing signals", () => {
    const signal = makeSignal({ raw_content: "Phishing campaign targeting enterprise users" });
    const result = deriveAnalysis(signal, "phishing credential pdf lure");
    expect(result).not.toMatch(/reflects active social engineering/i);
    expect(result).toBe("Phishing campaign targeting enterprise users");
  });
});

// ---------------------------------------------------------------------------
// deriveRiskImplication — must return empty string
// ---------------------------------------------------------------------------

describe("deriveRiskImplication", () => {
  it("returns an empty string regardless of signal content", () => {
    const signal = makeSignal();
    expect(deriveRiskImplication(signal, "zero-day exploit ransomware")).toBe("");
    expect(deriveRiskImplication(signal, "phishing credential")).toBe("");
    expect(deriveRiskImplication(signal, "ai governance llm")).toBe("");
    expect(deriveRiskImplication(signal, "regulation enforcement ai act")).toBe("");
    expect(deriveRiskImplication(signal, "unrelated text")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// deriveRecommendation — must return empty string
// ---------------------------------------------------------------------------

describe("deriveRecommendation", () => {
  it("returns an empty string regardless of signal content", () => {
    expect(deriveRecommendation("zero-day exploit actively exploited")).toBe("");
    expect(deriveRecommendation("phishing credential pdf lure")).toBe("");
    expect(deriveRecommendation("ai model open-source ai llm")).toBe("");
    expect(deriveRecommendation("regulation enforcement ai act")).toBe("");
    expect(deriveRecommendation("unrelated text")).toBe("");
  });
});
