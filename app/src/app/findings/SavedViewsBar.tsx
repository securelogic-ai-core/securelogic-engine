"use client";

/**
 * SavedViewsBar — Findings saved views (ERIP §1). Presentational client component:
 * apply a view (Link to its /findings URL), delete a view, or save the current
 * filters as a new named view. All logic lives in the pure savedViews.ts helpers and
 * the server actions. Rendered only when the Decision Workspace flag is on (page.tsx
 * gates it) — flag-off does not render this bar.
 */

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  savedViewHref,
  filtersEqual,
  hasAnyFilter,
  type SavedViewFilters,
} from "./savedViews";
import { saveFindingViewAction, deleteFindingViewAction } from "./savedViewActions";
import type { FindingSavedView } from "@/lib/api";

export default function SavedViewsBar({
  views,
  currentFilters,
}: {
  views: FindingSavedView[];
  currentFilters: SavedViewFilters;
}) {
  const [pending, startTransition] = useTransition();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const canSave = hasAnyFilter(currentFilters);
  const currentIsSaved = views.some((v) => filtersEqual(v.filters as SavedViewFilters, currentFilters));

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      await saveFindingViewAction(trimmed, currentFilters as Record<string, string>);
      setNaming(false);
      setName("");
    });
  }

  return (
    <div className="mb-4 flex items-center gap-2 flex-wrap">
      <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: "#64748b" }}>
        Saved views
      </span>

      {views.length === 0 && !naming && (
        <span className="text-xs" style={{ color: "#475569" }}>
          None yet — filter, then save a view
        </span>
      )}

      {views.map((v) => {
        const active = filtersEqual(v.filters as SavedViewFilters, currentFilters);
        return (
          <span
            key={v.id}
            className="inline-flex items-center rounded-full text-xs font-medium"
            style={{
              border: active ? "1px solid rgba(0,196,180,0.4)" : "1px solid #1e293b",
              background: active ? "rgba(0,196,180,0.15)" : "transparent",
            }}
          >
            <Link href={savedViewHref(v.filters as SavedViewFilters)} className="pl-3 pr-2 py-1" style={{ color: active ? "#00c4b4" : "#94a3b8" }}>
              {v.name}
            </Link>
            <button
              type="button"
              aria-label={`Delete saved view ${v.name}`}
              disabled={pending}
              onClick={() => startTransition(async () => { await deleteFindingViewAction(v.id); })}
              className="pr-2.5 pl-0.5 py-1 opacity-60 hover:opacity-100"
              style={{ color: active ? "#00c4b4" : "#64748b" }}
            >
              ✕
            </button>
          </span>
        );
      })}

      {naming ? (
        <span className="inline-flex items-center gap-1">
          <input
            autoFocus
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setNaming(false); }}
            placeholder="View name"
            className="px-2 py-1 rounded-md text-xs"
            style={{ background: "#0b1220", border: "1px solid #1e293b", color: "#e2e8f0", width: 140 }}
          />
          <button type="button" onClick={save} disabled={pending || !name.trim()} className="px-2 py-1 rounded-md text-xs font-medium" style={{ background: "rgba(0,196,180,0.15)", color: "#00c4b4" }}>
            Save
          </button>
          <button type="button" onClick={() => { setNaming(false); setName(""); }} className="px-2 py-1 text-xs" style={{ color: "#64748b" }}>
            Cancel
          </button>
        </span>
      ) : (
        canSave && !currentIsSaved && (
          <button type="button" onClick={() => setNaming(true)} className="px-3 py-1 rounded-full text-xs font-medium" style={{ border: "1px dashed #334155", color: "#94a3b8" }}>
            + Save this view
          </button>
        )
      )}
    </div>
  );
}
