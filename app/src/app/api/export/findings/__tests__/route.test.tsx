/**
 * route.test.tsx — EXP-1 proxy regression suite for GET /api/export/findings.
 *
 * The proxy must return a real CSV attachment (text/csv + .csv filename,
 * filters forwarded to the engine) on success, and a JSON error — never an
 * attachment — when the engine call fails, so the client error path (see
 * downloadFile.test.tsx) can stop the browser from saving an error payload.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({
  getSession: vi.fn(async () => ({ jwtToken: "test-jwt", apiKey: null })),
}));

import { GET } from "../route";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(qs = ""): NextRequest {
  return new NextRequest(`http://localhost:3000/api/export/findings${qs}`);
}

describe("GET /api/export/findings", () => {
  it("returns text/csv with a .csv attachment filename and the engine's CSV body", async () => {
    const csv = '"ID","Title"\r\n"1","Finding"\r\n';
    global.fetch = vi.fn(async () =>
      new Response(csv, {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": 'attachment; filename="findings-2026-07-16.csv"',
        },
      })
    ) as typeof fetch;

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/filename="findings-.*\.csv"/);
    expect(await res.text()).toBe(csv);
  });

  it("forwards the browser's filter query params to the engine export URL", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request) =>
      new Response("a\r\n", { status: 200, headers: { "content-type": "text/csv" } })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await GET(makeRequest("?status=open&severity=High"));

    const calledUrl = String(fetchMock.mock.calls[0]![0]);
    expect(calledUrl).toContain("/api/findings/export.csv?status=open&severity=High");
  });

  it("returns a JSON error with no attachment when the engine responds with an error", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: "finding_id_must_be_uuid" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    ) as typeof fetch;

    const res = await GET(makeRequest());

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(await res.json()).toEqual({ error: "upstream_error" });
  });

  it("returns 502 JSON with no attachment when the engine is unreachable", async () => {
    global.fetch = vi.fn(async () => {
      throw new TypeError("connect ECONNREFUSED");
    }) as typeof fetch;

    const res = await GET(makeRequest());

    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(await res.json()).toEqual({ error: "engine_unavailable" });
  });
});
