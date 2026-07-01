"use client";

import { useEffect, useRef, useState } from "react";
import {
  decidePortalSubmit,
  phaseAfterPendingTimeout,
  interpretPortalResponse,
  PORTAL_PENDING_TIMEOUT_MS,
  type PortalSubmitPhase,
} from "./billingPortalSubmit";

/**
 * Manage/Update Billing CTA.
 *
 * Client-controlled submit (Sprint 3H follow-up): on submit we `preventDefault`
 * and drive the request ourselves — `fetch('/api/billing/portal')` → the route
 * returns `{ url }` JSON for the XHR → `window.location.assign(url)`. This
 * replaces the previous reliance on the browser following a native cross-origin
 * 303, which failed non-deterministically on the FIRST click (a warm engine
 * still required a second click). Taking explicit control makes single-click
 * deterministic and also fixes the return-to-/account behavior.
 *
 * Progressive enhancement preserved: the element is still a real
 * `<form action="/api/billing/portal" method="POST">`, so with JS disabled the
 * native POST fires and the route returns its 303 (non-XHR path) exactly as
 * before. The button is never disabled (disabling it synchronously inside submit
 * was an earlier single-click bug); pending is conveyed via label + aria-busy.
 *
 * Timeout/retry UX preserved: a request is aborted after PORTAL_PENDING_TIMEOUT_MS
 * and the CTA re-arms with a concise retry message — the UI never hangs
 * indefinitely, and a subsequent click fires a fresh request with no page refresh.
 */
export function BillingPortalForm({
  label,
  buttonClassName,
  formClassName,
  pendingLabel = "Opening billing…",
  retryMessage = "Billing is taking longer than expected. Please click to try again.",
  retryClassName,
}: {
  label: string;
  buttonClassName: string;
  formClassName?: string;
  pendingLabel?: string;
  retryMessage?: string;
  retryClassName?: string;
}) {
  const [pending, setPending] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  // Synchronous phase, read inside onSubmit to block duplicate in-flight submits.
  const phaseRef = useRef<PortalSubmitPhase>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // On unmount, clear the watchdog and abort any in-flight request.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  function armRetry() {
    // Re-arm the CTA (pending → timedout) and surface the retry message.
    phaseRef.current = phaseAfterPendingTimeout(phaseRef.current); // "timedout"
    setPending(false);
    setTimedOut(true);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    // Take client control of navigation. (No-JS clients never reach this handler
    // and fall back to the native form POST + 303.)
    event.preventDefault();

    const { proceed, nextPhase } = decidePortalSubmit(phaseRef.current);
    if (!proceed) return; // a request is already in flight — block the duplicate

    phaseRef.current = nextPhase; // "pending"
    setPending(true);
    setTimedOut(false);

    const controller = new AbortController();
    abortRef.current = controller;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => controller.abort(), PORTAL_PENDING_TIMEOUT_MS);

    let action: ReturnType<typeof interpretPortalResponse>;
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "x-portal-xhr": "1", Accept: "application/json" },
        signal: controller.signal,
      });
      let body: { url?: string; error?: string } = {};
      try {
        body = (await res.json()) as { url?: string; error?: string };
      } catch {
        // Non-JSON body → interpretPortalResponse falls through to "retry".
      }
      action = interpretPortalResponse(res.status, body);
    } catch {
      // Network failure or abort (timeout) → retry.
      action = { kind: "retry" };
    } finally {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      abortRef.current = null;
    }

    if (action.kind === "navigate") {
      window.location.assign(action.url); // leaving the page; keep pending state
      return;
    }
    if (action.kind === "login") {
      window.location.assign("/login");
      return;
    }
    armRetry();
  }

  return (
    <form
      action="/api/billing/portal"
      method="POST"
      className={formClassName}
      onSubmit={handleSubmit}
    >
      <button
        type="submit"
        aria-busy={pending}
        data-pending={pending ? "true" : undefined}
        className={buttonClassName}
      >
        {pending ? pendingLabel : label}
      </button>
      {timedOut && (
        <p
          role="status"
          aria-live="polite"
          data-portal-retry="true"
          className={retryClassName}
          style={
            retryClassName
              ? undefined
              : { marginTop: 8, fontSize: 12, lineHeight: 1.4, color: "#b45309" }
          }
        >
          {retryMessage}
        </p>
      )}
    </form>
  );
}
