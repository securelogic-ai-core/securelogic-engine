"use client";

/**
 * FindingEvidenceSection — attach evidence to a finding from the Decision
 * Workspace's Remediation tab.
 *
 * WHY THIS EXISTS: the engine has allowed `evidence.source_type = 'finding'`
 * since 20260420, the Decision Workspace has always *read* that evidence, and
 * findingLifecycle gates remediation on it when the org sets
 * `require_evidence_gate`. But nothing in the product could ever *create* the
 * row — there was no client function, no route, no form. For a gate-enforcing
 * org that was a deadlock: a finding whose Actions were all closed sat at
 * `in_progress` forever, waiting for evidence the UI gave no way to supply.
 *
 * Attaching here recomputes the finding's operational_status server-side
 * (routes/evidence.ts:242), so the finding advances to `remediated` on save —
 * hence the router.refresh() rather than a local state update: the change lands
 * on the header chips and the Overview tab, not just this list.
 *
 * Mirrors components/risks/LinkedEvidenceSection.tsx, minus detach: the generic
 * evidence route is immutable (no DELETE), unlike the bespoke risk route.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getFindingEvidence,
  attachFindingEvidence,
  uploadFindingEvidence,
  evidenceFileHref,
  type Evidence,
} from "@/lib/api";
import { evidenceRefHref } from "@/lib/evidenceLinks";
import {
  EVIDENCE_TYPES,
  EVIDENCE_ACCEPT_ATTR,
  EVIDENCE_ACCEPTED_LABEL,
  formatFileSize,
  validateEvidenceFileClient,
} from "./findingEvidencePayload";

const CARD_STYLE: React.CSSProperties = {
  background: "var(--color-brand-surface, #111827)",
  border: "1px solid #1e293b",
  borderRadius: 12,
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#94a3b8",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const INPUT_STYLE: React.CSSProperties = {
  background: "#0f1722",
  border: "1px solid #1e293b",
  color: "#e2e8f0",
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

/**
 * Format an evidence_type for display. The column is TEXT NOT NULL with a CHECK
 * constraint (db/migrations/20260420), so a valid row always has one of the
 * enum strings — but a single malformed field must never blank the entire
 * finding detail page, so null/undefined/non-string values fall back to a dash
 * rather than throwing on .replace().
 */
function fmtEvidenceType(type: unknown): string {
  return typeof type === "string" && type.length > 0
    ? type.replace(/_/g, " ")
    : "—";
}

/** Map the engine's upload error codes to copy a user can act on. */
function uploadErrorMessage(raw: string): string {
  const code = raw.split(":")[0]?.trim() ?? raw;
  switch (code) {
    case "unsupported_file_type":
    case "file_content_mismatch":
      return `That file type isn't accepted. Allowed: ${EVIDENCE_ACCEPTED_LABEL}.`;
    case "file_too_large":
      return "That file is too large (max 25 MB).";
    case "empty_file":
      return "That file is empty.";
    case "storage_unavailable":
      return "File storage is temporarily unavailable. Try again shortly, or add a reference instead.";
    case "org_storage_quota_exceeded":
      return "Your organization's evidence storage limit has been reached.";
    case "source_record_not_found":
      return "This finding could not be found — reload and try again.";
    default:
      return "Could not upload the file. Try again, or add a reference instead.";
  }
}

