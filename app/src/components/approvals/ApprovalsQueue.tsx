"use client";

/**
 * ApprovalsQueue (R3, spec §4.3) — the approver's org-wide work queue of
 * treatment plans / acceptances awaiting decision, read from GET /api/approvals.
 *
 * Mirrors the matcher queue's visual pattern (Notice/useTimedNotice) but does
 * NOT offer optimistic undo: an approval decision is a real, audited state
 * transition, so it is confirmed with a required rationale and committed
 * immediately (no misleading 5-second undo).
 *
 * Separation of duties is surfaced, not hidden: rows the current user proposed
 * render with Approve/Reject disabled and an explicit SoD explanation. The
 * engine enforces SoD (409), approver authority (403), and read-only (403)
 * regardless of what the UI shows.
 */

import Link from "next/link";
import { useRef, useState } from "react";
import { decideRiskApproval, type PendingApproval } from "@/lib/api";
import { reasonLabel } from "@/components/risks/lifecycleLabels";
import { Notice } from "@/components/queue/Notice";
import { useTimedNotice } from "@/hooks/useTimedNotice";

const CARD_STYLE: React.CSSProperties = {
  background: "var(--color-brand-surface, #111827)",
  border: "1px solid #1e293b",
  borderRadius: 12,
};

const PILL = "inline-flex items-center px-2 py-0.5 rounded text-xs";

const RATING_STYLES: Record<string, React.CSSProperties> = {
  Critical: { background: "rgba(239,68,68,0.15)", color: "#fca5a5" },
  High: { background: "rgba(249,115,22,0.15)", color: "#fdba74" },
  Moderate: { background: "rgba(245,158,11,0.15)", color: "#fcd34d" },
  Low: { background: "rgba(34,197,94,0.15)", color: "#86efac" },
};

