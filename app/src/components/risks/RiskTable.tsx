"use client";

/**
 * RiskTable — sortable table for the Risk Register.
 *
 * Replaces the prior card-based list. Columns and sort behavior are
 * locked to the package spec; do not add columns here without spec
 * agreement (the cards-to-table migration was scoped narrowly).
 *
 * Data shape: each row carries fields from the basic /api/risks endpoint
 * (title, domain, risk_rating, status, owner, due_date, updated_at)
 * MERGED with /api/risks/intelligence counts (active_treatments,
 * linked_findings). The merge happens server-side in
 * app/src/app/risks/page.tsx; this component just renders. For closed/
 * transferred risks (excluded from intelligence at the SQL layer), the
 * counts default to 0 — by design, since closed risks rarely need those
 * numbers prominently in the table.
 *
 * Sort is purely client-side. The dataset (open + closed/transferred)
 * is bounded for typical orgs (<200 risks); the page warns in a comment
 * when this assumption breaks. Default sort is risk_rating descending
 * (Critical→Low) with updated_at descending as tie-break.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import type { RiskScaleLevel } from "@/lib/api";
import { RiskRow, type EnrichedRiskRow } from "./RiskRow";

const SORTABLE_COLUMNS = [
  "title",
  "domain",
  "risk_rating",
  "status",
  "owner",
  "due_date",
  "active_treatments",
  "linked_findings",
  "updated_at",
] as const;

export type SortKey = (typeof SORTABLE_COLUMNS)[number];
export type SortDir = "asc" | "desc";

const RATING_ORDER: Record<string, number> = {
  Critical: 0, High: 1, Moderate: 2, Low: 3,
};

const STATUS_ORDER: Record<string, number> = {
  open: 0, accepted: 1, mitigated: 2, transferred: 3, closed: 4,
};

function compareNullable(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls last
  if (b === null) return -1;
  return a.localeCompare(b);
}

function sortRows(
  rows: EnrichedRiskRow[],
  key: SortKey,
  dir: SortDir
): EnrichedRiskRow[] {
  const sign = dir === "asc" ? 1 : -1;
  // For risk_rating and status, sort by canonical order, not alphabetical.
  // For dates, sort lexicographically (ISO dates compare correctly).
  // For numbers, sort numerically. Title-tiebreak everywhere.
  return [...rows].sort((a, b) => {
    let cmp = 0;
    switch (key) {
      case "risk_rating": {
        const ao = RATING_ORDER[a.risk_rating ?? ""] ?? 99;
        const bo = RATING_ORDER[b.risk_rating ?? ""] ?? 99;
        cmp = ao - bo;
        break;
      }
      case "status": {
        const ao = STATUS_ORDER[a.status] ?? 99;
        const bo = STATUS_ORDER[b.status] ?? 99;
        cmp = ao - bo;
        break;
      }
      case "active_treatments":
      case "linked_findings":
        cmp = (a[key] ?? 0) - (b[key] ?? 0);
        break;
      case "due_date":
      case "updated_at":
        cmp = compareNullable(a[key] ?? null, b[key] ?? null);
        break;
      case "owner":
      case "domain":
        cmp = compareNullable(a[key] ?? null, b[key] ?? null);
        break;
      case "title":
        cmp = a.title.localeCompare(b.title);
        break;
    }
    if (cmp !== 0) return cmp * sign;
    // Tie-break: updated_at desc, then title asc.
    const updCmp = compareNullable(b.updated_at ?? null, a.updated_at ?? null);
    if (updCmp !== 0) return updCmp;
    return a.title.localeCompare(b.title);
  });
}

const HEADERS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: "title",             label: "Title" },
  { key: "domain",            label: "Domain" },
  { key: "risk_rating",       label: "Rating" },
  { key: "status",            label: "Status" },
  { key: "owner",             label: "Owner" },
  { key: "due_date",          label: "Due Date" },
  { key: "active_treatments", label: "Active Treatments" },
  { key: "linked_findings",   label: "Linked Findings" },
  { key: "updated_at",        label: "Last Updated" },
];

export function RiskTable({
  risks,
  scaleLevels,
}: {
  risks: EnrichedRiskRow[];
  scaleLevels: RiskScaleLevel[];
}) {
  const [sortKey, setSortKey] = useState<SortKey>("risk_rating");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // Default sort: risk_rating ascending in the canonical order = Critical
  // first (RATING_ORDER 0), Low last. Tie-breaker is updated_at desc
  // baked into sortRows.

  const sorted = useMemo(
    () => sortRows(risks, sortKey, sortDir),
    [risks, sortKey, sortDir]
  );

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Sensible per-column default direction.
      setSortDir(
        key === "title" || key === "domain" || key === "owner" ? "asc" : "desc"
      );
    }
  }

  if (risks.length === 0) {
    return (
      <div
        className="rounded-xl border p-10 text-center"
        style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
      >
        <p className="text-sm" style={{ color: "#94a3b8" }}>
          No risks match your current filters.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl border"
      style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
    >
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: "1px solid #1e293b" }}>
              {HEADERS.map(({ key, label }) => {
                const active = key === sortKey;
                const arrow = active ? (sortDir === "asc" ? "↑" : "↓") : "";
                return (
                  <th
                    key={key}
                    scope="col"
                    className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ color: active ? "#cbd5e1" : "#475569" }}
                  >
                    <button
                      type="button"
                      onClick={() => handleSort(key)}
                      className="inline-flex items-center gap-1 cursor-pointer hover:opacity-80"
                      style={{
                        background: "transparent",
                        border: "none",
                        padding: 0,
                        font: "inherit",
                        color: "inherit",
                        textTransform: "inherit",
                        letterSpacing: "inherit",
                      }}
                      aria-sort={
                        active
                          ? sortDir === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                      }
                    >
                      {label}
                      {arrow && (
                        <span aria-hidden="true" style={{ fontSize: 10 }}>
                          {arrow}
                        </span>
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((risk) => (
              <RiskRow key={risk.id} risk={risk} scaleLevels={scaleLevels} />
            ))}
          </tbody>
        </table>
      </div>
      <div
        className="px-5 py-2 text-xs"
        style={{ color: "#64748b", borderTop: "1px solid #1e293b" }}
      >
        {sorted.length} {sorted.length === 1 ? "risk" : "risks"}
        {" · "}
        <Link href="/risks/new" style={{ color: "#00c4b4" }}>
          Add another →
        </Link>
      </div>
    </div>
  );
}
