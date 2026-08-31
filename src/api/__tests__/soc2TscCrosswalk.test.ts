/**
 * soc2TscCrosswalk.test.ts — VA-S4-4C-1.
 *
 * Same standard as the NIST CSF corpus: the value of a crosswalk is entirely in
 * whether it joins to something real. A curation pass against references this
 * codebase never writes would be correct and vacuous. So the central test is
 * "does every requirement reference correspond to a requirement row that
 * POST /api/frameworks/activate actually creates", not "is the content
 * well-formed".
 *
 * It also pins the KNOWN GAP — the confidentiality, processing-integrity and
 * privacy series are not in the shipped template and not in this corpus — so
 * the module header's honesty claim cannot rot into silence.
 */

import { describe, expect, it } from "vitest";

import { CANONICAL_CONTROL_CORPUS } from "../lib/controls/canonicalControlCorpus.js";
import { CROSSWALK_CORPORA } from "../lib/controls/crosswalkCorpora.js";
import { isKnownCanonicalFrameworkVersion } from "../lib/controls/canonicalFrameworkIdentity.js";
import {
  SOC2_FRAMEWORK_KEY,
  SOC2_FRAMEWORK_VERSION,
  SOC2_TSC_2017_CROSSWALK,
} from "../lib/controls/soc2TscCrosswalk.js";
import { FRAMEWORK_TEMPLATES } from "../lib/frameworkTemplates.js";

const TEMPLATE = FRAMEWORK_TEMPLATES.soc2!;
const TEMPLATE_REFS = TEMPLATE.requirements.map((r) => r.reference_id);
const CORPUS_SLUGS = new Set(CANONICAL_CONTROL_CORPUS.map((c) => c.slug));
const MAPPED_SLUGS = new Set(SOC2_TSC_2017_CROSSWALK.flatMap((e) => [...e.canonical_control_slugs]));

describe("the SOC 2 crosswalk joins to content this codebase actually writes", () => {
  it("targets the version FRAMEWORK_TEMPLATES creates", () => {
    expect(TEMPLATE.version).toBe(SOC2_FRAMEWORK_VERSION);
    expect(TEMPLATE.name).toBe("SOC 2 Type II");
  });

  it("its (framework_key, framework_version) is in the canonical registry — the FK target", () => {
    expect(isKnownCanonicalFrameworkVersion(SOC2_FRAMEWORK_KEY, SOC2_FRAMEWORK_VERSION)).toBe(true);
  });

  it("every requirement_reference is one the template creates", () => {
    for (const entry of SOC2_TSC_2017_CROSSWALK) {
      expect(TEMPLATE_REFS, entry.requirement_reference).toContain(entry.requirement_reference);
    }
  });

  it("covers ALL 36 template references — the completeness claim in the module header", () => {
    const covered = new Set(SOC2_TSC_2017_CROSSWALK.map((e) => e.requirement_reference));
    expect(TEMPLATE_REFS.filter((r) => !covered.has(r))).toEqual([]);
    expect(TEMPLATE_REFS.length).toBe(36);
  });

  it("carries one entry per reference — a duplicate reference is two competing mappings", () => {
    const refs = SOC2_TSC_2017_CROSSWALK.map((e) => e.requirement_reference);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("no entry references a slug outside the corpus — publication would abort on it", () => {
    for (const entry of SOC2_TSC_2017_CROSSWALK) {
      for (const slug of entry.canonical_control_slugs) {
        expect(CORPUS_SLUGS, `${entry.requirement_reference} -> ${slug}`).toContain(slug);
      }
    }
  });

  it("no entry maps to nothing, and no entry maps to the same control twice", () => {
    for (const entry of SOC2_TSC_2017_CROSSWALK) {
      expect(entry.canonical_control_slugs.length, entry.requirement_reference).toBeGreaterThan(0);
      expect(new Set(entry.canonical_control_slugs).size).toBe(entry.canonical_control_slugs.length);
    }
  });

  it("every entry states a rationale — a mapping a reviewer cannot check is not governed", () => {
    for (const entry of SOC2_TSC_2017_CROSSWALK) {
      expect(entry.rationale.trim().length, entry.requirement_reference).toBeGreaterThan(30);
    }
  });
});

describe("the mapping is many-to-many in both directions", () => {
  it("some criteria carry more than one canonical control", () => {
    const multi = SOC2_TSC_2017_CROSSWALK.filter((e) => e.canonical_control_slugs.length > 1);
    expect(multi.length).toBeGreaterThan(10);
    expect(
      SOC2_TSC_2017_CROSSWALK.find((e) => e.requirement_reference === "CC6.1")!
        .canonical_control_slugs.length
    ).toBeGreaterThan(5);
  });

  it("some canonical controls carry more than one criterion", () => {
    const counts = new Map<string, number>();
    for (const entry of SOC2_TSC_2017_CROSSWALK) {
      for (const slug of entry.canonical_control_slugs) {
        counts.set(slug, (counts.get(slug) ?? 0) + 1);
      }
    }
    expect(counts.get("risk-assessment-programme")).toBeGreaterThan(1);
    expect(counts.get("security-roles-and-responsibilities")).toBeGreaterThan(1);
  });
});

describe("the known gap is pinned, not narrated", () => {
  it("carries no confidentiality, processing-integrity or privacy criterion", () => {
    // These exist in TSC 2017 and a vendor report can test against them, but
    // the shipped template does not create them. Publishing references no
    // tenant framework contains is an authority decision, deliberately not
    // taken in 4C-1. If that decision is made, this test changes WITH the
    // module header — the two must not drift.
    const outOfScope = SOC2_TSC_2017_CROSSWALK.filter((e) =>
      /^(C1|PI1|P[1-8])\./.test(e.requirement_reference)
    );
    expect(outOfScope).toEqual([]);
    expect(TEMPLATE_REFS.some((r) => r.startsWith("C1."))).toBe(false);
  });
});

describe("the corpus registry", () => {
  it("carries both curated frameworks, each exactly once", () => {
    const keys = CROSSWALK_CORPORA.map((c) => `${c.framework_key}@${c.framework_version}`);
    expect(keys).toEqual(["nist-csf@1.1", "soc2@2017"]);
  });

  it("every corpus in the registry names a framework identity the FK will accept", () => {
    for (const corpus of CROSSWALK_CORPORA) {
      expect(
        isKnownCanonicalFrameworkVersion(corpus.framework_key, corpus.framework_version),
        `${corpus.framework_key}@${corpus.framework_version}`
      ).toBe(true);
    }
  });

  it("no canonical control is left unmapped across the whole registry except by design", () => {
    const allMapped = new Set(
      CROSSWALK_CORPORA.flatMap((c) => c.entries.flatMap((e) => [...e.canonical_control_slugs]))
    );
    const unmapped = [...CORPUS_SLUGS].filter((s) => !allMapped.has(s));
    // SOC 2 maps `segregation-of-duties`, which NIST CSF 1.1 did not — so the
    // registry as a whole now reaches every canonical control.
    expect(unmapped).toEqual([]);
    expect(MAPPED_SLUGS.has("segregation-of-duties")).toBe(true);
  });
});
