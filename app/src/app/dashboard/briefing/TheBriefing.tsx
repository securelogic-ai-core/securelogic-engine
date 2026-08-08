/**
 * TheBriefing — the flag-gated opening experience (Briefing Initiative, B1).
 *
 * Rendered by /dashboard ONLY when SECURELOGIC_DASHBOARD_BRIEFING_ENABLED is on
 * AND the session is a platform tier (premium | platform | team). Non-platform
 * tiers and the flag-off state keep the legacy page byte-identical.
 *
 * This file is the RENDER MAP for the canonical module registry
 * (@/lib/briefing/registry): the registry stays pure serializable data; the
 * id → component mapping lives here. Every module renders with an explicit
 * scope chip ("You" vs "Organization") — a number's scope is never implied.
 *
 * The Briefing summarizes and LINKS; it does not reproduce operational views or
 * analytical dashboards. The 12-tile posture grid's analytical tiles keep their
 * home on /posture (linked below); queues live under Risk Operations.
 */

import Link from "next/link";
import { formatPostureDelta } from "@/lib/postureTrend";
import type { IntelligenceBriefDetailResponse, NewsletterIssue, Finding } from "@/lib/api";
import type { BriefingModuleDef, BriefingScope } from "@/lib/briefing/contracts";
import type { BriefingViewModel } from "@/lib/briefing/composeBriefing";
import { IntelligenceBriefDashboardCard } from "@/components/IntelligenceBriefDashboardCard";
import { BriefCard } from "@/components/BriefCard";
import { RecentFindings } from "../RecentFindings";
import { CustomizeBriefing, type CustomizeBriefingProps } from "./CustomizeBriefing";

const ZONE_TITLES: Record<BriefingModuleDef["zone"], string> = {
  your_work: "Your Work",
  organization: "Across Your Organization",
  intelligence: "Intelligence",
};

function ScopeChip({ scope }: { scope: BriefingScope }) {
  return scope === "personal" ? (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide shrink-0 bg-violet-500/15 text-violet-300"
      title="Personal scope"
    >
      You
    </span>
  ) : (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide shrink-0 bg-slate-400/[0.12] text-slate-400"
      title="Organization scope"
    >
      Organization
    </span>
  );
}

function ModuleCard({
  def,
  children,
}: {
  def: BriefingModuleDef;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl border p-5 bg-brand-surface border-brand-line"
      data-briefing-module={def.id}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide truncate">
            {def.title}
          </h3>
          <ScopeChip scope={def.scope} />
        </div>
        <Link
          href={def.destination}
          className="text-xs font-medium shrink-0 text-brand-teal rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
          aria-label={`View ${def.title}`}
        >
          View →
        </Link>
      </div>
      {children}
    </div>
  );
}

export type TheBriefingProps = {
  displayName: string | null;
  orgName: string | null | undefined;
  planName: string;
  /** Eligible modules in RENDER order (saved layout / projection / role default). */
  modules: BriefingModuleDef[];
  vm: BriefingViewModel;
  /**
   * D-2 signal from the page: false = the org has NO platform data yet (no
   * snapshot, finding, action, risk, domain, or framework). Zero-count modules
   * must then read as "nothing measured yet", never as green "all clear" —
   * reassurance on an unassessed org is the fastest way to lose trust in every
   * number that follows.
   */
  hasPlatformData: boolean;
  latestBrief: IntelligenceBriefDetailResponse | null;
  latestIssue: NewsletterIssue | null;
  issuesCount: number;
  recentFindings: Finding[];
  summaryActiveFindings: number;
  /**
   * Where the render order came from (B2). "legacy_projection" additionally
   * renders the dropped-tiles disclosure banner until the user saves or resets.
   */
  layoutSource?: "saved" | "role_default" | "legacy_projection";
  /** Display labels of visible legacy tiles with no Briefing counterpart. */
  droppedTileLabels?: string[];
  /** Customize panel props; null = session cannot personalize (viewer/API-key). */
  customize?: CustomizeBriefingProps | null;
};

