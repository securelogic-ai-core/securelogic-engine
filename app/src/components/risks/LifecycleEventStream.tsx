"use client";

/**
 * LifecycleEventStream (R3, spec §4.7) — the append-only lifecycle audit
 * timeline for a risk, read from GET /api/risks/:id/lifecycle/events. Distinct
 * from the RR-3 RiskHistorySection projection: this is the authoritative,
 * transactional event stream (who, when, from→to, comment).
 *
 * Re-fetches when `refreshKey` changes (bumped by the panel after a
 * transition). Renders nothing when the lifecycle flag is off (engine 404).
 */

import { useCallback, useEffect, useState } from "react";
import { getRiskLifecycleEvents, type LifecycleEvent } from "@/lib/api";
import { stateLabel, transitionLabel } from "./lifecycleLabels";

const CARD_STYLE: React.CSSProperties = {
  background: "var(--color-brand-surface, #111827)",
  border: "1px solid #1e293b",
  borderRadius: 12,
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function actorLabel(ev: LifecycleEvent): string {
  if (ev.actor_user_id) return "User";
  if (ev.actor_api_key_id) return "API key";
  return "System";
}

export function LifecycleEventStream({
  riskId,
  refreshKey = 0,
}: {
  riskId: string;
  refreshKey?: number;
}) {
  const [events, setEvents] = useState<LifecycleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getRiskLifecycleEvents(riskId, { limit: 50 });
    setLoading(false);
    if (res.ok) {
      setEvents(res.events);
      setDisabled(false);
      return;
    }
    if (res.disabled) {
      setDisabled(true);
      return;
    }
    setError("Could not load lifecycle history.");
  }, [riskId]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  if (disabled) return null;

  return (
    <div className="mb-6 p-5" style={CARD_STYLE}>
      <p style={SECTION_LABEL} className="mb-3">Lifecycle History</p>
      {loading && events.length === 0 ? (
        <p className="text-sm" style={{ color: "#475569" }}>Loading…</p>
      ) : error ? (
        <p className="text-sm" style={{ color: "#fca5a5" }}>{error}</p>
      ) : events.length === 0 ? (
        <p className="text-sm" style={{ color: "#475569" }}>
          No lifecycle events yet.
        </p>
      ) : (
        <ol className="space-y-3 list-none p-0 m-0">
          {events.map((ev) => (
            <li
              key={ev.id}
              className="rounded-lg p-3"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  style={{ background: "rgba(96,165,250,0.12)", color: "#93c5fd" }}
                >
                  {transitionLabel(ev.transition)}
                </span>
                <span className="text-xs" style={{ color: "#64748b" }}>
                  {ev.from_state ? `${stateLabel(ev.from_state)} → ` : ""}
                  {stateLabel(ev.to_state)}
                </span>
              </div>
              {ev.comment && (
                <p className="text-sm mt-1" style={{ color: "#cbd5e1", whiteSpace: "pre-wrap" }}>
                  {ev.comment}
                </p>
              )}
              <p className="text-xs mt-1.5" style={{ color: "#475569" }}>
                {actorLabel(ev)} · {fmtDateTime(ev.created_at)}
                {ev.evidence_ids.length > 0 ? ` · ${ev.evidence_ids.length} evidence` : ""}
                {ev.approval_id ? " · approval" : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
