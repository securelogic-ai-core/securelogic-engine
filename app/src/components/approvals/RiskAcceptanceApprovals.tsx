"use client";

/**
 * RiskAcceptanceApprovals — pending risk-acceptance proposals, in the approvals queue.
 *
 * WHY THIS EXISTS: the risk-acceptance subsystem shipped complete and well-tested, and was
 * still not executable end-to-end. The propose/approve/reject/withdraw API worked, the
 * per-finding panel worked — but NOTHING in the app read the org-wide register, and
 * /approvals reads `risk_approvals` (the Risk-Register lifecycle), a different table and a
 * different object. So an approver could only reach a proposal if somebody hand-passed them
 * the finding's URL. A signature you can only obtain by direct-messaging someone a link is
 * not a governance workflow.
 *
 * This is NOT a second approval engine. It reads the SAME register route the finding panel
 * reads (GET /api/risk-acceptances?state=proposed) and drives the SAME server actions
 * (approve/reject) the workspace drives. `?state=proposed` IS the pending queue: withdrawn,
 * rejected and expired records hold a different state, so they leave this queue by the state
 * machine, not by any filtering this component has to remember.
 *
 * Separation of duties is surfaced, not hidden: a proposal this viewer raised renders with
 * the decision controls disabled and an explicit explanation. `canDecide` is the SAME
 * predicate the Decision Workspace uses. The engine enforces SoD regardless (409
 * sod_violation) — the UI refuses first so the person is told why, before a round-trip.
 */

import Link from "next/link";
import { useState } from "react";
import {
  approveRiskAcceptanceAction,
  rejectRiskAcceptanceAction,
} from "@/app/findings/[id]/riskAcceptanceActions";
import { canDecide } from "@/app/findings/[id]/riskAcceptanceView";
import type { RiskAcceptance } from "@/lib/api";
import { Notice } from "@/components/queue/Notice";
import { useTimedNotice } from "@/hooks/useTimedNotice";

const CARD_STYLE: React.CSSProperties = {
  background: "var(--color-brand-surface, #111827)",
  border: "1px solid #1e293b",
  borderRadius: 12,
};

const PILL = "inline-flex items-center px-2 py-0.5 rounded text-xs";

const SEVERITY_STYLES: Record<string, React.CSSProperties> = {
  Critical: { background: "rgba(239,68,68,0.15)", color: "#fca5a5" },
  High: { background: "rgba(249,115,22,0.15)", color: "#fdba74" },
  Moderate: { background: "rgba(245,158,11,0.15)", color: "#fcd34d" },
  Low: { background: "rgba(34,197,94,0.15)", color: "#86efac" },
};

/** Internal vocabulary → the words a customer uses. Never render the raw enum. */
const PRIORITY_LABELS: Record<string, string> = {
  immediate: "Immediate",
  near_term: "Near term",
  planned: "Planned",
  watch: "Watch",
};

function severityStyle(v: string | null | undefined): React.CSSProperties {
  return (v && SEVERITY_STYLES[v]) || { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
}

/** A person, named. Falls back to email, then to an em-dash — never a uuid. */
function person(name: string | null | undefined, email: string | null | undefined): string {
  return name?.trim() || email?.trim() || "—";
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    // expires_at is a DATE (no time); created_at is a timestamp. Both render as a day.
    return new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return iso;
  }
}

type Draft = { acceptanceId: string; decision: "approve" | "reject" };

