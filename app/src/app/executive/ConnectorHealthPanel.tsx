/**
 * ConnectorHealthPanel.tsx — connector fleet health: org rollup + per-connector
 * band, reasons, and key signals. Server-renderable. Consumes GET
 * /api/connectors/health. Only CONFIGURED connectors are shown (unconfigured
 * ones are collapsed into a count).
 */

import { HealthBadge } from "./shared";
import {
  healthReasonLabel,
  type ConnectorHealthResponse,
} from "@/lib/executiveRisk";

const MUTED = "#64748b";

export function ConnectorHealthPanel({ health }: { health: ConnectorHealthResponse }) {
  const configured = health.connectors.filter((c) => c.band !== "unconfigured");
  const unconfiguredCount = health.connectors.length - configured.length;

  if (configured.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-brand-line px-4 py-6 text-center">
        <p className="text-xs" style={{ color: MUTED }}>
          No connectors configured yet ({unconfiguredCount} available to connect).
        </p>
      </div>
    );
  }

  // Worst bands first.
  const ordered = [...configured].sort((a, b) => b.severity - a.severity);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs" style={{ color: MUTED }}>Fleet status</span>
        <HealthBadge band={health.overall_band} />
        <span className="text-xs" style={{ color: MUTED }}>
          · {health.configured_count} configured · {unconfiguredCount} available
        </span>
      </div>
      <ul className="space-y-2">
        {ordered.map((c) => (
          <li key={c.connector_id} className="rounded-lg border border-brand-line p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium" style={{ color: "#e2e8f0" }}>{c.display_name}</span>
              <HealthBadge band={c.band} />
            </div>
            {c.reasons.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {c.reasons.map((r) => (
                  <span key={r} className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "rgba(148,163,184,0.1)", color: "#94a3b8" }}>
                    {healthReasonLabel(r)}
                  </span>
                ))}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: MUTED }}>
              <span>Last sync: {c.signals.last_sync_status ?? "never"}</span>
              {c.signals.stale_observations > 0 && <span>Drift: {c.signals.stale_observations}</span>}
              {c.signals.writeback_conflict > 0 && <span>Conflicts: {c.signals.writeback_conflict}</span>}
              {c.signals.open_dead_letters > 0 && <span style={{ color: "#fca5a5" }}>Dead-letters: {c.signals.open_dead_letters}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
