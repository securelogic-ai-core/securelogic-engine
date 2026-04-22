"use client";

import { useState } from "react";

interface Props {
  requireMfa: boolean;
  mfaCount: number;
  memberCount: number;
}

export default function SecuritySettingsClient({ requireMfa: initial, mfaCount, memberCount }: Props) {
  const [requireMfa, setRequireMfa] = useState(initial);
  const [pending,    setPending]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [saved,      setSaved]      = useState(false);

  async function handleToggle(next: boolean) {
    setRequireMfa(next);
    setError(null);
    setSaved(false);
    setPending(true);

    try {
      const res  = await fetch("/api/org-settings", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ require_mfa: next }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        setRequireMfa(!next);
        setError("Failed to save. Please try again.");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch {
      setRequireMfa(!next);
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      style={{
        background: "#0d1b2e",
        border: "1px solid #1e2d45",
        borderRadius: "12px",
        padding: "24px",
      }}
    >
      <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#f1f5f9", margin: "0 0 4px" }}>
        Authentication Policy
      </h2>
      <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 20px" }}>
        Require all team members to have two-factor authentication enabled before they can sign in.
      </p>

      {/* MFA coverage count */}
      <div
        style={{
          fontSize: "12px",
          fontWeight: 600,
          color: mfaCount === memberCount && memberCount > 0 ? "#34d399" : "#94a3b8",
          marginBottom: "20px",
        }}
      >
        {mfaCount} of {memberCount} member{memberCount !== 1 ? "s" : ""} have MFA enabled
      </div>

      {/* Toggle */}
      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "12px",
          cursor: pending ? "not-allowed" : "pointer",
          opacity: pending ? 0.7 : 1,
        }}
      >
        <input
          type="checkbox"
          checked={requireMfa}
          disabled={pending}
          onChange={(e) => { void handleToggle(e.target.checked); }}
          style={{ marginTop: "2px", accentColor: "#00c4b4", width: "16px", height: "16px" }}
        />
        <div>
          <span style={{ fontSize: "14px", fontWeight: 600, color: "#cbd5e1" }}>
            Require MFA for all members
          </span>
          <p style={{ fontSize: "12px", color: "#64748b", margin: "3px 0 0", lineHeight: "1.5" }}>
            Members without MFA will be blocked from signing in until they enrol.
          </p>
          {requireMfa && (
            <p
              style={{
                fontSize: "12px",
                color: "#fbbf24",
                margin: "8px 0 0",
                padding: "8px 12px",
                background: "rgba(251,191,36,0.08)",
                borderRadius: "6px",
                border: "1px solid rgba(251,191,36,0.2)",
                lineHeight: "1.5",
              }}
            >
              Warning: members without MFA enabled will be blocked from signing in until they enrol.
              {mfaCount < memberCount && (
                <> {memberCount - mfaCount} member{memberCount - mfaCount !== 1 ? "s are" : " is"} not yet enrolled.</>
              )}
            </p>
          )}
        </div>
      </label>

      {/* Feedback */}
      {error && (
        <p style={{ marginTop: "12px", fontSize: "13px", color: "#fca5a5" }}>{error}</p>
      )}
      {saved && (
        <p style={{ marginTop: "12px", fontSize: "13px", color: "#34d399" }}>Saved.</p>
      )}
    </div>
  );
}
