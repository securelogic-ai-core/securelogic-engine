"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  AuthCard,
  AuthButton,
  AuthError,
  AuthSuccess,
  AuthLink,
} from "@/components/AuthCard";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router       = useRouter();

  const tokenParam = searchParams.get("token");
  const emailParam = searchParams.get("email") ?? "";

  const [loading,   setLoading]   = useState(!!tokenParam);
  const [resending, setResending] = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [resent,    setResent]    = useState(false);

  // Auto-verify immediately on page load when a token is present in the URL
  useEffect(() => {
    if (!tokenParam) return;

    async function autoVerify() {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/auth-verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenParam }),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string; onboardingCompleted?: boolean };

      if (!res.ok) {
        setError(
          data.error === "token_expired"
            ? "This verification link has expired. Request a new one below."
            : "Verification failed. The link may be invalid."
        );
        setLoading(false);
        return;
      }

      router.push(data.onboardingCompleted ? "/dashboard" : "/getting-started");
      router.refresh();
    }

    autoVerify();
  }, [tokenParam]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleResend() {
    if (!emailParam) return;
    setResending(true);

    await fetch("/api/auth-resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailParam }),
    });

    setResending(false);
    setResent(true);
  }

  // When a token is present: show verifying state or error
  if (tokenParam) {
    return (
      <AuthCard title={loading ? "Verifying your email…" : "Verification failed"}>
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              backgroundColor: "rgba(0,196,180,0.1)",
              border: "1px solid rgba(0,196,180,0.25)",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px",
              fontSize: "24px",
            }}
          >
            {loading ? "⏳" : "✉️"}
          </div>
          {loading && (
            <p style={{ margin: 0, fontSize: "14px", color: "#64748b" }}>
              Please wait while we verify your email address…
            </p>
          )}
        </div>

        <AuthError message={error} />

        {error && emailParam && (
          <>
            {resent && <AuthSuccess message="Verification email resent. Check your inbox." />}
            {!resent && (
              <AuthButton
                loading={resending}
                onClick={handleResend}
                type="button"
              >
                Resend Verification Email
              </AuthButton>
            )}
          </>
        )}

        <p
          style={{
            textAlign: "center",
            marginTop: "20px",
            fontSize: "14px",
            color: "#64748b",
          }}
        >
          <AuthLink href="/login">Sign in</AuthLink>
          {" · "}
          <AuthLink href="/signup">Create account</AuthLink>
        </p>
      </AuthCard>
    );
  }

  // No token: show "check your inbox" with resend option
  return (
    <AuthCard title="Check your inbox">
      <div
        style={{
          textAlign: "center",
          marginBottom: "28px",
        }}
      >
        <div
          style={{
            width: "56px",
            height: "56px",
            backgroundColor: "rgba(0,196,180,0.1)",
            border: "1px solid rgba(0,196,180,0.25)",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
            fontSize: "24px",
          }}
        >
          ✉️
        </div>

        <p style={{ margin: "0 0 8px", fontSize: "15px", color: "#f1f5f9" }}>
          We sent a verification email to
        </p>
        {emailParam && (
          <p
            style={{
              margin: "0 0 16px",
              fontSize: "15px",
              fontWeight: 600,
              color: "#00c4b4",
              wordBreak: "break-all",
            }}
          >
            {emailParam}
          </p>
        )}
        <p style={{ margin: 0, fontSize: "14px", color: "#64748b" }}>
          Click the link in the email to activate your account. The link
          expires in 24 hours.
        </p>
      </div>

      <AuthError message={error} />
      {resent && (
        <AuthSuccess message="Verification email resent. Check your inbox." />
      )}

      <AuthButton
        loading={resending}
        onClick={handleResend}
        type="button"
        variant={resent ? "secondary" : "primary"}
      >
        {resent ? "Email Sent" : "Resend Verification Email"}
      </AuthButton>

      <p
        style={{
          textAlign: "center",
          marginTop: "20px",
          fontSize: "14px",
          color: "#64748b",
        }}
      >
        Wrong email?{" "}
        <AuthLink href="/signup">Start over</AuthLink>
        {" · "}
        <AuthLink href="/login">Sign in</AuthLink>
      </p>
    </AuthCard>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}
