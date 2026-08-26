"use client";

/**
 * CuecDeterminationPanel — where a vendor's stated requirement becomes, or does
 * not become, work for this organisation.
 *
 * This is the step that was missing. Documents were ingested, CUECs extracted
 * and controls mapped, and then the trail stopped: the review vocabulary could
 * only say "no applicable control", which conflated "this does not apply to us"
 * with "this applies and we do not do it". So a SOC 2 review could never produce
 * remediation work.
 *
 * THREE DELIBERATE PROPERTIES OF THIS UI:
 *
 * 1. A GAP MUST BE EXPLAINED. The reason box is required for `gap` and optional
 *    for the others. Recording a gap asserts this organisation fails a control
 *    obligation — it will carry the reviewer's name and may be read by an
 *    auditor. "The tool said so" is not a defence.
 *
 * 2. PROMOTION IS A SECOND, SEPARATE ACT. Determining a gap does NOT create a
 *    finding. An organisation may legitimately record that it does not meet a
 *    requirement and decide, deliberately, not to open remediation yet. Making
 *    one click do both would take that judgement away.
 *
 * 3. SEVERITY HAS NO DEFAULT. It drives the remediation deadline through the
 *    organisation's SLA policy, and a deadline nobody chose is a deadline nobody
 *    owns. The reviewer picks it.
 *
 * The panel also shows WHY a determination was reachable — the mapped controls
 * and their implementation status — so "why is this a gap?" is answerable
 * without leaving the page.
 */

import { useState, useTransition } from "react";
import Link from "next/link";

import type { VendorAssuranceCuec } from "@/lib/api";
import { determineCuec, promoteCuecGapToFinding } from "@/app/actions/vendorAssurance";

const MUTED = "#9ca3af";
const BORDER = "#374151";

const SEVERITIES = ["Critical", "High", "Moderate", "Low"] as const;
type Severity = (typeof SEVERITIES)[number];

const DETERMINATIONS: Array<{
  value: "not_applicable" | "satisfied" | "gap";
  label: string;
  help: string;
  color: string;
  bg: string;
}> = [
  { value: "not_applicable", label: "Doesn't apply to us",
    help: "This requirement is not relevant to how we use this vendor.",
    color: "#94a3b8", bg: "rgba(100,116,139,0.18)" },
  { value: "satisfied", label: "We meet this",
    help: "The requirement applies and we already satisfy it.",
    color: "#86efac", bg: "rgba(22,101,52,0.2)" },
  { value: "gap", label: "We don't meet this",
    help: "Applies to us and we do not satisfy it. This can become remediation work.",
    color: "#fca5a5", bg: "rgba(153,27,27,0.22)" },
];

function fmt(s: string | null | undefined): string {
  if (!s) return "";
  try { return new Date(s).toLocaleDateString(); } catch { return s; }
}

