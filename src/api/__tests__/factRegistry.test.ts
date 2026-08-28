/**
 * factRegistry.test.ts — the closed, versioned fact registry (VA-Q2 P1).
 *
 * What is being held: a fact outside the registry cannot exist; every fact
 * has a type, a source list and a domain; ranked vocabularies are the
 * inherentRisk.ts ones (never a copy); `policy.*` never comes from a vendor;
 * no AI source exists under any spelling; the subject-type allowlist is
 * closed with the reserved types NOT writable.
 */
import { describe, it, expect } from "vitest";
import {
  FACT_KEYS,
  FACT_KEY_PATTERN,
  FACT_REGISTRY,
  FACT_REGISTRY_VERSION,
  FACT_SOURCES,
  FACT_SUBJECT_TYPES,
  INTERNAL_FACT_SOURCES,
  RESERVED_FACT_SUBJECT_TYPES,
  SOURCE_PRECEDENCE,
  aiMayBeAuthoritative,
  factRank,
  isFactKey,
  outranks,
  validateFact,
  vendorMayWiden,
  type FactSpec,
} from "../lib/vendorRisk/factRegistry.js";
import { SCOPE_RULE_VERSION } from "../lib/vendorRisk/methodologyVersion.js";
import { ASSESSMENT_DOMAINS } from "../lib/vendorRisk/requirementDomain.js";
import {
  ACCESS_LEVELS,
  AI_INVOLVEMENT_LEVELS,
  CONCENTRATION_LEVELS,
  DATA_SENSITIVITY_LEVELS,
} from "../lib/vendorRisk/inherentRisk.js";

const spec = (k: string): FactSpec => FACT_REGISTRY[k as keyof typeof FACT_REGISTRY] as FactSpec;

describe("fact registry — closed and versioned", () => {
  it("is versioned with the scope-rule corpus", () => {
    expect(FACT_REGISTRY_VERSION).toBe(SCOPE_RULE_VERSION);
    expect(SCOPE_RULE_VERSION).toBe("1.1.0");
  });

  it("every key matches the P3 DB key shape, has a type, ≥1 allowed source and ≥1 domain", () => {
    expect(FACT_KEYS.length).toBeGreaterThanOrEqual(40);
    for (const k of FACT_KEYS) {
      expect(k, `${k} shape`).toMatch(FACT_KEY_PATTERN);
      const s = spec(k);
      expect(["bool", "enum", "enum[]", "string[]", "ranked"]).toContain(s.type);
      expect(s.sources.length, `${k} sources`).toBeGreaterThan(0);
      for (const src of s.sources) expect(FACT_SOURCES).toContain(src);
      expect(s.domains.length, `${k} domains`).toBeGreaterThan(0);
      for (const d of s.domains) expect(ASSESSMENT_DOMAINS).toContain(d);
    }
  });

  it("ranked vocabularies are total orders with no duplicates", () => {
    for (const k of FACT_KEYS) {
      const s = spec(k);
      if (s.type !== "ranked") continue;
      expect(new Set(s.ranked).size, `${k} ranked has duplicates`).toBe(s.ranked.length);
      for (let i = 0; i < s.ranked.length; i++) expect(factRank(k, s.ranked[i])).toBe(i);
      expect(factRank(k, "not-a-level")).toBe(-1);
    }
  });

  it("core.* vocabularies ARE the inherentRisk.ts arrays — by identity, not by copy", () => {
    expect((spec("core.data_sensitivity") as { ranked: unknown }).ranked).toBe(DATA_SENSITIVITY_LEVELS);
    expect((spec("core.access_level") as { ranked: unknown }).ranked).toBe(ACCESS_LEVELS);
    expect((spec("core.ai_involvement") as { ranked: unknown }).ranked).toBe(AI_INVOLVEMENT_LEVELS);
    expect((spec("core.concentration") as { ranked: unknown }).ranked).toBe(CONCENTRATION_LEVELS);
  });

  it("the 13 core facts are intake-only — a vendor cannot answer its own inherent risk", () => {
    const core = FACT_KEYS.filter((k) => k.startsWith("core."));
    expect(core).toHaveLength(13);
    for (const k of core) {
      expect(spec(k).sources).toEqual(["intake"]);
      expect(vendorMayWiden(k)).toBe(false);
    }
  });

  it("policy.* is platform-derived only — never from a vendor, never from intake", () => {
    const policy = FACT_KEYS.filter((k) => k.startsWith("policy."));
    expect(policy.length).toBeGreaterThan(0);
    for (const k of policy) {
      expect(spec(k).sources).toEqual(["derived"]);
      expect(validateFact(k, [], "vendor_answer").ok).toBe(false);
      expect(validateFact(k, [], "intake").ok).toBe(false);
    }
  });

  it("the directive's vendor-widenable facts DO accept vendor answers", () => {
    for (const k of ["data.personal_data", "ai.uses_ai", "ai.third_party_models", "ai.customer_data_in_prompts", "nth.subprocessors_declared"]) {
      expect(vendorMayWiden(k as never), k).toBe(true);
    }
  });
});

