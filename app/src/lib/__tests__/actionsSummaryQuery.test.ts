/**
 * getActionsSummary — the query string is the contract.
 *
 * GET /api/actions/summary became filter-scoped: the engine builds its WHERE
 * from the same buildActionFilters() as GET /api/actions, so an identical query
 * string is what makes "the tiles describe the list" true. That guarantee lives
 * entirely in the URL this reader constructs, which is why it is asserted here
 * rather than inferred from a rendered page.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getActionsSummary } from "@/lib/api";

function mockEngine(body: unknown = { summary: { open_count: 0 } }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  } as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The path + query the reader requested, with the engine origin stripped. */
function requestedPath(fetchMock: ReturnType<typeof mockEngine>): string {
  const url = String(fetchMock.mock.calls[0][0]);
  return url.slice(url.indexOf("/api/"));
}

describe("getActionsSummary — filter forwarding", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("sends the bare org-wide URL when given no filters", async () => {
    const f = mockEngine();

    await getActionsSummary("tok");

    // Byte-identical to the URL this reader has always sent. Making the summary
    // filterable must not change what an existing caller asks for — that is what
    // keeps the workspace view (Path B) exactly as it was.
    expect(requestedPath(f)).toBe("/api/actions/summary");
  });

  it("omits filters that are absent rather than sending empty values", async () => {
    const f = mockEngine();

    await getActionsSummary("tok", { status: undefined, priority: undefined });

    // `?status=` is not "no filter" to a server that validates its inputs.
    expect(requestedPath(f)).toBe("/api/actions/summary");
  });

  it("forwards every supported filter, and only those", async () => {
    const f = mockEngine();

    await getActionsSummary("tok", {
      status: "blocked",
      priority: "immediate",
      overdue: true,
      active: true,
      owner: "me",
    });

    const qs = new URLSearchParams(requestedPath(f).split("?")[1]);
    expect(Object.fromEntries(qs)).toEqual({
      status: "blocked",
      priority: "immediate",
      overdue: "true",
      active: "true",
      owner: "me",
    });
  });

  it("never sends a pagination parameter — an aggregate over a page is the defect", async () => {
    const f = mockEngine();

    await getActionsSummary("tok", { status: "open" });

    const path = requestedPath(f);
    expect(path).not.toContain("limit");
    expect(path).not.toContain("before_created_at");
    expect(path).not.toContain("before_id");
  });

  it("a non-OK response is null — never an object of zeros", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as unknown as Response)
    );

    // The caller must be able to tell "we don't know" from "the answer is zero".
    expect(await getActionsSummary("tok", { status: "open" })).toBeNull();
  });

  it("a thrown request is null, not a crash and not a zero", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    expect(await getActionsSummary("tok")).toBeNull();
  });
});
