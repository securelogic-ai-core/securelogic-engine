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

  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [ssoConfig,   setSsoConfig]   = useState<SsoDomainResult | null>(null);
  const [checkingSSO, setCheckingSSO] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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

    const data = (await res.json()) as { ok?: boolean; error?: string };

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

    router.push(redirect);
    router.refresh();
  }

  const hasSso      = ssoConfig?.hasSso === true;
  const isEnforced  = ssoConfig?.isEnforced === true;
  const ssoLoginUrl = hasSso && ssoConfig?.organizationId
    ? `${ENGINE_URL}/api/sso/${ssoConfig.organizationId}/login`
    : null;

  const showPasswordForm = !hasSso || showPassword;

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
