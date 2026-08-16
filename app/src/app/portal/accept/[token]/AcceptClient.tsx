"use client";

/**
 * Exchange the emailed invite token for an httpOnly portal session cookie.
 *
 * POST /api/vendor-portal/session { token } — exactly once. On success the
 * engine sets the sl_vendor_portal cookie (path /api/vendor-portal, httpOnly)
 * and we replace the URL with /portal so the secret leaves the address bar.
 * The token is NEVER rendered, logged, or written to any client-side storage.
 *
 * Failure states mirror the engine's error semantics:
 *   410 portal_link_expired — actionable: ask your contact for a new link;
 *   401 portal_link_invalid — invalid/revoked/used-and-revoked collapse to one
 *       generic message (the engine deliberately does not distinguish them);
 *   anything else — retryable error.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ExchangeState = "exchanging" | "expired" | "invalid" | "error";

export default function AcceptClient({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<ExchangeState>("exchanging");
  // React 18 StrictMode mounts effects twice in dev; exchange exactly once.
  const started = useRef(false);

  const exchange = useCallback(async () => {
    setState("exchanging");
    try {
      const res = await fetch("/api/vendor-portal/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        router.replace("/portal");
        return;
      }
      if (res.status === 410) {
        setState("expired");
        return;
      }
      if (res.status === 401 || res.status === 404) {
        // 401: invalid/revoked link. 404: the portal surface is switched off.
        // Neither is retryable by the vendor; both resolve through their contact.
        setState("invalid");
        return;
      }
      setState("error");
    } catch {
      setState("error");
    }
  }, [router, token]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void exchange();
  }, [exchange]);

  if (state === "exchanging") {
    return (
      <div className="rounded-xl border border-brand-line bg-brand-surface p-8">
        <h1 className="text-xl font-semibold text-slate-100">Opening your assessment…</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Verifying your secure link. This only takes a moment.
        </p>
      </div>
    );
  }

  if (state === "expired") {
    return (
      <div className="rounded-xl border border-brand-line bg-brand-surface p-8">
        <h1 className="text-xl font-semibold text-slate-100">This link has expired</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          For security, invitation links are only valid for a limited time. Please ask your
          contact at the requesting organization to send you a new link. Any answers you
          already saved are kept and will be there when you return.
        </p>
      </div>
    );
  }

  if (state === "invalid") {
    return (
      <div className="rounded-xl border border-brand-line bg-brand-surface p-8">
        <h1 className="text-xl font-semibold text-slate-100">
          This link is not valid
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          This invitation link is not recognized. It may have been replaced or withdrawn.
          Please check that you opened the most recent email, or ask your contact at the
          requesting organization to send a new link.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-brand-line bg-brand-surface p-8">
      <h1 className="text-xl font-semibold text-slate-100">Something went wrong</h1>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        We could not verify your link just now. This is usually temporary.
      </p>
      <button
        type="button"
        onClick={() => void exchange()}
        className="mt-5 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-brand-bg hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}
