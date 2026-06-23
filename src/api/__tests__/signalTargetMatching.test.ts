/**
 * Unit tests for the GAP-1 obligation score function (pure, no DB).
 *
 * Scoring model: regulation identity dominates, domain is a weak tiebreaker.
 * - regulation cited → >= REGULATION_BASE_SCORE (80), well above MIN_MATCH_SCORE
 * - regulation cited + domain overlap → up to 100
 * - regulation NOT cited → 0 (domain overlap alone never scores)
 * Output is always an integer in [0,100].
 */
import { describe, it, expect } from "vitest";
import {
  tokenize,
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

describe("scoreObligationMatch — regulation identity", () => {
  it("regulation cited, no domain overlap → 80 (base, above threshold)", () => {
    const s = scoreObligationMatch("New GDPR breach notification rule published", {
      source_regulation: "GDPR",
      domain: "data protection"
    });
    expect(s).toBe(80);
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
  });

  it("regulation cited + full domain overlap → 100 (domain nudges)", () => {
    const s = scoreObligationMatch("New GDPR data protection breach notification", {
      source_regulation: "GDPR",
      domain: "data protection"
    });
    expect(s).toBe(100);
  });

  it("regulation NOT cited → 0, even when the domain fully overlaps", () => {
    // The CCPA-on-a-GDPR-signal case at the unit level: shared domain
    // ("data protection") must NOT produce a match.
    const s = scoreObligationMatch("New GDPR data protection breach notification", {
      source_regulation: "CCPA",
      domain: "data protection"
    });
    expect(s).toBe(0);
    expect(s).toBeLessThan(MIN_MATCH_SCORE);
  });

  it("domain overlap ALONE never clears the threshold", () => {
    // Signal cites no regulation token; domain fully overlaps → still 0.
    const s = scoreObligationMatch("data protection breach guidance issued", {
      source_regulation: "CCPA",
      domain: "data protection"
    });
    expect(s).toBe(0);
  });

  it("null/empty source_regulation → 0 (regulation cannot be identified)", () => {
    expect(
      scoreObligationMatch("anything mentioning GDPR here", {
        source_regulation: null,
        domain: "data protection"
      })
    ).toBe(0);
    expect(
      scoreObligationMatch("anything mentioning GDPR here", {
        source_regulation: "",
        domain: "data protection"
      })
    ).toBe(0);
  });

  it("output is always an integer within [0,100]", () => {
    const s = scoreObligationMatch("HIPAA security rule update on data privacy", {
      source_regulation: "HIPAA",
      domain: "data privacy controls"
    });
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });

  // ------------------------------------------------------------------
  // The two required walks (also exercised behaviorally in the matcher
  // tests; pinned here at the unit level).
  // ------------------------------------------------------------------
  it("walk (a): GDPR signal → GDPR obligation high (written), CCPA obligation below threshold", () => {
    const signal = "GDPR breach notification requirement tightened";
    const gdpr = scoreObligationMatch(signal, {
      source_regulation: "GDPR",
      domain: "data protection"
    });
    const ccpa = scoreObligationMatch(signal, {
      source_regulation: "CCPA",
      domain: "data protection"
    });
    expect(gdpr).toBeGreaterThanOrEqual(MIN_MATCH_SCORE); // written
    expect(ccpa).toBeLessThan(MIN_MATCH_SCORE);           // NOT written
  });

  it("walk (b): signal with no recognizable regulation → nothing clears threshold", () => {
    const signal = "General security advisory about a software patch release";
    for (const reg of ["GDPR", "CCPA", "HIPAA"]) {
      const s = scoreObligationMatch(signal, {
        source_regulation: reg,
        domain: "data protection"
      });
      expect(s).toBeLessThan(MIN_MATCH_SCORE);
    }
  });
});
