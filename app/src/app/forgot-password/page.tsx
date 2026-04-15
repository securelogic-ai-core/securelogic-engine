"use client";

import { useState } from "react";
import {
  AuthCard,
  AuthInput,
  AuthButton,
  AuthSuccess,
  AuthLink,
  AuthDivider,
} from "@/components/AuthCard";

export default function ForgotPasswordPage() {
  const [email,     setEmail]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    await fetch("/api/auth-forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });

    // Always show success — enumeration prevention
    setLoading(false);
    setSubmitted(true);
  }

  return (
    <AuthCard
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a reset link."
    >
      {submitted ? (
        <>
          <AuthSuccess message="If an account exists for that email, a password reset link has been sent." />
          <AuthDivider text={<AuthLink href="/login">Back to sign in</AuthLink>} />
        </>
      ) : (
        <>
          <form onSubmit={handleSubmit}>
            <AuthInput
              id="email"
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="you@company.com"
              autoComplete="email"
            />
            <AuthButton loading={loading}>Send Reset Link</AuthButton>
          </form>

          <AuthDivider
            text={
              <>
                Remember it? <AuthLink href="/login">Sign in</AuthLink>
              </>
            }
          />
        </>
      )}
    </AuthCard>
  );
}
