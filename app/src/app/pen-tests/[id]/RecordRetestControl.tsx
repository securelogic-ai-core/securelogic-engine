"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { PenTestRetestResult } from "@/lib/api";
import { RETEST_RESULT_LABELS } from "../lifecycle";
import { recordRetest, type PenTestActionResult } from "./actions";

const inputClass =
  "w-full rounded-lg px-3 py-2 text-sm border outline-none transition-colors";
const inputStyle = {
  background: "#0a0f1a",
  borderColor: "#1e2d45",
  color: "#f1f5f9",
};
const labelClass = "block text-xs font-semibold uppercase tracking-wide mb-1.5";

/**
 * RecordRetestControl (T2-I) — one retest act on one pen-test finding, from
 * the engagement detail. Deliberately write-only here: the verification
 * HISTORY renders on the finding detail page (its natural home), so this list
 * never fans out into N per-finding retest fetches.
 *
 * The notes rule mirrors the engine's named 400 (and the DB CHECK behind it):
 * a result that leaves the exposure open — not_remediated or
 * partially_remediated — requires the tester's notes. And a 'remediated'
 * retest NEVER closes the finding; the closure gate is the only closure path,
 * which the confirmation text says out loud so nobody waits for a status flip
 * that will not come.
 */
export function RecordRetestControl({
  engagementId,
  findingId,
}: {
  engagementId: string;
  findingId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<PenTestRetestResult>("remediated");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recorded, setRecorded] = useState(false);

  const notesRequired = result !== "remediated";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const outcome: PenTestActionResult = await recordRetest(
      engagementId,
      findingId,
      formData
    );

    if (outcome.error) {
      setError(outcome.error);
      setSaving(false);
      return;
    }
    setSaving(false);
    setOpen(false);
    setRecorded(true);
    router.refresh();
  }

  if (recorded && !open) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium" style={{ color: "#86efac" }}>
          Retest recorded —{" "}
          <Link
            href={`/findings/${findingId}`}
            className="underline transition-opacity hover:opacity-80"
            style={{ color: "#86efac" }}
          >
            history is on the finding
          </Link>
          . A retest never closes the finding; closure stays with its own gate.
        </span>
        <button
          type="button"
          onClick={() => { setOpen(true); setError(null); }}
          className="text-xs font-medium"
          style={{
            border: "1px solid #1e2d45",
            color: "#94a3b8",
            padding: "2px 10px",
            borderRadius: "6px",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          Record another
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setError(null); }}
        className="text-xs font-medium transition-colors hover:border-teal-500 hover:text-teal-300"
        style={{
          border: "1px solid #1e2d45",
          color: "#94a3b8",
          padding: "4px 12px",
          borderRadius: "6px",
          background: "transparent",
          cursor: "pointer",
        }}
      >
        Record retest
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2 rounded-lg p-4 space-y-3"
      style={{ background: "rgba(15,23,42,0.6)", border: "1px solid #1e2d45" }}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label htmlFor={`retest-result-${findingId}`} className={labelClass} style={{ color: "#94a3b8" }}>
            Result
          </label>
          <select
            id={`retest-result-${findingId}`}
            name="result"
            value={result}
            onChange={(e) => setResult(e.target.value as PenTestRetestResult)}
            className={inputClass}
            style={inputStyle}
            disabled={saving}
          >
            {(Object.keys(RETEST_RESULT_LABELS) as PenTestRetestResult[]).map((r) => (
              <option key={r} value={r}>
                {RETEST_RESULT_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`retest-performed-${findingId}`} className={labelClass} style={{ color: "#94a3b8" }}>
            Performed On
          </label>
          <input
            id={`retest-performed-${findingId}`}
            type="date"
            name="performed_on"
            className={inputClass}
            style={inputStyle}
            disabled={saving}
          />
        </div>
      </div>

      <div>
        <label htmlFor={`retest-notes-${findingId}`} className={labelClass} style={{ color: "#94a3b8" }}>
          Notes
          {notesRequired && <span style={{ color: "#fca5a5" }}> *</span>}
        </label>
        <textarea
          id={`retest-notes-${findingId}`}
          name="notes"
          rows={2}
          required={notesRequired}
          placeholder={
            notesRequired
              ? "Required — what did the tester find still open?"
              : "What the tester verified (optional for a remediated result)"
          }
          className={inputClass}
          style={inputStyle}
          disabled={saving}
        />
        {notesRequired && (
          <p className="text-xs mt-1" style={{ color: "#64748b" }}>
            A retest that leaves the exposure open must say what the tester found.
          </p>
        )}
      </div>

      {error && (
        <div
          className="rounded-lg px-3 py-2 text-xs"
          style={{
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.25)",
            color: "#fca5a5",
          }}
        >
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center px-4 py-1.5 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-60"
          style={{ background: "#00c4b4", color: "#0a0f1a" }}
        >
          {saving ? "Recording…" : "Record Retest"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => { setOpen(false); setError(null); }}
          className="text-xs font-medium transition-opacity hover:opacity-80"
          style={{ color: "#94a3b8", background: "transparent", border: "none", cursor: "pointer" }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
