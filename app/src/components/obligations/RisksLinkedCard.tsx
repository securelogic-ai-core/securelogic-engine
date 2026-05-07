"use client";

/**
 * RisksLinkedCard (RR-6) — read-only sidebar card on the obligation detail
 * page. Lists the risks that affect this obligation. The add/remove
 * affordance lives on the risk side (LinkedObligationsSection) — risk
 * owners decide which obligations their risks affect; this view is the
 * inverse readout.
 *
 * Mechanical mirror of RisksMitigatedCard.tsx (RR-4) — identical card
 * chrome and per-row layout. Only the data source and header text change.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getRisksForObligation,
  type ObligationRiskLink,
} from "@/lib/api";

const RATING_DOT_COLORS: Record<string, string> = {
  Critical: "#ef4444",
  High:     "#f97316",
  Moderate: "#f59e0b",
  Low:      "#22c55e",
};

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  open:        { background: "rgba(239,68,68,0.12)",  color: "#fca5a5" },
  accepted:    { background: "rgba(245,158,11,0.12)", color: "#fcd34d" },
  mitigated:   { background: "rgba(34,197,94,0.12)",  color: "#86efac" },
  closed:      { background: "rgba(148,163,184,0.12)", color: "#94a3b8" },
  transferred: { background: "rgba(148,163,184,0.12)", color: "#94a3b8" },
};

function RatingDot({ rating }: { rating: string | null }) {
  const color = rating ? (RATING_DOT_COLORS[rating] ?? "#475569") : "#475569";
  return (
    <span
      className="inline-block rounded-full flex-shrink-0"
      style={{ width: 7, height: 7, background: color, marginTop: 5 }}
      title={rating ?? "no rating"}
    />
  );
}

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? { background: "rgba(148,163,184,0.12)", color: "#94a3b8" };
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium"
      style={style}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function RisksLinkedCard({ obligationId }: { obligationId: string }) {
  const [links, setLinks]     = useState<ObligationRiskLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getRisksForObligation(obligationId)
      .then((res) => {
        if (cancelled) return;
        if (!res) {
          setError("Could not load linked risks");
          return;
        }
        setLinks(res.links);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [obligationId]);

  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
          Risks Linked
        </h3>
        {!loading && (
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold"
            style={{ background: "rgba(148,163,184,0.12)", color: "#475569" }}
          >
            {links.length}
          </span>
        )}
      </div>

      {/* Body */}
      {loading ? (
        <p className="text-xs" style={{ color: "#475569" }}>Loading…</p>
      ) : error ? (
        <p className="text-xs" style={{ color: "#fca5a5" }}>{error}</p>
      ) : links.length === 0 ? (
        <p className="text-xs mb-3" style={{ color: "#475569" }}>
          No risks linked to this obligation.
        </p>
      ) : (
        <div className="space-y-2 mb-3">
          {links.map((link) => (
            <div key={link.link_id} className="flex items-start gap-2">
              <RatingDot rating={link.risk_residual_rating} />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/risks/${link.risk_id}`}
                  className="text-xs font-medium leading-snug line-clamp-2"
                  style={{ color: "#cbd5e1", textDecoration: "none" }}
                  title={link.risk_title}
                >
                  {link.risk_title}
                </Link>
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  <StatusBadge status={link.risk_status} />
                  {link.risk_domain && (
                    <span
                      className="text-xs"
                      style={{ color: "#475569" }}
                    >
                      {link.risk_domain}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer link */}
      {!loading && !error && (
        <div className="mt-3 pt-3" style={{ borderTop: "1px solid #1e2d45" }}>
          <Link
            href="/risks"
            className="text-xs font-medium hover:underline"
            style={{ color: "#00c4b4" }}
          >
            View Risks →
          </Link>
        </div>
      )}
    </div>
  );
}
