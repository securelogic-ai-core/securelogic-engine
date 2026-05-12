"use client";

/**
 * FieldRow — the row primitive shared by all three document-review sections.
 *
 * Renders one extracted (or overridden) material field: its label, its current
 * value, an "Overridden" badge (with the original value + reason + reviewer +
 * timestamp on hover) when an override exists, an optional confidence chip, an
 * optional collapsible list of source spans, and — when the document state
 * still allows it — an "Edit" affordance that opens FieldOverrideModal.
 */

import { useState } from "react";
import type { VendorAssuranceFieldOverride, VendorAssuranceExtractionSpan } from "@/lib/api";
import FieldOverrideModal from "./FieldOverrideModal";

type Props = {
  documentId: string;
  fieldName: string;
  label: string;
  /** Effective current value: the override value if overridden, else the extracted value. */
  value: unknown;
  overrideState?: VendorAssuranceFieldOverride | null;
  confidence?: number | null;
  sourceSpans?: VendorAssuranceExtractionSpan[];
  /** False when the document is rejected / finalized — overrides are disabled. */
  canEdit?: boolean;
  /** Layout: 'row' (label | value, two columns — cover sheet) or 'block' (stacked). */
  layout?: "row" | "block";
};

const BORDER = "#374151";
const MUTED = "#9ca3af";

function confidenceChip(c: number | null | undefined): { label: string; color: string } | null {
  if (c === null || c === undefined || Number.isNaN(c)) return null;
  if (c >= 0.8) return { label: "High confidence", color: "#86efac" };
  if (c >= 0.5) return { label: "Medium confidence", color: "#fcd34d" };
  return { label: "Low confidence", color: "#fca5a5" };
}

function ValueView({ value }: { value: unknown }): JSX.Element {
  if (value === null || value === undefined) {
    return <span style={{ color: MUTED }}>— (not extracted)</span>;
  }
  if (typeof value === "string") {
    return value.trim().length === 0 ? <span style={{ color: MUTED }}>(empty)</span> : <span>{value}</span>;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return <span>{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span style={{ color: MUTED }}>(none)</span>;
    const allStrings = value.every((v) => typeof v === "string");
    if (allStrings) {
      return (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {value.map((v, i) => (
            <li key={i}>{v as string}</li>
          ))}
        </ul>
      );
    }
    return (
      <details>
        <summary style={{ cursor: "pointer", color: MUTED, fontSize: 12 }}>
          {value.length} {value.length === 1 ? "entry" : "entries"}
        </summary>
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 8 }}>
          {value.map((entry, i) => (
            <div key={i} style={{ borderLeft: `2px solid ${BORDER}`, paddingLeft: 8 }}>
              {entry !== null && typeof entry === "object" && !Array.isArray(entry) ? (
                Object.entries(entry as Record<string, unknown>).map(([k, v]) => (
                  <div key={k} style={{ fontSize: 12 }}>
                    <span style={{ color: MUTED }}>{k}: </span>
                    <span>{v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                  </div>
                ))
              ) : (
                <span style={{ fontSize: 12 }}>{JSON.stringify(entry)}</span>
              )}
            </div>
          ))}
        </div>
      </details>
    );
  }
  // plain object
  return (
    <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function overrideTitle(o: VendorAssuranceFieldOverride): string {
  const orig =
    o.original_value === null || o.original_value === undefined
      ? "(not extracted)"
      : typeof o.original_value === "object"
        ? JSON.stringify(o.original_value)
        : String(o.original_value);
  const when = (() => {
    try { return new Date(o.overridden_at).toLocaleString(); } catch { return o.overridden_at; }
  })();
  const who = o.overridden_by_user_id ? `user ${o.overridden_by_user_id}` : "an API client";
  return `Original extracted value: ${orig}\nReason: ${o.reason}\nOverridden by ${who} on ${when}`;
}

export default function FieldRow({
  documentId,
  fieldName,
  label,
  value,
  overrideState,
  confidence,
  sourceSpans,
  canEdit = true,
  layout = "block",
}: Props): JSX.Element {
  const [modalOpen, setModalOpen] = useState(false);
  const chip = confidenceChip(confidence);
  const overridden = !!overrideState;

  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <strong style={{ fontSize: 13 }}>{label}</strong>
      {overridden && overrideState && (
        <span
          title={overrideTitle(overrideState)}
          style={{
            fontSize: 10,
            padding: "1px 7px",
            borderRadius: 999,
            background: "rgba(124,58,237,0.18)",
            color: "#c4b5fd",
            border: "1px solid rgba(124,58,237,0.4)",
            cursor: "help",
          }}
        >
          Overridden
        </span>
      )}
      {!overridden && chip && (
        <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 999, background: "rgba(31,41,55,0.6)", color: chip.color }}>
          {chip.label} — extracted
        </span>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          style={{
            marginLeft: "auto",
            fontSize: 12,
            background: "transparent",
            border: "none",
            color: "#93c5fd",
            cursor: "pointer",
            padding: 0,
          }}
        >
          {overridden ? "Edit override" : "Edit"}
        </button>
      )}
    </div>
  );

  const body = (
    <>
      <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5 }}>
        <ValueView value={value} />
      </div>
      {sourceSpans && sourceSpans.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: "pointer", color: MUTED, fontSize: 12 }}>
            {sourceSpans.length} source span{sourceSpans.length === 1 ? "" : "s"}
          </summary>
          {sourceSpans.map((s) => (
            <blockquote key={s.id} style={{ margin: "8px 0", padding: 8, borderLeft: `2px solid ${BORDER}`, color: MUTED, fontSize: 12 }}>
              <div style={{ fontStyle: "italic" }}>&ldquo;{s.quote}&rdquo;</div>
              <div style={{ marginTop: 4, fontSize: 11 }}>
                {s.page_number ? `page ${s.page_number} · ` : ""}chars {s.char_start}–{s.char_end}
              </div>
            </blockquote>
          ))}
        </details>
      )}
    </>
  );

  return (
    <div style={{ padding: "12px 0", borderBottom: `1px solid ${BORDER}` }}>
      {layout === "row" ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(160px, 220px) 1fr", gap: 16, alignItems: "start" }}>
          <div>{header}</div>
          <div>{body}</div>
        </div>
      ) : (
        <div>
          {header}
          {body}
        </div>
      )}

      {modalOpen && (
        <FieldOverrideModal
          documentId={documentId}
          fieldName={fieldName}
          label={label}
          currentValue={value}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