export function TheBriefing(props: TheBriefingProps) {
  const { modules, vm } = props;

  // Contiguous zone runs over the RENDER order (B2): the canonical order yields
  // exactly the B1 three-section rendering; a reordered saved layout keeps each
  // module's zone title over its run. Interleaved orders repeat a title —
  // accepted behavior, not a bug (spec ruling C6). The scope chip, not the
  // zone, is the invariant that survives re-zoning (contracts.ts B1.1).
  //
  // A FAILED summary load: organization modules collapse into ONE explicit
  // error panel at the first organization run — never silently missing modules,
  // never zeros.
  const orgFailed = !vm.orgLoaded;
  const groups: Array<{ zone: BriefingModuleDef["zone"]; defs: BriefingModuleDef[] }> = [];
  for (const def of modules) {
    if (orgFailed && def.zone === "organization") continue;
    const last = groups[groups.length - 1];
    if (last && last.zone === def.zone) last.defs.push(def);
    else groups.push({ zone: def.zone, defs: [def] });
  }
  const firstOrgIndex = orgFailed && modules.some((m) => m.zone === "organization")
    ? modules.findIndex((m) => m.zone === "organization")
    : -1;

  const orgErrorSection = (
    <section key="org-error" className="mb-10" data-briefing-zone="organization">
      <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-4">
        {ZONE_TITLES.organization}
      </h2>
      <div
        className="rounded-xl border p-8 text-center bg-brand-surface border-red-500/25"
      >
        <p className="text-sm font-semibold mb-1 text-red-300">
          We couldn&apos;t load your organization&apos;s data.
        </p>
        <p className="text-xs text-slate-500">
          This is a temporary problem loading your briefing — it does not
          mean your posture is clear.
        </p>
        <Link
          href="/dashboard"
          className="inline-block mt-3 text-xs font-medium text-brand-teal rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
        >
          Reload the Briefing →
        </Link>
      </div>
    </section>
  );

  const sections: React.ReactNode[] = [];
  let orgErrorPlaced = false;
  let modulesPlaced = 0;
  for (const group of groups) {
    // Place the org error panel where the first organization module would have
    // rendered (before the group that follows it in the original order).
    if (firstOrgIndex >= 0 && !orgErrorPlaced && modulesPlaced >= firstOrgIndex) {
      sections.push(orgErrorSection);
      orgErrorPlaced = true;
    }
    modulesPlaced += group.defs.length;

    const rendered = group.defs
      .map((def) => ({ def, node: renderModule(def, props) }))
      .filter((r) => r.node !== null);
    if (rendered.length === 0) continue;

    sections.push(
      <section
        key={`${group.zone}-${rendered[0].def.id}`}
        className="mb-10"
        data-briefing-zone={group.zone}
      >
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-4">
          {ZONE_TITLES[group.zone]}
        </h2>
        {group.zone === "intelligence" ? (
          <div>{rendered.map((r) => <div key={r.def.id}>{r.node}</div>)}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {rendered.map((r) => (
              <div
                key={r.def.id}
                className={r.def.id === "recent_findings" ? "md:col-span-2" : undefined}
              >
                {r.node}
              </div>
            ))}
          </div>
        )}
      </section>
    );
  }
  if (firstOrgIndex >= 0 && !orgErrorPlaced) {
    sections.push(orgErrorSection);
  }

  return (
    <div data-briefing>
      {/* Identity header — the experience is The Briefing; the URL stays /dashboard. */}
      <div className="mb-6">
        <p
          className="text-xs font-semibold uppercase tracking-widest mb-1 text-brand-teal"
        >
          The Briefing
        </p>
        <h1 className="text-2xl font-bold text-slate-100 mb-1">
          Welcome back{props.displayName ? `, ${props.displayName}` : ""}.
        </h1>
        <p className="text-slate-400 text-sm">
          What needs your attention now — your work first, then your
          organization. You have {props.planName} access.
        </p>
      </div>

      {/* Personalization entry (B2) — absent for sessions that cannot save
          (viewer role, API-key sessions). */}
      {props.customize ? (
        <div className="mb-6">
          <div className="flex justify-end">
            <CustomizeBriefing {...props.customize} />
          </div>
        </div>
      ) : (
        <div className="mb-4" />
      )}

      {/* Legacy-preference projection disclosure (B2 migration, spec ruling C2):
          shown until the user saves a layout or the legacy rows disappear.
          Copy updated under D1: /posture now hosts the full analytics
          composition, so the banner may truthfully say every analytical tile
          LIVES there (parity achieved — no longer an aspiration). */}
      {props.layoutSource === "legacy_projection" && (
        <div
          className="rounded-xl border px-5 py-4 mb-8 bg-brand-teal/[0.06] border-brand-teal/25"
          data-briefing-migration-disclosure
        >
          <p className="text-sm mb-1 text-teal-300">
            Your saved dashboard preferences shaped this Briefing.
          </p>
          <p className="text-xs text-slate-400">
            Tile choices with a Briefing counterpart were carried over.
            {props.droppedTileLabels && props.droppedTileLabels.length > 0 ? (
              <>
                {" "}Analytical tiles without one were not:{" "}
                {props.droppedTileLabels.join(", ")}. Every analytical tile now
                lives on the{" "}
                <Link href="/posture" className="font-medium text-brand-teal">
                  Posture dashboard
                </Link>
                ; framework readiness detail is on{" "}
                <Link href="/frameworks" className="font-medium text-brand-teal">
                  Frameworks
                </Link>
                .
              </>
            ) : null}
            {" "}Saving a layout in Customize makes this arrangement yours.
          </p>
        </div>
      )}

      {sections}

      {/* Dashboards keep answering "how is the organization performing?" — the
          Briefing links to them rather than reproducing them here. */}
      <div className="flex items-center gap-4 text-xs" data-briefing-dashboards>
        <span className="font-semibold uppercase tracking-wide text-slate-500">
          Dashboards
        </span>
        <Link href="/posture" className="font-medium text-brand-teal">
          Security Posture →
        </Link>
        <Link href="/frameworks" className="font-medium text-brand-teal">
          Framework Readiness →
        </Link>
      </div>
    </div>
  );
}

