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

type PaidTier = "professional" | "teams" | "platform" | "platform_annual";

function parsePlanParam(raw: string | null): PaidTier | null {
  if (
    raw === "professional" ||
    raw === "teams" ||
    raw === "platform" ||
    raw === "platform_annual"
  ) {
    return raw;
  }
  return null;
}

/**
 * Why no verification email arrived, as reported by signup.
 *
 * `unavailable` — no mail provider was configured, so nothing was attempted.
 * `failed`      — the provider was asked and refused or errored.
 *
 * The customer's position is the same in both cases and so is the copy; they
 * are kept apart because the operator's response differs, and because the value
 * rides through in the URL where a collapsed one would be unrecoverable.
 */
type UndeliveredMail = "unavailable" | "failed";

function parseMailParam(raw: string | null): UndeliveredMail | null {
  return raw === "unavailable" || raw === "failed" ? raw : null;
}

function planLabel(tier: PaidTier): string {
  switch (tier) {
    case "professional":    return "Brief Pro — $49/mo";
    case "teams":           return "Brief Team — $199/mo";
    case "platform":        return "Platform Professional — $800/mo";
    case "platform_annual": return "Platform Annual — $600/mo billed annually";
  }
}

function postToCheckout(tier: PaidTier): void {
  // Build a real form and submit it so the browser follows the 303 redirect
  // that /api/billing/checkout issues — fetch() would not give us a top-level
  // navigation to the Stripe-hosted checkout URL.
  const form = document.createElement("form");
  form.method = "POST";
  form.action = "/api/billing/checkout";
  const tierInput = document.createElement("input");
  tierInput.type  = "hidden";
  tierInput.name  = "tier";
  tierInput.value = tier;
  form.appendChild(tierInput);
  document.body.appendChild(form);
  form.submit();
}

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const router       = useRouter();

  const tokenParam = searchParams.get("token");
  const emailParam = searchParams.get("email") ?? "";
  const planParam  = parsePlanParam(searchParams.get("plan"));
  const mailParam  = parseMailParam(searchParams.get("mail"));

  const [loading,   setLoading]   = useState(!!tokenParam);
  const [resending, setResending] = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [resent,    setResent]    = useState(false);

  /**
   * Signup said no mail went out — until a resend actually gets one away, this
   * screen must not open on "Check your inbox". Cleared on a successful resend
   * attempt so the customer is not left staring at a stale outage after the
   * provider comes back.
   */
  const [undelivered, setUndelivered] = useState<UndeliveredMail | null>(mailParam);

  /** A resend ran while no mail provider was configured. Still nothing sent. */
  const [resendUnavailable, setResendUnavailable] = useState(false);

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

      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        onboardingCompleted?: boolean;
        pendingPlan?: PaidTier | null;
        entitlementLevel?: string;
      };

      if (!res.ok) {
        setError(
          data.error === "token_expired"
            ? "This verification link has expired. Request a new one below."
            : "Verification failed. The link may be invalid."
        );
        setLoading(false);
        return;
      }

      // If the user picked a paid plan at signup and the cookie is still
      // intact (same browser), go straight to Stripe checkout.
      if (
        data.pendingPlan === "professional" ||
        data.pendingPlan === "teams" ||
        data.pendingPlan === "platform" ||
        data.pendingPlan === "platform_annual"
      ) {
        postToCheckout(data.pendingPlan);
        return;
      }

      const isPlatform = data.entitlementLevel === "premium";
      router.push(
        data.onboardingCompleted || !isPlatform
          ? "/dashboard"
          : "/getting-started"
      );
      router.refresh();
    }

    autoVerify();
  }, [tokenParam]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleResend() {
    if (!emailParam) return;
    setResending(true);

    const res = await fetch("/api/auth-resend-verification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailParam }),
    });

    const data = (await res.json().catch(() => ({}))) as { verification_email?: string };
    const stillUnavailable = data.verification_email === "unavailable";

    setResending(false);
    setResendUnavailable(stillUnavailable);
    setResent(true);

    // A resend that reached a live provider is the most current thing we know,
    // so it supersedes whatever signup reported. One that found no provider
    // changes nothing — the outage is still on.
    if (!stillUnavailable) setUndelivered(null);
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
            {/* Same rule as the no-token screen: a returned request is not a
                delivered email, and an unconfigured provider is not a resend. */}
            {resent && resendUnavailable && (
              <AuthError message="Our email service is unavailable right now, so no new link was sent. Email hello@securelogicai.com and we'll verify your address for you." />
            )}
            {resent && !resendUnavailable && (
              <AuthSuccess message="New verification link requested. If it hasn't arrived in a few minutes, check your spam folder." />
            )}
            {(!resent || resendUnavailable) && (
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

  // No token. Two versions of this screen: the ordinary one, and the one for a
  // customer whose verification email demonstrably never left the building.
  return (
    <AuthCard title={undelivered ? "We couldn't send your verification email" : "Check your inbox"}>
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
            backgroundColor: undelivered ? "rgba(248,113,113,0.1)" : "rgba(0,196,180,0.1)",
            border: `1px solid ${undelivered ? "rgba(248,113,113,0.25)" : "rgba(0,196,180,0.25)"}`,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
            fontSize: "24px",
          }}
        >
          {undelivered ? "⚠️" : "✉️"}
        </div>

        <p style={{ margin: "0 0 8px", fontSize: "15px", color: "#f1f5f9" }}>
          {undelivered ? "Your account was created for" : "We sent a verification email to"}
        </p>
        {emailParam && (
          <p
            style={{
              margin: "0 0 16px",
              fontSize: "15px",
              fontWeight: 600,
              color: undelivered ? "#f87171" : "#00c4b4",
              wordBreak: "break-all",
            }}
          >
            {emailParam}
          </p>
        )}

        {undelivered ? (
          <>
            {/* Say the two things the customer cannot act without: the account
                is real and theirs, and they are locked out of it until an email
                they have not received is verified. */}
            <p style={{ margin: 0, fontSize: "14px", color: "#94a3b8" }}>
              Your account and organisation exist and nothing needs signing up for
              again — but the verification email did not go out, and you can&apos;t
              sign in until your address is verified.
            </p>
            <p style={{ margin: "12px 0 0", fontSize: "14px", color: "#64748b" }}>
              Try again below. If it still doesn&apos;t arrive, email{" "}
              <a href="mailto:hello@securelogicai.com" style={{ color: "#00c4b4" }}>
                hello@securelogicai.com
              </a>{" "}
              and we&apos;ll verify your address for you.
            </p>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: "14px", color: "#64748b" }}>
            Click the link in the email to activate your account. The link
            expires in 24 hours.
          </p>
        )}

        {planParam && !undelivered && (
          <p style={{ margin: "12px 0 0", fontSize: "14px", color: "#94a3b8" }}>
            After verifying, you&apos;ll continue to{" "}
            <strong style={{ color: "#f1f5f9" }}>{planLabel(planParam)}</strong> checkout.
          </p>
        )}
        {planParam && undelivered && (
          <p style={{ margin: "12px 0 0", fontSize: "14px", color: "#94a3b8" }}>
            You have not been charged. {planLabel(planParam)} checkout still
            waits for you once your address is verified.
          </p>
        )}
      </div>

      <AuthError message={error} />

      {/* "Email Sent" was asserted the moment the request came back, and the
          request comes back the same way whether or not any mail moved. The
          resend is deliberately unobserved per address — so the strongest true
          claim is that a new link was requested. */}
      {resent && resendUnavailable && (
        <AuthError message="Still no luck — our email service is unavailable right now. Email hello@securelogicai.com and we'll verify your address for you." />
      )}
      {resent && !resendUnavailable && (
        <AuthSuccess message="New verification link requested. If it hasn't arrived in a few minutes, check your spam folder." />
      )}

      <AuthButton
        loading={resending}
        onClick={handleResend}
        type="button"
        variant={resent && !resendUnavailable ? "secondary" : "primary"}
      >
        {resent && !resendUnavailable ? "Link Requested" : "Resend Verification Email"}
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
