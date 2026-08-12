/**
 * askToolsFeatureFlag.ts — the switchover flag for Ask's retrieval path.
 *
 * Ask has TWO retrieval implementations during the transition:
 *
 *   OFF (default)  the A0-corrected snapshot — eight fixed queries assembled
 *                  into one JSON blob. Known-good, defect-fixed, shipping today.
 *   ON             the platform tool registry — the model calls canonical routes
 *                  in the caller's security context.
 *
 * Defaults OFF, unlike SECURELOGIC_ASK_ENABLED which defaults ON. The reasoning
 * is opposite in each case and deliberate:
 *
 *   - ASK_ENABLED is a KILL SWITCH for a capability already live in production,
 *     so defaulting it off would silently remove shipped behaviour.
 *   - ASK_TOOLS_ENABLED is a DARK LAUNCH of a new retrieval path. It changes how
 *     every answer is produced, and no staging environment has exercised it yet.
 *     Defaulting it on would flip a customer-facing surface on deploy.
 *
 * Rollback is the flag: turning it off restores the snapshot path with no
 * migration, no deploy, and no data change. The two paths share the same route,
 * the same authorization, and the same audit event — only retrieval differs.
 *
 * Retire this flag (and the snapshot path with it) once staging has validated
 * the tool path. Two retrieval implementations is exactly the parallel-data-path
 * problem this programme exists to remove — it is acceptable only as a
 * transition, never as a steady state.
 */

export function askToolsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_ASK_TOOLS_ENABLED"] === "true";
}
