"use client";

/**
 * EvidenceFileField — shared "attach the actual artifact" picker for the
 * control / obligation / AI-system evidence forms (EG2 Tier 2 slice 8).
 *
 * Reuses the findings surface's client-side validation and accept-list so all
 * four evidence forms agree on what a valid evidence file is. Purely
 * presentational + validation; the owning form decides what to do with the
 * picked file (client multipart upload vs the JSON reference-only action).
 */

import { useRef, useState } from "react";
import {
  EVIDENCE_ACCEPT_ATTR,
  EVIDENCE_ACCEPTED_LABEL,
  formatFileSize,
  validateEvidenceFileClient,
} from "@/components/findings/findingEvidencePayload";

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  fontSize: "13px",
  fontWeight: 600,
  color: "#94a3b8",
  marginBottom: "6px",
};

export function EvidenceFileField({
  file,
  onChange,
  disabled,
  progress,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
  /** Upload progress 0-100 while the owning form is uploading; null when idle. */
  progress?: number | null;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  function pick(picked: File | null) {
    if (!picked) {
      setFileError(null);
      onChange(null);
      return;
    }
    const err = validateEvidenceFileClient(picked);
    if (err) {
      setFileError(err);
      onChange(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setFileError(null);
    onChange(picked);
  }

  return (
    <div>
      <label style={LABEL_STYLE}>Upload file (optional)</label>
      <input
        ref={inputRef}
        type="file"
        accept={EVIDENCE_ACCEPT_ATTR}
        disabled={disabled}
        onChange={(e) => pick(e.target.files?.[0] ?? null)}
        className="w-full mb-1 text-xs"
        style={{ color: "#cbd5e1" }}
      />
      {!file && !fileError && (
        <p className="text-xs" style={{ color: "#475569" }}>
          {EVIDENCE_ACCEPTED_LABEL} · up to 25 MB. Attach the artifact itself —
          a reference alone can&apos;t be handed to an auditor.
        </p>
      )}
      {fileError && (
        <p className="text-xs" style={{ color: "#fca5a5" }} role="alert">
          {fileError}
        </p>
      )}
      {file && (
        <div
          className="mt-1 p-2 rounded flex items-center justify-between gap-2 flex-wrap"
          style={{ background: "rgba(0,196,180,0.06)", border: "1px solid rgba(0,196,180,0.25)" }}
        >
          <span className="text-xs" style={{ color: "#5eead4" }}>
            {file.name} · {formatFileSize(file.size)}
          </span>
          {typeof progress === "number" ? (
            <span className="text-xs" style={{ color: "#94a3b8" }}>
              Uploading… {progress}%
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (inputRef.current) inputRef.current.value = "";
                pick(null);
              }}
              className="text-xs"
              style={{ color: "#94a3b8", background: "transparent", border: "none", cursor: "pointer" }}
            >
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}
