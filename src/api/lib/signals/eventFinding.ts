/**
 * eventFinding.ts — pure event→finding reconciliation. Intelligence Pipeline
 * Hardening / IE.P6 (memo IE-AD-7).
 *
 * Goal item 7: "Only create findings when an Intelligence Event results in
 * actionable organizational risk. Updates to existing events should update
 * existing findings whenever appropriate rather than creating duplicates."
 *
 * This module decides the finding fields + whether a create/update/no-op is
 * warranted. It does NO I/O — relevance ("actionable org risk") and the DB
 * upsert live in eventFindingStore.ts. The legacy per-signal matcher path is
 * untouched; event-sourced findings are a parallel, dedup-by-update channel
 * (source_type='intelligence_event', one per (org, event)).
 */

import { severityToPriority } from "../postureComputation.js";
import { trimToSentence } from "./contentQuality.js";
import type { EventStatus } from "./intelligenceEventProjection.js";

/** Max length of a finding title. */
const FINDING_TITLE_MAX = 200;

/** The canonical-event fields a finding is derived from. */
export interface EventForFinding {
  readonly event_id: string;
  readonly title: string;
  readonly executive_summary: string;
  readonly severity: string;
  readonly status: EventStatus;
  readonly event_type: string;
  readonly affected_vendor: string | null;
  readonly affected_cve: string | null;
}

/** The current event-sourced finding for this (org, event), if any. */
export interface ExistingFinding {
  readonly id: string;
  readonly severity: string;
  readonly title: string;
  readonly description: string;
  /** finding lifecycle status (open/resolved/…) — preserved across updates. */
  readonly status: string;
}

export interface FindingUpsertPlan {
  readonly action: "create" | "update" | "noop";
  readonly title: string;
  readonly description: string;
  readonly severity: string;
  readonly domain: string;
  readonly priority: "immediate" | "near_term" | "planned" | "watch";
}

/** Map an event to a finding domain (free-text, mirrors the matcher's routing). */
export function eventFindingDomain(event: EventForFinding): string {
  if (event.affected_vendor) return "Vendor Risk";
  switch (event.event_type) {
    case "cve":
    case "patch":
    case "advisory":
      return "Vulnerability";
    case "threat_actor":
    case "malware":
    case "breach":
      return "Threat Intelligence";
    case "geopolitical":
      return "Strategic";
    default:
      return "Vulnerability";
  }
}

/** Build the finding title from the event (CVE-prefixed when present). */
export function eventFindingTitle(event: EventForFinding): string {
  const base = event.affected_cve ? `${event.affected_cve}: ${event.title}` : event.title;
  return trimToSentence(base, FINDING_TITLE_MAX);
}

/**
 * Plan the finding for an event. `existing` is the current event-sourced finding
 * (null when none). Create on first relevance; update when severity, title, or
 * description changed (preserving the finding's lifecycle status); no-op when
 * nothing material changed. Relevance is the caller's decision (store).
 */
export function planFindingUpsert(
  event: EventForFinding,
  existing: ExistingFinding | null
): FindingUpsertPlan {
  const title = eventFindingTitle(event);
  const description = event.executive_summary;
  const domain = eventFindingDomain(event);
  const priority = severityToPriority(event.severity);

  if (existing === null) {
    return { action: "create", title, description, severity: event.severity, domain, priority };
  }

  const changed =
    existing.severity !== event.severity ||
    existing.title !== title ||
    existing.description !== description;

  return {
    action: changed ? "update" : "noop",
    title,
    description,
    severity: event.severity,
    domain,
    priority
  };
}
