import type {
  IntelligenceBriefDetailResponse,
  IntelligenceBriefItem,
} from "@/lib/api";

interface IntelligenceBriefDetailItemsProps {
  brief: IntelligenceBriefDetailResponse;
}

const CATEGORY_ORDER = [
  "vulnerability",
  "threat_actor",
  "vendor_incident",
  "regulatory",
  "general",
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  vulnerability: "Vulnerabilities & Patches",
  threat_actor: "Threat Actors & Malware",
  vendor_incident: "Vendor & Supply Chain Incidents",
  regulatory: "Regulatory & Compliance Updates",
  general: "General Intelligence",
};

function categoryShortLabel(cat: string): string {
  switch (cat) {
    case "vulnerability":
      return "Vulnerability";
    case "threat_actor":
      return "Threat Actor";
    case "vendor_incident":
      return "Vendor Incident";
    case "regulatory":
      return "Regulatory";
    case "general":
      return "General";
    default:
      return cat;
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
  if (r === "high") return "text-orange-300";
  if (r === "medium") return "text-yellow-300";
  return "text-slate-500";
}

function ItemRow({ item }: { item: IntelligenceBriefItem }) {
  const actions = (item.recommended_actions ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^\d+\.\s*/, ""));

  return (
    <article className="border-t border-brand-line pt-6 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="text-slate-100 font-semibold text-base leading-snug flex-1">
          {item.title}
        </h3>
        <span
          className={`text-[10px] uppercase tracking-wide font-bold flex-shrink-0 mt-0.5 ${relevanceStyle(item.relevance)}`}
        >
          {item.relevance}
        </span>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <span
          className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded border ${categoryStyle(item.category)}`}
        >
          {categoryShortLabel(item.category)}
        </span>
        {item.affected_cve && (
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wide">
            {item.affected_cve}
          </span>
        )}
        {item.affected_vendor && (
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">
            {item.affected_vendor}
          </span>
        )}
      </div>

      {item.why_it_matters && (
        <p className="text-slate-300 text-sm leading-relaxed mb-4 max-w-prose">
          {item.why_it_matters}
        </p>
      )}

      {actions.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-2">
            Recommended actions
          </p>
          <ol className="list-decimal list-outside ml-5 space-y-1.5 max-w-prose marker:text-slate-600">
            {actions.map((action, i) => (
              <li key={i} className="text-slate-300 text-sm leading-relaxed pl-1">
                {action}
              </li>
            ))}
          </ol>
        </div>
      )}
    </article>
  );
}

export function IntelligenceBriefDetailItems({
  brief,
}: IntelligenceBriefDetailItemsProps) {
  if (brief.items.length === 0) {
    return (
      <p className="text-slate-500 text-sm italic py-6">
        No items in this brief.
      </p>
    );
  }

  const grouped = new Map<string, IntelligenceBriefItem[]>();
  for (const item of brief.items) {
    const list = grouped.get(item.category) ?? [];
    list.push(item);
    grouped.set(item.category, list);
  }

  const known = new Set<string>(CATEGORY_ORDER);
  const orderedCategories: string[] = [
    ...CATEGORY_ORDER.filter((c) => grouped.has(c)),
    ...[...grouped.keys()].filter((c) => !known.has(c)),
  ];

  return (
    <div className="space-y-12">
      {orderedCategories.map((cat) => {
        const items = grouped.get(cat) ?? [];
        const label = CATEGORY_LABELS[cat] ?? cat;
        return (
          <section key={cat}>
            <header className="mb-6">
              <h2 className="text-slate-100 font-semibold text-sm uppercase tracking-wider">
                {label}
              </h2>
              <p className="text-slate-500 text-xs mt-1">
                {items.length} {items.length === 1 ? "item" : "items"}
              </p>
            </header>
            <div className="space-y-6">
              {items.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
