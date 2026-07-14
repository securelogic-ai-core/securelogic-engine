import { describe, it, expect } from "vitest";
import { buildSignalFindingTitle, resolveSignalDomain } from "../lib/signalFindingShape.js";

/**
 * Two writers turn a signal into a Finding — the ingestion path (only when the signal
 * matches a registered vendor/AI system) and user promotion from the Intelligence Brief
 * (POST /api/findings/from-signal, the entity-less case). They share this module so the
 * same signal cannot read as two different findings depending on who created it.
 */

describe("buildSignalFindingTitle", () => {
  // These wordings are what the automated path has always produced. Findings already
  // exist in customers' orgs with these titles, and a title is what a person recognizes
  // a finding BY — so they are pinned, not merely asserted.
  it("names the vendor and the CVE when a vendor matched", () => {
    expect(
      buildSignalFindingTitle({
        signalType: "cve",
        severity: "critical",
        affectedCve: "CVE-2026-1234",
        entity: { kind: "vendor", name: "Acme Corp" },
      })
    ).toBe("CVE-2026-1234 affects vendor: Acme Corp");
  });

  it("names the AI system and the CVE when an AI system matched", () => {
    expect(
      buildSignalFindingTitle({
        signalType: "cve",
        severity: "high",
        affectedCve: "CVE-2026-9999",
        entity: { kind: "ai_system", name: "Claims Triage Model" },
      })
    ).toBe("CVE-2026-9999 affects AI system: Claims Triage Model");
  });

  it("falls back to type + severity for a matched entity with no CVE", () => {
    expect(
      buildSignalFindingTitle({
        signalType: "breach",
        severity: "high",
        affectedCve: null,
        entity: { kind: "vendor", name: "Acme Corp" },
      })
    ).toBe("Cyber signal (breach): Acme Corp — high severity");
  });

  // The promotion case. The ingestion path never reaches it (no match ⇒ it creates no
  // finding at all), which is exactly the hole promotion fills.
  it("names the signal itself when NO entity matched — there is no entity to name", () => {
    expect(
      buildSignalFindingTitle({
        signalType: "cve",
        severity: "critical",
        affectedCve: "CVE-2026-1234",
        entity: null,
      })
    ).toBe("CVE-2026-1234 — requires assessment");

    expect(
      buildSignalFindingTitle({
        signalType: "geopolitical",
        severity: "medium",
        affectedCve: null,
        entity: null,
      })
    ).toBe("Cyber signal (geopolitical) — medium severity");
  });

  it("never renders an entity-less title containing 'Unknown' or an empty name", () => {
    const title = buildSignalFindingTitle({
      signalType: "advisory",
      severity: "low",
      affectedCve: null,
      entity: null,
    });
    // The old inline logic defaulted a missing name to the literal "Unknown". A promoted
    // finding titled "…: Unknown — low severity" is noise in a queue a human has to read.
    expect(title).not.toContain("Unknown");
    expect(title).not.toContain(": —");
  });
});

describe("resolveSignalDomain", () => {
  it("scopes a matched vendor to Vendor Risk even when an AI system also matched", () => {
    expect(resolveSignalDomain("cve", true, true)).toBe("Vendor Risk");
    expect(resolveSignalDomain("cve", true, false)).toBe("Vendor Risk");
  });

  it("scopes an exclusively-AI match to AI Governance", () => {
    expect(resolveSignalDomain("cve", false, true)).toBe("AI Governance");
  });

  it("routes an unmatched signal by its type — the promotion case", () => {
    expect(resolveSignalDomain("cve", false, false)).toBe("Vulnerability");
    expect(resolveSignalDomain("patch", false, false)).toBe("Vulnerability");
    expect(resolveSignalDomain("malware", false, false)).toBe("Vulnerability");
    expect(resolveSignalDomain("advisory", false, false)).toBe("Vulnerability");
    expect(resolveSignalDomain("threat_actor", false, false)).toBe("Vulnerability");
    expect(resolveSignalDomain("breach", false, false)).toBe("Vendor Risk");
    expect(resolveSignalDomain("geopolitical", false, false)).toBe("General");
  });

  it("routes an unrecognized type to General rather than throwing or inventing a domain", () => {
    expect(resolveSignalDomain("something_new", false, false)).toBe("General");
  });
});
