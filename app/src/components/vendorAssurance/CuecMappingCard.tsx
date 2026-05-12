"use client";

/**
 * CuecMappingCard — one complementary user entity control statement and its
 * mapping status against the customer's controls inventory.
 *
 * State display (CUEC mapping is its own workflow — never locked by the
 * extraction's approve/reject state):
 *   - review_status === 'reviewed_no_match' → "No applicable control in your
 *     inventory" (+ reason on hover) + an "Undo" affordance.
 *   - ≥ 1 accepted mapping → the accepted controls as chips + "Add another
 *     mapping" (ControlPicker); suggested/dismissed mappings under a disclosure.
 *   - otherwise (pending, nothing accepted) → suggested mappings as cards with
 *     Accept / Dismiss, a ControlPicker to add a different control, and a
 *     "Mark as no applicable control" affordance.
 *
 * Dismiss and "mark no applicable control" require a reason — captured via a
 * small inline form (like DocumentActions). Accept / add / undo are one click.
 */

import { useMemo, useState, useTransition } from "react";
import type { VendorAssuranceCuec, VendorAssuranceCuecMapping, ControlSummary } from "@/lib/api";
import {
  acceptCuecMapping,
  dismissCuecMapping,
  createManualCuecMapping,
  markCuecNoMatch,
  clearCuecNoMatch,
} from "@/app/actions/vendorAssurance";
import ControlPicker from "./ControlPicker";

type Props = {
  documentId: string;
  cuec: VendorAssuranceCuec;
  highConfidenceThreshold: number;
};

const BORDER = "#374151";
const MUTED = "#9ca3af";

