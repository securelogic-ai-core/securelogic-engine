/**
 * Unit tests for the GAP-1 score functions (pure, no DB).
 * Scores must be integers in [0,100]; no-overlap must fall below MIN_MATCH_SCORE.
 */
import { describe, it, expect } from "vitest";
import {
  tokenize,
  scoreControlMatch,
  scoreObligationMatch,
  MIN_MATCH_SCORE,
  SUGGESTION_CAP
} from "../lib/signalTargetMatching.js";

describe("tokenize", () => {
  it("lowercases, splits on non-alphanumeric, drops <3-char tokens and stopwords", () => {
    const t = tokenize("New GDPR Data-Protection rule for the EU AI Act");
    expect(t.has("gdpr")).toBe(true);
    expect(t.has("data")).toBe(true);
    expect(t.has("protection")).toBe(true);
    expect(t.has("act")).toBe(true);
    expect(t.has("for")).toBe(false); // stopword
    expect(t.has("the")).toBe(false); // stopword
    expect(t.has("new")).toBe(false); // stopword
    expect(t.has("eu")).toBe(false);  // <3 chars
    expect(t.has("ai")).toBe(false);  // <3 chars
  });
});

describe("constants", () => {
  it("MIN_MATCH_SCORE is 40 and SUGGESTION_CAP is 20", () => {
    expect(MIN_MATCH_SCORE).toBe(40);
    expect(SUGGESTION_CAP).toBe(20);
  });
});

describe("scoreControlMatch", () => {
  it("full overlap → 100 (integer)", () => {
    const s = scoreControlMatch(
      "Apache Struts remote code execution behind a web application firewall",
      { name: "Web Application Firewall", description: null }
    );
    expect(s).toBe(100);
    expect(Number.isInteger(s)).toBe(true);
  });

  it("no overlap → 0, well below threshold", () => {
    const s = scoreControlMatch("unrelated database backup rotation", {
      name: "Web Application Firewall",
      description: null
    });
    expect(s).toBe(0);
    expect(s).toBeLessThan(MIN_MATCH_SCORE);
  });

  it("partial overlap (1 of 3 target tokens) → below threshold (33)", () => {
    const s = scoreControlMatch("web server hardening guide", {
      name: "Web Application Firewall",
      description: null
    });
    expect(s).toBe(33);
    expect(s).toBeLessThan(MIN_MATCH_SCORE);
  });

  it("description tokens count toward the target set", () => {
    const s = scoreControlMatch(
      "incident response runbook for ransomware containment",
      { name: "Incident Response", description: "ransomware containment runbook" }
    );
    expect(s).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
    expect(s).toBeLessThanOrEqual(100);
    expect(Number.isInteger(s)).toBe(true);
  });

  it("empty target → 0 (nothing to match)", () => {
    expect(scoreControlMatch("anything", { name: "", description: null })).toBe(0);
  });
});

describe("scoreObligationMatch", () => {
  it("full overlap on source_regulation + domain → 100", () => {
    const s = scoreObligationMatch(
      "New GDPR enforcement guidance on data protection breach notification ftc",
      { source_regulation: "GDPR", domain: "data protection" }
    );
    expect(s).toBe(100);
    expect(Number.isInteger(s)).toBe(true);
  });

  it("no overlap → 0", () => {
    const s = scoreObligationMatch(
      "New GDPR enforcement guidance on data protection",
      { source_regulation: "OSHA", domain: "occupational safety" }
    );
    expect(s).toBe(0);
  });

  it("null source_regulation and domain → 0", () => {
    expect(
      scoreObligationMatch("anything at all", {
        source_regulation: null,
        domain: null
      })
    ).toBe(0);
  });

  it("output is always an integer within [0,100]", () => {
    const s = scoreObligationMatch("partial gdpr mention only", {
      source_regulation: "GDPR",
      domain: "data protection privacy"
    });
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});
