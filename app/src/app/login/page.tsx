"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") ?? "/dashboard";

  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: apiKey.trim() }),
    });

    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error === "invalid_api_key"
        ? "API key not recognised. Please check and try again."
        : "Sign in failed. Please try again."
      );
      setLoading(false);
      return;
    }

    router.push(redirect);
    router.refresh();
  }

  return (
    <div className="max-w-lg mx-auto px-6 py-16">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Sign in</h1>
        <p className="text-slate-600">
          Enter your API key to access your Intelligence Brief.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="apiKey"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              API Key
            </label>
            <input
              id="apiKey"
              type="password"
              autoComplete="current-password"
              required
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sl_••••••••••••••••••••••••••••••••"
              className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
            <p className="text-xs text-slate-500 mt-1.5">
              Your API key starts with <code className="font-mono">sl_</code>.
              It was shown once when you registered.
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors"
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div className="mt-6 space-y-3 text-center">
          <p className="text-slate-500 text-sm">
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="text-teal-600 hover:text-teal-700 font-medium"
            >
              Get started free
            </Link>
          </p>
          <p className="text-slate-400 text-sm">
            Lost your API key?{" "}
            <Link
              href="/recover"
              className="text-teal-600 hover:text-teal-700 font-medium"
            >
              Send a sign-in link
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
