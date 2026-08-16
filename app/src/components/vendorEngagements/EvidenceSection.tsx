"use client";

/**
 * EvidenceSection — everything attached to the engagement, with provenance
 * (vendor-supplied vs internal), the human review state, and the analysis
 * worker's ADVISORY verdict per file.
 *
 * The verdicts are suggestions for where to look first — they never feed the
 * effectiveness ladder. Only the human confirmation recorded here (supports /
 * does not support) moves a control from `documented` to `evidenced`, and the
 * engine reminds on every review that /recompute applies it to the scores.
 */

import { useState, useTransition } from "react";
import type { VendorEngagementEvidenceRow } from "@/lib/api";
import { reviewEvidence } from "@/app/actions/vendorEngagements";

type Props = {
  engagementId: string;
  evidence: VendorEngagementEvidenceRow[];
};

const VERDICT_STYLE: Record<
  NonNullable<VendorEngagementEvidenceRow["analysis_verdict"]>,
  { label: string; fg: string; bg: string; border: string; hint: string }
> = {
  supports: {
    label: "Analysis: supports",
    fg: "#86efac",
    bg: "rgba(22,101,52,0.2)",
    border: "#166534",
    hint: "Advisory only — the document plausibly evidences the control. Confirm it yourself; suggestions never feed the score.",
  },
  insufficient: {
    label: "Analysis: insufficient",
    fg: "#fcd34d",
    bg: "rgba(161,98,7,0.2)",
    border: "#a16207",
    hint: "Advisory only — readable, but does not establish the control.",
  },
  contradicts: {
    label: "Analysis: contradicts",
    fg: "#fca5a5",
    bg: "rgba(127,29,29,0.25)",
    border: "#b91c1c",
    hint: "Advisory only — a flag to look closely, not a verdict: the document suggests the control is NOT in place.",
  },
  unreadable: {
    label: "Analysis: unreadable — human must read",
    fg: "#fcd34d",
    bg: "rgba(161,98,7,0.2)",
    border: "#a16207",
    hint: "Automated analysis cannot read this file type or content. A human must review it.",
  },
};

