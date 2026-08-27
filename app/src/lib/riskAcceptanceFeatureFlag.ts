/**
 * riskAcceptanceFeatureFlag.ts — app half of the risk-acceptance activation
 * switch (NAV-1 / P1-C).
 *
 * The engine's SECURELOGIC_RISK_ACCEPTANCE_ENABLED 404s every
 * /api/risk-acceptances route independently (see
 * src/api/lib/riskAcceptanceFeatureFlag.ts); this reads the SAME key on the app
 * tier so the "Approvals" nav entry goes dark with it. Two switches, one key:
 * the nav can never advertise a destination whose engine routes are closed.
 *
 * Why the nav needs its own read at all: /approvals is entitlement-gated
 * (platform) but NOT flag-gated in its page body — it fetches both approval
 * families and degrades to an "unavailable" state when the engine 404s. That is
 * correct for someone who navigates there deliberately, and wrong for a header
 * menu, which would be advertising a page with nothing on it. Entitlement says
 * WHO may use Approvals; this says whether Approvals is exposed at all.
 *
 * Strict `=== "true"`, so unset / "" / "1" / "TRUE" / "yes" are all false —
 * identical to the engine resolver, so the two tiers cannot disagree. The value
 * is read at call time (a plain server-side env read, not NEXT_PUBLIC and not
 * baked into a client bundle), so a Render restart applies it without a
 * rebuild — the same posture as the layout's other nav flags.
 */
export function riskAcceptanceEnabled(
  // Deliberately a plain record rather than NodeJS.ProcessEnv: the app's
  // ProcessEnv requires NODE_ENV, which would force every caller — and every
  // test case — to supply an unrelated key just to ask this one question.
  env: Record<string, string | undefined> = process.env
): boolean {
  return env["SECURELOGIC_RISK_ACCEPTANCE_ENABLED"] === "true";
}
