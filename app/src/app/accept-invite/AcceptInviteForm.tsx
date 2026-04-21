"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  token: string;
  email: string;
  orgName: string;
  inviterName: string;
  role: string;
}

function roleLabelFor(role: string): string {
  switch (role) {
    case "admin":   return "Admin";
    case "analyst": return "Analyst";
    case "viewer":  return "Viewer";
    default:        return role.charAt(0).toUpperCase() + role.slice(1);
  }
}

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, { bg: string; color: string }> = {
    admin:   { bg: "rgba(139,92,246,0.15)",  color: "#c4b5fd" },
    analyst: { bg: "rgba(59,130,246,0.15)",  color: "#93c5fd" },
    viewer:  { bg: "rgba(148,163,184,0.15)", color: "#94a3b8" },
  };
  const s = styles[role] ?? styles.viewer!;
  return (
    <span
      style={{
        display: "inline-block",
        background: s.bg,
        color: s.color,
        fontSize: "12px",
        fontWeight: 600,
        padding: "3px 10px",
        borderRadius: "20px",
      }}
    >
      {roleLabelFor(role)}
    </span>
  );
}

export default function AcceptInviteForm({ token, email, orgName, inviterName, role }: Props) {
  const router = useRouter();

  const [name,            setName]            = useState("");
  const [password,        setPassword]        = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting,      setSubmitting]      = useState(false);
  const [error,           setError]           = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Please enter your full name.");
      return;
    }

    if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      setError("Must be 12+ characters with uppercase, lowercase, and a number.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);

    const res = await fetch("/api/accept-invite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, name: name.trim(), password }),
    });

    const data = (await res.json()) as { ok?: boolean; error?: string; detail?: string };

    if (!res.ok) {
      setError(
        data.error === "email_already_registered"
          ? (data.detail ?? "This email is already registered. Please log in instead.")
          : data.error === "invite_expired_or_invalid"
          ? "This invitation has expired or is no longer valid."
          : data.error === "password_too_short"
          ? "Password must be at least 12 characters."
          : data.error === "password_too_weak"
          ? "Password must include uppercase, lowercase, and a number."
          : data.detail ?? data.error ?? "Failed to accept invitation. Please try again."
      );
      setSubmitting(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    backgroundColor: "#060d18",
    border: "1px solid #1e2d45",
    borderRadius: "8px",
    padding: "12px 14px",
    fontSize: "15px",
    color: "#f1f5f9",
    outline: "none",
    fontFamily: "inherit",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "13px",
    fontWeight: 600,
    color: "#94a3b8",
    marginBottom: "6px",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#060d18",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
    >
      <div style={{ maxWidth: "440px", width: "100%" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <span
            style={{
              fontSize: "22px",
              fontWeight: 700,
              color: "#00c4b4",
              letterSpacing: "-0.5px",
            }}
          >
            SecureLogic AI
          </span>
        </div>

        <div
          style={{
            background: "#0d1b2e",
            border: "1px solid #1e2d45",
            borderRadius: "12px",
            padding: "40px",
          }}
        >
          <p
            style={{
              margin: "0 0 6px",
              fontSize: "22px",
              fontWeight: 700,
              color: "#f1f5f9",
            }}
          >
            Accept Invitation
          </p>
          <p style={{ margin: "0 0 6px", fontSize: "15px", color: "#94a3b8" }}>
            {inviterName} invited you to join{" "}
            <strong style={{ color: "#e2e8f0" }}>{orgName}</strong>.
          </p>
          <div style={{ marginBottom: "28px", display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "13px", color: "#64748b" }}>You&apos;ll join as</span>
            <RoleBadge role={role} />
          </div>

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
            {/* Email — read-only */}
            <div style={{ marginBottom: "20px" }}>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                value={email}
                readOnly
                style={{ ...inputStyle, color: "#64748b", cursor: "default" }}
              />
            </div>

            {/* Name */}
            <div style={{ marginBottom: "20px" }}>
              <label htmlFor="name" style={labelStyle}>
                Full Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
                required
                style={inputStyle}
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

            {/* Password */}
            <div style={{ marginBottom: "20px" }}>
              <label htmlFor="password" style={labelStyle}>
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="12+ characters"
                autoComplete="new-password"
                required
                style={inputStyle}
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

            {/* Confirm password */}
            <div style={{ marginBottom: "28px" }}>
              <label htmlFor="confirmPassword" style={labelStyle}>
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                autoComplete="new-password"
                required
                style={inputStyle}
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

            <button
              type="submit"
              disabled={submitting}
              style={{
                width: "100%",
                background: submitting ? "#0d9488" : "#00c4b4",
                color: "#0a0f1a",
                fontWeight: 700,
                fontSize: "15px",
                padding: "14px",
                borderRadius: "8px",
                border: "none",
                cursor: submitting ? "not-allowed" : "pointer",
                transition: "background 0.15s",
              }}
            >
              {submitting ? "Accepting…" : "Accept Invitation"}
            </button>
          </form>

          <div style={{ marginTop: "20px", textAlign: "center" }}>
            <a
              href="/login"
              style={{ fontSize: "13px", color: "#64748b", textDecoration: "none" }}
            >
              Already have an account?{" "}
              <span style={{ color: "#00c4b4" }}>Sign in</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
