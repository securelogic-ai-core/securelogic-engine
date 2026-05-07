"use client";

/**
 * ObligationPicker (RR-6) — searchable type-ahead picker for org obligations.
 *
 * Mechanical mirror of ControlPicker.tsx. Subtitle uses source_regulation
 * (canonical short-form reference like "GDPR Art. 32" or "HIPAA §164.308")
 * rather than family/domain — see RR-6 V3 verification finding. Search hay
 * includes title + source_regulation + jurisdiction + domain so the user can
 * find an obligation by any of those.
 *
 * On mount, fetches GET /api/obligations (Next.js proxy), caches the full
 * list, and filters client-side. Selecting a row calls onChange(id, title)
 * and fills the input with the selected title.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { getObligationsViaProxy, type ObligationPickerOption } from "@/lib/api";

const MAX_VISIBLE = 10;

type ObligationPickerProps = {
  /** Currently selected obligation id, or null if no selection. */
  value:    string | null;
  /** Called with (id, title). Both null when cleared. */
  onChange: (id: string | null, title: string | null) => void;
  /** IDs to hide from results (e.g. obligations already linked to this risk). */
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

export function ObligationPicker({
  value,
  onChange,
  excludeIds = [],
  ariaLabel,
  disabled = false,
  placeholder = "Search obligations…",
}: ObligationPickerProps) {
  const [obligations, setObligations] = useState<ObligationPickerOption[] | null>(null);
  const [loading, setLoading]         = useState(true);
  const [errored, setErrored]         = useState(false);
  const [query, setQuery]             = useState<string>("");
  const [open, setOpen]               = useState(false);
  const containerRef                  = useRef<HTMLDivElement>(null);

  // Initial fetch — single round-trip to /api/obligations then filter locally.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrored(false);
    getObligationsViaProxy(200)
      .then((res) => {
        if (cancelled) return;
        if (!res) {
          setErrored(true);
        } else {
          setObligations(res);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Reflect external value changes into the input text.
  useEffect(() => {
    if (value === null) {
      setQuery("");
      return;
    }
    if (obligations) {
      const found = obligations.find((o) => o.id === value);
      if (found) setQuery(found.title);
    }
  }, [value, obligations]);

  // Click-outside closes the dropdown.
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
    if (!obligations) return [];
    const q = query.trim().toLowerCase();
    return obligations.filter((o) => {
      if (excludeSet.has(o.id)) return false;
      if (q.length === 0) return true;
      // Hay covers all the user-discoverable identifiers — title + the three
      // short-form reference fields. description / notes are intentionally
      // excluded (long-form, would dilute matches).
      const hay = `${o.title} ${o.source_regulation ?? ""} ${o.jurisdiction ?? ""} ${o.domain ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [obligations, query, excludeSet]);

  if (loading) {
    return (
      <input
        type="text"
        aria-label={ariaLabel}
        placeholder="Loading obligations…"
        disabled
        style={inputStyle}
      />
    );
  }

  if (errored || obligations === null) {
    return (
      <div>
        <p style={errorTextStyle}>Could not load obligations.</p>
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
            // matches the selected obligation.
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
              {obligations.length === 0
                ? "No obligations in this org yet."
                : "No matches."}
            </p>
          ) : (
            matches.slice(0, MAX_VISIBLE).map((o) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={o.id === value}
                onClick={() => {
                  onChange(o.id, o.title);
                  setQuery(o.title);
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
                <div>{o.title}</div>
                {(o.source_regulation || o.jurisdiction) && (
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    {[o.source_regulation, o.jurisdiction].filter(Boolean).join(" · ")}
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
