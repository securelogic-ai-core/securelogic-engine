/**
 * FindingsSummaryBar.tsx — the compact executive summary bar shared by BOTH
 * findings surfaces: the Operations Center landing view (WorkFirstFindings) and
 * the scalable BROWSE queue (page.tsx, /findings?queue=all).
 *
 * It was previously a private component inside WorkFirstFindings, which meant the
 * BROWSE queue — once the scalable queue controls shipped — rendered the toolbar
 * with NO page-level operational overview above it. Extracting it to one place
 * keeps the two surfaces IDENTICAL in calculation and terminology: both render the
 * same `globalSummary(summary)` items (Active Findings, Overdue / SLA, Awaiting
 * Approval, Ready to Close, Accepted Risk), computed from the tenant-wide findings
 * summary — never from a filtered result set.
 *
 * Presentational only; the metrics come from workQueues.globalSummary().
 */

import Link from "next/link";
import { QUEUE_OVERLAP_NOTE } from "@/lib/findingLifecycleVocab";
import type { SummaryItem } from "./workQueues";

const SUMMARY_TONE: Record<string, string> = {
  urgent: "#fca5a5",
  attention: "#fcd34d",
  governance: "#c4b5fd",
  neutral: "#f1f5f9",
};

export function FindingsSummaryBar({
  items,
  generatedAt,
}: {
  items: SummaryItem[];
  generatedAt?: string;
}) {
  return (
    <section className="mb-6" aria-label="Findings summary">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {items.map((item) => {
          const known = item.value !== null;
          const color = known && item.value! > 0 ? SUMMARY_TONE[item.tone] ?? "#f1f5f9" : "#334155";
          return (
            <Link
              key={item.key}
              href={item.href}
              className="block rounded-xl border p-4 transition-colors"
              style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: "#64748b" }}>
                {item.label}
              </div>
              <div className="text-2xl font-bold leading-none mb-1" style={{ color }}>
                {known ? item.value : "—"}
              </div>
              <div className="text-[11px]" style={{ color: "#475569" }}>
                {item.hint}
              </div>
            </Link>
          );
        })}
      </div>
      {/* F-2 (overlap) + F-8 (freshness) */}
      <p className="mt-2 text-[11px]" style={{ color: "#475569" }}>
        {QUEUE_OVERLAP_NOTE}
        {generatedAt && <> · Counts as of {generatedAt}.</>}
      </p>
    </section>
  );
}
