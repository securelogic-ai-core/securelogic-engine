"use client";

import PasswordInput from "./PasswordInput";

/**
 * AuthCard — dark navy card wrapper shared across all auth pages.
 * Logo + tagline at top, card in center, max-width 420px.
 */

const LOGO_URL = "https://api.securelogicai.com/assets/logo.png";

/** Shared inline style for AuthInput's underlying <input> (and its PasswordInput variant). */
const authInputStyle = {
  width: "100%",
  boxSizing: "border-box" as const,
  backgroundColor: "#060d18",
  border: "1px solid #1e2d45",
  borderRadius: "8px",
  padding: "12px 14px",
  fontSize: "15px",
  color: "#f1f5f9",
  outline: "none",
};

const styles = {
  page: {
    minHeight: "100vh",
    backgroundColor: "#0a0f1a",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: "24px 16px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  logoWrap: {
    marginBottom: "24px",
    textAlign: "center" as const,
  },
  tagline: {
    marginTop: "10px",
    fontSize: "13px",
    color: "#94a3b8",
    letterSpacing: "0.01em",
  },
  card: {
    width: "100%",
    maxWidth: "420px",
    backgroundColor: "#0d1b2e",
    border: "1px solid #1e2d45",
    borderRadius: "12px",
    padding: "36px 32px",
  },
};

export function AuthCard({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}) {
  return (
    <div style={styles.page}>
      <div style={styles.logoWrap}>
        <img
          src={LOGO_URL}
          alt="SecureLogic AI"
          height={36}
          style={{ display: "block", margin: "0 auto" }}
        />
        <p style={styles.tagline}>Cyber Risk Intelligence. Delivered Weekly.</p>
      </div>

      <div style={styles.card}>
        {title && (
          <div style={{ marginBottom: subtitle ? "8px" : "28px" }}>
            <h1
              style={{
                margin: 0,
                fontSize: "22px",
                fontWeight: 700,
                color: "#f1f5f9",
              }}
            >
              {title}
            </h1>
            {subtitle && (
              <p
                style={{
                  margin: "6px 0 0",
                  fontSize: "14px",
                  color: "#94a3b8",
                }}
              >
                {subtitle}
              </p>
            )}
          </div>
        )}
        {(title || subtitle) && <div style={{ marginBottom: "28px" }} />}
        {children}
      </div>
    </div>
  );
}

/* ─── Shared form primitives ────────────────────────────────────────────── */

export function AuthInput({
  id,
  label,
  type = "text",
  value,
  onChange,
  onBlur,
  placeholder,
  autoComplete,
  required = true,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <div style={{ marginBottom: "16px" }}>
      <label
        htmlFor={id}
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
        {label}
      </label>
      {type === "password" ? (
        <PasswordInput
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          style={authInputStyle}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "#00c4b4";
            e.currentTarget.style.boxShadow = "0 0 0 2px rgba(0,196,180,0.15)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "#1e2d45";
            e.currentTarget.style.boxShadow = "none";
            onBlur?.();
          }}
        />
      ) : (
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          style={authInputStyle}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "#00c4b4";
            e.currentTarget.style.boxShadow = "0 0 0 2px rgba(0,196,180,0.15)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "#1e2d45";
            e.currentTarget.style.boxShadow = "none";
            onBlur?.();
          }}
        />
      )}
    </div>
  );
}

export function AuthButton({
  children,
  loading = false,
  disabled = false,
  type = "submit",
  onClick,
  variant = "primary",
}: {
  children: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  type?: "submit" | "button";
  onClick?: () => void;
  variant?: "primary" | "secondary";
}) {
  const isPrimary = variant === "primary";
  const isBlocked = loading || disabled;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isBlocked}
      style={{
        width: "100%",
        padding: "13px",
        backgroundColor: isPrimary ? "#00c4b4" : "transparent",
        color: isPrimary ? "#0a0f1a" : "#94a3b8",
        border: isPrimary ? "none" : "1px solid #1e2d45",
        borderRadius: "8px",
        fontSize: "15px",
        fontWeight: 600,
        cursor: isBlocked ? "not-allowed" : "pointer",
        opacity: isBlocked ? 0.7 : 1,
        transition: "opacity 0.15s",
        fontFamily: "inherit",
      }}
    >
      {loading ? "Please wait…" : children}
    </button>
  );
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      style={{
        backgroundColor: "rgba(239,68,68,0.1)",
        border: "1px solid rgba(239,68,68,0.3)",
        borderRadius: "8px",
        padding: "12px 14px",
        marginBottom: "20px",
        fontSize: "14px",
        color: "#ef4444",
      }}
    >
      {message}
    </div>
  );
}

export function AuthSuccess({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      style={{
        backgroundColor: "rgba(34,197,94,0.1)",
        border: "1px solid rgba(34,197,94,0.3)",
        borderRadius: "8px",
        padding: "12px 14px",
        marginBottom: "20px",
        fontSize: "14px",
        color: "#22c55e",
      }}
    >
      {message}
    </div>
  );
}

export function AuthLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      style={{
        color: "#00c4b4",
        textDecoration: "none",
        fontWeight: 500,
      }}
      onMouseOver={(e) => (e.currentTarget.style.textDecoration = "underline")}
      onMouseOut={(e) => (e.currentTarget.style.textDecoration = "none")}
    >
      {children}
    </a>
  );
}

export function AuthDivider({ text }: { text: React.ReactNode }) {
  return (
    <p
      style={{
        textAlign: "center",
        marginTop: "24px",
        fontSize: "14px",
        color: "#64748b",
      }}
    >
      {text}
    </p>
  );
}
