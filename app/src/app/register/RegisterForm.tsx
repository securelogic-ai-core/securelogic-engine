"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type PaidTier = "professional" | "team";

type State =
  | { phase: "form" }
  | { phase: "loading" }
  | { phase: "success"; apiKey: string }
  | { phase: "error"; message: string };

function parsePlanParam(raw: string | null): PaidTier | null {
  if (raw === "professional" || raw === "team") return raw;
  return null;
}

function planLabel(tier: PaidTier): string {
  return tier === "team" ? "Team — $209/mo" : "Professional — $39/mo";
}

interface Props {
  plan: string | null;
}

export function RegisterForm({ plan: rawPlan }: Props) {
  const router = useRouter();
  const plan = parsePlanParam(rawPlan);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ phase: "form" });
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ phase: "loading" });

    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), email: email.trim() }),
    });

    const data = (await res.json()) as
      | { ok: true; apiKey: string }
      | { error: string };

    if (!res.ok || "error" in data) {
      setState({
        phase: "error",
        message: "error" in data ? data.error : "Registration failed. Please try again.",
      });
      return;
    }

    setState({ phase: "success", apiKey: data.apiKey });
  }

  async function copyKey(key: string) {
    await navigator.clipboard.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (state.phase === "success") {
    return (
      <div className="max-w-lg mx-auto px-6 py-16">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8">
          <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mb-4">
            <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>

          <h1 className="text-xl font-bold text-slate-900 mb-2">Account created — save your key</h1>
          <p className="text-slate-600 text-sm mb-6">
            Copy your API key before continuing. It cannot be recovered.
          </p>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-2">
              Your API Key
            </p>
            <div className="flex items-center gap-3">
              <code className="text-sm font-mono text-slate-900 break-all flex-1">
                {state.apiKey}
              </code>
              <button
                onClick={() => copyKey(state.apiKey)}
                className="flex-shrink-0 text-xs bg-slate-900 hover:bg-slate-700 text-white px-3 py-1.5 rounded transition-colors"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          <div className="border border-amber-200 text-amber-800 text-xs rounded-lg px-4 py-3 mb-4">
            This is the only time this key will be shown. Store it in your password manager before proceeding.
          </div>

          <hr className="border-slate-200 mb-4" />

          {plan ? (
            <form action="/api/billing/checkout" method="POST">
              <input type="hidden" name="tier" value={plan} />
              <button
                type="submit"
                className="w-full bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3 rounded-lg transition-colors"
              >
                Continue to {planLabel(plan)} →
              </button>
            </form>
          ) : (
            <button
              onClick={() => router.push("/dashboard")}
              className="w-full bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3 rounded-lg transition-colors"
            >
              Go to your dashboard →
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-6 py-16">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-2">
          {plan ? "Create your account to continue" : "Create your account"}
        </h1>
        <p className="text-slate-600">
          {plan
            ? `You're one step from ${planLabel(plan)} access.`
            : "Free to start. No credit card required."}
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-8">
        {state.phase === "error" && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-6">
            {state.message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Organization name
            </label>
            <input
              id="name"
              type="text"
              autoComplete="organization"
              required
              minLength={2}
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Corp"
              className="w-full border border-slate-300 rounded-lg px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>

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
            disabled={state.phase === "loading"}
            className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors"
          >
            {state.phase === "loading" ? "Creating account…" : "Create Account"}
          </button>
        </form>

        <p className="text-center text-slate-500 text-sm mt-6">
          Already have an account?{" "}
          <Link href="/login" className="text-teal-600 hover:text-teal-700 font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
