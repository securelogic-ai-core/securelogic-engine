/**
 * intelligenceDetailView.ts — pure view logic for the Intelligence Event
 * drill-through (ERIP Package 3.3, PR-2). Kept dependency-free (no React, no
 * fetch) so it is unit-testable without a DOM/RTL harness the app does not have.
 *
 * The drill-through page renders one canonical Intelligence Event. Two data
 * sources feed it, in priority order:
 *   1. the canonical event from GET /api/intelligence/events/:id (PR-1 fetcher),
 *      available only when the engine's SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED
 *      is on — the richest source (executive summary, recommended actions,
 *      related findings, affected assets);
 *   2. a leaner fallback extracted from the finding-context payload
 *      (SECURELOGIC_DECISION_WORKSPACE_ENABLED), used when the events surface is
 *      dark but the user arrived from a Finding (?finding=<id>).
 *
 * When neither is available the resolver returns null and the page shows an
 * honest "intelligence detail unavailable in this environment" state — it never
 * fabricates content and never blocks. Intelligence Events remain drill-through
 * only; nothing here adds navigation.
 */

import type { IntelligenceEventDetail } from "@/lib/api";

/** Provenance of the rendered detail — surfaced so the UI can be honest. */
export type IntelligenceDetailOrigin = "canonical" | "finding_context";

export type IntelligenceDetailSource = {
  source: string;
  external_id: string | null;
  relation: string;
  last_contributed_at: string | null;
};

export type IntelligenceDetailTimelineEntry = {
  entry_type: string;
  occurred_at: string;
  summary: string;
  source: string | null;
};

export type IntelligenceDetailViewModel = {
  origin: IntelligenceDetailOrigin;
  event: {
    id: string;
    title: string;
    canonical_key: string | null;
    event_type: string | null;
    severity: string | null;
    status: string | null;
    affected_cve: string | null;
    affected_vendor: string | null;
    /** Present only from the canonical source; null on the finding-context fallback. */
    executive_summary: string | null;
    source_count: number | null;
    confidence: number | null;
    first_seen_at: string | null;
    last_seen_at: string | null;
  };
  sources: IntelligenceDetailSource[];
  timeline: IntelligenceDetailTimelineEntry[];
  /** Canonical-only enrichment; empty on the finding-context fallback. */
  recommended_actions: Array<{ action: string; urgency: string }>;
  related_findings: Array<{ id: string; title: string; severity: string; status: string }>;
};

/** The slice of a finding-context payload this resolver consumes as a fallback. */
export type FindingContextEventBundle = {
  event: Record<string, unknown>;
  sources: Array<Record<string, unknown>>;
  timeline: Array<Record<string, unknown>>;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Extract the bundle for one event id from a finding-context `intelligence`
 * block. The finding-context sources/timeline are flat arrays carrying
 * `event_id`, so we filter them to the requested event. Returns null when the
 * finding's context does not reference this event.
 */
export function extractFindingContextEvent(
  intelligence: {
    events: Array<Record<string, unknown>>;
    sources: Array<Record<string, unknown>>;
    timeline: Array<Record<string, unknown>>;
  },
  eventId: string,
): FindingContextEventBundle | null {
  const event = intelligence.events.find((e) => str(e["id"]) === eventId);
  if (!event) return null;
  return {
    event,
    sources: intelligence.sources.filter((s) => str(s["event_id"]) === eventId),
    timeline: intelligence.timeline.filter((t) => str(t["event_id"]) === eventId),
  };
}

function fromCanonical(detail: IntelligenceEventDetail): IntelligenceDetailViewModel {
  return {
    origin: "canonical",
    event: {
      id: detail.event.id,
      title: detail.event.title,
      canonical_key: str(detail.event.canonical_key),
      event_type: str(detail.event.event_type),
      severity: str(detail.event.severity),
      status: str(detail.event.status),
      affected_cve: detail.event.affected_cve ?? null,
      affected_vendor: detail.event.affected_vendor ?? null,
      executive_summary: str(detail.event.executive_summary),
      source_count: num(detail.event.source_count),
      confidence: num(detail.event.confidence),
      first_seen_at: str(detail.event.first_seen_at),
      last_seen_at: str(detail.event.last_seen_at),
    },
    sources: detail.sources.map((s) => ({
      source: s.source,
      external_id: s.external_id,
      relation: s.relation,
      last_contributed_at: str(s.last_contributed_at),
    })),
    timeline: detail.timeline.map((t) => ({
      entry_type: t.entry_type,
      occurred_at: t.occurred_at,
      summary: t.summary,
      source: t.source,
    })),
    recommended_actions: detail.recommended_actions.map((a) => ({ action: a.action, urgency: a.urgency })),
    related_findings: detail.related_findings.map((f) => ({ id: f.id, title: f.title, severity: f.severity, status: f.status })),
  };
}

function fromFindingContext(bundle: FindingContextEventBundle): IntelligenceDetailViewModel | null {
  const id = str(bundle.event["id"]);
  const title = str(bundle.event["title"]);
  if (!id || !title) return null; // not enough to render honestly
  return {
    origin: "finding_context",
    event: {
      id,
      title,
      canonical_key: str(bundle.event["canonical_key"]),
      event_type: str(bundle.event["event_type"]),
      severity: str(bundle.event["severity"]),
      status: str(bundle.event["status"]),
      affected_cve: str(bundle.event["affected_cve"]),
      affected_vendor: str(bundle.event["affected_vendor"]),
      executive_summary: null,
      source_count: num(bundle.event["source_count"]),
      confidence: num(bundle.event["confidence"]),
      first_seen_at: str(bundle.event["first_seen_at"]),
      last_seen_at: str(bundle.event["last_seen_at"]),
    },
    sources: bundle.sources.map((s) => ({
      source: str(s["source"]) ?? "Unknown source",
      external_id: str(s["external_id"]),
      relation: str(s["relation"]) ?? "",
      last_contributed_at: str(s["last_contributed_at"]),
    })),
    timeline: bundle.timeline.map((t) => ({
      entry_type: str(t["entry_type"]) ?? "",
      occurred_at: str(t["occurred_at"]) ?? "",
      summary: str(t["summary"]) ?? "",
      source: str(t["source"]),
    })),
    recommended_actions: [],
    related_findings: [],
  };
}

/**
 * Merge the two possible sources into one view model, preferring the canonical
 * event. Returns null when nothing renderable is available → the page shows the
 * honest-unavailable state. Never throws; never fabricates.
 */
export function resolveIntelligenceDetail(
  enrichment: IntelligenceEventDetail | null,
  fallback: FindingContextEventBundle | null,
): IntelligenceDetailViewModel | null {
  if (enrichment) return fromCanonical(enrichment);
  if (fallback) return fromFindingContext(fallback);
  return null;
}
