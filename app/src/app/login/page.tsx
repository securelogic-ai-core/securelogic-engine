"use client";

import { useState } from "react";
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

function LoginForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const redirect     = searchParams.get("redirect") ?? "/dashboard";

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

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

  return (
    <AuthCard
      title="Sign in"
      subtitle="Access your SecureLogic AI account."
    >
      <AuthError message={error} />

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
