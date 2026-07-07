/**
 * intelligenceEventProjection.test.ts — Intelligence Pipeline Hardening / IE.P3.
 *
 * Pins the pure projection contract: first-sighting create, multi-source
 * corroboration (one evolving event, not duplicates), severity peak, status
 * precedence + promotion, exploit/patch timeline entries, idempotent
 * re-projection, and display-safe summaries.
 */

import { describe, it, expect } from "vitest";
import {
  planEventUpsert,
  type IncomingSignal,
  type ExistingEventState
} from "../../lib/signals/intelligenceEventProjection.js";

function signal(part: Partial<IncomingSignal>): IncomingSignal {
  return {
    cyber_signal_id: "sig-1",
    source: "bleepingcomputer",
    external_id: null,
    signal_type: "advisory",
    severity: "High",
    affected_cve: null,
    affected_vendor: null,
    summary: "Acme Gateway has a critical flaw. Patch is pending.",
    ingestion_timestamp: "2026-07-07T10:00:00.000Z",
    dedup_hash: "h1",
    ...part
  };
}

/** Build an ExistingEventState from a prior plan (simulating persistence). */
function stateFrom(
  plan: ReturnType<typeof planEventUpsert>,
  signalIds: string[],
  sources: string[]
): ExistingEventState {
  return {
    id: "evt-1",
    status: plan.event.status,
    severity: plan.event.severity,
    source_count: plan.event.source_count,
    revision: 1,
    contributingSignalIds: new Set(signalIds),
    distinctSources: new Set(sources.map((s) => s.toLowerCase().trim()))
  };
}

describe("planEventUpsert — first sighting", () => {
  it("creates a new event with a canonical relation source and a first_seen timeline entry", () => {
    const p = planEventUpsert(signal({ affected_cve: "CVE-2026-1001", severity: "High" }), null);
    expect(p.isNew).toBe(true);
    expect(p.changed).toBe(true);
    expect(p.canonical_key).toBe("cve:CVE-2026-1001");
    expect(p.event.source_count).toBe(1);
    expect(p.event.severity).toBe("High");
    expect(p.event.status).toBe("new");
    expect(p.source?.relation).toBe("canonical");
    expect(p.timeline.map((t) => t.entry_type)).toEqual(["first_seen"]);
    // primary summary is display-safe, not raw
    expect(p.event.summary_status).toBe("complete");
    expect(p.event.executive_summary).toContain("Acme Gateway");
  });

  it("a KEV first sighting starts exploited with an exploit_activity entry", () => {
    const p = planEventUpsert(signal({ source: "cisa_kev", affected_cve: "CVE-2026-9001", signal_type: "cve" }), null);
    expect(p.event.status).toBe("exploited");
    expect(p.timeline.map((t) => t.entry_type)).toContain("exploit_activity");
  });
});

describe("planEventUpsert — corroboration (same CVE, second source)", () => {
  const first = planEventUpsert(signal({ cyber_signal_id: "sig-1", source: "nvd", affected_cve: "CVE-2026-1001", severity: "Moderate" }), null);
  const state = stateFrom(first, ["sig-1"], ["nvd"]);

  it("updates the SAME event, promotes new→evolving, raises confidence, no duplicate", () => {
    const p = planEventUpsert(
      signal({ cyber_signal_id: "sig-2", source: "bleepingcomputer", affected_cve: "CVE-2026-1001", severity: "Moderate" }),
      state
    );
    expect(p.isNew).toBe(false);
    expect(p.canonical_key).toBe("cve:CVE-2026-1001");
    expect(p.event.source_count).toBe(2);
    expect(p.event.status).toBe("evolving");
    expect(p.event.confidence).toBeGreaterThan(first.event.confidence);
    expect(p.source?.relation).toBe("corroborating");
    expect(p.timeline.map((t) => t.entry_type)).toContain("corroborated");
  });

  it("takes the peak severity and records a severity_change when it rises", () => {
    const p = planEventUpsert(
      signal({ cyber_signal_id: "sig-3", source: "cisa_kev", affected_cve: "CVE-2026-1001", severity: "Critical", signal_type: "cve" }),
      state
    );
    expect(p.event.severity).toBe("Critical");
    expect(p.event.status).toBe("exploited");
    const types = p.timeline.map((t) => t.entry_type);
    expect(types).toContain("severity_change");
    expect(types).toContain("exploit_activity");
  });
});

describe("planEventUpsert — idempotency", () => {
  it("a signal that already contributed produces a no-op plan (no source, no timeline, unchanged)", () => {
    const first = planEventUpsert(signal({ cyber_signal_id: "sig-1", affected_cve: "CVE-2026-1001" }), null);
    const state = stateFrom(first, ["sig-1"], ["bleepingcomputer"]);
    const again = planEventUpsert(signal({ cyber_signal_id: "sig-1", affected_cve: "CVE-2026-1001" }), state);
    expect(again.changed).toBe(false);
    expect(again.source).toBeNull();
    expect(again.timeline).toEqual([]);
    expect(again.event.source_count).toBe(1);
  });
});

describe("planEventUpsert — patch flow", () => {
  it("a patch signal moves an evolving event to patched with a patch_available entry", () => {
    const first = planEventUpsert(signal({ cyber_signal_id: "s1", source: "nvd", affected_cve: "CVE-2026-2002", signal_type: "cve" }), null);
    let state = stateFrom(first, ["s1"], ["nvd"]);
    // promote to evolving via a second source
    const second = planEventUpsert(signal({ cyber_signal_id: "s2", source: "krebsonsecurity", affected_cve: "CVE-2026-2002" }), state);
    state = stateFrom(second, ["s1", "s2"], ["nvd", "krebsonsecurity"]);
    const patch = planEventUpsert(
      signal({ cyber_signal_id: "s3", source: "bleepingcomputer", affected_cve: "CVE-2026-2002", signal_type: "patch" }),
      state
    );
    expect(patch.event.status).toBe("patched");
    expect(patch.timeline.map((t) => t.entry_type)).toContain("patch_available");
  });
});

describe("planEventUpsert — degenerate content", () => {
  it("builds a structured title when the summary is unusable, never a broken sentence", () => {
    const p = planEventUpsert(
      signal({ summary: "...", affected_cve: "CVE-2026-7007", affected_vendor: "Acme", signal_type: "cve", dedup_hash: "z1" }),
      null
    );
    expect(p.event.title).toContain("CVE-2026-7007");
    expect(p.event.summary_status).toBe("degraded");
    expect(p.event.executive_summary).toBe(p.event.title);
  });
});
