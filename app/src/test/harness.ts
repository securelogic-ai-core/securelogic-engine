/**
 * Render-test harness — the shared boundary stubs and fixtures.
 *
 * The pages under test are async Server Components. They are not mounted by a client
 * entrypoint; they are *called*, and they return a tree. So the harness renders
 * `await Page(props)` — which is exactly what Next does on the server, and which means
 * the page's real logic (its flag branches, its hrefs, its labels) is what runs.
 */
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

// ── Session boundary ────────────────────────────────────────────────
// getSession() reads cookies via next/headers, which has no request scope in a test
// process. Tests set the caller here; setup.ts wires it into the mocked module.

export type TestSession = {
  jwtToken?: string;
  apiKey?: string;
  userId?: string;
  userRole?: string;
  organizationId?: string;
  entitlementLevel?: string;
};

export const sessionStore: { current: TestSession } = { current: {} };

/** The ordinary authorized caller: a platform-entitled user with a session token. */
export function signedIn(overrides: Partial<TestSession> = {}): void {
  sessionStore.current = {
    jwtToken: "test-jwt",
    userId: "user-1",
    userRole: "member",
    organizationId: "org-1",
    entitlementLevel: "platform",
    ...overrides,
  };
}

/**
 * Signed out is an EMPTY session, not a null one — iron-session always returns an
 * object, and the pages read `session.jwtToken` off it unguarded. A null here would
 * have tested a state that cannot occur in production.
 */
export function signedOut(): void {
  sessionStore.current = {};
}

/** An API-key caller: no user identity, so nothing user-scoped (My Work) may resolve. */
export function apiKeyOnly(): void {
  sessionStore.current = { apiKey: "test-key", organizationId: "org-1" };
}

// ── Navigation boundary ─────────────────────────────────────────────
// Next's redirect() throws a framework-internal signal to unwind rendering. We throw
// our own so a test can assert WHERE a page sent the caller — a redirect is a
// customer-visible outcome (an unentitled user must not see the page), not a detail.

export class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`redirect:${to}`);
    this.name = "RedirectSignal";
  }
}

/** Render an async Server Component the way the server does: call it, render the tree. */
export async function renderPage<P>(
  Page: (props: P) => Promise<ReactElement>,
  props: P
): Promise<RenderResult> {
  return render(await Page(props));
}

/**
 * Assert that rendering redirects, and return the destination. Fails loudly if the page
 * rendered instead — "it didn't redirect" must never pass silently as "no error".
 */
export async function expectRedirect<P>(
  Page: (props: P) => Promise<ReactElement>,
  props: P
): Promise<string> {
  try {
    await Page(props);
  } catch (err) {
    if (err instanceof RedirectSignal) return err.to;
    throw err;
  }
  throw new Error("Expected the page to redirect, but it rendered.");
}

/** Next 15 passes searchParams/params as promises. */
export const sp = (params: Record<string, string | undefined> = {}) => Promise.resolve(params);

// ── Client search params ────────────────────────────────────────────
// Client components read the URL via useSearchParams(). setup.ts wires the mocked
// hook to this store; tests that assert a ?param-driven branch set it and MUST
// reset it (beforeEach does via resetClientSearchParams).

export const clientSearchParams: { current: URLSearchParams } = {
  current: new URLSearchParams(),
};

/** The path the client usePathname() hook sees. Defaults to "/" (see setup.ts). */
export const clientPathname: { current: string } = { current: "/" };

/** Set the URL the client hooks see, e.g. setClientSearchParams("from=ready_to_close"). */
export function setClientSearchParams(qs: string): void {
  clientSearchParams.current = new URLSearchParams(qs);
}

export function resetClientSearchParams(): void {
  clientSearchParams.current = new URLSearchParams();
}

/** Set the path the client usePathname() hook sees, e.g. setClientPathname("/findings"). */
export function setClientPathname(path: string): void {
  clientPathname.current = path;
}

export function resetClientPathname(): void {
  clientPathname.current = "/";
}

// ── Link assertions ─────────────────────────────────────────────────

/** Every href on the page, in document order. */
export function hrefs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("a[href]")).map(
    (a) => a.getAttribute("href") as string
  );
}

/** The href of the link whose visible text matches — how a customer finds a link. */
export function hrefOf(container: HTMLElement, text: string | RegExp): string | null {
  const match = Array.from(container.querySelectorAll("a[href]")).find((a) =>
    typeof text === "string"
      ? (a.textContent ?? "").includes(text)
      : text.test(a.textContent ?? "")
  );
  return match?.getAttribute("href") ?? null;
}
