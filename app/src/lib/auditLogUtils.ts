/**
 * Shared formatting helpers for security_audit_log events.
 *
 * Lives under app/src/lib/ so both the global account-level audit log
 * page and the per-entity history sections (RR-3) can reuse the same
 * label whitelist and color palette.
 *
 * Color semantics:
 *   green = create
 *   blue  = update / transition
 *   red   = delete / failure
 *   gray  = neutral / closed
 */

export function formatEventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    "auth.login":            "Login",
    "auth.login_failed":     "Login Failed",
    "auth.logout":           "Logout",
    "auth.signup":           "Signup",
    "auth.email_verified":   "Email Verified",
    "auth.mfa_enabled":      "MFA Enabled",
    "auth.mfa_disabled":     "MFA Disabled",
    "auth.mfa_admin_reset":  "MFA Reset (Admin)",
    "auth.password_changed": "Password Changed",
    "auth.password_reset":   "Password Reset",
    "auth.invalid_api_key":  "Invalid API Key",
    "data.exported":         "Data Exported",
    "user.created":          "User Created",
    "user.updated":          "User Updated",
    "user.deleted":          "User Deleted",

    // Risk register events (RR-3)
    "risk.created":                "Risk created",
    "risk.updated":                "Risk updated",
    "risk.terminal_status":        "Risk closed",
    "risk_treatment.created":      "Treatment added",
    "workflow.status_transition":  "Treatment status changed",
  };
  if (labels[eventType]) return labels[eventType];
  return eventType
    .replace(/\./g, " ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const STYLE_GREEN = { background: "rgba(34,197,94,0.12)", color: "#86efac", border: "1px solid rgba(34,197,94,0.25)" } as const;
const STYLE_BLUE  = { background: "rgba(59,130,246,0.15)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.25)" } as const;
const STYLE_RED   = { background: "rgba(239,68,68,0.15)",  color: "#fca5a5", border: "1px solid rgba(239,68,68,0.25)" } as const;
const STYLE_GRAY  = { background: "rgba(148,163,184,0.12)", color: "#94a3b8", border: "1px solid rgba(148,163,184,0.2)" } as const;
const STYLE_PURPLE = { background: "rgba(139,92,246,0.15)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.25)" } as const;
const STYLE_TEAL   = { background: "rgba(0,196,180,0.12)",  color: "#5eead4", border: "1px solid rgba(0,196,180,0.25)" } as const;

export function eventBadgeStyle(eventType: string): React.CSSProperties {
  // Specific overrides — risk-register events follow the create/update/
  // terminal color convention rather than the per-domain default.
  switch (eventType) {
    case "risk.created":
    case "risk_treatment.created":
      return STYLE_GREEN;
    case "risk.updated":
    case "workflow.status_transition":
      return STYLE_BLUE;
    case "risk.terminal_status":
      return STYLE_GRAY;
  }

  // Suffix-based fallback — picks up future *.created / *.deleted /
  // *.failed events without needing an explicit case here.
  if (eventType.endsWith(".created"))                 return STYLE_GREEN;
  if (eventType.endsWith(".deleted"))                 return STYLE_RED;
  if (eventType.endsWith(".failed") || eventType.endsWith(".error")) return STYLE_RED;

  // Domain-prefix fallback (preserves the original behavior).
  const prefix = eventType.split(".")[0] ?? "";
  if (prefix === "auth") return STYLE_BLUE;
  if (prefix === "data") return STYLE_PURPLE;
  if (prefix === "user") return STYLE_TEAL;
  return STYLE_GRAY;
}
