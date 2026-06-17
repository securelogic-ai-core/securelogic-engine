"use client";

import { useCallback, useEffect, useState } from "react";
import type { DataExportRecord } from "@/lib/api";

interface Props {
  initialExports: DataExportRecord[];
}

// Poll cadence + ceiling (decision C). We re-fetch the list while any row is
// still being prepared and stop once none are. MAX_POLLS bounds a stuck backend
// so the tab never polls forever (~10 min at 8s).
const POLL_INTERVAL_MS = 8000;
const MAX_POLLS = 75;

type RowKind = "pending" | "ready" | "expired" | "failed";

/**
 * Collapse (job status, file availability) into a single display state. The
 * engine already computed `file.available` (not purged, not past its token
 * window), so the client never re-derives expiry. A job that reports succeeded
 * before its file row is written is treated as still pending, which also keeps
 * the poll running until the bundle actually appears.
 */
function rowKind(rec: DataExportRecord): RowKind {
  if (rec.status === "failed" || rec.status === "dead_lettered") return "failed";
  if (rec.status === "queued" || rec.status === "processing") return "pending";
  if (rec.status === "succeeded") {
    if (rec.file?.available) return "ready";
    if (rec.file) return "expired";
    return "pending";
  }
  return "pending";
}

const KIND_LABEL: Record<RowKind, string> = {
  pending: "Preparing…",
  ready: "Ready to download",
  expired: "Expired — request a new export",
  failed: "Failed — try again",
};

const KIND_STYLE: Record<RowKind, string> = {
  pending: "bg-slate-100 text-slate-600",
  ready: "bg-teal-100 text-teal-800",
  expired: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-700",
};

function fmt(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtSize(bytes: number | null): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DataExportPanel({ initialExports }: Props) {
  const [exports, setExports] = useState<DataExportRecord[]>(initialExports);
  const [submitting, setSubmitting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasPending = exports.some((r) => rowKind(r) === "pending");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/data-exports", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { exports?: DataExportRecord[] };
      if (Array.isArray(data.exports)) setExports(data.exports);
    } catch {
      // Transient — the next poll (or a manual action) will retry.
    }
  }, []);

  // Bounded auto-poll: only runs while a row is pending; tears down when none
  // remain or the component unmounts (decision C).
  useEffect(() => {
    if (!hasPending) return;
    let cancelled = false;
    let polls = 0;
    const id = setInterval(async () => {
      polls += 1;
      if (polls > MAX_POLLS) {
        clearInterval(id);
        return;
      }
      if (!cancelled) await refresh();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [hasPending, refresh]);

  async function requestExport() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/data-exports", { method: "POST" });
      if (res.status === 409) {
        setError("You already have an export in progress.");
      } else if (!res.ok) {
        setError("Couldn't start the export. Please try again.");
      }
      await refresh();
    } catch {
      setError("Couldn't start the export. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function download(fileId: string) {
    setError(null);
    setDownloadingId(fileId);
    try {
      const res = await fetch(`/api/data-exports/${fileId}/download`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { url?: string };
        if (data.url) {
          window.location.href = data.url;
          return;
        }
        setError("Download link unavailable. Please try again.");
      } else if (res.status === 410 || res.status === 404) {
        setError("That export has expired. Request a new one.");
        await refresh();
      } else {
        setError("Couldn't get the download link. Please try again.");
      }
    } catch {
      setError("Couldn't get the download link. Please try again.");
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div>
      <p className="text-sm text-slate-600 mb-4">
        Request a machine-readable copy of your personal data. Preparing it can
        take a few minutes; the download link is available for a limited time
        once it&apos;s ready.
      </p>

      <button
        type="button"
        onClick={requestExport}
        disabled={submitting || hasPending}
        className="border border-teal-600 text-teal-600 enabled:hover:bg-teal-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
      >
        {hasPending ? "Export in progress…" : submitting ? "Requesting…" : "Request data export"}
      </button>

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

      {exports.length > 0 && (
        <ul className="mt-6 divide-y divide-slate-100 border-t border-slate-100">
          {exports.map((rec) => {
            const kind = rowKind(rec);
            const size = rec.file ? fmtSize(rec.file.sizeBytes) : null;
            return (
              <li key={rec.jobId} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-slate-800">Requested {fmt(rec.requestedAt)}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${KIND_STYLE[kind]}`}
                    >
                      {KIND_LABEL[kind]}
                    </span>
                    {size && <span className="ml-2">{size}</span>}
                  </p>
                </div>
                {kind === "ready" && rec.file && (
                  <button
                    type="button"
                    onClick={() => download(rec.file!.id)}
                    disabled={downloadingId === rec.file.id}
                    className="flex-shrink-0 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors"
                  >
                    {downloadingId === rec.file.id ? "Opening…" : "Download"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-slate-400 mt-6">
        Exports cover your own account data only. We never include another
        user&apos;s personal data in your export.
      </p>
    </div>
  );
}
