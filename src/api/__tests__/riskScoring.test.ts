import { describe, it, expect } from "vitest";
import {
  computeRiskScore,
  DEFAULT_WEIGHTS,
  KEV_SOURCE,
  MISSING_DATA_DEFAULT,
  ENTITY_CRITICALITY_KEYS,
  OBLIGATION_PRIORITY_KEYS,
  SEVERITY_KEYS,
  type RiskScoringWeights,
  type ScoringInput
} from "../lib/riskScoring.js";

// ====================================================================
// Constants and shared fixtures
// ====================================================================

function makeWeights(): RiskScoringWeights {
  // Deep clone of defaults so tests can't accidentally cross-contaminate.
  return {
    entity_criticality_weights: { ...DEFAULT_WEIGHTS.entity_criticality_weights },
    obligation_priority_weights: { ...DEFAULT_WEIGHTS.obligation_priority_weights },
    severity_weights: { ...DEFAULT_WEIGHTS.severity_weights }
  };
}

function input(overrides: Partial<ScoringInput> = {}): ScoringInput {
  const base: ScoringInput = {
    signal: { severity: "High", source: "nvd" },
    entity: { type: "vendor", criticality: "high" },
    weights: makeWeights()
  };
  return {
    ...base,
    ...overrides,
    signal: { ...base.signal, ...(overrides.signal ?? {}) },
    entity: { ...base.entity, ...(overrides.entity ?? {}) },
    weights: overrides.weights ?? base.weights
  };
}

// ====================================================================
// DEFAULT_WEIGHTS shape
// ====================================================================

describe("DEFAULT_WEIGHTS — shape and values", () => {
  it("entity_criticality_weights has exactly four lowercase keys", () => {
    expect(Object.keys(DEFAULT_WEIGHTS.entity_criticality_weights).sort()).toEqual(
      ["critical", "high", "low", "medium"]
    );
  });

  it("obligation_priority_weights has exactly four lowercase snake_case keys", () => {
    expect(Object.keys(DEFAULT_WEIGHTS.obligation_priority_weights).sort()).toEqual(
      ["immediate", "near_term", "planned", "watch"]
    );
  });

  it("severity_weights has exactly four PascalCase keys (note: 'Moderate' not 'Medium')", () => {
    expect(Object.keys(DEFAULT_WEIGHTS.severity_weights).sort()).toEqual(
      ["Critical", "High", "Low", "Moderate"]
    );
  });

  it("documented default values match the spec exactly", () => {
    expect(DEFAULT_WEIGHTS.entity_criticality_weights).toEqual({
      critical: 1.0,
      high: 0.75,
      medium: 0.5,
      low: 0.25
    });
    expect(DEFAULT_WEIGHTS.obligation_priority_weights).toEqual({
      immediate: 1.0,
      near_term: 0.75,
      planned: 0.5,
      watch: 0.25
    });
    expect(DEFAULT_WEIGHTS.severity_weights).toEqual({
      Critical: 1.0,
      High: 0.75,
      Moderate: 0.5,
      Low: 0.25
    });
  });

  it("KEV_SOURCE is the canonical 'cisa-kev' string", () => {
    expect(KEV_SOURCE).toBe("cisa-kev");
  });

  it("MISSING_DATA_DEFAULT is 0.5", () => {
    expect(MISSING_DATA_DEFAULT).toBe(0.5);
  });

  it("exported key arrays match the maps", () => {
    expect([...ENTITY_CRITICALITY_KEYS].sort()).toEqual(
      Object.keys(DEFAULT_WEIGHTS.entity_criticality_weights).sort()
    );
    expect([...OBLIGATION_PRIORITY_KEYS].sort()).toEqual(
      Object.keys(DEFAULT_WEIGHTS.obligation_priority_weights).sort()
    );
    expect([...SEVERITY_KEYS].sort()).toEqual(
      Object.keys(DEFAULT_WEIGHTS.severity_weights).sort()
    );
  });
});

// ====================================================================
// Severity dimension — each band, missing, KEV override
// ====================================================================

