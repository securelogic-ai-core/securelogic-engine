import Link from "next/link";
import type { IntelligenceBriefItem, IntelligenceBriefUrgency } from "@/lib/api";

interface IntelligenceBriefSignalCardProps {
  briefId: string;
  item: IntelligenceBriefItem;
  index: number;
}

// ---------------------------------------------------------------------------
// Urgency band
// ---------------------------------------------------------------------------

const URGENCY_BAND_BG: Record<IntelligenceBriefUrgency, string> = {
  immediate: "bg-rose-800",
  near_term: "bg-orange-500",
  far_term: "bg-slate-700",
};

const URGENCY_BAND_LABEL: Record<IntelligenceBriefUrgency, string> = {
  immediate: "IMMEDIATE",
  near_term: "NEAR TERM",
  far_term: "FAR TERM",
};

function urgencyBg(urgency: IntelligenceBriefUrgency | null): string {
  if (urgency === null) return "bg-slate-700";
  return URGENCY_BAND_BG[urgency];
}

function urgencyLabel(urgency: IntelligenceBriefUrgency | null): string {
  if (urgency === null) return "UNCLASSIFIED";
  return URGENCY_BAND_LABEL[urgency];
}

// ---------------------------------------------------------------------------
// Category label (chip in the band)
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  vulnerability: "Vulnerability",
  threat_actor: "Threat Actor",
  vendor_incident: "Vendor Incident",
  regulatory: "Regulatory",
  general: "General",
};

function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

// ---------------------------------------------------------------------------
// Severity / relevance — light-on-dark pill (intentional contrast on slate-800)
// ---------------------------------------------------------------------------

function severityPillClass(relevance: string | null): string {
  const r = (relevance ?? "").toLowerCase();
  if (r === "high") return "bg-orange-100 text-orange-700 border border-orange-200";
  if (r === "medium") return "bg-yellow-100 text-yellow-700 border border-yellow-200";
  if (r === "low") return "bg-green-100 text-green-700 border border-green-200";
  return "bg-slate-100 text-slate-700 border border-slate-200";
}

function severityLabel(relevance: string | null): string {
  return (relevance ?? "").toUpperCase() || "—";
}

// ---------------------------------------------------------------------------
// Card outer left-border accent — driven by relevance, matching legacy
// ---------------------------------------------------------------------------

function relevanceBorderClass(relevance: string | null): string {
  const r = (relevance ?? "").toLowerCase();
  if (r === "high") return "border-l-orange-400";
  if (r === "medium") return "border-l-yellow-400";
  if (r === "low") return "border-l-green-400";
  return "border-l-slate-600";
}

// ---------------------------------------------------------------------------
// First-line action — strip leading "1. " numerals from the newline-numbered
// recommended_actions string. Returns null when input is null/empty.
// ---------------------------------------------------------------------------

function firstAction(recommendedActions: string | null): string | null {
  if (!recommendedActions) return null;
  const firstLine = recommendedActions.split("\n").map((s) => s.trim()).find(Boolean);
  if (!firstLine) return null;
  return firstLine.replace(/^\d+\.\s*/, "");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IntelligenceBriefSignalCard({
  briefId,
  item,
  index,
}: IntelligenceBriefSignalCardProps) {
  const action = firstAction(item.recommended_actions);
  const detailHref = `/briefs/${briefId}/signal/item/${index}`;
  const bandBg = urgencyBg(item.urgency ?? null);
  const bandLabel = urgencyLabel(item.urgency ?? null);

  return (
    <div
      className={`border border-slate-700 border-l-4 ${relevanceBorderClass(item.relevance)} rounded-xl overflow-hidden shadow-sm`}
    >
      {/* Priority band */}
      <div className={`${bandBg} px-5 py-[9px] flex items-center gap-3`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-xs font-bold text-white uppercase tracking-widest flex-shrink-0">
            {bandLabel}
          </span>
          <span className="text-white/30 select-none flex-shrink-0">·</span>
          <span className="text-xs font-semibold text-white/60 uppercase tracking-wide truncate">
            {categoryLabel(item.category)}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="bg-slate-800 p-6">
        <div className="flex items-start justify-between gap-3 mb-4">
          <h3 className="font-bold text-base leading-snug flex-1 text-slate-100">
            <Link href={detailHref} className="hover:text-teal-300 transition-colors">
              {item.title}
            </Link>
          </h3>
          <span
            className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide flex-shrink-0 ${severityPillClass(item.relevance)}`}
          >
            {severityLabel(item.relevance)}
          </span>
        </div>

        {action && (
          <div className="mb-4 bg-teal-50 rounded-lg p-4 border border-teal-100">
            <p className="text-xs font-bold text-teal-700 uppercase tracking-wide mb-1.5">
              Action
            </p>
            <p className="text-sm text-slate-800 leading-relaxed font-medium">
              {action}
            </p>
          </div>
        )}

        {item.why_it_matters && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
              Context
            </p>
            <p className="text-sm text-slate-300 leading-relaxed line-clamp-3">
              {item.why_it_matters}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-slate-700 gap-3">
          {item.affected_cve ? (
            <span className="text-xs font-mono text-slate-400 uppercase tracking-wide truncate">
              {item.affected_cve}
            </span>
          ) : (
            <span />
          )}
          <Link
            href={detailHref}
            className="inline-flex items-center gap-1.5 text-xs font-semibold border border-teal-200 px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
            style={{ color: "#00c4b4", backgroundColor: "#f0fdfa" }}
          >
            Read full analysis →
          </Link>
        </div>
      </div>
    </div>
  );
}
