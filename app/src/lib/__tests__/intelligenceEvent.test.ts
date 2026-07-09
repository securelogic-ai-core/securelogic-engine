/**
 * intelligenceEvent.test.ts — the app-side fetcher for the Intelligence Event
 * drill-through (ERIP Package 3.3, PR-1). The fetcher's whole contract is its
 * fail-soft mapping over GET /api/intelligence/events/:id: a 200 yields the
 * typed detail; ANY non-200 (incl. the engine's bare 404 while the Intelligence
 * Events surface is dark) and any thrown error yield null, so the drill-through
 * page can degrade honestly and never blocks on this call.
 *
 * We stub the global fetch (Vitest, not a DOM/RTL harness) to exercise the
 * status branches directly — the app has no RTL harness and none is used here.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { getIntelligenceEvent, type IntelligenceEventDetail } from "../api";

const DETAIL: IntelligenceEventDetail = {
  event: {
    id: "11111111-1111-1111-1111-111111111111",
    canonical_key: "cve-2026-0001",
    title: "Critical RCE in Acme Gateway",
    executive_summary: "Actively exploited RCE affecting Acme Gateway.",
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
    {
      source: "CISA KEV",
      external_id: "CVE-2026-0001",
      relation: "corroborates",
      first_contributed_at: "2026-07-01T00:00:00.000Z",
      last_contributed_at: "2026-07-02T00:00:00.000Z",
    },
  ],
  timeline: [
    { entry_type: "exploit_activity", occurred_at: "2026-07-03T00:00:00.000Z", summary: "Exploitation reported", source: "CISA KEV" },
  ],
  related_findings: [],
  affected_assets: [],
  recommended_actions: [{ action: "Prioritize remediation.", urgency: "immediate" }],
};

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getIntelligenceEvent", () => {
  it("returns the parsed detail payload on 200", async () => {
    const fetchMock = vi.fn(async () => mockResponse(200, DETAIL));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getIntelligenceEvent("sl_test_key", DETAIL.event.id);

    expect(result).toEqual(DETAIL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null on 404 (Intelligence Events surface dark or not found)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(404, { error: "not_found" })));

    const result = await getIntelligenceEvent("sl_test_key", DETAIL.event.id);

    expect(result).toBeNull();
  });

  it("returns null on 500 (fail-soft, no throw)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => mockResponse(500, { error: "server_error" })));

    const result = await getIntelligenceEvent("sl_test_key", DETAIL.event.id);

    expect(result).toBeNull();
  });

  it("returns null when the request throws (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));

    const result = await getIntelligenceEvent("sl_test_key", DETAIL.event.id);

    expect(result).toBeNull();
  });

  it("sends the caller's key as a Bearer token and reads no feature flag", async () => {
    const fetchMock = vi.fn(async () => mockResponse(200, DETAIL));
    vi.stubGlobal("fetch", fetchMock);

    await getIntelligenceEvent("sl_secret_key", DETAIL.event.id);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/api/intelligence/events/${DETAIL.event.id}`);
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer sl_secret_key");
  });

  it("URL-encodes the event id", async () => {
    const fetchMock = vi.fn(async () => mockResponse(404, { error: "not_found" }));
    vi.stubGlobal("fetch", fetchMock);

    await getIntelligenceEvent("sl_test_key", "a b/c");

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain("/api/intelligence/events/a%20b%2Fc");
  });
});
