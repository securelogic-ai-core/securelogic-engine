"use client";

/**
 * RR-5 — Client-side Risk Policy form.
 *
 * One section: Review Cadence Policy. Four labeled rows (Critical /
 * High / Moderate / Low) each with a number input for days. Save calls
 * the /api/orgs/me/risk-settings PUT endpoint via putRiskSettings.
 *
 * Restore Defaults resets the form to DEFAULT_CADENCE_BY_RATING values
 * client-side. It does NOT auto-save — the user still has to hit Save
 * to persist (this lets them tweak defaults before committing).
 */

import { useState, useTransition } from "react";
import { putRiskSettings } from "@/lib/api";

const RATINGS = ["Critical", "High", "Moderate", "Low"] as const;
type Rating = typeof RATINGS[number];

const DEFAULT_CADENCE_BY_RATING: Record<Rating, number> = {
  Critical: 30, High: 60, Moderate: 90, Low: 180,
};

const RATING_DESCRIPTIONS: Record<Rating, string> = {
  Critical: "Highest-impact residual risks — review most often.",
  High:     "Material residual risks needing routine reassessment.",
  Moderate: "Significant but manageable residual risks.",
  Low:      "Lower-priority residual risks — review least often.",
};

const RATING_COLORS: Record<Rating, string> = {
  Critical: "#fca5a5",
  High:     "#fdba74",
  Moderate: "#fcd34d",
  Low:      "#86efac",
};

interface Props {
  initialCadence: Record<string, number>;
  isDefault: boolean;
}

export function RiskPolicyClient({ initialCadence, isDefault }: Props) {
  const [values, setValues] = useState<Record<Rating, string>>(() => ({
    Critical: String(initialCadence["Critical"] ?? DEFAULT_CADENCE_BY_RATING.Critical),
    High:     String(initialCadence["High"]     ?? DEFAULT_CADENCE_BY_RATING.High),
    Moderate: String(initialCadence["Moderate"] ?? DEFAULT_CADENCE_BY_RATING.Moderate),
    Low:      String(initialCadence["Low"]      ?? DEFAULT_CADENCE_BY_RATING.Low),
  }));
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [savedDefault, setSavedDefault] = useState(isDefault);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function showToast(type: "success" | "error", msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3500);
  }

  function handleChange(rating: Rating, raw: string) {
    setValues((prev) => ({ ...prev, [rating]: raw }));
    setHasUnsaved(true);
  }

  function handleRestoreDefaults() {
    setValues({
      Critical: String(DEFAULT_CADENCE_BY_RATING.Critical),
      High:     String(DEFAULT_CADENCE_BY_RATING.High),
      Moderate: String(DEFAULT_CADENCE_BY_RATING.Moderate),
      Low:      String(DEFAULT_CADENCE_BY_RATING.Low),
    });
    setHasUnsaved(true);
  }

  function handleSave() {
    // Validate the four values BEFORE hitting the engine — same rules as
    // src/api/lib/riskSettingsValidation.ts. Surface the first failure
    // as a toast; the engine would also catch this but the round-trip
    // adds latency and a less-readable error code.
    const parsed: Record<Rating, number> = {} as Record<Rating, number>;
    for (const r of RATINGS) {
      const n = Number(values[r].trim());
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        showToast("error", `${r} cadence must be a positive integer.`);
        return;
      }
      if (n > 3650) {
        showToast("error", `${r} cadence must be 3650 days or fewer.`);
        return;
      }
      parsed[r] = n;
    }

    startTransition(async () => {
      const result = await putRiskSettings(parsed);
      if (!result.ok) {
        showToast("error", `Failed to save policy: ${result.error}`);
        return;
      }
      setHasUnsaved(false);
      setSavedDefault(false);
      showToast("success", "Risk policy saved.");
    });
  }

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

      <section
        style={{
          background: "var(--color-brand-surface, #111827)",
          border: "1px solid #1e2d45",
          borderRadius: "12px",
          padding: "20px 24px",
          marginBottom: "24px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "4px", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#f1f5f9" }}>
            Review Cadence Policy
          </h2>
          {savedDefault && !hasUnsaved && (
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#94a3b8",
              background: "rgba(148,163,184,0.12)",
              padding: "2px 8px",
              borderRadius: 20,
            }}>
              Using documented defaults
            </span>
          )}
        </div>
        <p style={{ margin: "0 0 16px", fontSize: "12px", color: "#64748b" }}>
          Default review cadence (in days), keyed by residual rating. Per-risk overrides on
          the risk detail page take precedence over these org-level defaults.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {RATINGS.map((rating) => (
            <div
              key={rating}
              style={{
                display: "grid",
                gridTemplateColumns: "120px 1fr 110px",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  color: RATING_COLORS[rating],
                  background: `${RATING_COLORS[rating]}1f`,
                  padding: "4px 10px",
                  borderRadius: 6,
                  width: "fit-content",
                }}
              >
                {rating}
              </span>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>
                {RATING_DESCRIPTIONS[rating]}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  step={1}
                  value={values[rating]}
                  onChange={(e) => handleChange(rating, e.target.value)}
                  style={{
                    width: 76,
                    background: "#0a0f1a",
                    border: "1px solid #1e2d45",
                    borderRadius: 6,
                    color: "#f1f5f9",
                    padding: "6px 10px",
                    fontSize: 13,
                    outline: "none",
                  }}
                />
                <span style={{ fontSize: 12, color: "#64748b" }}>days</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={handleSave}
          disabled={isPending}
          style={{
            background: isPending ? "rgba(0,196,180,0.5)" : "#00c4b4",
            color: "#0a0f1a",
            border: "none",
            borderRadius: 8,
            padding: "10px 24px",
            fontSize: 14,
            fontWeight: 700,
            cursor: isPending ? "not-allowed" : "pointer",
          }}
        >
          {isPending ? "Saving…" : "Save"}
        </button>
        <button
          onClick={handleRestoreDefaults}
          disabled={isPending}
          style={{
            background: "transparent",
            border: "1px solid #1e2d45",
            color: "#94a3b8",
            borderRadius: 8,
            padding: "10px 18px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Restore Defaults
        </button>
        {hasUnsaved && (
          <span style={{ fontSize: 12, color: "#fcd34d" }}>
            Unsaved changes
          </span>
        )}
      </div>
    </div>
  );
}
