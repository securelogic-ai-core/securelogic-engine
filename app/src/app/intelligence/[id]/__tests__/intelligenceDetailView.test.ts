/**
 * intelligenceDetailView.test.ts — pure resolver behind the Intelligence Event
 * drill-through (ERIP Package 3.3, PR-2). Covers the source-priority merge and
 * the honest-degrade contract without any DOM/RTL harness (the app has none).
 *
 * States exercised:
 *   - canonical present            → richest view (origin=canonical)
 *   - canonical absent, fallback   → leaner finding-context view (origin=finding_context)
 *   - neither                      → null (page shows the unavailable state)
 *   - finding-context extraction   → filters sources/timeline by event_id, misses cleanly
 */

import { describe, it, expect } from "vitest";
import {
  resolveIntelligenceDetail,
  extractFindingContextEvent,
  type FindingContextEventBundle,
} from "../intelligenceDetailView";
import type { IntelligenceEventDetail } from "@/lib/api";

const EVENT_ID = "11111111-1111-1111-1111-111111111111";

const CANONICAL: IntelligenceEventDetail = {
  event: {
    id: EVENT_ID,
    canonical_key: "cve-2026-0001",
    title: "Critical RCE in Acme Gateway",
    executive_summary: "Actively exploited RCE.",
    summary_status: "final",
    event_type: "vulnerability",
    severity: "Critical",
    status: "exploited",
    affected_cve: "CVE-2026-0001",
    affected_vendor: "Acme",
    source_count: 3,
    confidence: 0.92,
    first_seen_at: "2026-07-01T00:00:00.000Z",
    last_seen_at: "2026-07-08T00:00:00.000Z",
    revision: 2,
  },
  sources: [
    { source: "CISA KEV", external_id: "CVE-2026-0001", relation: "corroborates", first_contributed_at: "2026-07-01T00:00:00.000Z", last_contributed_at: "2026-07-02T00:00:00.000Z" },
  ],
  timeline: [
    { entry_type: "exploit_activity", occurred_at: "2026-07-03T00:00:00.000Z", summary: "Exploitation reported", source: "CISA KEV" },
  ],
  related_findings: [{ id: "f1", title: "Gateway exposed", severity: "High", status: "open", domain: null }],
  affected_assets: [{ kind: "vendor", id: "v1", name: "Acme" }],
  recommended_actions: [{ action: "Patch now.", urgency: "immediate" }],
};

describe("resolveIntelligenceDetail", () => {
  it("prefers the canonical event and maps its richest fields", () => {
    const view = resolveIntelligenceDetail(CANONICAL, null);
    expect(view).not.toBeNull();
    expect(view!.origin).toBe("canonical");
    expect(view!.event.executive_summary).toBe("Actively exploited RCE.");
    expect(view!.recommended_actions).toHaveLength(1);
    expect(view!.related_findings[0]!.id).toBe("f1");
    expect(view!.sources[0]!.source).toBe("CISA KEV");
    expect(view!.timeline[0]!.entry_type).toBe("exploit_activity");
  });

  it("falls back to the finding-context event when canonical is absent", () => {
    const fallback: FindingContextEventBundle = {
      event: { id: EVENT_ID, title: "Acme RCE", severity: "Critical", status: "exploited", affected_cve: "CVE-2026-0001" },
      sources: [{ event_id: EVENT_ID, source: "NVD", external_id: "CVE-2026-0001", relation: "corroborates", last_contributed_at: "2026-07-02T00:00:00.000Z" }],
      timeline: [{ event_id: EVENT_ID, entry_type: "disclosure", occurred_at: "2026-07-01T00:00:00.000Z", summary: "Disclosed", source: "NVD" }],
    };
    const view = resolveIntelligenceDetail(null, fallback);
    expect(view).not.toBeNull();
    expect(view!.origin).toBe("finding_context");
    expect(view!.event.title).toBe("Acme RCE");
    // Finding-context fallback carries no executive summary or enrichment.
    expect(view!.event.executive_summary).toBeNull();
    expect(view!.recommended_actions).toHaveLength(0);
    expect(view!.related_findings).toHaveLength(0);
    expect(view!.sources[0]!.source).toBe("NVD");
  });

  it("returns null when neither source is available (page shows unavailable state)", () => {
    expect(resolveIntelligenceDetail(null, null)).toBeNull();
  });

  it("returns null for a fallback bundle missing id/title (never renders half-data)", () => {
    const bad: FindingContextEventBundle = { event: { severity: "Low" }, sources: [], timeline: [] };
    expect(resolveIntelligenceDetail(null, bad)).toBeNull();
  });
});

describe("extractFindingContextEvent", () => {
  const intelligence = {
    events: [
      { id: EVENT_ID, title: "Acme RCE" },
      { id: "22222222-2222-2222-2222-222222222222", title: "Other event" },
    ],
    sources: [
      { event_id: EVENT_ID, source: "NVD" },
      { event_id: "22222222-2222-2222-2222-222222222222", source: "Vendor PSIRT" },
    ],
    timeline: [
      { event_id: EVENT_ID, entry_type: "disclosure" },
      { event_id: "22222222-2222-2222-2222-222222222222", entry_type: "patch" },
    ],
  };

  it("returns the matching event and filters sources/timeline by event_id", () => {
    const bundle = extractFindingContextEvent(intelligence, EVENT_ID);
    expect(bundle).not.toBeNull();
    expect(bundle!.sources).toHaveLength(1);
    expect(bundle!.sources[0]!["source"]).toBe("NVD");
    expect(bundle!.timeline).toHaveLength(1);
    expect(bundle!.timeline[0]!["entry_type"]).toBe("disclosure");
  });

  it("returns null when the finding context does not reference the event", () => {
    expect(extractFindingContextEvent(intelligence, "99999999-9999-9999-9999-999999999999")).toBeNull();
  });
});
