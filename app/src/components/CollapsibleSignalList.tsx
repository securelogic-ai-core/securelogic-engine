"use client";

import { useState } from "react";
import Link from "next/link";
import type { BriefSignal } from "@/lib/api";

// ---------------------------------------------------------------------------
// Helpers — local copies so this client component has no dependency on the
// server-only page file.
// ---------------------------------------------------------------------------

function riskBorderClass(level: string): string {
  const l = (level ?? "").toLowerCase();
  if (l === "critical") return "border-l-red-500";
  if (l === "high")     return "border-l-orange-400";
  if (l === "medium")   return "border-l-yellow-400";
  return "border-l-green-400";
}

function riskPillClass(level: string): string {
  const l = (level ?? "").toLowerCase();
  if (l === "critical") return "bg-red-100 text-red-700 border border-red-200";
  if (l === "high")     return "bg-orange-100 text-orange-700 border border-orange-200";
  if (l === "medium")   return "bg-yellow-100 text-yellow-700 border border-yellow-200";
  return "bg-green-100 text-green-700 border border-green-200";
}

// ---------------------------------------------------------------------------
// SignalCard — compact card for domain intelligence signals
// Title links to the signal detail page when href is provided.
// ---------------------------------------------------------------------------

function SignalCard({ signal, href }: { signal: BriefSignal; href?: string }) {
  const risk = signal.riskLevel ?? signal.risk_level ?? "low";
  const analysis = signal.whyItMatters || signal.analysis || signal.summary || "";
  const action = signal.recommendedAction || signal.recommendation || "";
  const sourceHref = signal.sourceUrl ?? signal.source_url;

  const title = href ? (
    <Link
      href={href}
      className="hover:text-teal-700 transition-colors"
    >
      {signal.title}
    </Link>
  ) : signal.title;

  return (
    <div className={`border border-slate-200 border-l-4 ${riskBorderClass(risk)} rounded-lg p-5 bg-white`}>
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <h4 className="text-slate-900 font-semibold text-sm leading-snug flex-1">
          {title}
        </h4>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide flex-shrink-0 ${riskPillClass(risk)}`}>
          {risk}
        </span>
      </div>

      {analysis && (
        <p className="text-sm text-slate-600 leading-relaxed mb-3">{analysis}</p>
      )}

      {action && (
        <p className="text-sm text-slate-700 leading-snug">
          <span className="font-semibold text-slate-800">Action: </span>
          {action}
        </p>
      )}

      {sourceHref ? (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <a
            href={sourceHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-semibold text-teal-600 hover:text-teal-700 transition-colors"
          >
            Read source{signal.source ? ` — ${signal.source}` : ""} →
          </a>
        </div>
      ) : signal.source ? (
        <p className="mt-3 text-xs text-slate-400 font-medium">Via {signal.source}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CollapsibleSignalList — client island for expand/collapse behavior.
//
// All signals are always rendered in the DOM. Signals beyond `initialLimit`
// are hidden via CSS (Tailwind `hidden`) when collapsed so that @media print
// can reveal them with `print:!block` without JS involvement.
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 2;

export function CollapsibleSignalList({
  signals,
  signalHrefs,
  initialLimit = DEFAULT_LIMIT,
}: {
  signals: BriefSignal[];
  /** Parallel array of hrefs for signal title links. undefined = no link. */
  signalHrefs?: (string | undefined)[];
  initialLimit?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  if (signals.length === 0) return null;

  const canToggle = signals.length > initialLimit;
  const hiddenCount = signals.length - initialLimit;

  return (
    <div>
      <div className="space-y-3">
        {signals.map((signal, i) => {
          const isHidden = !expanded && canToggle && i >= initialLimit;
          return (
            <div
              key={signal.id ?? signal.signalId ?? i}
              className={isHidden ? "hidden print:!block" : undefined}
            >
              <SignalCard
                signal={signal}
                href={signalHrefs?.[i]}
              />
            </div>
          );
        })}
      </div>

      {canToggle && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="print:hidden mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-teal-600 transition-colors"
        >
          {expanded
            ? "Show less ↑"
            : `Show ${hiddenCount} more signal${hiddenCount !== 1 ? "s" : ""} ↓`}
        </button>
      )}
    </div>
  );
}
