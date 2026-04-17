import Link from "next/link";
import type { Evidence } from "@/lib/api";

const EVIDENCE_TYPE_STYLES: Record<string, { bg: string; color: string }> = {
  document:    { bg: "rgba(59,130,246,0.15)",   color: "#93c5fd" },
  screenshot:  { bg: "rgba(139,92,246,0.15)",   color: "#c4b5fd" },
  log:         { bg: "rgba(148,163,184,0.15)",  color: "#94a3b8" },
  test_result: { bg: "rgba(0,196,180,0.15)",    color: "#00c4b4" },
  interview:   { bg: "rgba(249,115,22,0.15)",   color: "#fdba74" },
  observation: { bg: "rgba(245,158,11,0.15)",   color: "#fcd34d" },
  policy:      { bg: "rgba(34,197,94,0.15)",    color: "#86efac" },
  other:       { bg: "rgba(148,163,184,0.10)",  color: "#64748b" },
};

function EvidenceTypeBadge({ type }: { type: string }) {
  const s = EVIDENCE_TYPE_STYLES[type] ?? EVIDENCE_TYPE_STYLES.other!;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
      style={{ background: s.bg, color: s.color }}
    >
      {type.replace(/_/g, " ")}
    </span>
  );
}

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

interface Props {
  assessmentId: string | null;
  evidence: Evidence[];
  obligationId: string;
}

export function EvidenceSection({ assessmentId, evidence, obligationId }: Props) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
          Evidence
        </h2>
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold"
          style={{ background: "rgba(148,163,184,0.12)", color: "#475569" }}
        >
          {evidence.length}
        </span>
      </div>

      {!assessmentId ? (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-6 text-center">
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            No assessments recorded yet. Evidence is attached to assessments.
          </p>
        </div>
      ) : evidence.length === 0 ? (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-6 text-center">
          <p className="text-sm mb-3" style={{ color: "#94a3b8" }}>
            No evidence attached to the latest assessment.
          </p>
          <Link
            href={`/obligations/${obligationId}/evidence/new`}
            className="text-xs font-medium hover:underline"
            style={{ color: "#00c4b4" }}
          >
            Add Evidence →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {evidence.map((ev) => (
            <div key={ev.id} className="bg-brand-surface border border-brand-line rounded-xl p-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <EvidenceTypeBadge type={ev.evidence_type} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium mb-0.5" style={{ color: "#f1f5f9" }}>
                    {ev.title}
                  </p>
                  {ev.description && (
                    <p
                      className="text-xs mb-1.5 overflow-hidden"
                      style={{
                        color: "#94a3b8",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {ev.description}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    {ev.collected_at && (
                      <span className="text-xs" style={{ color: "#64748b" }}>
                        Collected {fmtDate(ev.collected_at)}
                      </span>
                    )}
                    {ev.collected_by && (
                      <span className="text-xs" style={{ color: "#64748b" }}>
                        by {ev.collected_by}
                      </span>
                    )}
                    {ev.external_ref && (
                      <span className="text-xs" style={{ color: "#64748b" }}>
                        Ref: {ev.external_ref}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}

          <div className="pt-1">
            <Link
              href={`/obligations/${obligationId}/evidence/new`}
              className="text-xs font-medium hover:underline"
              style={{ color: "#00c4b4" }}
            >
              Add more evidence →
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
