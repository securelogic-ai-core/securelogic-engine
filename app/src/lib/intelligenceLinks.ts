/**
 * intelligenceLinks.ts — pure link/visibility logic for the Intelligence Event
 * drill-through (ERIP Package 3.3, PR-3). Dependency-free (no React) so it is
 * unit-testable without a DOM/RTL harness the app does not have.
 *
 * Two entry points build a link to the drill-through (/intelligence/[id]):
 *   - a Finding's supporting-intelligence rows (Decision Workspace, Zone E);
 *   - the Review-Suggested-Links queue rows (workspace reskin).
 * Both carry over only when the underlying event id exists, so a row without a
 * canonical event never renders a dead link. Intelligence Events remain
 * drill-through only — nothing here adds navigation.
 */

/**
 * Build the drill-through href for an event, optionally carrying the originating
 * finding so the page can offer a correct back link and a finding-context
 * fallback when the canonical events surface is dark.
 */
export function intelligenceEventHref(eventId: string, findingId?: string | null): string {
  const base = `/intelligence/${encodeURIComponent(eventId)}`;
  return findingId ? `${base}?finding=${encodeURIComponent(findingId)}` : base;
}

/**
 * Extract a usable event id from a finding-context intelligence event
 * (loosely typed as Record<string, unknown>). Returns null when absent/blank so
 * the caller renders plain text instead of a link (byte-identical fallback).
 */
export function findingEventId(e: Record<string, unknown>): string | null {
  return typeof e["id"] === "string" && e["id"].length > 0 ? (e["id"] as string) : null;
}

/**
 * Href for the queue reciprocal "view intelligence" link. Shows ONLY in the
 * workspace reskin (risk_workspace on) AND when the row carries an
 * intelligence_event_id; null otherwise (link suppressed).
 */
export function queueIntelligenceHref(
  workspace: boolean,
  intelligenceEventId: string | null | undefined,
): string | null {
  if (!workspace) return null;
  if (typeof intelligenceEventId !== "string" || intelligenceEventId.length === 0) return null;
  return intelligenceEventHref(intelligenceEventId);
}
