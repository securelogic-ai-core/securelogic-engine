"use client";

import { useState, useEffect } from "react";
import { sendInvite } from "./actions";

interface Props {
  onClose: () => void;
  onSuccess: (email: string) => void;
}

type Role = "admin" | "analyst" | "viewer";

const ROLE_OPTIONS: Array<{ value: Role; label: string; description: string }> = [
  {
    value: "admin",
    label: "Admin",
    description: "Full access including team and billing management",
  },
  {
    value: "analyst",
    label: "Analyst",
    description: "Can manage all platform data but not team or billing",
  },
  {
    value: "viewer",
    label: "Viewer",
    description: "Read-only access to all platform data",
  },
];

export default function InviteModal({ onClose, onSuccess }: Props) {
  const [email,      setEmail]      = useState("");
  const [role,       setRole]       = useState<Role>("analyst");
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }

    setSubmitting(true);
    const result = await sendInvite(email.trim().toLowerCase(), role);
    setSubmitting(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    onSuccess(email.trim().toLowerCase());
  }

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(2px)",
          zIndex: 50,
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 51,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px",
        }}
      >
        <div
          style={{
            background: "#0d1b2e",
            border: "1px solid #1e2d45",
            borderRadius: "12px",
            padding: "32px",
            width: "100%",
            maxWidth: "460px",
          }}
        >
          <p style={{ margin: "0 0 24px", fontSize: "20px", fontWeight: 700, color: "#f1f5f9" }}>
            Invite Team Member
          </p>

          {error && (
            <div
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: "8px",
                padding: "12px 14px",
                marginBottom: "20px",
                fontSize: "14px",
                color: "#fca5a5",
              }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* Email */}
            <div style={{ marginBottom: "20px" }}>
              <label
                htmlFor="invite-email"
                style={{
                  display: "block",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#94a3b8",
                  marginBottom: "6px",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Email Address
              </label>
              <input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="colleague@company.com"
                required
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: "#060d18",
                  border: "1px solid #1e2d45",
                  borderRadius: "8px",
                  padding: "12px 14px",
                  fontSize: "15px",
                  color: "#f1f5f9",
                  outline: "none",
                  fontFamily: "inherit",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "#00c4b4";
                  e.currentTarget.style.boxShadow = "0 0 0 2px rgba(0,196,180,0.15)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "#1e2d45";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
            </div>

            {/* Role selector */}
            <div style={{ marginBottom: "28px" }}>
              <p
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "#94a3b8",
                  marginBottom: "10px",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Role
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {ROLE_OPTIONS.map((opt) => {
                  const selected = role === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setRole(opt.value)}
                      style={{
                        background: selected ? "rgba(0,196,180,0.05)" : "transparent",
                        border: `1px solid ${selected ? "#00c4b4" : "#1e293b"}`,
                        borderRadius: "8px",
                        padding: "12px",
                        cursor: "pointer",
                        textAlign: "left",
                        transition: "border-color 0.15s, background 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        if (!selected) e.currentTarget.style.borderColor = "#00c4b4";
                      }}
                      onMouseLeave={(e) => {
                        if (!selected) e.currentTarget.style.borderColor = "#1e293b";
                      }}
                    >
                      <p style={{ margin: "0 0 2px", fontSize: "14px", fontWeight: 600, color: "#f1f5f9" }}>
                        {opt.label}
                      </p>
                      <p style={{ margin: 0, fontSize: "13px", color: "#64748b" }}>
                        {opt.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  flex: 1,
                  background: submitting ? "#0d9488" : "#00c4b4",
                  color: "#0a0f1a",
                  fontWeight: 700,
                  fontSize: "14px",
                  padding: "12px",
                  borderRadius: "8px",
                  border: "none",
                  cursor: submitting ? "not-allowed" : "pointer",
                }}
              >
                {submitting ? "Sending…" : "Send Invitation"}
              </button>
              <button
                type="button"
                onClick={onClose}
                style={{
                  flex: 1,
                  background: "transparent",
                  color: "#94a3b8",
                  fontWeight: 600,
                  fontSize: "14px",
                  padding: "12px",
                  borderRadius: "8px",
                  border: "1px solid #1e2d45",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
