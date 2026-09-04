/**
 * curatedFrameworkTags.test.ts — the curated regulatory corpus, pinned.
 *
 * This file is the deterministic half of the fix for the defect where the
 * keyword tagger silently classified regulatory and AI requirements as security:
 *
 *   - all 4 NIST AI RMF functions fell through to the `core` fallback, so
 *     activating the AI-governance framework produced an EMPTY AI question set;
 *   - 6 of 8 CCPA and 3 of 12 GDPR requirements did the same;
 *   - GDPR "Transparency and Privacy Notices" matched the `explainability`
 *     pattern (/transparen/) and became an AI question.
 *
 * What is asserted here is not "the map has 24 rows" but the thing that actually
 * matters to a vendor filling in a questionnaire: every curated requirement is
 * asked under the domain a curator INTENDED, and no curated requirement reaches
 * the security domain by accident.
 */

import { describe, expect, it } from "vitest";

import {
  ALL_CURATED_FRAMEWORK_TAGS,
  CURATED_TEMPLATE_KEYS,
  curatedDomain,
  curatedTaggingFor,
  isCuratedTemplate,
  resolveScopeTags,
} from "../lib/vendorRisk/curatedFrameworkTags.js";
import { FRAMEWORK_TEMPLATES } from "../lib/frameworkTemplates.js";
import {
  SCOPE_TAG_SOURCES,
  SCOPE_TAG_VOCABULARY,
  scopeTagCoverage,
} from "../lib/vendorRisk/requirementScopeTags.js";
import { ASSESSMENT_DOMAINS } from "../lib/vendorRisk/requirementDomain.js";

/** Every curated (templateKey, reference_id, entry) triple, flattened. */
const ALL_ENTRIES = CURATED_TEMPLATE_KEYS.flatMap((key) =>
  Object.entries(ALL_CURATED_FRAMEWORK_TAGS[key]!).map(
    ([referenceId, entry]) => ({ key, referenceId, entry }) as const
  )
);

describe("the curated map covers its templates exactly", () => {
  it("curates exactly the three shipped regulatory/AI templates plus the Core Assurance Set", () => {
    expect([...CURATED_TEMPLATE_KEYS].sort()).toEqual([
      "ccpa",
      "gdpr",
      "nist_ai_rmf",
      "securelogic_core_assurance",
    ]);
  });

  it("every curated template key is a real framework template", () => {
    for (const key of CURATED_TEMPLATE_KEYS) {
      expect(Object.keys(FRAMEWORK_TEMPLATES)).toContain(key);
    }
  });

  it.each(CURATED_TEMPLATE_KEYS)(
    "%s: every shipped requirement is curated — none can fall back",
    (key) => {
      const shipped = FRAMEWORK_TEMPLATES[key]!.requirements.map((r) => r.reference_id);
      const curatedRefs = Object.keys(ALL_CURATED_FRAMEWORK_TAGS[key]!);
      // Both directions. A requirement added to the template without a curation
      // entry would silently become a security question; a curation entry for a
      // requirement that no longer ships is dead reference data.
      expect([...curatedRefs].sort()).toEqual([...shipped].sort());
    }
  );

  it("covers all 40 currently shipped requirements (24 regulatory/AI + 16 Core Assurance)", () => {
    expect(ALL_ENTRIES).toHaveLength(40);
    expect(FRAMEWORK_TEMPLATES["securelogic_core_assurance"]!.requirements).toHaveLength(16);
    expect(FRAMEWORK_TEMPLATES["gdpr"]!.requirements).toHaveLength(12);
    expect(FRAMEWORK_TEMPLATES["ccpa"]!.requirements).toHaveLength(8);
    expect(FRAMEWORK_TEMPLATES["nist_ai_rmf"]!.requirements).toHaveLength(4);
  });

  it("uses only closed-vocabulary tags, and never an empty tag list", () => {
    for (const { key, referenceId, entry } of ALL_ENTRIES) {
      expect(entry.tags.length, `${key}/${referenceId}`).toBeGreaterThan(0);
      for (const tag of entry.tags) {
        expect(SCOPE_TAG_VOCABULARY as readonly string[], `${key}/${referenceId}`).toContain(tag);
      }
    }
  });

  it("names a real domain, and carries a curator's reason", () => {
    for (const { key, referenceId, entry } of ALL_ENTRIES) {
      expect(ASSESSMENT_DOMAINS as readonly string[], `${key}/${referenceId}`).toContain(entry.domain);
      expect(entry.why.length, `${key}/${referenceId}`).toBeGreaterThan(20);
    }
  });
});

