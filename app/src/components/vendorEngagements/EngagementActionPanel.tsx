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
 * The issue flow displays the vendor invite link EXACTLY ONCE: the engine
 * returns the raw token a single time (only its hash is stored), so the URL is
 * built client-side at display time and never persisted anywhere in the app.
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
  portalInviteUrl,
} from "@/lib/vendorEngagements";
import { VENDOR_ENGAGEMENT_DECISIONS, type VendorEngagementDecision } from "@/lib/api";
import {
  resolveScope,
  overrideInherent,
  issueEngagement,
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
};

type OpenForm = "none" | "issue" | "override" | "decide" | "monitoring";

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
}: Props): JSX.Element {
  const [openForm, setOpenForm] = useState<OpenForm>("none");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteExpires, setInviteExpires] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  // Form fields
  const [contactEmail, setContactEmail] = useState("");
  const [contactName, setContactName] = useState("");
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
      const r = await fn();
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
          label={state === "scoped" ? "Re-resolve questionnaire scope" : "Resolve questionnaire scope"}
          pending={pending}
          onClick={() =>
            run(
              () => resolveScope(engagementId),
              (r: { scoped: number; excluded: number }) =>
                setNotice(`Scope resolved: ${r.scoped} requirements in scope, ${r.excluded} excluded.`)
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
          label="Issue to vendor"
          pending={pending}
          active={openForm === "issue"}
          onClick={() => toggleForm("issue")}
        />
        {openForm === "issue" && (
          <InlineForm>
            <label style={lbl()}>
              Vendor contact email
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                disabled={pending}
                style={input()}
                placeholder="security@vendor.example"
              />
            </label>
            <label style={lbl()}>
              Contact name (optional)
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                disabled={pending}
                style={input()}
              />
            </label>
            <FormButtons
              pending={pending}
              submitLabel="Issue questionnaire"
              disabled={!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail.trim())}
              onCancel={() => setOpenForm("none")}
              onSubmit={() =>
                run(
                  () =>
                    issueEngagement(
                      engagementId,
                      contactEmail.trim(),
                      contactName.trim() || undefined
                    ),
                  (r: { inviteToken: string; expiresAt: string }) => {
                    setInviteUrl(portalInviteUrl(window.location.origin, r.inviteToken));
                    setInviteExpires(r.expiresAt);
                    setCopied(false);
                  }
                )
              }
            />
          </InlineForm>
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

      {inviteUrl && (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 8,
            border: "1px solid #a16207",
            background: "rgba(161,98,7,0.12)",
          }}
        >
          <div style={{ color: "#fcd34d", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Vendor invite link — shown once, copy it now
          </div>
          <div style={{ color: "#9ca3af", fontSize: 12, marginBottom: 8 }}>
            Only a hash of this token is stored. Once you leave this page the link cannot be
            recovered — send it to the vendor contact now.
            {inviteExpires && ` Expires ${new Date(inviteExpires).toLocaleDateString()}.`}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <code
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                background: "#020617",
                border: "1px solid #374151",
                color: "#e5e7eb",
                fontSize: 12,
                wordBreak: "break-all",
                flex: "1 1 320px",
              }}
            >
              {inviteUrl}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(inviteUrl).then(() => setCopied(true));
              }}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid #a16207",
                background: copied ? "rgba(22,101,52,0.2)" : "transparent",
                color: copied ? "#86efac" : "#fcd34d",
                cursor: "pointer",
                fontSize: 13,
                whiteSpace: "nowrap",
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
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
