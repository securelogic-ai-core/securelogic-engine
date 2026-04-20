"use client";

import { useState, useCallback } from "react";
import type { FrameworkRequirements } from "@/lib/api";
import { createFindingsForFailures } from "./actions";

type Status = "pass" | "fail" | "partial" | "not_assessed";

type CardState = {
  status: Status;
  notes: string;
  evidenceUrl: string;
  saving: boolean;
  savedAt: number | null;
  error: string | null;
};

const STATUS_OPTIONS: { value: Status; label: string; color: string }[] = [
  { value: "pass",         label: "Pass",         color: "#86efac" },
  { value: "partial",      label: "Partial",      color: "#fcd34d" },
  { value: "fail",         label: "Fail",         color: "#fca5a5" },
  { value: "not_assessed", label: "Not Assessed", color: "#94a3b8" },
];

function RequirementCard({
  req,
  card,
  onStatusChange,
  onNotesChange,
  onNotesSave,
  onEvidenceUrlChange,
  onEvidenceUrlSave,
}: {
  req: FrameworkRequirements["requirements"][number];
  card: CardState;
  onStatusChange: (reqId: string, status: Status) => void;
  onNotesChange: (reqId: string, notes: string) => void;
  onNotesSave: (reqId: string) => void;
  onEvidenceUrlChange: (reqId: string, url: string) => void;
  onEvidenceUrlSave: (reqId: string) => void;
}) {
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const showNotes = card.status === "fail" || card.status === "partial";
  const showEvidence = card.status !== "not_assessed";

  return (
    <div
      className="bg-brand-surface border rounded-xl p-4 transition-colors"
      style={{
        borderColor:
          card.status === "pass"    ? "rgba(34,197,94,0.25)" :
          card.status === "fail"    ? "rgba(239,68,68,0.25)" :
          card.status === "partial" ? "rgba(245,158,11,0.25)" :
          "#1e293b",
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono font-medium"
              style={{ background: "rgba(0,196,180,0.08)", color: "#00c4b4" }}
            >
              {req.reference_id}
            </span>
          </div>
          <p className="text-sm" style={{ color: "#cbd5e1" }}>
            {req.title}
          </p>
        </div>

        <div className="flex-shrink-0 w-16 text-right">
          {card.saving && (
            <span className="text-xs" style={{ color: "#94a3b8" }}>Saving…</span>
          )}
          {!card.saving && card.error && (
            <span className="text-xs" style={{ color: "#fca5a5" }}>Error</span>
          )}
          {!card.saving && !card.error && card.savedAt && (
            <span className="text-xs" style={{ color: "#86efac" }}>Saved</span>
          )}
        </div>
      </div>

      {/* Guidance toggle */}
      {req.description && (
        <div className="mb-3">
          <button
            onClick={() => setGuidanceOpen((o) => !o)}
            className="text-xs font-medium transition-opacity hover:opacity-80"
            style={{ color: "#00c4b4" }}
          >
            What does this mean? {guidanceOpen ? "▲" : "▼"}
          </button>
          {guidanceOpen && (
            <div
              className="mt-2 rounded-lg px-3 py-2.5 text-xs leading-relaxed"
              style={{ background: "rgba(0,196,180,0.06)", color: "#94a3b8", border: "1px solid rgba(0,196,180,0.12)" }}
            >
              {req.description}
            </div>
          )}
        </div>
      )}

      {/* Status selector */}
      <div className="flex gap-2 flex-wrap">
        {STATUS_OPTIONS.map((opt) => {
          const isActive = card.status === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => onStatusChange(req.id, opt.value)}
              disabled={card.saving}
              className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
              style={
                isActive
                  ? { background: `rgba(${opt.value === "pass" ? "34,197,94" : opt.value === "partial" ? "245,158,11" : opt.value === "fail" ? "239,68,68" : "148,163,184"},0.18)`, color: opt.color, border: `1px solid ${opt.color}40` }
                  : { background: "rgba(255,255,255,0.03)", color: "#475569", border: "1px solid rgba(255,255,255,0.06)" }
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Notes */}
      {showNotes && (
        <div className="mt-3">
          <textarea
            rows={2}
            placeholder="Notes (optional)"
            value={card.notes}
            onChange={(e) => onNotesChange(req.id, e.target.value)}
            onBlur={() => onNotesSave(req.id)}
            className="w-full rounded-lg text-xs px-3 py-2 resize-none transition-colors"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#cbd5e1",
              outline: "none",
            }}
          />
        </div>
      )}

      {/* Evidence URL */}
      {showEvidence && (
        <div className="mt-3">
          <input
            type="url"
            placeholder="Evidence URL (optional)"
            value={card.evidenceUrl}
            onChange={(e) => onEvidenceUrlChange(req.id, e.target.value)}
            onBlur={() => onEvidenceUrlSave(req.id)}
            className="w-full rounded-lg text-xs px-3 py-2 transition-colors"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#cbd5e1",
              outline: "none",
            }}
          />
          {card.evidenceUrl && (
            <a
              href={card.evidenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block text-xs hover:underline truncate max-w-full"
              style={{ color: "#00c4b4" }}
            >
              {card.evidenceUrl}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function AssessmentChecklist({
  frameworkId,
  subjectId,
  initialData,
}: {
  frameworkId: string;
  subjectId: string;
  initialData: FrameworkRequirements;
}) {
  const requirements = initialData.requirements;

  const [cards, setCards] = useState<Map<string, CardState>>(() => {
    const m = new Map<string, CardState>();
    for (const req of requirements) {
      m.set(req.id, {
        status: (req.response?.status ?? "not_assessed") as Status,
        notes: req.response?.notes ?? "",
        evidenceUrl: req.response?.evidence_url ?? "",
        saving: false,
        savedAt: null,
        error: null,
      });
    }
    return m;
  });

  const [creatingFindings, setCreatingFindings] = useState(false);
  const [findingsResult, setFindingsResult] = useState<{ created: number } | null>(null);

  const cardValues = [...cards.values()];
  const total = requirements.length;
  const pass = cardValues.filter((c) => c.status === "pass").length;
  const partial = cardValues.filter((c) => c.status === "partial").length;
  const fail = cardValues.filter((c) => c.status === "fail").length;
  const not_assessed = total - pass - partial - fail;
  const readiness_pct =
    total === 0 ? 0 : Math.round(((pass + partial * 0.5) / total) * 10000) / 100;

  const readinessColor =
    readiness_pct >= 75 ? "#22c55e" :
    readiness_pct >= 50 ? "#f59e0b" :
    readiness_pct >= 25 ? "#f97316" :
    "#ef4444";

  const saveToEngine = useCallback(
    async (reqId: string, status: Status, notes: string, evidenceUrl: string) => {
      setCards((prev) => {
        const m = new Map(prev);
        const c = m.get(reqId);
        if (c) m.set(reqId, { ...c, saving: true, error: null });
        return m;
      });

      try {
        const res = await fetch("/api/requirement-responses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requirement_id: reqId,
            assessment_type: "self",
            subject_id: subjectId,
            status,
            notes: notes.trim() || null,
            evidence_url: evidenceUrl.trim() || null,
          }),
        });

        if (!res.ok) throw new Error("save_failed");

        setCards((prev) => {
          const m = new Map(prev);
          const c = m.get(reqId);
          if (c) m.set(reqId, { ...c, saving: false, savedAt: Date.now(), error: null });
          return m;
        });
      } catch {
        setCards((prev) => {
          const m = new Map(prev);
          const c = m.get(reqId);
          if (c) m.set(reqId, { ...c, saving: false, error: "Failed to save" });
          return m;
        });
      }
    },
    [subjectId]
  );

  const handleStatusChange = useCallback(
    (reqId: string, status: Status) => {
      let currentNotes = "";
      let currentEvidenceUrl = "";
      setCards((prev) => {
        const m = new Map(prev);
        const c = m.get(reqId);
        if (c) {
          currentNotes = c.notes;
          currentEvidenceUrl = c.evidenceUrl;
          m.set(reqId, { ...c, status });
        }
        return m;
      });
      saveToEngine(reqId, status, currentNotes, currentEvidenceUrl);
    },
    [saveToEngine]
  );

  const handleNotesChange = useCallback((reqId: string, notes: string) => {
    setCards((prev) => {
      const m = new Map(prev);
      const c = m.get(reqId);
      if (c) m.set(reqId, { ...c, notes });
      return m;
    });
  }, []);

  const handleNotesSave = useCallback(
    (reqId: string) => {
      const c = cards.get(reqId);
      if (c) saveToEngine(reqId, c.status, c.notes, c.evidenceUrl);
    },
    [cards, saveToEngine]
  );

  const handleEvidenceUrlChange = useCallback((reqId: string, url: string) => {
    setCards((prev) => {
      const m = new Map(prev);
      const c = m.get(reqId);
      if (c) m.set(reqId, { ...c, evidenceUrl: url });
      return m;
    });
  }, []);

  const handleEvidenceUrlSave = useCallback(
    (reqId: string) => {
      const c = cards.get(reqId);
      if (c) saveToEngine(reqId, c.status, c.notes, c.evidenceUrl);
    },
    [cards, saveToEngine]
  );

  const failingRequirements = requirements.filter((r) => cards.get(r.id)?.status === "fail");

  const handleCreateFindings = async () => {
    setCreatingFindings(true);
    const result = await createFindingsForFailures(
      frameworkId,
      initialData.framework.name,
      failingRequirements.map((r) => ({
        requirementId: r.id,
        referenceId: r.reference_id,
        title: r.title,
      }))
    );
    setCreatingFindings(false);
    if ("created" in result) setFindingsResult(result);
  };

  return (
    <div>
      {/* Progress panel */}
      <div className="bg-brand-surface border border-brand-line rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between gap-4 mb-3">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
            Assessment Progress
          </p>
          <span className="text-sm font-bold tabular-nums" style={{ color: readinessColor }}>
            {readiness_pct}%
          </span>
        </div>

        <div className="rounded-full h-2 mb-4" style={{ background: "rgba(255,255,255,0.06)" }}>
          <div
            className="h-2 rounded-full transition-all"
            style={{ width: `${readiness_pct}%`, background: readinessColor }}
          />
        </div>

        <div className="grid grid-cols-4 gap-3 text-center">
          {[
            { label: "Pass",         value: pass,         color: "#86efac" },
            { label: "Partial",      value: partial,      color: "#fcd34d" },
            { label: "Fail",         value: fail,         color: "#fca5a5" },
            { label: "Not Assessed", value: not_assessed, color: "#475569" },
          ].map((s) => (
            <div key={s.label}>
              <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
              <p className="text-xs mt-0.5" style={{ color: "#475569" }}>{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Requirements */}
      <div className="space-y-3 mb-8">
        {requirements.map((req) => {
          const card = cards.get(req.id);
          if (!card) return null;
          return (
            <RequirementCard
              key={req.id}
              req={req}
              card={card}
              onStatusChange={handleStatusChange}
              onNotesChange={handleNotesChange}
              onNotesSave={handleNotesSave}
              onEvidenceUrlChange={handleEvidenceUrlChange}
              onEvidenceUrlSave={handleEvidenceUrlSave}
            />
          );
        })}
      </div>

      {/* Completion panel */}
      {failingRequirements.length > 0 && (
        <div
          className="border rounded-xl p-5"
          style={{ borderColor: "rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.05)" }}
        >
          <h3 className="text-sm font-semibold mb-1" style={{ color: "#fca5a5" }}>
            {failingRequirements.length} Failing Requirement{failingRequirements.length !== 1 ? "s" : ""}
          </h3>
          <p className="text-xs mb-4" style={{ color: "#94a3b8" }}>
            Create open findings in the risk register for each failed requirement.
          </p>
          <ul className="space-y-1 mb-4">
            {failingRequirements.map((r) => (
              <li key={r.id} className="text-xs" style={{ color: "#cbd5e1" }}>
                <span className="font-mono" style={{ color: "#00c4b4" }}>{r.reference_id}</span>
                {" — "}{r.title}
              </li>
            ))}
          </ul>

          {findingsResult ? (
            <p className="text-xs font-medium" style={{ color: "#86efac" }}>
              {findingsResult.created} finding{findingsResult.created !== 1 ? "s" : ""} created.
            </p>
          ) : (
            <button
              onClick={handleCreateFindings}
              disabled={creatingFindings}
              className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ background: "rgba(239,68,68,0.2)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.3)" }}
            >
              {creatingFindings ? "Creating…" : "Create Findings for Failures"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
