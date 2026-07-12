/**
 * Global setup for app render tests.
 *
 * Mocks are deliberately narrow — only the framework and I/O boundaries a server
 * component cannot cross in a test process. Everything else (the page's own logic,
 * its links, its labels, its flag branches) runs for real, because that is the thing
 * under test.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

// next/link resolves through the App Router context, which does not exist outside a
// Next server. It is a link, and we assert on its href — an anchor is a faithful
// stand-in, and keeps `getByRole("link")` working as the customer's browser would.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children?: ReactNode } & Record<string, unknown>) =>
    createElement("a", { href, ...rest }, children),
}));

// redirect() throws a framework signal to unwind the render. Ours carries the
// destination so a test can assert an unentitled caller is sent away.
vi.mock("next/navigation", async () => {
  const { RedirectSignal } = await import("./harness");
  return {
    redirect: (to: string) => {
      throw new RedirectSignal(to);
    },
    notFound: () => {
      throw new RedirectSignal("__not_found__");
    },
    // Client components inside these pages (FindingCard et al.) call the router. They
    // are rendered so their LABELS and CONTROLS can be asserted; navigation itself is
    // the framework's job, not the contract under test.
    useRouter: () => ({
      push: vi.fn(),
      replace: vi.fn(),
      refresh: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
    }),
    usePathname: () => "/",
    useSearchParams: () => new URLSearchParams(),
  };
});

// getSession() reads cookies via next/headers — no request scope in a test process.
vi.mock("@/lib/session", async () => {
  const { sessionStore } = await import("./harness");
  return { getSession: async () => sessionStore.current };
});