export function FindingEvidenceSection({ findingId }: { findingId: string }) {
  const router = useRouter();

  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [evidenceType, setEvidenceType] = useState<string>("document");
  const [externalRef, setExternalRef] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // File upload state.
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    const res = await getFindingEvidence(findingId);
    setLoading(false);
    if (res.ok) {
      setEvidence(res.evidence);
      return;
    }
    setError("Could not load evidence for this finding.");
  }, [findingId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function resetForm() {
    setTitle("");
    setEvidenceType("document");
    setExternalRef("");
    setSaveError(null);
    setFile(null);
    setFileError(null);
    setProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onPickFile(picked: File | null) {
    setFileError(null);
    if (!picked) {
      setFile(null);
      return;
    }
    const err = validateEvidenceFileClient(picked);
    if (err) {
      setFile(null);
      setFileError(err);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setFile(picked);
    // Default the title to the filename if the user hasn't typed one — a small
    // convenience so the required title is rarely a blocker for a file upload.
    if (!title.trim()) setTitle(picked.name.replace(/\.[^.]+$/, ""));
  }

  function removeFile() {
    setFile(null);
    setFileError(null);
    setProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function save(): Promise<void> {
    if (!title.trim()) {
      setSaveError("A title is required.");
      return;
    }
    if (fileError) {
      setSaveError("Fix the file error before saving.");
      return;
    }
    setSaving(true);
    setSaveError(null);

    // A file upload and a reference-only record go through different endpoints:
    // the file path (multipart, with progress) when a file is chosen, else the
    // JSON reference-only path (unchanged). Either way a title is required, and
    // the Reference field is preserved as an alternative / supplement.
    let ok: boolean;
    let errorMsg: string | null = null;
    if (file) {
      setProgress(0);
      const res = await uploadFindingEvidence(
        findingId,
        file,
        {
          title: title.trim(),
          evidence_type: evidenceType,
          external_ref: externalRef.trim() || null,
        },
        (pct) => setProgress(pct)
      );
      ok = res.ok;
      if (!res.ok) errorMsg = uploadErrorMessage(res.error);
    } else {
      const res = await attachFindingEvidence(findingId, {
        title: title.trim(),
        evidence_type: evidenceType,
        external_ref: externalRef.trim() || null,
      });
      ok = res.ok;
      if (!res.ok) errorMsg = "Could not attach evidence.";
    }

    setSaving(false);
    setProgress(null);
    if (!ok) {
      setSaveError(errorMsg ?? "Could not attach evidence.");
      return;
    }
    resetForm();
    setAddOpen(false);
    await refresh();
    // The server may have advanced operational_status to `remediated` on this
    // write (evidence gate). Refresh so the header and Overview reflect it, not
    // just this list.
    router.refresh();
  }

  return (
    <div className="mt-4 p-5" style={CARD_STYLE}>
      <div className="flex items-baseline justify-between mb-1 gap-3 flex-wrap">
        <p style={SECTION_LABEL}>Remediation evidence ({evidence.length})</p>
        {!addOpen && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="text-xs font-semibold"
            style={{
              color: "#00c4b4",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            + Attach evidence
          </button>
        )}
      </div>
      {/* R-1: connect the evidence to the remediation it supports. */}
      <p className="text-xs mb-4" style={{ color: "#475569" }}>
        Proof that the remediation actions above were completed — attaching it can advance this finding to Remediation complete.
      </p>

      {addOpen && (
        <div
          className="mb-4 p-3 rounded"
          style={{
            background: "rgba(148,163,184,0.05)",
            border: "1px solid rgba(148,163,184,0.12)",
          }}
        >
          <label className="block text-xs mb-1" style={{ color: "#94a3b8" }}>
            Title
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Patch deployment log — SharePoint farm"
            className="w-full mb-2 px-2 py-1.5 text-sm rounded"
            style={INPUT_STYLE}
          />

          <label className="block text-xs mb-1" style={{ color: "#94a3b8" }}>
            Type
          </label>
          <select
            value={evidenceType}
            onChange={(e) => setEvidenceType(e.target.value)}
            className="w-full mb-2 px-2 py-1.5 text-sm rounded"
            style={INPUT_STYLE}
          >
            {EVIDENCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>

          {/* Upload file — the artifact itself (screenshot, log, change ticket). */}
          <label className="block text-xs mb-1" style={{ color: "#94a3b8" }}>
            Upload file (optional)
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept={EVIDENCE_ACCEPT_ATTR}
            disabled={saving}
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
            className="w-full mb-1 text-xs"
            style={{ color: "#cbd5e1" }}
          />
          {!file && !fileError && (
            <p className="text-xs mb-2" style={{ color: "#475569" }}>
              {EVIDENCE_ACCEPTED_LABEL} · up to 25 MB
            </p>
          )}
          {fileError && (
            <p className="text-xs mb-2" style={{ color: "#fca5a5" }}>
              {fileError}
            </p>
          )}
          {file && (
            <div
              className="mb-2 p-2 rounded flex items-center justify-between gap-2 flex-wrap"
              style={{ background: "rgba(0,196,180,0.06)", border: "1px solid rgba(0,196,180,0.25)" }}
            >
              <div className="min-w-0">
                <p className="text-xs truncate m-0" style={{ color: "#e2e8f0" }} title={file.name}>
                  {file.name}
                </p>
                <p className="text-[11px] m-0" style={{ color: "#64748b" }}>
                  {file.type || "unknown type"} · {formatFileSize(file.size)}
                </p>
              </div>
              {!saving && (
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-[11px] font-semibold"
                    style={{ color: "#93c5fd", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={removeFile}
                    className="text-[11px] font-semibold"
                    style={{ color: "#fca5a5", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Upload progress. */}
          {progress !== null && (
            <div className="mb-2">
              <div className="h-1.5 rounded overflow-hidden" style={{ background: "#1e293b" }}>
                <div
                  className="h-full"
                  style={{ width: `${progress}%`, background: "#00c4b4", transition: "width 120ms linear" }}
                  role="progressbar"
                  aria-valuenow={progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
              <p className="text-[11px] mt-1 m-0" style={{ color: "#64748b" }}>
                Uploading… {progress}%
              </p>
            </div>
          )}

          <label className="block text-xs mb-1" style={{ color: "#94a3b8" }}>
            Reference (optional)
          </label>
          <input
            value={externalRef}
            onChange={(e) => setExternalRef(e.target.value)}
            placeholder="link or document reference"
            className="w-full mb-1 px-2 py-1.5 text-sm rounded"
            style={INPUT_STYLE}
          />
          <p className="text-xs mb-3" style={{ color: "#475569" }}>
            Attach a file above, or use this for a link / external document reference — either satisfies the evidence gate.
          </p>

          {saveError && (
            <p className="text-xs mb-2" style={{ color: "#fca5a5" }}>
              {saveError}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="text-xs font-semibold px-3 py-1.5 rounded"
              style={{
                background: "#00c4b4",
                color: "#0a0f1a",
                border: "none",
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? (file ? "Uploading…" : "Saving…") : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                resetForm();
                setAddOpen(false);
              }}
              className="text-xs font-semibold px-3 py-1.5 rounded"
              style={{
                background: "transparent",
                color: "#cbd5e1",
                border: "1px solid #1e293b",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: "#64748b" }}>
          Loading…
        </p>
      ) : error ? (
        <p className="text-sm" style={{ color: "#fca5a5" }}>
          {error}
        </p>
      ) : evidence.length === 0 ? (
        <div>
          <p className="text-sm mb-1" style={{ color: "#475569" }}>
            No evidence attached.
          </p>
          <p className="text-xs" style={{ color: "#475569" }}>
            Attach the artifact that proves this work was done — a change ticket, a
            deployment log, a screenshot.
          </p>
        </div>
      ) : (
        <ul className="space-y-2 list-none p-0 m-0">
          {evidence.map((ev) => (
            <li
              key={ev.id}
              className="p-3 rounded"
              style={{ background: "rgba(148,163,184,0.04)", border: "1px solid #1e293b" }}
            >
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                {/* An uploaded file opens/downloads via the authenticated proxy
                    (short-lived signed URL); a URL reference opens externally;
                    otherwise the title is plain text — never a dead row. */}
                {ev.has_file ? (
                  <a
                    href={evidenceFileHref(ev.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm"
                    style={{ color: "#93c5fd" }}
                  >
                    {ev.title} ↓
                  </a>
                ) : evidenceRefHref(ev.external_ref) ? (
                  <a
                    href={evidenceRefHref(ev.external_ref)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm"
                    style={{ color: "#93c5fd" }}
                  >
                    {ev.title} ↗
                  </a>
                ) : (
                  <span className="text-sm" style={{ color: "#e2e8f0" }}>
                    {ev.title}
                  </span>
                )}
                <span className="text-xs" style={{ color: "#64748b" }}>
                  {fmtEvidenceType(ev.evidence_type)} · {fmtDate(ev.created_at)}
                </span>
              </div>
              {/* File metadata — filename, type, size (uploader + date are on the
                  audit trail; date is shown above). */}
              {ev.has_file && (
                <p className="text-xs mt-1 m-0" style={{ color: "#64748b" }}>
                  {ev.original_filename ?? "file"}
                  {ev.mime_type ? ` · ${ev.mime_type}` : ""}
                  {typeof ev.byte_size === "number" ? ` · ${formatFileSize(ev.byte_size)}` : ""}
                </p>
              )}
              {/* A non-URL reference stays visible so it is copyable — never a dead link. */}
              {ev.external_ref && !evidenceRefHref(ev.external_ref) && (
                <p className="text-xs mt-1 m-0" style={{ color: "#64748b" }}>
                  Ref: {ev.external_ref}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
