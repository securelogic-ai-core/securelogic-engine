"use client";

/**
 * EngagementActionPanel — every workflow action the reviewer can take on an
 * engagement, in workflow order.
 *
 * The panel only OFFERS what the mirrored state machine
 * (@/lib/vendorEngagements) says is available; everything else renders
 * disabled WITH its actionUnavailableReason. The engine remains the enforcer —
 * when it refuses anyway (a 409 from a concurrent transition), the engine's
 * own reason string is shown verbatim, and the page re-render from the server
 * action's revalidate brings the panel back in sync.
 *
 * Issuance (goal §A/§B) is the IssueQuestionnaireFlow: recipient chosen from
 * the vendor's contact directory, invitation composed and SENT by SecureLogic.
 * The raw token still comes back once as the secondary "copy secure link"
 * recovery path — built client-side at display time, never persisted here.
 *
 * Every transition awaits its server action inside try/catch (the VO 2.0
 * walkthrough crash class): a call that rejects before reaching the app is
 * reported in this panel, never thrown into the route.
 */

import { useState, useTransition } from "react";
import {
  type EngagementState,
  type EngagementAction,
  isActionAvailable,
  actionUnavailableReason,
  isTerminal,
  ENGAGEMENT_STATE_LABELS,
  RISK_BANDS,
} from "@/lib/vendorEngagements";
import {
  VENDOR_ENGAGEMENT_DECISIONS,
  type VendorEngagementDecision,
  type VendorContact,
  type VendorEngagementInviteSummary,
} from "@/lib/api";
import IssueQuestionnaireFlow, { DELIVERY_COPY } from "./IssueQuestionnaireFlow";
import {
  resolveScope,
  overrideInherent,
  revokeInvite,
  beginReview,
  completeAnalysis,
  recomputeRisk,
  recordDecision,
  startMonitoring,
  promoteFindings,
} from "@/app/actions/vendorEngagements";

type Props = {
  engagementId: string;
  state: EngagementState;
  inherentRating: string | null;
  /** Goal §A: the recipient comes from the vendor's contact directory. */
  vendorId: string;
  vendorName: string;
  organizationName: string;
  contacts: VendorContact[];
  contactsLoadFailed: boolean;
  /** Goal §B: whether and how the current invitation was delivered. */
  invite: VendorEngagementInviteSummary | null;
};

type OpenForm = "none" | "issue" | "reissue" | "revoke" | "override" | "decide" | "monitoring";

export const TRANSPORT_FAILURE =
  "The request did not reach SecureLogic, so nothing was changed. Check your connection and try again.";

/** States in which a vendor can still use a link, so an invitation can be replaced or revoked. */
const INVITE_OPEN_STATES: readonly EngagementState[] = ["issued", "in_progress", "clarification_requested"];

const DECISION_LABELS: Record<VendorEngagementDecision, string> = {
  approved: "Approved",
  approved_with_conditions: "Approved with conditions",
  rejected: "Rejected",
  terminated: "Terminated",
};

