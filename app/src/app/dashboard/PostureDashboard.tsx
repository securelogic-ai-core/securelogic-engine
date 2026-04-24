"use client";

import { useEffect, useState } from "react";
import type {
  DashboardSummary,
  Framework,
  FrameworkReadiness,
  PostureSnapshot,
  TileConfig,
  DashboardPreferences,
} from "@/lib/api";
import {
  FindingsDonut,
  DomainPostureBars,
  ActionsRing,
  InventoryGrid,
  FrameworkGaps,
  VendorRiskCard,
  PostureScoreTile,
  RisksBreakdown,
  ComplianceCoverage,
  RiskHeatmap,
  OpenItemsAging,
} from "./DashboardCharts";
import { PostureTrendChart } from "./PostureTrendChart";

type FrameworkPair = { framework: Framework; readiness: FrameworkReadiness | null };

type Props = {
  summary: DashboardSummary;
  frameworkPairs: FrameworkPair[];
  postureSnapshots: PostureSnapshot[];
  userRole: string;
};

// ─────────────────────────────────────────────────────────────
// Tile registry — the 12 canonical tile IDs. This is the source
// of truth for labels shown in the Customize panel. Must match
// the IDs validated by the engine (src/api/routes/dashboardPreferences.ts).
// ─────────────────────────────────────────────────────────────

const TILE_LABELS: Record<string, string> = {
  posture_score:       "Posture Score",
  risks_breakdown:     "Risks",
  risk_heatmap:        "Risk Heatmap",
  posture_trend:       "Posture Trend",
  findings_donut:      "Findings",
  domain_posture:      "Domain Posture",
  actions_ring:        "Actions",
  open_items_aging:    "Open Items Aging",
  vendor_risk:         "Vendor Risk",
  framework_gaps:      "Framework Gaps",
  compliance_coverage: "Compliance",
  inventory_grid:      "Inventory",
};

const SYSTEM_DEFAULT_LAYOUT: TileConfig[] = [
  { id: "posture_score",       visible: true, order: 0  },
  { id: "risks_breakdown",     visible: true, order: 1  },
  { id: "risk_heatmap",        visible: true, order: 2  },
  { id: "posture_trend",       visible: true, order: 3  },
  { id: "findings_donut",      visible: true, order: 4  },
  { id: "domain_posture",      visible: true, order: 5  },
  { id: "actions_ring",        visible: true, order: 6  },
  { id: "open_items_aging",    visible: true, order: 7  },
  { id: "vendor_risk",         visible: true, order: 8  },
  { id: "framework_gaps",      visible: true, order: 9  },
  { id: "compliance_coverage", visible: true, order: 10 },
  { id: "inventory_grid",      visible: true, order: 11 },
];

function isVisible(layout: TileConfig[], id: string): boolean {
  const tile = layout.find((t) => t.id === id);
  // Default to visible for any tile not present in the saved layout
  // (e.g. new tile added after the user saved an older layout).
  return tile ? tile.visible : true;
}

