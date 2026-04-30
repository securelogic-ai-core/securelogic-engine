import type { IntelligenceBriefDetailResponse } from "@/lib/api";

interface IntelligenceBriefHeroProps {
  brief: IntelligenceBriefDetailResponse;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function ActionList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-2">
        {label}
      </p>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li
            key={i}
            className="text-slate-300 text-sm leading-relaxed pl-4 -indent-4 before:content-['—'] before:text-slate-600 before:mr-2"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function IntelligenceBriefHero({ brief }: IntelligenceBriefHeroProps) {
  const synthesis = brief.content_json?.synthesis ?? null;
  const date = formatDate(brief.period_end);

  if (!synthesis) {
    return (
      <div className="bg-brand-surface border border-brand-line rounded-xl p-6">
        <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">
          Intelligence Brief · {date}
        </p>
        <p className="text-slate-400 text-sm mt-3">
          Brief published — synthesis pending.
        </p>
      </div>
    );
  }

  const {
    thesis,
    executive_summary,
    cross_domain_analysis,
    action_summary,
  } = synthesis;

  const hasAnyActions =
    action_summary !== null &&
    (action_summary.this_week.length > 0 ||
      action_summary.this_month.length > 0 ||
      action_summary.monitor.length > 0);

  return (
    <article className="bg-brand-surface border border-brand-line rounded-xl p-6 sm:p-8">
      {/* Eyebrow */}
      <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide">
        Intelligence Brief · {date}
      </p>

      {/* Thesis */}
      {thesis && (
        <h2 className="mt-3 text-slate-100 font-bold text-xl sm:text-2xl leading-tight max-w-prose">
          {thesis}
        </h2>
      )}

      {/* Executive summary */}
      {executive_summary && (
        <p className="mt-5 text-slate-300 text-base leading-relaxed max-w-prose">
          {executive_summary}
        </p>
      )}

      {/* Cross-domain analysis */}
      {cross_domain_analysis && (
        <section className="mt-8 pt-6 border-t border-brand-line max-w-prose">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-3">
            Pattern across signals
          </p>
          {cross_domain_analysis.split(/\n\n+/).map((para, i) => (
            <p
              key={i}
              className={`text-slate-300 text-sm leading-relaxed ${i > 0 ? "mt-3" : ""}`}
            >
              {para}
            </p>
          ))}
        </section>
      )}

      {/* Action summary */}
      {hasAnyActions && action_summary && (
        <section className="mt-8 pt-6 border-t border-brand-line">
          <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-4">
            Action summary
          </p>
          <div className="space-y-6">
            <ActionList label="This week" items={action_summary.this_week} />
            <ActionList label="This month" items={action_summary.this_month} />
            <ActionList label="Watching" items={action_summary.monitor} />
          </div>
        </section>
      )}
    </article>
  );
}
