/**
 * requirementScopeTags.test.ts
 *
 * The row-by-row agreement between the SQL backfill and this module is proven in
 * `test/isolation/requirementScopeTagsParity.test.ts`, against a real database.
 *
 * What is tested here is the property that neither the parity test nor the
 * resolver's own suite can see: that the VOCABULARY and the RULES that consume
 * it stay in sync. A tag the resolver asks for but nothing can produce means a
 * rule that never fires — and a rule that never fires is indistinguishable, from
 * the outside, from a rule that fired and found nothing.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CURATED_ONLY_SCOPE_TAGS,
  SCOPE_TAG_VOCABULARY,
  areValidScopeTags,
  deriveScopeTags,
  scopeTagCoverage,
} from "../lib/vendorRisk/requirementScopeTags.js";
import { DOMAIN_TAGS } from "../lib/vendorRisk/requirementDomain.js";

const here = dirname(fileURLToPath(import.meta.url));
const resolverSource = readFileSync(
  resolve(here, "../lib/vendorRisk/scopeResolver.ts"),
  "utf8"
);

/**
 * Every tag literal the resolver's rule tables reference. S5 (VA-Q2) consumes
 * tags through `DOMAIN_TAGS` in requirementDomain.ts — a domain activation
 * includes every requirement carrying one of its domain's tags — so that
 * table is a rule consumer in exactly the sense S1/S2 are.
 */
function tagsReferencedByResolver(): string[] {
  const found = new Set<string>();
  for (const tags of Object.values(DOMAIN_TAGS)) for (const t of tags) found.add(t);
  // `tags: ["access-control", "iam"]` and the TIER_BASELINE_TAGS arrays.
  for (const block of resolverSource.matchAll(/tags:\s*\[([^\]]*)\]/g)) {
    for (const literal of block[1]!.matchAll(/["']([^"']+)["']/g)) {
      found.add(literal[1]!);
    }
  }
  for (const block of resolverSource.matchAll(/tier_\d_\w+:\s*\[([^\]]*)\]/g)) {
    for (const literal of block[1]!.matchAll(/["']([^"']+)["']/g)) {
      found.add(literal[1]!);
    }
  }
  found.delete("*"); // the wildcard is not a tag
  return [...found];
}