export function PostureDashboard({ summary, frameworkPairs, postureSnapshots, userRole }: Props) {
  const { posture, domains, findings, actions, controls_cadence, inventory, vendor_risk, risks_summary } = summary;

  const [layout, setLayout] = useState<TileConfig[]>(SYSTEM_DEFAULT_LAYOUT);
  const [source, setSource] = useState<DashboardPreferences["source"]>("system_default");
  const [showPanel, setShowPanel] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/dashboard/preferences", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: DashboardPreferences | null) => {
        if (!cancelled && data && Array.isArray(data.layout)) {
          setLayout(data.layout);
          setSource(data.source);
        }
      })
      .catch(() => { /* keep system default */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(id);
  }, [toast]);

  function handleSaved(next: DashboardPreferences, message: string) {
    setLayout(next.layout);
    setSource(next.source);
    setShowPanel(false);
    setToast(message);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">
          Security Posture
        </h2>
        <div style={{ display: "inline-flex", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setShowPanel(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "5px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600,
              border: "1px solid rgba(0,196,180,0.4)",
              color: "#00c4b4",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            Customize
          </button>
          <a
            href="/api/export/executive-report"
            download="executive-report.pdf"
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "5px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600,
              border: "1px solid rgba(0,196,180,0.4)",
              color: "#00c4b4",
              background: "transparent",
              textDecoration: "none",
            }}
          >
            &#8595; Executive Report
          </a>
        </div>
      </div>

      {/* Row 0: Posture score | Risks breakdown | Risk heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {isVisible(layout, "posture_score")   && <PostureScoreTile posture={posture} />}
        {isVisible(layout, "risks_breakdown") && <RisksBreakdown risks_summary={risks_summary} />}
        {isVisible(layout, "risk_heatmap")    && <RiskHeatmap risks_summary={risks_summary} />}
      </div>

      {/* Row 0b: Posture score trend (full width) */}
      {isVisible(layout, "posture_trend") && (
        <div className="mb-4">
          <PostureTrendChart snapshots={postureSnapshots} />
        </div>
      )}

      {/* Row 1: Findings donut | Domain bars | Actions ring */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {isVisible(layout, "findings_donut") && <FindingsDonut findings={findings} />}
        {isVisible(layout, "domain_posture") && <DomainPostureBars domains={domains} />}
        {isVisible(layout, "actions_ring")   && <ActionsRing actions={actions} />}
      </div>

      {/* Row 1b: Open items aging (full width) */}
      {isVisible(layout, "open_items_aging") && (
        <div className="mb-4">
          <OpenItemsAging findings={findings} actions={actions} />
        </div>
      )}

      {/* Row 2: Vendor risk | Framework gaps | Compliance coverage */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        {isVisible(layout, "vendor_risk")         && <VendorRiskCard vendor_risk={vendor_risk} />}
        {isVisible(layout, "framework_gaps")      && <FrameworkGaps pairs={frameworkPairs} />}
        {isVisible(layout, "compliance_coverage") && <ComplianceCoverage frameworkPairs={frameworkPairs} />}
      </div>

      {/* Row 3: Inventory grid (full width) */}
      {isVisible(layout, "inventory_grid") && (
        <InventoryGrid inventory={inventory} controls_cadence={controls_cadence} />
      )}

      {showPanel && (
        <CustomizePanel
          initialLayout={layout}
          source={source}
          userRole={userRole}
          onClose={() => setShowPanel(false)}
          onSaved={handleSaved}
        />
      )}

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: "24px",
            right: "24px",
            background: "rgba(15,23,42,0.95)",
            border: "1px solid rgba(0,196,180,0.4)",
            color: "#00c4b4",
            padding: "10px 16px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: 600,
            zIndex: 10000,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// CustomizePanel — modal with a checkbox per tile.
// Enforces "at least one tile visible" by disabling the last
// checked tile's toggle.
// ─────────────────────────────────────────────────────────────

const ALL_TILE_IDS = SYSTEM_DEFAULT_LAYOUT.map((t) => t.id);

function buildFullLayout(layout: TileConfig[]): TileConfig[] {
  // Merge saved layout with system default so every known tile has an entry.
  // Unknown tile IDs in the saved layout are dropped.
  const byId = new Map(layout.filter((t) => TILE_LABELS[t.id]).map((t) => [t.id, t]));
  return SYSTEM_DEFAULT_LAYOUT.map((def) => byId.get(def.id) ?? def);
}

function CustomizePanel({
  initialLayout,
  source,
  userRole,
  onClose,
  onSaved,
}: {
  initialLayout: TileConfig[];
  source: DashboardPreferences["source"];
  userRole: string;
  onClose: () => void;
  onSaved: (next: DashboardPreferences, message: string) => void;
}) {
  const [draft, setDraft] = useState<TileConfig[]>(() => buildFullLayout(initialLayout));
  const [applyAsOrgDefault, setApplyAsOrgDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = userRole === "admin";
  const visibleCount = draft.filter((t) => t.visible).length;

  function toggle(id: string) {
    setDraft((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        // Block unchecking when this is the only remaining visible tile.
        if (t.visible && visibleCount <= 1) return t;
        return { ...t, visible: !t.visible };
      })
    );
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const putRes = await fetch("/api/dashboard/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: draft }),
      });
      if (!putRes.ok) {
        const body = (await putRes.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "save_failed");
        setSaving(false);
        return;
      }
      const saved = (await putRes.json()) as DashboardPreferences;

      if (isAdmin && applyAsOrgDefault) {
        const orgRes = await fetch("/api/dashboard/preferences/org", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ layout: draft }),
        });
        if (!orgRes.ok) {
          const body = (await orgRes.json().catch(() => ({}))) as { error?: string };
          setError(body.error ?? "org_default_save_failed");
          setSaving(false);
          return;
        }
      }

      const message = isAdmin && applyAsOrgDefault
        ? "Layout saved — applied as team default"
        : "Layout saved";
      onSaved(saved, message);
    } catch {
      setError("network_error");
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/preferences/reset", { method: "DELETE" });
      if (!res.ok) {
        setError("reset_failed");
        setSaving(false);
        return;
      }
      const resolved = (await res.json()) as DashboardPreferences;
      onSaved(resolved, "Reset to default");
    } catch {
      setError("network_error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2,6,23,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9000,
        padding: "24px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0f172a",
          border: "1px solid #1e293b",
          borderRadius: "12px",
          width: "100%",
          maxWidth: "480px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #1e293b" }}>
          <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "#f1f5f9" }}>
            Customize Dashboard
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#94a3b8" }}>
            Choose which tiles appear on your dashboard.
          </p>
          {source === "org_default" && (
            <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#64748b" }}>
              Currently using your organization&apos;s default layout.
            </p>
          )}
        </div>

        <div style={{ padding: "12px 8px", overflowY: "auto", flex: 1 }}>
          {ALL_TILE_IDS.map((id) => {
            const tile = draft.find((t) => t.id === id)!;
            const disabled = tile.visible && visibleCount <= 1;
            return (
              <label
                key={id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "10px 16px",
                  borderRadius: "8px",
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.6 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={tile.visible}
                  disabled={disabled}
                  onChange={() => toggle(id)}
                  style={{ width: "16px", height: "16px", cursor: disabled ? "not-allowed" : "pointer", accentColor: "#00c4b4" }}
                />
                <span style={{ fontSize: "14px", color: "#f1f5f9" }}>{TILE_LABELS[id]}</span>
              </label>
            );
          })}

          {isAdmin && (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                margin: "12px 8px 0",
                padding: "12px 16px",
                borderRadius: "8px",
                background: "rgba(0,196,180,0.06)",
                border: "1px solid rgba(0,196,180,0.2)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={applyAsOrgDefault}
                onChange={(e) => setApplyAsOrgDefault(e.target.checked)}
                style={{ width: "16px", height: "16px", accentColor: "#00c4b4" }}
              />
              <span style={{ fontSize: "13px", color: "#e2e8f0" }}>
                Apply as default for all team members
              </span>
            </label>
          )}

          {error && (
            <p style={{ margin: "12px 16px 0", fontSize: "12px", color: "#fca5a5" }}>
              {error}
            </p>
          )}
        </div>

        <div
          style={{
            padding: "14px 20px",
            borderTop: "1px solid #1e293b",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <button
            type="button"
            onClick={handleReset}
            disabled={saving}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              fontSize: "13px",
              cursor: saving ? "not-allowed" : "pointer",
              textDecoration: "underline",
              padding: 0,
            }}
          >
            Reset to default
          </button>
          <div style={{ display: "inline-flex", gap: "8px" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              style={{
                padding: "8px 14px",
                borderRadius: "6px",
                fontSize: "13px",
                border: "1px solid #334155",
                background: "transparent",
                color: "#cbd5e1",
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: "8px 16px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: 600,
                border: "none",
                background: "#00c4b4",
                color: "#0a0f1a",
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
