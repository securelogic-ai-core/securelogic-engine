"use client";

import { useState } from "react";
import Link from "next/link";
import type { BriefSignal } from "@/lib/api";

function riskColor(level: string) {
  const l = (level ?? "").toLowerCase();
  if (l === "critical") return "border-l-red-500";
  if (l === "high") return "border-l-orange-400";
  if (l === "medium") return "border-l-yellow-400";
  return "border-l-green-400";
}

function riskPillClass(level: string) {
  const l = (level ?? "").toLowerCase();
  if (l === "critical") return "bg-red-100 text-red-700 border border-red-200";
  if (l === "high") return "bg-orange-100 text-orange-700 border border-orange-200";
  if (l === "medium") return "bg-yellow-100 text-yellow-700 border border-yellow-200";
  return "bg-green-100 text-green-700 border border-green-200";
}

const DOMAIN_CATEGORY_LABELS: Record<string, string> = {
  AI_GOVERNANCE: "AI Governance",
  SECURITY_INCIDENT: "Security",
  REGULATION: "Regulatory",
  VENDOR_RISK: "Vendor Risk",
  COMPLIANCE: "Compliance",
  COMPLIANCE_UPDATE: "Compliance",
  GENERAL: "General",
};

function SignalCard({ signal, href }: { signal: BriefSignal; href?: string }) {
  const risk = signal.riskLevel ?? signal.risk_level ?? "low";
  // Prefer riskRationale (most direct), then whyItMatters, then analysis/summary
  const context = signal.riskRationale || signal.whyItMatters || signal.analysis || signal.summary || "";
  const action = signal.recommendedAction || signal.recommendation || "";
  const sourceHref = signal.sourceUrl ?? signal.source_url;
  const categoryText = signal.category ? (DOMAIN_CATEGORY_LABELS[signal.category] ?? null) : null;
  const tier = signal.priorityTier;

  return (
    <div className={`border border-slate-200 border-l-4 ${riskColor(risk)} rounded-lg p-5 bg-white shadow-sm`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <h4 className="text-slate-900 font-semibold text-sm leading-snug flex-1">
          {href ? (
            <Link href={href} className="hover:text-teal-700 transition-colors">
              {signal.title}
            </Link>
          ) : signal.title}
        </h4>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide flex-shrink-0 ${riskPillClass(risk)}`}>
          {risk}
        </span>
      </div>

      {(categoryText || tier) && (
        <div className="flex items-center gap-2 mb-2.5">
          {categoryText && (
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{categoryText}</span>
          )}
          {categoryText && tier && <span className="text-slate-300 select-none">·</span>}
          {tier && (
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{tier}</span>
          )}
        </div>
      )}

      {context && (
        <p className="text-sm text-slate-600 leading-relaxed mb-3 line-clamp-2">{context}</p>
      )}

      {action && (
        <p className="text-sm text-slate-700 leading-snug">
          <span className="font-semibold text-slate-800">Action: </span>
          {action}
        </p>
      )}

      {(sourceHref || signal.source || href) ? (
        <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            {sourceHref ? (
              <a
                href={sourceHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-teal-600 hover:text-teal-700 transition-colors"
              >
                Read source{signal.source ? ` — ${signal.source}` : ""} →
              </a>
            ) : signal.source ? (
              <p className="text-xs text-slate-400 font-medium">Source: {signal.source}</p>
            ) : null}
          </div>
          {href && (
            <Link
              href={href}
              className="text-xs font-semibold text-slate-400 hover:text-teal-600 transition-colors flex-shrink-0"
            >
              Full analysis →
            </Link>
          )}
        </div>
      ) : null}
    </div>
  );
}

const DEFAULT_LIMIT = 2;

export function CollapsibleSignalList({
  signals,
  issueId,
  sectionKey,
  signalIndices,
}: {
  signals: BriefSignal[];
  issueId?: string;
  sectionKey?: string;
  signalIndices?: number[];
}) {
  const [expanded, setExpanded] = useState(false);

  if (!signals.length) return null;

  const hiddenCount = Math.max(0, signals.length - DEFAULT_LIMIT);
  const visibleSignals = expanded ? signals : signals.slice(0, DEFAULT_LIMIT);

  const getHref = (i: number) =>
    issueId && sectionKey && signalIndices
      ? `/briefs/${issueId}/signal/${sectionKey}/${signalIndices[i]}`
      : undefined;

  return (
    <div>
      <div className="space-y-3">
        {visibleSignals.map((signal, i) => (
          <SignalCard
            key={signal.id ?? signal.signalId ?? `${signal.title}-${i}`}
            signal={signal}
            href={getHref(i)}
          />
        ))}

        {!expanded &&
          signals.slice(DEFAULT_LIMIT).map((signal, i) => (
            <div
              key={signal.id ?? signal.signalId ?? `hidden-${signal.title}-${i}`}
              className="hidden print:!block"
            >
              <SignalCard signal={signal} href={getHref(DEFAULT_LIMIT + i)} />
            </div>
          ))}
      </div>

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="print:hidden mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-teal-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg transition-colors"
        >
          {expanded ? "Collapse ↑" : `See ${hiddenCount} more ${hiddenCount !== 1 ? "signals" : "signal"} ↓`}
        </button>
      )}
    </div>
  );
}
