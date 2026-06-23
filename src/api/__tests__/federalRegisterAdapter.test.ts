import { describe, it, expect } from "vitest";

import {
  frSeverity,
  buildFrSummary,
  mapFrDocumentToSignal,
  type FrDocument
} from "../lib/federalRegisterAdapter.js";
import { normalizeSignal } from "../lib/cyberSignalNormalizer.js";

// Real captured Federal Register record (live API pull).
const REAL_DOC: FrDocument = {
  document_number: "2026-12399",
  title:
    "Rescinding Portions of DHS Title VI Regulations To Conform More Closely With the Statutory Text",
  type: "Rule",
  abstract:
    "By this rule, DHS amends its regulations implementing Title VI of the Civil Rights Act of 1964.",
  publication_date: "2026-06-22",
  html_url:
    "https://www.federalregister.gov/documents/2026/06/22/2026-12399/rescinding-portions",
  agencies: [
    { raw_name: "DEPARTMENT OF HOMELAND SECURITY", name: "Homeland Security Department" },
    { raw_name: "Office of the Secretary" },
    { raw_name: "FEDERAL EMERGENCY MANAGEMENT AGENCY", name: "Federal Emergency Management Agency" }
  ]
};

describe("frSeverity", () => {
  it("final rules outrank proposed rules", () => {
    expect(frSeverity("Rule")).toBe("Moderate");
    expect(frSeverity("Proposed Rule")).toBe("Low");
    expect(frSeverity(undefined)).toBe("Low");
  });
});

describe("buildFrSummary", () => {
  it("combines title and abstract", () => {
    const s = buildFrSummary(REAL_DOC);
    expect(s).toContain("Rescinding Portions of DHS Title VI");
    expect(s).toContain("Civil Rights Act");
  });
  it("truncates to <= 500 chars", () => {
    const long = buildFrSummary({ title: "t", abstract: "x".repeat(800) });
    expect(long.length).toBeLessThanOrEqual(500);
    expect(long.endsWith("...")).toBe(true);
  });
});

describe("mapFrDocumentToSignal", () => {
  it("maps a real FR rule to a regulatory_change signal keyed on the document number", () => {
    const sig = mapFrDocumentToSignal(REAL_DOC);
    expect(sig).not.toBeNull();
    expect(sig!.source).toBe("federal_register");
    expect(sig!.signal_type).toBe("regulatory_change");
    expect(sig!.severity).toBe("Moderate");
    expect(sig!.affected_vendor).toBeNull();        // regulatory — flows to obligation branch
    expect(sig!.affected_cve).toBeNull();
    expect(sig!.external_id).toBe("2026-12399");     // FR document number = dedup discriminator
    expect(sig!.raw_payload.agencies).toEqual([
      "Homeland Security Department",
      "Office of the Secretary",
      "Federal Emergency Management Agency"
    ]);
  });

  it("returns null without a document_number or title", () => {
    expect(mapFrDocumentToSignal({ title: "t" })).toBeNull();
    expect(mapFrDocumentToSignal({ document_number: "x" })).toBeNull();
  });

  // The dedup-collapse fix: regulatory signals carry no vendor/CVE, so the
  // document number external_id is the ONLY thing keeping two rules distinct.
  it("two distinct FR documents produce DISTINCT dedup hashes (no regulatory collapse)", () => {
    const a = mapFrDocumentToSignal(REAL_DOC)!;
    const b = mapFrDocumentToSignal({ ...REAL_DOC, document_number: "2026-99999", title: "Other rule" })!;
    expect(a.external_id).not.toBe(b.external_id);
    expect(normalizeSignal(a).dedup_hash).not.toBe(normalizeSignal(b).dedup_hash);
    // same document re-fetched → same hash (idempotent)
    expect(normalizeSignal(mapFrDocumentToSignal(REAL_DOC)!).dedup_hash).toBe(normalizeSignal(a).dedup_hash);
  });
});
