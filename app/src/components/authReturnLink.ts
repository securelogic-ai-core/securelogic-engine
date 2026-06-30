/**
 * Pure decision logic for the auth-page "Return to Dashboard" escape hatch.
 *
 * Kept free of React / next so it is unit-testable in isolation (mirrors the
 * extract-and-test pattern used by signupValidation / onboardingProgress).
 */

/** Minimal slice of SessionData needed to decide the return link. */
export interface ReturnLinkSession {
  jwtToken?: string;
  apiKey?: string;
}

export const RETURN_LINK_HREF = "/dashboard";
export const RETURN_LINK_LABEL = "← Return to Dashboard";

export interface ReturnLink {
  href: string;
  label: string;
}

/**
 * Returns the return-link descriptor for an authenticated session, or `null`
 * (render nothing) otherwise — so the link is never exposed to unauthenticated
 * visitors.
 *
 * The authenticated predicate mirrors exactly what /signup's server redirect
 * uses (`session.jwtToken ?? session.apiKey`): a session is authenticated when
 * it carries either the customer JWT or the legacy API key. Mirroring it keeps
 * "is this visitor logged in?" consistent across the auth surface rather than
 * inventing a second, divergent definition.
 */
export function resolveReturnLink(session: ReturnLinkSession): ReturnLink | null {
  const authenticated = Boolean(session.jwtToken ?? session.apiKey);
  if (!authenticated) return null;
  return { href: RETURN_LINK_HREF, label: RETURN_LINK_LABEL };
}
