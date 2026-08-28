/**
 * factResolver.test.ts — precedence, the widen-only rule, and the 13-input
 * mirror (VA-Q2 P1; VA-Q0 §4.3, §6.1; ADR-0013 R4).
 *
 * No vendor-answer WRITER exists until Q3. These tests assert the rule now,
 * so the writer arrives into a resolver that already refuses to let a vendor
 * narrow its own assessment.
 */
import { describe, it, expect } from "vitest";
import {
  CORE_FACT_KEYS,
  factAssertedBy,
  factAtLeast,
  factBool,
  factsFromInherent,
  inherentFromFacts,
  resolveFacts,
} from "../lib/vendorRisk/factResolver.js";
import { FACT_KEYS, type FactRow, type FactSource } from "../lib/vendorRisk/factRegistry.js";
import type { InherentRiskInput } from "../lib/vendorRisk/inherentRisk.js";

const benign: InherentRiskInput = {
  data_sensitivity: "none",
  data_volume: "minimal",
  access_level: "none",
  operational_dependency: "low",
  recoverability: "hours",
  business_criticality: "low",
  regulatory_exposure: "none",
  regulatory_breach_notification: false,
  ai_involvement: "none",
  ai_autonomy: "none",
  hosting_model: "on_prem",
  fourth_party_exposure: "none",
  concentration: "none",
};

const loud: InherentRiskInput = {
  data_sensitivity: "restricted",
  data_volume: "mass",
  access_level: "network_access",
  operational_dependency: "critical",
  recoverability: "none",
  business_criticality: "critical",
  regulatory_exposure: "high",
  regulatory_breach_notification: true,
  ai_involvement: "core",
  ai_autonomy: "autonomous_consequential",
  hosting_model: "multi_tenant_saas",
  fourth_party_exposure: "high",
  concentration: "single_point_of_failure",
};

const row = (fact_key: string, value: unknown, source: FactSource, captured_at?: string): FactRow => ({
  fact_key,
  value,
  source,
  captured_at,
});

describe("factsFromInherent — the 13-input mirror", () => {
  it("is a bijection over the 13 inputs", () => {
    const rows = factsFromInherent(loud);
    expect(rows).toHaveLength(13);
    expect(new Set(rows.map((r) => r.fact_key)).size).toBe(13);
    expect(rows.every((r) => r.source === "intake" && r.fact_key.startsWith("core."))).toBe(true);
    // every core.* registry key is produced, and nothing else
    const coreKeys = FACT_KEYS.filter((k) => k.startsWith("core.")).sort();
    expect(rows.map((r) => r.fact_key).sort()).toEqual(coreKeys);
    expect(Object.keys(CORE_FACT_KEYS).sort()).toEqual(Object.keys(loud).sort());
  });

  it("round-trips: inherentFromFacts(resolveFacts(factsFromInherent(x))) === x", () => {
    for (const input of [benign, loud]) {
      const back = inherentFromFacts(resolveFacts(factsFromInherent(input)), benign);
      expect(back).toEqual(input);
    }
  });

  it("output is byte-stable across runs", () => {
    expect(JSON.stringify(factsFromInherent(loud))).toBe(JSON.stringify(factsFromInherent({ ...loud })));
  });
});

describe("resolveFacts — precedence (VA-Q0 §6.1)", () => {
  const cases: Array<{ name: string; rows: FactRow[]; expectSource: FactSource; expectValue: unknown }> = [
    {
      name: "intake beats ai_system_dependency, vendor_profile, profile_default",
      rows: [
        row("ai.use_cases", ["search"], "profile_default"),
        row("ai.use_cases", ["assistant"], "vendor_profile"),
        row("ai.use_cases", ["generation"], "ai_system_dependency"),
        row("ai.use_cases", ["prediction"], "intake"),
      ],
      expectSource: "intake",
      expectValue: ["prediction"],
    },
    {
      name: "ai_system_dependency beats vendor_profile",
      rows: [row("ai.generative", false, "vendor_profile"), row("ai.generative", true, "ai_system_dependency")],
      expectSource: "ai_system_dependency",
      expectValue: true,
    },
    {
      name: "vendor_profile beats profile_default",
      rows: [row("service.customer_facing", true, "profile_default"), row("service.customer_facing", false, "vendor_profile")],
      expectSource: "vendor_profile",
      expectValue: false,
    },
    {
      name: "a vendor answer with no internal value stands on its own",
      rows: [row("nth.subprocessors_declared", true, "vendor_answer")],
      expectSource: "vendor_answer",
      expectValue: true,
    },
    {
      name: "the most recent vendor answer wins among vendor answers",
      rows: [
        row("data.personal_data", true, "vendor_answer", "2026-08-01T00:00:00Z"),
        row("data.personal_data", false, "vendor_answer", "2026-08-20T00:00:00Z"),
      ],
      expectSource: "vendor_answer",
      expectValue: false,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const f = resolveFacts(c.rows);
      const key = c.rows[0]!.fact_key as keyof typeof f;
      expect(f[key]?.source).toBe(c.expectSource);
      expect(f[key]?.value).toEqual(c.expectValue);
    });
  }

  it("row order does not matter", () => {
    const rows = [
      row("ai.use_cases", ["prediction"], "intake"),
      row("ai.use_cases", ["search"], "profile_default"),
      row("ai.use_cases", ["assistant"], "vendor_profile"),
    ];
    expect(JSON.stringify(resolveFacts(rows))).toBe(JSON.stringify(resolveFacts([...rows].reverse())));
  });

  it("records every source that spoke, highest precedence first", () => {
    const f = resolveFacts([row("ai.uses_ai", true, "vendor_profile"), row("ai.uses_ai", true, "ai_system_dependency"), row("ai.uses_ai", true, "intake")]);
    expect(f["ai.uses_ai"]?.contributing_sources).toEqual(["intake", "ai_system_dependency", "vendor_profile"]);
    expect(factAssertedBy(f, "ai.uses_ai", "ai_system_dependency")).toBe(true);
    expect(factAssertedBy(f, "ai.uses_ai", "vendor_answer")).toBe(false);
  });
});

