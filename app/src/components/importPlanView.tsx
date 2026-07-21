"use client";

/**
 * importPlanView — presentational (no logic) rendering of an import plan's
 * per-row statuses + summary chips. Shared by the unified Asset Registry
 * importer (/assets/import). Mirrors the enterprise-context importer's inline
 * table so both surfaces read identically; the deterministic plan itself comes
 * from the engine (planImport / planAssetImport).
 */

import type { ImportPlan } from "@/lib/enterpriseContext";
import { titleFromSnake } from "@/lib/enterpriseContextFormat";

const STATUS_STYLES: Record<string, { color: string; label: string }> = {
  ok: { color: "#86efac", label: "Ready" },
  invalid: { color: "#fca5a5", label: "Invalid" },
  duplicate_in_file: { color: "#fcd34d", label: "Duplicate (in file)" },
  duplicate_in_db: { color: "#fcd34d", label: "Already exists" },
  cap_exceeded: { color: "#fdba74", label: "Over limit" },
};

export function ImportSummaryChips({ summary }: { summary: Record<string, number | undefined> }) {
  const chips: Array<{ key: string; label: string; color: string }> = [
    { key: "total", label: "Total", color: "#94a3b8" },
    { key: "ok", label: "Ready", color: "#86efac" },
    { key: "invalid", label: "Invalid", color: "#fca5a5" },
    { key: "duplicate", label: "Duplicates", color: "#fcd34d" },
    { key: "cap_exceeded", label: "Over limit", color: "#fdba74" },
  ];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {chips
        .filter((c) => (summary[c.key] ?? 0) > 0 || c.key === "total" || c.key === "ok")
        .map((c) => (
          <span
            key={c.key}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border"
            style={{ borderColor: "#1e2d45", color: c.color }}
          >
            {c.label}: {summary[c.key] ?? 0}
          </span>
        ))}
    </div>
  );
}

export function ImportRowTable({ plan }: { plan: ImportPlan }) {
  const problems = plan.rows.filter((r) => r.status !== "ok");
  if (problems.length === 0) {
    return (
      <p className="text-xs" style={{ color: "#86efac" }}>
        Every row is ready to import.
      </p>
    );
  }
  const shown = problems.slice(0, 100);
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="w-full text-xs" style={{ color: "#cbd5e1" }}>
        <thead>
          <tr style={{ color: "#64748b" }}>
            <th className="text-left py-1.5 pr-4 font-semibold">Row</th>
            <th className="text-left py-1.5 pr-4 font-semibold">Status</th>
            <th className="text-left py-1.5 font-semibold">Detail</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const style = STATUS_STYLES[String(r.status)] ?? { color: "#94a3b8", label: titleFromSnake(String(r.status)) };
            const rowNumber = (r as { rowNumber?: number }).rowNumber;
            const detail = r as { detail?: string; error?: string };
            return (
              <tr key={`${rowNumber}-${r.status}`} style={{ borderTop: "1px solid #1e2d45" }}>
                <td className="py-1.5 pr-4">{rowNumber ?? "—"}</td>
                <td className="py-1.5 pr-4" style={{ color: style.color }}>{style.label}</td>
                <td className="py-1.5" style={{ color: "#94a3b8" }}>
                  {detail.detail ?? (detail.error ? titleFromSnake(detail.error) : "—")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {problems.length > shown.length && (
        <p className="mt-2 text-xs" style={{ color: "#64748b" }}>
          …and {problems.length - shown.length} more.
        </p>
      )}
    </div>
  );
}
