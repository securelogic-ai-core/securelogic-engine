"use client";

import { useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import {
  AuthCard,
  AuthInput,
  AuthButton,
  AuthError,
  AuthLink,
  AuthDivider,
} from "@/components/AuthCard";

const ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL ?? "https://securelogic-engine.onrender.com";

interface SsoDomainResult {
  hasSso: boolean;
  isEnforced: boolean;
  organizationId: string | null;
}

function LoginForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const redirect     = searchParams.get("redirect") ?? "/dashboard";

  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [ssoConfig,    setSsoConfig]    = useState<SsoDomainResult | null>(null);
  const [checkingSSO,  setCheckingSSO]  = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // MFA challenge state
  const [mfaRequired,   setMfaRequired]   = useState(false);
  const [mfaToken,      setMfaToken]      = useState("");
  const [mfaCode,       setMfaCode]       = useState("");
  const [useBackupMode, setUseBackupMode] = useState(false);
  const [backupCode,    setBackupCode]    = useState("");

  const checkSSOForEmail = useCallback(async (emailValue: string) => {
    const trimmed = emailValue.trim();
    if (!trimmed.includes("@")) return;

    setCheckingSSO(true);
    try {
      const res = await fetch(
        `${ENGINE_URL}/api/sso/check-domain?email=${encodeURIComponent(trimmed)}`,
        { cache: "no-store" }
      );
      if (!res.ok) { setSsoConfig(null); return; }
      const data = (await res.json()) as SsoDomainResult;
      setSsoConfig(data);
    } catch {
      setSsoConfig(null);
    } finally {
      setCheckingSSO(false);
    }
  }, []);

  function handleEmailBlur() {
    if (email.trim()) checkSSOForEmail(email);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/auth-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    });

    const data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      mfa_required?: boolean;
      mfa_token?: string;
    };

    if (!res.ok) {
      if (data.error === "email_not_verified") {
        router.push(`/verify-email?email=${encodeURIComponent(email.trim())}`);
        return;
      }
      setError(
        data.error === "invalid_credentials"
          ? "Invalid email or password."
          : "Sign in failed. Please try again."
      );
      setLoading(false);
      return;
    }

    // MFA required — show the TOTP step
    if (data.mfa_required && data.mfa_token) {
      setMfaToken(data.mfa_token);
      setMfaRequired(true);
      setLoading(false);
      return;
    }

    router.push(redirect);
    router.refresh();
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const endpoint = useBackupMode ? "/api/mfa/use-backup" : "/api/mfa/verify";
    const body     = useBackupMode
      ? { backup_code: backupCode.trim(), mfa_token: mfaToken }
      : { code: mfaCode.trim(), mfa_token: mfaToken };

    const res  = await fetch(endpoint, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body)
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };

    if (!res.ok || !data.ok) {
      setError(
        data.error === "invalid_code"        ? "Incorrect code. Try again." :
        data.error === "invalid_backup_code" ? "Backup code not recognised." :
        data.error === "too_many_attempts"   ? "Too many attempts. Try again in 5 minutes." :
        "Verification failed. Please try again."
      );
      setLoading(false);
      return;
    }

    router.push(redirect);
    router.refresh();
  }

  const hasSso      = ssoConfig?.hasSso === true;
  const isEnforced  = ssoConfig?.isEnforced === true;
  const ssoLoginUrl = hasSso && ssoConfig?.organizationId
    ? `${ENGINE_URL}/api/sso/${ssoConfig.organizationId}/login`
    : null;

  const showPasswordForm = !hasSso || showPassword;

  // MFA verification step
  if (mfaRequired) {
    return (
      <AuthCard
        title="Two-factor verification"
        subtitle="Enter the code from your authenticator app."
      >
        <AuthError message={error} />

        {!useBackupMode ? (
          <form onSubmit={(e) => { void handleMfaSubmit(e); }}>
            <AuthInput
              id="mfa-code"
              label="Authenticator code"
              type="text"
              value={mfaCode}
              onChange={(v) => { setMfaCode(v); setError(null); }}
              placeholder="000000"
              autoComplete="one-time-code"
            />
            <div style={{ textAlign: "right", marginBottom: "24px", marginTop: "-8px" }}>
              <button
                type="button"
                onClick={() => { setUseBackupMode(true); setError(null); }}
                style={{
                  background:     "none",
                  border:         "none",
                  color:          "#64748b",
                  fontSize:       "13px",
                  cursor:         "pointer",
                  textDecoration: "underline"
                }}
              >
                Use a backup code instead
              </button>
            </div>
            <AuthButton loading={loading}>Verify</AuthButton>
          </form>
        ) : (
          <form onSubmit={(e) => { void handleMfaSubmit(e); }}>
            <AuthInput
              id="backup-code"
              label="Backup code"
              type="text"
              value={backupCode}
              onChange={(v) => { setBackupCode(v); setError(null); }}
              placeholder="e.g. 3f9a2c1d7b"
              autoComplete="off"
            />
            <div style={{ textAlign: "right", marginBottom: "24px", marginTop: "-8px" }}>
              <button
                type="button"
                onClick={() => { setUseBackupMode(false); setError(null); }}
                style={{
                  background:     "none",
                  border:         "none",
                  color:          "#64748b",
                  fontSize:       "13px",
                  cursor:         "pointer",
                  textDecoration: "underline"
                }}
              >
                ← Use authenticator code instead
              </button>
            </div>
            <AuthButton loading={loading}>Use backup code</AuthButton>
          </form>
        )}
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Sign in"
      subtitle="Access your SecureLogic AI account."
    >
      <AuthError message={error} />

      {/* Email field — always visible */}
      <AuthInput
        id="email"
        label="Email"
        type="email"
        value={email}
        onChange={(v) => { setEmail(v); setSsoConfig(null); setShowPassword(false); }}
        onBlur={handleEmailBlur}
        placeholder="you@company.com"
        autoComplete="email"
      />

      {/* SSO button — shown when domain has SSO */}
      {hasSso && ssoLoginUrl && (
        <div style={{ marginBottom: "16px" }}>
          <a
            href={ssoLoginUrl}
            style={{
              display: "block",
              width: "100%",
              padding: "11px 20px",
              textAlign: "center",
              background: "#00c4b4",
              color: "#ffffff",
              fontWeight: 600,
              fontSize: "15px",
              borderRadius: "8px",
              textDecoration: "none",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#009e91"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#00c4b4"; }}
          >
            {checkingSSO ? "Checking…" : "Sign in with SSO"}
          </a>

          {!isEnforced && (
            <div style={{ marginTop: "10px", textAlign: "center" }}>
              <button
                type="button"
                onClick={() => setShowPassword(true)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#64748b",
                  fontSize: "13px",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                ← Use password instead
              </button>
            </div>
          )}
        </div>
      )}

      {/* Password form — shown when no SSO, or SSO not enforced and user wants password */}
      {showPasswordForm && (
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "4px" }}>
            <AuthInput
              id="password"
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder="Your password"
              autoComplete="current-password"
            />
          </div>
          <div style={{ textAlign: "right", marginBottom: "24px", marginTop: "-8px" }}>
            <AuthLink href="/forgot-password">Forgot password?</AuthLink>
          </div>

          <AuthButton loading={loading}>Sign In</AuthButton>
        </form>
      )}

      <AuthDivider
        text={
          <>
            Don&apos;t have an account?{" "}
            <AuthLink href="/signup">Sign up</AuthLink>
          </>
        }
      />
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