describe("computeRiskScore — severity dimension", () => {
  for (const sev of SEVERITY_KEYS) {
    it(`severity='${sev}' resolves to weight ${DEFAULT_WEIGHTS.severity_weights[sev]}`, () => {
      const r = computeRiskScore(input({ signal: { severity: sev, source: "nvd" } }));
      expect(r.breakdown.severity).toBe(DEFAULT_WEIGHTS.severity_weights[sev]);
    });
  }

  it("missing severity (null) defaults to MISSING_DATA_DEFAULT and explanation flags it", () => {
    const r = computeRiskScore(input({ signal: { severity: null, source: "nvd" } }));
    expect(r.breakdown.severity).toBe(MISSING_DATA_DEFAULT);
    expect(r.explanation).toMatch(/severity:\s*defaulted/i);
  });

  it("unrecognized severity (e.g. lowercase 'high') defaults — vocabulary stays honest", () => {
    // 'high' is the entity-criticality vocabulary; severity uses 'High'.
    // Function MUST NOT silently coerce — that would mask data corruption.
    const r = computeRiskScore(input({ signal: { severity: "high", source: "nvd" } }));
    expect(r.breakdown.severity).toBe(MISSING_DATA_DEFAULT);
    expect(r.explanation).toMatch(/severity:\s*defaulted/i);
  });

  it("KEV source overrides severity weight to 1.0 even when stored severity is 'Low'", () => {
    const r = computeRiskScore(input({ signal: { severity: "Low", source: "cisa-kev" } }));
    expect(r.breakdown.severity).toBe(1.0);
    expect(r.explanation).toMatch(/KEV override applied/i);
  });

  it("KEV source overrides severity weight to 1.0 even when stored severity is null", () => {
    const r = computeRiskScore(input({ signal: { severity: null, source: "cisa-kev" } }));
    expect(r.breakdown.severity).toBe(1.0);
    expect(r.explanation).toMatch(/KEV override applied/i);
  });

  it("non-KEV CISA source ('cisa-other') does NOT trigger override", () => {
    const r = computeRiskScore(input({ signal: { severity: "Low", source: "cisa-other" } }));
    expect(r.breakdown.severity).toBe(DEFAULT_WEIGHTS.severity_weights.Low);
    expect(r.explanation).not.toMatch(/KEV override/i);
  });
});

// ====================================================================
// Entity dimension — each criticality, missing, all four entity types
// ====================================================================

describe("computeRiskScore — entity dimension (vendor/ai_system)", () => {
  for (const crit of ENTITY_CRITICALITY_KEYS) {
    it(`vendor criticality='${crit}' resolves to weight ${DEFAULT_WEIGHTS.entity_criticality_weights[crit]}`, () => {
      const r = computeRiskScore(input({ entity: { type: "vendor", criticality: crit } }));
      expect(r.breakdown.entity).toBe(DEFAULT_WEIGHTS.entity_criticality_weights[crit]);
    });
    it(`ai_system criticality='${crit}' resolves to weight ${DEFAULT_WEIGHTS.entity_criticality_weights[crit]}`, () => {
      const r = computeRiskScore(input({ entity: { type: "ai_system", criticality: crit } }));
      expect(r.breakdown.entity).toBe(DEFAULT_WEIGHTS.entity_criticality_weights[crit]);
    });
  }

  it("vendor with null criticality defaults and flags 'defaulted'", () => {
    const r = computeRiskScore(input({ entity: { type: "vendor", criticality: null } }));
    expect(r.breakdown.entity).toBe(MISSING_DATA_DEFAULT);
    expect(r.explanation).toMatch(/entity:\s*defaulted/i);
  });

  it("vendor with PascalCase 'High' (wrong vocabulary) defaults — does not coerce", () => {
    const r = computeRiskScore(input({ entity: { type: "vendor", criticality: "High" } }));
    expect(r.breakdown.entity).toBe(MISSING_DATA_DEFAULT);
    expect(r.explanation).toMatch(/entity:\s*defaulted/i);
  });
});

describe("computeRiskScore — entity dimension (control)", () => {
  it("control type ALWAYS defaults entity weight (no criticality column)", () => {
    // Even if criticality were provided (it never is on the source row),
    // the function must default for control type — surfacing this gap
    // explicitly is the design.
    const r1 = computeRiskScore(input({ entity: { type: "control", criticality: null } }));
    expect(r1.breakdown.entity).toBe(MISSING_DATA_DEFAULT);
    expect(r1.explanation).toMatch(/controls have no criticality column/i);

    const r2 = computeRiskScore(input({ entity: { type: "control", criticality: "high" } }));
    expect(r2.breakdown.entity).toBe(MISSING_DATA_DEFAULT);
    expect(r2.explanation).toMatch(/controls have no criticality column/i);
  });
});

// ====================================================================
// Obligation dimension — each priority, missing, non-obligation types
// ====================================================================

