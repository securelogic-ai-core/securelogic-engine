"use client";

import { useState } from "react";

interface UpgradeCardProps {
  entitlementLevel?: string;
}

type ButtonKey = "briefpro" | "platform" | "teams";

export function UpgradeCard({ entitlementLevel = "free" }: UpgradeCardProps) {
  const [loading, setLoading] = useState<ButtonKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isBriefPro = entitlementLevel === "professional";

  async function handleCheckout(tier: "professional" | "teams" | "team", key: ButtonKey) {
    setLoading(key);
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
      <h3 className="font-semibold text-sm text-slate-100 mb-1">
        {isBriefPro ? "Upgrade your plan" : "Unlock full access"}
      </h3>
      <p className="text-slate-400 text-xs mb-4">
        {isBriefPro
          ? "Add posture monitoring, vendor risk, and AI governance."
          : "Start with a brief or get the full platform."}
      </p>
      {error && (
        <p className="text-red-400 text-xs mb-3">{error}</p>
      )}
      <div className="space-y-2">
        {!isBriefPro && (
          <button
            onClick={() => handleCheckout("professional", "briefpro")}
            disabled={loading !== null}
            className="w-full bg-brand-teal hover:bg-teal-400 disabled:opacity-60 text-white font-semibold text-sm py-2 rounded-lg transition-colors"
          >
            {loading === "briefpro" ? "Redirecting…" : "Brief Pro — $29/mo"}
          </button>
        )}

        <button
          onClick={() => handleCheckout("team", "platform")}
          disabled={loading !== null}
          className={`w-full disabled:opacity-60 font-semibold text-sm py-2 rounded-lg transition-colors border ${
            isBriefPro
              ? "bg-brand-teal hover:bg-teal-400 text-white border-transparent"
              : "bg-white/10 hover:bg-white/20 text-slate-100 border-white/20"
          }`}
        >
          {loading === "platform" ? "Redirecting…" : "Platform Professional — $799/mo"}
        </button>

        <button
          onClick={() => handleCheckout("teams", "teams")}
          disabled={loading !== null}
          className="w-full bg-white/10 hover:bg-white/20 disabled:opacity-60 text-slate-100 font-semibold text-sm py-2 rounded-lg transition-colors border border-white/20"
        >
          {loading === "teams" ? "Redirecting…" : "Brief Pro Teams — $209/mo"}
        </button>
      </div>
    </div>
  );
}
