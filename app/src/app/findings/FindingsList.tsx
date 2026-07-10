"use client";

import { useState } from "react";
import { FindingCard } from "@/components/FindingCard";
import type { Finding, FindingsSummary } from "@/lib/api";
import Link from "next/link";
import { attentionSummary, groupByUrgency, isFirstTimeEmpty } from "./decisionQueue";

interface Props {
  findings: Finding[];
  hasFilters: boolean;
  // Enterprise decision-queue mode (ERIP) — DARK, SECURELOGIC_RISK_WORKSPACE_ENABLED.
  // When on, the list becomes a "what needs action now" queue: attention tiles +
  // urgency grouping. Off = the unchanged domain-grouped list (byte-identical).
  workspace?: boolean;
  // Metric Contract: authoritative org-wide summary for the attention tiles.
  // When present, tiles read server COUNT(*)s (same definitions as
  // decisionQueue's predicates) instead of scanning the capped ≤100-row slice.
  orgSummary?: FindingsSummary;
  // True filtered total (server) for the honest "Showing N of M" disclosure.
  total?: number;
}

const TILE: React.CSSProperties = {
  background: "var(--color-brand-surface, #111827)",
  border: "1px solid #1e293b",
  borderRadius: 12,
  padding: "14px 18px",
  flex: 1,
  minWidth: 150,
};

const PILL_ACTIVE: React.CSSProperties = {
  background: "rgba(0,196,180,0.15)", color: "#00c4b4",
  border: "1px solid rgba(0,196,180,0.4)",
};
const PILL_INACTIVE: React.CSSProperties = {
  background: "transparent", color: "#94a3b8", border: "1px solid #1e293b",
};

