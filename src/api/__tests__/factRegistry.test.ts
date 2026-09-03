/**
 * factRegistry.test.ts — the closed, versioned fact registry (VA-Q2 P1).
 *
 * What is being held: a fact outside the registry cannot exist; every fact
 * has a type, an origin list and a domain; ranked vocabularies are the
 * inherentRisk.ts ones (never a copy); `policy.*` never comes from a vendor;
 * the two axes (`source` trust class, `origin` mechanism — VA-Q2 P3) are
 * closed with a closed pair table; AI is a trust class that can never be
 * authoritative by registry property; the subject-type allowlist is closed
 * with the reserved types NOT writable.
 */
import { describe, it, expect } from "vitest";
import {
  FACT_KEYS,
  FACT_KEY_PATTERN,
  FACT_REGISTRY,
  FACT_REGISTRY_VERSION,
  ALLOWED_SOURCE_ORIGIN_PAIRS,
  FACT_ORIGINS,
  FACT_SOURCES,
  FACT_SUBJECT_TYPES,
  INTERNAL_FACT_ORIGINS,
  INTERNAL_FACT_SOURCES,
  ORIGIN_PRECEDENCE,
  RESERVED_FACT_SUBJECT_TYPES,
  VERIFYING_FACT_SOURCES,
  aiMayBeAuthoritative,
  isAllowedSourceOrigin,
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

  it("every key matches the P3 DB key shape, has a type, ≥1 allowed origin and ≥1 domain", () => {
    expect(FACT_KEYS.length).toBeGreaterThanOrEqual(40);
    for (const k of FACT_KEYS) {
      expect(k, `${k} shape`).toMatch(FACT_KEY_PATTERN);
      const s = spec(k);
      expect(["bool", "enum", "enum[]", "string[]", "ranked"]).toContain(s.type);
      expect(s.origins.length, `${k} origins`).toBeGreaterThan(0);
      for (const o of s.origins) expect(FACT_ORIGINS).toContain(o);
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
      expect(spec(k).origins).toEqual(["intake"]);
      expect(vendorMayWiden(k)).toBe(false);
    }
  });

  it("policy.* is platform-derived only — never from a vendor, never from intake", () => {
    const policy = FACT_KEYS.filter((k) => k.startsWith("policy."));
    expect(policy.length).toBeGreaterThan(0);
    for (const k of policy) {
      expect(spec(k).origins).toEqual(["derived"]);
      expect(validateFact(k, [], "vendor_response", "vendor_answer").ok).toBe(false);
      expect(validateFact(k, [], "intake", "intake").ok).toBe(false);
      const d = validateFact(k, [], "system_derived", "derived");
      expect(d.ok || d.errors.every((e) => e.field === "value"), k).toBe(true);
    }
  });

  it("the directive's vendor-widenable facts DO accept vendor answers", () => {
    for (const k of ["data.personal_data", "ai.uses_ai", "ai.third_party_models", "ai.customer_data_in_prompts", "nth.subprocessors_declared"]) {
      expect(vendorMayWiden(k as never), k).toBe(true);
    }
  });
});

describe("fact registry — origins and precedence follow VA-Q0 §6.1 exactly", () => {
  it("the six origins (Q0's mechanisms), no more", () => {
    expect([...FACT_ORIGINS].sort()).toEqual(
      ["ai_system_dependency", "derived", "intake", "profile_default", "vendor_answer", "vendor_profile"].sort()
    );
  });

  it("vendor_answer > intake > ai_system_dependency > vendor_profile > profile_default", () => {
    expect(ORIGIN_PRECEDENCE).toEqual(["vendor_answer", "intake", "ai_system_dependency", "vendor_profile", "profile_default"]);
    expect(outranks("vendor_answer", "intake")).toBe(true);
    expect(outranks("intake", "ai_system_dependency")).toBe(true);
    expect(outranks("ai_system_dependency", "vendor_profile")).toBe(true);
    expect(outranks("vendor_profile", "profile_default")).toBe(true);
    expect(outranks("intake", "vendor_answer")).toBe(false);
    expect(outranks("derived", "intake")).toBe(false);
  });

  it("only vendor_answer is a non-internal origin (ADR-0013 R4 'verified' set)", () => {
    expect(INTERNAL_FACT_ORIGINS).not.toContain("vendor_answer");
    expect(FACT_ORIGINS.filter((s) => !INTERNAL_FACT_ORIGINS.includes(s))).toEqual(["vendor_answer"]);
  });
});

