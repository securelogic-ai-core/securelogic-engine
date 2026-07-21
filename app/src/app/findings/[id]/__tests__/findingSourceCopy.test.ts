/**
 * findingSourceCopy.test.ts — source-aware Decision Workspace copy (ERIP
 * launch-readiness, PR-C). Pure; no DOM/RTL harness (the app has none).
 */

import { describe, it, expect } from "vitest";
import {
  isIntelligenceSourced,
  findingSourceLabel,
  intelligenceEmptyCopy,
  recommendationEmptyCopy,
} from "../findingSourceCopy";

describe("isIntelligenceSourced", () => {
  it("is true for signal/cyber_signal/intelligence_event", () => {
    expect(isIntelligenceSourced("signal")).toBe(true);
    expect(isIntelligenceSourced("cyber_signal")).toBe(true);
    expect(isIntelligenceSourced("intelligence_event")).toBe(true);
  });
  it("is false for assessment sources", () => {
    expect(isIntelligenceSourced("vendor_review")).toBe(false);
    expect(isIntelligenceSourced("manual")).toBe(false);
  });
});

describe("findingSourceLabel", () => {
  it("maps known sources to friendly labels", () => {
    expect(findingSourceLabel("vendor_review")).toBe("vendor assessment");
    expect(findingSourceLabel("ai_governance_review")).toBe("AI governance review");
  });
  it("de-slugs unknown sources", () => {
    expect(findingSourceLabel("some_new_source")).toBe("some new source");
  });
});

describe("intelligenceEmptyCopy — source-aware", () => {
  it("says 'not linked yet' for intelligence-sourced findings", () => {
    expect(intelligenceEmptyCopy("cyber_signal")).toMatch(/not linked|linked to this finding yet/i);
  });
  it("explains the absence for non-intelligence sources", () => {
    const copy = intelligenceEmptyCopy("vendor_review");
    expect(copy).toContain("vendor assessment");
    expect(copy).toMatch(/isn't expected/i);
  });
});

describe("recommendationEmptyCopy — source-aware", () => {
  it("references the linked intelligence for intelligence-sourced findings", () => {
    expect(recommendationEmptyCopy("intelligence_event")).toMatch(/intelligence/i);
  });
  it("references the source for assessment findings", () => {
    expect(recommendationEmptyCopy("control_test")).toContain("control test");
  });
});
