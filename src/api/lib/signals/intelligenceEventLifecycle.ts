/**
 * intelligenceEventLifecycle.ts — the canonical Intelligence Event lifecycle
 * state machine. Intelligence Pipeline Hardening / IE (authoritative-model work).
 *
 * States (ordered progression):
 *   new              — first sighting, single source
 *   corroborating    — a second independent source is reporting it
 *   confirmed        — an authoritative source, or ≥3 sources, agree
 *   actively_exploited — exploitation evidence (KEV / CISA alert / malware)
 *   mitigated        — a patch / mitigation is available
 *   resolved         — mitigated and quiet for a while (aged)
 *   archived         — no activity for a long time (aged; never for an active threat)
 *
 * deriveLifecycleState() is a PURE function of accumulated evidence — the state
 * a fresh projection computes. ageLifecycleState() applies time-based resolution
 * / archival. Both are deterministic (no wall-clock read; ages are passed in).
 * resolved/archived are NEVER set by signal projection — only by the aging pass —
 * and a new signal re-activates an aged event (re-emergence).
 */

export const LIFECYCLE_STATES = [
  "new",
  "corroborating",
  "confirmed",
  "actively_exploited",
  "mitigated",
  "resolved",
  "archived"
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** Sources authoritative enough that a single one confirms an event. */
export const AUTHORITATIVE_SOURCES = new Set([
  "nvd",
  "cisa_kev",
  "cisa_alerts",
  "nist_news",
  "ftc_news",
  "onc_healthit",
  "sec_edgar",
  "federal_register",
  "mitre_attack",
  "mitre_atlas"
]);

/** Sources / signal shapes that indicate active exploitation. */
export const EXPLOIT_SOURCES = new Set(["cisa_kev", "cisa_alerts"]);

/** Days of quiet after which a mitigated event is considered resolved. */
export const RESOLVE_AFTER_DAYS = 30;
/** Days of quiet after which any non-active event is archived. */
export const ARCHIVE_AFTER_DAYS = 90;

export interface EvidenceState {
  /** Distinct contributing source count. */
  readonly sourceCount: number;
  /** At least one authoritative source has contributed. */
  readonly hasAuthoritative: boolean;
  /** Exploitation has ever been reported for this event. */
  readonly everExploited: boolean;
  /** A patch / mitigation has ever been reported for this event. */
  readonly everPatched: boolean;
}

/**
 * Derive the lifecycle state a projection should hold from accumulated evidence.
 * Ordered so later states dominate: exploitation and mitigation outrank mere
 * corroboration. exploited + patched → mitigated (a fix now exists for the active
 * threat — forward progress per the state ordering).
 */
export function deriveLifecycleState(e: EvidenceState): LifecycleState {
  if (e.everExploited && e.everPatched) return "mitigated";
  if (e.everExploited) return "actively_exploited";
  if (e.everPatched) return "mitigated";
  if (e.hasAuthoritative || e.sourceCount >= 3) return "confirmed";
  if (e.sourceCount >= 2) return "corroborating";
  return "new";
}

/**
 * Apply time-based resolution/archival to an event's current derived state.
 * An actively-exploited event is never auto-aged. Deterministic in the passed age.
 */
export function ageLifecycleState(state: LifecycleState, lastSeenAgeDays: number): LifecycleState {
  if (state === "actively_exploited") return state;
  if (lastSeenAgeDays >= ARCHIVE_AFTER_DAYS) return "archived";
  if (state === "mitigated" && lastSeenAgeDays >= RESOLVE_AFTER_DAYS) return "resolved";
  return state;
}

/** True when a source slug is authoritative. */
export function isAuthoritativeSource(source: string): boolean {
  return AUTHORITATIVE_SOURCES.has(source.toLowerCase().trim());
}

/** Human wording for a lifecycle state (executive framing). */
export function lifecycleFraming(state: LifecycleState): string {
  switch (state) {
    case "actively_exploited":
      return "Active exploitation has been reported.";
    case "mitigated":
      return "A patch or mitigation is available.";
    case "confirmed":
      return "Confirmed by authoritative sources.";
    case "corroborating":
      return "Multiple sources are corroborating this event.";
    case "resolved":
      return "This event is resolved.";
    case "archived":
      return "This event has been archived.";
    default:
      return "";
  }
}
