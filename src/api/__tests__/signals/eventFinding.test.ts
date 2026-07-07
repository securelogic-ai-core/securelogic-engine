/**
 * eventFinding.test.ts — Intelligence Pipeline Hardening / IE.P6.
 *
 * Pins the pure event→finding reconciliation: create on first relevance, update
 * when severity/title/description changes (dedup-by-update), no-op otherwise,
 * domain routing, CVE-prefixed title, and severity→priority mapping.
 */

import { describe, it, expect } from "vitest";
import {
  planFindingUpsert,
  eventFindingDomain,
  eventFindingTitle,
  type EventForFinding,
  type ExistingFinding
} from "../../lib/signals/eventFinding.js";

function event(part: Partial<EventForFinding>): EventForFinding {
  return {
    event_id: "evt-1",
    title: "Acme Gateway RCE",
    executive_summary: "Acme Gateway has a critical RCE. Active exploitation has been reported. Sources: CISA KEV.",
    severity: "Critical",
    status: "actively_exploited",
    event_type: "cve",
    affected_vendor: "Acme",
    affected_cve: "CVE-2026-5050",
    ...part
  };
}

describe("planFindingUpsert", () => {
  it("creates a finding on first sighting with mapped domain/priority and CVE-prefixed title", () => {
    const p = planFindingUpsert(event({}), null);
    expect(p.action).toBe("create");
    expect(p.severity).toBe("Critical");
    expect(p.priority).toBe("immediate");
    expect(p.domain).toBe("Vendor Risk");
    expect(p.title).toBe("CVE-2026-5050: Acme Gateway RCE");
    expect(p.description).toContain("Sources: CISA KEV.");
  });

  it("updates the existing finding when severity rises (dedup-by-update, not duplicate)", () => {
    const existing: ExistingFinding = {
      id: "f-1", severity: "Moderate", title: "CVE-2026-5050: Acme Gateway RCE",
      description: "old", status: "open"
    };
    const p = planFindingUpsert(event({ severity: "Critical" }), existing);
    expect(p.action).toBe("update");
    expect(p.severity).toBe("Critical");
  });

  it("no-ops when nothing material changed", () => {
    const built = planFindingUpsert(event({}), null);
    const existing: ExistingFinding = {
      id: "f-1", severity: built.severity, title: built.title, description: built.description, status: "open"
    };
    expect(planFindingUpsert(event({}), existing).action).toBe("noop");
  });

  it("routes domain by vendor then event type", () => {
    expect(eventFindingDomain(event({ affected_vendor: "Acme" }))).toBe("Vendor Risk");
    expect(eventFindingDomain(event({ affected_vendor: null, event_type: "cve" }))).toBe("Vulnerability");
    expect(eventFindingDomain(event({ affected_vendor: null, event_type: "malware" }))).toBe("Threat Intelligence");
    expect(eventFindingDomain(event({ affected_vendor: null, event_type: "geopolitical" }))).toBe("Strategic");
  });

  it("title omits the CVE prefix when there is no CVE", () => {
    expect(eventFindingTitle(event({ affected_cve: null, title: "Vendor breach disclosed" }))).toBe("Vendor breach disclosed");
  });
});
