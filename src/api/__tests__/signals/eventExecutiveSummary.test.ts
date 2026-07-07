/**
 * eventExecutiveSummary.test.ts — Intelligence Pipeline Hardening / IE.P5.
 *
 * Pins the normalized-summary contract: display-safe, enterprise-framed, cites
 * contributing sources, never raw feed text as the sole content, and the LLM
 * overlay degrades gracefully to the deterministic summary.
 */

import { describe, it, expect, vi } from "vitest";
import {
  buildEventSummary,
  prettifySource,
  type EventSummaryInput
} from "../../lib/signals/eventExecutiveSummary.js";
import { enhanceEventSummaryLLM } from "../../lib/signals/eventExecutiveSummaryLlm.js";

function input(part: Partial<EventSummaryInput>): EventSummaryInput {
  return {
    title: "Acme Gateway RCE",
    rawSummary: "Acme Gateway has a remote code execution flaw. A patch is pending.",
    severity: "High",
    status: "new",
    affected_vendor: "Acme",
    affected_cve: "CVE-2026-3030",
    sources: ["nvd"],
    ...part
  };
}

describe("buildEventSummary", () => {
  it("composes a display-safe summary that cites the sources", () => {
    const r = buildEventSummary(input({ sources: ["nvd", "cisa_kev"] }));
    expect(r.summary_status).toBe("complete");
    expect(r.summary).toContain("Acme Gateway");
    expect(r.summary).toContain("Sources: NVD, CISA KEV.");
  });

  it("adds lifecycle framing for actively_exploited / mitigated / corroborating / confirmed", () => {
    expect(buildEventSummary(input({ status: "actively_exploited" })).summary).toContain("Active exploitation");
    expect(buildEventSummary(input({ status: "mitigated" })).summary).toContain("patch or mitigation");
    expect(buildEventSummary(input({ status: "corroborating" })).summary).toContain("corroborating");
    expect(buildEventSummary(input({ status: "confirmed" })).summary).toContain("Confirmed by authoritative");
  });

  it("never emits raw truncated feed text — degraded raw yields a structured line", () => {
    const r = buildEventSummary(input({ rawSummary: "...", affected_cve: "CVE-2026-1", affected_vendor: "Acme" }));
    expect(r.summary_status).toBe("degraded");
    expect(r.summary).not.toContain("...");
    expect(r.summary).toContain("affecting Acme");
    expect(r.summary).toContain("Sources:");
  });

  it("dedupes and prettifies sources", () => {
    const r = buildEventSummary(input({ sources: ["nvd", "NVD", "bleepingcomputer"] }));
    expect(r.summary).toContain("Sources: NVD, BleepingComputer.");
  });

  it("prettifySource maps known slugs and title-cases the rest", () => {
    expect(prettifySource("cisa_kev")).toBe("CISA KEV");
    expect(prettifySource("some_new_source")).toBe("Some New Source");
  });
});

describe("enhanceEventSummaryLLM", () => {
  it("uses the LLM narrative when available and keeps the citation attached", async () => {
    const fakeClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "Acme Gateway is exposed to a serious RCE and needs urgent patching." }],
          model: "test-model"
        })
      }
    };
    const r = await enhanceEventSummaryLLM(input({ sources: ["nvd", "cisa_kev"] }), { client: fakeClient });
    expect(r.enhanced).toBe(true);
    expect(r.summary).toContain("Acme Gateway is exposed");
    expect(r.summary).toContain("Sources: NVD, CISA KEV.");
  });

  it("falls back to the deterministic summary when the LLM is unavailable", async () => {
    const r = await enhanceEventSummaryLLM(input({}), { client: null });
    expect(r.enhanced).toBe(false);
    expect(r.summary).toBe(buildEventSummary(input({})).summary);
  });

  it("falls back when the LLM returns unusable content", async () => {
    const fakeClient = { messages: { create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "..." }] }) } };
    const r = await enhanceEventSummaryLLM(input({}), { client: fakeClient });
    expect(r.enhanced).toBe(false);
    expect(r.summary).toBe(buildEventSummary(input({})).summary);
  });
});
