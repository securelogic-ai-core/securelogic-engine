"use client";

import { useState } from "react";

type Scale = "Small" | "Medium" | "Enterprise";

interface Props {
  name: string;
  regulated: boolean;
  handlesPii: boolean;
  safetyCritical: boolean;
  scale: Scale;
}

const CARD: React.CSSProperties = {
  background: "#0d1b2e",
  border: "1px solid #1e2d45",
  borderRadius: "12px",
  padding: "24px",
  marginBottom: "16px",
};

const LABEL: React.CSSProperties = {
  fontSize: "13px",
  fontWeight: 600,
  color: "#cbd5e1",
  display: "block",
  marginBottom: "6px",
};

const HINT: React.CSSProperties = {
  fontSize: "12px",
  color: "#64748b",
  margin: "4px 0 0",
  lineHeight: 1.5,
};

function Toggle({
  checked,
  onChange,
  disabled,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
  label: string;
  hint: string;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        padding: "10px 0",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, marginTop: 2 }}
      />
      <span>
        <span style={{ fontSize: 14, color: "#e5e7eb", fontWeight: 500 }}>{label}</span>
        <p style={HINT}>{hint}</p>
      </span>
    </label>
  );
}

export default function OrganizationSettingsClient(initial: Props) {
  const [name, setName] = useState(initial.name);
  const [regulated, setRegulated] = useState(initial.regulated);
  const [handlesPii, setHandlesPii] = useState(initial.handlesPii);
  const [safetyCritical, setSafetyCritical] = useState(initial.safetyCritical);
  const [scale, setScale] = useState<Scale>(initial.scale);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    name.trim() !== initial.name ||
    regulated !== initial.regulated ||
    handlesPii !== initial.handlesPii ||
    safetyCritical !== initial.safetyCritical ||
    scale !== initial.scale;

  const nameInvalid = name.trim().length === 0;

  async function handleSave() {
    if (!dirty || nameInvalid) return;
    setPending(true);
    setError(null);
    setSaved(false);

    try {
      const res = await fetch("/api/org-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          regulated,
          handles_pii: handlesPii,
          safety_critical: safetyCritical,
          scale,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; detail?: string };

      if (!res.ok || !data.ok) {
        setError(data.detail ?? "Failed to save. Please try again.");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div style={CARD}>
        <label style={LABEL} htmlFor="org-name">
          Organization name
        </label>
        <input
          id="org-name"
          type="text"
          value={name}
          maxLength={200}
          disabled={pending}
          onChange={(e) => setName(e.target.value)}
          style={{
            width: "100%",
            background: "#0a1526",
            border: `1px solid ${nameInvalid ? "#b91c1c" : "#1e2d45"}`,
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 14,
            color: "#f1f5f9",
          }}
        />
        <p style={HINT}>
          Shown on team invitations, executive reports, and Intelligence Briefs.
        </p>
        {nameInvalid && (
          <p style={{ ...HINT, color: "#f87171" }}>Organization name cannot be empty.</p>
        )}
      </div>

      <div style={CARD}>
        <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#f1f5f9", margin: "0 0 4px" }}>
          Risk context
        </h2>
        <p style={{ ...HINT, marginBottom: 8 }}>
          These calibrate risk scoring for your environment — a regulated,
          PII-handling, or safety-critical organization sees the same exposure
          scored higher.
        </p>

        <Toggle
          checked={regulated}
          onChange={setRegulated}
          disabled={pending}
          label="Regulated industry"
          hint="Subject to sector regulation (finance, healthcare, energy, government…)."
        />
        <Toggle
          checked={handlesPii}
          onChange={setHandlesPii}
          disabled={pending}
          label="Handles personal data (PII)"
          hint="Stores or processes personal data at meaningful scale."
        />
        <Toggle
          checked={safetyCritical}
          onChange={setSafetyCritical}
          disabled={pending}
          label="Safety-critical operations"
          hint="Failures could impact physical safety or critical services."
        />

        <div style={{ marginTop: 12 }}>
          <label style={LABEL} htmlFor="org-scale">
            Organization scale
          </label>
          <select
            id="org-scale"
            value={scale}
            disabled={pending}
            onChange={(e) => setScale(e.target.value as Scale)}
            style={{
              background: "#0a1526",
              border: "1px solid #1e2d45",
              borderRadius: 8,
              padding: "9px 12px",
              fontSize: 14,
              color: "#f1f5f9",
            }}
          >
            <option value="Small">Small</option>
            <option value="Medium">Medium</option>
            <option value="Enterprise">Enterprise</option>
          </select>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !dirty || nameInvalid}
          style={{
            background: pending || !dirty || nameInvalid ? "#1e2d45" : "#2563eb",
            color: pending || !dirty || nameInvalid ? "#64748b" : "#fff",
            border: "none",
            borderRadius: 8,
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 600,
            cursor: pending || !dirty || nameInvalid ? "default" : "pointer",
          }}
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        {saved && <span style={{ color: "#34d399", fontSize: 13 }}>Saved.</span>}
        {error && <span style={{ color: "#f87171", fontSize: 13 }}>{error}</span>}
      </div>
    </>
  );
}
