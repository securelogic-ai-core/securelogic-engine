import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import {
  getMe,
  getFindings,
  getFindingsSummary,
  getFindingSavedViews,
  getFindingsByEntity,
  getSignalMatchSuggestionCounts,
  getTeamMembers,
} from "@/lib/api";
import { FindingsList } from "./FindingsList";
import { FindingCard } from "@/components/FindingCard";
import { ExportCsvButton } from "./ExportCsvButton";
import { isActiveStatus, urgencyBucket, URGENCY_LABELS } from "./decisionQueue";
import SavedViewsBar from "./SavedViewsBar";
import { currentViewFilters } from "./savedViews";
import WorkFirstFindings from "./WorkFirstFindings";
import { FindingsQueueToolbar } from "./FindingsQueueToolbar";
import {
  parseQueueState,
  queueStateToParams,
  buildPager,
  clearAllFilters,
  queueHref,
} from "./queueControls";
import { opsBucket, bucketListParams, opsCounts, globalSummary, decodeCursor, parseTrail, bucketPageHrefs, pageRange, BUCKET_PAGE_SIZE } from "./workQueues";

const SOURCE_TYPE_LABELS: Record<string, string> = {
  vendor_review:        "Vendor Assessment",
  control_test:         "Control Test",
  obligation_review:    "Obligation Review",
  ai_review:            "AI Review",
  ai_governance_review: "AI Governance Review",
  manual:               "Manual",
  assessment:           "Assessment",
  signal:               "Signal",
  risk:                 "Risk",
};

const SOURCE_TYPE_VALUES: Array<{ label: string; value: string }> = [
  { label: "Vendor Assessment",   value: "vendor_review" },
  { label: "Control Test",        value: "control_test" },
  { label: "Obligation Review",   value: "obligation_review" },
  { label: "AI Review",           value: "ai_review" },
  { label: "AI Governance Review",value: "ai_governance_review" },
  { label: "Manual",              value: "manual" },
];

const STAT_CARD_STYLE: React.CSSProperties = {
  background: "var(--color-brand-surface, #111827)",
  border: "1px solid #1e293b",
  borderRadius: "12px",
  padding: "16px 20px",
};

type Params = Record<string, string | undefined>;

function filterHref(current: Params, key: string, value: string | null): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v !== undefined && k !== key) params.set(k, v);
  }
  if (value !== null) params.set(key, value);
  const qs = params.toString();
  return `/findings${qs ? `?${qs}` : ""}`;
}

