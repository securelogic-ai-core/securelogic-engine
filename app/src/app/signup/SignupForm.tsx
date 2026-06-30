"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AuthCard,
  AuthInput,
  AuthButton,
  AuthError,
  AuthLink,
  AuthDivider,
} from "@/components/AuthCard";
import ConsentCheckbox from "@/components/ConsentCheckbox";
import { validatePasswordStrength, validatePasswordsMatch } from "./signupValidation";

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

function planLabel(tier: PaidTier): string {
  switch (tier) {
    case "professional":    return "Brief Pro — $49/mo";
    case "teams":           return "Team Professional — $199/mo";
    case "platform":        return "Platform Professional — $800/mo";
    case "platform_annual": return "Platform Annual — $600/mo billed annually";
  }
}

interface Props {
  plan: string | null;
}

export function SignupForm({ plan: rawPlan }: Props) {
  const router = useRouter();
  const plan   = parsePlanParam(rawPlan);

  const [orgName,    setOrgName]    = useState("");
  const [name,       setName]       = useState("");
  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [confirm,    setConfirm]    = useState("");
  const [promoCode,  setPromoCode]  = useState("");
  const [accepted,   setAccepted]   = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const pwErr = validatePasswordStrength(password);
    if (pwErr) { setError(pwErr); return; }

    const matchErr = validatePasswordsMatch(password, confirm);
    if (matchErr) { setError(matchErr); return; }

    if (!accepted) {
      setError("Please accept the Terms of Service, Privacy Policy, and AI Transparency & Responsible Use Policy to continue.");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/auth-signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationName: orgName.trim(),
        name: name.trim(),
        email: email.trim(),
        password,
        promoCode: promoCode.trim() || undefined,
        plan: plan ?? undefined,
        acceptedTerms: true,
      }),
    });

    const data = (await res.json()) as { ok?: boolean; error?: string; detail?: string };

    if (!res.ok) {
      setError(
        data.error === "email_already_registered"
          ? "An account with this email already exists. Try signing in."
          : data.error === "password_too_short"
          ? "Password must be at least 12 characters."
          : data.error === "password_too_weak"
          ? "Password must include uppercase, lowercase, and a number."
          : data.detail ?? data.error ?? "Signup failed. Please try again."
      );
      setLoading(false);
      return;
    }

    // The plan param is duplicated on the URL so the "check your inbox" screen
    // can show plan-aware copy even if the cookie is dropped (e.g. after a
    // browser restart). The actual checkout decision is still cookie-driven.
    const target = new URL("/verify-email", window.location.origin);
    target.searchParams.set("email", email.trim());
    if (plan) target.searchParams.set("plan", plan);
    router.push(target.pathname + target.search);
  }

  const title    = plan ? "Create your account to continue" : "Create your account";
  const subtitle = plan
    ? `You're one step from ${planLabel(plan)} access.`
    : "Start monitoring cyber risk for your organisation.";

  return (
    <AuthCard title={title} subtitle={subtitle}>
      <AuthError message={error} />

      <form onSubmit={handleSubmit}>
        <AuthInput
          id="orgName"
          label="Company Name"
          value={orgName}
          onChange={setOrgName}
          placeholder="Acme Corp"
          autoComplete="organization"
        />
        <AuthInput
          id="name"
          label="Your Full Name"
          value={name}
          onChange={setName}
          placeholder="Jane Smith"
          autoComplete="name"
        />
        <AuthInput
          id="email"
          label="Work Email"
          type="email"
          value={email}
          onChange={setEmail}
          placeholder="jane@acme.com"
          autoComplete="email"
        />
        <AuthInput
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          placeholder="12+ characters"
          autoComplete="new-password"
        />
        <AuthInput
          id="confirm"
          label="Confirm Password"
          type="password"
          value={confirm}
          onChange={setConfirm}
          placeholder="Repeat your password"
          autoComplete="new-password"
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            margin: "0 0 20px",
          }}
          aria-live="polite"
        >
          {[
            { ok: password.length >= 12,                                    label: "At least 12 characters" },
            { ok: /[a-z]/.test(password) && /[A-Z]/.test(password),         label: "Uppercase and lowercase letters" },
            { ok: /[0-9]/.test(password),                                   label: "At least one number" },
          ].map((req) => (
            <div
              key={req.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "13px",
                color: req.ok ? "#10b981" : "#64748b",
              }}
            >
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  backgroundColor: req.ok ? "#10b981" : "#1e2d45",
                  flexShrink: 0,
                }}
              />
              {req.label}
            </div>
          ))}
        </div>

        {/* Promo code — collapsible feel */}
        <div style={{ marginBottom: "24px" }}>
          <label
            htmlFor="promoCode"
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
            Promo Code{" "}
            <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
              (optional)
            </span>
          </label>
          <input
            id="promoCode"
            type="text"
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value)}
            placeholder="e.g. FOUNDER50"
            autoComplete="off"
            style={{
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

        <ConsentCheckbox checked={accepted} onChange={setAccepted} />

        <AuthButton loading={loading} disabled={!accepted}>
          {plan ? `Continue to ${planLabel(plan)}` : "Create Account"}
        </AuthButton>
      </form>

      <AuthDivider text={<>Already have an account? <AuthLink href="/login">Sign in</AuthLink></>} />
    </AuthCard>
  );
}
