"use client";

import { useState, useTransition } from "react";
import type { RiskScale, RiskScaleLevel } from "@/lib/api";
import { updateRiskScaleAction } from "./actions";
import { invalidateRiskScaleCache } from "@/hooks/useRiskScale";

type Props = {
  initialScale: RiskScale | null;
  initialPresets: RiskScale[];
  isPremium: boolean;
};

export function RiskScaleClient({ initialScale, initialPresets, isPremium }: Props) {
  const defaultPreset = initialScale?.preset_name ?? "standard";
  const [selectedPreset, setSelectedPreset] = useState(defaultPreset);
  const [editingLabels, setEditingLabels] = useState(false);
  const [customLevels, setCustomLevels] = useState<RiskScaleLevel[]>([]);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const activePreset = initialPresets.find((p) => p.preset_name === selectedPreset);
  const basePreset = initialPresets.find((p) => p.preset_name === selectedPreset);

  function showToast(type: "success" | "error", msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  function handlePresetSelect(presetName: string) {
    setSelectedPreset(presetName);
    setEditingLabels(false);
    setCustomLevels([]);
  }

  function handleEditLabels() {
    const base = basePreset?.levels ?? [];
    setCustomLevels(base.map((l) => ({ ...l })));
    setEditingLabels(true);
  }

  function handleLabelChange(index: number, field: "label" | "color", value: string) {
    setCustomLevels((prev) =>
      prev.map((l, i) => (i === index ? { ...l, [field]: value } : l))
    );
  }

  function handleSave() {
    startTransition(async () => {
      const body: { preset_name: string; custom_levels?: Partial<RiskScaleLevel>[] } = {
        preset_name: selectedPreset,
      };

      if (editingLabels && customLevels.length > 0) {
        body.custom_levels = customLevels.map(({ value, label, color }) => ({
          value,
          label,
          color,
        }));
      }

      const result = await updateRiskScaleAction(body);

      if ("error" in result) {
        if ((result as any).error === "premium_required") {
          showToast("error", "Custom label configuration requires a premium plan.");
        } else {
          showToast("error", (result as any).message ?? "Failed to save. Please try again.");
        }
      } else {
        invalidateRiskScaleCache();
        showToast("success", "Risk rating scale saved.");
        setEditingLabels(false);
      }
    });
  }

  const levelPreviewColors: Record<string, string> = {
    low:      "rgba(34,197,94,0.15)",
    medium:   "rgba(245,158,11,0.15)",
    moderate: "rgba(245,158,11,0.15)",
    high:     "rgba(249,115,22,0.15)",
    very_high:"rgba(239,68,68,0.15)",
    critical: "rgba(239,68,68,0.15)",
  };

  return (
    <div>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed",
          top: "24px",
          right: "24px",
          background: toast.type === "success" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
          border: `1px solid ${toast.type === "success" ? "#22c55e" : "#ef4444"}`,
          color: toast.type === "success" ? "#86efac" : "#fca5a5",
          padding: "12px 20px",
          borderRadius: "10px",
          fontSize: "13px",
          fontWeight: 600,
          zIndex: 9999,
          boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
        }}>
          {toast.msg}
        </div>
      )}

      {/* Preset cards */}
      <div style={{ marginBottom: "32px" }}>
        <p style={{ fontSize: "13px", fontWeight: 600, color: "#94a3b8", margin: "0 0 12px" }}>
          Select a preset
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "12px" }}>
          {initialPresets.map((preset) => {
            const active = preset.preset_name === selectedPreset;
            return (
              <button
                key={preset.preset_name}
                onClick={() => handlePresetSelect(preset.preset_name)}
                style={{
                  background: active ? "rgba(0,196,180,0.08)" : "#0d1626",
                  border: `1px solid ${active ? "#00c4b4" : "#1e2d45"}`,
                  borderRadius: "10px",
                  padding: "14px 16px",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "border-color 0.15s",
                  outline: "none",
                }}
              >
                <p style={{ margin: "0 0 6px", fontSize: "13px", fontWeight: 700, color: active ? "#00c4b4" : "#f1f5f9" }}>
                  {preset.display_name}
                </p>
                <p style={{ margin: 0, fontSize: "11px", color: "#64748b" }}>
                  {preset.levels.length === 0
                    ? "Fully customized"
                    : `${preset.levels.length} levels`}
                </p>
                {/* Level chip preview */}
                {preset.levels.length > 0 && (
                  <div style={{ display: "flex", gap: "4px", marginTop: "8px", flexWrap: "wrap" }}>
                    {preset.levels.map((lv) => (
                      <span
                        key={lv.value}
                        style={{
                          fontSize: "9px",
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: levelPreviewColors[lv.value] ?? "rgba(148,163,184,0.12)",
                          color: lv.color,
                          letterSpacing: "0.02em",
                          textTransform: "uppercase",
                        }}
                      >
                        {lv.label}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Level preview for selected preset */}
      {activePreset && activePreset.levels.length > 0 && !editingLabels && (
        <div style={{
          background: "#0d1626",
          border: "1px solid #1e2d45",
          borderRadius: "10px",
          padding: "20px",
          marginBottom: "24px",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
            <p style={{ margin: 0, fontSize: "13px", fontWeight: 600, color: "#94a3b8" }}>
              Levels — {activePreset.display_name}
            </p>
            {isPremium ? (
              <button
                onClick={handleEditLabels}
                style={{
                  background: "transparent",
                  border: "1px solid #1e2d45",
                  borderRadius: "6px",
                  color: "#94a3b8",
                  fontSize: "12px",
                  fontWeight: 600,
                  padding: "4px 12px",
                  cursor: "pointer",
                }}
              >
                Edit Labels
              </button>
            ) : (
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                background: "rgba(245,158,11,0.1)",
                color: "#fcd34d",
                fontSize: "11px",
                fontWeight: 700,
                padding: "4px 10px",
                borderRadius: "20px",
              }}>
                Premium
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {activePreset.levels.map((lv) => (
              <span
                key={lv.value}
                style={{
                  padding: "5px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 700,
                  background: levelPreviewColors[lv.value] ?? "rgba(148,163,184,0.12)",
                  color: lv.color,
                  border: `1px solid ${lv.color}30`,
                  letterSpacing: "0.02em",
                }}
              >
                {lv.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Inline label editor (premium only) */}
      {editingLabels && customLevels.length > 0 && (
        <div style={{
          background: "#0d1626",
          border: "1px solid #1e2d45",
          borderRadius: "10px",
          padding: "20px",
          marginBottom: "24px",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
            <p style={{ margin: 0, fontSize: "13px", fontWeight: 600, color: "#94a3b8" }}>
              Edit Labels &amp; Colors
            </p>
            <button
              onClick={() => { setEditingLabels(false); setCustomLevels([]); }}
              style={{
                background: "transparent",
                border: "none",
                color: "#64748b",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {customLevels.map((lv, i) => (
              <div key={lv.value} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <span style={{
                  minWidth: "70px",
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#64748b",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}>
                  {lv.value}
                </span>
                <input
                  type="text"
                  value={lv.label}
                  onChange={(e) => handleLabelChange(i, "label", e.target.value)}
                  style={{
                    flex: 1,
                    background: "#0a0f1a",
                    border: "1px solid #1e2d45",
                    borderRadius: "6px",
                    color: "#f1f5f9",
                    padding: "7px 10px",
                    fontSize: "13px",
                    outline: "none",
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="color"
                    value={lv.color}
                    onChange={(e) => handleLabelChange(i, "color", e.target.value)}
                    style={{
                      width: "32px",
                      height: "28px",
                      borderRadius: "4px",
                      border: "1px solid #1e2d45",
                      background: "transparent",
                      cursor: "pointer",
                      padding: "2px",
                    }}
                  />
                  <input
                    type="text"
                    value={lv.color}
                    onChange={(e) => handleLabelChange(i, "color", e.target.value)}
                    style={{
                      width: "86px",
                      background: "#0a0f1a",
                      border: "1px solid #1e2d45",
                      borderRadius: "6px",
                      color: "#f1f5f9",
                      padding: "7px 10px",
                      fontSize: "12px",
                      fontFamily: "monospace",
                      outline: "none",
                    }}
                  />
                </div>
                <span style={{
                  padding: "4px 10px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 700,
                  background: "rgba(0,0,0,0.3)",
                  color: lv.color,
                  minWidth: "60px",
                  textAlign: "center",
                }}>
                  {lv.label || lv.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Save button */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
        <button
          onClick={handleSave}
          disabled={isPending}
          style={{
            background: isPending ? "rgba(0,196,180,0.5)" : "#00c4b4",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            padding: "10px 24px",
            fontSize: "14px",
            fontWeight: 700,
            cursor: isPending ? "not-allowed" : "pointer",
          }}
        >
          {isPending ? "Saving…" : "Save Scale"}
        </button>
        {!isPremium && (
          <p style={{ margin: 0, fontSize: "12px", color: "#64748b" }}>
            Preset selection is included on all plans. Custom label editing requires Premium.
          </p>
        )}
      </div>
    </div>
  );
}