describe("computeRiskScore — obligation dimension", () => {
  for (const prio of OBLIGATION_PRIORITY_KEYS) {
    it(`obligation priority='${prio}' resolves to weight ${DEFAULT_WEIGHTS.obligation_priority_weights[prio]}`, () => {
      const r = computeRiskScore(
        input({ entity: { type: "obligation", criticality: null, priority: prio } })
      );
      expect(r.breakdown.obligation).toBe(
        DEFAULT_WEIGHTS.obligation_priority_weights[prio]
      );
    });
  }

  it("obligation with null priority defaults obligation dim ONLY (entity dim stays at neutral 1.0, no entity flag)", () => {
    // Verify the asymmetry: missing priority is a data gap (flag); the
    // entity dimension is type-by-design neutral and must NOT also flag.
    const r = computeRiskScore(
      input({ entity: { type: "obligation", criticality: null, priority: null } })
    );
    expect(r.breakdown.obligation).toBe(MISSING_DATA_DEFAULT);
    expect(r.breakdown.entity).toBe(1.0);
    expect(r.explanation).toMatch(/obligation:\s*defaulted/i);
    // CRITICAL: no entity-defaulted flag for obligations.
    expect(r.explanation).not.toMatch(/entity:\s*defaulted/i);
  });

  it("obligation-typed input NEVER produces an 'entity: defaulted' explanation flag (regardless of priority)", () => {
    // Negative-coverage test: scan every priority value (valid + null +
    // unknown) and assert the entity-defaulted flag is absent. This is
    // the safety net for the entity-dimension asymmetry; if a future
    // refactor accidentally re-introduces a 0.5 default for obligations,
    // this test catches it.
    const priorityCases: Array<string | null> = [
      ...OBLIGATION_PRIORITY_KEYS,
      null,
      "" as string,
      "unknown_priority"
    ];
    for (const prio of priorityCases) {
      const r = computeRiskScore(
        input({
          entity: { type: "obligation", criticality: null, priority: prio }
        })
      );
      expect(r.breakdown.entity).toBe(1.0);
      expect(r.explanation).not.toMatch(/entity:\s*defaulted/i);
    }
  });

  it("vendor entity fixes obligation weight at 1.0 (not applicable)", () => {
    const r = computeRiskScore(input({ entity: { type: "vendor", criticality: "high" } }));
    expect(r.breakdown.obligation).toBe(1.0);
    expect(r.explanation).toMatch(/obligation:\s*not applicable/i);
  });

  it("ai_system entity fixes obligation weight at 1.0", () => {
    const r = computeRiskScore(input({ entity: { type: "ai_system", criticality: "high" } }));
    expect(r.breakdown.obligation).toBe(1.0);
  });

  it("control entity fixes obligation weight at 1.0", () => {
    const r = computeRiskScore(input({ entity: { type: "control", criticality: null } }));
    expect(r.breakdown.obligation).toBe(1.0);
  });
});

// ====================================================================
// Score arithmetic — formula correctness, range, integer output
// ====================================================================

