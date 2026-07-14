"use client";

/**
 * RiskAcceptancePanel — the customer-facing risk-acceptance lifecycle, in the Decision
 * Workspace. It renders a finding's current acceptance and its audit history, and drives
 * the engine's finding risk-acceptance subsystem: propose → approve | reject → withdraw,
 * with expiry and reopen handled server-side.
 *
 * Two rules this panel exists to make visible and honest:
 *   1. A proposal is NOT an approval. Proposing leaves the finding ACTIVE; only a
 *      colleague's approval closes it. The copy never says "closed" for a proposal.
 *   2. Separation of duties. The person who proposed an acceptance may not approve it —
 *      the control refuses here, and the engine refuses again.
 *
 * Rendered only when SECURELOGIC_RISK_ACCEPTANCE_ENABLED is on AND the engine returns the
 * finding's acceptances (two-switch). When dark, the workspace keeps its legacy control.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RiskAcceptance } from "@/lib/api";
import {
  partitionAcceptances,
  acceptanceNarrative,
  canDecide,
  isReviewDueSoon,
  type AcceptanceTone,
} from "./riskAcceptanceView";
import {
  proposeRiskAcceptanceAction,
  approveRiskAcceptanceAction,
  rejectRiskAcceptanceAction,
  withdrawRiskAcceptanceAction,
  attachRiskAcceptanceEvidenceAction,
} from "./riskAcceptanceActions";
import { EVIDENCE_TYPES } from "@/components/findings/findingEvidencePayload";

type Owner = { id: string; label: string };

const TONE_COLOR: Record<AcceptanceTone, string> = {
  pending: "#fcd34d",
  binding: "#86efac",
  reopened: "#93c5fd",
  declined: "#fca5a5",
  legacy: "#c4b5fd",
};

const CARD: React.CSSProperties = {
  background: "rgba(255,255,255,0.02)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: 20,
};
const H: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "#64748b",
  marginBottom: 10,
};
const INPUT: React.CSSProperties = {
  background: "#0f1722",
  border: "1px solid #1e293b",
  color: "#e2e8f0",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
  width: "100%",
};
const BTN: React.CSSProperties = {
  border: "1px solid #475569",
  color: "#cbd5e1",
  background: "transparent",
  borderRadius: 6,
  padding: "6px 12px",
  fontSize: 13,
  cursor: "pointer",
};
const BTN_PRIMARY: React.CSSProperties = {
  ...BTN,
  border: "1px solid #0ea5a0",
  background: "rgba(14,165,160,0.12)",
  color: "#5eead4",
};

function fmt(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Chip({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        fontSize: 11,
        color,
        border: `1px solid ${color}`,
        borderRadius: 999,
        padding: "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 13 }}>
      <span style={{ color: "#64748b", minWidth: 92 }}>{label}</span>
      <span style={{ color: "#cbd5e1" }}>{value}</span>
    </div>
  );
}

export function RiskAcceptancePanel({
  findingId,
  acceptances,
  owners,
  currentUserId,
}: {
  findingId: string;
  acceptances: RiskAcceptance[];
  /** Org members, for choosing an owner and resolving user ids to names. */
  owners: Owner[];
  currentUserId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r?.error) {
        setError(null);
        router.refresh();
      } else {
        setError(r.error);
      }
    });

  const nameOf = (id: string | null): string => {
    if (!id) return "—";
    return owners.find((o) => o.id === id)?.label ?? "a colleague";
  };

  const { live, history } = partitionAcceptances(acceptances);

  return (
    <div style={CARD}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={H}>Risk acceptance</div>
        {live ? <Chip text={acceptanceNarrative(live).label} color={TONE_COLOR[acceptanceNarrative(live).tone]} /> : null}
      </div>

      {error && (
        <p
          role="alert"
          style={{
            fontSize: 13,
            color: "#fca5a5",
            margin: "0 0 10px",
            border: "1px solid rgba(239,68,68,0.35)",
            borderRadius: 6,
            padding: "6px 10px",
            background: "rgba(239,68,68,0.08)",
          }}
        >
          {error}
        </p>
      )}

      {!live ? (
        <ProposeSection
          owners={owners}
          pending={pending}
          onPropose={(input) => run(() => proposeRiskAcceptanceAction(findingId, input))}
        />
      ) : (
        <LiveSection
          findingId={findingId}
          live={live}
          currentUserId={currentUserId}
          pending={pending}
          nameOf={nameOf}
          run={run}
        />
      )}

      {history.length > 0 && <HistorySection history={history} nameOf={nameOf} />}
    </div>
  );
}