function fmt(s: string | null | undefined): string {
  if (!s) return "";
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

function scoreLabel(score: number | null, high: number): { text: string; color: string } | null {
  if (score === null) return null;
  if (score >= high) return { text: `High confidence (${score})`, color: "#86efac" };
  return { text: `Suggested (${score})`, color: "#fcd34d" };
}

export default function CuecMappingCard({ documentId, cuec, highConfidenceThreshold }: Props): JSX.Element {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Inline reason form: which action it belongs to (mappingId for dismiss, or 'no_match' for the CUEC).
  const [reasonFor, setReasonFor] = useState<{ kind: "dismiss"; mappingId: string } | { kind: "no_match" } | null>(null);
  const [reasonText, setReasonText] = useState("");

  const accepted = useMemo(() => cuec.mappings.filter((m) => m.mapping_status === "accepted"), [cuec.mappings]);
  const suggested = useMemo(() => cuec.mappings.filter((m) => m.mapping_status === "suggested"), [cuec.mappings]);
  const dismissed = useMemo(() => cuec.mappings.filter((m) => m.mapping_status === "dismissed"), [cuec.mappings]);
  const mappedControlIds = useMemo(() => new Set(cuec.mappings.map((m) => m.control_id)), [cuec.mappings]);
  const isNoMatch = cuec.review_status === "reviewed_no_match";

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else { setReasonFor(null); setReasonText(""); }
    });
  };

  const onAccept = (m: VendorAssuranceCuecMapping) => run(() => acceptCuecMapping(m.id, documentId));
  const onAddControl = (c: ControlSummary) => run(() => createManualCuecMapping(cuec.id, c.id, documentId));
  const onUndoNoMatch = () => run(() => clearCuecNoMatch(cuec.id, documentId));
  const submitReason = () => {
    if (reasonFor === null) return;
    if (reasonText.trim().length === 0) { setError("A reason is required."); return; }
    if (reasonFor.kind === "dismiss") {
      run(() => dismissCuecMapping(reasonFor.mappingId, documentId, reasonText.trim()));
    } else {
      run(() => markCuecNoMatch(cuec.id, documentId, reasonText.trim()));
    }
  };

  const reasonForm = reasonFor !== null && (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <textarea
        value={reasonText}
        onChange={(e) => setReasonText(e.target.value)}
        rows={2}
        maxLength={1000}
        disabled={pending}
        placeholder={reasonFor.kind === "dismiss" ? "Why dismiss this match? (audit-logged)" : "Why is there no applicable control? (audit-logged, optional context)"}
        style={textareaStyle}
      />
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <button type="button" onClick={() => { setReasonFor(null); setReasonText(""); setError(null); }} disabled={pending} style={ghostBtn}>Cancel</button>
        <button type="button" onClick={submitReason} disabled={pending} style={primaryBtn}>{pending ? "Saving…" : "Confirm"}</button>
      </div>
    </div>
  );

  return (
    <article style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 11, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{cuec.ordinal + 1}.</span>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{cuec.cuec_text}</p>
      </div>

      <div style={{ marginTop: 10 }}>
        {/* --- reviewed: no applicable control --- */}
        {isNoMatch && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span
              title={cuec.review_status_reason ? `Reason: ${cuec.review_status_reason}\nMarked ${fmt(cuec.review_status_updated_at)}` : `Marked ${fmt(cuec.review_status_updated_at)}`}
              style={{ fontSize: 12, padding: "3px 8px", borderRadius: 999, background: "rgba(202,138,4,0.18)", color: "#fcd34d", border: "1px solid rgba(202,138,4,0.4)", cursor: "help" }}
            >
              No applicable control in your inventory
            </span>
            <button type="button" onClick={onUndoNoMatch} disabled={pending} style={linkBtn}>Undo</button>
          </div>
        )}

        {/* --- has accepted mapping(s) --- */}
        {!isNoMatch && accepted.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>Mapped to your control{accepted.length === 1 ? "" : "s"}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {accepted.map((m) => (
                <span key={m.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, padding: "3px 8px", borderRadius: 999, background: "rgba(22,101,52,0.2)", color: "#86efac", border: "1px solid #166534" }}>
                  {m.control_name}{m.control_status !== "active" ? <span style={{ color: MUTED }}> · {m.control_status}</span> : null}
                  <button type="button" onClick={() => setReasonFor({ kind: "dismiss", mappingId: m.id })} disabled={pending} title="Remove this mapping" style={{ ...linkBtn, color: "#fca5a5", fontSize: 11 }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ maxWidth: 420 }}>
              <ControlPicker onSelect={onAddControl} disabled={pending} placeholder="Add another control…" excludeIds={mappedControlIds} />
            </div>
            {(suggested.length > 0 || dismissed.length > 0) && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: "pointer", color: MUTED, fontSize: 12 }}>
                  {suggested.length} more suggestion{suggested.length === 1 ? "" : "s"} · {dismissed.length} dismissed
                </summary>
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                  {suggested.map((m) => <SuggestionRow key={m.id} m={m} high={highConfidenceThreshold} pending={pending} onAccept={() => onAccept(m)} onDismiss={() => setReasonFor({ kind: "dismiss", mappingId: m.id })} />)}
                  {dismissed.map((m) => (
                    <div key={m.id} style={{ fontSize: 12, color: MUTED }} title={m.reason ? `Reason: ${m.reason}` : undefined}>
                      <span style={{ textDecoration: "line-through" }}>{m.control_name}</span> — dismissed
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {/* --- pending: show suggestions + add + mark-no-match --- */}
        {!isNoMatch && accepted.length === 0 && (
          <div>
            {suggested.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                {suggested.map((m) => <SuggestionRow key={m.id} m={m} high={highConfidenceThreshold} pending={pending} onAccept={() => onAccept(m)} onDismiss={() => setReasonFor({ kind: "dismiss", mappingId: m.id })} />)}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: MUTED, marginBottom: 8 }}>No automatic matches found for this CUEC.</div>
            )}
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 320px", minWidth: 240 }}>
                <ControlPicker onSelect={onAddControl} disabled={pending} placeholder="Search your inventory for the right control…" excludeIds={mappedControlIds} />
              </div>
              <button type="button" onClick={() => setReasonFor({ kind: "no_match" })} disabled={pending || reasonFor !== null} style={ghostBtn}>
                Mark as no applicable control
              </button>
            </div>
            {dismissed.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: "pointer", color: MUTED, fontSize: 12 }}>{dismissed.length} dismissed</summary>
                <div style={{ marginTop: 6 }}>
                  {dismissed.map((m) => (
                    <div key={m.id} style={{ fontSize: 12, color: MUTED }} title={m.reason ? `Reason: ${m.reason}` : undefined}>
                      <span style={{ textDecoration: "line-through" }}>{m.control_name}</span> — dismissed
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {reasonForm}
        {error && <div style={{ marginTop: 8, fontSize: 12, color: "#fca5a5" }}>{error}</div>}
      </div>
    </article>
  );
}

function SuggestionRow({ m, high, pending, onAccept, onDismiss }: {
  m: VendorAssuranceCuecMapping; high: number; pending: boolean; onAccept: () => void; onDismiss: () => void;
}): JSX.Element {
  const chip = scoreLabel(m.mapping_score, high);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "6px 8px" }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{m.control_name}</span>
      {m.control_status !== "active" && <span style={{ fontSize: 11, color: MUTED }}>({m.control_status})</span>}
      {chip && <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 999, background: "rgba(31,41,55,0.6)", color: chip.color }}>{chip.text}</span>}
      {m.control_description && <span style={{ fontSize: 11, color: MUTED, flex: "1 1 200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.control_description}</span>}
      <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
        <button type="button" onClick={onAccept} disabled={pending} style={primaryBtn}>Accept</button>
        <button type="button" onClick={onDismiss} disabled={pending} style={dangerBtn}>Dismiss</button>
      </span>
    </div>
  );
}

const textareaStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: 8, borderRadius: 6, border: `1px solid ${BORDER}`,
  background: "#020617", color: "#e5e7eb", fontSize: 12, resize: "vertical",
};
const primaryBtn: React.CSSProperties = { padding: "4px 10px", borderRadius: 4, border: "none", background: "#16a34a", color: "#fff", fontSize: 12, cursor: "pointer" };
const dangerBtn: React.CSSProperties = { padding: "4px 10px", borderRadius: 4, border: "none", background: "#b91c1c", color: "#fff", fontSize: 12, cursor: "pointer" };
const ghostBtn: React.CSSProperties = { padding: "4px 10px", borderRadius: 4, border: `1px solid ${BORDER}`, background: "transparent", color: "#9ca3af", fontSize: 12, cursor: "pointer" };
const linkBtn: React.CSSProperties = { background: "transparent", border: "none", color: "#93c5fd", cursor: "pointer", fontSize: 12, padding: 0 };
