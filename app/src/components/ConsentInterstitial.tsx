"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ConsentDocumentType } from "@/lib/api";
import { LEGAL_DOC_LINKS } from "@/components/ConsentCheckbox";

interface Props {
  missingDocuments: ConsentDocumentType[];
}

/**
 * Full-viewport blocking interstitial shown when the engine reports the current
 * user owes consent (403 consent_required) on an authenticated request. The
 * root layout renders this over the page; it cannot be dismissed without
 * accepting. On success it refreshes the route so the layout's consent probe
 * re-runs and the interstitial unmounts.
 *
 * POSTs to /api/accept-terms (BFF) with an EMPTY body so the engine records all
 * currently-missing documents — the displayed list and the recorded set stay in
 * lockstep even if they drift between probe and submit.
 */
export default function ConsentInterstitial({ missingDocuments }: Props) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fall back to all three documents if the 403 didn't carry a list.
  const docs: ConsentDocumentType[] =
    missingDocuments.length > 0
      ? missingDocuments
      : ["terms_of_service", "privacy_policy", "ai_transparency_policy"];

  const isFirstConsent = docs.length === 3;
  const heading = isFirstConsent ? "Welcome — please review our policies" : "Updated legal documents";
  const intro = isFirstConsent
    ? "Before you continue, please review and accept the policies that govern your use of SecureLogic AI."
    : "We've updated the following policies. Please review and accept them to continue.";

  async function handleAccept() {
    setError(null);
    if (!accepted) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/accept-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        setError("We couldn't record your acceptance. Please try again.");
        setSubmitting(false);
        return;
      }
      // Re-run the server layout's consent probe; this component unmounts when
      // the gate clears.
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="consent-interstitial-heading"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(3, 7, 15, 0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        style={{
          maxWidth: "480px",
          width: "100%",
          background: "#0d1b2e",
          border: "1px solid #1e2d45",
          borderRadius: "12px",
          padding: "32px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <p
          id="consent-interstitial-heading"
          style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: 700, color: "#f1f5f9" }}
        >
          {heading}
        </p>
        <p style={{ margin: "0 0 20px", fontSize: "14px", lineHeight: 1.5, color: "#94a3b8" }}>
          {intro}
        </p>

        <ul style={{ listStyle: "none", margin: "0 0 20px", padding: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
          {docs.map((doc) => (
            <li
              key={doc}
              style={{
                background: "#060d18",
                border: "1px solid #1e2d45",
                borderRadius: "8px",
                padding: "12px 14px",
              }}
            >
              <a
                href={LEGAL_DOC_LINKS[doc].href}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "#00c4b4",
                  textDecoration: "none",
                  fontSize: "14px",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "8px",
                }}
              >
                <span>{LEGAL_DOC_LINKS[doc].label}</span>
                <span aria-hidden style={{ color: "#64748b", fontSize: "12px" }}>Read ↗</span>
              </a>
            </li>
          ))}
        </ul>

        {error && (
          <div
            style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: "8px",
              padding: "10px 12px",
              marginBottom: "16px",
              fontSize: "13px",
              color: "#fca5a5",
            }}
          >
            {error}
          </div>
        )}

        <label
          htmlFor="consent-interstitial-accept"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "10px",
            margin: "0 0 22px",
            fontSize: "14px",
            lineHeight: 1.5,
            color: "#cbd5e1",
            cursor: "pointer",
          }}
        >
          <input
            id="consent-interstitial-accept"
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            style={{
              width: "18px",
              height: "18px",
              marginTop: "1px",
              accentColor: "#00c4b4",
              flexShrink: 0,
              cursor: "pointer",
            }}
          />
          <span>I have read and agree to the documents listed above.</span>
        </label>

        <button
          type="button"
          onClick={handleAccept}
          disabled={!accepted || submitting}
          style={{
            width: "100%",
            background: "#00c4b4",
            color: "#0a0f1a",
            fontWeight: 700,
            fontSize: "15px",
            padding: "13px",
            borderRadius: "8px",
            border: "none",
            cursor: !accepted || submitting ? "not-allowed" : "pointer",
            opacity: !accepted || submitting ? 0.6 : 1,
            transition: "opacity 0.15s",
            fontFamily: "inherit",
          }}
        >
          {submitting ? "Saving…" : "Accept and Continue"}
        </button>
      </div>
    </div>
  );
}
