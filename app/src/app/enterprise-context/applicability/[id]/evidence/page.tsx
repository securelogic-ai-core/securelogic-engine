import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getApplicabilityAssessment } from "@/lib/api";
import {
  decisionLabel,
  evidenceCategoryLabel,
  matchTargetLabel,
  readFailure,
  shortHash,
} from "@/lib/enterpriseContextFormat";
import { DecisionBadge, MetaChip, ReadFailurePanel, ReproducibilityBadge } from "../../../shared";

/**
 * Evidence view (goal Item 7 named deliverable): what the decision was based on —
 * the by-value evidence snapshots (used, grouped by auditor category), the honest
 * gaps (expected categories with zero rows), and the AD-16 #4 reproducibility
 * block: the content hash re-derived from the stored inputs, with the chain
 * position (prev_hash) — tamper-evidence an auditor can check.
 */
export default async function ApplicabilityEvidencePage({
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
          href={`/enterprise-context/applicability/${id}`}
          className="text-xs hover:opacity-80"
          style={{ color: "#64748b" }}
        >
          ← Decision
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
              <div className="mb-8">
                <div className="flex items-center gap-2 flex-wrap">
                  <DecisionBadge value={a.decision} />
                  <h1 className="text-xl font-bold" style={{ color: "#f1f5f9" }}>
                    Evidence — {matchTargetLabel(a.target_type)} ({decisionLabel(a.decision)})
                  </h1>
                </div>
                <p className="text-sm mt-2" style={{ color: "#94a3b8" }}>
                  Every value below was captured BY VALUE at decision time and is bound
                  into the record&apos;s content hash — what you see is what was decided on.
                </p>
              </div>

              {/* Reproducibility / tamper-evidence — the auditor block. */}
              <section className="mb-8">
                <h2 className="text-sm font-semibold mb-3" style={{ color: "#f1f5f9" }}>
                  Reproducibility
                </h2>
                <div className="bg-brand-surface border border-brand-line rounded-xl p-5 space-y-3">
                  <ReproducibilityBadge reproduces={x.reproducibility.reproduces} />
                  <p className="text-xs" style={{ color: "#94a3b8" }}>
                    The content hash is re-derived from the stored decision, reasoning
                    chain, blast radius, and evidence each time this page renders. A
                    match proves the record has not been altered since it was written.
                  </p>
                  <div className="grid sm:grid-cols-2 gap-2 text-xs font-mono">
                    <div>
                      <span style={{ color: "#64748b" }}>content_hash </span>
                      <span style={{ color: "#cbd5e1" }}>{shortHash(x.reproducibility.content_hash)}</span>
                    </div>
                    <div>
                      <span style={{ color: "#64748b" }}>prev_hash </span>
                      <span style={{ color: "#cbd5e1" }}>{shortHash(x.reproducibility.prev_hash)}</span>
                    </div>
                    <div>
                      <span style={{ color: "#64748b" }}>engine </span>
                      <span style={{ color: "#cbd5e1" }}>{x.reproducibility.engine_version}</span>
                    </div>
                    <div>
                      <span style={{ color: "#64748b" }}>schema </span>
                      <span style={{ color: "#cbd5e1" }}>{x.reproducibility.schema_version}</span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Evidence used, grouped by auditor category. */}
              <section className="mb-8">
                <h2 className="text-sm font-semibold mb-3" style={{ color: "#f1f5f9" }}>
                  Evidence used
                </h2>
                {x.evidence_used.length === 0 ? (
                  <p className="text-sm" style={{ color: "#94a3b8" }}>
                    No evidence rows were captured for this decision.
                  </p>
                ) : (
                  <div className="mb-4 flex flex-wrap gap-3">
                    {x.evidence_used.map((g) => (
                      <div
                        key={g.category}
                        className="bg-brand-surface border border-brand-line rounded-lg px-4 py-3"
                      >
                        <div className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
                          {evidenceCategoryLabel(g.category)}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: "#94a3b8" }}>
                          {g.count} snapshot{g.count === 1 ? "" : "s"} · {g.types.join(", ")}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {x.evidence_missing.length > 0 && (
                  <div
                    className="rounded-lg px-4 py-3 text-xs"
                    style={{ background: "rgba(245,158,11,0.08)", color: "#fcd34d" }}
                  >
                    Missing evidence categories:{" "}
                    {x.evidence_missing.map(evidenceCategoryLabel).join(", ")} — the decision
                    was made without these inputs.
                  </div>
                )}
              </section>

              {/* Raw by-value snapshots. */}
              <section className="mb-8">
                <h2 className="text-sm font-semibold mb-3" style={{ color: "#f1f5f9" }}>
                  Captured snapshots
                </h2>
                <div className="space-y-2">
                  {a.evidence.map((e, i) => (
                    <div key={i} className="bg-brand-surface border border-brand-line rounded-lg px-4 py-3">
                      <div className="flex flex-wrap gap-3 mb-2">
                        <MetaChip label="Type" value={e.evidence_type} />
                        <MetaChip label="Source table" value={e.ref_table} />
                        <MetaChip label="Ref" value={e.ref_id ? shortHash(e.ref_id) : null} />
                        <MetaChip label="Weight" value={e.weight !== null ? String(e.weight) : null} />
                      </div>
                      <pre
                        className="text-xs font-mono whitespace-pre-wrap break-all rounded p-2"
                        style={{ background: "#0a0f1a", color: "#94a3b8" }}
                      >
                        {e.captured_value}
                      </pre>
                    </div>
                  ))}
                </div>
              </section>
            </>
          );
        })()
      )}
    </div>
  );
}
