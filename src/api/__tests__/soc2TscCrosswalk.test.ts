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
import {
  CROSSWALK_CORPORA,
  scopeOf,
  templateReferencesFor,
} from "../lib/controls/crosswalkCorpora.js";
import { isKnownCanonicalFrameworkVersion } from "../lib/controls/canonicalFrameworkIdentity.js";
import {
  SOC2_FRAMEWORK_KEY,
  SOC2_FRAMEWORK_VERSION,
  SOC2_TSC_2017_CROSSWALK,
} from "../lib/controls/soc2TscCrosswalk.js";
import {
  assertCrosswalkClassification,
  CanonicalPublicationError,
} from "../lib/controls/canonicalControlPublisher.js";
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

  it("every template_represented reference is one the template creates", () => {
    for (const entry of SOC2_TSC_2017_CROSSWALK) {
      if (scopeOf(entry) !== "template_represented") continue;
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

describe("the classification is general, and both directions are pinned", () => {
  it("exactly one entry is vendor_side_only, and it is the one the corpus actually cites", () => {
    const vendorSide = SOC2_TSC_2017_CROSSWALK.filter((e) => scopeOf(e) === "vendor_side_only");
    expect(vendorSide.map((e) => e.requirement_reference)).toEqual(["C1.1"]);
  });

  it("a vendor_side_only reference is absent from the shipped template — that is what the label MEANS", () => {
    const refs = templateReferencesFor(SOC2_FRAMEWORK_KEY, SOC2_FRAMEWORK_VERSION)!;
    for (const entry of SOC2_TSC_2017_CROSSWALK) {
      const present = refs.has(entry.requirement_reference);
      expect(present, entry.requirement_reference).toBe(scopeOf(entry) === "template_represented");
    }
  });

  it("a vendor_side_only entry carries its authoritative title; a template_represented one does not restate it", () => {
    for (const entry of SOC2_TSC_2017_CROSSWALK) {
      if (scopeOf(entry) === "vendor_side_only") {
        expect(entry.criterion_title?.trim().length ?? 0, entry.requirement_reference).toBeGreaterThan(20);
      } else {
        expect(entry.criterion_title, entry.requirement_reference).toBeUndefined();
      }
    }
  });

  it("nothing from the unobserved families is published — the schema representing them is not a reason to", () => {
    // C1.2, PI1.x and P1–P8 are valid TSC 2017. None is cited by any observed
    // extraction, so none is curated. If one is later observed it is added
    // under the same rule, and this list changes WITH the module header.
    const published = SOC2_TSC_2017_CROSSWALK.map((e) => e.requirement_reference);
    expect(published.filter((r) => /^(PI1|P[1-8])\./.test(r))).toEqual([]);
    expect(published.filter((r) => /^C1\./.test(r))).toEqual(["C1.1"]);
  });

  it("a vendor_side_only row establishes canonical identity, not assurance — it maps to real controls", () => {
    const c11 = SOC2_TSC_2017_CROSSWALK.find((e) => e.requirement_reference === "C1.1")!;
    expect(c11.canonical_control_slugs.length).toBeGreaterThan(0);
    for (const slug of c11.canonical_control_slugs) expect(CORPUS_SLUGS).toContain(slug);
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

  it("no canonical control is left unmapped across the whole registry", () => {
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

describe("the classification guard BITES — proven, not assumed", () => {
  const corpus = (entries: unknown[]) =>
    ({
      framework_key: SOC2_FRAMEWORK_KEY,
      framework_version: SOC2_FRAMEWORK_VERSION,
      entries: entries as never,
    }) as never;

  it("the shipped corpus passes", () => {
    expect(() =>
      assertCrosswalkClassification(corpus([...SOC2_TSC_2017_CROSSWALK]))
    ).not.toThrow();
  });

  it("REFUSES a template_represented reference the template does not create", () => {
    expect(() =>
      corpusThrows({ requirement_reference: "C1.2", canonical_control_slugs: ["backup-and-restore"], rationale: "x" })
    ).toThrow(/declared template_represented but the shipped template does not create it/);
  });

  it("REFUSES a vendor_side_only reference the template DOES create — a stale caveat hiding a live join", () => {
    expect(() =>
      corpusThrows({
        requirement_reference: "CC6.1",
        scope: "vendor_side_only",
        criterion_title: "Logical access security over protected information assets.",
        canonical_control_slugs: ["encryption-at-rest"],
        rationale: "x",
      })
    ).toThrow(/declared vendor_side_only but the shipped template DOES create it/);
  });

  it("REFUSES a vendor_side_only entry with no authoritative title", () => {
    expect(() =>
      corpusThrows({
        requirement_reference: "C1.2",
        scope: "vendor_side_only",
        canonical_control_slugs: ["media-sanitisation-and-disposal"],
        rationale: "x",
      })
    ).toThrow(/must carry criterion_title/);
  });

  it("REFUSES a template_represented entry that restates a title the requirement row owns", () => {
    expect(() =>
      corpusThrows({
        requirement_reference: "CC6.4",
        criterion_title: "Physical access is restricted.",
        canonical_control_slugs: ["physical-access-control"],
        rationale: "x",
      })
    ).toThrow(/must not restate criterion_title/);
  });

  it("REFUSES anything claiming template_represented for a framework with no shipped template", () => {
    expect(() =>
      assertCrosswalkClassification(
        // A REGISTERED identity with no FRAMEWORK_TEMPLATES entry: CSF 2.0 is
        // in the canonical registry, but the shipped template is 1.1.
        {
          framework_key: "nist-csf",
          framework_version: "2.0",
          entries: [
            { requirement_reference: "GV.OC-01", canonical_control_slugs: ["security-policy-program"], rationale: "x" },
          ],
        } as never
      )
    ).toThrow(/has no shipped template/);
  });

  it("every error it raises is a CanonicalPublicationError — publication aborts, it does not warn", () => {
    try {
      corpusThrows({ requirement_reference: "C1.2", canonical_control_slugs: ["backup-and-restore"], rationale: "x" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CanonicalPublicationError);
    }
  });

  function corpusThrows(entry: Record<string, unknown>): void {
    assertCrosswalkClassification(corpus([entry]));
  }
});
