import type {
  IntelligenceBriefDetailResponse,
  IntelligenceBriefItem,
  IntelligenceBriefUrgency,
} from "@/lib/api";
import { IntelligenceBriefSignalCard } from "./IntelligenceBriefSignalCard";

interface IntelligenceBriefSignalGroupProps {
  brief: IntelligenceBriefDetailResponse;
}

/**
 * Display order of urgency groups. Null (unclassified) is last so legacy
 * briefs without urgency classification render at the bottom rather than
 * mixing in.
 */
const GROUP_ORDER: ReadonlyArray<IntelligenceBriefUrgency | null> = [
  "immediate",
  "near_term",
  "far_term",
  null,
];

const GROUP_LABEL: Record<string, string> = {
  immediate: "IMMEDIATE",
  near_term: "NEAR TERM",
  far_term: "FAR TERM",
  null: "UNCLASSIFIED",
};

function urgencyKey(urgency: IntelligenceBriefUrgency | null): string {
  return urgency === null ? "null" : urgency;
}

/**
 * Build a map of urgency → [{item, originalIndex}] preserving the original
 * brief.items[] index. The detail page route uses that index to resolve
 * the item, so the index must travel through the grouping unchanged.
 */
function groupByUrgency(
  items: ReadonlyArray<IntelligenceBriefItem>
): Map<string, Array<{ item: IntelligenceBriefItem; originalIndex: number }>> {
  const groups = new Map<string, Array<{ item: IntelligenceBriefItem; originalIndex: number }>>();
  items.forEach((item, originalIndex) => {
    const key = urgencyKey(item.urgency ?? null);
    const list = groups.get(key) ?? [];
    list.push({ item, originalIndex });
    groups.set(key, list);
  });
  return groups;
}

export function IntelligenceBriefSignalGroup({
  brief,
}: IntelligenceBriefSignalGroupProps) {
  if (brief.items.length === 0) {
    return (
      <p className="text-slate-500 text-sm italic py-6">
        No signals in this brief.
      </p>
    );
  }

  const groups = groupByUrgency(brief.items);

  return (
    <div className="space-y-12">
      {GROUP_ORDER.map((urgency) => {
        const key = urgencyKey(urgency);
        const entries = groups.get(key);
        if (!entries || entries.length === 0) return null;

        const label = GROUP_LABEL[key] ?? key.toUpperCase();
        return (
          <section key={key}>
            <header className="mb-5 flex items-baseline gap-3">
              <h2 className="text-sm font-bold text-slate-100 uppercase tracking-widest">
                {label}
              </h2>
              <span className="text-xs text-slate-500 font-medium">
                · {entries.length}
              </span>
            </header>
            <div className="space-y-5">
              {entries.map(({ item, originalIndex }) => (
                <IntelligenceBriefSignalCard
                  key={item.id}
                  briefId={brief.id}
                  item={item}
                  index={originalIndex}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
