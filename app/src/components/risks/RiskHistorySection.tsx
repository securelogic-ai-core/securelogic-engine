"use client";

/**
 * RiskHistorySection (RR-3) — chronological audit trail for a single
 * risk. Renders security_audit_log rows scoped to the risk plus its
 * treatments (the engine handles the join).
 *
 * Fetches client-side via the Next.js proxy at
 *   /api/risks/[id]/history?limit&offset
 * so the JWT stays in the session cookie. "Load more" appends the next
 * page rather than replacing the current one.
 *
 * Row layout mirrors the global account-level audit log table:
 *   timestamp · event badge · actor · expandable payload
 * The Resource column from the global table is dropped (every row
 * belongs to this risk or one of its treatments — redundant here).
 */

import { useEffect, useState } from "react";
import { getRiskHistory, type AuditLogEvent } from "@/lib/api";
import { formatEventLabel, eventBadgeStyle } from "@/lib/auditLogUtils";

const PAGE_SIZE = 20;

// ─── Formatting ──────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60)        return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60)        return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24)         return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30)        return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12)         return `${mo}mo ago`;
  const yr = Math.round(mo / 12);
  return `${yr}y ago`;
}

function formatAbsolute(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year:   "numeric",
      month:  "short",
      day:    "numeric",
      hour:   "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function actorLabel(event: AuditLogEvent): string {
  if (event.actor_email) return event.actor_email;
  if (event.actor_name)  return event.actor_name;
  // No user attribution: distinguish API-key callers from system events
  // by the presence of an ip_address (system/scheduler events are
  // written with ipAddress: null per writeAuditEvent convention).
  if (event.ip_address)  return "API key";
  return "System";
}

// ─── Payload renderer ────────────────────────────────────────────────────────

function PayloadDetail({ metadata }: { metadata: Record<string, unknown> | null }) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return <span style={{ color: "#475569", fontSize: 12 }}>No details</span>;
  }
  return (
    <dl
      className="grid gap-y-1"
      style={{ gridTemplateColumns: "max-content 1fr" }}
    >
      {Object.entries(metadata).map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt
            style={{
              color: "#64748b",
              fontSize: 12,
              fontFamily: "monospace",
              paddingRight: 12,
            }}
          >
            {k}
          </dt>
          <dd
            style={{
              color: "#cbd5e1",
              fontSize: 12,
              fontFamily: "monospace",
              wordBreak: "break-all",
            }}
          >
            {typeof v === "object" ? JSON.stringify(v) : String(v ?? "—")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function HistoryRow({ event }: { event: AuditLogEvent }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      style={{
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        padding: "10px 0",
      }}
    >
      <div className="flex items-start gap-3 flex-wrap">
        <span
          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap"
          style={eventBadgeStyle(event.event_type)}
        >
          {formatEventLabel(event.event_type)}
        </span>
        <span
          className="text-sm flex-1 min-w-0 truncate"
          style={{ color: "#cbd5e1" }}
        >
          {actorLabel(event)}
        </span>
        <span
          className="text-xs whitespace-nowrap"
          style={{ color: "#64748b" }}
          title={formatAbsolute(event.created_at)}
        >
          {formatRelative(event.created_at)}
        </span>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs font-medium px-2 py-0.5 rounded"
          style={{
            background: expanded ? "rgba(0,196,180,0.1)" : "transparent",
            color: expanded ? "#00c4b4" : "#64748b",
            border: `1px solid ${
              expanded ? "rgba(0,196,180,0.25)" : "rgba(148,163,184,0.15)"
            }`,
          }}
        >
          {expanded ? "Close" : "Details"}
        </button>
      </div>
      {expanded && (
        <div
          className="mt-2 p-3 rounded"
          style={{ background: "rgba(0,196,180,0.03)" }}
        >
          <PayloadDetail metadata={event.metadata} />
        </div>
      )}
    </div>
  );
}

// ─── Section ─────────────────────────────────────────────────────────────────

export function RiskHistorySection({ riskId }: { riskId: string }) {
  const [events, setEvents]       = useState<AuditLogEvent[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [offset, setOffset]       = useState<number>(0);
  const [loading, setLoading]     = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [error, setError]         = useState<string | null>(null);
  const [open, setOpen]           = useState<boolean>(true);

  // Initial fetch on mount.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getRiskHistory(riskId, { limit: PAGE_SIZE, offset: 0 })
      .then((res) => {
        if (cancelled) return;
        if (!res) {
          setError("Could not load history");
          return;
        }
        setEvents(res.events);
        setTotalCount(res.total_count);
        setOffset(res.events.length);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [riskId]);

  async function loadMore() {
    setLoadingMore(true);
    const res = await getRiskHistory(riskId, { limit: PAGE_SIZE, offset });
    setLoadingMore(false);
    if (!res) {
      setError("Could not load more history");
      return;
    }
    setEvents((prev) => [...prev, ...res.events]);
    setTotalCount(res.total_count);
    setOffset((prev) => prev + res.events.length);
  }

  const hasMore = events.length < totalCount;

  return (
    <div
      className="mb-6 p-5"
      style={{
        background: "var(--color-brand-surface, #111827)",
        border: "1px solid #1e293b",
        borderRadius: 12,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-baseline justify-between gap-3 flex-wrap"
        style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
      >
        <div className="flex items-baseline gap-3">
          <p
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#64748b",
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            History
          </p>
          {!loading && (
            <span className="text-xs" style={{ color: "#64748b" }}>
              {totalCount} {totalCount === 1 ? "event" : "events"}
            </span>
          )}
        </div>
        <span style={{ color: "#64748b", fontSize: 12 }}>
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="mt-3">
          {loading ? (
            <p className="text-sm" style={{ color: "#475569" }}>
              Loading history…
            </p>
          ) : error ? (
            <p className="text-sm" style={{ color: "#fca5a5" }}>
              {error}
            </p>
          ) : events.length === 0 ? (
            <p className="text-sm" style={{ color: "#475569" }}>
              No history yet.
            </p>
          ) : (
            <>
              <div>
                {events.map((e) => (
                  <HistoryRow key={e.id} event={e} />
                ))}
              </div>
              {hasMore && (
                <div className="mt-3 text-center">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="text-xs font-medium px-3 py-1.5 rounded"
                    style={{
                      background: "rgba(0,196,180,0.08)",
                      color: "#00c4b4",
                      border: "1px solid rgba(0,196,180,0.25)",
                      opacity: loadingMore ? 0.5 : 1,
                      cursor: loadingMore ? "wait" : "pointer",
                    }}
                  >
                    {loadingMore
                      ? "Loading…"
                      : `Load more (${totalCount - events.length} remaining)`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
