/**
 * intelligenceEventProjection.test.ts — Intelligence Pipeline Hardening / IE.P3.
 *
 * Pins the pure projection contract with the 7-state lifecycle: first-sighting
 * create, multi-source corroboration (one evolving event, not duplicates),
 * severity peak, lifecycle-state derivation (new → corroborating → confirmed →
 * actively_exploited / mitigated), exploit/patch timeline entries, idempotent
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
    source: "bleepingcomputer", // non-authoritative by default
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
    ever_exploited: plan.event.ever_exploited,
    ever_patched: plan.event.ever_patched,
    contributingSignalIds: new Set(signalIds),
    distinctSources: new Set(sources.map((s) => s.toLowerCase().trim()))
  };
}

describe("planEventUpsert — first sighting", () => {
  it("a single non-authoritative source creates a 'new' event with a first_seen entry", () => {
    const p = planEventUpsert(signal({ affected_cve: "CVE-2026-1001", severity: "High" }), null);
    expect(p.isNew).toBe(true);
    expect(p.canonical_key).toBe("cve:CVE-2026-1001");
    expect(p.event.source_count).toBe(1);
    expect(p.event.status).toBe("new");
    expect(p.source?.relation).toBe("canonical");
    expect(p.timeline.map((t) => t.entry_type)).toEqual(["first_seen"]);
    expect(p.event.summary_status).toBe("complete");
  });

  it("a single AUTHORITATIVE source (nvd) confirms immediately", () => {
    const p = planEventUpsert(signal({ source: "nvd", affected_cve: "CVE-2026-1002", signal_type: "cve" }), null);
    expect(p.event.status).toBe("confirmed");
  });

  it("a KEV first sighting is actively_exploited with an exploit_activity entry", () => {
    const p = planEventUpsert(signal({ source: "cisa_kev", affected_cve: "CVE-2026-9001", signal_type: "cve" }), null);
    expect(p.event.status).toBe("actively_exploited");
    expect(p.event.ever_exploited).toBe(true);
    expect(p.timeline.map((t) => t.entry_type)).toContain("exploit_activity");
  });
});

describe("planEventUpsert — corroboration", () => {
  const first = planEventUpsert(signal({ cyber_signal_id: "sig-1", source: "bleepingcomputer", affected_cve: "CVE-2026-1001", severity: "Moderate" }), null);
  const state = stateFrom(first, ["sig-1"], ["bleepingcomputer"]);

  it("a second non-authoritative source promotes new → corroborating, no duplicate", () => {
    const p = planEventUpsert(
      signal({ cyber_signal_id: "sig-2", source: "krebsonsecurity", affected_cve: "CVE-2026-1001", severity: "Moderate" }),
      state
    );
    expect(p.isNew).toBe(false);
    expect(p.event.source_count).toBe(2);
    expect(p.event.status).toBe("corroborating");
    expect(p.event.confidence).toBeGreaterThan(first.event.confidence);
    expect(p.source?.relation).toBe("corroborating");
    expect(p.timeline.map((t) => t.entry_type)).toContain("corroborated");
  });

  it("an authoritative corroboration confirms; a KEV report escalates to actively_exploited", () => {
    const p = planEventUpsert(
      signal({ cyber_signal_id: "sig-3", source: "cisa_kev", affected_cve: "CVE-2026-1001", severity: "Critical", signal_type: "cve" }),
      state
    );
    expect(p.event.severity).toBe("Critical");
    expect(p.event.status).toBe("actively_exploited");
    const types = p.timeline.map((t) => t.entry_type);
    expect(types).toContain("severity_change");
    expect(types).toContain("exploit_activity");
    expect(types).toContain("status_change");
  });
});

describe("planEventUpsert — idempotency", () => {
  it("a signal that already contributed produces a no-op plan", () => {
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
  it("a patch signal moves an event to mitigated with a patch_available entry", () => {
    const first = planEventUpsert(signal({ cyber_signal_id: "s1", source: "nvd", affected_cve: "CVE-2026-2002", signal_type: "cve" }), null);
    const state = stateFrom(first, ["s1"], ["nvd"]);
    const patch = planEventUpsert(
      signal({ cyber_signal_id: "s3", source: "bleepingcomputer", affected_cve: "CVE-2026-2002", signal_type: "patch" }),
      state
    );
    expect(patch.event.status).toBe("mitigated");
    expect(patch.event.ever_patched).toBe(true);
    expect(patch.timeline.map((t) => t.entry_type)).toContain("patch_available");
  });

  it("exploited then patched → mitigated (a fix now exists for the active threat)", () => {
    const kev = planEventUpsert(signal({ cyber_signal_id: "s1", source: "cisa_kev", affected_cve: "CVE-2026-3003", signal_type: "cve" }), null);
    expect(kev.event.status).toBe("actively_exploited");
    const state = stateFrom(kev, ["s1"], ["cisa_kev"]);
    const patch = planEventUpsert(signal({ cyber_signal_id: "s2", source: "nvd", affected_cve: "CVE-2026-3003", signal_type: "patch" }), state);
    expect(patch.event.ever_exploited).toBe(true);
    expect(patch.event.ever_patched).toBe(true);
    expect(patch.event.status).toBe("mitigated");
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
    expect(p.event.executive_summary).toContain("CVE-2026-7007");
    expect(p.event.executive_summary).toContain("Sources:");
    expect(p.event.executive_summary).not.toContain("...");
  });
});
