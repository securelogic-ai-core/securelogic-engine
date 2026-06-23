/**
 * Unit tests for the GAP-1 obligation score function (pure, no DB).
 *
 * Scoring model: regulation-FAMILY identity dominates; domain overlap and
 * citation-suffix precision are weak tiebreakers.
 * - family cited → >= REGULATION_BASE_SCORE (80), well above MIN_MATCH_SCORE
 * - family cited + domain/citation echo → up to 100
 * - family NOT cited → 0 (domain overlap alone never scores)
 * Output is always an integer in [0,100].
 *
 * Obligations use the REAL seeded, citation-style source_regulation values
 * (scripts/seed-staging.ts): "GDPR Art. 32", "HIPAA §164.308", "SOC 2 CC6.1",
 * "NIST CSF PR.AC-1" — NOT bare acronyms. Real signals cite the family only and
 * never the clause suffix, which is exactly what the family matcher must handle.
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

describe("scoreObligationMatch — regulation-family identity", () => {
  // The real seeded obligation library (scripts/seed-staging.ts).
  const SEEDED = {
    gdpr32: { source_regulation: "GDPR Art. 32", domain: "Privacy" },
    gdpr33: { source_regulation: "GDPR Art. 33", domain: "Privacy" },
    hipaa308: { source_regulation: "HIPAA §164.308", domain: "Healthcare" },
    hipaa312: { source_regulation: "HIPAA §164.312", domain: "Healthcare" },
    soc61: { source_regulation: "SOC 2 CC6.1", domain: "Audit" },
    nistAc1: { source_regulation: "NIST CSF PR.AC-1", domain: "General" },
    nistCm1: { source_regulation: "NIST CSF DE.CM-1", domain: "General" }
  } as const;

  it("family cited, no domain/citation echo → 80 (base, above threshold)", () => {
    const s = scoreObligationMatch(
      "New GDPR breach notification rule published",
      SEEDED.gdpr32
    );
    expect(s).toBe(80);
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
  });

  it("citation suffix is OPTIONAL precision: its absence does NOT zero a real match", () => {
    // Real signals say "GDPR", never "GDPR Art. 32". The clause suffix being
    // absent must still clear the threshold on the family alone.
    const s = scoreObligationMatch("GDPR security of processing tightened", SEEDED.gdpr32);
    expect(s).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
  });

  it("citation suffix present → raises the score (precision tiebreaker)", () => {
    // §164.308 echoed in the signal nudges the score above the family-only base,
    // but never gates it.
    const withSuffix = scoreObligationMatch(
      "HIPAA update referencing 164.308 administrative safeguards",
      SEEDED.hipaa308
    );
    const familyOnly = scoreObligationMatch(
      "HIPAA administrative safeguards guidance",
      SEEDED.hipaa308
    );
    expect(withSuffix).toBeGreaterThan(familyOnly);
    expect(familyOnly).toBe(80);
  });

  it("domain overlap nudges ranking among same-family obligations", () => {
    // Same family (GDPR), differing domain echo → the domain-overlapping one
    // ranks higher. (source_regulation values are the real citation style.)
    const signal = "GDPR privacy breach disclosure rule";
    const privacyHit = scoreObligationMatch(signal, {
      source_regulation: "GDPR Art. 32",
      domain: "Privacy"
    });
    const noDomain = scoreObligationMatch(signal, {
      source_regulation: "GDPR Art. 33",
      domain: "Audit"
    });
    expect(privacyHit).toBeGreaterThan(noDomain);
    expect(noDomain).toBe(80);
  });

  it("family NOT cited → 0, even when the domain word overlaps", () => {
    // Signal cites GDPR + the SOC obligation's domain word ("audit") but not the
    // SOC 2 family → no match. Cross-regulation false positive prevented.
    const s = scoreObligationMatch("GDPR audit obligations update", SEEDED.soc61);
    expect(s).toBe(0);
    expect(s).toBeLessThan(MIN_MATCH_SCORE);
  });

  it("domain overlap ALONE never clears the threshold", () => {
    // Signal cites no regulation family; domain word ("healthcare") overlaps → 0.
    const s = scoreObligationMatch("healthcare data guidance issued", SEEDED.hipaa308);
    expect(s).toBe(0);
  });

  it("null/empty source_regulation → 0 (family cannot be identified)", () => {
    expect(
      scoreObligationMatch("anything mentioning GDPR here", {
        source_regulation: null,
        domain: "Privacy"
      })
    ).toBe(0);
    expect(
      scoreObligationMatch("anything mentioning GDPR here", {
        source_regulation: "",
        domain: "Privacy"
      })
    ).toBe(0);
  });

  it("unrecognized regulation family → 0", () => {
    // A reg not in REGULATION_FAMILIES cannot be matched (curated vocabulary).
    expect(
      scoreObligationMatch("Local Ordinance 7 amended this quarter", {
        source_regulation: "Local Ordinance 7",
        domain: "General"
      })
    ).toBe(0);
  });

  it("output is always an integer within [0,100]", () => {
    const s = scoreObligationMatch(
      "HIPAA healthcare security 164.308 administrative safeguards update",
      SEEDED.hipaa308
    );
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });

  // ------------------------------------------------------------------
  // The six required walks against the REAL seeded values. Also exercised
  // behaviorally in the matcher tests; pinned here at the unit level.
  // ------------------------------------------------------------------
  it("walk (a): GDPR signal → both GDPR obligations written; a HIPAA obligation scores 0", () => {
    const signal = "New GDPR breach notification requirement";
    expect(scoreObligationMatch(signal, SEEDED.gdpr32)).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
    expect(scoreObligationMatch(signal, SEEDED.gdpr33)).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
    expect(scoreObligationMatch(signal, SEEDED.hipaa308)).toBe(0);
  });

  it("walk (b): HIPAA signal → both HIPAA obligations written; GDPR/SOC/NIST score 0", () => {
    const signal = "Updated HIPAA security rule guidance";
    expect(scoreObligationMatch(signal, SEEDED.hipaa308)).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
    expect(scoreObligationMatch(signal, SEEDED.hipaa312)).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
    expect(scoreObligationMatch(signal, SEEDED.gdpr32)).toBe(0);
    expect(scoreObligationMatch(signal, SEEDED.soc61)).toBe(0);
    expect(scoreObligationMatch(signal, SEEDED.nistAc1)).toBe(0);
  });

  it("walk (c): SOC 2 signal → SOC 2 obligation written; bare 'soc' (soccer) does NOT match", () => {
    expect(scoreObligationMatch("SOC 2 audit changes", SEEDED.soc61)).toBeGreaterThanOrEqual(
      MIN_MATCH_SCORE
    );
    // The two-token family means a stray "soc" can't satisfy it: "soccer" is not
    // a whole-word "soc", and there is no standalone "2".
    expect(scoreObligationMatch("local soccer league results", SEEDED.soc61)).toBe(0);
  });

  it("walk (d): NIST CSF signal → both NIST CSF obligations written", () => {
    const signal = "NIST CSF update";
    expect(scoreObligationMatch(signal, SEEDED.nistAc1)).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
    expect(scoreObligationMatch(signal, SEEDED.nistCm1)).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
  });

  it("walk (e): signal citing no regulation → nothing clears the threshold", () => {
    const signal = "General security advisory about a software patch release";
    for (const o of Object.values(SEEDED)) {
      expect(scoreObligationMatch(signal, o)).toBeLessThan(MIN_MATCH_SCORE);
    }
  });

  it("walk (f): short-token family 'EU AI Act' does NOT over-fire on a bare 'act'", () => {
    const euAiAct = { source_regulation: "EU AI Act", domain: "AI Governance" };
    // "act" alone must not satisfy the family — "eu" and "ai" are absent.
    expect(scoreObligationMatch("the bill is an act of congress", euAiAct)).toBe(0);
    // Sanity: the full family name DOES cite it.
    expect(
      scoreObligationMatch("EU AI Act enforcement timeline announced", euAiAct)
    ).toBeGreaterThanOrEqual(MIN_MATCH_SCORE);
  });
});
