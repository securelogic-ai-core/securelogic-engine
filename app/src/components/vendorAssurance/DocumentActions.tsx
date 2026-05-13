"use client";

/**
 * DocumentActions — the document-level review controls in the sticky page
 * header. When the document is in 'extracted' state it offers Approve / Request
 * Manual Review / Reject Extraction (the last two with a required-/optional-note
 * inline form). In any other state the review buttons are replaced by a status
 * chip confirming the outcome. All three call thin server-action proxies; the
 * action revalidates the document path, so a successful transition re-renders
 * the page.
 *
 * In every state with content to hand off (anything but the in-flight / failed
 * states) it also offers "Export Excel" / "Export PDF" — same-origin downloads
 * of the reviewed-state artifacts (engine builds them; this just points the
 * browser at /api/vendor-assurance/<id>/export.<format>).
 */

import { useState, useTransition } from "react";
import type { VendorAssuranceProcessingStatus } from "@/lib/api";
import { approveDocument, requestManualReview, rejectExtraction } from "@/app/actions/vendorAssurance";

type Props = {
  documentId: string;
  status: VendorAssuranceProcessingStatus;
  approvedAt: string | null;
  finalizedAt: string | null;
};

type OpenForm = "none" | "reject" | "manual_review";

function fmtDate(s: string | null): string {
  if (!s) return "";
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

const STATUS_CHIP: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  pending:                 { label: "Extraction in progress",   bg: "rgba(31,41,55,0.7)",  fg: "#9ca3af", border: "#374151" },
  extracting:              { label: "Extraction in progress",   bg: "rgba(31,41,55,0.7)",  fg: "#9ca3af", border: "#374151" },
  extracted:               { label: "Awaiting review",          bg: "rgba(37,99,235,0.18)", fg: "#93c5fd", border: "rgba(37,99,235,0.4)" },
  approved:                { label: "Approved",                 bg: "rgba(22,101,52,0.2)",  fg: "#86efac", border: "#166534" },
  finalized:               { label: "Finalized (legacy)",       bg: "rgba(22,101,52,0.2)",  fg: "#86efac", border: "#166534" },
  manual_review_requested: { label: "Manual review requested",  bg: "rgba(202,138,4,0.18)", fg: "#fcd34d", border: "rgba(202,138,4,0.4)" },
  rejected:                { label: "Extraction rejected",      bg: "rgba(127,29,29,0.2)",  fg: "#fca5a5", border: "#b91c1c" },
  extraction_failed:       { label: "Extraction failed",        bg: "rgba(127,29,29,0.2)",  fg: "#fca5a5", border: "#b91c1c" },
};

// A document is exportable in any state where there is content to hand off;
// only the in-flight / failed states have nothing to export yet.
const NON_EXPORTABLE_STATUSES = new Set(["pending", "extracting", "extraction_failed"]);

function ExportButtons({ documentId, status }: { documentId: string; status: VendorAssuranceProcessingStatus }): JSX.Element {
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);
  const exportable = !NON_EXPORTABLE_STATUSES.has(status);

  const trigger = (format: "xlsx" | "pdf") => {
    if (!exportable || busy) return;
    setBusy(format);
    // The engine sets Content-Disposition: attachment, so the browser downloads the
    // file without navigating away — there is no completion callback for that, so the
    // in-flight state is optimistic and clears on a short timer (Excel is ~instant;
    // the PDF is a second or two).
    window.location.href = `/api/vendor-assurance/${encodeURIComponent(documentId)}/export.${format}`;
    window.setTimeout(() => setBusy(null), 5000);
  };

  const title = exportable ? undefined : "Available once the document has been extracted";

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button type="button" onClick={() => trigger("xlsx")} disabled={!exportable || busy !== null} title={title} style={exportBtn(!exportable || busy !== null)}>
        {busy === "xlsx" ? "Exporting…" : "Export Excel"}
      </button>
      <button type="button" onClick={() => trigger("pdf")} disabled={!exportable || busy !== null} title={title} style={exportBtn(!exportable || busy !== null)}>
        {busy === "pdf" ? "Exporting…" : "Export PDF"}
      </button>
    </div>
  );
}

