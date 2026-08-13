"use client";

/**
 * /portal/done — submitted confirmation.
 *
 * Explains what happens next and offers sign-out (DELETE /session revokes the
 * server-side session and clears the httpOnly cookie). After signing out the
 * page shows a signed-out state — the only way back in is the emailed link.
 */

import { useState } from "react";
import Link from "next/link";
import { usePortal } from "../PortalShell";
import { portalFetch } from "../portalApi";

export default function DonePage() {
  const { engagement } = usePortal();
  const [signingOut, setSigningOut] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      const result = await portalFetch("/session", { method: "DELETE" });
      // 401 means the session is already gone — that is a successful sign-out.
      if (result.ok || result.status === 401) {
        setSignedOut(true);
        return;
      }
      setSignOutError("Sign-out did not complete. Please try again.");
    } catch {
      setSignOutError("Network problem — please try signing out again.");
    } finally {
      setSigningOut(false);
    }
  }

  if (signedOut) {
    return (
      <div className="rounded-xl border border-brand-line bg-brand-surface p-8">
        <h2 className="text-xl font-semibold text-slate-100">You are signed out</h2>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Your portal session has ended. If you need to return — for example, to respond to
          a reviewer&apos;s question — open the link from your invitation email again.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-brand-teal/40 bg-brand-teal/10 p-8">
        <h2 className="text-xl font-semibold text-slate-100">Responses submitted</h2>
        <p className="mt-3 text-sm leading-6 text-slate-300">
          Thank you. Your questionnaire responses
          {engagement ? ` have been sent to ${engagement.organization_name}` : " have been sent"}{" "}
          and are now the formal record of this assessment.
        </p>
      </div>

      <div className="rounded-xl border border-brand-line bg-brand-surface p-6">
        <h3 className="text-sm font-semibold text-slate-100">What happens next</h3>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-300">
          <li>The organization&apos;s reviewer will assess your responses and attachments.</li>
          <li>
            If anything needs clarification, they will ask through the{" "}
            <Link href="/portal/clarifications" className="text-brand-teal hover:underline">
              Messages
            </Link>{" "}
            thread — you will be able to reply and, where requested, update your submission.
          </li>
          <li>Your answers are read-only while the review is in progress.</li>
        </ul>
      </div>

      {signOutError && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm leading-6 text-red-300">
          {signOutError}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={signingOut}
          onClick={() => void handleSignOut()}
          className="rounded-lg border border-brand-line px-4 py-2 text-sm font-medium text-slate-300 hover:border-slate-500 hover:text-slate-100 disabled:opacity-50"
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