function fmtBytes(raw: number | string | null): string {
  // byte_size is a Postgres BIGINT — it arrives as a string over JSON.
  const n = raw === null || raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function EvidenceSection({ engagementId, evidence }: Props): JSX.Element {
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const runReview = (evidenceId: string, supports: boolean, reviewNote?: string) => {
    setError(null);
    setBusyId(evidenceId);
    startTransition(async () => {
      const r = await reviewEvidence(engagementId, evidenceId, supports, reviewNote);
      setBusyId(null);
      if (r.ok) {
        setRejectingId(null);
        setNote("");
      } else {
        setError(r.error);
      }
    });
  };

  return (
    <section style={card()}>
      <h2 style={h2()}>Evidence ({evidence.length})</h2>
      {evidence.length === 0 && (
        <p style={{ color: "#9ca3af", fontSize: 13, margin: 0 }}>
          Nothing attached yet. Vendor uploads arrive here once the questionnaire is issued.
        </p>
      )}
      {evidence.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {evidence.map((ev) => {
            const verdict = ev.analysis_verdict ? VERDICT_STYLE[ev.analysis_verdict] : null;
            const busy = busyId === ev.id;
            return (
              <div
                key={ev.id}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  border: "1px solid #1f2937",
                  background: "rgba(2,6,23,0.5)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 240, flex: "1 1 300px" }}>
                    <div style={{ fontSize: 14, color: "#e5e7eb" }}>
                      {ev.title ?? ev.original_filename ?? ev.id}
                    </div>
                    <div style={{ color: "#6b7280", fontSize: 12, marginTop: 3 }}>
                      {ev.original_filename && ev.title ? `${ev.original_filename} · ` : ""}
                      {fmtBytes(ev.byte_size)}
                      {ev.mime_type ? ` · ${ev.mime_type}` : ""} · uploaded {fmtDate(ev.created_at)} ·{" "}
                      <span style={{ color: ev.from_vendor ? "#93c5fd" : "#9ca3af" }}>
                        {ev.from_vendor ? "supplied by vendor" : "internal upload"}
                      </span>
                    </div>
                    {ev.requirement_reference && (
                      <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 3 }}>
                        Attached to {ev.requirement_reference}
                        {ev.requirement_title ? ` — ${ev.requirement_title}` : ""}
                      </div>
                    )}
                    {verdict && (
                      <div style={{ marginTop: 6 }}>
                        <span
                          title={verdict.hint}
                          style={{
                            display: "inline-block",
                            padding: "2px 9px",
                            borderRadius: 999,
                            fontSize: 11,
                            background: verdict.bg,
                            color: verdict.fg,
                            border: `1px solid ${verdict.border}`,
                          }}
                        >
                          {verdict.label}
                        </span>
                        {ev.analysis_rationale && (
                          <div style={{ color: "#6b7280", fontSize: 12, marginTop: 4 }}>
                            {ev.analysis_rationale}
                          </div>
                        )}
                      </div>
                    )}
                    {!verdict && (
                      <div style={{ color: "#6b7280", fontSize: 12, marginTop: 6 }}>
                        No automated analysis recorded for this file.
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                    {ev.reviewed_at ? (
                      <span
                        style={{
                          padding: "2px 9px",
                          borderRadius: 999,
                          fontSize: 11,
                          background: "rgba(22,101,52,0.2)",
                          color: "#86efac",
                          border: "1px solid #166534",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Confirmed {fmtDate(ev.reviewed_at)}
                      </span>
                    ) : ev.review_note ? (
                      <span
                        style={{
                          padding: "2px 9px",
                          borderRadius: 999,
                          fontSize: 11,
                          background: "rgba(127,29,29,0.25)",
                          color: "#fca5a5",
                          border: "1px solid #b91c1c",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Marked not supporting
                      </span>
                    ) : (
                      <span style={{ color: "#6b7280", fontSize: 12 }}>Awaiting human review</span>
                    )}
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => runReview(ev.id, true)}
                        style={smallBtn("#166534", busy)}
                        title="Confirm this document supports the control it is attached to. Run a risk recompute afterwards to apply it."
                      >
                        {busy ? "…" : ev.reviewed_at ? "Re-confirm" : "Supports control"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setRejectingId(rejectingId === ev.id ? null : ev.id);
                          setNote("");
                          setError(null);
                        }}
                        style={smallBtn("#b91c1c", busy, rejectingId === ev.id)}
                      >
                        Does not support
                      </button>
                    </div>
                  </div>
                </div>

                {ev.review_note && (
                  <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 8 }}>
                    Reviewer note: {ev.review_note}
                  </div>
                )}

                {rejectingId === ev.id && (
                  <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      disabled={busy}
                      placeholder="Explain why this document does not support the control, so the vendor can supply something that does (required)."
                      style={{
                        padding: 8,
                        borderRadius: 6,
                        border: "1px solid #374151",
                        background: "#020617",
                        color: "#e5e7eb",
                        fontSize: 12,
                        resize: "vertical",
                      }}
                    />
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                      <button
                        type="button"
                        disabled={busy || note.trim().length < 5}
                        onClick={() => runReview(ev.id, false, note.trim())}
                        style={smallBtn("#b91c1c", busy || note.trim().length < 5)}
                      >
                        Record rejection
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {error && <div style={{ marginTop: 10, fontSize: 13, color: "#fca5a5" }}>{error}</div>}
      {evidence.length > 0 && (
        <p style={{ color: "#6b7280", fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          Confirmations change scores only when a risk recompute is run — reviews never
          silently move a stored rating.
        </p>
      )}
    </section>
  );
}

function smallBtn(color: string, disabled: boolean, active = false): React.CSSProperties {
  return {
    padding: "4px 10px",
    borderRadius: 6,
    border: `1px solid ${disabled ? "#1f2937" : color}`,
    background: active ? `${color}33` : "transparent",
    color: disabled ? "#4b5563" : "#d1d5db",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 12,
    whiteSpace: "nowrap",
  };
}

function card(): React.CSSProperties {
  return {
    padding: 20,
    borderRadius: 8,
    border: "1px solid #1f2937",
    background: "rgba(15,23,42,0.5)",
  };
}

function h2(): React.CSSProperties {
  return { fontSize: 16, fontWeight: 600, margin: "0 0 12px" };
}
