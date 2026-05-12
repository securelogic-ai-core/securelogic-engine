"use client";

/**
 * ControlPicker — type-ahead search of the org's controls inventory, backed by
 * the searchControlsAction server action (→ GET /api/controls?q=). Used by the
 * CUEC mapping cards' "search inventory for a different control" / "add another
 * mapping" affordances. Calls onSelect(control) when the user picks a result.
 */

import { useRef, useState } from "react";
import { searchControlsAction } from "@/app/actions/vendorAssurance";
import type { ControlSummary } from "@/lib/api";

type Props = {
  onSelect: (control: ControlSummary) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Control ids already mapped to this CUEC — hidden from results. */
  excludeIds?: ReadonlySet<string>;
};

const BORDER = "#374151";
const MUTED = "#9ca3af";

export default function ControlPicker({ onSelect, placeholder, disabled, excludeIds }: Props): JSX.Element {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<ControlSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const runSearch = (value: string) => {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length === 0) { setResults([]); setOpen(false); return; }
    const mySeq = ++seq.current;
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await searchControlsAction(value);
        if (mySeq === seq.current) { setResults(r); setOpen(true); }
      } finally {
        if (mySeq === seq.current) setLoading(false);
      }
    }, 250);
  };

  const visible = excludeIds ? results.filter((c) => !excludeIds.has(c.id)) : results;

  return (
    <div style={{ position: "relative" }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
      <input
        value={q}
        disabled={disabled}
        placeholder={placeholder ?? "Search your controls inventory…"}
        onChange={(e) => runSearch(e.target.value)}
        onFocus={() => { if (q.trim().length > 0 && results.length > 0) setOpen(true); }}
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "6px 10px",
          borderRadius: 6,
          border: `1px solid ${BORDER}`,
          background: "#020617",
          color: "#e5e7eb",
          fontSize: 13,
        }}
      />
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 20,
            background: "#0b1220",
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            maxHeight: 240,
            overflow: "auto",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          {loading && <div style={{ padding: "8px 10px", fontSize: 12, color: MUTED }}>Searching…</div>}
          {!loading && visible.length === 0 && (
            <div style={{ padding: "8px 10px", fontSize: 12, color: MUTED }}>No controls match &ldquo;{q.trim()}&rdquo;.</div>
          )}
          {visible.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onSelect(c); setQ(""); setResults([]); setOpen(false); }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                border: "none",
                borderBottom: `1px solid ${BORDER}`,
                background: "transparent",
                color: "#e5e7eb",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              <div style={{ fontWeight: 600 }}>
                {c.name}
                {c.status !== "active" ? <span style={{ color: MUTED, fontWeight: 400 }}> · {c.status}</span> : null}
              </div>
              {c.description && (
                <div style={{ fontSize: 11, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.description}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
