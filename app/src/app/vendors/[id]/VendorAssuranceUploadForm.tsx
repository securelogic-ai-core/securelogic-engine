"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const ENGINE_ERROR_LABELS: Record<string, string> = {
  no_file_uploaded:           "Choose a PDF file before submitting.",
  unsupported_file_type:      "Only PDF files are accepted.",
  file_too_large:             "PDF exceeds the 25 MB upload limit.",
  vendor_not_found:           "Vendor was not found for this organization.",
  vendor_id_must_be_uuid:     "Vendor ID is invalid.",
  invalid_document_type_hint: "Document type is not a recognized SOC report type.",
  original_filename_required: "File name could not be read — re-select the PDF.",
  blob_put_failed:            "Storage upload failed. Try again in a moment.",
  upload_failed:              "Upload failed. Please try again.",
  unauthenticated:            "Session expired. Please sign in and retry.",
  // The vendor-assurance feature flag middleware returns {error:"not_found"}
  // when SECURELOGIC_VENDOR_ASSURANCE_ENABLED is not "true". Treat that case
  // distinctly so it isn't confused with a generic upload failure.
  not_found:                  "Vendor-assurance is not available on this environment yet.",
};

function humanizeError(code: string): string {
  return ENGINE_ERROR_LABELS[code] ?? `Upload failed (${code}).`;
}

function composeError(code: string, detail: string | null, status: number): string {
  const base = humanizeError(code);
  const trimmedDetail = detail && detail.trim().length > 0 ? detail.trim() : null;
  // Surface the engine's `detail` field when it adds information not already
  // implied by the code (e.g. invalid_document_type_hint enumerates the
  // allowed values). Suppress when the code label already covers it.
  if (trimmedDetail && !base.toLowerCase().includes(trimmedDetail.toLowerCase())) {
    return `${base} (${trimmedDetail})`;
  }
  // For codes we don't have a friendly label for, append the HTTP status so
  // operators can distinguish auth vs route vs feature-flag failures.
  if (!ENGINE_ERROR_LABELS[code]) {
    return `${base} [HTTP ${status}]`;
  }
  return base;
}

export function VendorAssuranceUploadForm({ vendorId }: { vendorId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);

    startTransition(async () => {
      try {
        const res = await fetch("/api/vendor-assurance/upload", {
          method: "POST",
          body: fd,
        });
        // On success the proxy emits a 303 to /vendor-assurance/{id}; fetch
        // follows it, so we detect the success by `res.redirected` and parse
        // the document id off the final URL to drive client navigation.
        if (res.redirected) {
          const m = res.url.match(/\/vendor-assurance\/([0-9a-f-]{36})/i);
          if (m) {
            router.push(`/vendor-assurance/${m[1]}`);
            return;
          }
          setError("Upload succeeded but the review page could not be located.");
          return;
        }
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        const code = body.error ?? `http_${res.status}`;
        const detail = typeof body.detail === "string" ? body.detail : null;
        setError(composeError(code, detail, res.status));
      } catch {
        setError("Network error — please try again.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} style={{ marginTop: 12 }}>
      <input type="hidden" name="vendor_id" value={vendorId} />

      <label
        htmlFor="vendor-assurance-document"
        style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4 }}
      >
        SOC report (PDF, max 25 MB)
      </label>
      <input
        id="vendor-assurance-document"
        type="file"
        name="document"
        accept="application/pdf"
        required
        disabled={isPending}
        style={{ display: "block", fontSize: 12, color: "#cbd5e1", marginBottom: 10, width: "100%" }}
      />

      <label
        htmlFor="vendor-assurance-type-hint"
        style={{ display: "block", fontSize: 11, color: "#94a3b8", marginBottom: 4 }}
      >
        Report type (optional)
      </label>
      <select
        id="vendor-assurance-type-hint"
        name="document_type_hint"
        defaultValue=""
        disabled={isPending}
        style={{
          display: "block",
          width: "100%",
          fontSize: 12,
          padding: "6px 8px",
          marginBottom: 10,
          background: "#0a0f1a",
          color: "#e5e7eb",
          border: "1px solid #1e2d45",
          borderRadius: 6,
        }}
      >
        <option value="">Auto-detect</option>
        <option value="soc1">SOC 1</option>
        <option value="soc2_type1">SOC 2 Type 1</option>
        <option value="soc2_type2">SOC 2 Type 2</option>
      </select>

      <button
        type="submit"
        disabled={isPending}
        style={{
          width: "100%",
          padding: "8px 12px",
          borderRadius: 6,
          border: "none",
          background: "#00c4b4",
          color: "#0a0f1a",
          fontSize: 12,
          fontWeight: 600,
          cursor: isPending ? "not-allowed" : "pointer",
          opacity: isPending ? 0.6 : 1,
        }}
      >
        {isPending ? "Uploading…" : "Upload SOC report"}
      </button>

      {error && (
        <p style={{ marginTop: 8, fontSize: 11, color: "#fca5a5" }}>
          {error}
        </p>
      )}
    </form>
  );
}
