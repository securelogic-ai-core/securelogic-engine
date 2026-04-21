"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  AuthCard,
  AuthInput,
  AuthButton,
  AuthError,
  AuthSuccess,
  AuthLink,
  AuthDivider,
} from "@/components/AuthCard";

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const token        = searchParams.get("token") ?? "";

  const [password,   setPassword]   = useState("");
  const [confirm,    setConfirm]    = useState("");
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [success,    setSuccess]    = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      setError("Must be 12+ characters with uppercase, lowercase, and a number.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!token) {
      setError("Invalid or missing reset token.");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/auth-reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });

    const data = (await res.json()) as { ok?: boolean; error?: string };

    if (!res.ok) {
      setError(
        data.error === "token_expired"
          ? "This reset link has expired. Please request a new one."
          : data.error === "token_not_found_or_expired"
          ? "Invalid reset link. Please request a new one."
          : data.error === "password_too_short"
          ? "Password must be at least 12 characters."
          : data.error === "password_too_weak"
          ? "Password must include uppercase, lowercase, and a number."
          : data.error === "password_recently_used"
          ? "This password was used recently. Please choose a different one."
          : "Password reset failed. Please try again."
      );
      setLoading(false);
      return;
    }

    setSuccess(true);
    setTimeout(() => router.push("/login"), 2500);
  }

  return (
    <AuthCard
      title="Set a new password"
      subtitle="Choose a password you haven't used before."
    >
      {success ? (
        <>
          <AuthSuccess message="Password updated successfully. Redirecting to sign in…" />
        </>
      ) : (
        <>
          <AuthError message={error} />
          <form onSubmit={handleSubmit}>
            <AuthInput
              id="password"
              label="New Password"
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
              placeholder="Repeat your new password"
              autoComplete="new-password"
            />
            <AuthButton loading={loading}>Reset Password</AuthButton>
          </form>

          <AuthDivider
            text={
              <>
                Remembered it? <AuthLink href="/login">Sign in</AuthLink>
              </>
            }
          />
        </>
      )}
    </AuthCard>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
