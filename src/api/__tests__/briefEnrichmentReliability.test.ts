/**
 * briefEnrichmentReliability.test.ts — IQP Q5 regression suite (Phase 1 audit
 * defect #6: the April incident — silent template fallback with no operator
 * signal; missing/invalid ANTHROPIC_API_KEY was fully silent).
 *
 * The enrichment fallback path previously had ZERO test coverage — the exact
 * template strings customers saw were unpinned. This suite covers:
 *   - no-key batch fallback: every item marked enrichment_status="fallback",
 *     the April-signature template lines pinned, summary telemetry emitted;
 *   - degraded-batch alert (flag ON) / no alert (flag OFF);
 *   - Anthropic 401 → auth-failure alert once per process (flag ON);
 *   - CVE-grounding guard: hallucinated CVE → fallback (flag ON), legacy
 *     pass-through preserved (flag OFF);
 *   - model-label telemetry fix (logs the model actually sent);
 *   - enrichment_status is INTERNAL: stripped from content_json.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockCreate, mockSendSecurityAlert } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockSendSecurityAlert: vi.fn(async () => undefined)
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  }
}));

vi.mock("../infra/alerting.js", () => ({
  sendSecurityAlert: mockSendSecurityAlert
}));

// instrumentAnthropicClient must pass our mocked client through untouched.
vi.mock("../infra/providerQuotaAlert.js", () => ({
  instrumentAnthropicClient: (c: unknown) => c,
  maybeAlertProviderQuotaError: vi.fn()
}));

import { logger } from "../infra/logger.js";
import {
  enrichBriefItems,
  buildContentJson,
  resetEnrichmentAuthAlertLatch,
  type BriefItem
} from "../lib/intelligenceBriefGenerator.js";

function item(overrides: Partial<BriefItem> = {}): BriefItem {
  return {
    cyber_signal_id: "sig-1",
    category: "vulnerability",
    relevance: "high",
    title: "VPN appliance flaw exploited",
    summary: "A VPN appliance flaw is being exploited in the wild.",
    affected_cve: "CVE-2026-1234",
    affected_vendor: "ExampleVPN",
    source_slug: "cisa_kev",
    signal_type: "cve",
    severity: "Critical",
    ingestion_timestamp: "2026-07-08T00:00:00.000Z",
    sort_order: 0,
    ...overrides
  } as BriefItem;
}

function claudeJson(payload: Record<string, unknown>): unknown {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

const GOOD_RESPONSE = {
  analysis: "Specific analysis of the ExampleVPN flaw.",
  why_it_matters: "Unpatched edge devices are being actively exploited.",
  recommended_actions: "1. Security: patch CVE-2026-1234 on edge devices by Friday.",
  urgency: "immediate"
};

beforeEach(() => {
  vi.clearAllMocks();
  resetEnrichmentAuthAlertLatch();
  delete process.env.SECURELOGIC_ENRICHMENT_RELIABILITY_ENABLED;
  process.env.ANTHROPIC_API_KEY = "test-key";
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.SECURELOGIC_ENRICHMENT_RELIABILITY_ENABLED;
});

// ---------------------------------------------------------------------------
// No-key fallback — the April signature, now pinned + counted
// ---------------------------------------------------------------------------

describe("no-key batch fallback", () => {
  it("marks every item fallback, pins the April template lines, and emits the summary", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const warnSpy = vi.spyOn(logger, "warn");

    const out = await enrichBriefItems([item(), item({ cyber_signal_id: "sig-2" })], "org-1");

    expect(out).toHaveLength(2);
    for (const o of out) {
      expect(o.enrichment_status).toBe("fallback");
      // The exact static lines of the April signature (audit
      // intelligenceBriefGenerator.ts:948-964) — pinned so any change is loud.
      expect(o.recommended_actions).toContain(
        "3. Monitor endpoint and network telemetry for indicators of compromise."
      );
      expect(o.urgency).toBe("near_term");
    }

    const summary = warnSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === "brief_enrichment_summary"
    );
    expect(summary).toBeDefined();
    expect(summary![0]).toMatchObject({ total: 2, fallback_count: 2, fallback_rate: 1 });
    warnSpy.mockRestore();
  });

  it("flag OFF: degraded batch does NOT alert (legacy silence at the alert channel only)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await enrichBriefItems([item()], "org-1");
    expect(mockSendSecurityAlert).not.toHaveBeenCalled();
  });

  it("flag ON: degraded batch fires brief_enrichment_degraded", async () => {
    process.env.SECURELOGIC_ENRICHMENT_RELIABILITY_ENABLED = "true";
    delete process.env.ANTHROPIC_API_KEY;
    await enrichBriefItems([item()], "org-1");
    expect(mockSendSecurityAlert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "brief_enrichment_degraded" })
    );
  });
});

// ---------------------------------------------------------------------------
// Successful enrichment — status marker + healthy summary
// ---------------------------------------------------------------------------

describe("successful enrichment", () => {
  it("marks items enriched and logs a healthy summary at info", async () => {
    mockCreate.mockResolvedValue(claudeJson(GOOD_RESPONSE));
    const infoSpy = vi.spyOn(logger, "info");

    const [o] = await enrichBriefItems([item()], "org-1");
    expect(o!.enrichment_status).toBe("enriched");
    expect(o!.recommended_actions).toBe(GOOD_RESPONSE.recommended_actions);

    const summary = infoSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === "brief_enrichment_summary"
    );
    expect(summary![0]).toMatchObject({ total: 1, fallback_count: 0 });
    infoSpy.mockRestore();
  });

  it("logs the model ACTUALLY sent (telemetry mislabel fixed)", async () => {
    mockCreate.mockResolvedValue(claudeJson(GOOD_RESPONSE));
    const infoSpy = vi.spyOn(logger, "info");
    await enrichBriefItems([item()], "org-1");

    const callStart = infoSpy.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === "llm_call_start"
    );
    expect(callStart).toBeDefined();
    const loggedModel = (callStart![0] as { model: string }).model;
    const sentModel = (mockCreate.mock.calls[0]![0] as { model: string }).model;
    expect(loggedModel).toBe(sentModel);
    infoSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// CVE-grounding guard (flag-gated)
// ---------------------------------------------------------------------------

describe("CVE-grounding guard", () => {
  const HALLUCINATED = {
    ...GOOD_RESPONSE,
    recommended_actions: "1. Security: patch CVE-2099-9999 immediately."
  };

  it("flag ON: a response citing a CVE absent from the item falls back", async () => {
    process.env.SECURELOGIC_ENRICHMENT_RELIABILITY_ENABLED = "true";
    mockCreate.mockResolvedValue(claudeJson(HALLUCINATED));
    const [o] = await enrichBriefItems([item()], "org-1");
    expect(o!.enrichment_status).toBe("fallback");
    expect(o!.recommended_actions).not.toContain("CVE-2099-9999");
  });

  it("flag ON: actions citing the item's OWN CVE pass", async () => {
    process.env.SECURELOGIC_ENRICHMENT_RELIABILITY_ENABLED = "true";
    mockCreate.mockResolvedValue(claudeJson(GOOD_RESPONSE));
    const [o] = await enrichBriefItems([item()], "org-1");
    expect(o!.enrichment_status).toBe("enriched");
  });

  it("flag OFF: the hallucinated action ships unchanged (legacy byte-identity)", async () => {
    mockCreate.mockResolvedValue(claudeJson(HALLUCINATED));
    const [o] = await enrichBriefItems([item()], "org-1");
    expect(o!.enrichment_status).toBe("enriched");
    expect(o!.recommended_actions).toContain("CVE-2099-9999");
  });
});

// ---------------------------------------------------------------------------
// Auth failure (401) — loud, once per process, flag-gated
// ---------------------------------------------------------------------------

describe("Anthropic auth failure", () => {
  it("flag ON: 401 fires brief_enrichment_auth_failure exactly once across the batch", async () => {
    process.env.SECURELOGIC_ENRICHMENT_RELIABILITY_ENABLED = "true";
    mockCreate.mockRejectedValue(Object.assign(new Error("auth"), { status: 401 }));
    const out = await enrichBriefItems([item(), item({ cyber_signal_id: "sig-2" })], "org-1");
    expect(out.every((o) => o.enrichment_status === "fallback")).toBe(true);
    const authCalls = mockSendSecurityAlert.mock.calls.filter(
      (c) => (c[0] as { kind: string }).kind === "brief_enrichment_auth_failure"
    );
    expect(authCalls).toHaveLength(1);
  });

  it("flag OFF: 401 falls back with no auth alert (only the summary log)", async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error("auth"), { status: 401 }));
    const [o] = await enrichBriefItems([item()], "org-1");
    expect(o!.enrichment_status).toBe("fallback");
    const authCalls = mockSendSecurityAlert.mock.calls.filter(
      (c) => (c[0] as { kind: string }).kind === "brief_enrichment_auth_failure"
    );
    expect(authCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// enrichment_status is INTERNAL — never serialized to customers
// ---------------------------------------------------------------------------

describe("content_json strip", () => {
  it("enrichment_status never appears in content_json", () => {
    const enriched = { ...item(), enrichment_status: "fallback" as const };
    const json = JSON.stringify(buildContentJson([enriched]));
    expect(json).not.toContain("enrichment_status");
  });
});
