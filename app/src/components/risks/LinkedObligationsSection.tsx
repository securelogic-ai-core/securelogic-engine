"use client";

/**
 * LinkedObligationsSection (RR-6) — "Affected Obligations" section on the
 * risk detail page. Lets the risk owner attach the compliance obligations
 * this risk affects and remove them again.
 *
 * Mechanical mirror of LinkedControlsSection.tsx (RR-4). Sits between
 * LinkedControlsSection and RiskHistorySection on the risk detail page.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getObligationsForRisk,
  linkRiskToObligation,
  unlinkRiskFromObligation,
  type RiskObligationLink,
} from "@/lib/api";
import { ObligationPicker } from "@/components/obligations/ObligationPicker";

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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day:   "numeric",
      year:  "numeric",
    });
  } catch {
    return iso;
  }
}

function actorLabel(link: RiskObligationLink): string {
  if (link.created_by_name)  return link.created_by_name;
  if (link.created_by_email) return link.created_by_email;
  return "—";
}

export function LinkedObligationsSection({ riskId }: { riskId: string }) {
  const [links, setLinks]     = useState<RiskObligationLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // Add-affordance state
  const [addOpen, setAddOpen]                       = useState(false);
  const [pickedObligationId, setPickedObligationId] = useState<string | null>(null);
  const [pickedObligationTitle, setPickedObligationTitle] = useState<string | null>(null);
  const [note, setNote]                             = useState<string>("");
  const [saving, setSaving]                         = useState(false);
  const [saveError, setSaveError]                   = useState<string | null>(null);

  // Per-row unlink state — track which row is currently being deleted so
  // multiple parallel deletes don't fight each other in the UI.
  const [unlinkingObligationId, setUnlinkingObligationId] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setLoading(true);
    setError(null);
    const res = await getObligationsForRisk(riskId);
    setLoading(false);
    if (!res) {
      setError("Could not load linked obligations");
      return;
    }
    setLinks(res.links);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskId]);

  function resetAddForm() {
    setPickedObligationId(null);
    setPickedObligationTitle(null);
    setNote("");
    setSaveError(null);
  }

  async function handleSave() {
    if (!pickedObligationId) {
      setSaveError("Pick an obligation first");
      return;
    }
    setSaving(true);
    setSaveError(null);
    const trimmedNote = note.trim();
    const res = await linkRiskToObligation(
      riskId,
      pickedObligationId,
      trimmedNote.length > 0 ? trimmedNote : null
    );
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.error);
      return;
    }
    resetAddForm();
    setAddOpen(false);
    await refresh();
  }

  async function handleUnlink(link: RiskObligationLink) {
    if (!confirm(`Remove "${link.obligation_title}" from this risk?`)) return;
    setUnlinkingObligationId(link.obligation_id);
    const res = await unlinkRiskFromObligation(riskId, link.obligation_id);
    setUnlinkingObligationId(null);
    if (!res.ok) {
      setError(`Could not unlink: ${res.error}`);
      return;
    }
    await refresh();
  }

  const linkedObligationIds = links.map((l) => l.obligation_id);

  return (
    <div className="mb-6 p-5" style={CARD_STYLE}>
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <p style={SECTION_LABEL}>Affected Obligations</p>
          {!loading && (
            <span className="text-xs" style={{ color: "#64748b" }}>
              {links.length} {links.length === 1 ? "obligation" : "obligations"}
            </span>
          )}
        </div>
        {!addOpen && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1 text-xs font-semibold"
            style={{
              color: "#00c4b4",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            + Link Obligation
          </button>
        )}
      </div>

      {/* Add affordance */}
      {addOpen && (
        <div
          className="mb-4 p-3 rounded"
          style={{ background: "rgba(0,196,180,0.04)", border: "1px solid rgba(0,196,180,0.15)" }}
        >
          <label
            style={{ display: "block", marginBottom: 6, fontSize: 11, color: "#94a3b8", fontWeight: 600 }}
          >
            Obligation
          </label>
          <ObligationPicker
            value={pickedObligationId}
            onChange={(id, title) => {
              setPickedObligationId(id);
              setPickedObligationTitle(title);
            }}
            excludeIds={linkedObligationIds}
            ariaLabel="Pick an obligation to link to this risk"
            disabled={saving}
          />
          <label
            style={{ display: "block", margin: "10px 0 6px", fontSize: 11, color: "#94a3b8", fontWeight: 600 }}
          >
            Note <span style={{ color: "#475569", fontWeight: 400 }}>(optional, ≤ 500 chars)</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            disabled={saving}
            placeholder="How does this risk affect this obligation?"
            style={{
              width: "100%",
              minHeight: 60,
              padding: "8px 10px",
              background: "rgba(15,23,34,0.6)",
              border: "1px solid #1e293b",
              borderRadius: 6,
              color: "#e5e7eb",
              fontSize: 13,
              fontFamily: "inherit",
              boxSizing: "border-box",
              resize: "vertical",
            }}
          />
          {saveError && (
            <p className="text-xs mt-2" style={{ color: "#fca5a5" }}>{saveError}</p>
          )}
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !pickedObligationId}
              className="text-xs font-semibold px-3 py-1.5 rounded"
              style={{
                background: "#00c4b4",
                color: "#0a0f1a",
                border: "none",
                cursor: saving || !pickedObligationId ? "not-allowed" : "pointer",
                opacity: saving || !pickedObligationId ? 0.5 : 1,
              }}
            >
              {saving ? "Saving…" : pickedObligationTitle ? `Link ${pickedObligationTitle}` : "Link"}
            </button>
            <button
              type="button"
              onClick={() => {
                resetAddForm();
                setAddOpen(false);
              }}
              disabled={saving}
              className="text-xs font-medium px-3 py-1.5 rounded"
              style={{
                background: "transparent",
                color: "#94a3b8",
                border: "1px solid #1e293b",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <p className="text-sm" style={{ color: "#475569" }}>Loading…</p>
      ) : error ? (
        <p className="text-sm" style={{ color: "#fca5a5" }}>{error}</p>
      ) : links.length === 0 ? (
        <p className="text-sm" style={{ color: "#475569" }}>
          No obligations linked yet.
        </p>
      ) : (
        <div className="space-y-2">
          {links.map((link) => {
            const isUnlinking = unlinkingObligationId === link.obligation_id;
            return (
              <div
                key={link.link_id}
                className="rounded-lg p-3"
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  opacity: isUnlinking ? 0.5 : 1,
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/obligations/${link.obligation_id}`}
                      className="text-sm font-semibold"
                      style={{ color: "#f1f5f9", textDecoration: "none" }}
                    >
                      {link.obligation_title}
                    </Link>
                    {(link.obligation_source_regulation || link.obligation_jurisdiction) && (
                      <p className="text-xs mt-0.5" style={{ color: "#64748b" }}>
                        {[link.obligation_source_regulation, link.obligation_jurisdiction].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    {link.note && (
                      <p
                        className="text-xs mt-1.5"
                        style={{ color: "#cbd5e1", whiteSpace: "pre-wrap" }}
                      >
                        {link.note}
                      </p>
                    )}
                    <p className="text-xs mt-1.5" style={{ color: "#475569" }}>
                      Linked by {actorLabel(link)} on {fmtDate(link.link_created_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUnlink(link)}
                    disabled={isUnlinking}
                    className="text-xs font-medium px-2 py-1 rounded flex-shrink-0"
                    style={{
                      color: "#fca5a5",
                      background: "transparent",
                      border: "1px solid rgba(239,68,68,0.25)",
                      cursor: isUnlinking ? "wait" : "pointer",
                    }}
                  >
                    {isUnlinking ? "…" : "Unlink"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
