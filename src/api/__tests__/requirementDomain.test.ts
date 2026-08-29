/**
 * requirementDomain.test.ts — the closed domain taxonomy and the
 * requirement→domain rule (VA-Q2 P1; VA-Q0 §5).
 */
import { describe, it, expect } from "vitest";
import {
  ASSESSMENT_DOMAINS,
  DOMAIN_PRECEDENCE,
  DOMAIN_TAGS,
  TAG_DOMAIN,
  domainForRequirement,
  domainForScopeTags,
  isAssessmentDomain,
  summarizeDomains,
} from "../lib/vendorRisk/requirementDomain.js";
import { QUESTION_DOMAINS, domainForScopeTags as reExported } from "../lib/questionnaire/questionContent.js";
import { SCOPE_TAG_VOCABULARY } from "../lib/vendorRisk/requirementScopeTags.js";

describe("assessment domains — one closed vocabulary", () => {
  it("is exactly the six domains, in the 20261059 CHECK's order", () => {
    expect(ASSESSMENT_DOMAINS).toEqual(["security", "privacy", "ai", "resilience", "nth_party", "compliance"]);
  });

  it("is the SAME vocabulary questions.domain uses — never a second copy", () => {
    expect([...ASSESSMENT_DOMAINS]).toEqual([...QUESTION_DOMAINS]);
  });

  it("isAssessmentDomain is closed", () => {
    for (const d of ASSESSMENT_DOMAINS) expect(isAssessmentDomain(d)).toBe(true);
    for (const bad of ["Security", "gdpr", "fourth_party", "", null, undefined, 1, "compliance "]) {
      expect(isAssessmentDomain(bad), String(bad)).toBe(false);
    }
  });

  it("questionContent's domainForScopeTags is the promoted rule, by identity", () => {
    expect(reExported).toBe(domainForScopeTags);
  });
});

describe("tag → domain table", () => {
  it("every mapped tag is in the closed scope-tag vocabulary", () => {
    for (const tag of Object.keys(TAG_DOMAIN)) {
      expect(SCOPE_TAG_VOCABULARY as readonly string[], tag).toContain(tag);
    }
  });

  it("every vocabulary tag belongs to exactly one domain's tag set (security is the floor)", () => {
    const owners = new Map<string, string[]>();
    for (const [domain, tags] of Object.entries(DOMAIN_TAGS)) {
      for (const t of tags) owners.set(t, [...(owners.get(t) ?? []), domain]);
    }
    for (const tag of SCOPE_TAG_VOCABULARY) {
      expect(owners.get(tag), `${tag} has no domain`).toHaveLength(1);
      const expected = TAG_DOMAIN[tag] ?? "security";
      expect(owners.get(tag)![0]).toBe(expected);
    }
    // and nothing outside the vocabulary
    for (const t of owners.keys()) expect(SCOPE_TAG_VOCABULARY as readonly string[]).toContain(t);
  });

  it("compliance has no tags — it is never derived from a tag", () => {
    expect((DOMAIN_TAGS as Record<string, unknown>)["compliance"]).toBeUndefined();
    expect(Object.values(TAG_DOMAIN)).not.toContain("compliance");
    expect(DOMAIN_PRECEDENCE).not.toContain("compliance");
  });
});

describe("domainForScopeTags — precedence and floor (unchanged from questionContent)", () => {
  it("untagged and core-only are security (the floor)", () => {
    expect(domainForScopeTags([])).toBe("security");
    expect(domainForScopeTags(["core"])).toBe("security");
    expect(domainForScopeTags(["access-control", "logging"])).toBe("security");
  });

  it("the most specific non-security domain wins", () => {
    expect(domainForScopeTags(["privacy", "access-control"])).toBe("privacy");
    expect(domainForScopeTags(["ai-governance", "privacy"])).toBe("ai");
    expect(domainForScopeTags(["supply-chain", "resilience"])).toBe("nth_party");
    expect(domainForScopeTags(["business-continuity", "core"])).toBe("resilience");
    expect(domainForScopeTags(["retention", "subprocessor", "human-oversight", "resilience"])).toBe("ai");
  });

  it("an unknown tag is ignored, not an error", () => {
    expect(domainForScopeTags(["niche-topic"])).toBe("security");
    expect(domainForScopeTags(["niche-topic", "privacy"])).toBe("privacy");
  });
});

describe("domainForRequirement — compliance only via an obligation edge", () => {
  it("reached via S3 → compliance regardless of tag", () => {
    expect(domainForRequirement({ scope_tags: ["privacy"] }, true)).toBe("compliance");
    expect(domainForRequirement({ scope_tags: [] }, true)).toBe("compliance");
  });

  it("not reached via S3 → the tag rule", () => {
    expect(domainForRequirement({ scope_tags: ["privacy"] }, false)).toBe("privacy");
    expect(domainForRequirement({ scope_tags: [] }, false)).toBe("security");
  });
});

describe("VA-Q2 P2 — the nine starred VA-Q0 §5 tags map per the ratified table", () => {
  it("security ← vulnerability-management, secure-development (floor: absent from TAG_DOMAIN)", () => {
    for (const t of ["vulnerability-management", "secure-development"]) {
      expect(TAG_DOMAIN[t]).toBeUndefined();
      expect(DOMAIN_TAGS.security).toContain(t);
      expect(domainForScopeTags([t])).toBe("security");
    }
  });
  it("privacy ← data-subject-rights, cross-border, lawful-basis, breach-notification", () => {
    for (const t of ["data-subject-rights", "cross-border", "lawful-basis", "breach-notification"]) {
      expect(TAG_DOMAIN[t]).toBe("privacy");
      expect(DOMAIN_TAGS.privacy).toContain(t);
    }
  });
  it("ai ← training-data, model-provider, automated-decision", () => {
    for (const t of ["training-data", "model-provider", "automated-decision"]) {
      expect(TAG_DOMAIN[t]).toBe("ai");
      expect(DOMAIN_TAGS.ai).toContain(t);
    }
  });
});

describe("VA-Q2 P2 — summarizeDomains (the `domains` read)", () => {
  it("is null when no item carries a domain — a 1.0.0 engagement is not six zeros", () => {
    expect(summarizeDomains([])).toBeNull();
    expect(summarizeDomains([null, null, undefined])).toBeNull();
  });
  it("reports all six keys, zeros included, and the values sum to the stamped count", () => {
    const out = summarizeDomains(["security", "security", "privacy", "compliance"]);
    expect(out).toEqual({ security: 2, privacy: 1, ai: 0, resilience: 0, nth_party: 0, compliance: 1 });
    expect(Object.keys(out!)).toEqual([...ASSESSMENT_DOMAINS]);
    expect(Object.values(out!).reduce((a, b) => a + b, 0)).toBe(4);
  });
  it("never counts a value outside the closed set under any key", () => {
    expect(summarizeDomains(["bogus"])).toBeNull();
    expect(summarizeDomains(["ai", "bogus"])).toEqual({ security: 0, privacy: 0, ai: 1, resilience: 0, nth_party: 0, compliance: 0 });
  });
});
