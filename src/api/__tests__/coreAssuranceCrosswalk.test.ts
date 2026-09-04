/**
 * coreAssuranceCrosswalk.test.ts — the Core Assurance Set joins the governed
 * canonical control crosswalk on exactly the terms the SOC 2 corpus does.
 */

import { describe, expect, it } from "vitest";

import { CANONICAL_CONTROL_CORPUS } from "../lib/controls/canonicalControlCorpus.js";
import { CROSSWALK_CORPORA, scopeOf, templateReferencesFor } from "../lib/controls/crosswalkCorpora.js";
import { isKnownCanonicalFrameworkVersion } from "../lib/controls/canonicalFrameworkIdentity.js";
import {
  CORE_ASSURANCE_1_0_CROSSWALK,
  CORE_ASSURANCE_CROSSWALK_FRAMEWORK_KEY,
  CORE_ASSURANCE_CROSSWALK_FRAMEWORK_VERSION,
} from "../lib/controls/coreAssuranceCrosswalk.js";
import { assertCrosswalkClassification, validateCorpusContent } from "../lib/controls/canonicalControlPublisher.js";
import { CORE_ASSURANCE_REFERENCES } from "../lib/vendorRisk/coreAssuranceSet.js";

const CORPUS_SLUGS = new Set(CANONICAL_CONTROL_CORPUS.map((c) => c.slug));

describe("the Core Assurance crosswalk", () => {
  it("is registered as the third corpus with a known canonical framework identity", () => {
    const corpus = CROSSWALK_CORPORA.find((c) => c.framework_key === CORE_ASSURANCE_CROSSWALK_FRAMEWORK_KEY)!;
    expect(corpus).toBeDefined();
    expect(corpus.framework_version).toBe(CORE_ASSURANCE_CROSSWALK_FRAMEWORK_VERSION);
    expect(isKnownCanonicalFrameworkVersion(corpus.framework_key, corpus.framework_version)).toBe(true);
    expect(CROSSWALK_CORPORA).toHaveLength(3);
  });

  it("covers all sixteen objectives, each template_represented and each mapped to real canonical controls", () => {
    expect(CORE_ASSURANCE_1_0_CROSSWALK.map((e) => e.requirement_reference)).toEqual([...CORE_ASSURANCE_REFERENCES]);
    const templateRefs = templateReferencesFor(
      CORE_ASSURANCE_CROSSWALK_FRAMEWORK_KEY,
      CORE_ASSURANCE_CROSSWALK_FRAMEWORK_VERSION
    )!;
    for (const entry of CORE_ASSURANCE_1_0_CROSSWALK) {
      expect(scopeOf(entry)).toBe("template_represented");
      expect(templateRefs.has(entry.requirement_reference), entry.requirement_reference).toBe(true);
      expect(entry.canonical_control_slugs.length).toBeGreaterThan(0);
      for (const slug of entry.canonical_control_slugs) expect(CORPUS_SLUGS.has(slug), slug).toBe(true);
      expect(entry.rationale.length).toBeGreaterThan(20);
    }
  });

  it("passes the publisher's classification and content validation", () => {
    const corpus = CROSSWALK_CORPORA.find((c) => c.framework_key === CORE_ASSURANCE_CROSSWALK_FRAMEWORK_KEY)!;
    expect(() => assertCrosswalkClassification(corpus)).not.toThrow();
    expect(() => validateCorpusContent()).not.toThrow();
  });

  it("shares canonical controls with the SOC 2 corpus, so a SOC 2 tested control can reach an objective", () => {
    const soc2 = CROSSWALK_CORPORA.find((c) => c.framework_key === "soc2")!;
    const soc2Slugs = new Set(soc2.entries.flatMap((e) => [...e.canonical_control_slugs]));
    const reachable = CORE_ASSURANCE_1_0_CROSSWALK.filter((e) =>
      e.canonical_control_slugs.some((s) => soc2Slugs.has(s))
    );
    // Every objective is reachable from at least one SOC 2 criterion's controls.
    expect(reachable.map((e) => e.requirement_reference)).toEqual([...CORE_ASSURANCE_REFERENCES]);
  });
});
