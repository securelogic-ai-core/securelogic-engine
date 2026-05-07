"use client";

/**
 * ControlPicker (RR-4) — searchable type-ahead picker for org controls.
 *
 * Pattern reference: UserPicker.tsx (free-text degradation on fetch failure,
 * required aria-label, exclude-already-selected). Differs from UserPicker by
 * using a text input + filtered dropdown rather than a plain <select>, since
 * a control register can run into the hundreds and a flat select is unusable
 * past ~30 entries.
 *
 * On mount, fetches GET /api/controls (Next.js proxy), caches the full list,
 * and filters client-side by case-insensitive substring on name + family +
 * domain. Selecting a row calls onChange(id, name) and fills the input with
 * the selected name. Clearing the selection (× button) calls onChange(null, null).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { getControlsViaProxy, type ControlPickerOption } from "@/lib/api";

const MAX_VISIBLE = 10;

type ControlPickerProps = {
  /** Currently selected control id, or null if no selection. */
  value:    string | null;
  /** Called with (id, name). Both null when cleared. */
  onChange: (id: string | null, name: string | null) => void;
  /** IDs to hide from results (e.g. controls already linked to this risk). */
  excludeIds?: string[];
  /** Required for accessibility — applied as aria-label on the input. */
  ariaLabel:   string;
  disabled?:   boolean;
  placeholder?: string;
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "rgba(15,23,34,0.6)",
  border: "1px solid #1e293b",
  borderRadius: 6,
  color: "#e5e7eb",
  fontSize: 14,
  boxSizing: "border-box",
};

const errorTextStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#fca5a5",
  marginBottom: 4,
};

const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 0,
  right: 0,
  zIndex: 20,
  maxHeight: 280,
  overflowY: "auto",
  background: "#0d1626",
  border: "1px solid #1e293b",
  borderRadius: 6,
  boxShadow: "0 8px 16px rgba(0,0,0,0.4)",
};

export function ControlPicker({
  value,
  onChange,
  excludeIds = [],
  ariaLabel,
  disabled = false,
  placeholder = "Search controls…",
}: ControlPickerProps) {
  const [controls, setControls] = useState<ControlPickerOption[] | null>(null);
  const [loading, setLoading]   = useState(true);
  const [errored, setErrored]   = useState(false);
  const [query, setQuery]       = useState<string>("");
  const [open, setOpen]         = useState(false);
  const containerRef            = useRef<HTMLDivElement>(null);

  // Initial fetch — single round-trip to /api/controls then filter locally.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrored(false);
    getControlsViaProxy(200)
      .then((res) => {
        if (cancelled) return;
        if (!res) {
          setErrored(true);
        } else {
          setControls(res);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reflect external value changes into the input text. When `value` is null
  // (cleared by parent or by the × button), the search query is wiped too.
  useEffect(() => {
    if (value === null) {
      setQuery("");
      return;
    }
    if (controls) {
      const found = controls.find((c) => c.id === value);
      if (found) setQuery(found.name);
    }
  }, [value, controls]);

  // Click-outside closes the dropdown. Mounted only when open is true so we
  // don't keep a global listener around for an idle picker.
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds]);

  const matches = useMemo(() => {
    if (!controls) return [];
    const q = query.trim().toLowerCase();
    return controls.filter((c) => {
      if (excludeSet.has(c.id)) return false;
      if (q.length === 0) return true;
      const hay = `${c.name} ${c.control_family ?? ""} ${c.domain ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [controls, query, excludeSet]);

  // Loading: render a disabled input so layout doesn't shift. Length-zero
  // placeholder keeps screen readers from announcing nothing.
  if (loading) {
    return (
      <input
        type="text"
        aria-label={ariaLabel}
        placeholder="Loading controls…"
        disabled
        style={inputStyle}
      />
    );
  }

  if (errored || controls === null) {
    return (
      <div>
        <p style={errorTextStyle}>Could not load controls.</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div style={{ position: "relative" }}>
        <input
          type="text"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-autocomplete="list"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // Typing after a selection invalidates that selection — caller
            // shouldn't keep a stale FK if the displayed text no longer
            // matches the selected control.
            if (value !== null) onChange(null, null);
          }}
          style={{ ...inputStyle, paddingRight: value !== null ? 30 : undefined }}
        />
        {value !== null && (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => {
              onChange(null, null);
              setQuery("");
              setOpen(false);
            }}
            style={{
              position: "absolute",
              right: 6,
              top: "50%",
              transform: "translateY(-50%)",
              background: "transparent",
              border: "none",
              color: "#64748b",
              cursor: "pointer",
              fontSize: 16,
              padding: "0 4px",
            }}
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <div role="listbox" aria-label={ariaLabel} style={dropdownStyle}>
          {matches.length === 0 ? (
            <p
              style={{ padding: "10px 12px", fontSize: 12, color: "#475569", margin: 0 }}
            >
              {controls.length === 0
                ? "No controls in this org yet."
                : "No matches."}
            </p>
          ) : (
            matches.slice(0, MAX_VISIBLE).map((c) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={c.id === value}
                onClick={() => {
                  onChange(c.id, c.name);
                  setQuery(c.name);
                  setOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "8px 12px",
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  color: "#e5e7eb",
                  textAlign: "left",
                  cursor: "pointer",
                  fontSize: 13,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <div>{c.name}</div>
                {(c.control_family || c.domain) && (
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    {[c.control_family, c.domain].filter(Boolean).join(" · ")}
                  </div>
                )}
              </button>
            ))
          )}
          {matches.length > MAX_VISIBLE && (
            <p
              style={{
                padding: "6px 12px",
                fontSize: 11,
                color: "#475569",
                margin: 0,
                borderTop: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              Showing {MAX_VISIBLE} of {matches.length}. Refine your search.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
