"use client";

/**
 * FieldOverrideModal — capture a reviewer override of one extracted material
 * field, with a REQUIRED reason. Invokes the `overrideField` server action
 * (a thin Bearer proxy to the engine, which persists + audits). On success the
 * action revalidates the document path, so the page re-renders with the new
 * "Overridden" badge; the modal just closes.
 *
 * Structured fields (arrays / objects — e.g. trust_services_criteria, controls,
 * exceptions) are edited as JSON in the textarea and parsed on save; scalar
 * fields are edited as plain text.
 */

import { useState, useTransition } from "react";
import { overrideField } from "@/app/actions/vendorAssurance";

type Props = {
  documentId: string;
  fieldName: string;
  label: string;
  currentValue: unknown;
  onClose: () => void;
};

function isStructured(v: unknown): boolean {
  return Array.isArray(v) || (v !== null && typeof v === "object");
}

function initialText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (isStructured(v)) return JSON.stringify(v, null, 2);
  return String(v);
}

export default function FieldOverrideModal({
  documentId,
  fieldName,
  label,
  currentValue,
  onClose,
}: Props): JSX.Element {
  const structured = isStructured(currentValue);
  const [valueText, setValueText] = useState<string>(initialText(currentValue));
  const [reason, setReason] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    if (reason.trim().length === 0) {
      setError("A reason is required to override an extracted value.");
      return;
    }

    let newValue: unknown;
    if (structured) {
      try {
        newValue = JSON.parse(valueText);
      } catch {
        setError("This field holds structured data — the replacement must be valid JSON.");
        return;
      }
    } else {
      newValue = valueText;
    }

    startTransition(async () => {
      const result = await overrideField(documentId, fieldName, newValue, reason.trim());
      if (result.ok) {
        onClose();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Override ${label}`}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          background: "#0b1220",
          border: "1px solid #374151",
          borderRadius: 10,
          padding: 20,
          color: "#e5e7eb",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Override “{label}”</h3>
        <p style={{ marginTop: 4, marginBottom: 16, fontSize: 12, color: "#9ca3af" }}>
          The original extracted value is preserved and shown alongside the override on the field.
        </p>

        <label style={{ display: "block", fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
          Current extracted value
        </label>
        <pre
          style={{
            margin: 0,
            marginBottom: 16,
            padding: 10,
            background: "#020617",
            borderRadius: 6,
            fontSize: 12,
            color: "#9ca3af",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 140,
            overflow: "auto",
          }}
        >
          {currentValue === null || currentValue === undefined ? "— (not extracted)" : initialText(currentValue)}
        </pre>

        <label style={{ display: "block", fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
          {structured ? "Replacement value (JSON)" : "Replacement value"}
        </label>
        <textarea
          value={valueText}
          onChange={(e) => setValueText(e.target.value)}
          rows={structured ? 8 : 3}
          disabled={pending}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: 10,
            borderRadius: 6,
            border: "1px solid #374151",
            background: "#020617",
            color: "#e5e7eb",
            fontSize: 13,
            fontFamily: structured ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "inherit",
            marginBottom: 16,
            resize: "vertical",
          }}
        />

        <label style={{ display: "block", fontSize: 12, color: "#9ca3af", marginBottom: 4 }}>
          Reason <span style={{ color: "#fca5a5" }}>*</span>
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={1000}
          disabled={pending}
          placeholder="Why is the extracted value being changed? (audit-logged)"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: 10,
            borderRadius: 6,
            border: "1px solid #374151",
            background: "#020617",
            color: "#e5e7eb",
            fontSize: 13,
            marginBottom: 12,
            resize: "vertical",
          }}
        />

        {error && (
          <div style={{ marginBottom: 12, fontSize: 12, color: "#fca5a5" }}>{error}</div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            style={{
              padding: "8px 14px",
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
            onClick={submit}
            disabled={pending}
            style={{
              padding: "8px 14px",
              borderRadius: 6,
              border: "none",
              background: pending ? "#1e3a5f" : "#2563eb",
              color: "#fff",
              cursor: pending ? "not-allowed" : "pointer",
              fontSize: 13,
            }}
          >
            {pending ? "Saving…" : "Save override"}
          </button>
        </div>
      </div>
    </div>
  );
}