function ratingStyle(v: string | null): React.CSSProperties {
  return (v && RATING_STYLES[v]) || { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

type Draft = { approvalId: string; decision: "approved" | "rejected" };

export function ApprovalsQueue({
  initialApprovals,
  userRole,
}: {
  initialApprovals: PendingApproval[];
  userRole: string | null;
}) {
  const [approvals, setApprovals] = useState<PendingApproval[]>(initialApprovals);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const { notice, show, dismiss } = useTimedNotice();
  const noticeSeq = useRef(0);

  const isApprover = userRole === "admin";

  function openDraft(approvalId: string, decision: "approved" | "rejected") {
    setDraft({ approvalId, decision });
    setComment("");
    setRowError((m) => ({ ...m, [approvalId]: "" }));
  }

  async function submitDecision(a: PendingApproval) {
    if (!draft) return;
    if (comment.trim().length === 0) {
      setRowError((m) => ({ ...m, [a.id]: "A rationale is required." }));
      return;
    }
    setSubmitting(true);
    const res = await decideRiskApproval(a.risk_id, a.id, {
      decision: draft.decision,
      comment: comment.trim(),
    });
    setSubmitting(false);
    if (!res.ok) {
      setRowError((m) => ({ ...m, [a.id]: reasonLabel(res.error) }));
      return;
    }
    setApprovals((list) => list.filter((x) => x.id !== a.id));
    setDraft(null);
    noticeSeq.current += 1;
    show({
      id: `decision-${noticeSeq.current}`,
      message: draft.decision === "approved"
        ? `Approved — "${a.risk_title ?? "risk"}" moved to Mitigation.`
        : `Rejected — "${a.risk_title ?? "risk"}" returned to Treatment Selection.`,
    });
  }

  if (approvals.length === 0) {
    return (
      <div className="p-8 text-center" style={CARD_STYLE}>
        <p className="text-sm" style={{ color: "#94a3b8" }}>No approvals pending.</p>
        <p className="text-xs mt-1" style={{ color: "#475569" }}>
          Treatment plans submitted for approval will appear here.
        </p>
      </div>
    );
  }

  return (
    <>
      {!isApprover && (
        <div
          className="mb-4 p-3 rounded"
          style={{ background: "rgba(148,163,184,0.05)", border: "1px solid rgba(148,163,184,0.12)" }}
        >
          <p className="text-xs" style={{ color: "#94a3b8" }}>
            You can review pending approvals, but only an approver (admin) can decide them.
          </p>
        </div>
      )}
      <div className="space-y-3">
        {approvals.map((a) => {
          const err = rowError[a.id];
          const isDrafting = draft?.approvalId === a.id;
          const canDecide = isApprover && !a.is_self_proposed;
          return (
            <div key={a.id} className="p-4" style={CARD_STYLE}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`${PILL} font-semibold`} style={ratingStyle(a.residual_rating)}>
                      {a.residual_rating ?? "—"}
                    </span>
                    <span
                      className={PILL}
                      style={{ background: "rgba(148,163,184,0.1)", color: "#94a3b8" }}
                    >
                      {a.kind === "risk_acceptance" ? "Risk acceptance" : "Treatment plan"}
                    </span>
                    {a.risk_domain && (
                      <span className={PILL} style={{ background: "rgba(148,163,184,0.1)", color: "#64748b" }}>
                        {a.risk_domain}
                      </span>
                    )}
                  </div>
                  <Link
                    href={`/risks/${a.risk_id}`}
                    className="text-sm font-semibold"
                    style={{ color: "#f1f5f9", textDecoration: "none" }}
                  >
                    {a.risk_title ?? "Untitled risk"}
                  </Link>
                  <p className="text-xs mt-1" style={{ color: "#475569" }}>
                    Requested {fmtDate(a.created_at)}
                    {a.expires_at ? ` · expires ${a.expires_at}` : ""}
                  </p>
                  {a.request_rationale && (
                    <p className="text-sm mt-2" style={{ color: "#cbd5e1", whiteSpace: "pre-wrap" }}>
                      {a.request_rationale}
                    </p>
                  )}
                </div>

                {/* Decision affordances */}
                <div className="flex-shrink-0">
                  {a.is_self_proposed ? (
                    <p className="text-xs max-w-[200px]" style={{ color: "#fcd34d" }}>
                      You proposed this — you can’t approve your own request (separation of duties).
                    </p>
                  ) : canDecide && !isDrafting ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openDraft(a.id, "approved")}
                        className="text-xs font-semibold px-3 py-1.5 rounded"
                        style={{ background: "#00c4b4", color: "#0a0f1a", border: "none", cursor: "pointer" }}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => openDraft(a.id, "rejected")}
                        className="text-xs font-semibold px-3 py-1.5 rounded"
                        style={{ background: "transparent", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.25)", cursor: "pointer" }}
                      >
                        Reject
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Inline rationale form */}
              {isDrafting && (
                <div className="mt-3 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <label className="block text-xs mb-1" style={{ color: "#94a3b8", fontWeight: 600 }}>
                    {draft.decision === "approved" ? "Approval rationale" : "Rejection rationale"} (required)
                  </label>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value.slice(0, 1000))}
                    disabled={submitting}
                    autoFocus
                    placeholder={draft.decision === "approved" ? "Why is this plan approved?" : "Why is this plan rejected?"}
                    style={{
                      width: "100%",
                      minHeight: 60,
                      padding: "8px 10px",
                      background: "rgba(15,23,34,0.6)",
                      border: "1px solid #1e293b",
                      borderRadius: 6,
                      color: "#e5e7eb",
                      fontSize: 13,
                      fontFamily: "inherit",
                      boxSizing: "border-box",
                      resize: "vertical",
                    }}
                  />
                  {err && <p className="text-xs mt-2" style={{ color: "#fca5a5" }}>{err}</p>}
                  <div className="flex items-center gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => void submitDecision(a)}
                      disabled={submitting}
                      className="text-xs font-semibold px-3 py-1.5 rounded"
                      style={{
                        background: draft.decision === "approved" ? "#00c4b4" : "#ef4444",
                        color: draft.decision === "approved" ? "#0a0f1a" : "#fff",
                        border: "none",
                        cursor: submitting ? "wait" : "pointer",
                        opacity: submitting ? 0.6 : 1,
                      }}
                    >
                      {submitting ? "Working…" : draft.decision === "approved" ? "Confirm approval" : "Confirm rejection"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraft(null)}
                      disabled={submitting}
                      className="text-xs font-medium px-3 py-1.5 rounded"
                      style={{ background: "transparent", color: "#94a3b8", border: "1px solid #1e293b", cursor: "pointer" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Row-level error when not drafting (e.g. a stale decision) */}
              {!isDrafting && err && (
                <p className="text-xs mt-2" style={{ color: "#fca5a5" }}>{err}</p>
              )}
            </div>
          );
        })}
      </div>
      <Notice notice={notice} onDismiss={dismiss} />
    </>
  );
}
