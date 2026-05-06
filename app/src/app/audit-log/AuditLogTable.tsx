"use client";

import { useState } from "react";
import type { AuditLogEvent } from "@/lib/api";
import { formatEventLabel, eventBadgeStyle } from "@/lib/auditLogUtils";

// ─── Timestamp ────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
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

// ─── Resource cell ────────────────────────────────────────────────────────────

function ResourceCell({
  resourceType,
  resourceId,
}: {
  resourceType: string | null;
  resourceId: string | null;
}) {
  if (!resourceType) return <span style={{ color: "#475569" }}>—</span>;
  return (
    <span>
      <span style={{ color: "#94a3b8" }}>{resourceType}</span>
      {resourceId && (
        <>
          <span style={{ color: "#334155" }}> · </span>
          <span style={{ color: "#64748b", fontFamily: "monospace", fontSize: "11px" }}>
            {resourceId.slice(0, 8)}…
          </span>
        </>
      )}
    </span>
  );
}

// ─── Metadata detail ─────────────────────────────────────────────────────────

function MetadataDetail({ metadata }: { metadata: Record<string, unknown> | null }) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return <span style={{ color: "#475569", fontSize: "12px" }}>No metadata</span>;
  }
  return (
    <dl className="grid gap-y-1" style={{ gridTemplateColumns: "max-content 1fr" }}>
      {Object.entries(metadata).map(([k, v]) => (
        <>
          <dt
            key={`k-${k}`}
            style={{ color: "#64748b", fontSize: "12px", fontFamily: "monospace", paddingRight: "12px" }}
          >
            {k}
          </dt>
          <dd
            key={`v-${k}`}
            style={{ color: "#cbd5e1", fontSize: "12px", fontFamily: "monospace", wordBreak: "break-all" }}
          >
            {typeof v === "object" ? JSON.stringify(v) : String(v ?? "")}
          </dd>
        </>
      ))}
    </dl>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function AuditLogRow({ event }: { event: AuditLogEvent }) {
  const [expanded, setExpanded] = useState(false);
  const actor = event.actor_email ?? event.actor_name ?? "System";

  return (
    <>
      <tr
        style={{ borderBottom: "1px solid #1e2d45" }}
        className="transition-colors hover:bg-white/[0.02]"
      >
        {/* Timestamp */}
        <td
          className="px-4 py-3 text-xs whitespace-nowrap"
          style={{ color: "#94a3b8", fontFamily: "monospace" }}
        >
          {formatTimestamp(event.created_at)}
        </td>

        {/* Event type */}
        <td className="px-4 py-3">
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap"
            style={eventBadgeStyle(event.event_type)}
          >
            {formatEventLabel(event.event_type)}
          </span>
        </td>

        {/* User */}
        <td className="px-4 py-3 text-sm" style={{ color: "#cbd5e1", maxWidth: "180px" }}>
          <span className="truncate block">{actor}</span>
        </td>

        {/* Resource */}
        <td className="px-4 py-3 text-sm">
          <ResourceCell resourceType={event.resource_type} resourceId={event.resource_id} />
        </td>

        {/* IP */}
        <td
          className="px-4 py-3 text-xs"
          style={{ color: "#64748b", fontFamily: "monospace", whiteSpace: "nowrap" }}
        >
          {event.ip_address ?? "—"}
        </td>

        {/* Details toggle */}
        <td className="px-4 py-3">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium px-2 py-1 rounded transition-colors"
            style={{
              background: expanded ? "rgba(0,196,180,0.1)" : "rgba(148,163,184,0.08)",
              color: expanded ? "#00c4b4" : "#64748b",
              border: `1px solid ${expanded ? "rgba(0,196,180,0.25)" : "rgba(148,163,184,0.15)"}`,
            }}
          >
            {expanded ? "Close" : "View"}
          </button>
        </td>
      </tr>

      {expanded && (
        <tr style={{ borderBottom: "1px solid #1e2d45", background: "rgba(0,196,180,0.03)" }}>
          <td colSpan={6} className="px-6 py-4">
            <MetadataDetail metadata={event.metadata} />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────

export default function AuditLogTable({ events }: { events: AuditLogEvent[] }) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: "#0d1626", border: "1px solid #1e2d45" }}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: "1px solid #1e2d45" }}>
              {["Timestamp", "Event", "User", "Resource", "IP Address", ""].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                  style={{ color: "#475569" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <AuditLogRow key={event.id} event={event} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