describe("resolveFacts — a vendor answer can only WIDEN (ADR-0013 R4, T-6)", () => {
  it("ranked: vendor cannot lower a value below intake", () => {
    const f = resolveFacts([row("data.volume_band", "large", "intake"), row("data.volume_band", "minimal", "vendor_answer")]);
    expect(f["data.volume_band"]?.value).toBe("large");
    expect(f["data.volume_band"]?.source).toBe("intake");
    expect(factAtLeast(f, "data.volume_band", "large")).toBe(true);
  });

  it("ranked: vendor CAN raise a value above intake", () => {
    const f = resolveFacts([row("data.volume_band", "minimal", "intake"), row("data.volume_band", "mass", "vendor_answer")]);
    expect(f["data.volume_band"]?.value).toBe("mass");
    expect(f["data.volume_band"]?.source).toBe("vendor_answer");
  });

  it("bool: an internal `true` cannot be answered away", () => {
    const f = resolveFacts([row("data.personal_data", true, "intake"), row("data.personal_data", false, "vendor_answer")]);
    expect(factBool(f, "data.personal_data")).toBe(true);
    expect(f["data.personal_data"]?.source).toBe("intake");
  });

  it("bool: a vendor `true` widens over an internal `false`", () => {
    const f = resolveFacts([row("data.personal_data", false, "intake"), row("data.personal_data", true, "vendor_answer")]);
    expect(factBool(f, "data.personal_data")).toBe(true);
    expect(f["data.personal_data"]?.source).toBe("vendor_answer");
  });

  it("lists: a vendor may add entries, never remove them", () => {
    const f = resolveFacts([row("data.categories", ["identifiers", "financial"], "intake"), row("data.categories", ["contact"], "vendor_answer")]);
    expect(f["data.categories"]?.value).toEqual(["identifiers", "financial", "contact"]);
  });

  it("unordered enum: a vendor cannot override an internal value at all", () => {
    const f = resolveFacts([row("ai.retention_of_inputs", "none", "intake"), row("ai.retention_of_inputs", "indefinite", "vendor_answer")]);
    expect(f["ai.retention_of_inputs"]?.value).toBe("none");
  });

  it("the widen rule holds against EVERY internal source, not only intake", () => {
    for (const src of ["ai_system_dependency", "vendor_profile", "profile_default"] as const) {
      const f = resolveFacts([row("ai.uses_ai", true, src), row("ai.uses_ai", false, "vendor_answer")]);
      expect(factBool(f, "ai.uses_ai"), src).toBe(true);
    }
  });

  it("the reassessment view drops vendor answers entirely (R4 clarification: may be narrower)", () => {
    const rows = [row("data.personal_data", false, "intake"), row("data.personal_data", true, "vendor_answer")];
    expect(factBool(resolveFacts(rows), "data.personal_data")).toBe(true);
    expect(factBool(resolveFacts(rows, { verifiedOnly: true }), "data.personal_data")).toBe(false);
  });
});

describe("resolveFacts — AI-derived values are never authoritative", () => {
  it("a row under an AI source is ignored, never resolved", () => {
    const f = resolveFacts([row("ai.uses_ai", true, "ai_extraction" as FactSource), row("ai.uses_ai", true, "ai_suggested" as FactSource)]);
    expect(f["ai.uses_ai"]).toBeUndefined();
  });

  it("an AI proposal is not a FactRow — it has no source and cannot enter the set", () => {
    const proposal = { fact_key: "ai.uses_ai", proposed_value: true, proposed_by: "ai_extraction", rationale: "mentions LLM" };
    const f = resolveFacts([proposal as unknown as FactRow]);
    expect(f["ai.uses_ai"]).toBeUndefined();
  });

  it("an invalid value is skipped, never coerced — a rule must not fire on garbage", () => {
    const f = resolveFacts([row("data.personal_data", "yes", "intake"), row("core.access_level", "root", "intake"), row("not.a.key", true, "intake")]);
    expect(Object.keys(f)).toEqual([]);
  });
});

describe("resolveFacts — subject-agnostic (D1 option B)", () => {
  it("accepts rows of one subject of any active type", () => {
    const subject = { subject_type: "vendor_engagement" as const, subject_id: "eng-1" };
    const f = resolveFacts([{ ...row("data.personal_data", true, "intake"), subject }]);
    expect(factBool(f, "data.personal_data")).toBe(true);
  });

  it("refuses to merge rows of two subjects", () => {
    expect(() =>
      resolveFacts([
        { ...row("data.personal_data", true, "intake"), subject: { subject_type: "vendor_engagement", subject_id: "eng-1" } },
        { ...row("ai.uses_ai", true, "intake"), subject: { subject_type: "vendor_engagement", subject_id: "eng-2" } },
      ])
    ).toThrow(/more than one subject/);
  });
});