describe("the vocabulary and the rules that consume it stay in sync", () => {
  it("every tag the resolver asks for CAN be produced", () => {
    // A rule referencing a tag nothing produces never fires, and from the
    // outside that is indistinguishable from a rule that fired and matched
    // nothing. The questionnaire is simply quietly narrower than intended.
    const referenced = tagsReferencedByResolver();
    expect(referenced.length).toBeGreaterThan(5);

    const missing = referenced.filter(
      (t) => !(SCOPE_TAG_VOCABULARY as readonly string[]).includes(t)
    );
    expect(
      missing,
      `scopeResolver.ts references tags absent from SCOPE_TAG_VOCABULARY: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("every tag in the vocabulary is actually consumed by some rule", () => {
    // The reverse: a tag nothing consumes is decoration that a curator would
    // spend real effort applying for no effect on any questionnaire.
    const referenced = new Set(tagsReferencedByResolver());
    const unused = SCOPE_TAG_VOCABULARY.filter((t) => !referenced.has(t));
    expect(
      unused,
      `These tags are in the vocabulary but no scope rule consumes them: ${unused.join(", ")}`
    ).toEqual([]);
  });

  it("core is in the vocabulary — it is the entire tier-4 baseline", () => {
    expect(SCOPE_TAG_VOCABULARY).toContain("core");
    expect(resolverSource).toMatch(/tier_4_low:\s*\["core"\]/);
  });
});

describe("deriveScopeTags", () => {
  it("is deterministic", () => {
    const input = { reference_id: "AC-2", title: "Account Management and Provisioning" };
    const first = deriveScopeTags(input);
    for (let i = 0; i < 10; i++) expect(deriveScopeTags(input)).toEqual(first);
  });

  it("returns tags in a stable sorted order so a backfill diff is reviewable", () => {
    const result = deriveScopeTags({
      reference_id: "XX",
      title: "Encryption of Personal Data at Rest with Access Control",
    });
    expect(result.tags).toEqual([...result.tags].sort());
    expect(result.tags.length).toBeGreaterThan(1);
  });

  it("assigns multiple tags when a control genuinely spans concepts", () => {
    const result = deriveScopeTags({
      reference_id: "SC-28",
      title: "Encryption of Personal Data at Rest",
    });
    expect(result.tags).toContain("encryption");
    expect(result.tags).toContain("privacy");
  });

  it("marks everything it produces as heuristic, never curated", () => {
    // The module cannot curate. Only a human can, and the distinction is what
    // makes the readiness number meaningful.
    for (const title of ["Access Control Policy", "Nothing In Particular"]) {
      expect(deriveScopeTags({ reference_id: "X", title }).source).toBe("heuristic");
    }
  });

  it("never returns an empty tag list", () => {
    for (const title of ["", "   ", "Wayfinding Signage", "Quarterly Meeting"]) {
      const result = deriveScopeTags({ reference_id: "X", title });
      expect(result.tags.length, title).toBeGreaterThan(0);
      expect(result.tags, title).toContain("core");
    }
  });

  it("reports when the fallback supplied the only tag", () => {
    // A reviewer curating the corpus needs to find these first: they are the
    // rows where the heuristic learned nothing at all.
    expect(deriveScopeTags({ reference_id: "X", title: "Wayfinding" }).fallback_applied).toBe(true);
    expect(
      deriveScopeTags({ reference_id: "AC-1", title: "Access Control Policy" }).fallback_applied
    ).toBe(false);
  });

  it("ignores the description entirely", () => {
    const withDescription = deriveScopeTags({
      reference_id: "X",
      title: "Wayfinding Signage",
      description: "This control does not cover encryption, privacy, or backup.",
    });
    // Guidance text mentions adjacent concepts in passing; a negation would tag
    // the requirement with exactly what it says it excludes.
    expect(withDescription.tags).toEqual(["core"]);
  });
});

describe("areValidScopeTags", () => {
  it("accepts the vocabulary and rejects anything else", () => {
    expect(areValidScopeTags(["core", "encryption"])).toBe(true);
    expect(areValidScopeTags([])).toBe(true);
    expect(areValidScopeTags(["core", "invented-tag"])).toBe(false);
    expect(areValidScopeTags("core")).toBe(false);
    expect(areValidScopeTags(null)).toBe(false);
  });
});

describe("scopeTagCoverage", () => {
  it("reports curated percentage as the readiness number", () => {
    const coverage = scopeTagCoverage([
      { tags: ["core"], source: "curated" },
      { tags: ["core"], source: "heuristic" },
      { tags: ["encryption"], source: "heuristic" },
      { tags: [], source: "heuristic" },
    ]);
    expect(coverage.total).toBe(4);
    expect(coverage.curated).toBe(1);
    expect(coverage.curated_pct).toBe(25);
    expect(coverage.untagged).toBe(1);
    expect(coverage.core_tagged).toBe(2);
  });

  it("does not divide by zero on an empty corpus", () => {
    expect(scopeTagCoverage([]).curated_pct).toBe(0);
  });
});

describe("VA-Q2 P2 — the nine curated-only tags", () => {
  const NINE = [
    "vulnerability-management",
    "secure-development",
    "data-subject-rights",
    "cross-border",
    "lawful-basis",
    "breach-notification",
    "training-data",
    "model-provider",
    "automated-decision",
  ];

  it("are exactly the VA-Q0 §5 starred tags, in the vocabulary and accepted by areValidScopeTags", () => {
    expect([...CURATED_ONLY_SCOPE_TAGS]).toEqual(NINE);
    for (const t of NINE) expect(SCOPE_TAG_VOCABULARY as readonly string[]).toContain(t);
    expect(areValidScopeTags(NINE)).toBe(true);
  });

  it("are NEVER produced by the heuristic — the 20260926 backfill mirror is untouched", () => {
    // Titles that a naive regex would have matched. The heuristic must still
    // tag them with the pre-P2 vocabulary only.
    const titles = [
      "Vulnerability Management and Secure Development Lifecycle",
      "Data Subject Rights, Lawful Basis and Cross-border Transfers",
      "Breach Notification Procedure",
      "Training Data Provenance and Model Provider Due Diligence",
      "Automated Decision-making Safeguards",
    ];
    for (const title of titles) {
      const { tags } = deriveScopeTags({ reference_id: "X-1", title });
      for (const t of tags) expect(NINE, `${title} → ${t}`).not.toContain(t);
    }
  });
});
