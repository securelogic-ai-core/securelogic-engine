"use client";

import { useState } from "react";

interface UpgradeCardProps {
  /** Current entitlement level — used to hide the Brief Pro option for existing Brief Pro subscribers. */
  entitlementLevel?: string;
}

export function UpgradeCard({ entitlementLevel = "free" }: UpgradeCardProps) {
  const [loading, setLoading] = useState<"professional" | "team" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isBriefPro = entitlementLevel === "professional";

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
      <h3 className="font-semibold text-sm text-slate-100 mb-1">
        {isBriefPro ? "Upgrade your plan" : "Unlock full access"}
      </h3>
      <p className="text-slate-400 text-xs mb-4">
        {isBriefPro
          ? "Add posture monitoring, vendor risk, and AI governance."
          : "Choose a plan to access the Intelligence Brief."}
      </p>
      {error && (
        <p className="text-red-400 text-xs mb-3">{error}</p>
      )}
      <div className="space-y-2">
        {!isBriefPro && (
          <>
            <button
              onClick={() => handleCheckout("professional")}
              disabled={loading !== null}
              className="w-full bg-brand-teal hover:bg-teal-400 disabled:opacity-60 text-white font-semibold text-sm py-2 rounded-lg transition-colors"
            >
              {loading === "professional" ? "Redirecting…" : "Brief Pro — $29/mo"}
            </button>
            <p className="text-slate-500 text-xs px-1 -mt-1">Full brief content, all sections</p>
          </>
        )}

        <button
          onClick={() => handleCheckout("team")}
          disabled={loading !== null}
          className="w-full bg-white/10 hover:bg-white/20 disabled:opacity-60 text-slate-100 font-semibold text-sm py-2 rounded-lg transition-colors border border-white/20"
        >
          {loading === "team" ? "Redirecting…" : "Platform Professional — $799/mo"}
        </button>
        <p className="text-slate-500 text-xs px-1 -mt-1">Posture monitoring, vendor risk, AI governance</p>

        <a
          href="mailto:hello@securelogicai.com?subject=SecureLogic%20AI%20Enterprise%20Inquiry"
          className="w-full block text-center text-slate-400 hover:text-slate-200 text-xs py-2 transition-colors"
        >
          Enterprise &rsaquo;
        </a>
        <p className="text-slate-500 text-xs px-1 -mt-1">Custom contract, dedicated support</p>
      </div>
    </div>
  );
}
