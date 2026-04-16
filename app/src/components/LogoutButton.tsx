"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();

  async function handleLogout() {
    setSigningOut(true);
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      router.push("/login");
    }
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