describe("every curated requirement is asked under the domain it was curated for", () => {
  it.each(ALL_ENTRIES.map((e) => [`${e.key}/${e.referenceId}`, e] as const))(
    "%s resolves to its intended domain",
    (_label, { entry }) => {
      // The whole point of the `domain` field: a tag edit that moves a
      // requirement into a different question set fails here rather than
      // quietly changing what vendors are asked.
      expect(curatedDomain(entry)).toBe(entry.domain);
    }
  );

  it("no curated requirement reaches the security domain by accident", () => {
    for (const { key, referenceId, entry } of ALL_ENTRIES) {
      if (entry.domain === "security") {
        expect(entry.deliberate_security, `${key}/${referenceId} is security but not marked deliberate`).toBe(true);
      } else {
        expect(entry.deliberate_security, `${key}/${referenceId}`).toBeUndefined();
      }
    }
  });

  it("the only deliberate security classifications are the two security-in-a-privacy-law articles and the Core Assurance security objectives", () => {
    const deliberate = ALL_ENTRIES.filter((e) => e.entry.deliberate_security).map(
      (e) => `${e.key}/${e.referenceId}`
    );
    const coreSecurity = ALL_ENTRIES.filter(
      (e) => e.key === "securelogic_core_assurance" && e.entry.domain === "security"
    ).map((e) => `${e.key}/${e.referenceId}`);
    expect(coreSecurity.length).toBe(13);
    expect(deliberate.sort()).toEqual(["ccpa/CCPA-8", "gdpr/Art-32", ...coreSecurity].sort());
  });
});

describe("the regressions that made this package necessary", () => {
  it("all four NIST AI RMF functions are AI questions, not security ones", () => {
    const refs = ["GOVERN", "MAP", "MEASURE", "MANAGE"];
    for (const ref of refs) {
      const entry = curatedTaggingFor("nist_ai_rmf", ref);
      expect(entry, ref).not.toBeNull();
      expect(curatedDomain(entry!), ref).toBe("ai");
    }
    // Before curation every one of these resolved to `security` via the
    // `core` fallback, which left the AI question set empty.
    expect(refs.every((r) => curatedDomain(curatedTaggingFor("nist_ai_rmf", r)!) === "ai")).toBe(true);
  });

  it("GDPR Art-12-14 is a privacy question, not an AI one", () => {
    const entry = curatedTaggingFor("gdpr", "Art-12-14")!;
    expect(curatedDomain(entry)).toBe("privacy");
    // The heuristic tagged it `explainability` off the word "Transparency",
    // and AI outranks privacy in DOMAIN_PRECEDENCE.
    expect(entry.tags).not.toContain("explainability");
  });

  it("GDPR Art-28 is the nth-party question the processor-agreement duty actually is", () => {
    const entry = curatedTaggingFor("gdpr", "Art-28")!;
    expect(curatedDomain(entry)).toBe("nth_party");
    // Tagging it `privacy` too would have hidden it: privacy outranks nth_party.
    expect(entry.tags).not.toContain("privacy");
  });

  it("the curated corpus reaches five domains (resilience arrives with the Core Assurance Set)", () => {
    const domains = new Set(ALL_ENTRIES.map((e) => curatedDomain(e.entry)));
    expect([...domains].sort()).toEqual(["ai", "nth_party", "privacy", "resilience", "security"]);
  });

  it("security gains exactly the two deliberate regulatory requirements plus the thirteen Core Assurance security objectives, not eleven accidental ones", () => {
    const security = ALL_ENTRIES.filter((e) => curatedDomain(e.entry) === "security");
    const regulatory = security.filter((e) => e.key !== "securelogic_core_assurance");
    expect(regulatory).toHaveLength(2);
    expect(security).toHaveLength(15);
  });
});

