/**
 * /login — the SSO availability check.
 *
 * Two contracts, both learned on staging:
 * 1. The request URL has exactly ONE slash at the path boundary whether or not
 *    NEXT_PUBLIC_ENGINE_URL was configured with a trailing slash. (It was; the
 *    page fetched `https://engine//api/sso/check-domain`.)
 * 2. A failed check is handled INTENTIONALLY: no exception escapes the page,
 *    the password form stays, and no SSO button is offered. WebKit surfaces an
 *    unhandled fetch failure as a page error, which the staging journey caught.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const fetchMock = vi.fn();

async function loadPage(engineUrlEnv: string) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_ENGINE_URL", engineUrlEnv);
  const mod = await import("../page");
  return mod.default;
}

async function blurEmail(email = "person@customer.example") {
  const input = screen.getByLabelText(/email/i);
  fireEvent.change(input, { target: { value: email } });
  fireEvent.blur(input);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/login — SSO check URL construction", () => {
  for (const [label, env] of [
    ["with a trailing slash", "https://engine.example/"],
    ["without a trailing slash", "https://engine.example"],
  ] as const) {
    it(`base URL ${label} → exactly one slash before /api/sso/check-domain`, async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ hasSso: false, isEnforced: false, organizationId: null }),
      });
      const Page = await loadPage(env);
      render(<Page />);
      await blurEmail();
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const url = String(fetchMock.mock.calls[0]![0]);
      expect(url).toMatch(/^https:\/\/engine\.example\/api\/sso\/check-domain\?email=person%40customer\.example$/);
      expect(url).not.toContain("//api");
    });
  }

  it("the SSO login link is joined the same way", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ hasSso: true, isEnforced: false, organizationId: "org-1" }),
    });
    const Page = await loadPage("https://engine.example/");
    render(<Page />);
    await blurEmail();
    const link = await screen.findByRole("link", { name: /sign in with sso/i });
    expect(link.getAttribute("href")).toBe("https://engine.example/api/sso/org-1/login");
  });
});

describe("/login — a failed SSO check is handled, never thrown", () => {
  it("network/CORS failure: no exception escapes, the password form stays, no SSO offered", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: PromiseRejectionEvent) => unhandled.push(e.reason);
    window.addEventListener("unhandledrejection", onUnhandled);
    fetchMock.mockRejectedValue(new TypeError("Fetch API cannot load due to access control checks."));
    const Page = await loadPage("https://engine.example");
    render(<Page />);
    await blurEmail();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Let any rejection propagate before asserting.
    await new Promise((r) => setTimeout(r, 0));
    window.removeEventListener("unhandledrejection", onUnhandled);
    expect(unhandled).toEqual([]);
    expect(screen.getByLabelText(/^password$/i, { selector: "input" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign in with sso/i })).not.toBeInTheDocument();
  });

  it("a non-2xx answer is treated as 'no SSO known here'", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const Page = await loadPage("https://engine.example");
    render(<Page />);
    await blurEmail();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(/^password$/i, { selector: "input" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign in with sso/i })).not.toBeInTheDocument();
  });
});
