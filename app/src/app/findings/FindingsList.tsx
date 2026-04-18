"use client";

import { useState } from "react";
import { FindingCard } from "@/components/FindingCard";
import type { Finding } from "@/lib/api";
import Link from "next/link";

interface Props {
  findings: Finding[];
  hasFilters: boolean;
}

const PILL_ACTIVE: React.CSSProperties = {
  background: "rgba(0,196,180,0.15)", color: "#00c4b4",
  border: "1px solid rgba(0,196,180,0.4)",
};
const PILL_INACTIVE: React.CSSProperties = {
  background: "transparent", color: "#94a3b8", border: "1px solid #1e293b",
};

export function FindingsList({ findings, hasFilters }: Props) {
  const [hasActionsOnly, setHasActionsOnly] = useState(false);

  const visible = hasActionsOnly
    ? findings.filter((f) => f.action_count > 0)
    : findings;

  const grouped: Record<string, Finding[]> = {};
  for (const f of visible) {
    const d = f.domain ?? "General";
    (grouped[d] ??= []).push(f);
  }

  return (
    <>
      {/* Has Actions filter pill */}
      <div className="mb-4">
        <button
          onClick={() => setHasActionsOnly((v) => !v)}
          className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-colors"
          style={hasActionsOnly ? PILL_ACTIVE : PILL_INACTIVE}
        >
          Has Actions
          {hasActionsOnly && (
            <span className="ml-1.5 opacity-70">✕</span>
          )}
        </button>
      </div>

      {visible.length === 0 ? (
        <div
          className="rounded-xl border p-10 text-center"
          style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
        >
          <p className="text-sm mb-3" style={{ color: "#94a3b8" }}>
            No findings match your current filters.
          </p>
          {(hasFilters || hasActionsOnly) && (
            <div className="flex items-center justify-center gap-3">
              {hasActionsOnly && (
                <button
                  onClick={() => setHasActionsOnly(false)}
                  className="text-xs font-medium"
                  style={{ color: "#00c4b4" }}
                >
                  Clear action filter
                </button>
              )}
              {hasFilters && (
                <Link href="/findings" className="text-xs font-medium" style={{ color: "#00c4b4" }}>
                  Clear all filters
                </Link>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {Object.entries(grouped).map(([domain, domainFindings]) => (
            <div key={domain}>
              <div
                className="flex items-center gap-2 mb-3 pb-2"
                style={{ borderBottom: "1px solid #1e293b" }}
              >
                <span
                  className="text-xs font-semibold uppercase tracking-wide"
                  style={{ color: "#64748b" }}
                >
                  {domain}
                </span>
                <span
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{ background: "rgba(148,163,184,0.1)", color: "#64748b" }}
                >
                  {domainFindings.length}
                </span>
              </div>
              <div className="space-y-3">
                {domainFindings.map((f) => (
                  <FindingCard key={f.id} finding={f} revalidateUrl="/findings" />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
