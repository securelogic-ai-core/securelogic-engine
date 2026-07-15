"use client";

/**
 * FindingEvidenceSection — attach evidence to a finding from the Decision
 * Workspace's Remediation tab.
 *
 * WHY THIS EXISTS: the engine has allowed `evidence.source_type = 'finding'`
 * since 20260420, the Decision Workspace has always *read* that evidence, and
 * findingLifecycle gates remediation on it when the org sets
 * `require_evidence_gate`. But nothing in the product could ever *create* the
 * row — there was no client function, no route, no form. For a gate-enforcing
 * org that was a deadlock: a finding whose Actions were all closed sat at
 * `in_progress` forever, waiting for evidence the UI gave no way to supply.
 *
 * Attaching here recomputes the finding's operational_status server-side
 * (routes/evidence.ts:242), so the finding advances to `remediated` on save —
 * hence the router.refresh() rather than a local state update: the change lands
 * on the header chips and the Overview tab, not just this list.
 *
 * Mirrors components/risks/LinkedEvidenceSection.tsx, minus detach: the generic
 * evidence route is immutable (no DELETE), unlike the bespoke risk route.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getFindingEvidence, attachFindingEvidence, type Evidence } from "@/lib/api";
import { evidenceRefHref } from "@/lib/evidenceLinks";
import { EVIDENCE_TYPES } from "./findingEvidencePayload";

const CARD_STYLE: React.CSSProperties = {
  background: "var(--color-brand-surface, #111827)",
  border: "1px solid #1e293b",
  borderRadius: 12,
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#94a3b8",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const INPUT_STYLE: React.CSSProperties = {
  background: "#0f1722",
  border: "1px solid #1e293b",
  color: "#e2e8f0",
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

/**
 * Format an evidence_type for display. The column is TEXT NOT NULL with a CHECK
 * constraint (db/migrations/20260420), so a valid row always has one of the
 * enum strings — but a single malformed field must never blank the entire
 * finding detail page, so null/undefined/non-string values fall back to a dash
 * rather than throwing on .replace().
 */
function fmtEvidenceType(type: unknown): string {
  return typeof type === "string" && type.length > 0
    ? type.replace(/_/g, " ")
    : "—";
}

export function FindingEvidenceSection({ findingId }: { findingId: string }) {
  const router = useRouter();

  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [evidenceType, setEvidenceType] = useState<string>("document");
  const [externalRef, setExternalRef] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    const res = await getFindingEvidence(findingId);
    setLoading(false);
    if (res.ok) {
      setEvidence(res.evidence);
      return;
    }
    setError("Could not load evidence for this finding.");
  }, [findingId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function resetForm() {
    setTitle("");
    setEvidenceType("document");
    setExternalRef("");
    setSaveError(null);
  }

  async function save(): Promise<void> {
    if (!title.trim()) {
      setSaveError("A title is required.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    const res = await attachFindingEvidence(findingId, {
      title: title.trim(),
      evidence_type: evidenceType,
      external_ref: externalRef.trim() || null,
    });
    setSaving(false);
    if (!res.ok) {
      setSaveError("Could not attach evidence.");
      return;
    }
    resetForm();
    setAddOpen(false);
    await refresh();
    // The server may have advanced operational_status to `remediated` on this
    // write. Refresh so the header and Overview reflect it, not just this list.
    router.refresh();
  }

  return (
    <div className="mt-4 p-5" style={CARD_STYLE}>
      <div className="flex items-baseline justify-between mb-1 gap-3 flex-wrap">
        <p style={SECTION_LABEL}>Remediation evidence ({evidence.length})</p>
        {!addOpen && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="text-xs font-semibold"
            style={{
              color: "#00c4b4",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            + Attach evidence
          </button>
        )}
      </div>
      {/* R-1: connect the evidence to the remediation it supports. */}
      <p className="text-xs mb-4" style={{ color: "#475569" }}>
        Proof that the remediation actions above were completed — attaching it can advance this finding to Remediation complete.
      </p>

      {addOpen && (
        <div
          className="mb-4 p-3 rounded"
          style={{
            background: "rgba(148,163,184,0.05)",
            border: "1px solid rgba(148,163,184,0.12)",
          }}
        >
          <label className="block text-xs mb-1" style={{ color: "#94a3b8" }}>
            Title
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Patch deployment log — SharePoint farm"
            className="w-full mb-2 px-2 py-1.5 text-sm rounded"
            style={INPUT_STYLE}
          />

          <label className="block text-xs mb-1" style={{ color: "#94a3b8" }}>
            Type
          </label>
          <select
            value={evidenceType}
            onChange={(e) => setEvidenceType(e.target.value)}
            className="w-full mb-2 px-2 py-1.5 text-sm rounded"
            style={INPUT_STYLE}
          >
            {EVIDENCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>

          <label className="block text-xs mb-1" style={{ color: "#94a3b8" }}>
            Reference (optional)
          </label>
          <input
            value={externalRef}
            onChange={(e) => setExternalRef(e.target.value)}
            placeholder="link or document reference"
            className="w-full mb-3 px-2 py-1.5 text-sm rounded"
            style={INPUT_STYLE}
          />

          {saveError && (
            <p className="text-xs mb-2" style={{ color: "#fca5a5" }}>
              {saveError}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="text-xs font-semibold px-3 py-1.5 rounded"
              style={{
                background: "#00c4b4",
                color: "#0a0f1a",
                border: "none",
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                resetForm();
                setAddOpen(false);
              }}
              className="text-xs font-semibold px-3 py-1.5 rounded"
              style={{
                background: "transparent",
                color: "#cbd5e1",
                border: "1px solid #1e293b",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: "#64748b" }}>
          Loading…
        </p>
      ) : error ? (
        <p className="text-sm" style={{ color: "#fca5a5" }}>
          {error}
        </p>
      ) : evidence.length === 0 ? (
        <div>
          <p className="text-sm mb-1" style={{ color: "#475569" }}>
            No evidence attached.
          </p>
          <p className="text-xs" style={{ color: "#475569" }}>
            Attach the artifact that proves this work was done — a change ticket, a
            deployment log, a screenshot.
          </p>
        </div>
      ) : (
        <ul className="space-y-2 list-none p-0 m-0">
          {evidence.map((ev) => (
            <li
              key={ev.id}
              className="p-3 rounded"
              style={{ background: "rgba(148,163,184,0.04)", border: "1px solid #1e293b" }}
            >
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                {/* R-2: openable when the reference is a URL — never a dead row. */}
                {evidenceRefHref(ev.external_ref) ? (
                  <a
                    href={evidenceRefHref(ev.external_ref)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm"
                    style={{ color: "#93c5fd" }}
                  >
                    {ev.title} ↗
                  </a>
                ) : (
                  <span className="text-sm" style={{ color: "#e2e8f0" }}>
                    {ev.title}
                  </span>
                )}
                <span className="text-xs" style={{ color: "#64748b" }}>
                  {fmtEvidenceType(ev.evidence_type)} · {fmtDate(ev.created_at)}
                </span>
              </div>
              {/* A non-URL reference stays visible so it is copyable — never a dead link. */}
              {ev.external_ref && !evidenceRefHref(ev.external_ref) && (
                <p className="text-xs mt-1 m-0" style={{ color: "#64748b" }}>
                  Ref: {ev.external_ref}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