describe("fact registry — sources and precedence follow VA-Q0 §6.1 exactly", () => {
  it("the six sources, no more", () => {
    expect([...FACT_SOURCES].sort()).toEqual(
      ["ai_system_dependency", "derived", "intake", "profile_default", "vendor_answer", "vendor_profile"].sort()
    );
  });

  it("vendor_answer > intake > ai_system_dependency > vendor_profile > profile_default", () => {
    expect(SOURCE_PRECEDENCE).toEqual(["vendor_answer", "intake", "ai_system_dependency", "vendor_profile", "profile_default"]);
    expect(outranks("vendor_answer", "intake")).toBe(true);
    expect(outranks("intake", "ai_system_dependency")).toBe(true);
    expect(outranks("ai_system_dependency", "vendor_profile")).toBe(true);
    expect(outranks("vendor_profile", "profile_default")).toBe(true);
    expect(outranks("intake", "vendor_answer")).toBe(false);
    expect(outranks("derived", "intake")).toBe(false);
  });

  it("only vendor_answer is non-internal (ADR-0013 R4 'verified' set)", () => {
    expect(INTERNAL_FACT_SOURCES).not.toContain("vendor_answer");
    expect(FACT_SOURCES.filter((s) => !INTERNAL_FACT_SOURCES.includes(s))).toEqual(["vendor_answer"]);
  });
});

describe("fact registry — AI is never a source, never authoritative", () => {
  it("no source is AI-derived under any spelling", () => {
    for (const s of FACT_SOURCES) expect(s).not.toMatch(/ai_(extract|suggest|deriv|analys)|llm|model_/i);
  });

  it("validateFact rejects an AI source for EVERY key", () => {
    for (const k of FACT_KEYS) {
      for (const bad of ["ai_extraction", "ai_suggested", "llm", "derived_by_model"]) {
        const v = validateFact(k, true, bad);
        expect(v.ok, `${k} accepted ${bad}`).toBe(false);
        if (!v.ok) expect(v.errors.some((e) => e.field === "source")).toBe(true);
      }
    }
  });

  it("aiMayBeAuthoritative is false for every registered key", () => {
    for (const k of FACT_KEYS) expect(aiMayBeAuthoritative(k)).toBe(false);
  });
});

