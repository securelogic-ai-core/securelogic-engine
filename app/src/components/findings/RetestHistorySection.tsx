import Link from "next/link";
import type { PenTestRetest } from "@/lib/api";
import {
  RETEST_RESULT_LABELS,
  RETEST_RESULT_STYLES,
} from "@/app/pen-tests/lifecycle";

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

/**
 * RetestHistorySection (T2-I) — the verification history of ONE pen-test
 * finding, newest first, exactly as the engine returns it. Rendered ONLY for
 * source_type='pen_test' findings (the page owns that decision — for every
 * other source the section is ABSENT, because "no retests" is not a fact
 * about a control-test finding).
 *
 * Three honest states, never collapsed:
 *  - rows: the retest acts, newest first, each naming the engagement that
 *    performed it (legitimately a LATER engagement than the one that found it)
 *  - empty (retests non-null, zero rows): "never retested" — a real fact
 *  - null: the fetch failed — an outage, never rendered as "never retested"
 *
 * The newest row is the current verification state — and a 'remediated'
 * retest NEVER closes the finding; the closure gate is the only closure path.
 */
export function RetestHistorySection({
  retests,
}: {
  retests: { count: number; retests: PenTestRetest[] } | null;
}) {
  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#94a3b8" }}>
        Retest History
        {retests !== null && retests.count > 0 && (
          <span className="ml-2 font-normal normal-case" style={{ color: "#64748b" }}>
            {retests.count} retest{retests.count !== 1 ? "s" : ""}
          </span>
        )}
      </h3>

      {retests === null && (
        <p className="text-sm" style={{ color: "#94a3b8" }}>
          Retest history couldn&rsquo;t be loaded right now — an outage, not an
          empty history. Reload to try again.
        </p>
      )}

      {retests !== null && retests.retests.length === 0 && (
        <p className="text-sm" style={{ color: "#64748b" }}>
          Never retested. Record a retest from the engagement that verified the
          fix — its detail page has the control on each finding.
        </p>
      )}

      {retests !== null && retests.retests.length > 0 && (
        <div className="space-y-3">
          {retests.retests.map((r) => {
            const style = RETEST_RESULT_STYLES[r.result] ?? {
              background: "rgba(148,163,184,0.15)",
              color: "#94a3b8",
            };
            return (
              <div
                key={r.id}
                className="rounded-lg p-3"
                style={{ background: "rgba(15,23,42,0.6)", border: "1px solid #1e2d45" }}
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
                      style={style}
                    >
                      {RETEST_RESULT_LABELS[r.result] ?? r.result}
                    </span>
                    {/* The engagement that DID the retest — legitimately a later
                        test than the one that produced the finding. */}
                    <Link
                      href={`/pen-tests/${r.engagement_id}`}
                      className="text-xs font-medium transition-opacity hover:opacity-80"
                      style={{ color: "#93c5fd" }}
                    >
                      {r.engagement_name}
                    </Link>
                  </div>
                  <span className="text-xs" style={{ color: "#475569" }}>
                    {fmtDate(r.performed_on)}
                  </span>
                </div>
                {r.notes && (
                  <p
                    className="text-sm mt-2 leading-relaxed"
                    style={{ color: "#cbd5e1", whiteSpace: "pre-wrap" }}
                  >
                    {r.notes}
                  </p>
                )}
              </div>
            );
          })}
          <p className="text-xs" style={{ color: "#64748b" }}>
            A retest verifies; it never closes. Closure stays with the
            finding&rsquo;s own closure gate.
          </p>
        </div>
      )}
    </div>
  );
}
