"use client";

/**
 * Enterprise Context CSV/XLSX import flow (goal Item 7, 7A.4). Two-step:
 * preview (dry-run plan — nothing written) → commit (persists the `ok` rows in one
 * tenant transaction, `ON CONFLICT DO NOTHING`). Both go through the 7A.1 multipart
 * proxy; per-row statuses come back from the engine's deterministic `planImport`.
 * Owners are assigned post-import (the v1 importer intentionally takes no
 * owner_user_id — no cross-org user references).
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { commitEnterpriseImport, previewEnterpriseImport } from "@/lib/api";
import {
  IMPORT_ENTITY_TYPES,
  enterpriseContextErrorMessage,
  type ImportEntityType,
  type ImportPlan,
} from "@/lib/enterpriseContext";
import { entityTypeLabel, titleFromSnake } from "@/lib/enterpriseContextFormat";

const COLUMNS_BY_TYPE: Record<ImportEntityType, string[]> = {
  asset: ["name*", "description", "status", "criticality", "confidence", "external_ref"],
  application: ["name*", "description", "status", "criticality", "confidence", "external_ref"],
  identity: ["name*", "description", "status", "criticality", "confidence", "external_ref"],
  data_store: [
    "name*", "description", "status", "criticality", "confidence", "external_ref",
    "data_classification", "residency_region", "retention_policy", "encryption_at_rest",
  ],
  vendor: [
    "name*", "service_description", "category", "criticality",
    "data_sensitivity", "access_level", "website",
  ],
  ai_system: [
    "name*", "use_case", "model_type", "data_classification",
    "deployment_status", "criticality", "risk_classification",
  ],
};

const STATUS_STYLES: Record<string, { color: string; label: string }> = {
  ok:                { color: "#86efac", label: "Ready" },
  invalid:           { color: "#fca5a5", label: "Invalid" },
  duplicate_in_file: { color: "#fcd34d", label: "Duplicate (in file)" },
  duplicate_in_db:   { color: "#fcd34d", label: "Already exists" },
  cap_exceeded:      { color: "#fdba74", label: "Over limit" },
};

const inputClass =
  "w-full rounded-lg px-3 py-2 text-sm border outline-none transition-colors";
const inputStyle = { background: "#0a0f1a", borderColor: "#1e2d45", color: "#f1f5f9" };
const labelClass = "block text-xs font-semibold uppercase tracking-wide mb-1.5";

export function EnterpriseImportClient() {
  const router = useRouter();
  const [entityType, setEntityType] = useState<ImportEntityType>("asset");
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [committed, setCommitted] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePreview() {
    if (!file) return;
    setBusy("preview");
    setError(null);
    setCommitted(null);
    const result = await previewEnterpriseImport(entityType, file);
    if (!result.ok) {
      setError(enterpriseContextErrorMessage(result.error));
      setPlan(null);
    } else {
      setPlan(result);
    }
    setBusy(null);
  }

  async function handleCommit() {
    if (!file) return;
    setBusy("commit");
    setError(null);
    const result = await commitEnterpriseImport(entityType, file);
    if (!result.ok) {
      setError(enterpriseContextErrorMessage(result.error));
    } else {
      setCommitted(result);
      setPlan(null);
      router.refresh();
    }
    setBusy(null);
  }

  function reset() {
    setFile(null);
    setPlan(null);
    setCommitted(null);
    setError(null);
  }

  const columns = COLUMNS_BY_TYPE[entityType];

  return (
    <div className="space-y-6">
      {/* Step 1: choose type + file */}
      <div className="bg-brand-surface border border-brand-line rounded-xl p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass} style={{ color: "#94a3b8" }}>Import Type</label>
            <select
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value as ImportEntityType);
                setPlan(null);
                setCommitted(null);
              }}
              className={inputClass}
              style={inputStyle}
              disabled={busy !== null}
            >
              {IMPORT_ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {entityTypeLabel(t)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass} style={{ color: "#94a3b8" }}>File (CSV or XLSX, ≤ 5 MB)</label>
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPlan(null);
                setCommitted(null);
              }}
              className={inputClass}
              style={inputStyle}
              disabled={busy !== null}
            />
          </div>
        </div>

        <p className="text-xs" style={{ color: "#64748b" }}>
          Expected columns (first row = headers, case-insensitive):{" "}
          <span style={{ color: "#94a3b8" }}>{columns.join(", ")}</span>. Up to 5,000
          data rows per file. Owners are assigned after import.
        </p>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handlePreview}
            disabled={!file || busy !== null}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            {busy === "preview" ? "Checking…" : "Preview"}
          </button>
          {(plan || committed) && (
            <button
              type="button"
              onClick={reset}
              disabled={busy !== null}
              className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:opacity-80 disabled:opacity-50"
              style={{ borderColor: "#1e293b", color: "#94a3b8" }}
            >
              Start Over
            </button>
          )}
        </div>

        {error && (
          <p
            className="rounded-lg border px-4 py-3 text-sm"
            style={{
              borderColor: "rgba(239,68,68,0.3)",
              background: "rgba(239,68,68,0.06)",
              color: "#fca5a5",
            }}
          >
            {error}
          </p>
        )}
      </div>

      {/* Step 2: preview plan */}
      {plan && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
              Preview — nothing imported yet
            </h2>
            <SummaryChips summary={plan.summary} />
          </div>

          {plan.truncated && (
            <p className="text-xs" style={{ color: "#fcd34d" }}>
              The file had more than 5,000 data rows — only the first 5,000 were read.
            </p>
          )}

          <RowTable plan={plan} />

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCommit}
              disabled={busy !== null || (plan.summary.ok ?? 0) === 0}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: "#00c4b4", color: "#0a0f1a" }}
            >
              {busy === "commit"
                ? "Importing…"
                : `Import ${plan.summary.ok ?? 0} row${(plan.summary.ok ?? 0) !== 1 ? "s" : ""}`}
            </button>
            <span className="text-xs" style={{ color: "#64748b" }}>
              Only rows marked <span style={{ color: "#86efac" }}>Ready</span> are imported.
            </span>
          </div>
        </div>
      )}

      {/* Step 3: committed result */}
      {committed && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-6 space-y-3">
          <h2 className="text-sm font-semibold" style={{ color: "#86efac" }}>
            Import complete
          </h2>
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            {committed.committed ?? committed.summary.ok ?? 0} {entityTypeLabel(entityType).toLowerCase()}
            {(committed.committed ?? 0) !== 1 ? " rows" : " row"} imported.
          </p>
          <SummaryChips summary={committed.summary} />
          <Link
            href="/enterprise-context"
            className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold transition-colors hover:opacity-90"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            View Entities
          </Link>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function SummaryChips({ summary }: { summary: Record<string, number | undefined> }) {
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

function RowTable({ plan }: { plan: ImportPlan }) {
  // Show problems first; ready rows collapse into the count on the button.
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
            const detail = (r as { detail?: string; error?: string });
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