export function RiskAcceptanceApprovals({
  initialAcceptances,
  total,
  currentUserId,
}: {
  initialAcceptances: RiskAcceptance[];
  total: number;
  currentUserId: string | null;
}) {
  const [acceptances, setAcceptances] = useState<RiskAcceptance[]>(initialAcceptances);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rationale, setRationale] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const { notice, show, dismiss } = useTimedNotice();

  async function submitDecision(a: RiskAcceptance) {
    if (!draft) return;
    setSubmitting(true);
    setRowError((e) => ({ ...e, [a.id]: "" }));

    const input = { decision_rationale: rationale.trim() || undefined };
    const result =
      draft.decision === "approve"
        ? await approveRiskAcceptanceAction(a.finding_id, a.id, input)
        : await rejectRiskAcceptanceAction(a.finding_id, a.id, input);

    setSubmitting(false);

    if (result.error) {
      // A guarded refusal is a real outcome, not a no-op: the row STAYS, carrying the
      // reason. Removing it here would tell the approver the decision landed when it did not.
      setRowError((e) => ({ ...e, [a.id]: result.error as string }));
      return;
    }

    // The decision committed. The proposal is no longer pending, so it leaves the queue —
    // matching what the engine will now return for ?state=proposed. No optimistic undo: an
    // approval is an audited, signed transition, and a 5-second "undo" would be a lie.
    setAcceptances((rows) => rows.filter((r) => r.id !== a.id));
    setDraft(null);
    setRationale("");
    show({
      id: a.id,
      // No action button: an approval is a signed, audited transition. A one-click "undo"
      // would misrepresent what just happened — withdrawal is the real reversal, and it
      // reopens the finding on the record.
      message:
        draft.decision === "approve"
          ? `Risk accepted. “${a.finding_title ?? "Finding"}” is closed and stays governed until ${fmtDate(a.expires_at)}.`
          : `Proposal rejected. “${a.finding_title ?? "Finding"}” remains active.`,
    });
  }

  // The honest empty state. It says nothing is pending — NOT that the feature is off or
  // broken; the page distinguishes those before this component ever renders.
  if (acceptances.length === 0) {
    return (
      <div className="p-8 text-center" style={CARD_STYLE}>
        <p className="text-sm" style={{ color: "#94a3b8" }}>
          No risk acceptances are awaiting your decision.
        </p>
      </div>
    );
  }

  return (
    <div>
      {notice ? <Notice notice={notice} onDismiss={dismiss} /> : null}

      <div className="space-y-3">
        {acceptances.map((a) => {
          // The SAME predicate the Decision Workspace uses. Engine enforces it too.
          const decidable = canDecide(a, currentUserId);
          const isDraft = draft?.acceptanceId === a.id;
          const err = rowError[a.id];

          return (
            <div key={a.id} style={CARD_STYLE} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={PILL} style={{ background: "rgba(96,165,250,0.15)", color: "#93c5fd" }}>
                      Risk acceptance
                    </span>
                    <span className={PILL} style={severityStyle(a.finding_severity)}>
                      {a.finding_severity ?? "—"}
                    </span>
                    {a.finding_priority ? (
                      <span className={PILL} style={{ background: "rgba(148,163,184,0.15)", color: "#cbd5e1" }}>
                        {PRIORITY_LABELS[a.finding_priority] ?? a.finding_priority}
                      </span>
                    ) : null}
                  </div>

                  {/* The finding, reachable — the queue is a starting point, not a dead end. */}
                  <Link
                    href={`/findings/${a.finding_id}`}
                    className="block mt-2 text-base font-semibold"
                    style={{ color: "#f1f5f9", textDecoration: "none" }}
                  >
                    {a.finding_title ?? "Untitled finding"}
                  </Link>

                  <p className="text-sm mt-2" style={{ color: "#cbd5e1", whiteSpace: "pre-wrap" }}>
                    {a.rationale?.trim() || "No rationale was given."}
                  </p>
                </div>
              </div>

              <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3 mt-4 text-xs">
                <div>
                  <dt style={{ color: "#64748b" }}>Proposed by</dt>
                  <dd style={{ color: "#e2e8f0" }}>{person(a.requested_by_name, a.requested_by_email)}</dd>
                </div>
                <div>
                  <dt style={{ color: "#64748b" }}>Accountable owner</dt>
                  <dd style={{ color: "#e2e8f0" }}>{person(a.owner_name, a.owner_email)}</dd>
                </div>
                <div>
                  <dt style={{ color: "#64748b" }}>Review by</dt>
                  <dd style={{ color: "#e2e8f0" }}>{fmtDate(a.expires_at)}</dd>
                </div>
                <div>
                  <dt style={{ color: "#64748b" }}>Submitted</dt>
                  <dd style={{ color: "#e2e8f0" }}>{fmtDate(a.created_at)}</dd>
                </div>
                <div>
                  <dt style={{ color: "#64748b" }}>Supporting evidence</dt>
                  <dd style={{ color: "#e2e8f0" }}>
                    {/* An honest zero. Evidence is optional; saying "0 attached" is a fact the
                        approver needs, not a defect to paper over. */}
                    {a.evidence_count ?? 0} attached
                  </dd>
                </div>
                <div>
                  <dt style={{ color: "#64748b" }}>Status</dt>
                  <dd style={{ color: "#fcd34d" }}>Awaiting decision</dd>
                </div>
              </dl>

              {err ? (
                <p className="text-xs mt-3" style={{ color: "#fca5a5" }} role="alert">
                  {err}
                </p>
              ) : null}

              {/* Separation of duties, said out loud. */}
              {!decidable ? (
                <p className="text-xs mt-4" style={{ color: "#94a3b8" }}>
                  {currentUserId && a.requested_by_user_id === currentUserId
                    ? "You proposed this acceptance, so someone else has to decide it. Separation of duties."
                    : "Sign in as a named user to decide this acceptance."}
                </p>
              ) : isDraft ? (
                <div className="mt-4">
                  <label
                    htmlFor={`rationale-${a.id}`}
                    className="block text-xs mb-1"
                    style={{ color: "#94a3b8" }}
                  >
                    {draft.decision === "approve"
                      ? "Why is accepting this risk the right call? (recorded on the signed acceptance)"
                      : "Why is this being rejected? (recorded, and shown to the proposer)"}
                  </label>
                  <textarea
                    id={`rationale-${a.id}`}
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    rows={3}
                    className="w-full text-sm p-2 rounded"
                    style={{ background: "#0b1220", border: "1px solid #1e293b", color: "#e2e8f0" }}
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void submitDecision(a)}
                      className="px-3 py-1.5 rounded text-sm font-medium"
                      style={{
                        background: draft.decision === "approve" ? "#166534" : "#7f1d1d",
                        color: "#f8fafc",
                        opacity: submitting ? 0.6 : 1,
                      }}
                    >
                      {submitting
                        ? "Recording…"
                        : draft.decision === "approve"
                          ? "Confirm — accept this risk"
                          : "Confirm — reject"}
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => {
                        setDraft(null);
                        setRationale("");
                      }}
                      className="px-3 py-1.5 rounded text-sm"
                      style={{ background: "transparent", border: "1px solid #334155", color: "#94a3b8" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 mt-4">
                  {/* The next action, obvious, on the row itself. */}
                  <button
                    type="button"
                    onClick={() => {
                      setDraft({ acceptanceId: a.id, decision: "approve" });
                      setRationale("");
                    }}
                    className="px-3 py-1.5 rounded text-sm font-medium"
                    style={{ background: "#166534", color: "#f8fafc" }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft({ acceptanceId: a.id, decision: "reject" });
                      setRationale("");
                    }}
                    className="px-3 py-1.5 rounded text-sm"
                    style={{ background: "transparent", border: "1px solid #7f1d1d", color: "#fca5a5" }}
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Never silently truncate a governance queue: if the page is smaller than the true
          total, say so rather than letting the page length read as "that's all of them". */}
      {total > acceptances.length ? (
        <p className="text-xs mt-4" style={{ color: "#94a3b8" }}>
          Showing {acceptances.length} of {total} awaiting decision.
        </p>
      ) : null}
    </div>
  );
}