export default function EngagementActionPanel({
  engagementId,
  state,
  inherentRating,
  vendorId,
  vendorName,
  organizationName,
  contacts,
  contactsLoadFailed,
  invite,
}: Props): JSX.Element {
  const [openForm, setOpenForm] = useState<OpenForm>("none");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Form fields
  const [revokeReason, setRevokeReason] = useState("");
  const [overrideRating, setOverrideRating] = useState(inherentRating ?? "");
  const [overrideRationale, setOverrideRationale] = useState("");
  const [decision, setDecision] = useState<VendorEngagementDecision>("approved");
  const [decisionRationale, setDecisionRationale] = useState("");
  const [decisionExpires, setDecisionExpires] = useState("");
  const [cadenceDays, setCadenceDays] = useState("365");
  const [explicitDue, setExplicitDue] = useState("");

  const run = (fn: () => Promise<{ ok: boolean } & Record<string, unknown>>, onOk?: (r: never) => void) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      // A server-action call can REJECT before any request reaches the app
      // (Safari's `TypeError: Load failed`, a dropped connection, a deploy in
      // flight). Under React 19 an unhandled rejection inside a transition is
      // re-thrown during render and, with no error boundary on this route,
      // replaces the whole page with Next's "client-side exception" screen —
      // the VO 2.0 walkthrough crash. The refusal belongs here, with the form
      // intact, and the message must say nothing was changed.
      let r: { ok: boolean } & Record<string, unknown>;
      try {
        r = await fn();
      } catch {
        setError(TRANSPORT_FAILURE);
        return;
      }
      if (r.ok) {
        setOpenForm("none");
        if (onOk) onOk(r as never);
      } else {
        setError(String((r as { error?: string }).error ?? "Action failed"));
      }
    });
  };

  const toggleForm = (form: OpenForm) => {
    setError(null);
    setOpenForm((cur) => (cur === form ? "none" : form));
  };

  if (isTerminal(state)) {
    return (
      <section style={card()}>
        <h2 style={h2()}>Actions</h2>
        <p style={{ color: "#9ca3af", fontSize: 13, margin: 0 }}>
          This engagement is {ENGAGEMENT_STATE_LABELS[state].toLowerCase()} — no further
          workflow actions apply.
        </p>
      </section>
    );
  }

  const monitoringRefresh = state === "monitoring";

  return (
    <section style={card()}>
      <h2 style={h2()}>Actions</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <ActionRow
          action="resolve_scope"
          state={state}
          label={state === "scoped" ? "Recompose assessment" : "Compose assessment"}
          pending={pending}
          onClick={() =>
            run(
              () => resolveScope(engagementId),
              (r: { scoped: number; excluded: number }) =>
                setNotice(
                  r.scoped === 0
                    ? "Composed: no formal questionnaire is required for this relationship — see the composition below."
                    : `Composed: ${r.scoped} requirement${r.scoped === 1 ? "" : "s"} selected, ${r.excluded} not applicable or not required. Review the composition below before sending.`
                )
            )
          }
        />
        <ActionRow
          action="override_inherent"
          state={state}
          label="Override inherent rating"
          pending={pending}
          active={openForm === "override"}
          onClick={() => toggleForm("override")}
        />
        {openForm === "override" && (
          <InlineForm>
            <label style={lbl()}>
              Rating
              <select
                value={overrideRating}
                onChange={(e) => setOverrideRating(e.target.value)}
                disabled={pending}
                style={input()}
              >
                <option value="">Select…</option>
                {RISK_BANDS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label style={lbl()}>
              Rationale (required — recorded against the engagement)
              <textarea
                value={overrideRationale}
                onChange={(e) => setOverrideRationale(e.target.value)}
                rows={2}
                disabled={pending}
                style={input()}
                placeholder="Explain why the calculated rating is wrong (min 10 characters)."
              />
            </label>
            <FormButtons
              pending={pending}
              submitLabel="Record override"
              disabled={!overrideRating || overrideRationale.trim().length < 10}
              onCancel={() => setOpenForm("none")}
              onSubmit={() =>
                run(
                  () => overrideInherent(engagementId, overrideRating, overrideRationale.trim()),
                  () => setNotice(`Inherent rating overridden to ${overrideRating}.`)
                )
              }
            />
          </InlineForm>
        )}

        <ActionRow
          action="issue"
          state={state}
          label="Send questionnaire to vendor"
          pending={pending}
          active={openForm === "issue"}
          onClick={() => toggleForm("issue")}
        />
        {openForm === "issue" && (
          <IssueQuestionnaireFlow
            engagementId={engagementId}
            vendorId={vendorId}
            vendorName={vendorName}
            organizationName={organizationName}
            contacts={contacts}
            contactsLoadFailed={contactsLoadFailed}
            previousRecipientIds={invite?.latest?.contact_id ? [invite.latest.contact_id] : []}
            mode="issue"
            onCancel={() => setOpenForm("none")}
          />
        )}

        <ActionRow
          action="begin_review"
          state={state}
          label="Begin review"
          pending={pending}
          onClick={() =>
            run(
              () => beginReview(engagementId),
              () => setNotice("Review opened.")
            )
          }
        />
        <ActionRow
          action="complete_analysis"
          state={state}
          label="Complete analysis"
          pending={pending}
          onClick={() =>
            run(
              () => completeAnalysis(engagementId),
              (r: { analysisCoverage: string }) =>
                setNotice(`Analysis complete. Recorded coverage: ${r.analysisCoverage}.`)
            )
          }
        />
        <ActionRow
          action="recompute"
          state={state}
          label={
            state === "analysis_complete"
              ? "Recompute risk (advances to Decision pending)"
              : "Recompute risk"
          }
          pending={pending}
          onClick={() =>
            run(
              () => recomputeRisk(engagementId),
              (r: {
                residualRating: string;
                residualScore: number;
                effectivenessScore: number;
                inherentUnderstated: boolean;
              }) =>
                setNotice(
                  `Recomputed: effectiveness ${r.effectivenessScore}, residual ${r.residualScore} (${r.residualRating}).` +
                    (r.inherentUnderstated
                      ? " Note: the assessed responses suggest inherent risk was UNDERSTATED at intake."
                      : "")
                )
            )
          }
        />

        <ActionRow
          action="decide"
          state={state}
          label="Record decision"
          pending={pending}
          active={openForm === "decide"}
          onClick={() => toggleForm("decide")}
        />
        {openForm === "decide" && (
          <InlineForm>
            <label style={lbl()}>
              Decision
              <select
                value={decision}
                onChange={(e) => setDecision(e.target.value as VendorEngagementDecision)}
                disabled={pending}
                style={input()}
              >
                {VENDOR_ENGAGEMENT_DECISIONS.map((d) => (
                  <option key={d} value={d}>
                    {DECISION_LABELS[d]}
                  </option>
                ))}
              </select>
            </label>
            <label style={lbl()}>
              Rationale (required — part of the audit record)
              <textarea
                value={decisionRationale}
                onChange={(e) => setDecisionRationale(e.target.value)}
                rows={3}
                disabled={pending}
                style={input()}
                placeholder="A governance decision is recorded with its reasoning (min 10 characters)."
              />
            </label>
            <label style={lbl()}>
              Decision expires (optional)
              <input
                type="date"
                value={decisionExpires}
                onChange={(e) => setDecisionExpires(e.target.value)}
                disabled={pending}
                style={input()}
              />
            </label>
            <p style={{ color: "#9ca3af", fontSize: 12, margin: 0 }}>
              Recording a decision does not change the residual measurement — accepting a risk
              does not make it smaller.
            </p>
            <FormButtons
              pending={pending}
              submitLabel="Record decision"
              disabled={decisionRationale.trim().length < 10}
              onCancel={() => setOpenForm("none")}
              onSubmit={() =>
                run(
                  () =>
                    recordDecision(
                      engagementId,
                      decision,
                      decisionRationale.trim(),
                      decisionExpires || undefined
                    ),
                  () => setNotice(`Decision recorded: ${DECISION_LABELS[decision]}.`)
                )
              }
            />
          </InlineForm>
        )}

        <ActionRow
          action="start_monitoring"
          state={state}
          label={monitoringRefresh ? "Record periodic review (reset the clock)" : "Start monitoring"}
          pending={pending}
          active={openForm === "monitoring"}
          onClick={() => toggleForm("monitoring")}
        />
        {openForm === "monitoring" && (
          <InlineForm>
            <label style={lbl()}>
              Review cadence (days, 1–3650)
              <input
                type="number"
                min={1}
                max={3650}
                value={cadenceDays}
                onChange={(e) => setCadenceDays(e.target.value)}
                disabled={pending}
                style={input()}
              />
            </label>
            <label style={lbl()}>
              …or an explicit next review date
              <input
                type="date"
                value={explicitDue}
                onChange={(e) => setExplicitDue(e.target.value)}
                disabled={pending}
                style={input()}
              />
            </label>
            <p style={{ color: "#9ca3af", fontSize: 12, margin: 0 }}>
              Monitoring without a review date is not monitoring.{" "}
              {monitoringRefresh &&
                "Recording a review re-arms the overdue and reassessment signals."}
            </p>
            <FormButtons
              pending={pending}
              submitLabel={monitoringRefresh ? "Record review" : "Start monitoring"}
              disabled={
                !explicitDue &&
                !(Number.isInteger(Number(cadenceDays)) && Number(cadenceDays) >= 1 && Number(cadenceDays) <= 3650)
              }
              onCancel={() => setOpenForm("none")}
              onSubmit={() =>
                run(
                  () =>
                    startMonitoring(engagementId, {
                      ...(explicitDue
                        ? { nextReviewDue: explicitDue }
                        : { cadenceDays: Number(cadenceDays) }),
                    }),
                  (r: { nextReviewDue: string }) =>
                    setNotice(`Monitoring set. Next review due ${r.nextReviewDue}.`)
                )
              }
            />
          </InlineForm>
        )}

        <ActionRow
          action="promote_findings"
          state={state}
          label="Promote gaps to Findings"
          pending={pending}
          onClick={() =>
            run(
              () => promoteFindings(engagementId),
              (r: {
                result: {
                  promoted: number;
                  created: number;
                  updated: number;
                  superseded_by_source?: Array<{ finding_id: string }>;
                };
              }) => {
                const base =
                  r.result.promoted === 0
                    ? "No promotable gaps — no failed, partial or unanswered controls."
                    : `Promoted ${r.result.promoted} control gap${r.result.promoted === 1 ? "" : "s"} to Findings (${r.result.created} new, ${r.result.updated} updated).`;
                // Supersede-on-pass ruling: a pass closes nothing — the human
                // is told, here, that open findings now have passing controls.
                const superseded = r.result.superseded_by_source?.length ?? 0;
                setNotice(
                  superseded === 0
                    ? base
                    : `${base} ${superseded} open finding${superseded === 1 ? "" : "s"} NOT auto-closed — the source now reports pass or N/A for ${superseded === 1 ? "its control" : "their controls"}; review and close through the normal gate.`
                );
              }
            )
          }
        />
      </div>

      {invite?.latest && INVITE_OPEN_STATES.includes(state) && (
        <div
          style={{ marginTop: 14, padding: 12, border: "1px solid #1f2937", borderRadius: 8, background: "#0b1220" }}
          aria-label="Invitation"
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
            <span style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Invitation</span>
            <span style={{ fontSize: 11, color: "#6b7280" }}>
              {invite.history_count > 1 && `${invite.history_count} invitations · `}
              {/* ISO calendar date, not toLocaleDateString(): this client component is
                  server-rendered too, and locale/timezone formatting that differs between
                  the server and the browser is a React hydration mismatch (#418). */}
              {invite.active ? `expires ${invite.active.expires_at.slice(0, 10)}` : "no active link"}
            </span>
          </div>
          {(() => {
            const cur = invite.active ?? invite.latest!;
            const delivery = DELIVERY_COPY[cur.email_delivery_state];
            const tone = delivery.tone === "ok" ? "#86efac" : delivery.tone === "warn" ? "#fde68a" : "#9ca3af";
            return (
              <>
                <div style={{ fontSize: 13, color: "#e5e7eb", marginTop: 4 }}>
                  {cur.contact_name ?? cur.contact_email}
                  <span style={{ color: "#9ca3af" }}> · {cur.contact_email}</span>
                  {cur.due_date && <span style={{ color: "#9ca3af" }}> · response due {cur.due_date}</span>}
                </div>
                <div style={{ fontSize: 12, color: tone, marginTop: 2 }}>
                  {invite.active ? delivery.text : cur.revoked_at ? `Access revoked${cur.revocation_reason ? ` — ${cur.revocation_reason}` : ""}.` : "The link has expired."}
                  {cur.email_delivery_detail && invite.active && <span style={{ color: "#9ca3af" }}> ({cur.email_delivery_detail})</span>}
                  {invite.active && (
                    <span style={{ color: "#9ca3af" }}>
                      {" "}
                      · {cur.exchange_count === 0 ? "not opened yet" : `opened ${cur.exchange_count} time${cur.exchange_count === 1 ? "" : "s"}`}
                    </span>
                  )}
                </div>
              </>
            );
          })()}
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button type="button" disabled={pending} onClick={() => toggleForm("reissue")} style={smallButton(openForm === "reissue")}>
              {invite.active ? "Resend or change recipient" : "Send a new invitation"}
            </button>
            {invite.active && (
              <button type="button" disabled={pending} onClick={() => toggleForm("revoke")} style={smallButton(openForm === "revoke")}>
                Revoke access
              </button>
            )}
          </div>
          {openForm === "reissue" && (
            <IssueQuestionnaireFlow
              engagementId={engagementId}
              vendorId={vendorId}
              vendorName={vendorName}
              organizationName={organizationName}
              contacts={contacts}
              contactsLoadFailed={contactsLoadFailed}
              previousRecipientIds={invite.latest.contact_id ? [invite.latest.contact_id] : []}
              mode="reissue"
              onCancel={() => setOpenForm("none")}
            />
          )}
          {openForm === "revoke" && (
            <InlineForm>
              <label style={lbl()}>
                Reason (optional — recorded on the invitation)
                <input value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} disabled={pending} style={input()} />
              </label>
              <p style={{ color: "#9ca3af", fontSize: 12, margin: 0 }}>
                Revoking stops the link and any open vendor session immediately. Answers already given are kept.
              </p>
              <FormButtons
                pending={pending}
                submitLabel="Revoke access"
                disabled={false}
                onCancel={() => setOpenForm("none")}
                onSubmit={() =>
                  run(
                    () => revokeInvite(engagementId, revokeReason.trim() || undefined),
                    (r: { sessionsRevoked: number }) =>
                      setNotice(`Access revoked${r.sessionsRevoked > 0 ? ` (${r.sessionsRevoked} open session${r.sessionsRevoked === 1 ? "" : "s"} ended)` : ""}. Send a new invitation when ready.`)
                  )
                }
              />
            </InlineForm>
          )}
        </div>
      )}

      {notice && (
        <div style={{ marginTop: 12, fontSize: 13, color: "#86efac" }}>{notice}</div>
      )}
      {error && (
        <div style={{ marginTop: 12, fontSize: 13, color: "#fca5a5" }}>{error}</div>
      )}
    </section>
  );
}

