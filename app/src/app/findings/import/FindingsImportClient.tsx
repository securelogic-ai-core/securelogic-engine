"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { importFindings, type FindingImportRow, type FindingImportResult } from "./actions";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const FIELDS: Array<{ key: keyof FindingImportRow; label: string; required?: boolean }> = [
  { key: "title",          label: "Finding Title",          required: true },
  { key: "severity",       label: "Severity",               required: true },
  { key: "source_type",    label: "Source Type",            required: true },
  { key: "description",    label: "Description" },
  { key: "domain",         label: "Domain" },
  { key: "priority",       label: "Priority" },
  { key: "likelihood",     label: "Likelihood" },
  { key: "due_date",       label: "Due Date (YYYY-MM-DD)" },
  { key: "recommendation", label: "Recommendation" },
];

const VALID_SEVERITIES   = new Set(["Critical", "High", "Moderate", "Low"]);
const VALID_SOURCE_TYPES = new Set(["manual", "assessment", "control_test", "vendor_review", "signal", "risk"]);
const VALID_PRIORITIES   = new Set(["immediate", "near_term", "planned", "watch"]);
const VALID_LIKELIHOODS  = new Set(["very_high", "high", "medium", "low", "very_low"]);
const ISO_DATE_RE        = /^\d{4}-\d{2}-\d{2}$/;

const SEVERITY_COLORS: Record<string, string> = {
  Critical: "#fca5a5", High: "#fb923c", Moderate: "#fcd34d", Low: "#86efac",
};

const TEMPLATE_FILENAME = "findings-import-template.csv";
const TEMPLATE_HEADERS  = "title,severity,source_type,description,domain,priority,due_date,recommendation";
const TEMPLATE_ROW1     = '"Unpatched OpenSSL Vulnerability","High","control_test","OpenSSL 1.1.x detected on production hosts","Access Management","near_term","2026-06-30","Upgrade OpenSSL to 3.x immediately"';
const TEMPLATE_ROW2     = '"MFA Not Enforced for Admin Accounts","Critical","assessment","Admin accounts lack MFA enforcement","Access Management","immediate","2026-05-31","Enable MFA for all privileged accounts"';

// ─────────────────────────────────────────────────────────────
// Auto-mapping heuristics
// ─────────────────────────────────────────────────────────────

const AUTO_MAP_RULES: Record<keyof FindingImportRow, string[]> = {
  title:          ["title", "finding", "name", "issue", "vulnerability", "finding title"],
  severity:       ["severity", "risk level", "level", "rating", "criticality"],
  source_type:    ["source type", "source", "type", "origin"],
  description:    ["description", "desc", "details", "summary", "finding details"],
  domain:         ["domain", "category", "area"],
  priority:       ["priority", "urgency"],
  likelihood:     ["likelihood", "probability", "chance"],
  due_date:       ["due date", "due", "deadline", "remediation date", "target date"],
  recommendation: ["recommendation", "remediation", "fix", "action", "suggested fix"],
};

// Scan the first up to 5 rows of raw sheet data to find the real header row.
// A title/merged row typically has only 1 non-empty cell; the header row has ≥2.
function findHeaderRowIndex(rows: string[][]): number {
  const limit = Math.min(5, rows.length);
  for (let i = 0; i < limit; i++) {
    const nonEmpty = rows[i].filter((cell) => cell != null && String(cell).trim() !== "").length;
    if (nonEmpty >= 2) return i;
  }
  return 0;
}

