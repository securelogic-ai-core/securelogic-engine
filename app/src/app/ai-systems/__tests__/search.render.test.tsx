/**
 * /ai-systems — the shared-search render contract.
 *
 * Mirrors the /vendors search tests — the two federated per-type lists must
 * behave identically (cross-page consistency): same SEARCH pattern, same
 * bounds guard, same honest empty state.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, signedIn, sp } from "@/test/harness";
import { anAiSystem } from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getAiSystems: vi.fn(),
  getGovernanceReviews: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import AiSystemsPage from "../page";

const okSystems = (systems = [anAiSystem({ name: "Fraud Model" })]) => ({
  count: systems.length,
  limit: 100,
  organizationId: "org-1",
  nextCursor: null,
  ai_systems: systems,
});

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getAiSystems.mockResolvedValue(okSystems());
  api.getGovernanceReviews.mockResolvedValue({ reviews: [] });
});

describe("/ai-systems — the search section", () => {
  it("renders the SEARCH label, input, and button (the platform list-page pattern)", async () => {
    await renderPage(AiSystemsPage, { searchParams: sp({}) });

    expect(screen.getByText("Search", { selector: "label" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Name, system ID, product alias...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });

  it("an active search is applied to the engine read", async () => {
    await renderPage(AiSystemsPage, { searchParams: sp({ q: "fraud" }) });

    expect(api.getAiSystems).toHaveBeenCalledWith(expect.anything(), { q: "fraud" });
  });

  it("blank and out-of-bounds terms are not sent (platform 2–120 guard)", async () => {
    for (const bad of ["   ", "a", "a".repeat(121)]) {
      vi.clearAllMocks();
      signedIn();
      api.getAiSystems.mockResolvedValue(okSystems());
      api.getGovernanceReviews.mockResolvedValue({ reviews: [] });
      await renderPage(AiSystemsPage, { searchParams: sp({ q: bad }) });
      expect(api.getAiSystems).toHaveBeenCalledWith(expect.anything(), { q: undefined });
    }
  });

  it("the page still renders with NO searchParams at all (legacy invocation)", async () => {
    // AiSystemsPage historically took no props; the searchParams prop is
    // optional so nothing that renders it bare can break.
    await renderPage(AiSystemsPage, {});
    expect(screen.getByText(/Fraud Model/)).toBeInTheDocument();
  });

  it("an empty search result says so — not 'no systems registered yet'", async () => {
    api.getAiSystems.mockResolvedValue(okSystems([]));

    await renderPage(AiSystemsPage, { searchParams: sp({ q: "nomatch" }) });

    expect(screen.getByText(/No AI systems match your search/i)).toBeInTheDocument();
    expect(screen.queryByText(/No AI systems registered yet/)).not.toBeInTheDocument();
  });
});
