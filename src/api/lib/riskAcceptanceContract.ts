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

/**
 * What kind of governance decision a finding_risk_acceptances row records.
 *
 * They share a table because the WORKFLOW is identical — request, justify,
 * approve under separation of duties, expire, audit — but the customer-visible
 * MEANING is opposite, and only one of them ends the remediation obligation.
 */
export const DECISION_KINDS = ["acceptance", "exception"] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

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
 * Approved, of kind 'acceptance', AND not past its review/expiry date.
 *
 * The `kind` clause is the correction at the heart of SL-EXC-1. An EXCEPTION
 * authorises a temporary deviation — the work is still outstanding — so it must
 * never close a finding. Putting the discriminator HERE rather than at each call
 * site means every consumer of "binding" (the closure policy, the closure
 * service, the derivation, the reopen path) inherits the correction from one
 * line, which is the whole reason this module exists as a leaf.
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
  a.kind = 'acceptance'
  AND a.state = 'approved'
  AND (a.expires_at IS NULL OR a.expires_at >= CURRENT_DATE)
`;

/**
 * SQL for "this EXCEPTION is currently in force" — an approved, unexpired
 * authorisation to run late. Expects the table aliased as `a`.
 *
 * Structurally the mirror of the predicate above, and it is deliberately NOT
 * an input to closure anywhere. An exception in force means the opposite of a
 * binding acceptance: the remediation is still required, still outstanding,
 * and merely authorised to be late. Nothing in the lifecycle machine consumes
 * this, and nothing should — it exists so that reporting and the UI can say
 * "overdue, exception approved" instead of having to choose between "overdue"
 * and "closed", which were the only two things the platform could previously
 * express.
 */
export const SQL_EXCEPTION_IN_FORCE = `
  a.kind = 'exception'
  AND a.state = 'approved'
  AND (a.expires_at IS NULL OR a.expires_at >= CURRENT_DATE)
`;
