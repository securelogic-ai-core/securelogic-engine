"use client";

import { useState, useTransition } from "react";
import { recordDisposition } from "@/app/actions/vendorEngagements";
import {
  ATTENTION_TONE_COLORS,
  DISPOSITION_LABELS,
  DISPOSITION_RATIONALE_MIN,
  attentionTone,
  dispositionNeedsRationale,
} from "@/lib/vendorEngagements";
import {
  ENGAGEMENT_DISPOSITIONS,
  type EngagementAttentionDetail,
  type EngagementDispositionValue,
} from "@/lib/api";

/**
 * WA-4 — why this engagement needs an analyst, and what the analyst decided.
 *
 * TWO HALVES, VISIBLY SEPARATE. The top half is DERIVED and read-only: it is
 * what the assessment says, and no control on this panel can change it. The
 * bottom half is the human decision, which is recorded beside that state and
 * never on top of it.
 *
 * Ruling E in one sentence: an analyst must never be given a red badge and left
 * to guess. Every reason names itself, explains itself, and lists the
 * requirements behind it.
 *
 * TWO WA-3 LESSONS ARE LOAD-BEARING HERE, both learned from browser failures
 * that no unit test caught:
 *   1. The success message is rendered BEFORE any early return, so
 *      revalidation cannot unmount the component out from under the sentence
 *      the analyst is still reading.
 *   2. There is no router.refresh() after the action. The action already calls
 *      revalidatePath, so Next streams the revalidated page in the SAME
 *      response; refreshing supersedes that stream mid-flight and the POST
 *      logs as aborted.
 */
