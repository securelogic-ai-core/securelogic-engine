import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getEnterpriseContextStats } from "@/lib/api";
import { APPLICABILITY_DECISIONS } from "@/lib/enterpriseContext";
import { decisionLabel, entityTypeLabel, readFailure } from "@/lib/enterpriseContextFormat";
import { assetTypeLabel } from "@/lib/assetRegistry";
import { CriticalityBadge, DecisionBadge, ReadFailurePanel } from "../shared";

/**
 * Executive dashboard (goal Item 7 named deliverable): leadership rollup of the
 * enterprise context + applicability posture, built on the FIRST-CLASS engine
 * stats endpoint (/api/enterprise-context/stats) — never ad-hoc aggregation over
 * the page-capped list APIs. Stat tiles only (counts, no plots), reusing the
 * app's established badge palette so decision/criticality colors stay consistent
 * with every other ECL screen; labels always accompany color.
 */
export default async function EnterpriseContextDashboardPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const result = await getEnterpriseContextStats(token);

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
            Context Dashboard
          </h1>
          <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
            Executive view: what your environment contains, which signals apply to
            it, and what the platform is asking you to act on.
          </p>
        </div>
        <Link
          href="/enterprise-context"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors hover:opacity-80 flex-shrink-0"
          style={{ borderColor: "#1e293b", color: "#94a3b8" }}
        >
          ← Context
        </Link>
      </div>

      {!result.ok ? (
        <ReadFailurePanel {...readFailure(result)} />
      ) : (
        (() => {
          const s = result.stats;
          return (
            <>
              {/* Headline row — the four numbers leadership asks for first. */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
                <HeroTile
                  label="Context entities"
                  value={s.entities.total}
                  sub={`${s.relationships.total} relationship${s.relationships.total === 1 ? "" : "s"}`}
                  href="/enterprise-context"
                />
                <HeroTile
                  label="Signals affecting you"
                  value={s.applicability.by_decision.affected}
                  sub={`${s.applicability.affected_high_confidence} high confidence`}
                  href="/enterprise-context/applicability?decision=affected"
                  emphasis={s.applicability.by_decision.affected > 0}
                />
                <HeroTile
                  label="Entities in blast radius"
                  value={s.applicability.blast_radius_nodes}
                  sub={`across ${s.applicability.current_total} current decision${s.applicability.current_total === 1 ? "" : "s"}`}
                  href="/enterprise-context/applicability"
                />
                <HeroTile
                  label="Awaiting review"
                  value={
                    s.workflow.pending_suggestions +
                    s.workflow.open_findings +
                    s.workflow.open_actions
                  }
                  sub={`${s.workflow.pending_suggestions} suggestions · ${s.workflow.open_findings} findings · ${s.workflow.open_actions} actions`}
                  href="/enterprise-context/applicability"
                />
              </div>

              {/* Current decisions by type. */}
              <section className="mb-8">
                <h2 className="text-sm font-semibold mb-3" style={{ color: "#f1f5f9" }}>
                  Current applicability decisions
                </h2>
                {s.applicability.current_total === 0 ? (
                  <div className="bg-brand-surface border border-brand-line rounded-xl p-6 text-center">
                    <p className="text-sm" style={{ color: "#94a3b8" }}>
                      No decisions yet. They appear as signals are matched against your context.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    {APPLICABILITY_DECISIONS.map((d) => (
                      <Link
                        key={d}
                        href={`/enterprise-context/applicability?decision=${d}`}
                        className="bg-brand-surface border border-brand-line rounded-xl p-4 block hover:border-slate-500 transition-colors"
                      >
                        <div className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
                          {s.applicability.by_decision[d] ?? 0}
                        </div>
                        <div className="mt-1.5">
                          <DecisionBadge value={d} />
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </section>

              {/* Inventory rollups. */}
              <div className="grid md:grid-cols-2 gap-6">
                <section>
                  <h2 className="text-sm font-semibold mb-3" style={{ color: "#f1f5f9" }}>
                    Entities by criticality
                  </h2>
                  <div className="bg-brand-surface border border-brand-line rounded-xl p-5 space-y-2.5">
                    {(["critical", "high", "medium", "low"] as const).map((c) => (
                      <div key={c} className="flex items-center justify-between text-sm">
                        <CriticalityBadge value={c} />
                        <span className="font-semibold" style={{ color: "#f1f5f9" }}>
                          {s.entities.by_criticality[c] ?? 0}
                        </span>
                      </div>
                    ))}
                    <div
                      className="flex items-center justify-between text-xs pt-2"
                      style={{ borderTop: "1px solid #1e293b", color: "#64748b" }}
                    >
                      <span>Unrated</span>
                      <span>
                        {s.entities.total -
                          (["critical", "high", "medium", "low"] as const).reduce(
                            (n, c) => n + (s.entities.by_criticality[c] ?? 0),
                            0,
                          )}
                      </span>
                    </div>
                  </div>
                </section>

                <section>
                  <h2 className="text-sm font-semibold mb-3" style={{ color: "#f1f5f9" }}>
                    Entities by type
                  </h2>
                  <div className="bg-brand-surface border border-brand-line rounded-xl p-5 space-y-2.5">
                    {Object.entries(s.entities.by_type)
                      .sort(([, a], [, b]) => b - a)
                      .map(([t, n]) => (
                        <div key={t} className="flex items-center justify-between text-sm">
                          <span style={{ color: "#cbd5e1" }}>{entityTypeLabel(t)}</span>
                          <span className="font-semibold" style={{ color: "#f1f5f9" }}>
                            {n}
                          </span>
                        </div>
                      ))}
                    {Object.keys(s.entities.by_type).length === 0 && (
                      <p className="text-sm" style={{ color: "#94a3b8" }}>
                        No entities registered yet.
                      </p>
                    )}
                  </div>
                </section>
              </div>

              {/* EAR Phase 5: registry-wide asset totals (all asset types).
                  s.assets is only present while the engine's registry flag is
                  on, so this section is dark with zero UI change otherwise. */}
              {s.assets && (
                <section className="mt-8">
                  <h2 className="text-sm font-semibold mb-3" style={{ color: "#f1f5f9" }}>
                    Assets by type
                  </h2>
                  <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
                    <div className="flex items-baseline justify-between mb-3">
                      <span className="text-xs" style={{ color: "#94a3b8" }}>
                        Across the full asset registry
                      </span>
                      <Link href="/assets" className="text-xs underline hover:opacity-80" style={{ color: "#94a3b8" }}>
                        View all {s.assets.total} asset{s.assets.total === 1 ? "" : "s"} →
                      </Link>
                    </div>
                    <div className="space-y-2.5">
                      {Object.entries(s.assets.by_type)
                        .sort(([, a], [, b]) => b - a)
                        .map(([t, n]) => (
                          <div key={t} className="flex items-center justify-between text-sm">
                            <span style={{ color: "#cbd5e1" }}>{assetTypeLabel(t)}</span>
                            <span className="font-semibold" style={{ color: "#f1f5f9" }}>
                              {n}
                            </span>
                          </div>
                        ))}
                      {Object.keys(s.assets.by_type).length === 0 && (
                        <p className="text-sm" style={{ color: "#94a3b8" }}>
                          No assets registered yet.
                        </p>
                      )}
                    </div>
                  </div>
                </section>
              )}

              <p className="mt-8 text-xs" style={{ color: "#475569" }}>
                {decisionLabel("affected")} = the platform concluded a signal applies to your
                environment, with the reasoning and evidence recorded immutably. Totals cover
                current decisions only ({s.applicability.total_assessments} decision record
                {s.applicability.total_assessments === 1 ? "" : "s"} retained for audit).
              </p>
            </>
          );
        })()
      )}
    </div>
  );
}

function HeroTile({
  label,
  value,
  sub,
  href,
  emphasis = false,
}: {
  label: string;
  value: number;
  sub: string;
  href: string;
  emphasis?: boolean;
}) {
  return (
    <Link
      href={href}
      className="bg-brand-surface border rounded-xl p-5 block hover:border-slate-500 transition-colors"
      style={{ borderColor: emphasis ? "rgba(239,68,68,0.4)" : "#1e293b" }}
    >
      <div className="text-xs font-medium" style={{ color: "#94a3b8" }}>
        {label}
      </div>
      <div className="text-3xl font-bold mt-1" style={{ color: emphasis ? "#fca5a5" : "#f1f5f9" }}>
        {value}
      </div>
      <div className="text-xs mt-1" style={{ color: "#64748b" }}>
        {sub}
      </div>
    </Link>
  );
}