export default function DocumentActions({ documentId, status, approvedAt, finalizedAt }: Props): JSX.Element {
  const [openForm, setOpenForm] = useState<OpenForm>("none");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (status !== "extracted") {
    const chip = STATUS_CHIP[status] ?? STATUS_CHIP["extracted"]!;
    const suffix =
      status === "approved" && approvedAt ? ` · ${fmtDate(approvedAt)}`
      : status === "finalized" && finalizedAt ? ` · ${fmtDate(finalizedAt)}`
      : "";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <span
          style={{
            fontSize: 13,
            padding: "6px 12px",
            borderRadius: 999,
            background: chip.bg,
            color: chip.fg,
            border: `1px solid ${chip.border}`,
            whiteSpace: "nowrap",
          }}
        >
          {chip.label}{suffix}
        </span>
        <ExportButtons documentId={documentId} status={status} />
      </div>
    );
  }

  const runApprove = () => {
    setError(null);
    startTransition(async () => {
      const r = await approveDocument(documentId);
      if (!r.ok) setError(r.error);
    });
  };

  const submitForm = () => {
    setError(null);
    if (openForm === "reject" && note.trim().length === 0) {
      setError("A reason is required to reject the extraction.");
      return;
    }
    const text = note.trim();
    startTransition(async () => {
      const r =
        openForm === "reject"
          ? await rejectExtraction(documentId, text)
          : await requestManualReview(documentId, text.length > 0 ? text : undefined);
      if (r.ok) {
        setOpenForm("none");
        setNote("");
      } else {
        setError(r.error);
      }
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <button type="button" onClick={runApprove} disabled={pending} style={btn("#16a34a", pending)}>
          {pending && openForm === "none" ? "Approving…" : "Approve"}
        </button>
        <button
          type="button"
          onClick={() => { setOpenForm(openForm === "manual_review" ? "none" : "manual_review"); setError(null); setNote(""); }}
          disabled={pending}
          style={btn("#2563eb", pending, openForm === "manual_review")}
        >
          Request Manual Review
        </button>
        <button
          type="button"
          onClick={() => { setOpenForm(openForm === "reject" ? "none" : "reject"); setError(null); setNote(""); }}
          disabled={pending}
          style={btn("#b91c1c", pending, openForm === "reject")}
        >
          Reject Extraction
        </button>
        <ExportButtons documentId={documentId} status={status} />
      </div>

      {openForm !== "none" && (
        <div style={{ width: 360, maxWidth: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={1000}
            disabled={pending}
            placeholder={openForm === "reject" ? "Reason for rejecting the extraction (required, audit-logged)" : "Optional note for the manual reviewer"}
            style={{
              width: "100%",
              boxSizing: "border-box",
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
            <button type="button" onClick={() => { setOpenForm("none"); setNote(""); setError(null); }} disabled={pending} style={ghostBtn(pending)}>
              Cancel
            </button>
            <button type="button" onClick={submitForm} disabled={pending} style={btn(openForm === "reject" ? "#b91c1c" : "#2563eb", pending)}>
              {pending ? "Submitting…" : openForm === "reject" ? "Confirm rejection" : "Submit for manual review"}
            </button>
          </div>
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: "#fca5a5" }}>{error}</div>}
    </div>
  );
}

function btn(bg: string, disabled: boolean, active = false): React.CSSProperties {
  return {
    padding: "7px 14px",
    borderRadius: 6,
    border: active ? `1px solid ${bg}` : "none",
    background: disabled ? "#1f2937" : active ? "transparent" : bg,
    color: disabled ? "#6b7280" : active ? bg : "#fff",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 13,
  };
}

function ghostBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "7px 12px",
    borderRadius: 6,
    border: "1px solid #374151",
    background: "transparent",
    color: "#9ca3af",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 13,
  };
}

function exportBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "7px 12px",
    borderRadius: 6,
    border: `1px solid ${disabled ? "#1f2937" : "#475569"}`,
    background: "transparent",
    color: disabled ? "#4b5563" : "#cbd5e1",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 13,
    whiteSpace: "nowrap",
  };
}