export default function CuecDeterminationPanel({
  documentId,
  cuec,
  canDecide,
}: {
  documentId: string;
  cuec: VendorAssuranceCuec;
  canDecide: boolean;
}): JSX.Element {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<"not_applicable" | "satisfied" | "gap" | null>(null);
  const [reason, setReason] = useState("");
  const [severity, setSeverity] = useState<Severity | "">("");

  const determined = cuec.review_status !== "pending";
  const isGap = cuec.review_status === "gap";
  const promoted = cuec.promoted_finding_id !== null;
  const current = DETERMINATIONS.find((d) => d.value === cuec.review_status);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
      else { setChoosing(null); setReason(""); setSeverity(""); }
    });
  };

  const submit = () => {
    if (choosing === null) return;
    if (choosing === "gap" && reason.trim().length === 0) {
      setError("Please say why this isn't met — the determination is recorded against your name.");
      return;
    }
    run(() => determineCuec(cuec.id, documentId, choosing, reason.trim() || undefined));
  };

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDER}` }}>
      <div style={{ fontSize: 11, color: MUTED, marginBottom: 6 }}>
        Does this apply to your organisation, and do you meet it?
      </div>

      {/* ── recorded determination ─────────────────────────────────────── */}
      {determined && current && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ fontSize: 12, padding: "3px 8px", borderRadius: 999,
                         background: current.bg, color: current.color, border: `1px solid ${current.color}44` }}>
            {current.label}
          </span>
          <span style={{ fontSize: 11, color: MUTED }}>
            recorded {fmt(cuec.review_status_updated_at)}
          </span>
          {canDecide && !promoted && (
            <button type="button" onClick={() => run(() => determineCuec(cuec.id, documentId, "not_applicable"))}
                    disabled={pending}
                    style={{ background: "none", border: "none", color: MUTED, fontSize: 11,
                             textDecoration: "underline", cursor: "pointer", padding: 0 }}
                    title="Clear and decide again">
              Change
            </button>
          )}
        </div>
      )}

      {cuec.review_status_reason && (
        <p style={{ margin: "0 0 8px", fontSize: 12, color: "#cbd5e1", lineHeight: 1.5 }}>
          <span style={{ color: MUTED }}>Reviewer:</span> {cuec.review_status_reason}
        </p>
      )}

      {/* ── why this determination was reachable ───────────────────────── */}
      {cuec.gap_basis?.mapped_controls && cuec.gap_basis.mapped_controls.length > 0 && (
        <details style={{ marginBottom: 8 }}>
          <summary style={{ fontSize: 11, color: MUTED, cursor: "pointer" }}>
            Evidence at the time of this decision
          </summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: "#cbd5e1" }}>
            {cuec.gap_basis.mapped_controls.map((c) => (
              <li key={c.control_id} style={{ marginBottom: 2 }}>
                {c.control_name}
                <span style={{ color: MUTED }}> — {c.implementation_status ?? "no implementation status"}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* ── the resulting finding ──────────────────────────────────────── */}
      {promoted && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: "#86efac" }}>Tracked as a finding</span>
          <Link href={`/findings/${cuec.promoted_finding_id}`}
                style={{ fontSize: 12, color: "#93c5fd", textDecoration: "underline" }}>
            Open the finding
          </Link>
        </div>
      )}

      {/* ── promote a gap ──────────────────────────────────────────────── */}
      {isGap && !promoted && canDecide && (
        <div style={{ marginBottom: 8, padding: 10, borderRadius: 6,
                      background: "rgba(153,27,27,0.10)", border: "1px solid rgba(153,27,27,0.35)" }}>
          <p style={{ margin: "0 0 8px", fontSize: 12, color: "#fecaca", lineHeight: 1.5 }}>
            This gap isn&apos;t being tracked yet. Create a finding to give it an owner and a
            remediation deadline from your SLA policy.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}
                    disabled={pending}
                    style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6,
                             background: "#111827", color: "#e5e7eb", border: `1px solid ${BORDER}` }}>
              {/* No default: severity sets the deadline, so a person chooses it. */}
              <option value="">Choose severity…</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="button" disabled={pending || severity === ""}
                    onClick={() => severity !== "" && run(() => promoteCuecGapToFinding(cuec.id, documentId, severity))}
                    style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                             background: severity === "" ? "#374151" : "#7f1d1d",
                             color: "#fee2e2", border: "1px solid rgba(153,27,27,0.6)" }}>
              {pending ? "Creating…" : "Create finding"}
            </button>
          </div>
        </div>
      )}

      {/* ── record a determination ─────────────────────────────────────── */}
      {canDecide && !determined && choosing === null && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {DETERMINATIONS.map((d) => (
            <button key={d.value} type="button" title={d.help} disabled={pending}
                    onClick={() => { setChoosing(d.value); setReason(""); setError(null); }}
                    style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                             background: "transparent", color: d.color, border: `1px solid ${d.color}55` }}>
              {d.label}
            </button>
          ))}
        </div>
      )}

      {choosing !== null && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000}
            disabled={pending}
            placeholder={choosing === "gap"
              ? "Why don't we meet this? (required — recorded against your name)"
              : "Add context (optional, audit-logged)"}
            style={{ fontSize: 12, padding: 8, borderRadius: 6, background: "#0b1220",
                     color: "#e5e7eb", border: `1px solid ${BORDER}`, resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => { setChoosing(null); setReason(""); setError(null); }}
                    disabled={pending}
                    style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                             background: "transparent", color: MUTED, border: `1px solid ${BORDER}` }}>
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={pending}
                    style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                             background: "#1e40af", color: "#dbeafe", border: "1px solid #1e3a8a" }}>
              {pending ? "Saving…" : "Record"}
            </button>
          </div>
        </div>
      )}

      {!canDecide && !determined && (
        <p style={{ margin: 0, fontSize: 12, color: MUTED }}>
          Awaiting review. You don&apos;t have permission to record a determination.
        </p>
      )}

      {error && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#fca5a5", lineHeight: 1.5 }}>{error}</p>
      )}
    </div>
  );
}
