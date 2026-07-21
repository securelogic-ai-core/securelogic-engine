"use client";

/**
 * LinkedEvidenceSection (Epic R4) — "Assessment Evidence" section on the risk
 * detail page. Lets the risk owner attach evidence to the risk (source_type=
 * 'risk') and detach it again. Attached evidence satisfies the evidence-required
 * lifecycle gate on advance-to-treatment when the org enforces it.
 *
 * Mirrors LinkedControlsSection's card/attach/detach shape. Renders NOTHING when
 * the engine returns 404 (risk-lifecycle flag off / risk not lifecycle-managed),
 * so a flag-off risk page is unchanged.
 */

import { useEffect, useState } from "react";
import {
  getRiskEvidence,
  attachRiskEvidence,
  detachRiskEvidence,
  type RiskEvidence,
} from "@/lib/api";

const CARD_STYLE: React.CSSProperties = {
  background: "var(--color-brand-surface, #111827)",
  border: "1px solid #1e293b",
  borderRadius: 12,
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const EVIDENCE_TYPES = [
  "document",
  "screenshot",
  "log",
  "test_result",
  "interview",
  "observation",
  "policy",
  "other",
] as const;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

export function LinkedEvidenceSection({
  riskId,
  onChanged,
}: {
  riskId: string;
  onChanged?: () => void;
}) {
  const [evidence, setEvidence] = useState<RiskEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [evidenceType, setEvidenceType] = useState<string>("document");
  const [externalRef, setExternalRef] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [detachingId, setDetachingId] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setLoading(true);
    setError(null);
    const res = await getRiskEvidence(riskId);
    setLoading(false);
    if (res.ok) {
      setEvidence(res.evidence);
      setDisabled(false);
      return;
    }
    if (res.disabled) {
      setDisabled(true);
      return;
    }
    setError("Could not load risk evidence.");
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskId]);

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
    const res = await attachRiskEvidence(riskId, {
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
    onChanged?.();
  }

  async function detach(id: string): Promise<void> {
    if (!window.confirm("Detach this evidence from the risk?")) return;
    setDetachingId(id);
    const res = await detachRiskEvidence(riskId, id);
    setDetachingId(null);
    if (res.ok) {
      await refresh();
      onChanged?.();
    }
  }

  // Flag off / not lifecycle-managed → render nothing.
  if (disabled) return null;

  return (
    <div className="mb-6 p-5" style={CARD_STYLE}>
      <div className="flex items-baseline justify-between mb-4 gap-3 flex-wrap">
        <p style={SECTION_LABEL}>Assessment Evidence</p>
        {!addOpen && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="text-xs font-semibold"
            style={{ color: "#00c4b4", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
          >
            + Attach evidence
          </button>
        )}
      </div>

      {addOpen && (
        <div className="mb-4 p-3 rounded" style={{ background: "rgba(148,163,184,0.05)", border: "1px solid rgba(148,163,184,0.12)" }}>
          <label className="block text-xs mb-1" style={{ color: "#94a3b8" }}>Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. SOC 2 Type II report"
            className="w-full mb-2 px-2 py-1.5 text-sm rounded"
            style={{ background: "#0f1722", border: "1px solid #1e293b", color: "#e2e8f0" }}
          />
          <label className="block text-xs mb-1" style={{ color: "#94a3b8" }}>Type</label>
          <select
            value={evidenceType}
            onChange={(e) => setEvidenceType(e.target.value)}
            className="w-full mb-2 px-2 py-1.5 text-sm rounded"
            style={{ background: "#0f1722", border: "1px solid #1e293b", color: "#e2e8f0" }}
          >
            {EVIDENCE_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
            ))}
          </select>
          <label className="block text-xs mb-1" style={{ color: "#94a3b8" }}>Reference (optional)</label>
          <input
            value={externalRef}
            onChange={(e) => setExternalRef(e.target.value)}
            placeholder="link or document reference"
            className="w-full mb-3 px-2 py-1.5 text-sm rounded"
            style={{ background: "#0f1722", border: "1px solid #1e293b", color: "#e2e8f0" }}
          />
          {saveError && <p className="text-xs mb-2" style={{ color: "#fca5a5" }}>{saveError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="text-xs font-semibold px-3 py-1.5 rounded"
              style={{ background: "#00c4b4", color: "#0a0f1a", border: "none", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => { resetForm(); setAddOpen(false); }}
              className="text-xs font-semibold px-3 py-1.5 rounded"
              style={{ background: "transparent", color: "#cbd5e1", border: "1px solid #1e293b", cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: "#64748b" }}>Loading…</p>
      ) : error ? (
        <p className="text-sm" style={{ color: "#fca5a5" }}>{error}</p>
      ) : evidence.length === 0 ? (
        <p className="text-sm" style={{ color: "#64748b" }}>No evidence attached yet.</p>
      ) : (
        <ul className="space-y-2 list-none p-0 m-0">
          {evidence.map((ev) => (
            <li
              key={ev.id}
              className="flex items-start justify-between gap-3 p-2 rounded"
              style={{ border: "1px solid #1e293b" }}
            >
              <div>
                <p className="text-sm" style={{ color: "#e2e8f0", fontWeight: 600 }}>{ev.title}</p>
                <p className="text-xs" style={{ color: "#64748b" }}>
                  {ev.evidence_type.replace(/_/g, " ")}
                  {ev.external_ref ? ` · ${ev.external_ref}` : ""}
                  {` · ${fmtDate(ev.created_at)}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void detach(ev.id)}
                disabled={detachingId === ev.id}
                className="text-xs font-semibold"
                style={{ color: "#fca5a5", background: "transparent", border: "none", cursor: "pointer", padding: 0, flexShrink: 0 }}
              >
                {detachingId === ev.id ? "Detaching…" : "Detach"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
