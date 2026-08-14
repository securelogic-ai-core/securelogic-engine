/**
 * askActionsFeatureFlag.ts — the dark-launch flag for Ask's bounded agentic
 * mutations (Stop Gate ASK-B, Launch Completion 5).
 *
 * Default OFF; only the literal "true" enables — this is NEW customer-facing
 * behavior (the assistant proposing mutations) that no environment has
 * exercised, so it follows the realtime-voice convention, not the kill-switch
 * convention: absence must mean "does not exist yet".
 *
 * What the flag gates, in both places it matters:
 *   - whether `mutate`-class tools are offered to the model at all
 *     (runAskToolTurn passes ["read"] when off — a mutate tool in the registry
 *     cannot silently become reachable), and
 *   - the confirm/decline routes (404 when off, the same body a nonexistent
 *     route would produce).
 *
 * Turning the flag off strands pending proposals unexecutable — which is the
 * correct failure mode: a killed capability must not honor tokens it issued
 * while alive.
 */

export function askActionsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_ASK_ACTIONS_ENABLED"] === "true";
}
