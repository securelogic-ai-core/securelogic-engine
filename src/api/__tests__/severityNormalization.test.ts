/**
 * severityNormalization.test.ts — external severity vocabularies → ours.
 *
 * WHY THIS IS THE MOST IMPORTANT FILE IN THE PACKAGE. SecureLogic's canonical
 * severity is SLA-BEARING: Critical, High, Moderate and Low each acquire a due
 * date under a configured policy, enter the overdue population, and appear on
 * an executive report as unremediated work.
 *
 * So a mapping error is not cosmetic. Turning a tester's "Informational" into
 * "Low" would manufacture a remediation obligation nobody asserted and nobody
 * accepted — an invented deadline against an observation that was explicitly
 * NOT a vulnerability. `Medium → Moderate` is a synonym; `Informational → Low`
 * is a fabrication. These tests exist to keep those two operations apart
 * forever.
 *
 * The second rule they pin: ambiguity fails toward `unmapped`, never toward a
 * guess. A wrong canonical severity is worse than an absent one — absent is
 * visible and asks a question, wrong is invisible and answers it incorrectly.
 */
import { describe, it, expect } from "vitest";

import {
  normalizeSeverity,
  severityFromCvssScore,
  SEVERITY_NORMALIZATION_TABLE,
  CANONICAL_SEVERITIES,
} from "../lib/severityNormalization.js";

describe("the four canonical severities pass through", () => {
  for (const sev of CANONICAL_SEVERITIES) {
    it(`${sev} maps to itself`, () => {
      const r = normalizeSeverity(sev);
      expect(r).toMatchObject({ severity: sev, outcome: "mapped", sourceSeverity: sev });
    });
  }

  it("is case- and separator-insensitive", () => {
    expect(normalizeSeverity("CRITICAL").severity).toBe("Critical");
    expect(normalizeSeverity("  high  ").severity).toBe("High");
    expect(normalizeSeverity("Very-High").severity).toBe("Critical");
    expect(normalizeSeverity("very_high").severity).toBe("Critical");
  });
});

describe("Medium is a synonym — the one CVSS/SecureLogic naming difference", () => {
  it("Medium maps to Moderate", () => {
    const r = normalizeSeverity("Medium");
    expect(r).toMatchObject({ severity: "Moderate", outcome: "mapped", sourceSeverity: "Medium" });
  });

  it("and the source word is preserved, not overwritten", () => {
    expect(normalizeSeverity("medium").sourceSeverity).toBe("medium");
  });
});

describe("Informational NEVER becomes Low", () => {
  for (const word of ["Informational", "Info", "None", "Note", "Observation", "N/A", "informational"]) {
    it(`"${word}" yields NO canonical severity`, () => {
      const r = normalizeSeverity(word);

      expect(r.severity).toBeNull();
      expect(r.outcome).toBe("no_severity");
      expect(r.sourceSeverity).toBe(word);
    });
  }

  it("says why, in words a customer can read", () => {
    expect(normalizeSeverity("Informational").reason).toMatch(/no remediation SLA applies/i);
  });

  it("is DISTINCT from unmapped — different facts, different follow-up", () => {
    // "The tester said this is informational" and "we could not read this
    // value" both mean no SLA, but one is a finding and the other is a defect
    // in the import.
    expect(normalizeSeverity("Informational").outcome).toBe("no_severity");
    expect(normalizeSeverity("Sev-7").outcome).toBe("unmapped");
  });
});

describe("unmapped fails toward absent, never toward a guess", () => {
  for (const junk of ["Sev-7", "Urgent", "Blocker", "important", "🔥", "TBD", "-"]) {
    it(`"${junk}" yields no canonical severity`, () => {
      const r = normalizeSeverity(junk);

      expect(r.severity).toBeNull();
      expect(r.outcome).toBe("unmapped");
      expect(r.sourceSeverity).toBe(junk);
    });
  }

  it("an empty or missing value is unmapped, not silently Low", () => {
    expect(normalizeSeverity("").outcome).toBe("unmapped");
    expect(normalizeSeverity(null).outcome).toBe("unmapped");
    expect(normalizeSeverity(undefined).severity).toBeNull();
  });

  it("the message does NOT suggest a value to use instead", () => {
    // A suggestion in an error message is the first step toward someone
    // accepting it without checking.
    const reason = normalizeSeverity("Urgent").reason;
    for (const sev of CANONICAL_SEVERITIES) {
      expect(reason).not.toContain(sev);
    }
  });
});

