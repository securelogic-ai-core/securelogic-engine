"use client";

import { useState } from "react";

export function LogoutButton() {
  const [signingOut, setSigningOut] = useState(false);

  async function handleLogout() {
    setSigningOut(true);
    try {
      await fetch("/api/logout", { method: "POST", redirect: "manual" });
    } catch {
      // ignore — session may already be cleared
    }
    window.location.href = "/login";
  }

  return (
    <button
      onClick={handleLogout}
      disabled={signingOut}
      className="text-slate-400 hover:text-white text-sm transition-colors disabled:opacity-60"
    >
      {signingOut ? "Signing out…" : "Sign Out"}
    </button>
  );
}
