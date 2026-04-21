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
  };
  if (labels[eventType]) return labels[eventType];
  return eventType
    .replace(/\./g, " ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function eventBadgeStyle(eventType: string): React.CSSProperties {
  const prefix = eventType.split(".")[0] ?? "";
  if (prefix === "auth")
    return { background: "rgba(59,130,246,0.15)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.25)" };
  if (prefix === "data")
    return { background: "rgba(139,92,246,0.15)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.25)" };
  if (prefix === "user")
    return { background: "rgba(0,196,180,0.12)", color: "#5eead4", border: "1px solid rgba(0,196,180,0.25)" };
  return { background: "rgba(148,163,184,0.12)", color: "#94a3b8", border: "1px solid rgba(148,163,184,0.2)" };
}