function autoDetectMapping(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());
  for (const [field, aliases] of Object.entries(AUTO_MAP_RULES)) {
    for (const alias of aliases) {
      const idx = lowerHeaders.findIndex(
        (h) => h === alias || h.includes(alias) || alias.includes(h)
      );
      if (idx !== -1 && !Object.values(map).includes(headers[idx])) {
        map[field] = headers[idx];
        break;
      }
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────
// Row normalization
// ─────────────────────────────────────────────────────────────

function normalizeSeverity(raw: string | undefined): string {
  if (!raw) return "";
  const s = raw.trim().toLowerCase();
  if (s === "moderate") return "Moderate";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function normalizeRow(raw: Record<string, string>, columnMap: Record<string, string>): FindingImportRow {
  function get(field: keyof FindingImportRow): string | undefined {
    const col = columnMap[field];
    if (!col) return undefined;
    const val = (raw[col] ?? "").trim();
    return val.length > 0 ? val : undefined;
  }

  const rawSourceType = get("source_type");
  const source_type = rawSourceType?.toLowerCase().trim().replace(/\s+/g, "_") ?? "manual";

  const rawLikelihood = get("likelihood");
  const likelihood = rawLikelihood?.toLowerCase().trim().replace(/\s+/g, "_");

  const rawPriority = get("priority");
  const priority = rawPriority?.toLowerCase().trim().replace(/\s+/g, "_");

  return {
    title:          get("title") ?? "",
    severity:       normalizeSeverity(get("severity")),
    source_type,
    description:    get("description"),
    domain:         get("domain"),
    priority,
    likelihood,
    due_date:       get("due_date"),
    recommendation: get("recommendation"),
  };
}

// ─────────────────────────────────────────────────────────────
// Row validation
// ─────────────────────────────────────────────────────────────

type RowValidation = "valid" | "warning" | "invalid";

function validateRow(row: FindingImportRow): { status: RowValidation; warnings: string[] } {
  const warnings: string[] = [];
  if (!row.title.trim()) return { status: "invalid", warnings: ["Title is required"] };
  if (!row.severity || !VALID_SEVERITIES.has(row.severity)) {
    return { status: "invalid", warnings: ["Severity is required and must be: Critical, High, Moderate, Low"] };
  }
  if (!VALID_SOURCE_TYPES.has(row.source_type)) {
    warnings.push(`Source type "${row.source_type}" is not valid — will default to "manual"`);
  }
  if (row.priority && !VALID_PRIORITIES.has(row.priority)) {
    warnings.push(`Priority "${row.priority}" is not valid — will be cleared`);
  }
  if (row.likelihood && !VALID_LIKELIHOODS.has(row.likelihood)) {
    warnings.push(`Likelihood "${row.likelihood}" is not valid — will be cleared`);
  }
  if (row.due_date && !ISO_DATE_RE.test(row.due_date)) {
    warnings.push(`Date "${row.due_date}" is not YYYY-MM-DD format — will be cleared`);
  }
  return { status: warnings.length > 0 ? "warning" : "valid", warnings };
}

function cleanRow(row: FindingImportRow): FindingImportRow {
  return {
    title:          row.title.trim(),
    severity:       row.severity,
    source_type:    VALID_SOURCE_TYPES.has(row.source_type) ? row.source_type : "manual",
    description:    row.description || undefined,
    domain:         row.domain || undefined,
    priority:       row.priority && VALID_PRIORITIES.has(row.priority) ? row.priority : undefined,
    likelihood:     row.likelihood && VALID_LIKELIHOODS.has(row.likelihood) ? row.likelihood : undefined,
    due_date:       row.due_date && ISO_DATE_RE.test(row.due_date) ? row.due_date : undefined,
    recommendation: row.recommendation || undefined,
  };
}

// ─────────────────────────────────────────────────────────────
// Shared style constants
// ─────────────────────────────────────────────────────────────

const inputStyle = { background: "#0a0f1a", borderColor: "#1e2d45", color: "#f1f5f9" };
const cardStyle: React.CSSProperties = {
  background: "var(--brand-surface, #0d1626)",
  border: "1px solid #1e2d45",
  borderRadius: "12px",
};

// ─────────────────────────────────────────────────────────────
// Progress indicator
// ─────────────────────────────────────────────────────────────

const STEPS = ["Upload", "Map", "Preview", "Done"] as const;
type Step = "upload" | "mapping" | "preview" | "results";
const STEP_INDEX: Record<Step, number> = { upload: 0, mapping: 1, preview: 2, results: 3 };

function ProgressBar({ step }: { step: Step }) {
  const current = STEP_INDEX[step];
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((label, i) => {
        const done   = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                style={{
                  background: done || active ? "#00c4b4" : "#1e2d45",
                  color: done || active ? "#0a0f1a" : "#475569",
                  opacity: done ? 0.6 : 1,
                }}
              >
                {done ? "✓" : i + 1}
              </div>
              <span className="text-xs mt-1 font-medium" style={{ color: active ? "#00c4b4" : done ? "rgba(0,196,180,0.5)" : "#475569" }}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className="h-px w-12 mx-1 mb-4" style={{ background: i < current ? "rgba(0,196,180,0.4)" : "#1e2d45" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────

export function FindingsImportClient() {
  const [step, setStep]               = useState<Step>("upload");
  const [rawHeaders, setRawHeaders]   = useState<string[]>([]);
  const [rawRows, setRawRows]         = useState<Record<string, string>[]>([]);
  const [columnMap, setColumnMap]     = useState<Record<string, string>>({});
  const [previewRows, setPreviewRows] = useState<FindingImportRow[]>([]);
  const [importResult, setImportResult] = useState<FindingImportResult | null>(null);
  const [importing, setImporting]     = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [pasteText, setPasteText]     = useState("");
  const [isDragOver, setIsDragOver]   = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleParsed = useCallback((result: Papa.ParseResult<Record<string, string>>) => {
    if (result.errors.length > 0 && result.data.length === 0) {
      setError("Failed to parse file. Please check the format and try again.");
      return;
    }
    const allHeaders = result.meta.fields ?? [];
    const headers = allHeaders.filter((h) => h != null && h.trim() !== "");
    if (headers.length === 0) { setError("No columns detected. Check your file has a header row."); return; }
    const rows = result.data.filter((r) => Object.values(r).some((v) => v?.trim()));
    if (rows.length === 0) { setError("No data rows found in the file."); return; }
    setRawHeaders(headers);
    setRawRows(rows);
    setColumnMap(autoDetectMapping(headers));
    setError(null);
    setStep("mapping");
  }, []);

  const parseFile = useCallback((file: File) => {
    setError(null);
    const isXlsx = /\.(xlsx|xls)$/i.test(file.name);
    if (isXlsx) {
      // SECURITY: xlsx library removed due to prototype pollution vulnerability
      // (GHSA-4r6h-8v6p-xvw6). Re-enable when a safe alternative is installed.
      // Tracked: Sprint 24.
      setError(
        "Excel (.xlsx) import is temporarily unavailable due to a security update. " +
        "Please export your data as CSV and use the CSV import instead. " +
        "A CSV template is available via the Download Template button below."
      );
      return;
    } else {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: handleParsed,
        error: () => setError("Failed to read file."),
      });
    }
  }, [handleParsed]);

  const parsePaste = useCallback(() => {
    if (!pasteText.trim()) { setError("Nothing to parse."); return; }
    setError(null);
    Papa.parse<Record<string, string>>(pasteText.trim(), {
      header: true,
      skipEmptyLines: true,
      complete: handleParsed,
    });
  }, [pasteText, handleParsed]);

  const downloadTemplate = useCallback(() => {
    const content = `${TEMPLATE_HEADERS}\n${TEMPLATE_ROW1}\n${TEMPLATE_ROW2}`;
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = TEMPLATE_FILENAME;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const buildPreview = useCallback(() => {
    const rows = rawRows.map((r) => normalizeRow(r, columnMap));
    setPreviewRows(rows);
    setStep("preview");
  }, [rawRows, columnMap]);

  const handleImport = useCallback(async () => {
    const validRows = previewRows
      .filter((r) => validateRow(r).status !== "invalid")
      .map(cleanRow);
    setImporting(true);
    try {
      const result = await importFindings(validRows);
      setImportResult(result);
      setStep("results");
    } catch {
      setError("Import failed. Please try again.");
    } finally {
      setImporting(false);
    }
  }, [previewRows]);

  const resetToUpload = useCallback(() => {
    setStep("upload");
    setRawHeaders([]);
    setRawRows([]);
    setColumnMap({});
    setPreviewRows([]);
    setImportResult(null);
    setError(null);
    setPasteText("");
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <Link href="/findings" className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80" style={{ color: "#94a3b8" }}>
        ← Findings
      </Link>
      <h1 className="text-2xl font-bold mb-2" style={{ color: "#f1f5f9" }}>Import Findings</h1>
      <p className="text-sm mb-8" style={{ color: "#94a3b8" }}>
        Upload a CSV or Excel file to bulk-create findings. Severity values: Critical, High, Moderate, Low. Source type defaults to &ldquo;manual&rdquo; if not specified.
      </p>
      <ProgressBar step={step} />

      {step === "upload" && (
        <UploadStep
          isDragOver={isDragOver} setIsDragOver={setIsDragOver}
          fileInputRef={fileInputRef} parseFile={parseFile}
          pasteText={pasteText} setPasteText={setPasteText}
          parsePaste={parsePaste} downloadTemplate={downloadTemplate}
          error={error}
        />
      )}
      {step === "mapping" && (
        <MappingStep
          rawHeaders={rawHeaders} rawRows={rawRows}
          columnMap={columnMap} setColumnMap={setColumnMap}
          onBack={() => setStep("upload")} onContinue={buildPreview}
        />
      )}
      {step === "preview" && (
        <PreviewStep
          previewRows={previewRows} importing={importing} error={error}
          onBack={() => setStep("mapping")} onImport={handleImport}
        />
      )}
      {step === "results" && importResult && (
        <ResultsStep result={importResult} onReset={resetToUpload} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Step 1: Upload
// ─────────────────────────────────────────────────────────────

function UploadStep({
  isDragOver, setIsDragOver, fileInputRef, parseFile,
  pasteText, setPasteText, parsePaste, downloadTemplate, error,
}: {
  isDragOver: boolean;
  setIsDragOver: (v: boolean) => void;
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  parseFile: (f: File) => void;
  pasteText: string;
  setPasteText: (v: string) => void;
  parsePaste: () => void;
  downloadTemplate: () => void;
  error: string | null;
}) {
  return (
    <div style={cardStyle} className="p-6 space-y-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer.files[0]; if (f) parseFile(f); }}
        onClick={() => fileInputRef.current?.click()}
        className="flex flex-col items-center justify-center cursor-pointer transition-colors"
        style={{ border: `2px dashed ${isDragOver ? "#00c4b4" : "#1e2d45"}`, borderRadius: "12px", padding: "48px 24px", textAlign: "center", background: isDragOver ? "rgba(0,196,180,0.04)" : "transparent" }}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={isDragOver ? "#00c4b4" : "#475569"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-3">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p className="text-sm font-medium mb-1" style={{ color: "#f1f5f9" }}>Drop a CSV or Excel file here</p>
        <p className="text-xs" style={{ color: "#94a3b8" }}>or click to browse</p>
        <p className="text-xs mt-2" style={{ color: "#475569" }}>Supports .csv, .xlsx, .xls</p>
      </div>
      <input ref={(el) => { fileInputRef.current = el; }} type="file" accept=".csv,.xlsx,.xls" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f); }} />
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px" style={{ background: "#1e2d45" }} />
        <span className="text-xs" style={{ color: "#475569" }}>or</span>
        <div className="flex-1 h-px" style={{ background: "#1e2d45" }} />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>Paste CSV text</label>
        <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={8}
          placeholder={"title,severity,source_type,description\nUnpatched SSL,High,control_test,Found on production hosts"}
          className="w-full rounded-lg px-3 py-2 text-sm border outline-none transition-colors resize-none"
          style={{ ...inputStyle, fontFamily: "monospace" }} />
        <button onClick={parsePaste} className="mt-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors hover:opacity-90" style={{ background: "#00c4b4", color: "#0a0f1a" }}>
          Parse
        </button>
      </div>
      {error && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: "rgba(239,68,68,0.12)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.25)" }}>
          {error}
        </div>
      )}
      <div className="pt-2" style={{ borderTop: "1px solid #1e2d45" }}>
        <button onClick={downloadTemplate} className="text-xs font-medium transition-colors hover:opacity-80" style={{ color: "#00c4b4" }}>
          ↓ Download CSV template
        </button>
        <p className="text-xs mt-1" style={{ color: "#475569" }}>Severity values (required): Critical, High, Moderate, Low</p>
        <p className="text-xs mt-0.5" style={{ color: "#475569" }}>Source type values: manual, assessment, control_test, vendor_review, signal, risk</p>
        <p className="text-xs mt-0.5" style={{ color: "#475569" }}>Priority values: immediate, near_term, planned, watch</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Step 2: Column Mapping
// ─────────────────────────────────────────────────────────────

function MappingStep({ rawHeaders, rawRows, columnMap, setColumnMap, onBack, onContinue }: {
  rawHeaders: string[];
  rawRows: Record<string, string>[];
  columnMap: Record<string, string>;
  setColumnMap: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onBack: () => void;
  onContinue: () => void;
}) {
  const titleMapped = !!columnMap["title"];
  const previewRows = rawRows.slice(0, 3);
  return (
    <div className="space-y-6">
      <div style={cardStyle} className="p-6">
        <h2 className="text-base font-semibold mb-1" style={{ color: "#f1f5f9" }}>Map your columns</h2>
        <p className="text-xs mb-6" style={{ color: "#94a3b8" }}>
          We found {rawHeaders.length} column{rawHeaders.length !== 1 ? "s" : ""} and {rawRows.length} row{rawRows.length !== 1 ? "s" : ""}. Map them to finding fields.
        </p>
        <div className="space-y-3">
          {FIELDS.map(({ key, label, required }) => (
            <div key={key} className="flex items-center gap-4">
              <div className="w-52 flex-shrink-0">
                <span className="text-xs font-semibold" style={{ color: required ? "#f1f5f9" : "#94a3b8" }}>
                  {label}{required && <span style={{ color: "#fca5a5" }}> *</span>}
                </span>
              </div>
              <select value={columnMap[key] ?? ""} onChange={(e) => setColumnMap((prev) => { const next = { ...prev }; if (e.target.value) next[key] = e.target.value; else delete next[key]; return next; })}
                className="flex-1 rounded-lg px-3 py-2 text-sm border outline-none" style={inputStyle}>
                <option value="" style={{ background: "#0a0f1a" }}>— skip this field —</option>
                {rawHeaders.map((h) => <option key={h} value={h} style={{ background: "#0a0f1a" }}>{h}</option>)}
              </select>
            </div>
          ))}
        </div>
        {!titleMapped && (
          <div className="mt-4 rounded-lg px-4 py-3 text-xs" style={{ background: "rgba(239,68,68,0.1)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.2)" }}>
            Title field must be mapped before continuing.
          </div>
        )}
      </div>
      {previewRows.length > 0 && (
        <div style={cardStyle} className="p-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#94a3b8" }}>Preview (first {previewRows.length} rows)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr>{FIELDS.map(({ key, label }) => columnMap[key] ? <th key={key} className="text-left py-2 pr-4 font-semibold" style={{ color: "#475569" }}>{label}</th> : null)}</tr></thead>
              <tbody>
                {previewRows.map((raw, i) => {
                  const row = normalizeRow(raw, columnMap);
                  return (
                    <tr key={i} style={{ borderTop: "1px solid #1e2d45" }}>
                      {FIELDS.map(({ key }) => columnMap[key] ? <td key={key} className="py-2 pr-4" style={{ color: "#cbd5e1" }}>{(row[key] as string | undefined) ?? "—"}</td> : null)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="flex items-center gap-4">
        <button onClick={onContinue} disabled={!titleMapped} className="px-6 py-2 rounded-lg text-sm font-semibold transition-colors hover:opacity-90 disabled:opacity-40" style={{ background: "#00c4b4", color: "#0a0f1a" }}>Continue →</button>
        <button onClick={onBack} className="text-sm font-medium transition-colors hover:opacity-80" style={{ color: "#94a3b8" }}>← Back</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Step 3: Preview
// ─────────────────────────────────────────────────────────────

function PreviewStep({ previewRows, importing, error, onBack, onImport }: {
  previewRows: FindingImportRow[];
  importing: boolean;
  error: string | null;
  onBack: () => void;
  onImport: () => void;
}) {
  const validations  = previewRows.map(validateRow);
  const validCount   = validations.filter((v) => v.status === "valid").length;
  const warnCount    = validations.filter((v) => v.status === "warning").length;
  const invalidCount = validations.filter((v) => v.status === "invalid").length;
  const importCount  = previewRows.filter((r) => validateRow(r).status !== "invalid").length;

  return (
    <div className="space-y-6">
      <div style={cardStyle} className="px-5 py-4 flex flex-wrap gap-6">
        <div><span className="text-2xl font-bold" style={{ color: "#86efac" }}>{validCount + warnCount}</span><span className="text-xs ml-1.5" style={{ color: "#94a3b8" }}>valid</span></div>
        {invalidCount > 0 && <div><span className="text-2xl font-bold" style={{ color: "#fca5a5" }}>{invalidCount}</span><span className="text-xs ml-1.5" style={{ color: "#94a3b8" }}>will be skipped (missing required fields)</span></div>}
        {warnCount > 0 && <div><span className="text-2xl font-bold" style={{ color: "#fcd34d" }}>{warnCount}</span><span className="text-xs ml-1.5" style={{ color: "#94a3b8" }}>warnings (invalid values will be corrected)</span></div>}
      </div>
      <div style={cardStyle} className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: "1px solid #1e2d45" }}>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: "#475569" }}></th>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: "#475569" }}>Title</th>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: "#475569" }}>Severity</th>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: "#475569" }}>Source Type</th>
                <th className="text-left px-4 py-3 font-semibold" style={{ color: "#475569" }}>Priority</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => {
                const { status, warnings } = validations[i];
                return (
                  <tr key={i} style={{ borderBottom: "1px solid #1e2d45" }}>
                    <td className="px-4 py-3">
                      {status === "valid"   && <span style={{ color: "#86efac" }}>✓</span>}
                      {status === "warning" && <span style={{ color: "#fcd34d" }} title={warnings.join("; ")}>⚠</span>}
                      {status === "invalid" && <span style={{ color: "#fca5a5" }}>✗</span>}
                    </td>
                    <td className="px-4 py-3 font-medium" style={{ color: status === "invalid" ? "#64748b" : "#f1f5f9" }}>{row.title || <em style={{ color: "#475569" }}>empty</em>}</td>
                    <td className="px-4 py-3" style={{ color: SEVERITY_COLORS[row.severity] ?? "#94a3b8" }}>{row.severity || "—"}</td>
                    <td className="px-4 py-3" style={{ color: "#cbd5e1" }}>{row.source_type || "—"}</td>
                    <td className="px-4 py-3" style={{ color: "#cbd5e1" }}>{row.priority || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {error && <div className="rounded-lg px-4 py-3 text-sm" style={{ background: "rgba(239,68,68,0.12)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.25)" }}>{error}</div>}
      <div className="flex items-center gap-4">
        <button onClick={onImport} disabled={importing || importCount === 0} className="px-6 py-2 rounded-lg text-sm font-semibold transition-colors hover:opacity-90 disabled:opacity-50" style={{ background: "#00c4b4", color: "#0a0f1a" }}>
          {importing ? "Importing…" : `Import ${importCount} finding${importCount !== 1 ? "s" : ""}`}
        </button>
        <button onClick={onBack} disabled={importing} className="text-sm font-medium transition-colors hover:opacity-80 disabled:opacity-40" style={{ color: "#94a3b8" }}>← Back to mapping</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Step 4: Results
// ─────────────────────────────────────────────────────────────

const STATUS_BADGE_STYLES: Record<string, React.CSSProperties> = {
  created: { background: "rgba(34,197,94,0.15)",   color: "#86efac" },
  skipped: { background: "rgba(148,163,184,0.15)", color: "#94a3b8" },
  error:   { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
};
const STATUS_LABELS: Record<string, string> = { created: "Created", skipped: "Already exists", error: "Error" };

function ResultsStep({ result, onReset }: { result: FindingImportResult; onReset: () => void }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <div style={cardStyle} className="p-5 text-center"><p className="text-3xl font-bold mb-1" style={{ color: "#86efac" }}>{result.created}</p><p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>Created</p></div>
        <div style={cardStyle} className="p-5 text-center"><p className="text-3xl font-bold mb-1" style={{ color: "#94a3b8" }}>{result.skipped}</p><p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#475569" }}>Skipped</p></div>
        <div style={cardStyle} className="p-5 text-center"><p className="text-3xl font-bold mb-1" style={{ color: result.errors > 0 ? "#fca5a5" : "#475569" }}>{result.errors}</p><p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#475569" }}>Errors</p></div>
      </div>
      <div style={cardStyle} className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr style={{ borderBottom: "1px solid #1e2d45" }}>
              <th className="text-left px-4 py-3 font-semibold" style={{ color: "#475569" }}>Title</th>
              <th className="text-left px-4 py-3 font-semibold" style={{ color: "#475569" }}>Status</th>
              <th className="text-left px-4 py-3 font-semibold" style={{ color: "#475569" }}>Message</th>
            </tr></thead>
            <tbody>
              {result.results.map((r, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #1e2d45" }}>
                  <td className="px-4 py-3 font-medium" style={{ color: "#f1f5f9" }}>{r.name}</td>
                  <td className="px-4 py-3"><span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={STATUS_BADGE_STYLES[r.status]}>{STATUS_LABELS[r.status]}</span></td>
                  <td className="px-4 py-3" style={{ color: "#94a3b8" }}>{r.message ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <Link href="/findings" className="px-6 py-2 rounded-lg text-sm font-semibold transition-colors hover:opacity-90" style={{ background: "#00c4b4", color: "#0a0f1a" }}>View all findings →</Link>
        <button onClick={onReset} className="text-sm font-medium transition-colors hover:opacity-80" style={{ color: "#94a3b8" }}>Import another file</button>
      </div>
    </div>
  );
}