// ── Propose ────────────────────────────────────────────────────────────────
function ProposeSection({
  owners,
  pending,
  onPropose,
}: {
  owners: Owner[];
  pending: boolean;
  onPropose: (input: { owner_user_id: string; rationale: string; expires_at: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ownerId, setOwnerId] = useState("");
  const [rationale, setRationale] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  if (!open) {
    return (
      <div>
        <p style={{ fontSize: 13, color: "#94a3b8", margin: "0 0 10px" }}>
          Accepting a risk is a signed governance decision, not a status you set. It stays
          Active until a different authorized colleague approves it, and it comes back for
          review on the date you set.
        </p>
        <button type="button" style={BTN} disabled={pending} onClick={() => setOpen(true)}>
          Propose risk acceptance
        </button>
      </div>
    );
  }

  const ready = ownerId !== "" && rationale.trim() !== "" && expiresAt !== "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>Accountable owner</span>
        <select
          aria-label="Accountable owner"
          value={ownerId}
          onChange={(e) => setOwnerId(e.target.value)}
          style={INPUT}
        >
          <option value="">Select an owner…</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>Rationale</span>
        <textarea
          aria-label="Rationale"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Why is accepting this risk the right call? Note any compensating controls."
          rows={3}
          style={{ ...INPUT, resize: "vertical" }}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>Review / expiration date</span>
        <input
          aria-label="Review or expiration date"
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          style={INPUT}
        />
      </label>

      <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>
        You can attach supporting evidence once it is proposed. A different authorized user
        must approve it before the finding closes.
      </p>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          style={BTN_PRIMARY}
          disabled={pending || !ready}
          onClick={() => onPropose({ owner_user_id: ownerId, rationale: rationale.trim(), expires_at: expiresAt })}
        >
          Propose acceptance
        </button>
        <button type="button" style={BTN} disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Live acceptance (proposed | approved | legacy_unverified) ────────────────
function LiveSection({
  findingId,
  live,
  currentUserId,
  pending,
  nameOf,
  run,
}: {
  findingId: string;
  live: RiskAcceptance;
  currentUserId: string | null;
  pending: boolean;
  nameOf: (id: string | null) => string;
  run: (fn: () => Promise<{ error?: string }>) => void;
}) {
  const narrative = acceptanceNarrative(live);
  const decidable = canDecide(live, currentUserId);
  const reviewSoon = isReviewDueSoon(live, new Date());

  const [mode, setMode] = useState<null | "approve" | "reject" | "withdraw">(null);
  const [rationale, setRationale] = useState("");

  const reset = () => {
    setMode(null);
    setRationale("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ fontSize: 13, color: "#cbd5e1", margin: 0 }}>{narrative.what}</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <Field label="Owner" value={nameOf(live.owner_user_id)} />
        <Field label="Proposed by" value={nameOf(live.requested_by_user_id)} />
        {live.rationale ? <Field label="Rationale" value={live.rationale} /> : null}
        {live.state === "approved" ? <Field label="Approved by" value={nameOf(live.approver_user_id)} /> : null}
        {live.state === "approved" && live.approved_at ? <Field label="Approved" value={fmt(live.approved_at)} /> : null}
        {live.decision_rationale ? <Field label="Decision note" value={live.decision_rationale} /> : null}
        <Field
          label="Review date"
          value={
            <span style={{ color: reviewSoon ? "#fcd34d" : "#cbd5e1" }}>
              {fmt(live.expires_at)}
              {reviewSoon ? " · due for review" : ""}
            </span>
          }
        />
      </div>

      <EvidenceBlock
        findingId={findingId}
        acceptanceId={live.id}
        evidenceCount={live.evidence_count ?? 0}
        pending={pending}
        run={run}
      />

      {/* Proposal: awaiting a DIFFERENT authorized user. */}
      {live.state === "proposed" && (
        <>
          {!decidable && (
            <p style={{ fontSize: 12, color: "#fcd34d", margin: 0 }}>
              You proposed this acceptance. A different authorized user must approve or
              reject it (separation of duties). You can still withdraw it.
            </p>
          )}
          {mode === "approve" || mode === "reject" ? (
            <DecideForm
              intent={mode}
              value={rationale}
              onChange={setRationale}
              pending={pending}
              onCancel={reset}
              onConfirm={() => {
                const action =
                  mode === "approve"
                    ? approveRiskAcceptanceAction(findingId, live.id, { decision_rationale: rationale.trim() || undefined })
                    : rejectRiskAcceptanceAction(findingId, live.id, { decision_rationale: rationale.trim() || undefined });
                run(() => action);
                reset();
              }}
            />
          ) : mode === "withdraw" ? (
            <WithdrawForm
              value={rationale}
              onChange={setRationale}
              pending={pending}
              copy="Withdraw this proposal. The finding stays Active."
              onCancel={reset}
              onConfirm={() => {
                run(() => withdrawRiskAcceptanceAction(findingId, live.id, { reason: rationale.trim() || undefined }));
                reset();
              }}
            />
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" style={BTN_PRIMARY} disabled={pending || !decidable} onClick={() => setMode("approve")}>
                Approve
              </button>
              <button type="button" style={BTN} disabled={pending || !decidable} onClick={() => setMode("reject")}>
                Reject
              </button>
              <button type="button" style={BTN} disabled={pending} onClick={() => setMode("withdraw")}>
                Withdraw
              </button>
            </div>
          )}
        </>
      )}

      {/* Approved & binding: the one way out is withdrawal, which reopens the finding. */}
      {live.state === "approved" &&
        (mode === "withdraw" ? (
          <WithdrawForm
            value={rationale}
            onChange={setRationale}
            pending={pending}
            copy="Withdraw this acceptance. This reopens the finding as Active work."
            onCancel={reset}
            onConfirm={() => {
              run(() => withdrawRiskAcceptanceAction(findingId, live.id, { reason: rationale.trim() || undefined }));
              reset();
            }}
          />
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={BTN} disabled={pending} onClick={() => setMode("withdraw")}>
              Withdraw acceptance
            </button>
          </div>
        ))}

      {/* Legacy: no approval evidence — completing it means withdraw + re-propose. */}
      {live.state === "legacy_unverified" &&
        (mode === "withdraw" ? (
          <WithdrawForm
            value={rationale}
            onChange={setRationale}
            pending={pending}
            copy="Withdraw this historical acceptance. This reopens the finding so it can be re-proposed with full evidence."
            onCancel={reset}
            onConfirm={() => {
              run(() => withdrawRiskAcceptanceAction(findingId, live.id, { reason: rationale.trim() || undefined }));
              reset();
            }}
          />
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={BTN} disabled={pending} onClick={() => setMode("withdraw")}>
              Withdraw & reopen
            </button>
          </div>
        ))}
    </div>
  );
}

function DecideForm({
  intent,
  value,
  onChange,
  pending,
  onCancel,
  onConfirm,
}: {
  intent: "approve" | "reject";
  value: string;
  onChange: (v: string) => void;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <textarea
        aria-label={intent === "approve" ? "Approval note" : "Rejection note"
        }
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          intent === "approve"
            ? "Optional: note the review that supports approving this."
            : "Optional: note why this is being rejected."
        }
        rows={2}
        style={{ ...INPUT, resize: "vertical" }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={intent === "approve" ? BTN_PRIMARY : BTN} disabled={pending} onClick={onConfirm}>
          {intent === "approve" ? "Confirm approval" : "Confirm rejection"}
        </button>
        <button type="button" style={BTN} disabled={pending} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function WithdrawForm({
  value,
  onChange,
  pending,
  copy,
  onCancel,
  onConfirm,
}: {
  value: string;
  onChange: (v: string) => void;
  pending: boolean;
  copy: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={{ fontSize: 12, color: "#94a3b8", margin: 0 }}>{copy}</p>
      <textarea
        aria-label="Withdrawal reason"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Optional: reason for withdrawing."
        rows={2}
        style={{ ...INPUT, resize: "vertical" }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={BTN} disabled={pending} onClick={onConfirm}>
          Confirm withdrawal
        </button>
        <button type="button" style={BTN} disabled={pending} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Evidence on the acceptance ───────────────────────────────────────────────
function EvidenceBlock({
  findingId,
  acceptanceId,
  evidenceCount,
  pending,
  run,
}: {
  findingId: string;
  acceptanceId: string;
  evidenceCount: number;
  pending: boolean;
  run: (fn: () => Promise<{ error?: string }>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<string>(EVIDENCE_TYPES[0]);
  const [ref, setRef] = useState("");

  const submit = () => {
    run(() =>
      attachRiskAcceptanceEvidenceAction(findingId, acceptanceId, {
        title: title.trim(),
        evidence_type: type,
        external_ref: ref.trim() || undefined,
      })
    );
    setTitle("");
    setRef("");
    setOpen(false);
  };

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>Evidence ({evidenceCount})</span>
        {!open && (
          <button type="button" style={{ ...BTN, padding: "3px 10px", fontSize: 12 }} disabled={pending} onClick={() => setOpen(true)}>
            Attach evidence
          </button>
        )}
      </div>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <input
            aria-label="Evidence title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What proves the compensating control or decision — a ticket, a policy, a review."
            style={INPUT}
          />
          <select aria-label="Evidence type" value={type} onChange={(e) => setType(e.target.value)} style={INPUT}>
            {EVIDENCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            aria-label="Evidence link"
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="Optional link (ticket, document URL)."
            style={INPUT}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={BTN_PRIMARY} disabled={pending || title.trim() === ""} onClick={submit}>
              Attach
            </button>
            <button type="button" style={BTN} disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── History (terminal records) ───────────────────────────────────────────────
function HistorySection({
  history,
  nameOf,
}: {
  history: RiskAcceptance[];
  nameOf: (id: string | null) => string;
}) {
  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>History ({history.length})</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {history.map((a) => {
          const n = acceptanceNarrative(a);
          const when = a.withdrawn_at ?? a.approved_at ?? a.updated_at;
          // Attribute only from ids the register actually returns. A rejection names the
          // approver who declined it; a proposal names its requester. (The withdrawer id
          // is stored but not projected, so a withdrawal is dated, not attributed.)
          const actorId = a.state === "rejected" ? a.approver_user_id : a.requested_by_user_id;
          const by = actorId ? nameOf(actorId) : null;
          const note = a.withdrawal_reason ?? a.decision_rationale ?? null;
          return (
            <div key={a.id} style={{ fontSize: 12, color: "#cbd5e1" }}>
              <Chip text={n.label} color={TONE_COLOR[n.tone]} />{" "}
              <span style={{ color: "#94a3b8" }}>
                {fmt(when)}
                {by ? ` · ${by}` : ""}
              </span>
              {note ? <span style={{ color: "#64748b" }}> — {note}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
