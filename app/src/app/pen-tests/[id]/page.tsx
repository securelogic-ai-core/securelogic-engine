import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getPenTestEngagement,
  getFindings,
  type Finding,
} from "@/lib/api";
import { UnavailableNotice } from "@/components/edx/UnavailableNotice";
import { EngagementLifecycleCard } from "./EngagementLifecycleCard";
import { RecordRetestControl } from "./RecordRetestControl";

/**
 * /pen-tests/[id] — one penetration test and the findings it produced (PEN-1).
 *
 * The engagement is provenance, not a lifecycle: the header answers the
 * auditor's questions (which test, run by whom, when, where the report is) and
 * the list below is ORDINARY findings — the same rows /findings shows, reached
 * through the existing source_type/source_id filter, each linking to the same
 * /findings/[id] detail where all decision-making lives. Nothing pen-test-
 * specific is invented here.
 */

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

const SEVERITY_STYLES: Record<string, React.CSSProperties> = {
  Critical: { background: "rgba(239,68,68,0.15)",   color: "#fca5a5" },
  High:     { background: "rgba(249,115,22,0.15)",  color: "#fdba74" },
  Moderate: { background: "rgba(245,158,11,0.15)",  color: "#fcd34d" },
  Low:      { background: "rgba(34,197,94,0.15)",   color: "#86efac" },
};

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  open:        { background: "rgba(239,68,68,0.12)",  color: "#fca5a5" },
  in_progress: { background: "rgba(59,130,246,0.15)", color: "#93c5fd" },
  closed:      { background: "rgba(34,197,94,0.12)",  color: "#86efac" },
  accepted:    { background: "rgba(139,92,246,0.15)", color: "#c4b5fd" },
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open", in_progress: "In Progress", closed: "Closed", accepted: "Accepted",
};

