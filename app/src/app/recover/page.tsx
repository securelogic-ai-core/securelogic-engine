"use client";

import { useState } from "react";
import Link from "next/link";

type Phase = "form" | "loading" | "sent" | "error";

export default function RecoverPage() {
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("form");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPhase("loading");

    try {
      await fetch("/api/account/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      // Always show "sent" — never reveal whether email is registered
      setPhase("sent");
    } catch {
      setPhase("error");
    }
  }

  if (phase === "sent") {
    return (
      <div className="max-w-lg mx-auto px-6 py-16">
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
          <div className="w-12 h-12 bg-teal-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">Check your email</h1>
          <p className="text-slate-600 text-sm mb-6">
            If an account exists for <strong>{email}</strong>, we sent a sign-in
            link. Check your inbox — the link expires in 15 minutes.
          </p>
          <Link
            href="/login"
            className="text-teal-600 hover:text-teal-700 text-sm font-medium transition-colors"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-6 py-16">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Recover access</h1>
        <p className="text-slate-600 text-sm">
          Enter the email address you registered with. We&apos;ll send you a
          sign-in link valid for 15 minutes.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-8">
        {phase === "error" && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-6">
            Something went wrong. Please try again.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Work email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>

          <button
            type="submit"
            disabled={phase === "loading"}
            className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors"
          >
            {phase === "loading" ? "Sending…" : "Send sign-in link"}
          </button>
        </form>

        <p className="text-center text-slate-500 text-sm mt-6">
          Remember your key?{" "}
          <Link href="/login" className="text-teal-600 hover:text-teal-700 font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