function FilterPill({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-colors"
      style={
        active
          ? { background: "rgba(0,196,180,0.15)", color: "#00c4b4", border: "1px solid rgba(0,196,180,0.4)" }
          : { background: "transparent", color: "#94a3b8", border: "1px solid #1e293b" }
      }
    >
      {label}
    </Link>
  );
}

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const sp = await searchParams;
  const me = await getMe(token);
  const entitlementLevel = me?.entitlementLevel ?? "starter";
  const isPlatformUser = ["premium", "platform", "team"].includes(entitlementLevel);
  if (!isPlatformUser) redirect("/dashboard");

  const activeStatus   = sp.status   ?? "all";
  const activeSeverity = sp.severity ?? "";
  const activeDomain   = sp.domain   ?? "";
  const activeSource   = sp.source_type ?? "";
  const activePriority = sp.priority ?? "";
  // Metric Contract: `?active=true` is the population every dashboard findings tile
  // counts (sqlFindingActive = open + in_progress) and therefore the population its
  // link must land on. Without this the page fell through to `status ?? "all"` and
  // listed CLOSED and ACCEPTED findings under a tile that promised active ones.
  const activeOnly     = sp.active === "true";

  const [findingsData, summaryData] = await Promise.all([
    getFindings(token, {
      status:      activeStatus === "all" ? undefined : activeStatus,
      active:      activeOnly || undefined,
      severity:    activeSeverity  || undefined,
      domain:      activeDomain    || undefined,
      source_type: activeSource    || undefined,
      priority:    activePriority  || undefined,
      limit: 100,
    }),
    getFindingsSummary(token),
  ]);

  const findings = findingsData?.findings ?? [];
  const summary = summaryData?.summary;

  // Metric Contract: these tiles count the ACTIVE population (operational_status
  // <> 'closed'), not the strictly-open one. A Critical finding under active
  // remediation is still a Critical finding — the old strictly-open tiles emptied
  // themselves the moment someone STARTED work, so the numbers fell as the
  // organization got busier and the board saw progress that had not happened.
  //
  // The `?? *_open` fallbacks are for an older engine build that does not serve the
  // *_active fields yet; they under-report rather than render a wrong zero.
  const activeCount     = summary?.active_total ?? findings.filter((f) => isActiveStatus(f.status)).length;
  const criticalCount   = summary?.critical_active ?? summary?.critical_open ?? findings.filter((f) => f.severity === "Critical" && isActiveStatus(f.status)).length;
  const highCount       = summary?.high_active ?? summary?.high_open ?? findings.filter((f) => f.severity === "High" && isActiveStatus(f.status)).length;
  const moderateCount   = summary?.medium_active ?? summary?.medium_open ?? findings.filter((f) => f.severity === "Moderate" && isActiveStatus(f.status)).length;
  const lowCount        = summary?.low_active ?? summary?.low_open ?? findings.filter((f) => f.severity === "Low" && isActiveStatus(f.status)).length;
  // Metric Contract: org truth from the summary — previously the ONLY tile in
  // this row computed from the capped ≤100-row slice while its neighbors used
  // org-wide counts (one tile row, two sources of truth).
  const inProgressCount = summary?.in_progress_open ?? findings.filter((f) => f.status === "in_progress").length;

  const currentSp: Params = {
    ...(sp.status      ? { status:      sp.status }      : {}),
    ...(activeOnly     ? { active:      "true" }         : {}),
    ...(sp.severity    ? { severity:    sp.severity }    : {}),
    ...(sp.domain      ? { domain:      sp.domain }      : {}),
    ...(sp.source_type ? { source_type: sp.source_type } : {}),
    ...(sp.priority    ? { priority:    sp.priority }    : {}),
  };

  // Picking an explicit status REPLACES the active set rather than intersecting with
  // it (the engine ANDs the two, so `active=true&status=closed` would render an empty
  // list under a highlighted "Closed" pill). Status hrefs are built without `active`.
  const statusSp: Params = { ...currentSp };
  delete statusSp.active;
  // The Active pill is the status axis's own value, so it drops any explicit status.
  const activeSp: Params = { ...currentSp };
  delete activeSp.status;

  // `active` is a filter. It must be one, or the workspace flag would route this
  // deep link to the work-first landing page instead of the list it promises.
  const hasFilters = !!(
    activeOnly || activeSeverity || activeDomain || activeSource || activePriority ||
    (sp.status && sp.status !== "all")
  );

  // Enterprise decision-queue framing (ERIP) — DARK, SECURELOGIC_RISK_WORKSPACE_ENABLED.
  // When on, Findings reads as a "what requires action now" decision queue
  // (attention tiles + urgency grouping in FindingsList). Off = unchanged list.
  const workspace = process.env.SECURELOGIC_RISK_WORKSPACE_ENABLED === "true";

  // Scalable Risk Findings queue controls (search/filter/sort/pagination + due
  // urgency) — DARK, SECURELOGIC_FINDINGS_QUEUE_CONTROLS_ENABLED. Enhances the
  // BROWSE queue only; the Operations Center (workspace home/bucket/entity) is
  // untouched. Flag off = the legacy browse list, byte-for-byte unchanged.
  const queueEnabled = process.env.SECURELOGIC_FINDINGS_QUEUE_CONTROLS_ENABLED === "true";

  // MW-4: resolve owner ids → names so cards show WHO owns a finding, not a bare
  // "Assigned" chip. Best-effort: a failed/permission-limited fetch leaves the map
  // empty and cards fall back to "Assigned" rather than erroring.
  const ownerNames: Record<string, string> = {};
  if (workspace || queueEnabled) {
    const teamData = await getTeamMembers(token);
    for (const m of teamData?.members ?? []) ownerNames[m.id] = m.name || m.email;
  }

  // Saved views (ERIP §1) — DARK, SECURELOGIC_DECISION_WORKSPACE_ENABLED (the engine
  // route 404s while off → []). Per-user named filter presets on the decision queue.
  const savedViewsEnabled = process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED === "true";
  const savedViews = savedViewsEnabled ? await getFindingSavedViews(token) : [];

  // Operations-center interaction model (ERIP goal): under the workspace flag the
  // landing view organizes WORK into decision buckets + risk domains + tracking —
  // no finding rows. Clicking a bucket opens a SUBORDINATE, SERVER-FILTERED
  // findings view (?bucket=<id>, fetched with engine-side filters so it is correct
  // at 20k findings) or the surface owning that work (/approvals, /queue). Entity
  // search (?entity=<name>) and the browse escape hatch (?queue=all / any legacy
  // filter — keeps posture/dashboard deep links working) are subordinate views too.
  // Flag-off renders the unchanged legacy page.
  const bucket = workspace ? opsBucket(sp.bucket) : null;
  const entityQuery =
    workspace && typeof sp.entity === "string" && sp.entity.trim().length >= 2 ? sp.entity.trim() : "";
  const browse = sp.queue === "all" || hasFilters;
  const workFirstMode: "home" | "bucket" | "entity" | null =
    !workspace || browse ? null : entityQuery ? "entity" : bucket ? "bucket" : "home";

  // Enhanced browse queue: server-side search/filter/sort/pagination fetch. Only
  // when the flag is on AND we are in the browse view (never the Ops Center).
  const showQueue = queueEnabled && workFirstMode === null;
  const queueState = parseQueueState(sp);
  const queueData = showQueue ? await getFindings(token, queueStateToParams(queueState)) : null;
  const queueFindings = queueData?.findings ?? [];
  const queueTotal = queueData?.total ?? queueFindings.length;
  const queuePager = buildPager(queueState, queueTotal);
  const nowMs = Date.now();

  // Bucket members come from a SERVER-filtered, SERVER-paged fetch (never
  // client-filtering a page). Keyset cursor + bounded prev-trail live in the URL;
  // invalid pagination input fails safe to the first page (decodeCursor → null).
  const afterToken = typeof sp.after === "string" && decodeCursor(sp.after) ? sp.after : null;
  const trail = parseTrail(typeof sp.trail === "string" ? sp.trail : undefined);
  const bucketParams =
    workFirstMode === "bucket" && bucket ? bucketListParams(bucket, decodeCursor(afterToken)) : null;
  const bucketData = bucketParams ? await getFindings(token, bucketParams) : null;
  const bucketPage =
    workFirstMode === "bucket" && bucket && bucketData
      ? {
          total: bucketData.total ?? bucketData.findings.length,
          range: pageRange(afterToken, trail, bucketData.findings.length),
          // A partial page is by definition the last one — never offer a Next
          // that can only land on an empty page.
          hrefs: bucketPageHrefs(
            bucket.id,
            afterToken,
            trail,
            bucketData.findings.length === BUCKET_PAGE_SIZE ? bucketData.nextCursor : null
          ),
        }
      : null;
  // Review-links pending total (home only); null on failure → honest "—", never 0.
  const suggestionCounts = workFirstMode === "home" ? await getSignalMatchSuggestionCounts(token) : null;
  const { counts: wfCounts, unknown: wfUnknown } = opsCounts(
    summary,
    workFirstMode === "home" ? (suggestionCounts ? suggestionCounts.total : null) : 0
  );
  const entityResult = workFirstMode === "entity" ? await getFindingsByEntity(token, entityQuery) : null;

  // F-1 headline summary + F-8 freshness. Server component with revalidate=0, so
  // the request-time clock is the honest "as of" for these server-COUNT metrics.
  const summaryItems = workFirstMode === "home" ? globalSummary(summary) : undefined;
  const generatedAt =
    workFirstMode === "home"
      ? new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" })
      : undefined;

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: "#f1f5f9" }}>
            {workspace ? "Risk Findings" : "Findings"}
          </h1>
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            {workspace
              ? "Your decision queue — what requires action now, most urgent first"
              : "All findings across your organization"}
          </p>
        </div>
        <Link
          href="/findings/import"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "8px 14px",
            borderRadius: "8px",
            fontSize: "13px",
            fontWeight: 500,
            border: "1px solid #1e293b",
            color: "#94a3b8",
            textDecoration: "none",
          }}
        >
          ↑ Import CSV
        </Link>
        <ExportCsvButton
          queryString={new URLSearchParams(
            Object.fromEntries(
              Object.entries(currentSp).filter(([, v]) => v !== undefined)
            ) as Record<string, string>
          ).toString()}
        />
      </div>

      {workFirstMode ? (
        <WorkFirstFindings
          mode={workFirstMode}
          counts={wfCounts}
          unknownCounts={wfUnknown}
          summaryItems={summaryItems}
          generatedAt={generatedAt}
          ownerNames={ownerNames}
          bucket={bucket ?? undefined}
          bucketFindings={bucketData?.findings ?? undefined}
          bucketPage={bucketPage ?? undefined}
          entityQuery={entityQuery}
          entityResult={entityResult}
        />
      ) : showQueue ? (
        <>
          {/* Scalable Risk Findings queue: compact toolbar + server-paged cards. */}
          <FindingsQueueToolbar
            state={queueState}
            total={queueTotal}
            count={queueFindings.length}
          />
          {queueFindings.length === 0 ? (
            <div
              className="rounded-xl border p-10 text-center"
              style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
            >
              <p className="text-sm mb-3" style={{ color: "#94a3b8" }}>
                No findings match your search and filters.
              </p>
              <Link
                href={queueHref(clearAllFilters(queueState))}
                className="text-xs font-medium"
                style={{ color: "#00c4b4" }}
              >
                Clear all
              </Link>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {queueFindings.map((f) => (
                  <FindingCard
                    key={f.id}
                    finding={f}
                    revalidateUrl="/findings"
                    workspace
                    showDueStatus
                    ownerName={f.owner_user_id ? ownerNames[f.owner_user_id] ?? null : null}
                    reason={URGENCY_LABELS[urgencyBucket(f, nowMs)]}
                    queueContext="findings_queue"
                  />
                ))}
              </div>
              {/* Pager — offset pagination; the URL carries page + all state so
                  Back restores the exact queue after opening a finding. */}
              <div className="flex items-center justify-between mt-6">
                {queuePager.prevHref ? (
                  <Link href={queuePager.prevHref} className="text-sm font-medium" style={{ color: "#00c4b4" }}>
                    ← Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-xs" style={{ color: "#64748b" }}>
                  Page {queuePager.page} of {queuePager.pages}
                </span>
                {queuePager.nextHref ? (
                  <Link href={queuePager.nextHref} className="text-sm font-medium" style={{ color: "#00c4b4" }}>
                    Next →
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            </>
          )}
        </>
      ) : (
        <>
      {/* Summary stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-8">
        <div style={STAT_CARD_STYLE}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
            Active
          </p>
          <p className="text-3xl font-bold" style={{ color: "#fca5a5" }}>{activeCount}</p>
        </div>
        <div style={STAT_CARD_STYLE}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
            Critical
          </p>
          <p className="text-3xl font-bold" style={{ color: "#fca5a5" }}>{criticalCount}</p>
        </div>
        <div style={STAT_CARD_STYLE}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
            High
          </p>
          <p className="text-3xl font-bold" style={{ color: "#fdba74" }}>{highCount}</p>
        </div>
        <div style={STAT_CARD_STYLE}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
            Moderate
          </p>
          <p className="text-3xl font-bold" style={{ color: "#fbbf24" }}>{moderateCount}</p>
        </div>
        <div style={STAT_CARD_STYLE}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
            Low
          </p>
          <p className="text-3xl font-bold" style={{ color: "#86efac" }}>{lowCount}</p>
        </div>
        <div style={STAT_CARD_STYLE}>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
            In Progress
          </p>
          <p className="text-3xl font-bold" style={{ color: "#93c5fd" }}>{inProgressCount}</p>
        </div>
      </div>

      {/* Filter bar */}
      <div className="mb-6 space-y-3">
        {/* Status */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: "#64748b" }}>
            Status
          </span>
          <FilterPill label="All"         href={filterHref(statusSp, "status", "all")}         active={activeStatus === "all" && !activeOnly} />
          {/* The population every dashboard findings tile counts. Without a pill of its
              own, an ?active=true deep link would render a filtered list with "All"
              highlighted — a silent filter, which is the defect class this contract exists
              to remove. */}
          <FilterPill label="Active"      href={filterHref(activeSp, "active", "true")}        active={activeOnly} />
          <FilterPill label="Open"        href={filterHref(statusSp, "status", "open")}        active={activeStatus === "open" && !activeOnly} />
          <FilterPill label="In Progress" href={filterHref(statusSp, "status", "in_progress")} active={activeStatus === "in_progress" && !activeOnly} />
          <FilterPill label="Closed"      href={filterHref(statusSp, "status", "closed")}      active={activeStatus === "closed" && !activeOnly} />
          <FilterPill label="Accepted"    href={filterHref(statusSp, "status", "accepted")}    active={activeStatus === "accepted" && !activeOnly} />
        </div>

        {/* Severity */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: "#64748b" }}>
            Severity
          </span>
          <FilterPill label="All"      href={filterHref(currentSp, "severity", null)}       active={!activeSeverity} />
          <FilterPill label="Critical" href={filterHref(currentSp, "severity", "Critical")} active={activeSeverity === "Critical"} />
          <FilterPill label="High"     href={filterHref(currentSp, "severity", "High")}     active={activeSeverity === "High"} />
          <FilterPill label="Moderate" href={filterHref(currentSp, "severity", "Moderate")} active={activeSeverity === "Moderate"} />
          <FilterPill label="Low"      href={filterHref(currentSp, "severity", "Low")}      active={activeSeverity === "Low"} />
        </div>

        {/* Source Type */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: "#64748b" }}>
            Type
          </span>
          <FilterPill label="All" href={filterHref(currentSp, "source_type", null)} active={!activeSource} />
          {SOURCE_TYPE_VALUES.map((s) => (
            <FilterPill
              key={s.value}
              label={s.label}
              href={filterHref(currentSp, "source_type", s.value)}
              active={activeSource === s.value}
            />
          ))}
        </div>

        {/* Priority */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wide mr-1" style={{ color: "#64748b" }}>
            Priority
          </span>
          <FilterPill label="All"       href={filterHref(currentSp, "priority", null)}        active={!activePriority} />
          <FilterPill label="Immediate" href={filterHref(currentSp, "priority", "immediate")} active={activePriority === "immediate"} />
          <FilterPill label="Near Term" href={filterHref(currentSp, "priority", "near_term")} active={activePriority === "near_term"} />
          <FilterPill label="Planned"   href={filterHref(currentSp, "priority", "planned")}   active={activePriority === "planned"} />
          <FilterPill label="Watch"     href={filterHref(currentSp, "priority", "watch")}     active={activePriority === "watch"} />
        </div>
      </div>

      {/* Findings list */}
      {savedViewsEnabled && (
        <SavedViewsBar views={savedViews} currentFilters={currentViewFilters(sp)} />
      )}
      <FindingsList
        findings={findings}
        hasFilters={hasFilters}
        workspace={workspace}
        orgSummary={summary}
        total={findingsData?.total}
        ownerNames={ownerNames}
      />
        </>
      )}
    </div>
  );
}
