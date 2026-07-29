import { webhookWave1Enabled } from "./webhookWave1FeatureFlag.js";
import type { MatcherResult } from "./cyberSignalProcessingService.js";
import type { WebhookEvent } from "./webhookDispatcher.js";

/**
 * The dispatcher is imported LAZILY at emit time, not at module load: its
 * module chain reaches infra/postgres.js, which throws without DATABASE_URL —
 * and one of this emitter's hosts (applicabilityWorkflowDispatcher) is
 * deliberately DB-agnostic (Queryable-parameterized, importable with no DB
 * env). A static import here would smuggle that dependency back in. Emission
 * is fire-and-forget, so the async boundary costs nothing.
 */
let dispatcherModule: Promise<{
  dispatchWebhookEvent: (event: WebhookEvent) => Promise<void>;
}> | null = null;

function dispatch(event: WebhookEvent): void {
  dispatcherModule ??= import("./webhookDispatcher.js");
  void dispatcherModule.then((m) => m.dispatchWebhookEvent(event)).catch(() => {});
}

/**
 * signalWebhookEmitter.ts — wave-1 (DS-15) outbound events for the matcher
 * seam: batched `signal.matched` + per-suggestion `suggestion.created`.
 *
 * Tenancy rule (the one that must never break): events are emitted ONLY from
 * a per-(signal, org) MatcherResult, with the org id supplied by the fan-out
 * loop — never from global-signal internals. Payloads carry canonical IDs
 * only (signal/suggestion/finding ids); never raw_payload, dedup hashes, or
 * source internals.
 *
 * Batching (DS-15 constraint): one `signal.matched` event per org per run,
 * carrying the run's matches as an array. The three matcher invocation paths
 * use the same batcher:
 *   - worker fan-outs (runPipeline, kevPoller): add() inside the (signal, org)
 *     loop, flush() after the loop — the same post-commit seam as the
 *     critical-alert email batcher (runMatcherForSignal commits before
 *     returning).
 *   - route path (processSignal): a batch of one, flushed after COMMIT.
 *
 * Every call is a no-op while SECURELOGIC_WEBHOOK_WAVE1_ENABLED is off, and
 * dispatch is fire-and-forget — emission failures never affect the matcher.
 */

interface SignalMatch {
  signal_id: string;
  matched_branch: MatcherResult["matched_branch"];
  domain: string;
  match_score: number | null;
  finding_id: string | null;
  suggestion_id: string | null;
  obligation_suggestion_ids: string[];
}

/** True when the result produced anything an integrator could act on. */
function isMatch(result: MatcherResult): boolean {
  return (
    result.matched_branch !== "no_match" ||
    result.suggestion_id !== null ||
    result.finding !== null ||
    result.obligation_suggestion_ids.length > 0
  );
}

export interface SignalWebhookBatcher {
  /** Record one (signal, org) matcher outcome. No-op for no-match results. */
  add(orgId: string, signalId: string, result: MatcherResult): void;
  /** Emit one signal.matched per org plus suggestion.created per new suggestion. */
  flush(): void;
}

export function createSignalWebhookBatcher(source: string): SignalWebhookBatcher {
  const perOrg = new Map<string, SignalMatch[]>();

  return {
    add(orgId: string, signalId: string, result: MatcherResult): void {
      if (!webhookWave1Enabled() || !isMatch(result)) return;
      const matches = perOrg.get(orgId) ?? [];
      matches.push({
        signal_id: signalId,
        matched_branch: result.matched_branch,
        domain: result.domain,
        match_score: result.match_score,
        finding_id: result.finding !== null ? (result.finding.id as string) : null,
        suggestion_id: result.suggestion_id,
        obligation_suggestion_ids: result.obligation_suggestion_ids,
      });
      perOrg.set(orgId, matches);
    },

    flush(): void {
      if (!webhookWave1Enabled()) return;
      for (const [orgId, matches] of perOrg) {
        dispatch({
          event_type: "signal.matched",
          organization_id: orgId,
          data: { source, count: matches.length, matches },
        });

        for (const m of matches) {
          const suggestionIds = [
            ...(m.suggestion_id ? [m.suggestion_id] : []),
            ...m.obligation_suggestion_ids,
          ];
          for (const suggestionId of suggestionIds) {
            emitSuggestionCreated(orgId, {
              suggestion_id: suggestionId,
              signal_id: m.signal_id,
              match_score: m.match_score,
              domain: m.domain,
              source,
            });
          }
        }
      }
      perOrg.clear();
    },
  };
}

/**
 * Standalone suggestion.created emitter for suggestion writers outside the
 * matcher (the applicability workflow dispatcher). Fire-and-forget; no-op
 * while wave 1 is dark.
 */
export function emitSuggestionCreated(
  orgId: string,
  data: {
    suggestion_id: string;
    signal_id: string;
    match_score: number | null;
    domain: string | null;
    source: string;
  }
): void {
  if (!webhookWave1Enabled()) return;
  dispatch({
    event_type: "suggestion.created",
    organization_id: orgId,
    data,
  });
}