describe("resolveScopeTags precedence", () => {
  it("curated reference data wins over the heuristic", () => {
    // "Analyze and Assess AI Risks..." matches no pattern; without the map it
    // would fall back to core/uncurated.
    const resolved = resolveScopeTags({
      templateKey: "nist_ai_rmf",
      reference_id: "MEASURE",
      title: FRAMEWORK_TEMPLATES["nist_ai_rmf"]!.requirements.find((r) => r.reference_id === "MEASURE")!.title,
    });
    expect(resolved.source).toBe("curated");
    expect(resolved.uncurated).toBe(false);
    expect(resolved.tags).toEqual(["ai-governance", "model-risk", "training-data"]);
  });

  it("a matched pattern with no curation is 'heuristic'", () => {
    const resolved = resolveScopeTags({
      reference_id: "AC-1",
      title: "Access Control Policy and Procedures",
    });
    expect(resolved.source).toBe("heuristic");
    expect(resolved.uncurated).toBe(false);
    expect(resolved.tags).toContain("access-control");
  });

  it("nothing matched is 'uncurated' — it keeps `core` but stops claiming a decision", () => {
    const resolved = resolveScopeTags({
      reference_id: "XX-1",
      title: "Facilities Signage and Wayfinding",
    });
    expect(resolved.source).toBe("uncurated");
    expect(resolved.uncurated).toBe(true);
    // The fallback stays: `core` IS the entire tier-4 baseline, and an untagged
    // requirement is invisible to every tier below 1.
    expect(resolved.tags).toEqual(["core"]);
  });

  it("an uncurated template key resolves like no key at all", () => {
    const title = "Facilities Signage and Wayfinding";
    expect(resolveScopeTags({ templateKey: "cis_v8", reference_id: "XX-1", title }).source).toBe("uncurated");
    expect(resolveScopeTags({ templateKey: null, reference_id: "XX-1", title }).source).toBe("uncurated");
    expect(isCuratedTemplate("cis_v8")).toBe(false);
  });

  it("an unknown reference_id inside a curated template still resolves, unclaimed", () => {
    const resolved = resolveScopeTags({
      templateKey: "gdpr",
      reference_id: "Art-99",
      title: "Something Not Shipped",
    });
    expect(resolved.source).toBe("uncurated");
    expect(curatedTaggingFor("gdpr", "Art-99")).toBeNull();
  });

  it("is deterministic — same input, same tags, every time", () => {
    const once = resolveScopeTags({ templateKey: "gdpr", reference_id: "Art-5", title: "x" });
    for (let i = 0; i < 50; i++) {
      expect(resolveScopeTags({ templateKey: "gdpr", reference_id: "Art-5", title: "x" })).toEqual(once);
    }
  });
});

describe("unknown is observable, and distinct from deliberate security", () => {
  it("'uncurated' is part of the source vocabulary", () => {
    expect([...SCOPE_TAG_SOURCES].sort()).toEqual(["curated", "heuristic", "uncurated"]);
  });

  it("coverage counts unknown rows separately from curated and heuristic ones", () => {
    const coverage = scopeTagCoverage([
      { tags: ["core"], source: "curated" },      // CCPA-8: a decision
      { tags: ["core"], source: "uncurated" },    // nobody looked
      { tags: ["core"], source: "uncurated" },
      { tags: ["access-control"], source: "heuristic" },
    ]);
    expect(coverage.total).toBe(4);
    expect(coverage.curated).toBe(1);
    expect(coverage.heuristic).toBe(1);
    expect(coverage.uncurated).toBe(2);
    expect(coverage.curated_pct).toBe(25);
  });

  it("two rows with identical tags are still distinguishable by source", () => {
    // This is the defect in one assertion: before 'uncurated' existed, these
    // two rows were byte-identical in the database.
    const deliberate = curatedTaggingFor("ccpa", "CCPA-8")!;
    const unknown = resolveScopeTags({ reference_id: "XX-1", title: "Facilities Signage and Wayfinding" });
    expect([...deliberate.tags]).toEqual(unknown.tags);
    expect(curatedDomain(deliberate)).toBe("security");
    expect(deliberate.deliberate_security).toBe(true);
    expect(unknown.source).toBe("uncurated");
  });
});
