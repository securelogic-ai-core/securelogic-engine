/**
 * /portal/accept/[token] — the invite exchange flow.
 *
 * The contract under test: the token from the URL is POSTed to the same-origin
 * proxy exactly once, the vendor lands on /portal with no secret in the URL,
 * the token is never rendered, and the engine's failure semantics (410
 * expired vs 401 invalid) produce distinct, actionable states.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { renderPage, clientRouter } from "@/test/harness";
import AcceptInvitePage from "../accept/[token]/page";

const TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2";

function mockExchange(status: number, body: unknown = {}) {
  const fetchMock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("invite accept page", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("exchanges the token once and replaces the URL with /portal", async () => {
    const fetchMock = mockExchange(200, { ok: true });
    await renderPage(AcceptInvitePage, { params: Promise.resolve({ token: TOKEN }) });

    await waitFor(() => {
      expect(clientRouter.replace).toHaveBeenCalledWith("/portal");
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/vendor-portal/session");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ token: TOKEN });
  });

  it("never renders the token anywhere", async () => {
    mockExchange(200, { ok: true });
    const { container } = await renderPage(AcceptInvitePage, {
      params: Promise.resolve({ token: TOKEN }),
    });
    await waitFor(() => {
      expect(clientRouter.replace).toHaveBeenCalled();
    });
    expect(container.innerHTML).not.toContain(TOKEN);
  });

  it("shows the actionable expired state on 410", async () => {
    mockExchange(410, {
      error: "portal_link_expired",
      message: "This link has expired. Please ask your contact for a new one.",
    });
    await renderPage(AcceptInvitePage, { params: Promise.resolve({ token: TOKEN }) });

    expect(await screen.findByText(/this link has expired/i)).toBeInTheDocument();
    expect(screen.getByText(/send you a new link/i)).toBeInTheDocument();
    expect(clientRouter.replace).not.toHaveBeenCalled();
  });

  it("shows the generic invalid state on 401 (invalid and revoked collapse)", async () => {
    mockExchange(401, { error: "portal_link_invalid" });
    await renderPage(AcceptInvitePage, { params: Promise.resolve({ token: TOKEN }) });

    expect(await screen.findByText(/this link is not valid/i)).toBeInTheDocument();
    expect(clientRouter.replace).not.toHaveBeenCalled();
  });

  it("offers a retry on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    await renderPage(AcceptInvitePage, { params: Promise.resolve({ token: TOKEN }) });

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
