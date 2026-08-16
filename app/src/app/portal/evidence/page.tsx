"use client";

/**
 * /portal/evidence — supporting attachments.
 *
 * List is metadata-only (the engine deliberately exposes no download channel
 * on this surface — the vendor already holds every file they sent). Upload is
 * multipart POST /evidence with an optional title and an optional link to one
 * question; withdraw is DELETE /evidence/:id and is a hard delete, available
 * while the engagement still accepts changes (`accepting_uploads`).
 *
 * Engine errors (size, type, per-engagement quota) are surfaced verbatim —
 * their messages name the exact limits.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePortal } from "../PortalShell";
import {
  errorMessage,
  formatBytes,
  formatDateTime,
  portalFetch,
  type PortalEvidenceFile,
  type PortalQuestion,
} from "../portalApi";

type LoadState = "loading" | "error" | "ready";

export default function EvidencePage() {
  const { onUnauthorized } = usePortal();
  const [load, setLoad] = useState<LoadState>("loading");
  const [files, setFiles] = useState<PortalEvidenceFile[]>([]);
  const [acceptingUploads, setAcceptingUploads] = useState(false);
  const [questions, setQuestions] = useState<PortalQuestion[]>([]);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [requirementId, setRequirementId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [list, qs] = await Promise.all([
        portalFetch<{ files: PortalEvidenceFile[]; accepting_uploads: boolean }>("/evidence"),
        portalFetch<{ questions: PortalQuestion[] }>("/questions"),
      ]);
      if (list.status === 401 || qs.status === 401) {
        onUnauthorized();
        return;
      }
      if (!list.ok || !list.body) {
        setLoad("error");
        return;
      }
      setFiles(list.body.files);
      setAcceptingUploads(list.body.accepting_uploads);
      if (qs.ok && qs.body) setQuestions(qs.body.questions);
      setLoad("ready");
    } catch {
      setLoad("error");
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setUploadError("Choose a file to attach.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (title.trim().length > 0) form.append("title", title.trim());
      if (requirementId) form.append("requirement_id", requirementId);
      // No Content-Type header: the browser sets the multipart boundary.
      const result = await portalFetch("/evidence", { method: "POST", body: form });
      if (result.status === 401) {
        onUnauthorized();
        return;
      }
      if (result.status === 201) {
        setTitle("");
        setRequirementId("");
        if (fileInputRef.current) fileInputRef.current.value = "";
        await refresh();
        return;
      }
      // 413 quota/size, 415 type, 409 closed, 503 storage, 400 — engine text verbatim.
      setUploadError(
        errorMessage(result, "The file could not be uploaded. Please try again.")
      );
    } catch {
      setUploadError("Network problem — the file was not uploaded. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function handleWithdraw(file: PortalEvidenceFile) {
    if (
      !window.confirm(
        `Withdraw "${file.filename}"? The file will be permanently removed from this request.`
      )
    ) {
      return;
    }
    setWithdrawingId(file.id);
    setWithdrawError(null);
    try {
      const result = await portalFetch(`/evidence/${encodeURIComponent(file.id)}`, {
        method: "DELETE",
      });
      if (result.status === 401) {
        onUnauthorized();
        return;
      }
      if (!result.ok) {
        setWithdrawError(
          errorMessage(result, "The attachment could not be withdrawn. Please try again.")
        );
        return;
      }
      await refresh();
    } catch {
      setWithdrawError("Network problem — the attachment was not withdrawn. Please try again.");
    } finally {
      setWithdrawingId(null);
    }
  }

  if (load === "loading") {
    return (
      <div className="rounded-xl border border-brand-line bg-brand-surface p-8 text-sm text-slate-400">
        Loading attachments…
      </div>
    );
  }

  if (load === "error") {
    return (
      <div className="rounded-xl border border-brand-line bg-brand-surface p-8">
        <p className="text-sm text-slate-300">We could not load your attachments.</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-4 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-brand-bg hover:opacity-90"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-brand-line bg-brand-surface p-6">
        <h2 className="text-base font-semibold text-slate-100">Supporting documents</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Attach documents that support your answers — audit reports, certifications,
          policies. You can link a document to a specific question, and withdraw anything
          you attached while the request is still open.
        </p>
      </section>

      {/* Upload */}
      {acceptingUploads ? (
        <form
          onSubmit={(e) => void handleUpload(e)}
          className="rounded-xl border border-brand-line bg-brand-surface p-6"
        >
          <h3 className="text-sm font-semibold text-slate-100">Add an attachment</h3>
          <div className="mt-4 space-y-4">
            <div>
              <label
                htmlFor="evidence-file"
                className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
              >
                File
              </label>
              <input
                id="evidence-file"
                ref={fileInputRef}
                type="file"
                required
                className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-teal file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-brand-bg hover:file:opacity-90"
              />
            </div>
            <div>
              <label
                htmlFor="evidence-title"
                className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
              >
                Title (optional)
              </label>
              <input
                id="evidence-title"
                type="text"
                value={title}
                maxLength={300}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. SOC 2 Type II report, Jan–Dec 2025"
                className="w-full rounded-lg border border-brand-line bg-brand-bg p-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-teal focus:outline-none"
              />
            </div>
            {questions.length > 0 && (
              <div>
                <label
                  htmlFor="evidence-requirement"
                  className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
                >
                  Relates to question (optional)
                </label>
                <select
                  id="evidence-requirement"
                  value={requirementId}
                  onChange={(e) => setRequirementId(e.target.value)}
                  className="w-full rounded-lg border border-brand-line bg-brand-bg p-3 text-sm text-slate-100 focus:border-brand-teal focus:outline-none"
                >
                  <option value="">Not linked to a specific question</option>
                  {questions.map((q) => (
                    <option key={q.requirement_id} value={q.requirement_id}>
                      {q.reference} — {q.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {uploadError && (
            <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs leading-5 text-red-300">
              {uploadError}
            </p>
          )}
          <button
            type="submit"
            disabled={uploading}
            className="mt-4 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-brand-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Upload"}
          </button>
        </form>
      ) : (
        <div className="rounded-xl border border-brand-line bg-brand-surface p-4 text-sm leading-6 text-slate-300">
          This request is no longer accepting attachments. If something needs to change,
          contact the reviewer through Messages.
        </div>
      )}

      {/* List */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Attached files
        </h3>
        {withdrawError && (
          <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs leading-5 text-red-300">
            {withdrawError}
          </p>
        )}
        {files.length === 0 ? (
          <div className="rounded-xl border border-brand-line bg-brand-surface p-6 text-sm text-slate-400">
            Nothing attached yet.
          </div>
        ) : (
          <ul className="space-y-3">
            {files.map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-line bg-brand-surface p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-100">{f.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {f.filename} · {formatBytes(f.byte_size)} · {formatDateTime(f.uploaded_at)}
                    {f.requirement_reference && (
                      <span className="ml-2 rounded border border-brand-line px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                        {f.requirement_reference}
                      </span>
                    )}
                  </p>
                </div>
                {acceptingUploads && (
                  <button
                    type="button"
                    disabled={withdrawingId === f.id}
                    onClick={() => void handleWithdraw(f)}
                    className="rounded-lg border border-brand-line px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-red-500/60 hover:text-red-300 disabled:opacity-50"
                  >
                    {withdrawingId === f.id ? "Withdrawing…" : "Withdraw"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
