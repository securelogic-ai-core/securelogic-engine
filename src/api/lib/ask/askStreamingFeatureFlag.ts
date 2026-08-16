/**
 * askStreamingFeatureFlag.ts — dark-launch flag for Ask's SSE answer stream.
 *
 * OFF (default)  POST /api/ask/stream answers 404 exactly like a route that
 *                does not exist; the app is told at render time (its own
 *                env var, two-switch model) and never attempts the stream.
 * ON             the tool path's answers stream over SSE: tool-call progress
 *                events, text deltas, then a `final` event whose payload is
 *                byte-shape-identical to the non-streaming JSON response.
 *
 * Defaults OFF for the same reason as SECURELOGIC_ASK_TOOLS_ENABLED: this is
 * a dark launch of a new response path on a customer-facing surface, not a
 * kill switch for shipped behaviour. Rollback is the flag — no migration, no
 * data change; the non-streaming route is untouched and remains the fallback.
 *
 * Streaming exists ONLY on the tool path. The snapshot path is a retiring
 * transition (see askToolsFeatureFlag.ts) and gets no new investment.
 */

export function askStreamingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_ASK_STREAMING_ENABLED"] === "true";
}