describe("fact registry — sources are the five trust classes (D1), paired with origins (VA-Q2 P3)", () => {
  it("the five sources, no more", () => {
    expect([...FACT_SOURCES].sort()).toEqual(["ai_extraction", "intake", "internal_user", "system_derived", "vendor_response"]);
  });

  it("the allowed (source, origin) pair table is exactly the plan's", () => {
    expect(ALLOWED_SOURCE_ORIGIN_PAIRS).toEqual({
      intake: ["intake"],
      internal_user: ["intake"],
      system_derived: ["vendor_profile", "ai_system_dependency", "profile_default", "derived"],
      vendor_response: ["vendor_answer"],
      ai_extraction: ["derived"],
    });
    // every origin is reachable from at least one source, and no pair crosses a trust boundary
    for (const o of FACT_ORIGINS) expect(FACT_SOURCES.some((s) => isAllowedSourceOrigin(s, o)), o).toBe(true);
    expect(isAllowedSourceOrigin("vendor_response", "intake")).toBe(false);
    expect(isAllowedSourceOrigin("ai_extraction", "intake")).toBe(false);
    expect(isAllowedSourceOrigin("ai_extraction", "vendor_answer")).toBe(false);
    expect(isAllowedSourceOrigin("intake", "vendor_answer")).toBe(false);
    expect(isAllowedSourceOrigin("internal_user", "derived")).toBe(false);
  });

  it("internal sources exclude the vendor and the model; only intake/internal_user verify", () => {
    expect([...INTERNAL_FACT_SOURCES].sort()).toEqual(["intake", "internal_user", "system_derived"]);
    expect([...VERIFYING_FACT_SOURCES].sort()).toEqual(["intake", "internal_user"]);
    expect(INTERNAL_FACT_SOURCES).not.toContain("vendor_response");
    expect(INTERNAL_FACT_SOURCES).not.toContain("ai_extraction");
  });

  it("validateFact refuses a pair outside the table with field `source`", () => {
    const v = validateFact("data.personal_data", true, "vendor_response", "intake");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.errors.map((e) => e.field)).toEqual(["source"]);
    const w = validateFact("ai.uses_ai", true, "ai_extraction", "intake");
    expect(w.ok).toBe(false);
    if (!w.ok) expect(w.errors.map((e) => e.field)).toEqual(["source"]);
  });
});

describe("fact registry — AI is never authoritative by registry property", () => {
  it("no ORIGIN is AI-derived under any spelling (precedence never ranks a model)", () => {
    for (const o of FACT_ORIGINS) expect(o).not.toMatch(/ai_(extract|suggest|deriv|analys)|llm|model_/i);
  });

  it("validateFact rejects an invented AI origin for EVERY key", () => {
    for (const k of FACT_KEYS) {
      for (const bad of ["ai_extraction", "ai_suggested", "llm", "derived_by_model"]) {
        const v = validateFact(k, true, "ai_extraction", bad);
        expect(v.ok, `${k} accepted origin ${bad}`).toBe(false);
        if (!v.ok) expect(v.errors.some((e) => e.field === "origin")).toBe(true);
      }
    }
  });

  it("ai_extraction may only reach the store via `derived`, and only for keys that allow `derived`", () => {
    const derivable = FACT_KEYS.filter((k) => spec(k).origins.includes("derived"));
    expect(derivable.every((k) => k.startsWith("policy."))).toBe(true);
    for (const k of FACT_KEYS) {
      const v = validateFact(k, true, "ai_extraction", "derived");
      if (derivable.includes(k)) expect(v.ok || (v.errors.every((e) => e.field === "value"))).toBe(true);
      else expect(v.ok, k).toBe(false);
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
      const v = validateFact("data.personal_data", true, "intake", "intake", t);
      expect(v.ok, t).toBe(false);
      if (!v.ok) expect(v.errors.map((e) => e.field)).toContain("subject_type");
    }
    expect(validateFact("data.personal_data", true, "intake", "intake", "vendor_engagement").ok).toBe(true);
    expect(validateFact("data.personal_data", true, "intake", "intake", "questionnaire").ok).toBe(false);
  });
});