export default async function PenTestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const [engagementData, findingsData] = await Promise.all([
    getPenTestEngagement(token, id),
    // The findings that name THIS engagement as their source — the same list
    // route every other surface reads, filtered, never a parallel endpoint.
    getFindings(token, { source_type: "pen_test", source_id: id, limit: 200 }),
  ]);

  // 404 and cross-tenant come back identically as null — send the customer to
  // the list rather than rendering a shell about an engagement we can't show.
  if (!engagementData) redirect("/pen-tests");

  const engagement = engagementData.engagement;
  const findings: Finding[] = findingsData?.findings ?? [];

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <div className="mb-8">
        <Link
          href="/pen-tests"
          className="inline-flex items-center gap-1.5 text-xs font-medium mb-4 transition-colors hover:opacity-80"
          style={{ color: "#94a3b8" }}
        >
          ← Pen Tests
        </Link>
      </div>

      {/* Engagement header — the provenance an auditor asks for. */}
      <div className="bg-brand-surface border border-brand-line rounded-xl p-6 mb-6">
        <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
          {engagement.name}
        </h1>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>
              Testing Firm
            </p>
            <p className="text-sm mt-1" style={{ color: "#cbd5e1" }}>
              {engagement.provider ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>
              Started
            </p>
            <p className="text-sm mt-1" style={{ color: "#cbd5e1" }}>
              {fmtDate(engagement.started_on)}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>
              Ended
            </p>
            <p className="text-sm mt-1" style={{ color: "#cbd5e1" }}>
              {fmtDate(engagement.ended_on)}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>
              Report
            </p>
            <p className="text-sm mt-1 break-words" style={{ color: "#cbd5e1" }}>
              {engagement.report_reference ?? "—"}
            </p>
          </div>
        </div>
      </div>

      {/* T2-I: lifecycle, test type, methodology, scope, recurrence clock —
          with the inline edit form. Overdue is the engine's computed
          test_overdue, rendered, never recomputed. */}
      <EngagementLifecycleCard engagement={engagement} />

      <div className="mb-4 flex items-baseline justify-between flex-wrap gap-3">
        <h2 className="text-lg font-semibold" style={{ color: "#f1f5f9" }}>
          Findings
          {findingsData !== null && (
            <span className="ml-2 text-sm font-normal" style={{ color: "#94a3b8" }}>
              {findings.length}
            </span>
          )}
        </h2>
        <Link
          href="/findings/import"
          className="inline-flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-80"
          style={{ color: "#00c4b4" }}
        >
          Import Findings →
        </Link>
      </div>

      {/* A failed findings fetch is disclosed, never rendered as "no findings" —
          the empty state below is a claim about this engagement's report. */}
      {findingsData === null && (
        <UnavailableNotice
          subject="This engagement’s findings"
          denial="not a limit of your plan, and not an empty report"
          reassurance="The findings themselves are unchanged."
          retryHref={`/pen-tests/${engagement.id}`}
        />
      )}

      {/* Honest empty state: absence says exactly what would populate it. */}
      {findingsData !== null && findings.length === 0 && (
        <div className="bg-brand-surface border border-brand-line rounded-xl p-8">
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            No findings reference this engagement yet. To bring in the report&rsquo;s
            results,{" "}
            <Link
              href="/findings/import"
              className="font-medium transition-colors hover:opacity-80"
              style={{ color: "#00c4b4" }}
            >
              import findings
            </Link>{" "}
            with <strong style={{ color: "#cbd5e1" }}>Source Type</strong> set to{" "}
            <code
              className="px-1.5 py-0.5 rounded text-xs"
              style={{ background: "rgba(15,23,42,0.6)", border: "1px solid #1e293b", color: "#cbd5e1" }}
            >
              pen_test
            </code>{" "}
            and an <strong style={{ color: "#cbd5e1" }}>Engagement ID</strong> column
            containing this engagement&rsquo;s id:
          </p>
          <p className="mt-3">
            <code
              className="px-2 py-1 rounded text-xs break-all"
              style={{ background: "rgba(15,23,42,0.6)", border: "1px solid #1e293b", color: "#00c4b4" }}
            >
              {engagement.id}
            </code>
          </p>
        </div>
      )}

      {findings.length > 0 && (
        <div className="space-y-3">
          {findings.map((f) => (
            <FindingRow key={f.id} finding={f} engagementId={engagement.id} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function FindingRow({
  finding,
  engagementId,
}: {
  finding: Finding;
  /** The engagement whose page this row renders on — the engagement DOING a
   *  recorded retest, which may legitimately differ from the finding's own
   *  source engagement (the annual test verifying last year's fixes). */
  engagementId: string;
}) {
  const severityStyle = finding.severity
    ? SEVERITY_STYLES[finding.severity] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" }
    : { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };
  const statusStyle =
    STATUS_STYLES[finding.status] ?? { background: "rgba(148,163,184,0.15)", color: "#94a3b8" };

  // T2-I: the row is no longer one big link — the retest control is a form and
  // cannot legally nest inside an anchor. The TITLE is the link to the shared
  // finding detail; the control sits beside the row's metadata.
  return (
    <div className="bg-brand-surface border border-brand-line hover:border-slate-500 rounded-xl p-5 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* NULL severity is a real state, not missing data: the tester said
                Informational (or an unmappable value), so no canonical severity —
                and no SLA — exists. The source's own word renders beside it. */}
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={severityStyle}>
              {finding.severity ??
                (finding.source_severity ? `No severity · source: ${finding.source_severity}` : "No severity")}
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={statusStyle}>
              {STATUS_LABELS[finding.status] ?? finding.status}
            </span>
          </div>
          <Link href={`/findings/${finding.id}`} className="block transition-opacity hover:opacity-80">
            <p className="mt-2 text-sm font-semibold" style={{ color: "#f1f5f9" }}>
              {finding.title}
            </p>
          </Link>
        </div>
        {finding.source_reference_id && (
          <div className="flex-shrink-0 text-right">
            {/* The finding's id in the source report, so the customer can match
                this record to the PDF on their desk. */}
            <span className="text-xs" style={{ color: "#475569" }}>
              {finding.source_reference_id}
            </span>
          </div>
        )}
      </div>
      {/* T2-I: record one retest act. Write-only here on purpose — the
          verification history renders on the finding detail (its natural
          home), so this list never fans out into N retest fetches. */}
      <div className="mt-3">
        <RecordRetestControl engagementId={engagementId} findingId={finding.id} />
      </div>
    </div>
  );
}
