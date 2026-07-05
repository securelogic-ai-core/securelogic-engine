import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getApplicabilityAssessment } from "@/lib/api";
import {
  decisionLabel,
  matchTargetLabel,
  nodeTypeLabel,
  readFailure,
  shortHash,
} from "@/lib/enterpriseContextFormat";
import { DecisionBadge, MetaChip, ReadFailurePanel } from "../../shared";

/**
 * Applicability view (goal Item 7 named deliverable): the persisted decision +
 * its ordered reasoning chain + business framing + blast radius, rendered from
 * the stored WORM record via the S5 explainability layer — no engine re-run.
 * The evidence detail (used/missing + reproducibility) is the sibling
 * evidence view at ./evidence.
 */
export default async function ApplicabilityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const { id } = await params;
  const result = await getApplicabilityAssessment(token, id);

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="mb-6">
        <Link
          href="/enterprise-context/applicability"
          className="text-xs hover:opacity-80"
          style={{ color: "#64748b" }}
        >
          ← Applicability Decisions
        </Link>
      </div>

      {!result.ok ? (
        <ReadFailurePanel {...readFailure(result)} />
      ) : (
        (() => {
          const a = result.applicability_assessment;
          const x = result.explanation;
          return (
            <>
              <div className="mb-8 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <DecisionBadge value={a.decision} />
                    <h1 className="text-xl font-bold" style={{ color: "#f1f5f9" }}>
                      {matchTargetLabel(a.target_type)} — {decisionLabel(a.decision)}
                    </h1>
                  </div>
                  <p className="text-sm mt-2" style={{ color: "#cbd5e1" }}>
                    {x.headline}
                  </p>
                  <p className="text-xs mt-1" style={{ color: "#94a3b8" }}>
                    {x.decision_statement}
                  </p>
                </div>
                <Link
                  href={`/enterprise-context/applicability/${a.id}/evidence`}
                  className="inline-flex items-center px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors hover:opacity-80 flex-shrink-0"
                  style={{ borderColor: "#1e293b", color: "#94a3b8" }}
                >
                  Evidence & Reproducibility →
                </Link>
              </div>

              <div className="mb-6 flex flex-wrap gap-3">
                <MetaChip label="Confidence" value={`${a.confidence}% (${a.confidence_band})`} />
                <MetaChip label="Target" value={`${matchTargetLabel(a.target_type)} ${shortHash(a.target_id)}`} />
                <MetaChip label="Signal" value={shortHash(a.signal_id)} />
                <MetaChip label="Decided" value={new Date(a.created_at).toLocaleString()} />
                <MetaChip label="Engine" value={`${a.engine_version} / ${a.schema_version}`} />
              </div>

              {/* Reasoning chain — the ordered deterministic rule trace. */}
              <section className="mb-8">
                <h2 className="text-sm font-semibold mb-3" style={{ color: "#f1f5f9" }}>
                  Reasoning chain
                </h2>
                <ol className="space-y-2">
                  {x.reasoning_chain.map((line, i) => (
                    <li
                      key={i}
                      className="bg-brand-surface border border-brand-line rounded-lg px-4 py-3 text-sm flex gap-3"
                      style={{ color: "#cbd5e1" }}
                    >
                      <span className="font-mono text-xs flex-shrink-0 mt-0.5" style={{ color: "#64748b" }}>
                        {i + 1}.
                      </span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ol>
              </section>

              {/* Blast radius grouped by node type. */}
              <section className="mb-8">
                <h2 className="text-sm font-semibold mb-3" style={{ color: "#f1f5f9" }}>
                  Blast radius{" "}
                  <span className="font-normal" style={{ color: "#64748b" }}>
                    ({x.affected_count} affected {x.affected_count === 1 ? "entity" : "entities"})
                  </span>
                </h2>
                {x.blast_radius.length === 0 ? (
                  <p className="text-sm" style={{ color: "#94a3b8" }}>
                    No reachable downstream entities for this decision.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {x.blast_radius.map((g) => (
                      <div
                        key={g.node_type}
                        className="bg-brand-surface border border-brand-line rounded-lg px-4 py-3"
                      >
                        <div className="text-lg font-bold" style={{ color: "#f1f5f9" }}>
                          {g.count}
                        </div>
                        <div className="text-xs" style={{ color: "#94a3b8" }}>
                          {nodeTypeLabel(g.node_type)}
                          {g.count === 1 ? "" : "s"} · nearest {g.min_depth} hop
                          {g.min_depth === 1 ? "" : "s"}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Affected entity list (bounded — the normalized child rows). */}
              {a.affected_entities.length > 0 && (
                <section className="mb-8">
                  <h2 className="text-sm font-semibold mb-3" style={{ color: "#f1f5f9" }}>
                    Affected entities
                  </h2>
                  <div className="space-y-2">
                    {a.affected_entities.map((e) => (
                      <div
                        key={`${e.node_type}:${e.node_id}`}
                        className="bg-brand-surface border border-brand-line rounded-lg px-4 py-2.5 flex items-center justify-between gap-3 text-sm"
                      >
                        <span style={{ color: "#cbd5e1" }}>
                          {nodeTypeLabel(e.node_type)}{" "}
                          <span className="font-mono text-xs" style={{ color: "#64748b" }}>
                            {shortHash(e.node_id)}
                          </span>
                        </span>
                        <span className="text-xs" style={{ color: "#94a3b8" }}>
                          depth {e.min_depth} via {matchTargetLabel(e.via_target_type)}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          );
        })()
      )}
    </div>
  );
}