describe("pen-test priority scales", () => {
  it("P1..P4 map to Critical..Low", () => {
    expect(normalizeSeverity("P1").severity).toBe("Critical");
    expect(normalizeSeverity("p2").severity).toBe("High");
    expect(normalizeSeverity("P3").severity).toBe("Moderate");
    expect(normalizeSeverity("P4").severity).toBe("Low");
  });

  it("Sev1..Sev4 map to Critical..Low", () => {
    expect(normalizeSeverity("Sev1").severity).toBe("Critical");
    expect(normalizeSeverity("sev4").severity).toBe("Low");
  });

  it("emphasis words map to the band they describe", () => {
    expect(normalizeSeverity("Severe").severity).toBe("Critical");
    expect(normalizeSeverity("Major").severity).toBe("High");
    expect(normalizeSeverity("Minor").severity).toBe("Low");
    expect(normalizeSeverity("Very Low").severity).toBe("Low");
  });
});

describe("CVSS numeric bands — v3.1 and v4.0 publish the same table", () => {
  const cases: Array<[number, string | null]> = [
    [10.0, "Critical"], [9.0, "Critical"],
    [8.9, "High"], [7.0, "High"],
    [6.9, "Moderate"], [4.0, "Moderate"],
    [3.9, "Low"], [0.1, "Low"],
  ];

  for (const [score, expected] of cases) {
    it(`${score} → ${expected}`, () => {
      expect(severityFromCvssScore(score).severity).toBe(expected);
    });
  }

  it("0.0 is 'None' — no severity, NOT Low", () => {
    // The standard's own word for 0.0 is None. Reading it as Low would invent
    // a deadline for a finding CVSS itself says has no impact.
    const r = severityFromCvssScore(0);

    expect(r.severity).toBeNull();
    expect(r.outcome).toBe("no_severity");
  });

  it("a score outside 0–10 is unmapped, not clamped", () => {
    expect(severityFromCvssScore(11).outcome).toBe("unmapped");
    expect(severityFromCvssScore(-1).outcome).toBe("unmapped");
    expect(severityFromCvssScore(Number.NaN).outcome).toBe("unmapped");
  });

  it("a bare number in a severity column is read as a CVSS score", () => {
    // Every report format we have seen uses the severity column this way.
    expect(normalizeSeverity("9.1").severity).toBe("Critical");
    expect(normalizeSeverity("5.4").severity).toBe("Moderate");
    expect(normalizeSeverity("0.0").outcome).toBe("no_severity");
  });

  it("the band boundaries are exact, not approximate", () => {
    // 6.9 vs 7.0 is the difference between a 30-day and a 14-day deadline
    // under a typical policy.
    expect(severityFromCvssScore(6.9).severity).toBe("Moderate");
    expect(severityFromCvssScore(7.0).severity).toBe("High");
    expect(severityFromCvssScore(8.9).severity).toBe("High");
    expect(severityFromCvssScore(9.0).severity).toBe("Critical");
  });
});

describe("the published table matches the implementation", () => {
  it("documents every canonical severity plus both no-severity outcomes", () => {
    const canonical = SEVERITY_NORMALIZATION_TABLE
      .map((r) => r.canonical)
      .filter((c): c is NonNullable<typeof c> => c !== null);

    expect(new Set(canonical)).toEqual(new Set(CANONICAL_SEVERITIES));
    expect(SEVERITY_NORMALIZATION_TABLE.filter((r) => r.canonical === null)).toHaveLength(2);
  });

  it("every example in the table actually normalises as the table claims", () => {
    // A published table that disagrees with the code is worse than none.
    for (const row of SEVERITY_NORMALIZATION_TABLE) {
      if (row.source === "anything else") continue;
      for (const example of row.source.split("·").map((s) => s.trim())) {
        if (example.startsWith("CVSS")) continue; // ranges, covered above
        expect(normalizeSeverity(example).severity, `${example} → ${row.canonical}`)
          .toBe(row.canonical);
      }
    }
  });
});
