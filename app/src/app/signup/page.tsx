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

export default function SignupPage() {
  const router = useRouter();

  const [orgName,    setOrgName]    = useState("");
  const [name,       setName]       = useState("");
  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [promoCode,  setPromoCode]  = useState("");
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  function clientValidatePassword(pw: string): string | null {
    if (pw.length < 12) return "Must be 12+ characters with uppercase, lowercase, and a number";
    if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw))
      return "Must be 12+ characters with uppercase, lowercase, and a number";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const pwErr = clientValidatePassword(password);
    if (pwErr) { setError(pwErr); return; }

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

    router.push(`/verify-email?email=${encodeURIComponent(email.trim())}`);
  }

  return (
    <AuthCard
      title="Create your account"
      subtitle="Start monitoring cyber risk for your organisation."
    >
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

        <AuthButton loading={loading}>Create Account</AuthButton>
      </form>

      <AuthDivider text={<>Already have an account? <AuthLink href="/login">Sign in</AuthLink></>} />
    </AuthCard>
  );
}