function smallButton(active: boolean): React.CSSProperties {
  return {
    padding: "5px 12px",
    borderRadius: 6,
    border: active ? "1px solid #2563eb" : "1px solid #374151",
    background: active ? "rgba(37,99,235,0.15)" : "transparent",
    color: active ? "#93c5fd" : "#d1d5db",
    fontSize: 12,
    cursor: "pointer",
  };
}

function ActionRow({
  action,
  state,
  label,
  pending,
  onClick,
  active = false,
}: {
  action: EngagementAction;
  state: EngagementState;
  label: string;
  pending: boolean;
  onClick: () => void;
  active?: boolean;
}): JSX.Element {
  const available = isActionAvailable(action, state);
  const reason = actionUnavailableReason(action, state);
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
      <button
        type="button"
        onClick={onClick}
        disabled={!available || pending}
        style={{
          padding: "7px 14px",
          borderRadius: 6,
          border: active ? "1px solid #2563eb" : "1px solid #374151",
          background: !available || pending ? "#111827" : active ? "rgba(37,99,235,0.15)" : "#1f2937",
          color: !available || pending ? "#6b7280" : active ? "#93c5fd" : "#e5e7eb",
          cursor: !available || pending ? "not-allowed" : "pointer",
          fontSize: 13,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </button>
      {!available && reason && (
        <span style={{ color: "#6b7280", fontSize: 12, flex: "1 1 260px" }}>{reason}</span>
      )}
    </div>
  );
}

function InlineForm({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 14,
        borderRadius: 8,
        border: "1px solid #1f2937",
        background: "rgba(2,6,23,0.6)",
        maxWidth: 520,
      }}
    >
      {children}
    </div>
  );
}

function FormButtons({
  pending,
  submitLabel,
  disabled,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  submitLabel: string;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}): JSX.Element {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        style={{
          padding: "6px 12px",
          borderRadius: 6,
          border: "1px solid #374151",
          background: "transparent",
          color: "#9ca3af",
          cursor: pending ? "not-allowed" : "pointer",
          fontSize: 13,
        }}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={pending || disabled}
        style={{
          padding: "6px 14px",
          borderRadius: 6,
          border: "none",
          background: pending || disabled ? "#1f2937" : "#2563eb",
          color: pending || disabled ? "#6b7280" : "#fff",
          cursor: pending || disabled ? "not-allowed" : "pointer",
          fontSize: 13,
        }}
      >
        {pending ? "Working…" : submitLabel}
      </button>
    </div>
  );
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

function lbl(): React.CSSProperties {
  return { display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "#d1d5db" };
}

function input(): React.CSSProperties {
  return {
    padding: "7px 10px",
    borderRadius: 6,
    border: "1px solid #374151",
    background: "#020617",
    color: "#e5e7eb",
    fontSize: 13,
  };
}