export default function AttentionPanel({
  engagementId,
  detail,
}: {
  engagementId: string;
  detail: EngagementAttentionDetail;
}) {
  const [choice, setChoice] = useState<EngagementDispositionValue | "">("");
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { attention, disposition, in_attention_window: inWindow } = detail;
  const needsReason = choice !== "" && dispositionNeedsRationale(choice);
  const reasonTooShort = needsReason && rationale.trim().length < DISPOSITION_RATIONALE_MIN;

  function submit() {
    if (choice === "") return;
    setError(null);
    setDone(null);
    startTransition(async () => {
      const res = await recordDisposition(engagementId, {
        disposition: choice,
        ...(rationale.trim().length > 0 ? { rationale: rationale.trim() } : {}),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(
        res.createdFinding
          ? "Recorded."
          : "Recorded. No finding was created — promoting this assessment to the findings and remediation lifecycle is a separate, explicit action."
      );
      setChoice("");
      setRationale("");
    });
  }

  return (
    <section
      style={{
        border: "1px solid #374151",
        borderRadius: 8,
        padding: 20,
        marginBottom: 24,
        background: "rgba(17,24,39,0.5)",
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: "#e5e7eb" }}>Needs attention</h2>
      <p style={{ color: "#9ca3af", fontSize: 13, marginTop: 6, marginBottom: 16, maxWidth: 720 }}>
        Derived from this assessment every time the page loads. Nothing here is a stored flag, and
        nothing here creates a finding.
      </p>

      {/* ── The derived half ─────────────────────────────────────────────── */}
      {!inWindow && (
        <p style={{ color: "#6b7280", fontSize: 13 }}>
          This engagement is not awaiting analyst triage in its current state.
        </p>
      )}

      {inWindow && attention.explanations.length === 0 && (
        <p style={{ color: "#9ca3af", fontSize: 13 }}>Nothing outstanding on this assessment.</p>
      )}

      {inWindow && attention.explanations.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "0 0 20px 0", display: "flex", flexDirection: "column", gap: 12 }}>
          {attention.explanations.map((ex) => {
            const c = ATTENTION_TONE_COLORS[attentionTone(ex.reason)];
            return (
              <li key={ex.reason} style={{ borderLeft: `3px solid ${c.border}`, paddingLeft: 12 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ color: c.fg, fontSize: 13, fontWeight: 600 }}>{ex.label}</span>
                  <span style={{ color: "#6b7280", fontSize: 12 }}>
                    {ex.count} {ex.count === 1 ? "item" : "items"}
                  </span>
                </div>
                <p style={{ color: "#9ca3af", fontSize: 12, margin: "4px 0 0 0", maxWidth: 720 }}>{ex.detail}</p>
                {ex.requirements.length > 0 && (
                  <p style={{ color: "#6b7280", fontSize: 12, margin: "6px 0 0 0" }}>
                    {ex.requirements.slice(0, 8).map((r) => r.reference).join(", ")}
                    {ex.requirements.length > 8 ? ` and ${ex.requirements.length - 8} more` : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* ── The human half ───────────────────────────────────────────────── */}
      {disposition && (
        <div
          style={{
            border: "1px solid #374151",
            borderRadius: 6,
            padding: 12,
            marginBottom: 16,
            background: "rgba(31,41,55,0.4)",
          }}
        >
          <div style={{ color: "#d1d5db", fontSize: 13, fontWeight: 600 }}>
            {DISPOSITION_LABELS[disposition.disposition] ?? disposition.disposition}
          </div>
          <div style={{ color: "#6b7280", fontSize: 12, marginTop: 2 }}>
            {disposition.disposed_by ?? "—"}
            {disposition.disposed_at ? ` · ${new Date(disposition.disposed_at).toLocaleString()}` : ""}
          </div>
          {disposition.rationale && (
            <p style={{ color: "#9ca3af", fontSize: 12, margin: "8px 0 0 0" }}>{disposition.rationale}</p>
          )}
          {disposition.stale && (
            <p style={{ color: "#fcd34d", fontSize: 12, margin: "8px 0 0 0" }}>
              The assessment has changed since this was recorded. The decision still stands — record a
              new one if it no longer holds.
            </p>
          )}
        </div>
      )}

      {/* Rendered BEFORE the early return below, so revalidation cannot unmount
          the confirmation mid-read. This is the WA-3 §1 defect, not a style. */}
      {done && (
        <p style={{ color: "#86efac", fontSize: 13, marginBottom: 12 }} data-testid="disposition-done">
          {done}
        </p>
      )}
      {error && (
        <p style={{ color: "#fca5a5", fontSize: 13, marginBottom: 12 }} data-testid="disposition-error">
          {error}
        </p>
      )}

      {!inWindow ? null : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 640 }}>
          <label style={{ color: "#9ca3af", fontSize: 12 }}>
            Record a disposition
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value as EngagementDispositionValue | "")}
              disabled={pending}
              data-testid="disposition-select"
              style={{
                display: "block",
                marginTop: 6,
                width: "100%",
                padding: "8px 10px",
                borderRadius: 6,
                background: "#111827",
                color: "#e5e7eb",
                border: "1px solid #374151",
                fontSize: 13,
              }}
            >
              <option value="">Choose…</option>
              {ENGAGEMENT_DISPOSITIONS.map((d) => (
                <option key={d} value={d}>
                  {DISPOSITION_LABELS[d]}
                </option>
              ))}
            </select>
          </label>

          {needsReason && (
            <label style={{ color: "#9ca3af", fontSize: 12 }}>
              Reason (required — at least {DISPOSITION_RATIONALE_MIN} characters)
              <textarea
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                disabled={pending}
                rows={3}
                data-testid="disposition-rationale"
                placeholder="What did you decide, and on what basis?"
                style={{
                  display: "block",
                  marginTop: 6,
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: "#111827",
                  color: "#e5e7eb",
                  border: "1px solid #374151",
                  fontSize: 13,
                  fontFamily: "inherit",
                }}
              />
            </label>
          )}

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button
              type="button"
              onClick={submit}
              disabled={pending || choice === "" || reasonTooShort}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: "none",
                background: pending || choice === "" || reasonTooShort ? "#374151" : "#2563eb",
                color: "#fff",
                fontSize: 13,
                cursor: pending || choice === "" || reasonTooShort ? "not-allowed" : "pointer",
              }}
            >
              {pending ? "Recording…" : "Record disposition"}
            </button>
            <span style={{ color: "#6b7280", fontSize: 12 }}>
              Recorded beside the assessment, never over it. Previous decisions are kept.
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
