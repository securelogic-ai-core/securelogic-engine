"use client";

/**
 * LinkedControlsSection (RR-4) — "Mitigating Controls" section on the
 * risk detail page. Lets the risk owner attach the controls that mitigate
 * this risk and remove them again.
 *
 * Sits between the Active Treatments list and the History section, mirroring
 * the visual weight of the surrounding cards.
 *
 * Behavior:
 *   - On mount, fetches GET /api/risks/:id/controls (proxy → engine).
 *   - "Add control" toggles a ControlPicker + optional note + Save / Cancel.
 *   - Save → POST /api/risks/:id/controls; on success, refresh + collapse.
 *   - Per-row "Unlink" → confirm() → DELETE; refresh on success.
 *   - excludeIds passed to the picker so the user can't double-link.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getControlsForRisk,
  linkRiskToControl,
  unlinkRiskFromControl,
  type RiskControlLink,
} from "@/lib/api";
import { ControlPicker } from "@/components/controls/ControlPicker";

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

function actorLabel(link: RiskControlLink): string {
  if (link.created_by_name)  return link.created_by_name;
  if (link.created_by_email) return link.created_by_email;
  return "—";
}

export function LinkedControlsSection({ riskId }: { riskId: string }) {
  const [links, setLinks]       = useState<RiskControlLink[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  // Add-affordance state
  const [addOpen, setAddOpen]                 = useState(false);
  const [pickedControlId, setPickedControlId] = useState<string | null>(null);
  const [pickedControlName, setPickedControlName] = useState<string | null>(null);
  const [note, setNote]                       = useState<string>("");
  const [saving, setSaving]                   = useState(false);
  const [saveError, setSaveError]             = useState<string | null>(null);

  // Per-row unlink state — track which row is currently being deleted so
  // multiple parallel deletes don't fight each other in the UI.
  const [unlinkingControlId, setUnlinkingControlId] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setLoading(true);
    setError(null);
    const res = await getControlsForRisk(riskId);
    setLoading(false);
    if (!res) {
      setError("Could not load linked controls");
      return;
    }
    setLinks(res.links);
  }

  useEffect(() => {
    void refresh();
    // refresh is stable per render; no need for useCallback because the only
    // external dep is riskId which is captured in closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [riskId]);

  function resetAddForm() {
    setPickedControlId(null);
    setPickedControlName(null);
    setNote("");
    setSaveError(null);
  }

  async function handleSave() {
    if (!pickedControlId) {
      setSaveError("Pick a control first");
      return;
    }
    setSaving(true);
    setSaveError(null);
    const trimmedNote = note.trim();
    const res = await linkRiskToControl(
      riskId,
      pickedControlId,
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

  async function handleUnlink(link: RiskControlLink) {
    if (!confirm(`Remove "${link.control_name}" from this risk?`)) return;
    setUnlinkingControlId(link.control_id);
    const res = await unlinkRiskFromControl(riskId, link.control_id);
    setUnlinkingControlId(null);
    if (!res.ok) {
      // Surface the error inline rather than alert() so the user can see it
      // alongside the row that failed.
      setError(`Could not unlink: ${res.error}`);
      return;
    }
    await refresh();
  }

  const linkedControlIds = links.map((l) => l.control_id);

  return (
    <div className="mb-6 p-5" style={CARD_STYLE}>
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <p style={SECTION_LABEL}>Mitigating Controls</p>
          {!loading && (
            <span className="text-xs" style={{ color: "#64748b" }}>
              {links.length} {links.length === 1 ? "control" : "controls"}
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
            + Link Control
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
            Control
          </label>
          <ControlPicker
            value={pickedControlId}
            onChange={(id, name) => {
              setPickedControlId(id);
              setPickedControlName(name);
            }}
            excludeIds={linkedControlIds}
            ariaLabel="Pick a control to link to this risk"
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
            placeholder="Why is this control mitigating this risk?"
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
              disabled={saving || !pickedControlId}
              className="text-xs font-semibold px-3 py-1.5 rounded"
              style={{
                background: "#00c4b4",
                color: "#0a0f1a",
                border: "none",
                cursor: saving || !pickedControlId ? "not-allowed" : "pointer",
                opacity: saving || !pickedControlId ? 0.5 : 1,
              }}
            >
              {saving ? "Saving…" : pickedControlName ? `Link ${pickedControlName}` : "Link"}
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
          No controls linked yet.
        </p>
      ) : (
        <div className="space-y-2">
          {links.map((link) => {
            const isUnlinking = unlinkingControlId === link.control_id;
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
                      href={`/controls/${link.control_id}`}
                      className="text-sm font-semibold"
                      style={{ color: "#f1f5f9", textDecoration: "none" }}
                    >
                      {link.control_name}
                    </Link>
                    {(link.control_family || link.control_domain) && (
                      <p className="text-xs mt-0.5" style={{ color: "#64748b" }}>
                        {[link.control_family, link.control_domain].filter(Boolean).join(" · ")}
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
