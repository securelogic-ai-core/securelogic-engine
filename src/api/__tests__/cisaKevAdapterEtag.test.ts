/**
 * cisaKevAdapterEtag.test.ts — Conditional GET behavior for the CISA KEV adapter.
 *
 * Mirrors mitreAdapterEtag.test.ts. The adapter shares the same ETag protocol:
 *   - Read cached ETag from Redis (via feedEtagStore).
 *   - Send `If-None-Match` if a cached ETag exists.
 *   - On 304 Not Modified → return `{ signals: [], total: 0, skipped: 0,
 *     fromCache: true }` without parsing a body.
 *   - On 200 OK → capture the response `ETag` header into Redis for next
 *     call, then proceed with the existing parse + map pipeline.
 *
 * Tests mock globalThis.fetch and the feedEtagStore module directly, so no
 * network and no Redis dependency.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/feedEtagStore.js", () => ({
  getEtag: vi.fn(),
  setEtag: vi.fn()
}));

import {
  fetchCisaKevSignals,
  CISA_KEV_FEED_URL,
  CISA_KEV_ETAG_KEY
} from "../lib/cisaKevAdapter.js";
import { getEtag, setEtag } from "../lib/feedEtagStore.js";

const mockedGetEtag = vi.mocked(getEtag);
const mockedSetEtag = vi.mocked(setEtag);

function fakeResponse(args: {
  status: number;
  body?: unknown;
  etag?: string;
}): Response {
  const { status, body, etag } = args;
  const ok = status >= 200 && status < 300;
  const headers = new Headers();
  if (etag) headers.set("etag", etag);

  return {
    status,
    ok,
    statusText: status === 304 ? "Not Modified" : ok ? "OK" : "Error",
    headers,
    json: vi.fn(async () => body),
    text: vi.fn(async () => JSON.stringify(body ?? null))
  } as unknown as Response;
}

/**
 * Minimal valid KEV feed the adapter can parse. Shape mirrors the real
 * upstream — `vulnerabilities` is the array the adapter iterates, every
 * other top-level field is currently ignored by the mapper.
 */
const minimalKevFeed = {
  title: "Test KEV",
  catalogVersion: "2026.05.02",
  dateReleased: "2026-05-02T00:00:00.000Z",
  count: 0,
  vulnerabilities: []
};

describe("fetchCisaKevSignals — conditional GET", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockedGetEtag.mockReset();
    mockedSetEtag.mockReset();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("sends If-None-Match when a cached ETag exists, returns fromCache=true on 304, skips parse", async () => {
    mockedGetEtag.mockResolvedValueOnce('W/"kev-abc123"');
    const jsonFn = vi.fn();
    fetchSpy.mockResolvedValueOnce(
      // No body — adapter must not call json() on a 304.
      { ...fakeResponse({ status: 304 }), json: jsonFn } as unknown as Response
    );

    const result = await fetchCisaKevSignals();

    expect(result).toEqual({
      signals: [],
      total: 0,
      skipped: 0,
      fromCache: true
    });

    // Verify the request carried If-None-Match with the cached ETag.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0]!;
    expect(calledUrl).toBe(CISA_KEV_FEED_URL);
    expect((calledInit as RequestInit).headers).toMatchObject({
      "If-None-Match": 'W/"kev-abc123"'
    });

    // Adapter must not have parsed a body.
    expect(jsonFn).not.toHaveBeenCalled();

    // No new ETag persisted on a 304.
    expect(mockedSetEtag).not.toHaveBeenCalled();
  });

  it("does not send If-None-Match when no cached ETag exists", async () => {
    mockedGetEtag.mockResolvedValueOnce(null);
    fetchSpy.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: minimalKevFeed, etag: 'W/"kev-new"' })
    );

    await fetchCisaKevSignals();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, calledInit] = fetchSpy.mock.calls[0]!;
    const headers = (calledInit as RequestInit).headers as Record<string, string>;
    expect(headers["If-None-Match"]).toBeUndefined();
  });

  it("captures the response ETag into Redis on 200 OK", async () => {
    mockedGetEtag.mockResolvedValueOnce(null);
    fetchSpy.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: minimalKevFeed, etag: 'W/"kev-new-etag-789"' })
    );

    const result = await fetchCisaKevSignals();

    expect(result.fromCache).toBe(false);
    expect(mockedSetEtag).toHaveBeenCalledWith(
      CISA_KEV_ETAG_KEY,
      'W/"kev-new-etag-789"'
    );
  });

  it("does not call setEtag when the 200 response omits an ETag header", async () => {
    mockedGetEtag.mockResolvedValueOnce(null);
    fetchSpy.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: minimalKevFeed }) // no etag
    );

    await fetchCisaKevSignals();

    expect(mockedSetEtag).not.toHaveBeenCalled();
  });

  it("uses the KEV-specific Redis key", async () => {
    mockedGetEtag.mockResolvedValueOnce(null);
    fetchSpy.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: minimalKevFeed, etag: '"x"' })
    );

    await fetchCisaKevSignals();

    expect(mockedGetEtag).toHaveBeenCalledWith(CISA_KEV_ETAG_KEY);
  });

  it("falls back to unconditional fetch when getEtag returns null", async () => {
    // The store helper catches Redis errors internally and returns null on
    // failure. When the helper returns null, the adapter behaves the same
    // as having no cached ETag.
    mockedGetEtag.mockResolvedValueOnce(null);
    fetchSpy.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: minimalKevFeed, etag: 'W/"x"' })
    );

    await fetchCisaKevSignals();

    const [, calledInit] = fetchSpy.mock.calls[0]!;
    const headers = (calledInit as RequestInit).headers as Record<string, string>;
    expect(headers["If-None-Match"]).toBeUndefined();
  });

  it("throws on 5xx (existing error contract preserved)", async () => {
    mockedGetEtag.mockResolvedValueOnce(null);
    fetchSpy.mockResolvedValueOnce(fakeResponse({ status: 503 }));

    await expect(fetchCisaKevSignals()).rejects.toThrow(/HTTP 503/);
  });

  it("throws on malformed body (vulnerabilities missing)", async () => {
    mockedGetEtag.mockResolvedValueOnce(null);
    fetchSpy.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: { title: "broken" }, etag: '"x"' })
    );

    await expect(fetchCisaKevSignals()).rejects.toThrow(/vulnerabilities array missing/);
  });
});

describe("CISA_KEV_ETAG_KEY", () => {
  it("is the documented kev:catalog:etag namespace", () => {
    expect(CISA_KEV_ETAG_KEY).toBe("kev:catalog:etag");
  });

  it("does not collide with the MITRE adapter keys", async () => {
    const { MITRE_ATTACK_ETAG_KEY } = await import("../lib/mitreAttackAdapter.js");
    const { MITRE_ATLAS_ETAG_KEY } = await import("../lib/mitreAtlasAdapter.js");
    expect(CISA_KEV_ETAG_KEY).not.toBe(MITRE_ATTACK_ETAG_KEY);
    expect(CISA_KEV_ETAG_KEY).not.toBe(MITRE_ATLAS_ETAG_KEY);
  });
});
