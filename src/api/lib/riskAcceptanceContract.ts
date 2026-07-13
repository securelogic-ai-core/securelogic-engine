/**
 * riskAcceptanceContract.ts — the ONE definition of a binding risk acceptance.
 *
 * A leaf module on purpose. `findingLifecycle` must know what "binding" means in order
 * to derive closure, and `riskAcceptance` must know it in order to run the lifecycle —
 * but riskAcceptance already imports findingLifecycle (to reopen findings), so putting
 * the predicate in either one creates an import cycle.
 *
 * The alternative — each defining its own copy — is exactly the failure the Metric
 * Contract exists to prevent: the same business word computed two ways, drifting apart
 * the first time someone changes one of them. One definition, imported by both.
 */

/** Acceptance states that occupy the "live acceptance" slot for a finding. */
export const ACCEPTANCE_LIVE_STATES = ["proposed", "approved", "legacy_unverified"] as const;

export type AcceptanceState =
  | "proposed"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "expired"
  | "legacy_unverified";

/**
 * SQL for "this acceptance is BINDING" — it currently holds its finding closed.
 * Expects the table aliased as `a`.
 *
 * Approved AND not past its review/expiry date.
 *
 * The date test lives in the PREDICATE, not only in the expiry worker, so a lapsed
 * acceptance stops closing its finding on the very next derivation even if the sweep has
 * not run. An acceptance that has run out is not an acceptance, and a customer's posture
 * must not depend on whether a cron job fired this morning.
 *
 * `legacy_unverified` is deliberately EXCLUDED. Those findings are held closed by the
 * legacy compat bridge (`status='accepted'` is terminal) exactly as they were before this
 * package; their acceptance row is a governance-review marker, not a closure input.
 * Treating them as binding would tie their closure to the feature flag — and flipping it
 * off would reopen a customer's historical closed population.
 */
export const SQL_ACCEPTANCE_BINDING = `
  a.state = 'approved'
  AND (a.expires_at IS NULL OR a.expires_at >= CURRENT_DATE)
`;
