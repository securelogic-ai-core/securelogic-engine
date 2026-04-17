"use client";

import { useState } from "react";
import Link from "next/link";
import { createControlMapping } from "./framework-map/actions";
import type { ReadinessRequirement } from "@/lib/api";

export type MappedRequirementDisplay = {
  requirementId: string;
  referenceId: string;
  title: string;
  frameworkName: string;
  frameworkId: string;
  assessmentStatus: string | null;
};

interface FrameworkInfo {
  id: string;
  name: string;
}

interface FrameworkMappingsCardProps {
  controlId: string;
  mappedRequirements: MappedRequirementDisplay[];
  frameworks: FrameworkInfo[];
  allRequirementsByFramework: Record<string, ReadinessRequirement[]>;
}

const ASSESSMENT_DOT_COLORS: Record<string, string> = {
  passed:               "#22c55e",
  failed:               "#ef4444",
  in_progress:          "#60a5fa",
  remediation_required: "#f97316",
  not_started:          "#475569",
};

function AssessmentDot({ status }: { status: string | null }) {
  const color = status ? (ASSESSMENT_DOT_COLORS[status] ?? "#475569") : "#475569";
  return (
    <span
      className="inline-block rounded-full flex-shrink-0"
      style={{ width: "7px", height: "7px", background: color }}
      title={status?.replace(/_/g, " ") ?? "no assessment"}
    />
  );
}

