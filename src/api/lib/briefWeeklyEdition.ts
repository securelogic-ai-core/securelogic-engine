/**
 * briefWeeklyEdition.ts — the ONE spelling of "does this org have the current
 * weekly Intelligence Brief edition?"
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Three subsystems ask that question and MUST agree, or the platform
 * contradicts itself:
 *   - briefScheduler   — decides which orgs to SKIP on a rerun (idempotency);
 *   - briefCatchup     — decides whether to RECONCILE a missed/interrupted run;
 *   - briefStalenessMonitor — decides whether to ALERT an operator.
 * If they spelled the predicate differently, the platform could alert on an
 * org catch-up considers done, or silently skip one the monitor calls missing.
 *
 * It is deliberately NOT in briefEligibility.ts: that module answers a
 * different question ("is this org entitled to generation?"), and carries an
 * enforced invariant that its SQL touches no table but `organizations`
 * (ADR-0007 — eligibility must never be gated by another table's contents).
 * Edition-completeness reads intelligence_briefs, so it lives here instead.
 *
 * Completeness is GENERATION-based (published briefs), never send-based:
 * generation is an organizational entitlement decoupled from email recipients
 * (ADR-0007). A zero-recipient week legitimately records no sends.
 *
 * The window boundary itself is currentBriefWeekStart (briefSendWindow.ts).
 */

/**
 * "This org is MISSING the weekly edition whose window starts at `param`" as a
 * SQL fragment. `alias` is the organizations alias in the outer query; `param`
 * is the placeholder holding the window start (currentBriefWeekStart — the
 * most recent Tuesday 07:00 UTC).
 *
 * Callers pair this with `${alias}.created_at < ${param}` so an org created
 * mid-window is not counted missing — its first edition is the next Tuesday
 * run, not this one.
 */
export function sqlMissingCurrentBrief(alias: string, param: string): string {
  return (
    `NOT EXISTS (
       SELECT 1
       FROM intelligence_briefs b
       WHERE b.organization_id = ${alias}.id
         AND b.status = 'published'
         AND b.generated_at >= ${param}
     )`
  );
}
