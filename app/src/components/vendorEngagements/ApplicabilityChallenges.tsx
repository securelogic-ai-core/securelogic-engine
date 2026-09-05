"use client";

/**
 * ApplicabilityChallenges — disagreeing with a composition decision, on the
 * record (WA-2, owner ruling 2).
 *
 * ── What this is, and what it deliberately is not ───────────────────────────
 *
 * The owner ruling is explicit: an analyst or customer may CHALLENGE an
 * applicability determination, and may NOT remove an applicable SecureLogic
 * Core Assurance objective — not with a reason, not with a second approver.
 * The Core Assurance Set is a product minimum assurance floor.
 *
 * So this component records a disagreement and nothing else. There is no
 * "remove", no "suppress", no "mark not applicable", and no state anywhere that
 * a challenge can move. The engine offers no such route either, which is the
 * real control; this is simply the surface that does not pretend otherwise.
 *
 * ── Why the resolution text comes from the engine ───────────────────────────
 *
 * What a challenge resolves to depends on engine behaviour, and that behaviour
 * currently has an open owner decision behind it (an engagement composes on the
 * facts it was OPENED with, so a corrected intake moves the relationship and
 * applies to assessments opened afterwards). Writing that sentence here as well
 * would give it two homes and one of them would go stale. The engine says it;
 * this renders it verbatim.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ApplicabilityChallenge } from "@/lib/api";
import { raiseChallenge } from "@/app/actions/vendorEngagements";

const OUTCOME_LABEL: Record<ApplicabilityChallenge["challenged_outcome"], string> = {
  asked: "Asked",
  evidence_satisfied: "Satisfied by evidence",
  not_applicable: "Not applicable",
  not_provisioned: "Not in library",
};

export const CHALLENGE_TRANSPORT_FAILURE =
  "The request did not reach SecureLogic, so nothing was recorded. Check your connection and try again.";

export default function ApplicabilityChallenges({
  engagementId,
  challenges,
  /** References the current composition actually contains, for the picker. */
  references,
  loadFailed,
}: {
  engagementId: string;
  challenges: ApplicabilityChallenge[];
  references: Array<{ reference: string; title: string; outcome: string }>;
  loadFailed: boolean;
}): JSX.Element {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<string | null>(null);

  const muted: React.CSSProperties = { color: "#9ca3af", fontSize: 12, margin: 0 };
  const input: React.CSSProperties = {
    width: "100%", padding: "6px 8px", borderRadius: 6,
    border: "1px solid #334155", background: "#0b1220", color: "#e2e8f0", fontSize: 12,
  };

  function submit(): void {
    setError(null);
    setResolution(null);
    start(async () => {
      // Every transition awaits inside try/catch — a call that rejects before
      // reaching the app is reported here with the form intact, never thrown
      // into the route (the VO 2.0 walkthrough crash class).
      let r: Awaited<ReturnType<typeof raiseChallenge>>;
      try {
        r = await raiseChallenge(engagementId, { requirement_reference: reference, reason: reason.trim() });
      } catch {
        setError(CHALLENGE_TRANSPORT_FAILURE);
        return;
      }
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setResolution(r.resolution);
      setOpen(false);
      setReference("");
      setReason("");
      router.refresh();
    });
  }

  return (
    <section
      style={{ padding: 16, border: "1px solid #1f2937", borderRadius: 8, background: "#0f172a" }}
      aria-label="Applicability challenges"
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0, color: "#e5e7eb" }}>
          Challenges to this composition
        </h2>
        {references.length > 0 && (
          <button
            type="button"
            onClick={() => { setOpen((v) => !v); setError(null); setResolution(null); }}
            disabled={pending}
            style={{ fontSize: 11, color: "#93c5fd", background: "transparent", border: "1px solid #334155", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}
          >
            {open ? "Cancel" : "Disagree with a determination"}
          </button>
        )}
      </div>

      {loadFailed ? (
        <p style={{ ...muted, marginTop: 8, color: "#fde68a" }}>
          Challenges could not be loaded. This is a load failure, not an empty record.
        </p>
      ) : challenges.length === 0 ? (
        <p style={{ ...muted, marginTop: 8 }}>
          No one has disputed how this assessment was composed. Recording a disagreement
          keeps it with the engagement — it does not change what is asked.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 8 }}>
          {challenges.map((c) => (
            <li key={c.id} style={{ padding: "8px 10px", border: "1px solid #1f2937", borderRadius: 6 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                <span style={{ fontSize: 11, color: "#6b7280" }}>{c.requirement_reference}</span>
                <span style={{ fontSize: 11, color: "#9ca3af" }}>
                  SecureLogic determined: {OUTCOME_LABEL[c.challenged_outcome] ?? c.challenged_outcome}
                </span>
                {c.superseded && (
                  <span style={{ fontSize: 10, color: "#93c5fd", border: "1px solid #1d4ed8", borderRadius: 999, padding: "1px 8px" }}>
                    determination has since changed
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13, color: "#e5e7eb", marginTop: 3 }}>{c.reason}</div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>
                {c.raised_by_name || c.raised_by_email || "Unknown"} · {c.created_at.slice(0, 10)}
              </div>
              {c.challenged_rationale && (
                <div style={{ fontSize: 11, color: "#6b7280", marginTop: 3 }}>
                  SecureLogic&apos;s reason at the time: {c.challenged_rationale}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div style={{ marginTop: 12, display: "grid", gap: 8, padding: 10, border: "1px dashed #334155", borderRadius: 6 }}>
          <select
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            disabled={pending}
            style={input}
            aria-label="Determination to challenge"
          >
            <option value="">Select the determination…</option>
            {references.map((r) => (
              <option key={r.reference} value={r.reference}>
                {r.reference} — {r.title} ({r.outcome})
              </option>
            ))}
          </select>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={pending}
            rows={3}
            maxLength={4000}
            placeholder="Explain why you disagree. This is recorded against the engagement with your name."
            style={input}
            aria-label="Why you disagree"
          />
          {/*
            Said before they press it, not after. The ruling forbids suppressing
            an applicable requirement, and a form that looks like it might
            remove something would be read as one.
          */}
          <p style={{ ...muted, fontSize: 11 }}>
            This records your disagreement. It does not remove the requirement or change
            what the vendor is asked — SecureLogic&apos;s Core Assurance objectives are a
            minimum and are not waived by objection.
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !reference || reason.trim().length < 10}
            style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid #334155", background: "rgba(30,58,138,0.25)", color: "#93c5fd", fontSize: 12, cursor: "pointer", justifySelf: "start" }}
          >
            {pending ? "Recording…" : "Record disagreement"}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" style={{ marginTop: 10, fontSize: 12, color: "#fca5a5" }}>
          {error}
        </p>
      )}
      {resolution && (
        <p role="status" style={{ marginTop: 10, fontSize: 12, color: "#93c5fd", lineHeight: 1.5 }}>
          {resolution}
        </p>
      )}
    </section>
  );
}
