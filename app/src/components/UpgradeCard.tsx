"use client";

import { useState } from "react";

/**
 * UpgradeCard — client component.
 *
 * Calls /api/checkout (JSON endpoint) with the desired tier, shows a
 * per-button loading state, then redirects to the Stripe checkout URL.
 * Must be a client component so it can use useState and fetch.
 */
export function UpgradeCard() {
  const [loading, setLoading] = useState<"professional" | "team" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCheckout(tier: "professional" | "team") {
    setLoading(tier);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = (await res.json()) as { checkoutUrl?: string; error?: string };
      if (!res.ok || !data.checkoutUrl) {
        setError("Unable to start checkout. Please try again.");
        return;
      }
      window.location.href = data.checkoutUrl;
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="bg-brand-teal/10 border border-brand-teal/30 rounded-xl p-5">
      <h3 className="font-semibold text-sm text-slate-100 mb-1">Unlock full access</h3>
      <p className="text-slate-400 text-xs mb-4">
        Full brief content, all sections, and the complete archive.
      </p>
      {error && (
        <p className="text-red-400 text-xs mb-3">{error}</p>
      )}
      <div className="space-y-2">
        <button
          onClick={() => handleCheckout("professional")}
          disabled={loading !== null}
          className="w-full bg-brand-teal hover:bg-teal-400 disabled:opacity-60 text-white font-semibold text-sm py-2 rounded-lg transition-colors"
        >
          {loading === "professional" ? "Redirecting…" : "Brief Pro — $29/mo"}
        </button>
        <button
          onClick={() => handleCheckout("team")}
          disabled={loading !== null}
          className="w-full bg-white/10 hover:bg-white/20 disabled:opacity-60 text-slate-100 font-semibold text-sm py-2 rounded-lg transition-colors border border-white/20"
        >
          {loading === "team" ? "Redirecting…" : "Professional — $499/mo"}
        </button>
        <a
          href="mailto:hello@securelogicai.com"
          className="w-full block text-center text-slate-400 hover:text-slate-200 text-sm py-2 rounded-lg transition-colors border border-white/10 hover:border-white/20"
        >
          Enterprise — Custom pricing
        </a>
      </div>
    </div>
  );
}
