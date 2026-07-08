/**
 * briefRelevance.test.ts — IQP Q3 regression suite (Phase 1 audit defects
 * #5a — unmonitored SEC/EDGAR filings reached customers — and #5b — a
 * Musk-v-Altman trial article was bucketed COMPLIANCE).
 *
 * Interim rules under SECURELOGIC_BRIEF_RELEVANCE_ENABLED:
 *   (a) third_party_breach renders only on a canonical match to an ACTIVE
 *       org vendor (the matcher's own comparison);
 *   (b) `regulatory` items without regulatory INTENT re-bucket to `general`.
 * Flag OFF ⇒ byte-identical brief (regression-tested at the generator).
 */

import { describe, it, expect, vi } from "vitest";

// The relevance filter itself is pure, but the parity tests below use the
// REAL canonicalizeVendorName from the matcher — whose module pulls in the
// postgres infra at load time. Mock it exactly like the service's own suite.
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() },
  pgElevated: { query: vi.fn(), connect: vi.fn() }
}));

import {
  briefRelevanceEnabled,
  filterSignalsByOrgRelevance,
  hasRegulatoryIntent,
  refineCategory
} from "../lib/briefRelevance.js";
import { canonicalizeVendorName } from "../lib/cyberSignalProcessingService.js";
import { buildBriefItems, type CyberSignalForBrief } from "../lib/intelligenceBriefGenerator.js";

describe("briefRelevanceEnabled — dark by default", () => {
  it("OFF for absent env; ON only for exact 'true'", () => {
    expect(briefRelevanceEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(briefRelevanceEnabled({ SECURELOGIC_BRIEF_RELEVANCE_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(briefRelevanceEnabled({ SECURELOGIC_BRIEF_RELEVANCE_ENABLED: "1" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #5a — org-relevance gate
// ---------------------------------------------------------------------------

describe("filterSignalsByOrgRelevance — EDGAR defect #5a", () => {
  const orgVendors = new Set([
    canonicalizeVendorName("Okta, Inc."),
    canonicalizeVendorName("CrowdStrike")
  ]);

  it("suppresses a third_party_breach filing from an UNMONITORED company", () => {
    const { kept, suppressed } = filterSignalsByOrgRelevance(
      [{ signal_type: "third_party_breach", affected_vendor: "Random Retail Corp" }],
      orgVendors,
      canonicalizeVendorName
    );
    expect(kept).toHaveLength(0);
    expect(suppressed).toHaveLength(1);
  });

  it("keeps a third_party_breach filing from a MONITORED vendor (canonical match)", () => {
    const { kept, suppressed } = filterSignalsByOrgRelevance(
      [{ signal_type: "third_party_breach", affected_vendor: "OKTA INC" }],
      orgVendors,
      canonicalizeVendorName
    );
    expect(kept).toHaveLength(1);
    expect(suppressed).toHaveLength(0);
  });

  it("suppresses an unattributable breach claim (null vendor)", () => {
    const { suppressed } = filterSignalsByOrgRelevance(
      [{ signal_type: "third_party_breach", affected_vendor: null }],
      orgVendors,
      canonicalizeVendorName
    );
    expect(suppressed).toHaveLength(1);
  });

  it("passes global threat/vuln intelligence through untouched (interim scope)", () => {
    const globals = [
      { signal_type: "cve", affected_vendor: null },
      { signal_type: "advisory", affected_vendor: "Unmonitored Corp" },
      { signal_type: "regulatory_change", affected_vendor: null },
      { signal_type: "threat_actor", affected_vendor: null }
    ];
    const { kept, suppressed } = filterSignalsByOrgRelevance(globals, orgVendors, canonicalizeVendorName);
    expect(kept).toHaveLength(4);
    expect(suppressed).toHaveLength(0);
  });

  it("empty vendor set (org monitors nothing) suppresses every vendor-gated claim", () => {
    const { kept } = filterSignalsByOrgRelevance(
      [{ signal_type: "third_party_breach", affected_vendor: "Okta, Inc." }],
      new Set<string>(),
      canonicalizeVendorName
    );
    expect(kept).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// #5b — regulatory-intent guard
// ---------------------------------------------------------------------------

describe("hasRegulatoryIntent / refineCategory — COMPLIANCE misclass #5b", () => {
  it("a trial/news article with only generic terms has NO regulatory intent", () => {
    // The exact defect shape: passes the ingestion whitelist on "data"/"risk"
    // but reads nothing like a regulation.
    const title = "Musk v. Altman trial opens with dispute over OpenAI data and governance risk";
    const summary = "The high-profile trial examines allegations over the company's founding agreement.";
    expect(hasRegulatoryIntent(`${title} ${summary}`)).toBe(false);
    expect(refineCategory("regulatory", title, summary)).toBe("general");
  });

  it("a genuine FTC enforcement action KEEPS the regulatory bucket", () => {
    const title = "FTC announces enforcement action and consent order over data-security failures";
    expect(refineCategory("regulatory", title, "Civil penalties and compliance requirements imposed.")).toBe("regulatory");
  });

  it("a rulemaking item KEEPS the regulatory bucket", () => {
    expect(refineCategory("regulatory", "HHS issues proposed rule updating HIPAA breach notification", "")).toBe("regulatory");
  });

  it("non-regulatory categories pass through untouched", () => {
    expect(refineCategory("vulnerability", "anything", "at all")).toBe("vulnerability");
    expect(refineCategory("vendor_incident", "no intent words", "")).toBe("vendor_incident");
  });
});

// ---------------------------------------------------------------------------
// buildBriefItems wiring — flag-off byte-identity + flag-on re-bucket
// ---------------------------------------------------------------------------

function regulatorySignal(summary: string, title: string): CyberSignalForBrief {
  return {
    id: "sig-reg",
    source: "ftc_news",
    signal_type: "regulatory_change",
    severity: "Moderate",
    normalized_summary: summary,
    affected_cve: null,
    affected_vendor: null,
    raw_payload: { title },
    ingestion_timestamp: "2026-07-08T00:00:00.000Z",
    cluster_key: null
  } as CyberSignalForBrief;
}

describe("buildBriefItems — IQP Q3 wiring", () => {
  const trial = regulatorySignal(
    "The high-profile trial examines allegations over the founding agreement.",
    "Musk v. Altman trial opens with dispute over OpenAI data"
  );
  const rule = regulatorySignal(
    "Comment period opens for the proposed rule on breach notification requirements.",
    "FTC proposes updated Safeguards Rule"
  );

  it("flag OFF: feed-stamped category preserved byte-identically (trial stays regulatory)", () => {
    const [item] = buildBriefItems([trial], undefined, false, false, false);
    expect(item!.category).toBe("regulatory");
  });

  it("flag ON: the trial article re-buckets to general", () => {
    const [item] = buildBriefItems([trial], undefined, false, false, true);
    expect(item!.category).toBe("general");
  });

  it("flag ON: a genuine rulemaking item stays regulatory", () => {
    const [item] = buildBriefItems([rule], undefined, false, false, true);
    expect(item!.category).toBe("regulatory");
  });
});
