import Link from "next/link";
import type {
  IntelligenceBriefDetailResponse,
  IntelligenceBriefItem,
} from "@/lib/api";

interface IntelligenceBriefCardProps {
  brief: IntelligenceBriefDetailResponse;
}

const TOP_N = 5;

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function categoryLabel(cat: string): string {
  switch (cat) {
    case "vulnerability":   return "Vulnerability";
    case "threat_actor":    return "Threat Actor";
    case "vendor_incident": return "Vendor Incident";
    case "regulatory":      return "Regulatory";
    case "general":         return "General";
    default:                return cat;
  }
}

function categoryStyle(cat: string): string {
  switch (cat) {
    case "vulnerability":
      return "bg-red-900/40 text-red-300 border-red-800/50";
    case "threat_actor":
      return "bg-purple-900/40 text-purple-300 border-purple-800/50";
    case "vendor_incident":
      return "bg-orange-900/40 text-orange-300 border-orange-800/50";
    case "regulatory":
      return "bg-blue-900/40 text-blue-300 border-blue-800/50";
    default:
      return "bg-slate-800 text-slate-400 border-slate-700";
  }
}

function relevanceStyle(rel: string): string {
  const r = rel.toLowerCase();
  if (r === "high")   return "text-orange-300";
  if (r === "medium") return "text-yellow-300";
  return "text-slate-500";
}

function BriefItemRow({ item }: { item: IntelligenceBriefItem }) {
  return (
    <li className="border-t border-brand-line pt-3">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <h4 className="text-slate-100 font-semibold text-sm leading-snug flex-1">
          {item.title}
        </h4>
        <span
          className={`text-[10px] uppercase tracking-wide font-bold flex-shrink-0 ${relevanceStyle(item.relevance)}`}
        >
          {item.relevance}
        </span>
      </div>

      <div className="flex items-center gap-1.5 mb-1.5">
        <span
          className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border ${categoryStyle(item.category)}`}
        >
          {categoryLabel(item.category)}
        </span>
      </div>

      {item.why_it_matters && (
        <p className="text-slate-400 text-xs leading-relaxed line-clamp-3">
          {item.why_it_matters}
        </p>
      )}
    </li>
  );
}

export function IntelligenceBriefCard({ brief }: IntelligenceBriefCardProps) {
  const date = formatDate(brief.period_end);
  const items = brief.items.slice(0, TOP_N);
  const remaining = Math.max(0, brief.item_count - items.length);

  return (
    <div className="bg-brand-surface border border-brand-line border-l-4 border-l-brand-teal rounded-xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">
            {date}
          </p>
          <h3 className="text-slate-100 font-bold text-base leading-snug mt-1">
            Daily Intelligence Brief
          </h3>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-teal-900/40 text-teal-300 border border-teal-800/50 uppercase tracking-wide flex-shrink-0">
          {brief.item_count} item{brief.item_count !== 1 ? "s" : ""}
          <span className="text-teal-500">·</span>
          {brief.signal_count} signal{brief.signal_count !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Body */}
      {items.length > 0 ? (
        <ul className="space-y-3">
          {items.map((item) => (
            <BriefItemRow key={item.id} item={item} />
          ))}
        </ul>
      ) : (
        <p className="text-slate-500 text-sm italic py-4">
          No items in this brief yet.
        </p>
      )}

      {/* Footer */}
      <div className="mt-4 pt-4 border-t border-brand-line flex items-center justify-between">
        <Link
          href={`/briefs/${brief.id}`}
          className="text-brand-teal hover:text-teal-300 text-sm font-semibold transition-colors"
        >
          View full brief →
        </Link>
        {remaining > 0 && (
          <span className="text-xs text-slate-500">
            +{remaining} more
          </span>
        )}
      </div>
    </div>
  );
}
