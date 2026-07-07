/**
 * intelligenceEventProjection.ts — pure projection of a cyber_signal into a
 * canonical Intelligence Event. Intelligence Pipeline Hardening / IE.P3.
 *
 * Given the current event state (or null for a first sighting) and one incoming
 * signal, produce a deterministic UPSERT PLAN: the desired event fields, the
 * source-corroboration ledger op, and the append-only timeline entries. The
 * store (IE.P4) applies the plan; this module does NO I/O.
 *
 * Design (memo IE-AD-2/3/4/5):
 *   - identity = eventCanonicalKey() (total; CVE-primary → fingerprint → singleton)
 *   - severity = peak across all contributors
 *   - status   = precedence(new < evolving < patched < exploited), corroboration
 *                promotes new → evolving
 *   - confidence rises with distinct corroborating sources
 *   - executive summary + summary_status come from contentQuality (never a broken
 *     sentence; raw feed text is never the primary field)
 *   - timeline: first_seen / corroborated / exploit_activity / patch_available /
 *     severity_change, each stamped with the signal's own ingestion_timestamp
 *     (no wall-clock read → deterministic)
 */

import { eventCanonicalKey, peakSeverity, severityRank, type EventIdentityInput } from "./intelligenceEventIdentity.js";
import { assessContent, trimToSentence, type ContentStatus } from "./contentQuality.js";
import { buildEventSummary } from "./eventExecutiveSummary.js";
import {
  deriveLifecycleState,
  isAuthoritativeSource,
  EXPLOIT_SOURCES,
  type LifecycleState
} from "./intelligenceEventLifecycle.js";

/** Max length of the generated event title. */
const TITLE_MAX = 160;

/** The event lifecycle state (re-exported from the lifecycle state machine). */
export type EventStatus = LifecycleState;

export type TimelineEntryType =
  | "first_seen"
  | "corroborated"
  | "exploit_activity"
  | "patch_available"
  | "severity_change"
  | "status_change";

export interface IncomingSignal extends EventIdentityInput {
  readonly cyber_signal_id: string;
  readonly source: string;
  readonly external_id: string | null;
  readonly severity: string;
  /** cyber_signals.normalized_summary — raw feed-derived text (quality-gated here). */
  readonly summary: string;
}

/** The current persisted event + the corroboration facts the plan needs. */
export interface ExistingEventState {
  readonly id: string;
  readonly status: EventStatus;
  readonly severity: string;
  readonly source_count: number;
  readonly revision: number;
  /** Exploitation has ever been reported for this event (accumulated flag). */
  readonly ever_exploited: boolean;
  /** A patch/mitigation has ever been reported for this event (accumulated flag). */
  readonly ever_patched: boolean;
  /** cyber_signal_ids already recorded as contributors (idempotency). */
  readonly contributingSignalIds: ReadonlySet<string>;
  /** distinct source slugs already contributing (drives confidence/source_count). */
  readonly distinctSources: ReadonlySet<string>;
}

export interface PlannedEventFields {
  readonly title: string;
  readonly event_type: string;
  readonly severity: string;
  readonly status: EventStatus;
  readonly executive_summary: string;
  readonly summary_status: ContentStatus;
  readonly affected_cve: string | null;
  readonly affected_vendor: string | null;
  readonly source_count: number;
  readonly confidence: number;
  /** Accumulated evidence flags, persisted so the lifecycle is reproducible. */
  readonly ever_exploited: boolean;
  readonly ever_patched: boolean;
}

export interface PlannedSourceOp {
  readonly cyber_signal_id: string;
  readonly source: string;
  readonly external_id: string | null;
  readonly relation: "canonical" | "corroborating";
  readonly contributed_at: string | Date;
}

export interface PlannedTimelineEntry {
  readonly entry_type: TimelineEntryType;
  readonly occurred_at: string | Date;
  readonly summary: string;
  readonly source: string;
  readonly cyber_signal_id: string;
}

export interface EventUpsertPlan {
  readonly canonical_key: string;
  readonly isNew: boolean;
  /** True when this signal materially changed the event (drives revision + updated_at). */
  readonly changed: boolean;
  readonly event: PlannedEventFields;
  /** The source-ledger insert, or null when this signal already contributed. */
  readonly source: PlannedSourceOp | null;
  readonly timeline: PlannedTimelineEntry[];
}

/** Is this signal evidence of active exploitation? */
function isExploitSignal(s: IncomingSignal): boolean {
  return EXPLOIT_SOURCES.has(s.source.toLowerCase().trim()) || s.signal_type === "malware";
}

/** Is this signal evidence of a patch / mitigation? */
function isPatchSignal(s: IncomingSignal): boolean {
  return s.signal_type === "patch";
}

/** Deterministic corroboration confidence (0–99) from distinct source count. */
function confidenceFor(distinctSources: number, singleton: boolean): number {
  if (singleton && distinctSources <= 1) return 40; // degenerate, uncorroborated
  const c = 50 + 15 * Math.max(0, distinctSources - 1);
  return Math.min(95, c);
}