describe("computeRiskScore — score arithmetic", () => {
  it("Critical + critical vendor ⇒ score = 1.0 * 1.0 * 1.0 * 100 = 100", () => {
    const r = computeRiskScore(
      input({
        signal: { severity: "Critical", source: "nvd" },
        entity: { type: "vendor", criticality: "critical" }
      })
    );
    expect(r.score).toBe(100);
  });

  it("Low + low vendor ⇒ score = 0.25 * 0.25 * 1.0 * 100 = 6.25 → rounds to 6", () => {
    const r = computeRiskScore(
      input({
        signal: { severity: "Low", source: "nvd" },
        entity: { type: "vendor", criticality: "low" }
      })
    );
    expect(r.score).toBe(6);
  });

  it("Moderate + medium vendor ⇒ 0.5 * 0.5 * 1.0 * 100 = 25", () => {
    const r = computeRiskScore(
      input({
        signal: { severity: "Moderate", source: "nvd" },
        entity: { type: "vendor", criticality: "medium" }
      })
    );
    expect(r.score).toBe(25);
  });

  it("High + obligation priority=immediate ⇒ 0.75 (sev) * 1.0 (entity neutral — obligation by design) * 1.0 (immediate) * 100 = 75", () => {
    // ENTITY-DIMENSION ASYMMETRY: obligation-typed entities use 1.0 as a
    // multiplicative-neutral element BY DESIGN, not as a data default.
    // The obligation dimension below (priority) is where obligation-
    // specific weight is captured. Defaulting obligations to 0.5 on the
    // entity dimension would cap obligation scores at 50 and invert the
    // package's stated purpose; instead, obligations score in [0, 100]
    // with priority driving the differentiation.
    const r = computeRiskScore(
      input({
        signal: { severity: "High", source: "nvd" },
        entity: { type: "obligation", criticality: null, priority: "immediate" }
      })
    );
    expect(r.score).toBe(75);
    expect(r.breakdown.entity).toBe(1.0);
    expect(r.breakdown.obligation).toBe(1.0);
    // No 'entity: defaulted' flag — obligation entity dimension is
    // type-by-design neutral, not a data gap.
    expect(r.explanation).not.toMatch(/entity:\s*defaulted/i);
  });

  it("Critical + obligation priority=immediate ⇒ 100 (full range available to obligations)", () => {
    // Confirms obligation-typed entities can hit the top of the score
    // range when severity and priority both max out — ruling out the
    // earlier cap-at-50 design.
    const r = computeRiskScore(
      input({
        signal: { severity: "Critical", source: "nvd" },
        entity: { type: "obligation", criticality: null, priority: "immediate" }
      })
    );
    expect(r.score).toBe(100);
  });

  it("KEV override flips a Low+low into 1.0 * 0.25 * 1.0 * 100 = 25", () => {
    const r = computeRiskScore(
      input({
        signal: { severity: "Low", source: "cisa-kev" },
        entity: { type: "vendor", criticality: "low" }
      })
    );
    expect(r.score).toBe(25);
  });

  it("score is always an integer in [0, 100] across vendor/ai_system/control/obligation matrices", () => {
    // Vendor / ai_system: 16 cells (4 severity × 4 criticality).
    for (const sev of SEVERITY_KEYS) {
      for (const crit of ENTITY_CRITICALITY_KEYS) {
        for (const t of ["vendor", "ai_system"] as const) {
          const r = computeRiskScore(
            input({
              signal: { severity: sev, source: "nvd" },
              entity: { type: t, criticality: crit }
            })
          );
          expect(Number.isInteger(r.score)).toBe(true);
          expect(r.score).toBeGreaterThanOrEqual(0);
          expect(r.score).toBeLessThanOrEqual(100);
        }
      }
    }
    // Control: 4 cells (4 severity × always-defaulted entity).
    for (const sev of SEVERITY_KEYS) {
      const r = computeRiskScore(
        input({
          signal: { severity: sev, source: "nvd" },
          entity: { type: "control", criticality: null }
        })
      );
      expect(Number.isInteger(r.score)).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
    // Obligation: 16 cells (4 severity × 4 priority). Confirms the full
    // [0, 100] range is reachable for obligations under the asymmetry.
    for (const sev of SEVERITY_KEYS) {
      for (const prio of OBLIGATION_PRIORITY_KEYS) {
        const r = computeRiskScore(
          input({
            signal: { severity: sev, source: "nvd" },
            entity: { type: "obligation", criticality: null, priority: prio }
          })
        );
        expect(Number.isInteger(r.score)).toBe(true);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
      }
    }
  });

  it("zero-on-any-zero is intentional and flagged in explanation", () => {
    // Constructed weights with one zero — bypass validation deliberately.
    const w = makeWeights();
    (w.entity_criticality_weights as Record<string, number>).high = 0;
    const r = computeRiskScore(
      input({
        signal: { severity: "Critical", source: "nvd" },
        entity: { type: "vendor", criticality: "high" },
        weights: w
      })
    );
    expect(r.score).toBe(0);
    expect(r.explanation).toMatch(/zero.*on.*any.*zero|score zeroed/i);
  });
});

// ====================================================================
// Default-fallback explanations (one per dimension)
// ====================================================================

describe("computeRiskScore — default-fallback flags in explanation", () => {
  it("missing severity → explanation contains 'defaulted'", () => {
    const r = computeRiskScore(input({ signal: { severity: null, source: "nvd" } }));
    expect(r.explanation).toMatch(/defaulted/i);
  });

  it("missing entity criticality (vendor) → explanation contains 'defaulted'", () => {
    const r = computeRiskScore(input({ entity: { type: "vendor", criticality: null } }));
    expect(r.explanation).toMatch(/defaulted/i);
  });

  it("control-type → explanation contains 'controls have no criticality column'", () => {
    const r = computeRiskScore(input({ entity: { type: "control", criticality: null } }));
    expect(r.explanation).toMatch(/controls have no criticality column/i);
  });

  it("missing obligation priority → explanation contains 'obligation: defaulted' (and NOT 'entity: defaulted')", () => {
    const r = computeRiskScore(
      input({ entity: { type: "obligation", criticality: null, priority: null } })
    );
    expect(r.explanation).toMatch(/obligation:\s*defaulted/i);
    expect(r.explanation).not.toMatch(/entity:\s*defaulted/i);
  });
});

// ====================================================================
// Determinism
// ====================================================================

describe("computeRiskScore — determinism", () => {
  it("same input produces identical output across invocations", () => {
    const i = input({
      signal: { severity: "High", source: "nvd" },
      entity: { type: "vendor", criticality: "high" }
    });
    const r1 = computeRiskScore(i);
    const r2 = computeRiskScore(i);
    const r3 = computeRiskScore(i);
    expect(r2).toEqual(r1);
    expect(r3).toEqual(r1);
  });

  it("invocation does not mutate the input weights object", () => {
    const w = makeWeights();
    const wBefore = JSON.stringify(w);
    computeRiskScore(input({ weights: w }));
    expect(JSON.stringify(w)).toBe(wBefore);
  });

  it("invocation does not mutate the input signal/entity objects", () => {
    const i = input();
    const before = JSON.stringify(i);
    computeRiskScore(i);
    expect(JSON.stringify(i)).toBe(before);
  });
});