/**
 * The render map: module id → module body. Returns null when the module's
 * data-presence rule hides it (e.g. no pending reviews assigned) — eligibility
 * (entitlement / identity / flags) was already resolved server-side upstream.
 */
function renderModule(
  def: BriefingModuleDef,
  props: TheBriefingProps,
): React.ReactNode | null {
  const { vm } = props;

  switch (def.id) {
    case "whats_changed": {
      const m = vm.whatsChanged;
      if (!m) return null; // first visit — no delta to show

      const sinceLabel = new Date(m.since).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });

      if (!m.loaded) {
        return (
          <ModuleCard def={def}>
            <p className="text-sm text-red-300">
              Couldn&apos;t load what changed since your last visit ({sinceLabel})
              — that does not mean nothing happened. Refresh to try again.
            </p>
          </ModuleCard>
        );
      }

      if (m.allQuiet) {
        return (
          <ModuleCard def={def}>
            <p className="text-sm text-green-300">
              Quiet since your last visit ({sinceLabel}) — no new findings, no
              new overdue work, no decisions waiting on this window.
            </p>
          </ModuleCard>
        );
      }

      // Only the new-findings NUMBER is a link — created_from reproduces that
      // population (date-granular). Transition counts have no event-filtered
      // list to land on, so they read as sentences with labeled destinations.
      const sinceDate = m.since.slice(0, 10);
      return (
        <ModuleCard def={def}>
          <p className="text-xs mb-3 text-slate-500">
            Since {sinceLabel}
            {m.clamped ? " (showing the last 90 days)" : ""}
          </p>
          <div className="space-y-2">
            {m.newActiveFindings > 0 && (
              <Link
                href={`/findings?queue=all&created_from=${sinceDate}`}
                className="flex items-baseline justify-between group rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
              >
                <span className="text-sm group-hover:text-slate-200 transition-colors text-red-300">
                  New active findings
                  {m.newCriticalHigh > 0 ? (
                    <span className="ml-2 text-xs font-semibold text-red-400">
                      {m.newCriticalHigh} Critical/High
                    </span>
                  ) : null}
                </span>
                <span className="text-xl font-bold tabular-nums text-slate-100">
                  {m.newActiveFindings}
                </span>
              </Link>
            )}
            {m.newlyOverdueActions > 0 && (
              <p className="text-sm text-orange-300">
                {m.newlyOverdueActions} action{m.newlyOverdueActions !== 1 ? "s" : ""} became overdue{" "}
                <Link href="/actions?overdue=true&view=team" className="font-medium text-brand-teal">
                  View overdue →
                </Link>
              </p>
            )}
            {m.remediationCompleted > 0 && (
              <p className="text-sm text-violet-300">
                {m.remediationCompleted} finding{m.remediationCompleted !== 1 ? "s" : ""} completed remediation
                — your decision{" "}
                <Link href="/findings?bucket=ready_to_close" className="font-medium text-brand-teal">
                  Review ready to close →
                </Link>
              </p>
            )}
            {m.resolved > 0 && (
              <p className="text-sm text-green-300">
                {m.resolved} finding{m.resolved !== 1 ? "s" : ""} closed — posture improved.
              </p>
            )}
            {m.briefsPublished > 0 && (
              <p className="text-sm text-blue-300">
                New Intelligence Brief published{" "}
                <Link href="/briefs" className="font-medium text-brand-teal">
                  Read it →
                </Link>
              </p>
            )}
          </div>
        </ModuleCard>
      );
    }

    case "my_work": {
      const m = vm.myWork;
      const unknown = m.findingsOpen === null && m.actionsOpen === null;
      return (
        <ModuleCard def={def}>
          {unknown ? (
            <p className="text-sm text-slate-400">
              Could not load your assigned work right now.
            </p>
          ) : m.allClear ? (
            props.hasPlatformData ? (
              <p className="text-sm text-green-300">
                You&apos;re clear — nothing assigned to you needs attention.
              </p>
            ) : (
              <p className="text-sm text-slate-400">
                Nothing assigned to you yet. Work you own appears here once your
                organization starts assessing.
              </p>
            )
          ) : (
            <div className="space-y-2">
              <Link href={def.destination} className="flex items-baseline justify-between group rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal">
                <span className="text-sm text-slate-400 group-hover:text-slate-200 transition-colors">
                  Findings you own
                </span>
                <span className="text-xl font-bold tabular-nums text-slate-100">
                  {m.findingsOpen ?? "—"}
                </span>
              </Link>
              <Link href="/actions?view=mine" className="flex items-baseline justify-between group rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal">
                <span className="text-sm text-slate-400 group-hover:text-slate-200 transition-colors">
                  Actions assigned to you
                  {m.actionsOverdue !== null && m.actionsOverdue > 0 ? (
                    <span className="ml-2 text-xs font-semibold text-red-400">
                      {m.actionsOverdue} overdue
                    </span>
                  ) : null}
                </span>
                <span className="text-xl font-bold tabular-nums text-slate-100">
                  {m.actionsOpen ?? "—"}
                </span>
              </Link>
            </div>
          )}
          {/* EX1 PR-2 — NEXT UP: the user's highest-priority owned items,
              ranked deterministically (overdue → urgency → due date). Answers
              "what should I do first?" instead of only "how many?". Hidden
              when the lists were not fetched (null) or are empty; a FAILED
              source gets an explicit notice — never a silent-empty list. */}
          {(m.topItemsFindingsFailed || m.topItemsActionsFailed) && (
            <p className="mt-3 text-xs text-red-300">
              {m.topItemsFindingsFailed && m.topItemsActionsFailed
                ? "Couldn't load your assigned work items right now — the counts above may be more current."
                : m.topItemsFindingsFailed
                  ? "Couldn't load your assigned findings right now."
                  : "Couldn't load your assigned actions right now."}
            </p>
          )}
          {m.topItems && m.topItems.length > 0 && (
            <div className="mt-4 pt-3 border-t border-brand-line">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
                Next up
              </p>
              <ul className="space-y-2">
                {m.topItems.map((item) => (
                  <li key={`${item.kind}-${item.id}`}>
                    <Link
                      href={item.href}
                      className="flex items-baseline justify-between gap-3 group rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
                    >
                      <span className="text-sm text-slate-300 group-hover:text-slate-100 transition-colors truncate">
                        <span
                          className={`mr-2 text-xs font-semibold ${
                            item.urgencyRank === 0
                              ? "text-red-300"
                              : item.urgencyRank === 1
                                ? "text-orange-300"
                                : "text-slate-400"
                          }`}
                        >
                          {item.urgency}
                        </span>
                        {item.title}
                      </span>
                      <span
                        className={`text-xs shrink-0 tabular-nums ${
                          item.overdue
                            ? "font-semibold text-red-400"
                            : "text-slate-500"
                        }`}
                      >
                        {item.overdue
                          ? "Overdue"
                          : item.dueDate
                            ? `Due ${new Date(item.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                            : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ModuleCard>
      );
    }

    case "my_pending_reviews": {
      const m = vm.myPendingReviews;
      if (!m) return null;
      return (
        <ModuleCard def={def}>
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              Assigned to you to validate and close
              {m.orgWide > m.mine
                ? ` · ${m.orgWide} organization-wide ready to close`
                : ""}
            </p>
            <span className="text-2xl font-bold tabular-nums text-violet-300">
              {m.mine}
            </span>
          </div>
        </ModuleCard>
      );
    }

    case "needs_attention": {
      const m = vm.needsAttention;
      const clear = m.critical === 0 && m.high === 0;
      return (
        <ModuleCard def={def}>
          {clear ? (
            props.hasPlatformData ? (
              <p className="text-sm text-green-300">
                No Critical or High active findings.
              </p>
            ) : (
              <p className="text-sm text-slate-400">
                Nothing assessed yet — findings appear here once assessments run
                or intelligence matches your inventory.{" "}
                <Link href="/getting-started" className="font-medium text-brand-teal">
                  Start setup →
                </Link>
              </p>
            )
          ) : (
            <div className="space-y-2">
              <Link
                href="/findings?severity=Critical&active=true"
                className="flex items-baseline justify-between group rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
              >
                <span className="text-sm group-hover:text-slate-200 transition-colors text-red-300">
                  Critical findings
                </span>
                <span className="text-xl font-bold tabular-nums text-slate-100">{m.critical}</span>
              </Link>
              <Link
                href="/findings?severity=High&active=true"
                className="flex items-baseline justify-between group rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
              >
                <span className="text-sm group-hover:text-slate-200 transition-colors text-orange-300">
                  High findings
                </span>
                <span className="text-xl font-bold tabular-nums text-slate-100">{m.high}</span>
              </Link>
            </div>
          )}
        </ModuleCard>
      );
    }

    case "overdue_actions": {
      const m = vm.overdueActions;
      return (
        <ModuleCard def={def}>
          <div className="space-y-2">
            <Link
              href="/actions?overdue=true&view=team"
              className="flex items-baseline justify-between group rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
            >
              <span
                className={`text-sm group-hover:text-slate-200 transition-colors ${m.overdue > 0 ? "text-red-400" : "text-slate-400"}`}
              >
                Overdue
              </span>
              <span className="text-xl font-bold tabular-nums text-slate-100">{m.overdue}</span>
            </Link>
            <Link href={def.destination} className="flex items-baseline justify-between group rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal">
              <span className="text-sm text-slate-400 group-hover:text-slate-200 transition-colors">
                Active organization-wide
              </span>
              <span className="text-xl font-bold tabular-nums text-slate-100">{m.active}</span>
            </Link>
          </div>
        </ModuleCard>
      );
    }

    case "ready_to_close": {
      const m = vm.readyToClose;
      if (!m) return null;
      return (
        <ModuleCard def={def}>
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">
              Remediation complete, governance decision pending
            </p>
            <span className="text-2xl font-bold tabular-nums text-violet-300">
              {m.orgWide}
            </span>
          </div>
        </ModuleCard>
      );
    }

    case "posture_score": {
      const m = vm.postureScore;
      const d = m.driver;
      return (
        <ModuleCard def={def}>
          {m.score === null ? (
            <p className="text-sm text-slate-400">
              Insufficient data — no posture snapshot yet.
            </p>
          ) : (
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-bold tabular-nums text-slate-100">{m.score}</span>
              {m.severity ? (
                <span className="text-xs font-semibold text-slate-400">
                  {m.severity}
                </span>
              ) : null}
              {/* "Are we improving?" on the opening screen (EG2 slice 12) —
                  rendered only when an honest 30-day baseline exists. */}
              {m.delta30 && (
                <span
                  className={`text-xs font-semibold ${m.delta30.points >= 0 ? "text-green-300" : "text-red-300"}`}
                >
                  {formatPostureDelta(m.delta30)} · 30d
                </span>
              )}
              {m.asOf ? (
                <span className="text-xs text-slate-500">
                  as of {m.asOf}
                </span>
              ) : null}
            </div>
          )}
          {/* EX1 PR-3 — PRIMARY DRIVER: WHY the score is what it is, from the
              canonical computation itself (overall = weighted blend of the
              worst domains), never a narrative. Facts (scores, counts, dates)
              render as data with provenance; the single recommendation line is
              explicitly labeled as one. Hidden when the summary carries no
              scored domain breakdown — a score without its parts gets no
              guessed explanation. */}
          {d && (
            <div className="mt-4 pt-3 border-t border-brand-line" data-posture-driver>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
                Primary driver
              </p>
              {d.stale && (
                <p className="text-xs text-amber-300 mb-2">
                  Snapshot not refreshed since {m.asOf} — this breakdown may be
                  out of date.
                </p>
              )}
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-slate-200">
                  {d.primary.domain}
                  {d.primary.severity ? (
                    <span
                      className={`ml-2 text-xs font-semibold ${
                        d.primary.severity === "Critical"
                          ? "text-red-300"
                          : d.primary.severity === "High"
                            ? "text-orange-300"
                            : "text-slate-400"
                      }`}
                    >
                      {d.primary.severity}
                    </span>
                  ) : null}
                </span>
                <span className="text-sm font-bold tabular-nums text-slate-100">
                  {d.primary.score}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {d.scoredDomainCount > 1
                  ? `Weakest of ${d.scoredDomainCount} scored domains — the posture score weights its worst domains most heavily.`
                  : "The only scored domain — it sets the posture score."}
              </p>
              {d.primary.signalDriven ? (
                <p className="text-xs text-slate-400 mt-2">
                  No active findings are recorded in this domain — its score
                  reflects risk and inventory signals.{" "}
                  <Link href={d.primary.href} className="font-medium text-brand-teal">
                    View posture detail →
                  </Link>
                </p>
              ) : (
                <p className="text-xs text-slate-400 mt-2">
                  Recommended focus: remediating the{" "}
                  <Link href={d.primary.href} className="font-medium text-brand-teal">
                    {d.primary.findingCount} active finding
                    {d.primary.findingCount !== 1 ? "s" : ""} in{" "}
                    {d.primary.domain} →
                  </Link>{" "}
                  is the largest single lever on this score.
                </p>
              )}
              {d.supporting.length > 0 && (
                <p className="text-xs text-slate-500 mt-2">
                  Also weighing on posture:{" "}
                  {d.supporting.map((s, i) => (
                    <span key={s.domain}>
                      {i > 0 ? " · " : ""}
                      <Link
                        href={s.href}
                        className="text-slate-400 hover:text-slate-200 transition-colors rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
                      >
                        {s.domain} ({s.score})
                      </Link>
                    </span>
                  ))}
                </p>
              )}
            </div>
          )}
        </ModuleCard>
      );
    }

    case "recent_findings":
      return (
        <RecentFindings
          findings={props.recentFindings}
          summaryActiveCount={props.summaryActiveFindings}
        />
      );

    case "latest_brief":
      return (
        <div data-briefing-module="latest_brief">
          {props.latestBrief ? (
            <IntelligenceBriefDashboardCard brief={props.latestBrief} />
          ) : props.latestIssue ? (
            <BriefCard issue={props.latestIssue} viewerIsPlatform showStaleWarning />
          ) : (
            <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
              <p className="text-slate-400 text-sm">
                No Intelligence Briefs have been published for your
                organization yet. New briefs appear here as your intelligence
                pipeline produces them.
              </p>
            </div>
          )}
          {props.issuesCount > 1 && (
            <div className="mt-4">
              <Link
                href="/briefs"
                className="text-brand-teal hover:text-teal-300 text-sm font-medium transition-colors"
              >
                View all {props.issuesCount} briefs →
              </Link>
            </div>
          )}
        </div>
      );
  }
}
