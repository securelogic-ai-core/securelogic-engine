/**
 * mitreAdapterEtag.test.ts — Conditional GET behavior for MITRE adapters.
 *
 * Both fetchMitreAttackSignals and fetchMitreAtlasSignals share the same
 * ETag protocol:
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

// Mock the ETag store before importing the adapters so the import binding
// resolves to the mock. vi.mock is hoisted, so the call below applies to
// every import in this file.
vi.mock("../lib/feedEtagStore.js", () => ({
  getEtag: vi.fn(),
  setEtag: vi.fn()
}));

import {
  fetchMitreAttackSignals,
  MITRE_ATTACK_BUNDLE_URL,
  MITRE_ATTACK_ETAG_KEY
} from "../lib/mitreAttackAdapter.js";
import {
  fetchMitreAtlasSignals,
  MITRE_ATLAS_BUNDLE_URL,
  MITRE_ATLAS_ETAG_KEY
} from "../lib/mitreAtlasAdapter.js";
import { getEtag, setEtag } from "../lib/feedEtagStore.js";

const mockedGetEtag = vi.mocked(getEtag);
const mockedSetEtag = vi.mocked(setEtag);

/**
 * Build a Response-shaped object that fetch() returns. Vitest does not
 * polyfill Response, so we construct the surface adapters actually touch:
 * `status`, `ok`, `headers.get`, and either `json()` or nothing on 304.
 */
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
 * Minimal valid STIX bundle the adapters can parse. We don't care about the
 * mapped output here — these tests cover the conditional-GET protocol, not
 * the STIX → CyberSignalIngestInput mapping (which has its own coverage).
 */
const minimalBundle = {
  type: "bundle",
  id: "bundle--test",
  objects: []
};

describe("fetchMitreAttackSignals — conditional GET", () => {
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
    mockedGetEtag.mockResolvedValueOnce('W/"abc123"');
    const jsonFn = vi.fn();
    fetchSpy.mockResolvedValueOnce(
      // No body — adapter must not call json() on a 304.
      { ...fakeResponse({ status: 304 }), json: jsonFn } as unknown as Response
    );

    const result = await fetchMitreAttackSignals();

    expect(result).toEqual({
      signals: [],
      total: 0,
      skipped: 0,
      fromCache: true
    });

    // Verify the request carried If-None-Match with the cached ETag.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0]!;
    expect(calledUrl).toBe(MITRE_ATTACK_BUNDLE_URL);
    expect((calledInit as RequestInit).headers).toMatchObject({
      "If-None-Match": 'W/"abc123"'
    });

    // Adapter must not have parsed a body.
    expect(jsonFn).not.toHaveBeenCalled();

    // No new ETag persisted on a 304.
    expect(mockedSetEtag).not.toHaveBeenCalled();
  });

  it("does not send If-None-Match when no cached ETag exists", async () => {
    mockedGetEtag.mockResolvedValueOnce(null);
    fetchSpy.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: minimalBundle, etag: 'W/"new"' })
    );

    await fetchMitreAttackSignals();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, calledInit] = fetchSpy.mock.calls[0]!;
    const headers = (calledInit as RequestInit).headers as Record<string, string>;
    expect(headers["If-None-Match"]).toBeUndefined();
  });

  it("captures the response ETag into Redis on 200 OK", async () => {
    mockedGetEtag.mockResolvedValueOnce(null);
    fetchSpy.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: minimalBundle, etag: 'W/"new-etag-789"' })
    );

    const result = await fetchMitreAttackSignals();

    expect(result.fromCache).toBe(false);
    expect(mockedSetEtag).toHaveBeenCalledWith(
      MITRE_ATTACK_ETAG_KEY,
      'W/"new-etag-789"'
    );
  });

  it("does not call setEtag when the 200 response omits an ETag header", async () => {
    mockedGetEtag.mockResolvedValueOnce(null);
    fetchSpy.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: minimalBundle }) // no etag
    );

    await fetchMitreAttackSignals();

    expect(mockedSetEtag).not.toHaveBeenCalled();
  });

  it("throws on 5xx (existing error contract preserved)", async () => {
    mockedGetEtag.mockResolvedValueOnce(null);
    fetchSpy.mockResolvedValueOnce(fakeResponse({ status: 503 }));

    await expect(fetchMitreAttackSignals()).rejects.toThrow(/HTTP 503/);
  });
});

describe("fetchMitreAtlasSignals — conditional GET", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockedGetEtag.mockReset();
    mockedSetEtag.mockReset();
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("sends If-None-Match with the cached ETag and returns fromCache=true on 304", async () => {
    mockedGetEtag.mockResolvedValueOnce('"atlas-etag-1"');
    const jsonFn = vi.fn();
    fetchSpy.mockResolvedValueOnce(
      { ...fakeResponse({ status: 304 }), json: jsonFn } as unknown as Response
    );

    const result = await fetchMitreAtlasSignals();

    expect(result).toEqual({
      signals: [],
      total: 0,
      skipped: 0,
      fromCache: true
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0]!;
    expect(calledUrl).toBe(MITRE_ATLAS_BUNDLE_URL);
    expect((calledInit as RequestInit).headers).toMatchObject({
      "If-None-Match": '"atlas-etag-1"'
    });

    expect(jsonFn).not.toHaveBeenCalled();
    expect(mockedSetEtag).not.toHaveBeenCalled();
  });

  it("captures the response ETag into Redis on 200 OK", async () => {
    mockedGetEtag.mockResolvedValueOnce(null);
    fetchSpy.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: minimalBundle, etag: '"atlas-new"' })
    );

    const result = await fetchMitreAtlasSignals();

    expect(result.fromCache).toBe(false);
    expect(mockedSetEtag).toHaveBeenCalledWith(
      MITRE_ATLAS_ETAG_KEY,
      '"atlas-new"'
    );
  });

  it("uses the ATLAS-specific Redis key (not the ATT&CK key)", async () => {
    mockedGetEtag.mockResolvedValueOnce(null);
    fetchSpy.mockResolvedValueOnce(
      fakeResponse({ status: 200, body: minimalBundle, etag: '"x"' })
    );

    await fetchMitreAtlasSignals();

    expect(mockedGetEtag).toHaveBeenCalledWith(MITRE_ATLAS_ETAG_KEY);
    expect(mockedGetEtag).not.toHaveBeenCalledWith(MITRE_ATTACK_ETAG_KEY);
  });

  it("throws on 5xx (existing error contract preserved)", async () => {
    mockedGetEtag.mockResolvedValueOnce(null);
    fetchSpy.mockResolvedValueOnce(fakeResponse({ status: 502 }));

    await expect(fetchMitreAtlasSignals()).rejects.toThrow(/HTTP 502/);
  });
});

describe("Redis-key separation across adapters", () => {
  it("uses distinct keys for the two bundles", () => {
    expect(MITRE_ATTACK_ETAG_KEY).toBe("mitre:attack:etag");
    expect(MITRE_ATLAS_ETAG_KEY).toBe("mitre:atlas:etag");
    expect(MITRE_ATTACK_ETAG_KEY).not.toBe(MITRE_ATLAS_ETAG_KEY);
  });
});
