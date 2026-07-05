"use client";

/**
 * AddRelationshipForm — create an edge from/to this entity (goal Item 7, 7A.3).
 * Target pickers are fed server-side (first page of entities / vendors / AI systems —
 * the engine has no name-search endpoint yet), with a paste-an-ID fallback so no
 * valid target is unreachable. Engine enforces same-org endpoints, vocab, no
 * self-edges, and the edge cap; codes map to human copy.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createEnterpriseRelationship } from "@/lib/api";
import {
  NODE_TYPES,
  RELATIONSHIP_TYPES,
  enterpriseContextErrorMessage,
  type NodeType,
} from "@/lib/enterpriseContext";
import { nodeTypeLabel, relationshipTypeLabel } from "@/lib/enterpriseContextFormat";

export interface TargetCandidate {
  id: string;
  name: string;
}

const inputClass =
  "w-full rounded-lg px-3 py-2 text-sm border outline-none transition-colors";
const inputStyle = {
  background: "#0a0f1a",
  borderColor: "#1e2d45",
  color: "#f1f5f9",
};
const labelClass = "block text-xs font-semibold uppercase tracking-wide mb-1.5";

const OTHER_ID = "__other__";

export function AddRelationshipForm({
  entityId,
  entityName,
  candidates,
}: {
  entityId: string;
  entityName: string;
  candidates: Partial<Record<NodeType, TargetCandidate[]>>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<"outgoing" | "incoming">("outgoing");
  const [targetType, setTargetType] = useState<NodeType>("enterprise_entity");
  const [targetId, setTargetId] = useState<string>("");
  const [manualId, setManualId] = useState<string>("");

  const options = (candidates[targetType] ?? []).filter((c) => c.id !== entityId);
  const resolvedTargetId = targetId === OTHER_ID ? manualId.trim() : targetId;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!resolvedTargetId) {
      setError("Pick a target.");
      return;
    }
    setSubmitting(true);

    const fd = new FormData(e.currentTarget);
    const relationship_type = (fd.get("relationship_type") as string | null) ?? "";
    const noteRaw = ((fd.get("note") as string | null) ?? "").trim();

    const self = { type: "enterprise_entity" as NodeType, id: entityId };
    const other = { type: targetType, id: resolvedTargetId };
    const [from, to] = direction === "outgoing" ? [self, other] : [other, self];

    const result = await createEnterpriseRelationship({
      from_type: from.type,
      from_id: from.id,
      to_type: to.type,
      to_id: to.id,
      relationship_type,
      ...(noteRaw ? { note: noteRaw } : {}),
    });

    if (!result.ok) {
      setError(enterpriseContextErrorMessage(result.error));
      setSubmitting(false);
      return;
    }

    setOpen(false);
    setSubmitting(false);
    setTargetId("");
    setManualId("");
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:opacity-80"
        style={{ borderColor: "#1e293b", color: "#94a3b8" }}
      >
        + Add Relationship
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border p-4 space-y-4"
      style={{ borderColor: "#1e2d45" }}
    >
      {/* Direction */}
      <div>
        <span className={labelClass} style={{ color: "#94a3b8" }}>Direction</span>
        <div className="flex gap-2">
          <DirectionButton
            active={direction === "outgoing"}
            onClick={() => setDirection("outgoing")}
            label={`${entityName} → target`}
            disabled={submitting}
          />
          <DirectionButton
            active={direction === "incoming"}
            onClick={() => setDirection("incoming")}
            label={`target → ${entityName}`}
            disabled={submitting}
          />
        </div>
      </div>

      {/* Relationship type */}
      <div>
        <label className={labelClass} style={{ color: "#94a3b8" }}>Relationship</label>
        <select name="relationship_type" className={inputClass} style={inputStyle} disabled={submitting}>
          {RELATIONSHIP_TYPES.map((t) => (
            <option key={t} value={t}>
              {relationshipTypeLabel(t)}
            </option>
          ))}
        </select>
      </div>

      {/* Target */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelClass} style={{ color: "#94a3b8" }}>Target Type</label>
          <select
            value={targetType}
            onChange={(e) => {
              setTargetType(e.target.value as NodeType);
              setTargetId("");
            }}
            className={inputClass}
            style={inputStyle}
            disabled={submitting}
          >
            {NODE_TYPES.map((t) => (
              <option key={t} value={t}>
                {nodeTypeLabel(t)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} style={{ color: "#94a3b8" }}>Target</label>
          <select
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            className={inputClass}
            style={inputStyle}
            disabled={submitting}
          >
            <option value="">Choose…</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={OTHER_ID}>Other (paste ID)</option>
          </select>
        </div>
      </div>

      {targetId === OTHER_ID && (
        <div>
          <label className={labelClass} style={{ color: "#94a3b8" }}>Target ID</label>
          <input
            type="text"
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            placeholder="UUID of the target"
            className={inputClass}
            style={inputStyle}
            disabled={submitting}
          />
        </div>
      )}

      {/* Note */}
      <div>
        <label className={labelClass} style={{ color: "#94a3b8" }}>Note (optional)</label>
        <input
          type="text"
          name="note"
          maxLength={500}
          placeholder="Why this relationship exists"
          className={inputClass}
          style={inputStyle}
          disabled={submitting}
        />
      </div>

      {error && (
        <p
          className="rounded-lg border px-3 py-2 text-xs"
          style={{
            borderColor: "rgba(239,68,68,0.3)",
            background: "rgba(239,68,68,0.06)",
            color: "#fca5a5",
          }}
        >
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{ background: "#00c4b4", color: "#0a0f1a" }}
        >
          {submitting ? "Adding…" : "Add Relationship"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={submitting}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ color: "#64748b", border: "1px solid #1e293b", background: "transparent" }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function DirectionButton({
  active,
  onClick,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:opacity-80 disabled:opacity-50"
      style={
        active
          ? { background: "rgba(0,196,180,0.15)", borderColor: "rgba(0,196,180,0.4)", color: "#5eead4" }
          : { background: "transparent", borderColor: "#1e293b", color: "#94a3b8" }
      }
    >
      {label}
    </button>
  );
}
