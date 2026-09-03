/**
 * nistCsfCrosswalk.test.ts — VA-S4 Step 1.
 *
 * The crosswalk's value depends entirely on it joining to something real. A
 * curation pass against references this codebase never writes would be correct
 * and vacuous — the failure mode the owner ruling names explicitly. So the
 * central test here is not "is the content well-formed" but "does every
 * requirement reference in it correspond to a requirement row that
 * POST /api/frameworks/activate actually creates".
 */

import { describe, expect, it } from "vitest";

import { CANONICAL_CONTROL_CORPUS } from "../lib/controls/canonicalControlCorpus.js";
import {
  NIST_CSF_1_1_CROSSWALK,
  NIST_CSF_FRAMEWORK_KEY,
  NIST_CSF_FRAMEWORK_VERSION,
} from "../lib/controls/nistCsfCrosswalk.js";
import { isKnownCanonicalFrameworkVersion } from "../lib/controls/canonicalFrameworkIdentity.js";
import { FRAMEWORK_TEMPLATES } from "../lib/frameworkTemplates.js";

const TEMPLATE = FRAMEWORK_TEMPLATES.nist_csf!;
const TEMPLATE_REFS = TEMPLATE.requirements.map((r) => r.reference_id);
const CORPUS_SLUGS = new Set(CANONICAL_CONTROL_CORPUS.map((c) => c.slug));
const MAPPED_SLUGS = new Set(NIST_CSF_1_1_CROSSWALK.flatMap((e) => [...e.canonical_control_slugs]));

describe("the crosswalk joins to content this codebase actually writes", () => {
  it("targets the version FRAMEWORK_TEMPLATES creates, not the newest published one", () => {
    expect(TEMPLATE.version).toBe(NIST_CSF_FRAMEWORK_VERSION);
    expect(TEMPLATE.name).toBe("NIST Cybersecurity Framework");
  });

  it("its (framework_key, framework_version) is in the canonical registry — the FK target", () => {
    expect(isKnownCanonicalFrameworkVersion(NIST_CSF_FRAMEWORK_KEY, NIST_CSF_FRAMEWORK_VERSION))
      .toBe(true);
  });

  it("every requirement_reference is one the template creates", () => {
    for (const entry of NIST_CSF_1_1_CROSSWALK) {
      expect(TEMPLATE_REFS, entry.requirement_reference).toContain(entry.requirement_reference);
    }
  });

  it("covers ALL 57 template references — the completeness claim in the module header", () => {
    expect(TEMPLATE_REFS.length).toBe(57);
    const covered = new Set(NIST_CSF_1_1_CROSSWALK.map((e) => e.requirement_reference));
    expect([...TEMPLATE_REFS].filter((r) => !covered.has(r))).toEqual([]);
  });

  it("carries one entry per reference — a duplicate reference is two competing mappings", () => {
    const refs = NIST_CSF_1_1_CROSSWALK.map((e) => e.requirement_reference);
    expect(new Set(refs).size).toBe(refs.length);
  });
});

describe("every mapping resolves to a canonical control", () => {
  it("no entry references a slug outside the corpus — publication would abort on it", () => {
    for (const entry of NIST_CSF_1_1_CROSSWALK) {
      for (const slug of entry.canonical_control_slugs) {
        expect(CORPUS_SLUGS, `${entry.requirement_reference} → ${slug}`).toContain(slug);
      }
    }
  });

  it("no entry maps to nothing, and no entry maps to the same control twice", () => {
    for (const entry of NIST_CSF_1_1_CROSSWALK) {
      expect(entry.canonical_control_slugs.length, entry.requirement_reference).toBeGreaterThan(0);
      expect(new Set(entry.canonical_control_slugs).size).toBe(entry.canonical_control_slugs.length);
    }
  });

  it("every entry states a rationale — a mapping a reviewer cannot check is not governed", () => {
    for (const entry of NIST_CSF_1_1_CROSSWALK) {
      expect(entry.rationale.trim().length, entry.requirement_reference).toBeGreaterThan(0);
    }
  });
});

describe("many-to-many, demonstrated rather than asserted", () => {
  it("some requirements map to more than one canonical control", () => {
    const multi = NIST_CSF_1_1_CROSSWALK.filter((e) => e.canonical_control_slugs.length > 1);
    expect(multi.length).toBeGreaterThan(0);
    // The example named in the module header.
    const idBe4 = NIST_CSF_1_1_CROSSWALK.find((e) => e.requirement_reference === "ID.BE-4");
    expect(idBe4!.canonical_control_slugs.length).toBeGreaterThan(1);
  });

  it("some canonical controls carry more than one requirement", () => {
    const counts = new Map<string, number>();
    for (const entry of NIST_CSF_1_1_CROSSWALK) {
      for (const slug of entry.canonical_control_slugs) {
        counts.set(slug, (counts.get(slug) ?? 0) + 1);
      }
    }
    expect([...counts.values()].filter((n) => n > 1).length).toBeGreaterThan(0);
    expect(counts.get("security-roles-and-responsibilities")).toBeGreaterThan(1);
  });

  it("a canonical control is NOT a framework requirement: `segregation-of-duties` maps to nothing", () => {
    // The corpus header's claim. If a later curation pass maps it, update the
    // header in the same change — the two must not drift.
    expect(CORPUS_SLUGS.has("segregation-of-duties")).toBe(true);
    expect(MAPPED_SLUGS.has("segregation-of-duties")).toBe(false);
    expect([...CORPUS_SLUGS].filter((s) => !MAPPED_SLUGS.has(s))).toEqual(["segregation-of-duties"]);
  });
});

describe("completeness is stated honestly", () => {
  it("this is NIST CSF 1.1 only — no other framework has crosswalk content yet", () => {
    // Guards the header's honesty claim: if a second framework's content lands
    // in this module, it needs its own key/version, not this one's.
    expect(NIST_CSF_FRAMEWORK_KEY).toBe("nist-csf");
    expect(NIST_CSF_1_1_CROSSWALK.length).toBe(TEMPLATE_REFS.length);
  });
});