describe("validateFact — negative cases name the field", () => {
  const fields = (v: ReturnType<typeof validateFact>) => (v.ok ? [] : v.errors.map((e) => e.field));

  it("unknown key", () => {
    const v = validateFact("data.does_not_exist", true, "intake", "intake");
    expect(v.ok).toBe(false);
    expect(fields(v)).toEqual(["fact_key"]);
    if (!v.ok) expect(v.errors[0]!.reason).toContain("unregistered");
  });

  it("malformed key shape (not dotted lowercase)", () => {
    for (const k of ["PersonalData", "data", "data.", "data..x", "data.personal-data", "", 42, null, undefined]) {
      expect(fields(validateFact(k, true, "intake", "intake")), String(k)).toContain("fact_key");
    }
    expect(isFactKey("data.personal_data")).toBe(true);
    expect(isFactKey("__proto__")).toBe(false);
  });

  it("wrong type: bool", () => {
    for (const bad of ["true", 1, null, undefined, [], {}]) {
      expect(fields(validateFact("data.personal_data", bad, "intake", "intake"))).toEqual(["value"]);
    }
  });

  it("wrong type / out-of-vocabulary: ranked and enum", () => {
    expect(fields(validateFact("core.data_sensitivity", "top_secret", "intake", "intake"))).toEqual(["value"]);
    expect(fields(validateFact("core.data_sensitivity", 3, "intake", "intake"))).toEqual(["value"]);
    expect(fields(validateFact("service.type", "blockchain", "intake", "intake"))).toEqual(["value"]);
    expect(fields(validateFact("ai.retention_of_inputs", ["none"], "intake", "intake"))).toEqual(["value"]);
  });

  it("malformed lists: non-array, unknown member, duplicate, bad ISO code", () => {
    expect(fields(validateFact("data.categories", "identifiers", "intake", "intake"))).toEqual(["value"]);
    expect(fields(validateFact("data.categories", ["identifiers", "dna"], "intake", "intake"))).toEqual(["value"]);
    expect(fields(validateFact("data.categories", ["identifiers", "identifiers"], "intake", "intake"))).toEqual(["value"]);
    expect(fields(validateFact("data.jurisdictions", ["DE", "germany"], "intake", "intake"))).toEqual(["value"]);
    expect(fields(validateFact("data.jurisdictions", ["DE", ""], "intake", "intake"))).toEqual(["value"]);
    expect(validateFact("data.jurisdictions", ["DE", "US"], "intake", "intake").ok).toBe(true);
    expect(validateFact("data.categories", [], "intake", "intake").ok).toBe(true);
  });

  it("origin not allowed for the key", () => {
    const v = validateFact("core.access_level", "admin", "vendor_response", "vendor_answer");
    expect(fields(v)).toEqual(["origin"]);
    if (!v.ok) expect(v.errors[0]!.reason).toContain("core.access_level");
    expect(fields(validateFact("access.privileged", true, "system_derived", "vendor_profile"))).toEqual(["origin"]);
    expect(fields(validateFact("data.personal_data", true, "nowhere", "intake"))).toEqual(["source"]);
    expect(fields(validateFact("data.personal_data", true, "intake", "nowhere"))).toEqual(["origin"]);
  });

  it("several defects are reported together, each with its field", () => {
    const v = validateFact("core.access_level", 7, "vendor_response", "vendor_answer");
    expect(fields(v).sort()).toEqual(["origin", "value"]);
  });

  it("a valid fact echoes the typed key, value, source and origin", () => {
    const v = validateFact("ai.uses_ai", true, "system_derived", "ai_system_dependency");
    expect(v).toEqual({ ok: true, key: "ai.uses_ai", value: true, source: "system_derived", origin: "ai_system_dependency" });
  });
});
