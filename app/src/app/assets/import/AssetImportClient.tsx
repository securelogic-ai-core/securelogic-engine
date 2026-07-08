"use client";

/**
 * AssetImportClient — the unified Asset Registry importer (EAR P16). One UI for
 * the 10 real canonical asset types; each type routes to its EXISTING engine bulk
 * endpoint via the pure `assetImportOptions()` routing table:
 *   - detail-backed types → previewAssetImport/commitAssetImport (/api/assets/import)
 *   - the other six       → previewEnterpriseImport/commitEnterpriseImport (ECL)
 * The response shape is identical for both (the shared `planImport`/`planAssetImport`
 * plan), so one preview→commit flow renders every type. No importer logic here —
 * this is entry points + the shared plan view.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  previewAssetImport,
  commitAssetImport,
  previewEnterpriseImport,
  commitEnterpriseImport,
} from "@/lib/api";
import type { AssetImportOption } from "@/lib/assetRegistry";
import {
  enterpriseContextErrorMessage,
  type ImportEntityType,
  type ImportPlan,
} from "@/lib/enterpriseContext";
import { ImportSummaryChips, ImportRowTable } from "@/components/importPlanView";

const inputClass = "w-full rounded-lg px-3 py-2 text-sm border outline-none transition-colors";
const inputStyle = { background: "#0a0f1a", borderColor: "#1e2d45", color: "#f1f5f9" };
const labelClass = "block text-xs font-semibold uppercase tracking-wide mb-1.5";

export default function AssetImportClient({ options }: { options: AssetImportOption[] }) {
  const router = useRouter();
  const [assetType, setAssetType] = useState<string>(options[0]?.assetType ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [committed, setCommitted] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const option = options.find((o) => o.assetType === assetType) ?? options[0];

  if (!option) {
    return (
      <p className="text-sm" style={{ color: "#94a3b8" }}>
        No asset types are available to import.
      </p>
    );
  }

  async function run(mode: "preview" | "commit"): Promise<ImportPlan | { ok: false; error: string }> {
    if (option.route.backend === "assets") {
      return mode === "preview"
        ? previewAssetImport(option.assetType, file!)
        : commitAssetImport(option.assetType, file!);
    }
    const entityType = option.route.entityType as ImportEntityType;
    return mode === "preview"
      ? previewEnterpriseImport(entityType, file!)
      : commitEnterpriseImport(entityType, file!);
  }

  async function handlePreview() {
    if (!file) return;
    setBusy("preview");
    setError(null);
    setCommitted(null);
    const result = await run("preview");
    if (!("ok" in result) || result.ok) {
      setPlan(result as ImportPlan);
    } else {
      setError(enterpriseContextErrorMessage(result.error));
      setPlan(null);
    }
    setBusy(null);
  }

  async function handleCommit() {
    if (!file) return;
    setBusy("commit");
    setError(null);
    const result = await run("commit");
    if (!("ok" in result) || result.ok) {
      setCommitted(result as ImportPlan);
      setPlan(null);
      router.refresh();
    } else {
      setError(enterpriseContextErrorMessage(result.error));
    }
    setBusy(null);
  }

  function reset() {
    setFile(null);
    setPlan(null);
    setCommitted(null);
    setError(null);
  }

  function downloadTemplate() {
    const header = option.columns.join(",");
    const blob = new Blob([`${header}\n`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${option.assetType}-import-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Step 1: choose type + file */}
      <div className="bg-brand-surface border border-brand-line rounded-xl p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass} style={{ color: "#94a3b8" }}>Asset Type</label>
            <select
              value={assetType}
              onChange={(e) => {
                setAssetType(e.target.value);
                setPlan(null);
                setCommitted(null);
                setError(null);
              }}
              className={inputClass}
              style={inputStyle}
              disabled={busy !== null}
            >
              {options.map((o) => (
                <option key={o.assetType} value={o.assetType}>
                  {o.label}
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
          <span style={{ color: "#94a3b8" }}>{option.columns.join(", ")}</span>. Only{" "}
          <span style={{ color: "#94a3b8" }}>name</span> is required. Owners are assigned after import.{" "}
          <button
            type="button"
            onClick={downloadTemplate}
            className="underline transition-colors hover:opacity-80"
            style={{ color: "#00c4b4" }}
          >
            Download {option.label} template
          </button>
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
            style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)", color: "#fca5a5" }}
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
            <ImportSummaryChips summary={plan.summary} />
          </div>

          {plan.truncated && (
            <p className="text-xs" style={{ color: "#fcd34d" }}>
              The file had more than 5,000 data rows — only the first 5,000 were read.
            </p>
          )}

          <ImportRowTable plan={plan} />

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
            {committed.committed ?? committed.summary.ok ?? 0} {option.label.toLowerCase()}
            {(committed.committed ?? 0) !== 1 ? " rows" : " row"} imported.
          </p>
          <ImportSummaryChips summary={committed.summary} />
          <div className="flex items-center gap-3 pt-1">
            <Link
              href="/assets"
              className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold transition-colors hover:opacity-90"
              style={{ background: "#00c4b4", color: "#0a0f1a" }}
            >
              View Assets
            </Link>
            <button
              type="button"
              onClick={reset}
              className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:opacity-80"
              style={{ borderColor: "#1e293b", color: "#94a3b8" }}
            >
              Import More
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