export function FindingsList({ findings, hasFilters, workspace = false, orgSummary, total }: Props) {
  const [hasActionsOnly, setHasActionsOnly] = useState(false);

  const visible = hasActionsOnly
    ? findings.filter((f) => f.action_count > 0)
    : findings;

  // Enterprise decision-queue grouping (workspace) vs. legacy domain grouping.
  const now = Date.now();
  const attention = workspace ? attentionSummary(visible, now) : null;
  const urgencyGroups = workspace ? groupByUrgency(visible, now) : null;

  // Metric Contract: attention tiles prefer authoritative org-wide counts (same
  // definitions as the client predicates) over the capped-slice scan; fall back
  // to the slice when the engine build predates the summary fields.
  const tileOverdue = orgSummary?.overdue_open ?? attention?.overdue ?? 0;
  const tileUnassigned = orgSummary?.unassigned_open ?? attention?.unassigned ?? 0;
  const tileCriticalHigh = orgSummary?.critical_high_active ?? attention?.criticalOpen ?? 0;
  const tileActiveTotal = orgSummary?.active_total ?? attention?.openTotal ?? 0;

  // Honest pagination disclosure: the slice is capped (≤100) — say so instead
  // of letting a truncated list sit under org-wide tiles.
  const truncationNote =
    typeof total === "number" && total > findings.length
      ? `Showing ${findings.length} of ${total} findings${workspace ? " — tiles reflect the full org total." : "."}`
      : null;

  const grouped: Record<string, Finding[]> = {};
  for (const f of visible) {
    const d = f.domain ?? "General";
    (grouped[d] ??= []).push(f);
  }

  // Workspace: urgency sections (most-urgent-first). Legacy: domain sections.
  const sections: Array<{ key: string; findings: Finding[] }> =
    workspace && urgencyGroups
      ? urgencyGroups.map((g) => ({ key: g.label, findings: g.findings }))
      : Object.entries(grouped).map(([d, fs]) => ({ key: d, findings: fs }));

  return (
    <>
      {/* Attention tiles — "what needs action now" (workspace only). Org-wide
          server truth (Metric Contract), never a scan of the capped slice. */}
      {workspace && attention && (
        <div className="mb-6 flex flex-wrap gap-3">
          <div style={TILE}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b", marginBottom: 6 }}>Overdue</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: tileOverdue > 0 ? "#fca5a5" : "#f1f5f9" }}>{tileOverdue}</div>
          </div>
          <div style={TILE}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b", marginBottom: 6 }}>Unassigned</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: tileUnassigned > 0 ? "#fcd34d" : "#f1f5f9" }}>{tileUnassigned}</div>
          </div>
          <div style={TILE}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b", marginBottom: 6 }}>High &amp; Critical open</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: tileCriticalHigh > 0 ? "#fca5a5" : "#f1f5f9" }}>{tileCriticalHigh}</div>
          </div>
          <div style={TILE}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "#64748b", marginBottom: 6 }}>Open total</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: "#f1f5f9" }}>{tileActiveTotal}</div>
          </div>
        </div>
      )}

      {/* Honest truncation disclosure (both modes). */}
      {truncationNote && (
        <p className="mb-4 text-xs" style={{ color: "#64748b" }}>{truncationNote}</p>
      )}

      {/* Has Actions filter pill */}
      <div className="mb-4">
        <button
          onClick={() => setHasActionsOnly((v) => !v)}
          className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-colors"
          style={hasActionsOnly ? PILL_ACTIVE : PILL_INACTIVE}
        >
          Has Actions
          {hasActionsOnly && (
            <span className="ml-1.5 opacity-70">✕</span>
          )}
        </button>
      </div>

      {visible.length === 0 && workspace && isFirstTimeEmpty(findings.length, hasFilters, hasActionsOnly) ? (
        // Day-0 / first-time empty (no findings at all, no filters): orient the new
        // customer instead of the misleading "no findings match your filters". Only
        // under the workspace flag — flag-off keeps the legacy empty state byte-identical.
        <div
          className="rounded-xl border p-10 text-center"
          style={{ background: "var(--color-brand-surface, #111827)", borderColor: "rgba(0,196,180,0.2)" }}
        >
          <p className="text-base font-semibold mb-2" style={{ color: "#f1f5f9" }}>
            No findings yet
          </p>
          <p className="text-sm mb-5 mx-auto" style={{ color: "#94a3b8", maxWidth: 520, lineHeight: 1.6 }}>
            Findings appear here when SecureLogic connects external intelligence, assessments, and
            reviews to your vendors, AI systems, controls, and obligations. As new intelligence
            matches your monitored context, it becomes a finding to triage and decide.
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link
              href="/queue"
              className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: "rgba(0,196,180,0.15)", color: "#00c4b4", border: "1px solid rgba(0,196,180,0.4)" }}
            >
              Review suggested links →
            </Link>
            <Link href="/getting-started" className="text-sm font-medium" style={{ color: "#94a3b8" }}>
              Set up monitored context
            </Link>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div
          className="rounded-xl border p-10 text-center"
          style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
        >
          <p className="text-sm mb-3" style={{ color: "#94a3b8" }}>
            No findings match your current filters.
          </p>
          {(hasFilters || hasActionsOnly) && (
            <div className="flex items-center justify-center gap-3">
              {hasActionsOnly && (
                <button
                  onClick={() => setHasActionsOnly(false)}
                  className="text-xs font-medium"
                  style={{ color: "#00c4b4" }}
                >
                  Clear action filter
                </button>
              )}
              {hasFilters && (
                <Link href="/findings" className="text-xs font-medium" style={{ color: "#00c4b4" }}>
                  Clear all filters
                </Link>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {sections.map((section) => (
            <div key={section.key}>
              <div
                className="flex items-center gap-2 mb-3 pb-2"
                style={{ borderBottom: "1px solid #1e293b" }}
              >
                <span
                  className="text-xs font-semibold uppercase tracking-wide"
                  style={{ color: "#64748b" }}
                >
                  {section.key}
                </span>
                <span
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{ background: "rgba(148,163,184,0.1)", color: "#64748b" }}
                >
                  {section.findings.length}
                </span>
              </div>
              <div className="space-y-3">
                {section.findings.map((f) => (
                  <FindingCard key={f.id} finding={f} revalidateUrl="/findings" workspace={workspace} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
