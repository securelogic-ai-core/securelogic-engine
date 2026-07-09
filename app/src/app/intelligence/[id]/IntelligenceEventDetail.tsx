/**
 * IntelligenceEventDetail — presentational view for the Intelligence Event
 * drill-through (ERIP Package 3.3, PR-2). Display-only (no client interactivity),
 * dark-styled to match the Decision Workspace. Rendered by the server page only
 * when SECURELOGIC_DECISION_WORKSPACE_ENABLED is on; the view model is built by
 * the pure resolver in intelligenceDetailView.ts.
 *
 * Intelligence Events are drill-through only — this surface is reached from a
 * Finding (and, later, Review Links), never from primary navigation.
 */

import Link from "next/link";
import type { IntelligenceDetailViewModel } from "./intelligenceDetailView";

const CARD: React.CSSProperties = {
  background: "#0b1220",
  border: "1px solid #1e293b",
  borderRadius: 10,
  padding: 20,
  marginBottom: 16,
};
const H: React.CSSProperties = { fontSize: 13, color: "#94a3b8", marginBottom: 10, fontWeight: 600 };

const SEVERITY_COLOR: Record<string, string> = {
  Critical: "#fca5a5",
  High: "#fdba74",
  Moderate: "#fcd34d",
  Low: "#86efac",
};

function Chip({ text, color }: { text: string; color: string }) {
  return (
    <span style={{ fontSize: 11, color, border: `1px solid ${color}`, borderRadius: 999, padding: "2px 10px" }}>
      {text}
    </span>
  );
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

/** Honest empty/degraded state — the flag is on, but no event data is available. */
export function IntelligenceEventUnavailable({ id, backHref }: { id: string; backHref: string }) {
  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <Link href={backHref} style={{ fontSize: 12, color: "#94a3b8" }}>
        ← Back
      </Link>
      <div style={{ ...CARD, marginTop: 16 }}>
        <h1 style={{ fontSize: 18, color: "#e5e7eb", marginBottom: 8 }}>Intelligence detail unavailable</h1>
        <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.6 }}>
          The canonical intelligence detail for this event isn&apos;t available in this environment. The
          supporting-intelligence summary remains visible on the originating finding.
        </p>
        <p style={{ fontSize: 11, color: "#475569", marginTop: 12 }}>Event reference: {id}</p>
      </div>
    </div>
  );
}

export function IntelligenceEventDetail({
  view,
  backHref,
}: {
  view: IntelligenceDetailViewModel;
  backHref: string;
}) {
  const { event } = view;
  const sevColor = (event.severity && SEVERITY_COLOR[event.severity]) || "#94a3b8";

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <Link href={backHref} style={{ fontSize: 12, color: "#94a3b8" }}>
        ← Back
      </Link>

      {/* Header */}
      <div style={{ ...CARD, marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          {event.severity && <Chip text={event.severity} color={sevColor} />}
          {event.status && <Chip text={event.status} color="#94a3b8" />}
          {event.event_type && <span style={{ fontSize: 12, color: "#64748b" }}>{event.event_type}</span>}
        </div>
        <h1 style={{ fontSize: 22, color: "#f1f5f9", fontWeight: 700, lineHeight: 1.3 }}>{event.title}</h1>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap" }}>
          {event.affected_cve && <span>{event.affected_cve}</span>}
          {event.affected_vendor && <span>{event.affected_vendor}</span>}
          {event.canonical_key && <span>{event.canonical_key}</span>}
          {typeof event.source_count === "number" && <span>{event.source_count} sources</span>}
          <span>First seen {fmt(event.first_seen_at)}</span>
          <span>Last seen {fmt(event.last_seen_at)}</span>
        </div>
        {event.executive_summary && (
          <p style={{ fontSize: 14, color: "#cbd5e1", marginTop: 14, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
            {event.executive_summary}
          </p>
        )}
      </div>

      {/* Recommended actions (canonical only) */}
      {view.recommended_actions.length > 0 && (
        <div style={CARD}>
          <div style={H}>Recommended actions</div>
          {view.recommended_actions.map((a, i) => (
            <div key={i} style={{ fontSize: 13, color: "#e5e7eb", marginBottom: 6 }}>
              <span style={{ color: "#64748b", marginRight: 8 }}>[{a.urgency}]</span>
              {a.action}
            </div>
          ))}
        </div>
      )}

      {/* Corroborating sources (citations = attribution + timestamps) */}
      <div style={CARD}>
        <div style={H}>Corroborating sources ({view.sources.length})</div>
        {view.sources.length === 0 ? (
          <span style={{ fontSize: 12, color: "#475569" }}>No corroborating sources recorded.</span>
        ) : (
          view.sources.map((s, i) => (
            <div key={i} style={{ fontSize: 13, color: "#e5e7eb", marginBottom: 6 }}>
              {s.source}
              {s.relation && <span style={{ color: "#64748b" }}> · {s.relation}</span>}
              {s.external_id && <span style={{ color: "#64748b" }}> · {s.external_id}</span>}
              {s.last_contributed_at && <span style={{ color: "#475569" }}> · {fmt(s.last_contributed_at)}</span>}
            </div>
          ))
        )}
      </div>

      {/* Timeline */}
      <div style={CARD}>
        <div style={H}>Timeline</div>
        {view.timeline.length === 0 ? (
          <span style={{ fontSize: 12, color: "#475569" }}>No timeline entries recorded.</span>
        ) : (
          view.timeline.map((t, i) => (
            <div key={i} style={{ fontSize: 13, color: "#e5e7eb", marginBottom: 6 }}>
              <span style={{ color: "#475569" }}>{fmt(t.occurred_at)}</span>
              <span style={{ color: "#64748b" }}> · {t.entry_type}</span>
              {t.summary && <span> — {t.summary}</span>}
              {t.source && <span style={{ color: "#475569" }}> ({t.source})</span>}
            </div>
          ))
        )}
      </div>

      {/* Related findings (canonical only; org-scoped by the engine) */}
      {view.related_findings.length > 0 && (
        <div style={CARD}>
          <div style={H}>Related findings</div>
          {view.related_findings.map((f) => (
            <div key={f.id} style={{ fontSize: 13, marginBottom: 6 }}>
              <Link href={`/findings/${f.id}`} style={{ color: "#93c5fd" }}>
                {f.title}
              </Link>
              <span style={{ color: "#64748b" }}> · {f.severity} · {f.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