export function FrameworkMappingsCard({
  controlId,
  mappedRequirements,
  frameworks,
  allRequirementsByFramework,
}: FrameworkMappingsCardProps) {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedFrameworkId, setSelectedFrameworkId] = useState<string>(
    frameworks[0]?.id ?? ""
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingRequirementId, setPendingRequirementId] = useState<string | null>(null);
  const [justMappedIds, setJustMappedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const alreadyMappedReqIds = new Set([
    ...mappedRequirements.map((r) => r.requirementId),
    ...justMappedIds,
  ]);

  const frameworkRequirements = allRequirementsByFramework[selectedFrameworkId] ?? [];
  const filtered = frameworkRequirements.filter((r) =>
    r.reference_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  async function handleMap(requirementId: string) {
    if (pendingRequirementId !== null) return;
    setPendingRequirementId(requirementId);
    setError(null);
    const result = await createControlMapping(controlId, requirementId, selectedFrameworkId);
    if (result && "error" in result) {
      setError(result.error);
      setPendingRequirementId(null);
    } else {
      setJustMappedIds((prev) => [...prev, requirementId]);
      setPendingRequirementId(null);
    }
  }

  const displayCount = mappedRequirements.length + justMappedIds.length;

  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
          Framework Mappings
        </h3>
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold"
          style={{ background: "rgba(148,163,184,0.12)", color: "#475569" }}
        >
          {displayCount}
        </span>
      </div>

      {/* Mapped requirements */}
      {mappedRequirements.length === 0 && justMappedIds.length === 0 ? (
        <p className="text-xs mb-3" style={{ color: "#475569" }}>
          Not mapped to any framework requirement.
        </p>
      ) : (
        <div className="space-y-2 mb-3">
          {mappedRequirements.map((r) => (
            <div key={r.requirementId} className="flex items-start gap-2">
              <AssessmentDot status={r.assessmentStatus} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span
                    className="font-mono text-xs"
                    style={{ background: "rgba(148,163,184,0.1)", color: "#94a3b8", padding: "1px 4px", borderRadius: "3px" }}
                  >
                    {r.referenceId}
                  </span>
                </div>
                <p
                  className="text-xs leading-snug mt-0.5 line-clamp-2"
                  style={{ color: "#cbd5e1" }}
                  title={r.title}
                >
                  {r.title}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "#475569" }}>
                  {r.frameworkName}
                </p>
              </div>
            </div>
          ))}

          {/* Optimistically added mappings (title not yet available) */}
          {justMappedIds.map((reqId) => {
            if (mappedRequirements.some((r) => r.requirementId === reqId)) return null;
            return (
              <div key={reqId} className="flex items-start gap-2">
                <AssessmentDot status={null} />
                <p className="text-xs" style={{ color: "#475569" }}>Mapped ✓</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Add to Framework toggle */}
      {frameworks.length > 0 && (
        <div>
          <button
            onClick={() => { setIsAddOpen((o) => !o); setSearchQuery(""); setError(null); }}
            className="text-xs font-medium transition-colors"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: isAddOpen ? "#00c4b4" : "#475569",
              padding: 0,
            }}
          >
            {isAddOpen ? "▲ Hide" : "＋ Add to Framework"}
          </button>

          {isAddOpen && (
            <div className="mt-3 space-y-2">
              {/* Framework selector */}
              {frameworks.length > 1 && (
                <div className="flex flex-wrap gap-1">
                  {frameworks.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => { setSelectedFrameworkId(f.id); setSearchQuery(""); }}
                      className="text-xs px-2 py-0.5 rounded transition-colors"
                      style={{
                        background: selectedFrameworkId === f.id
                          ? "rgba(0,196,180,0.15)"
                          : "rgba(255,255,255,0.04)",
                        color: selectedFrameworkId === f.id ? "#00c4b4" : "#94a3b8",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Search */}
              <input
                type="text"
                placeholder="Search requirements..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid #1e293b",
                  color: "#f1f5f9",
                  padding: "5px 9px",
                  borderRadius: "6px",
                  fontSize: "11px",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />

              {/* Requirements list */}
              <div
                style={{
                  maxHeight: "180px",
                  overflowY: "auto",
                  background: "#0d1626",
                  border: "1px solid #1e293b",
                  borderRadius: "6px",
                }}
              >
                {frameworkRequirements.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-center" style={{ color: "#475569" }}>
                    No requirements for this framework.
                  </p>
                ) : filtered.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-center" style={{ color: "#475569" }}>
                    No requirements match
                  </p>
                ) : (
                  filtered.map((r) => {
                    const isMapped = alreadyMappedReqIds.has(r.id);
                    const isPending = pendingRequirementId === r.id;
                    return (
                      <RequirementPickerRow
                        key={r.id}
                        referenceId={r.reference_id}
                        title={r.title}
                        isMapped={isMapped}
                        isPending={isPending}
                        onClick={() => handleMap(r.id)}
                      />
                    );
                  })
                )}
              </div>

              {error && (
                <p className="text-xs" style={{ color: "#fca5a5" }}>{error}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer link */}
      <div className="mt-3 pt-3" style={{ borderTop: "1px solid #1e2d45" }}>
        <Link
          href="/frameworks"
          className="text-xs font-medium hover:underline"
          style={{ color: "#00c4b4" }}
        >
          View Frameworks →
        </Link>
      </div>
    </div>
  );
}

function RequirementPickerRow({
  referenceId,
  title,
  isMapped,
  isPending,
  onClick,
}: {
  referenceId: string;
  title: string;
  isMapped: boolean;
  isPending: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const disabled = isMapped || isPending;
  return (
    <button
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        width: "100%",
        padding: "6px 10px",
        gap: "6px",
        background: hovered && !disabled ? "rgba(255,255,255,0.04)" : "transparent",
        border: "none",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        cursor: disabled ? "default" : "pointer",
        opacity: isPending ? 0.5 : 1,
        textAlign: "left",
      }}
    >
      <span
        className="font-mono flex-shrink-0"
        style={{
          fontSize: "10px",
          background: "rgba(148,163,184,0.1)",
          color: isMapped ? "#475569" : "#94a3b8",
          padding: "1px 4px",
          borderRadius: "3px",
          marginTop: "1px",
        }}
      >
        {referenceId}
      </span>
      <span
        className="flex-1 leading-snug"
        style={{
          fontSize: "11px",
          color: isMapped ? "#475569" : "#cbd5e1",
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
        }}
      >
        {title}
      </span>
      {isMapped && (
        <span className="flex-shrink-0" style={{ color: "#00c4b4", fontSize: "11px" }}>✓</span>
      )}
      {isPending && (
        <span className="flex-shrink-0" style={{ color: "#475569", fontSize: "11px" }}>…</span>
      )}
    </button>
  );
}
