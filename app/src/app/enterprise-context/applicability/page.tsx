import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getApplicabilityAssessments } from "@/lib/api";
import {
  APPLICABILITY_DECISIONS,
  APPLICABILITY_PAGE,
  type ApplicabilityDecision,
  type ApplicabilityAssessmentRow,
} from "@/lib/enterpriseContext";
import {
  decisionLabel,
  matchTargetLabel,
  pageNav,
  parseOffsetParam,
  readFailure,
  shortHash,
} from "@/lib/enterpriseContextFormat";
import { DecisionBadge, MetaChip, ReadFailurePanel } from "../shared";

function isDecision(v: string | undefined): v is ApplicabilityDecision {
  return !!v && (APPLICABILITY_DECISIONS as readonly string[]).includes(v);
}

export default async function ApplicabilityListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
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

  const sp = await searchParams;
  const decisionFilter = isDecision(sp.decision) ? sp.decision : undefined;
  const offset = parseOffsetParam(sp.offset);
  const limit = APPLICABILITY_PAGE.defaultLimit;

  const result = await getApplicabilityAssessments(token, {
    decision: decisionFilter,
    limit,
    offset,
  });

  const filterHref = (d?: ApplicabilityDecision) => {
    const q = new URLSearchParams();
    if (d) q.set("decision", d);
    const s = q.toString();
    return s ? `/enterprise-context/applicability?${s}` : "/enterprise-context/applicability";
  };
  const pageHref = (o: number) => {
    const q = new URLSearchParams();
    if (decisionFilter) q.set("decision", decisionFilter);
    if (o > 0) q.set("offset", String(o));
    const s = q.toString();
    return s ? `/enterprise-context/applicability?${s}` : "/enterprise-context/applicability";
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
            Applicability Decisions
          </h1>
          <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
            Which external signals apply to your environment — each decision is an
            immutable, reproducible record with its full reasoning chain and evidence.
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
        <>
          {/* Decision filter chips — filter applies to the CURRENT decision per identity. */}
          <div className="mb-5 flex flex-wrap gap-2">
            <FilterChip href={filterHref(undefined)} active={!decisionFilter} label="All" />
            {APPLICABILITY_DECISIONS.map((d) => (
              <FilterChip
                key={d}
                href={filterHref(d)}
                active={decisionFilter === d}
                label={decisionLabel(d)}
              />
            ))}
          </div>

          {result.applicability_assessments.length === 0 ? (
            <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
              <p className="text-sm" style={{ color: "#94a3b8" }}>
                {offset > 0
                  ? "No more decisions."
                  : decisionFilter
                  ? `No current ${decisionLabel(decisionFilter).toLowerCase()} decisions.`
                  : "No applicability decisions yet. Decisions appear as signals are matched against your context."}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {result.applicability_assessments.map((row) => (
                <Link
                  key={row.id}
                  href={`/enterprise-context/applicability/${row.id}`}
                  className="block hover:border-slate-500 cursor-pointer transition-colors rounded-xl"
                >
                  <AssessmentRow row={row} />
                </Link>
              ))}
            </div>
          )}

          <Pagination
            offset={offset}
            limit={limit}
            receivedCount={result.applicability_assessments.length}
            pageHref={pageHref}
          />
        </>
      )}
    </div>
  );
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className="px-3 py-1 rounded-full text-xs font-medium border transition-colors hover:opacity-80"
      style={
        active
          ? { background: "rgba(0,196,180,0.15)", borderColor: "rgba(0,196,180,0.4)", color: "#5eead4" }
          : { background: "transparent", borderColor: "#1e293b", color: "#94a3b8" }
      }
    >
      {label}
    </Link>
  );
}

function AssessmentRow({ row }: { row: ApplicabilityAssessmentRow }) {
  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <div className="flex items-center gap-2 flex-wrap">
        <DecisionBadge value={row.decision} />
        <span className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
          {matchTargetLabel(row.target_type)}
        </span>
        <span className="text-xs" style={{ color: "#64748b" }}>
          {shortHash(row.target_id)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-3">
        <MetaChip label="Confidence" value={`${row.confidence}% (${row.confidence_band})`} />
        <MetaChip
          label="Blast radius"
          value={
            row.affected_count !== undefined
              ? `${row.affected_count} ${row.affected_count === 1 ? "entity" : "entities"}`
              : null
          }
        />
        <MetaChip label="Decided" value={new Date(row.created_at).toLocaleDateString()} />
        <MetaChip label="Engine" value={row.engine_version} />
      </div>
    </div>
  );
}

function Pagination({
  offset,
  limit,
  receivedCount,
  pageHref,
}: {
  offset: number;
  limit: number;
  receivedCount: number;
  pageHref: (o: number) => string;
}) {
  const { prevOffset, nextOffset } = pageNav(offset, limit, receivedCount);
  if (prevOffset === null && nextOffset === null) return null;
  const linkClass =
    "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:opacity-80";
  const linkStyle = { borderColor: "#1e293b", color: "#94a3b8" };
  return (
    <div className="mt-6 flex items-center justify-between">
      <div>
        {prevOffset !== null && (
          <Link href={pageHref(prevOffset)} className={linkClass} style={linkStyle}>
            ← Previous
          </Link>
        )}
      </div>
      <div>
        {nextOffset !== null && (
          <Link href={pageHref(nextOffset)} className={linkClass} style={linkStyle}>
            Next →
          </Link>
        )}
      </div>
    </div>
  );
}