describe("fact registry — subject-type allowlist (D1 option B)", () => {
  it("vendor_engagement is the only ACTIVE subject type in Q2", () => {
    expect(FACT_SUBJECT_TYPES).toEqual(["vendor_engagement"]);
  });

  it("the reserved types are named but NOT writable", () => {
    expect([...RESERVED_FACT_SUBJECT_TYPES].sort()).toEqual(["ai_system", "asset", "organization", "vendor"]);
    for (const t of RESERVED_FACT_SUBJECT_TYPES) {
      const v = validateFact("data.personal_data", true, "intake", t);
      expect(v.ok, t).toBe(false);
      if (!v.ok) expect(v.errors.map((e) => e.field)).toContain("subject_type");
    }
    expect(validateFact("data.personal_data", true, "intake", "vendor_engagement").ok).toBe(true);
    expect(validateFact("data.personal_data", true, "intake", "questionnaire").ok).toBe(false);
  });
});

describe("validateFact — negative cases name the field", () => {
  const fields = (v: ReturnType<typeof validateFact>) => (v.ok ? [] : v.errors.map((e) => e.field));

  it("unknown key", () => {
    const v = validateFact("data.does_not_exist", true, "intake");
    expect(v.ok).toBe(false);
    expect(fields(v)).toEqual(["fact_key"]);
    if (!v.ok) expect(v.errors[0]!.reason).toContain("unregistered");
  });

  it("malformed key shape (not dotted lowercase)", () => {
    for (const k of ["PersonalData", "data", "data.", "data..x", "data.personal-data", "", 42, null, undefined]) {
      expect(fields(validateFact(k, true, "intake")), String(k)).toContain("fact_key");
    }
    expect(isFactKey("data.personal_data")).toBe(true);
    expect(isFactKey("__proto__")).toBe(false);
  });

  it("wrong type: bool", () => {
    for (const bad of ["true", 1, null, undefined, [], {}]) {
      expect(fields(validateFact("data.personal_data", bad, "intake"))).toEqual(["value"]);
    }
  });

  it("wrong type / out-of-vocabulary: ranked and enum", () => {
    expect(fields(validateFact("core.data_sensitivity", "top_secret", "intake"))).toEqual(["value"]);
    expect(fields(validateFact("core.data_sensitivity", 3, "intake"))).toEqual(["value"]);
    expect(fields(validateFact("service.type", "blockchain", "intake"))).toEqual(["value"]);
    expect(fields(validateFact("ai.retention_of_inputs", ["none"], "intake"))).toEqual(["value"]);
  });

  it("malformed lists: non-array, unknown member, duplicate, bad ISO code", () => {
    expect(fields(validateFact("data.categories", "identifiers", "intake"))).toEqual(["value"]);
    expect(fields(validateFact("data.categories", ["identifiers", "dna"], "intake"))).toEqual(["value"]);
    expect(fields(validateFact("data.categories", ["identifiers", "identifiers"], "intake"))).toEqual(["value"]);
    expect(fields(validateFact("data.jurisdictions", ["DE", "germany"], "intake"))).toEqual(["value"]);
    expect(fields(validateFact("data.jurisdictions", ["DE", ""], "intake"))).toEqual(["value"]);
    expect(validateFact("data.jurisdictions", ["DE", "US"], "intake").ok).toBe(true);
    expect(validateFact("data.categories", [], "intake").ok).toBe(true);
  });

  it("source not allowed for the key", () => {
    const v = validateFact("core.access_level", "admin", "vendor_answer");
    expect(fields(v)).toEqual(["source"]);
    if (!v.ok) expect(v.errors[0]!.reason).toContain("core.access_level");
    expect(fields(validateFact("access.privileged", true, "vendor_profile"))).toEqual(["source"]);
    expect(fields(validateFact("data.personal_data", true, "nowhere"))).toEqual(["source"]);
  });

  it("several defects are reported together, each with its field", () => {
    const v = validateFact("core.access_level", 7, "vendor_answer");
    expect(fields(v).sort()).toEqual(["source", "value"]);
  });

  it("a valid fact echoes the typed key, value and source", () => {
    const v = validateFact("ai.uses_ai", true, "ai_system_dependency");
    expect(v).toEqual({ ok: true, key: "ai.uses_ai", value: true, source: "ai_system_dependency" });
  });
});
