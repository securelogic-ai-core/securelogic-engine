/**
 * intelligenceEventsRoute.test.ts — Intelligence Pipeline Hardening / IE.P7.
 *
 * Handler-level validation for the canonical event read API: bad severity /
 * status / id are rejected 400, a missing event is 404, and a valid request
 * returns the reader's rows. The reader (global DB) is mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// The route transitively imports auth middleware → the DB pool; stub it.
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgElevated: { query: vi.fn() },
  pgRaw: { query: vi.fn() },
  withTenant: vi.fn(),
  withElevated: vi.fn()
}));

vi.mock("../lib/signals/intelligenceEventReader.js", () => ({
  listIntelligenceEvents: vi.fn(),
  getIntelligenceEventDetail: vi.fn(),
  getExecutiveEventSummary: vi.fn()
}));

import { getEventsList, getEventDetail, getExecutiveSummary } from "../routes/intelligenceEvents.js";
import {
  listIntelligenceEvents,
  getIntelligenceEventDetail,
  getExecutiveEventSummary
} from "../lib/signals/intelligenceEventReader.js";
import type { Request, Response } from "express";

function mockRes(): Response & { _status: number; _json: unknown } {
  const res = {
    _status: 0,
    _json: undefined as unknown,
    status(code: number) { (this as { _status: number })._status = code; return this; },
    json(body: unknown) { (this as { _json: unknown })._json = body; return this; }
  };
  return res as unknown as Response & { _status: number; _json: unknown };
}

const req = (query: Record<string, unknown> = {}, params: Record<string, unknown> = {}): Request =>
  ({ query, params } as unknown as Request);

beforeEach(() => vi.clearAllMocks());

describe("GET /intelligence/events", () => {
  it("rejects an invalid severity", async () => {
    const res = mockRes();
    await getEventsList(req({ severity: "Nope" }), res);
    expect(res._status).toBe(400);
    expect(listIntelligenceEvents).not.toHaveBeenCalled();
  });

  it("rejects an invalid status", async () => {
    const res = mockRes();
    await getEventsList(req({ status: "bogus" }), res);
    expect(res._status).toBe(400);
  });

  it("returns the reader rows on a valid request", async () => {
    vi.mocked(listIntelligenceEvents).mockResolvedValue([{ id: "e1" }] as never);
    const res = mockRes();
    await getEventsList(req({ severity: "Critical", limit: "10" }), res);
    expect(res._status).toBe(200);
    expect((res._json as { events: unknown[] }).events).toHaveLength(1);
    expect(vi.mocked(listIntelligenceEvents).mock.calls[0][0]).toMatchObject({ severity: "Critical", limit: 10 });
  });
});

describe("GET /intelligence/events/:id", () => {
  it("rejects a non-UUID id", async () => {
    const res = mockRes();
    await getEventDetail(req({}, { id: "not-a-uuid" }), res);
    expect(res._status).toBe(400);
    expect(getIntelligenceEventDetail).not.toHaveBeenCalled();
  });

  it("404s when the event is missing", async () => {
    vi.mocked(getIntelligenceEventDetail).mockResolvedValue(null);
    const res = mockRes();
    await getEventDetail(req({}, { id: "11111111-1111-1111-1111-111111111111" }), res);
    expect(res._status).toBe(404);
  });

  it("returns the enriched detail when found and passes the org context", async () => {
    vi.mocked(getIntelligenceEventDetail).mockResolvedValue({
      event: { id: "e1" }, sources: [], timeline: [], related_findings: [], affected_assets: [], recommended_actions: []
    } as never);
    const res = mockRes();
    const request = { query: {}, params: { id: "11111111-1111-1111-1111-111111111111" }, organizationContext: { organizationId: "org-9" } } as unknown as Request;
    await getEventDetail(request, res);
    expect(res._status).toBe(200);
    expect((res._json as { event: { id: string } }).event.id).toBe("e1");
    expect(vi.mocked(getIntelligenceEventDetail).mock.calls[0]).toEqual(["11111111-1111-1111-1111-111111111111", "org-9"]);
  });
});

describe("GET /intelligence/executive-summary", () => {
  it("returns the aggregate event summary with the requested window", async () => {
    vi.mocked(getExecutiveEventSummary).mockResolvedValue({ total: 3, actively_exploited: 1 } as never);
    const res = mockRes();
    await getExecutiveSummary(req({ window_days: "14" }), res);
    expect(res._status).toBe(200);
    expect((res._json as { total: number }).total).toBe(3);
    expect(vi.mocked(getExecutiveEventSummary).mock.calls[0][0]).toBe(14);
  });
});