/** Build a display-safe title from a signal (never a broken sentence). */
function buildTitle(s: IncomingSignal): string {
  const q = assessContent(s.summary);
  if (q.status !== "degraded" && q.displayText !== "") {
    return trimToSentence(q.displayText, TITLE_MAX);
  }
  // Degenerate summary → construct from structured fields.
  const parts: string[] = [s.signal_type.replace(/_/g, " ").toUpperCase()];
  if (s.affected_cve) parts.push(s.affected_cve);
  if (s.affected_vendor) parts.push(`affecting ${s.affected_vendor}`);
  return parts.join(" — ");
}

/**
 * Plan the projection of `signal` into the event identified by its canonical key.
 * `existing` is the current event state (null on first sighting).
 */
export function planEventUpsert(
  signal: IncomingSignal,
  existing: ExistingEventState | null
): EventUpsertPlan {
  const canonical_key = eventCanonicalKey(signal);
  const isNew = existing === null;
  const singleton = canonical_key.startsWith("sig:");

  // Idempotency: a signal that already contributed produces a no-op plan (no
  // source insert, no timeline, no revision bump).
  const alreadyContributed = existing?.contributingSignalIds.has(signal.cyber_signal_id) ?? false;

  const newSourceSlug = signal.source.toLowerCase().trim();
  const isNewDistinctSource = !(existing?.distinctSources.has(newSourceSlug) ?? false);

  // Distinct source count after applying this signal.
  const distinctAfter = isNew
    ? 1
    : existing!.distinctSources.size + (isNewDistinctSource && !alreadyContributed ? 1 : 0);
  const source_count = distinctAfter;

  // Severity = peak.
  const severity = isNew ? signal.severity : peakSeverity(existing!.severity, signal.severity);
  const severityRose = !isNew && severityRank(signal.severity) < severityRank(existing!.severity);

  // Accumulated evidence flags drive the lifecycle state.
  const everExploited = (existing?.ever_exploited ?? false) || isExploitSignal(signal);
  const everPatched = (existing?.ever_patched ?? false) || isPatchSignal(signal);
  const hasAuthoritative =
    (existing ? [...existing.distinctSources].some(isAuthoritativeSource) : false) ||
    isAuthoritativeSource(signal.source);

  // Lifecycle state derived from the accumulated evidence (deterministic).
  const status: EventStatus = deriveLifecycleState({
    sourceCount: distinctAfter,
    hasAuthoritative,
    everExploited,
    everPatched
  });
  const statusChanged = !isNew && status !== existing!.status;
  const newlyExploited = everExploited && !(existing?.ever_exploited ?? false);
  const newlyPatched = everPatched && !(existing?.ever_patched ?? false);

  const title = buildTitle(signal);
  const confidence = confidenceFor(distinctAfter, singleton);

  // Normalized, citation-preserving executive summary (IE-AD-6): never raw feed
  // text as the primary field. Sources = the distinct set after this signal.
  const summarySources = isNew
    ? [signal.source]
    : [...existing!.distinctSources, signal.source];
  const built = buildEventSummary({
    title,
    rawSummary: signal.summary,
    severity,
    status,
    affected_vendor: signal.affected_vendor,
    affected_cve: signal.affected_cve,
    sources: summarySources
  });

  const event: PlannedEventFields = {
    title,
    event_type: signal.signal_type,
    severity,
    status,
    // The primary customer field is always a normalized, display-safe summary.
    executive_summary: built.summary,
    summary_status: built.summary_status,
    affected_cve: signal.affected_cve,
    affected_vendor: signal.affected_vendor,
    source_count,
    confidence,
    ever_exploited: everExploited,
    ever_patched: everPatched
  };

  // No material change for an already-known signal.
  if (alreadyContributed) {
    return { canonical_key, isNew: false, changed: false, event, source: null, timeline: [] };
  }

  const source: PlannedSourceOp = {
    cyber_signal_id: signal.cyber_signal_id,
    source: signal.source,
    external_id: signal.external_id,
    relation: isNew ? "canonical" : "corroborating",
    contributed_at: signal.ingestion_timestamp
  };

  const timeline: PlannedTimelineEntry[] = [];
  const stamp = (entry_type: TimelineEntryType, summary: string): void => {
    timeline.push({
      entry_type,
      occurred_at: signal.ingestion_timestamp,
      summary,
      source: signal.source,
      cyber_signal_id: signal.cyber_signal_id
    });
  };

  if (isNew) {
    stamp("first_seen", title);
    if (newlyExploited) stamp("exploit_activity", `Active exploitation reported by ${signal.source}.`);
    if (newlyPatched) stamp("patch_available", `Patch/mitigation reported by ${signal.source}.`);
  } else {
    stamp("corroborated", `Corroborated by ${signal.source}.`);
    if (newlyExploited) stamp("exploit_activity", `Active exploitation reported by ${signal.source}.`);
    if (newlyPatched) stamp("patch_available", `Patch/mitigation reported by ${signal.source}.`);
    if (severityRose) stamp("severity_change", `Severity raised to ${severity} (source: ${signal.source}).`);
    if (statusChanged) stamp("status_change", `Status changed to ${status}.`);
  }

  return { canonical_key, isNew, changed: true, event, source, timeline };
}
