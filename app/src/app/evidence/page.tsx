import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getEvidenceSummary,
  getRecentEvidence,
  evidenceFileHref,
  type Evidence,
} from "@/lib/api";
import { evidenceRefHref } from "@/lib/evidenceLinks";

/**
 * /evidence — the organization's evidence inventory (EG2 Tier 2 slice 8).
 *
 * The engine has aggregated evidence by workflow since the summary endpoint
 * shipped, but no page consumed it: a compliance manager could not answer
 * "what evidence do we have, and where?" anywhere in the product. This page
 * is that answer — counts by workflow (each linking to the surface that owns
 * those records) and the latest evidence across the org, with the artifact
 * downloadable where a file was attached.
 */

export const dynamic = "force-dynamic";

/** Workflow labels + the surface that owns each population. */
const SOURCE_TYPE_META: Record<string, { label: string; href: string }> = {
  control_test: { label: "Control assessments", href: "/controls" },
  vendor_review: { label: "Vendor assessments", href: "/vendors" },
  ai_review: { label: "Governance reviews", href: "/ai-systems" },
  ai_governance_review: { label: "AI governance assessments", href: "/ai-systems" },
  obligation_review: { label: "Obligation assessments", href: "/obligations" },
  dependency_review: { label: "Dependency assessments", href: "/dependencies" },
  risk_treatment: { label: "Risk treatments", href: "/risks" },
  finding: { label: "Findings", href: "/findings" },
};

const EVIDENCE_TYPE_LABELS: Record<string, string> = {
  document: "Document",
  screenshot: "Screenshot",
  log: "Log",
  test_result: "Test result",
  interview: "Interview",
  observation: "Observation",
  policy: "Policy",
  other: "Other",
};

function fmt(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function RecentRow({ e }: { e: Evidence }) {
  const meta = SOURCE_TYPE_META[e.source_type];
  const refHref = evidenceRefHref(e.external_ref);
  return (
    <div
      className="rounded-xl border p-4 flex items-start gap-3 flex-wrap"
      style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium mb-0.5" style={{ color: "#f1f5f9" }}>
          {e.title}
        </p>
        <p className="text-xs" style={{ color: "#64748b" }}>
          {EVIDENCE_TYPE_LABELS[e.evidence_type] ?? e.evidence_type}
          {meta ? <> · {meta.label}</> : null}
          {" · "}
          {fmt(e.collected_at ?? e.created_at)}
          {e.collected_by ? <> · {e.collected_by}</> : null}
        </p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        {e.has_file && (
          <a
            href={evidenceFileHref(e.id)}
            className="text-xs font-medium"
            style={{ color: "#00c4b4" }}
          >
            Download {e.original_filename ? `(${e.original_filename})` : "file"}
          </a>
        )}
        {!e.has_file && refHref && (
          <a
            href={refHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium"
            style={{ color: "#93c5fd" }}
          >
            Open reference ↗
          </a>
        )}
      </div>
    </div>
  );
}

export default async function EvidencePage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  // Same platform gate as the sibling inventory surfaces (engine enforces
  // premium authoritatively; this decides what to render).
  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const [summary, recent] = await Promise.all([
    getEvidenceSummary(token),
    getRecentEvidence(token, 50),
  ]);

  const byType = summary?.by_source_type ?? {};
  const tiles = Object.entries(SOURCE_TYPE_META)
    .map(([key, meta]) => ({ key, ...meta, count: byType[key] ?? 0 }))
    .filter((t) => t.count > 0);
  const total = summary?.total ?? 0;
  const rows = recent?.evidence ?? [];

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1" style={{ color: "#f1f5f9" }}>
          Evidence
        </h1>
        <p className="text-sm" style={{ color: "#94a3b8" }}>
          Every evidence record across your workflows — what exists, where it
          lives, and the artifact itself where one was attached. Records are
          write-once; downloads are audit-logged.
        </p>
      </div>

      {summary === null ? (
        <div
          className="rounded-xl border p-8 text-center"
          style={{ background: "var(--color-brand-surface, #111827)", borderColor: "rgba(239,68,68,0.25)" }}
        >
          <p className="text-sm" style={{ color: "#fca5a5" }}>
            Could not load the evidence summary right now — this does not mean
            your organization has no evidence. Refresh to try again.
          </p>
        </div>
      ) : total === 0 ? (
        <div
          className="rounded-xl border p-10 text-center"
          style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
        >
          <p className="text-sm mb-2" style={{ color: "#94a3b8" }}>
            No evidence has been recorded yet.
          </p>
          <p className="text-xs" style={{ color: "#64748b" }}>
            Attach evidence from a finding, a control or obligation assessment,
            or an AI governance review — it all rolls up here.
          </p>
        </div>
      ) : (
        <>
          {/* Counts by workflow — each number links to the surface that owns it */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            <div
              className="rounded-xl border p-4"
              style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
            >
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
                Total records
              </p>
              <p className="text-3xl font-bold" style={{ color: "#f1f5f9" }}>{total}</p>
            </div>
            {tiles.map((t) => (
              <Link
                key={t.key}
                href={t.href}
                className="rounded-xl border p-4 transition-colors hover:border-teal-700/60"
                style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
              >
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
                  {t.label}
                </p>
                <p className="text-3xl font-bold" style={{ color: "#5eead4" }}>{t.count}</p>
              </Link>
            ))}
          </div>

          {/* Latest evidence across the org */}
          <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "#64748b" }}>
            Most recent
          </p>
          <div className="space-y-3">
            {rows.map((e) => (
              <RecentRow key={e.id} e={e} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
