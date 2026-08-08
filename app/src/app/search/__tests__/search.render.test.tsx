/**
 * /search — the federated-search render contract (this workspace's first tests).
 *
 * EUX Search pass: the page must tell the whole truth about what came back
 * and never dead-end. The engine caps every category at PER_TYPE_LIMIT (5)
 * hits and reports `total` as the RETURNED count — so a section sitting at
 * the cap may be truncated, and the page must say so rather than let five
 * rows read as "five matches exist" (the same silent-count defect class the
 * Brief archive masthead had). Empty and no-result states carry the reader
 * onward to the seven canonical workspaces instead of stopping them cold.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, signedIn, hrefs } from "@/test/harness";
import { aMe } from "@/test/fixtures";
import type { GlobalSearchHit } from "@/lib/api";

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  searchGlobal: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import SearchPage from "../page";

const sp = (q?: string) => ({ searchParams: Promise.resolve(q === undefined ? {} : { q }) });

function hit(type: GlobalSearchHit["type"], n: number): GlobalSearchHit {
  return {
    type,
    id: `${type}-${n}`,
    title: `${type} result ${n}`,
    subtitle: null,
    href: `/${type}s/${type}-${n}`,
  };
}

const BROWSE_HREFS = [
  "/findings", "/risks", "/vendors", "/ai-systems", "/assets", "/controls", "/obligations",
];

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getMe.mockResolvedValue(aMe({ entitlementLevel: "platform" }));
  api.searchGlobal.mockResolvedValue(null);
});

describe("/search — honest result accounting", () => {
  it("states the total and per-section counts for an uncapped result set", async () => {
    api.searchGlobal.mockResolvedValue({
      query: "cisco",
      total: 3,
      hits: [hit("finding", 1), hit("finding", 2), hit("vendor", 1)],
    });

    const { container } = await renderPage(SearchPage, sp("cisco"));
    const text = container.textContent ?? "";

    expect(text).toContain("3 results for “cisco”");
    // Below the cap → plain counts, no "+" and no truncation caveat.
    expect(text).toContain("Findings · 2");
    expect(text).toContain("Vendors · 1");
    expect(text).not.toContain("+");
    expect(text).not.toContain("top 5 per category");
  });

  it("a section AT the engine's per-type cap admits it may be truncated", async () => {
    // 5 findings = the engine's PER_TYPE_LIMIT — the true match count is
    // unknowable from the response, so the page must not present it as exact.
    api.searchGlobal.mockResolvedValue({
      query: "log4j",
      total: 6,
      hits: [1, 2, 3, 4, 5].map((n) => hit("finding", n)).concat([hit("risk", 1)]),
    });

    const { container } = await renderPage(SearchPage, sp("log4j"));
    const text = container.textContent ?? "";

    expect(text).toContain("6 results for “log4j”");
    expect(text).toContain("showing the top 5 per category — refine your search to narrow");
    expect(text).toContain("Findings · 5+");
    // The uncapped section stays exact.
    expect(text).toContain("Risks · 1");
  });

  it("announces the result outcome to assistive tech", async () => {
    api.searchGlobal.mockResolvedValue({ query: "cisco", total: 1, hits: [hit("vendor", 1)] });

    await renderPage(SearchPage, sp("cisco"));

    expect(screen.getByRole("status").textContent).toContain("1 result for “cisco”");
  });
});

describe("/search — no dead ends", () => {
  it("with no query, offers the seven workspaces instead of a blank void", async () => {
    const { container } = await renderPage(SearchPage, sp());
    const links = hrefs(container);

    for (const href of BROWSE_HREFS) expect(links).toContain(href);
    expect(api.searchGlobal).not.toHaveBeenCalled();
  });

  it("no results → says so, explains what search matches, and carries the reader onward", async () => {
    api.searchGlobal.mockResolvedValue({ query: "zzzz", total: 0, hits: [] });

    const { container } = await renderPage(SearchPage, sp("zzzz"));
    const text = container.textContent ?? "";

    expect(text).toContain("No results for “zzzz”");
    expect(text).toContain("search matches names and titles, not full text");
    for (const href of BROWSE_HREFS) expect(hrefs(container)).toContain(href);
  });

  it("engine failure degrades to the unavailable notice, not an error page", async () => {
    api.searchGlobal.mockResolvedValue(null);

    const { container } = await renderPage(SearchPage, sp("cisco"));

    expect(container.textContent).toContain("Search is unavailable right now");
  });

  it("the input is labeled for assistive tech", async () => {
    await renderPage(SearchPage, sp());

    expect(
      screen.getByRole("searchbox", { name: /search your organization/i })
    ).toBeInTheDocument();
  });
});
