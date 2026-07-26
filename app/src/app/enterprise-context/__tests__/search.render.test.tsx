/**
 * /enterprise-context — the shared-search render contract.
 *
 * The Enterprise Context list adopts the platform SEARCH pattern (as on
 * /assets): a SEARCH label + input + button above the type chips, submitted as
 * a URL param the engine resolves through the shared asset-search capability.
 * These tests pin the cross-page consistency contract: same bounds guard, same
 * filter preservation, same honest empty state.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, signedIn, sp, hrefOf } from "@/test/harness";
import type { EnterpriseEntity } from "@/lib/enterpriseContext";

const api = vi.hoisted(() => ({
  getEnterpriseEntities: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import EnterpriseContextPage from "../page";

function anEntity(overrides: Partial<EnterpriseEntity> = {}): EnterpriseEntity {
  return {
    id: "e-1",
    organization_id: "org-1",
    entity_type: "application",
    name: "Billing App",
    description: null,
    owner_user_id: null,
    status: "active",
    criticality: "medium",
    confidence: null,
    source_type: null,
    source_id: null,
    provenance: null,
    external_ref: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

const okEntities = (entities = [anEntity()]) => ({
  ok: true as const,
  enterprise_entities: entities,
  limit: 25,
  offset: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getEnterpriseEntities.mockResolvedValue(okEntities());
});

describe("/enterprise-context — the search section", () => {
  it("renders the SEARCH label, input, and button (the platform list-page pattern)", async () => {
    await renderPage(EnterpriseContextPage, { searchParams: sp({}) });

    expect(screen.getByText("Search", { selector: "label" })).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Name, entity ID, external ref, alias..."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search" })).toBeInTheDocument();
  });

  it("an active search is applied to the engine read", async () => {
    await renderPage(EnterpriseContextPage, { searchParams: sp({ q: "billing" }) });

    expect(api.getEnterpriseEntities).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ q: "billing" }),
    );
  });

  it("blank and out-of-bounds terms are not sent (platform 2–120 guard)", async () => {
    for (const bad of ["   ", "a", "a".repeat(121)]) {
      vi.clearAllMocks();
      signedIn();
      api.getEnterpriseEntities.mockResolvedValue(okEntities());
      await renderPage(EnterpriseContextPage, { searchParams: sp({ q: bad }) });
      expect(api.getEnterpriseEntities.mock.calls[0][1].q).toBeUndefined();
    }
  });

  it("the form carries the active entity_type filter; chips and pagination preserve q", async () => {
    const { container } = await renderPage(EnterpriseContextPage, {
      searchParams: sp({ entity_type: "application", q: "billing" }),
    });

    const form = container.querySelector("form[action='/enterprise-context']") as HTMLFormElement;
    expect(form).not.toBeNull();
    expect(form.querySelector("input[name='entity_type'][value='application']")).not.toBeNull();
    expect(form.querySelector("input[name='offset']")).toBeNull(); // new search → page 1

    expect(hrefOf(container, /^All$/)).toBe("/enterprise-context?q=billing");
  });

  it("an empty search result says so — not 'no entities registered yet'", async () => {
    api.getEnterpriseEntities.mockResolvedValue(okEntities([]));

    await renderPage(EnterpriseContextPage, { searchParams: sp({ q: "nomatch" }) });

    expect(screen.getByText(/No entities match your search/i)).toBeInTheDocument();
    expect(screen.queryByText(/No entities registered yet/)).not.toBeInTheDocument();
  });
});
