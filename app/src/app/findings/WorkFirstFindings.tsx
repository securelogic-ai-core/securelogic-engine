/**
 * WorkFirstFindings.tsx — the Findings OPERATIONS CENTER (ERIP). Presentational
 * server component; all logic lives in the pure workQueues.ts helpers.
 *
 * Interaction model: customers MANAGE WORK, not browse records. The landing view
 * renders NO finding rows — it organizes work into decision buckets (Needs
 * Assignment, SLA Breached, Needs Decision, Awaiting Approval, Review Suggested
 * Links) and risk domains (Active Exploitation, Regulatory Impact, AI Risk,
 * Third-Party Risk) plus tracking buckets. Clicking a bucket opens a SUBORDINATE,
 * SERVER-FILTERED findings view (or the surface owning that work: /approvals,
 * /queue) — correct at 20,000 findings because counts and filters are engine-side.
 * Rendered ONLY under SECURELOGIC_RISK_WORKSPACE_ENABLED; flag-off = legacy page.
 */

import Link from "next/link";
import type { Finding, EntityFindingsResponse } from "@/lib/api";
import { FindingCard } from "@/components/FindingCard";
import BulkBucketList from "./BulkBucketList";
import { FindingsQueueToolbar } from "./FindingsQueueToolbar";
import { FindingsSummaryBar } from "./FindingsSummaryBar";
import {
  buildPager,
  clearAllFilters,
  hasActiveFilters,
  queueHref,
  type QueueState,
  type PinnableFilterKey,
} from "./queueControls";
import {
  OPS_GROUP_LABELS,
  bucketsInGroup,
  bucketHref,
  dueWorkCount,
  type OpsBucketDef,
  type OpsBucketId,
  type OpsBucketGroup,
  type SummaryItem,
} from "./workQueues";

const CARD: React.CSSProperties = {
  background: "var(--color-brand-surface, #111827)",
  border: "1px solid #1e293b",
  borderRadius: 12,
  padding: "16px 20px",
};

const ENTITY_ROUTE: Record<string, string> = {
  vendor: "/vendors",
  ai_system: "/ai-systems",
  control: "/controls",
  obligation: "/obligations",
};
const ENTITY_LABEL: Record<string, string> = {
  vendor: "Vendor",
  ai_system: "AI System",
  control: "Control",
  obligation: "Obligation",
};

function EntitySearchForm({ initial }: { initial?: string }) {
  return (
    <form action="/findings" method="get" className="flex items-center gap-2 w-full max-w-xl">
      <input
        type="search"
        name="entity"
        defaultValue={initial ?? ""}
        placeholder="Search by vendor, AI system, control, obligation, or product alias — e.g. Microsoft"
        className="flex-1 px-3 py-2 rounded-lg text-sm"
        style={{ background: "#0b1220", border: "1px solid #1e293b", color: "#e2e8f0" }}
      />
      <button
        type="submit"
        className="px-4 py-2 rounded-lg text-sm font-medium"
        style={{ background: "rgba(0,196,180,0.15)", color: "#00c4b4", border: "1px solid rgba(0,196,180,0.4)" }}
      >
        Search
      </button>
    </form>
  );
}

const AXIS_TAG_STYLE: Record<string, React.CSSProperties> = {
  Governance: { background: "rgba(139,92,246,0.15)", color: "#c4b5fd" },
  Operational: { background: "rgba(59,130,246,0.15)", color: "#93c5fd" },
};

function BucketCard({ def, count, unknown }: { def: OpsBucketDef; count: number; unknown: boolean }) {
  const hot = def.urgent && count > 0;
  return (
    <Link
      href={bucketHref(def)}
      className="block rounded-xl border p-5 transition-colors"
      style={{
        background: "var(--color-brand-surface, #111827)",
        borderColor: hot ? "rgba(239,68,68,0.35)" : "#1e293b",
      }}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
          {def.label}
        </span>
        <span
          className="text-2xl font-bold"
          style={{ color: unknown ? "#334155" : hot ? "#fca5a5" : count > 0 ? "#f1f5f9" : "#334155" }}
        >
          {unknown ? "—" : count}
        </span>
      </div>
      <p className="text-xs" style={{ color: "#64748b" }}>
        {def.ask}
      </p>
      {def.axisTag && (
        <span
          className="inline-block mt-2 text-[10px] font-medium px-1.5 py-0.5 rounded"
          style={AXIS_TAG_STYLE[def.axisTag]}
        >
          {def.axisTag === "Governance" ? "Governance record" : "Operational tracking"}
        </span>
      )}
      <p className="text-xs mt-2 font-medium" style={{ color: !unknown && count > 0 ? "#00c4b4" : "#334155" }}>
        {unknown ? "Open →" : count > 0 ? "Work the queue →" : "Clear"}
      </p>
    </Link>
  );
}

function BucketGroup({
  group,
  counts,
  unknown,
  independentReview = false,
}: {
  group: OpsBucketGroup;
  counts: Record<OpsBucketId, number>;
  unknown: OpsBucketId[];
  /** Surfaces the rollout-gated reviewer bucket in the decisions group. */
  independentReview?: boolean;
}) {
  const buckets = bucketsInGroup(group, { independentReview });
  return (
    <section className="mb-8">
      <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#94a3b8" }}>
        {OPS_GROUP_LABELS[group]}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {buckets.map((b) => (
          <BucketCard key={b.id} def={b} count={counts[b.id] ?? 0} unknown={unknown.includes(b.id)} />
        ))}
      </div>
    </section>
  );
}

export default function WorkFirstFindings({
  mode,
  counts,
  unknownCounts,
  hasAnyFindings = null,
  independentReview = false,
  summaryItems,
  generatedAt,
  ownerNames,
  bucket,
  bucketFindings,
  bucketPage,
  bucketQueue,
  entityQuery,
  entityResult,
}: {
  mode: "home" | "bucket" | "entity";
  counts: Record<OpsBucketId, number>;
  unknownCounts: OpsBucketId[];
  /**
   * Whether ANY finding (active or closed) has ever existed for this org.
   * false = fresh, unassessed org — the zero-due state must read as "nothing
   * measured yet", never as a green "All clear". null/undefined = unknown
   * (older engine summary) — keep the legacy all-clear rendering.
   */
  hasAnyFindings?: boolean | null;
  /** SECURELOGIC_INDEPENDENT_REVIEW_ENABLED — surfaces the reviewer queue bucket. */
  independentReview?: boolean;
  summaryItems?: SummaryItem[];
  generatedAt?: string;
  ownerNames?: Record<string, string>;
  bucket?: OpsBucketDef;
  bucketFindings?: Finding[];
  bucketPage?: {
    total: number;
    range: { start: number; end: number };
    hrefs: { nextHref: string | null; prevHref: string | null };
  };
  /**
   * Queue-controls state for this bucket view (SECURELOGIC_FINDINGS_QUEUE_CONTROLS_ENABLED):
   * the shared toolbar refines the bucket server-side. Absent = legacy keyset view.
   */
  bucketQueue?: {
    state: QueueState;
    pinned: PinnableFilterKey[];
    total: number;
    count: number;
  };
  entityQuery?: string;
  entityResult?: EntityFindingsResponse | null;
}) {
  // Bucket view WITH the shared queue controls: same toolbar, same query model as
  // /findings?queue=all — the bucket definition is the implicit, never-clearable
  // filter; search/filter/sort/page refine WITHIN it and live in the URL.
  if (mode === "bucket" && bucket && bucketQueue) {
    const members = bucketFindings ?? [];
    const { state, pinned, total, count } = bucketQueue;
    const filtered = hasActiveFilters(state);
    const pager = buildPager(state, total, { bucket: bucket.id });
    return (
      <>
        <div className="mb-6">
          <Link href="/findings" className="text-sm font-medium" style={{ color: "#00c4b4" }}>
            ← Operations Workspace
          </Link>
        </div>
        <div className="mb-4">
          <h2 className="text-lg font-bold" style={{ color: "#f1f5f9" }}>
            {bucket.label}
          </h2>
          <p className="text-sm" style={{ color: "#94a3b8" }}>{bucket.ask}</p>
        </div>
        <FindingsQueueToolbar
          state={state}
          total={total}
          count={count}
          bucketId={bucket.id}
          hiddenFilters={pinned}
        />
        {members.length === 0 ? (
          <div
            className="rounded-xl border p-10 text-center"
            style={{ ...CARD, borderColor: filtered ? "#1e293b" : "rgba(34,197,94,0.2)" }}
          >
            {filtered ? (
              <>
                {/* An empty FILTERED queue is not a clear queue — say which, and
                    offer the way back (bucket preserved; only user filters clear). */}
                <p className="text-sm mb-3" style={{ color: "#94a3b8" }}>
                  No findings in {bucket.label} match your search and filters.
                </p>
                <Link
                  href={queueHref(clearAllFilters(state), { bucket: bucket.id })}
                  className="text-xs font-medium"
                  style={{ color: "#00c4b4" }}
                >
                  Clear all
                </Link>
              </>
            ) : bucket.id === "my_work" ? (
              <>
                <p className="text-sm font-semibold mb-1" style={{ color: "#86efac" }}>
                  Nothing is assigned to you right now.
                </p>
                <p className="text-xs mb-4" style={{ color: "#64748b" }}>
                  Pick up work from the queues — assign a finding to yourself from its Decision Workspace.
                </p>
                <Link href="/findings" className="text-sm font-medium" style={{ color: "#00c4b4" }}>
                  Go to the Operations Workspace →
                </Link>
              </>
            ) : (
              <p className="text-sm font-semibold" style={{ color: "#86efac" }}>
                Queue clear — nothing waiting here.
              </p>
            )}
          </div>
        ) : (
          <>
            <BulkBucketList
              findings={members}
              revalidateUrl={`/findings?bucket=${bucket.id}`}
              ownerNames={ownerNames}
              bucketId={bucket.id}
              showDueStatus
            />
            {/* Offset pager — URL carries bucket + page + all filter state, so Back
                restores the exact queue and new-tab links carry provenance. */}
            <div className="flex items-center justify-between mt-6">
              {pager.prevHref ? (
                <Link href={pager.prevHref} className="text-sm font-medium" style={{ color: "#00c4b4" }}>
                  ← Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-xs" style={{ color: "#64748b" }}>
                Page {pager.page} of {pager.pages}
              </span>
              {pager.nextHref ? (
                <Link href={pager.nextHref} className="text-sm font-medium" style={{ color: "#00c4b4" }}>
                  Next →
                </Link>
              ) : (
                <span />
              )}
            </div>
          </>
        )}
      </>
    );
  }

  if (mode === "bucket" && bucket) {
    const members = bucketFindings ?? [];
    const total = bucketPage?.total ?? members.length;
    const range = bucketPage?.range ?? { start: members.length > 0 ? 1 : 0, end: members.length };
    const hrefs = bucketPage?.hrefs ?? { nextHref: null, prevHref: null };
    return (
      <>
        <div className="mb-6">
          <Link href="/findings" className="text-sm font-medium" style={{ color: "#00c4b4" }}>
            ← Operations Workspace
          </Link>
        </div>
        <div className="mb-6">
          <h2 className="text-lg font-bold" style={{ color: "#f1f5f9" }}>
            {bucket.label}
            <span className="ml-2 text-sm font-normal" style={{ color: "#64748b" }}>
              {members.length === 0
                ? `${total} in queue`
                : `showing ${range.start}–${range.end} of ${total}`}
            </span>
          </h2>
          <p className="text-sm" style={{ color: "#94a3b8" }}>{bucket.ask}</p>
        </div>
        {members.length === 0 ? (
          <div className="rounded-xl border p-10 text-center" style={{ ...CARD, borderColor: "rgba(34,197,94,0.2)" }}>
            {bucket.id === "my_work" ? (
              <>
                <p className="text-sm font-semibold mb-1" style={{ color: "#86efac" }}>
                  Nothing is assigned to you right now.
                </p>
                <p className="text-xs mb-4" style={{ color: "#64748b" }}>
                  Pick up work from the queues — assign a finding to yourself from its Decision Workspace.
                </p>
                <Link href="/findings" className="text-sm font-medium" style={{ color: "#00c4b4" }}>
                  Go to the Operations Workspace →
                </Link>
              </>
            ) : hrefs.prevHref !== null ? (
              <>
                <p className="text-sm font-semibold mb-2" style={{ color: "#94a3b8" }}>
                  No more items on this page.
                </p>
                <Link href={hrefs.prevHref} className="text-sm font-medium" style={{ color: "#00c4b4" }}>
                  ← Back a page
                </Link>
              </>
            ) : (
              <p className="text-sm font-semibold" style={{ color: "#86efac" }}>
                Queue clear — nothing waiting here.
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Selection + bulk actions (W2): assign/decide the visible page in
                one call — each decision individually guarded engine-side. */}
            <BulkBucketList
              findings={members}
              revalidateUrl={`/findings?bucket=${bucket.id}`}
              ownerNames={ownerNames}
              bucketId={bucket.id}
            />
            {(hrefs.prevHref !== null || hrefs.nextHref !== null) && (
              <div className="flex items-center justify-between gap-4">
                {hrefs.prevHref ? (
                  <Link href={hrefs.prevHref} className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ border: "1px solid #1e293b", color: "#94a3b8" }}>
                    ← Previous
                  </Link>
                ) : (
                  <span className="px-3 py-1.5 rounded-lg text-sm" style={{ border: "1px solid #131c2e", color: "#334155" }}>
                    ← Previous
                  </span>
                )}
                <span className="text-xs" style={{ color: "#475569" }}>
                  {range.start}–{range.end} of {total}
                </span>
                {hrefs.nextHref ? (
                  <Link href={hrefs.nextHref} className="px-3 py-1.5 rounded-lg text-sm font-medium" style={{ border: "1px solid #1e293b", color: "#94a3b8" }}>
                    Next →
                  </Link>
                ) : (
                  <span className="px-3 py-1.5 rounded-lg text-sm" style={{ border: "1px solid #131c2e", color: "#334155" }}>
                    Next →
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </>
    );
  }

  if (mode === "entity") {
    const res = entityResult ?? null;
    return (
      <>
        <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
          <Link href="/findings" className="text-sm font-medium" style={{ color: "#00c4b4" }}>
            ← Operations Workspace
          </Link>
          <EntitySearchForm initial={entityQuery} />
        </div>
        {!res ? (
          <div className="rounded-xl border p-10 text-center" style={CARD}>
            <p className="text-sm" style={{ color: "#94a3b8" }}>
              Entity search isn&apos;t available right now. Use the work buckets, or try again shortly.
            </p>
          </div>
        ) : res.entities.length === 0 ? (
          <div className="rounded-xl border p-10 text-center" style={CARD}>
            <p className="text-sm mb-1 font-semibold" style={{ color: "#f1f5f9" }}>
              No vendors, AI systems, controls, or obligations match “{res.query}”.
            </p>
            <p className="text-xs" style={{ color: "#64748b" }}>
              Search matches the names of entities you monitor — add the entity first, then intelligence and
              assessments connect findings to it.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <h2 className="text-lg font-bold mb-2" style={{ color: "#f1f5f9" }}>
                Findings for “{res.query}”
                <span className="ml-2 text-sm font-normal" style={{ color: "#64748b" }}>
                  {res.count} finding{res.count === 1 ? "" : "s"}
                </span>
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                {res.entities.map((e) => (
                  <Link
                    key={`${e.type}:${e.id}`}
                    href={`${ENTITY_ROUTE[e.type] ?? "/findings"}/${e.id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
                    style={{ border: "1px solid #1e293b", color: "#94a3b8" }}
                  >
                    <span style={{ color: "#64748b" }}>{ENTITY_LABEL[e.type] ?? e.type}</span>
                    {e.name}
                  </Link>
                ))}
              </div>
            </div>
            {res.findings.length === 0 ? (
              <div className="rounded-xl border p-10 text-center" style={{ ...CARD, borderColor: "rgba(34,197,94,0.2)" }}>
                <p className="text-sm font-semibold" style={{ color: "#86efac" }}>
                  No findings connected to {res.entities.length === 1 ? res.entities[0]!.name : "these entities"} — no open exposure on record.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {res.findings.map((f) => (
                  <FindingCard
                    key={f.id}
                    finding={f}
                    revalidateUrl={`/findings?entity=${encodeURIComponent(res.query)}`}
                    workspace
                    ownerName={f.owner_user_id ? ownerNames?.[f.owner_user_id] ?? null : null}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </>
    );
  }

  // HOME — the operations center. Decision buckets + risk domains + tracking +
  // entity search. NO finding rows: work is managed from here, records live one
  // click down in the subordinate views and the Decision Workspace.
  const due = dueWorkCount(counts);
  return (
    <>
      {summaryItems && summaryItems.length > 0 && (
        <FindingsSummaryBar items={summaryItems} generatedAt={generatedAt} />
      )}

      <div className="mb-6">
        <EntitySearchForm />
      </div>

      {due === 0 && unknownCounts.length === 0 && (
        hasAnyFindings === false ? (
          // Fresh org: zero due work because nothing has been measured yet.
          // Green reassurance here would misread as attested posture.
          <div className="rounded-xl border p-6 text-center mb-8" style={{ ...CARD, borderColor: "#1e293b" }}>
            <p className="text-sm font-semibold mb-1" style={{ color: "#94a3b8" }}>
              Nothing assessed yet — no findings are on record for your organization.
            </p>
            <p className="text-xs" style={{ color: "#64748b" }}>
              Work appears here once assessments run or intelligence matches your inventory.{" "}
              <Link href="/getting-started" className="font-medium" style={{ color: "#00c4b4" }}>
                Start setup →
              </Link>
            </p>
          </div>
        ) : (
          <div className="rounded-xl border p-6 text-center mb-8" style={{ ...CARD, borderColor: "rgba(34,197,94,0.2)" }}>
            <p className="text-sm font-semibold mb-1" style={{ color: "#86efac" }}>
              All clear — no decision work is due right now.
            </p>
            <p className="text-xs" style={{ color: "#64748b" }}>
              New intelligence, assessments, and reviews land here as work when they affect your organization.
            </p>
          </div>
        )
      )}

      <BucketGroup group="decisions" counts={counts} unknown={unknownCounts} independentReview={independentReview} />
      <BucketGroup group="domains" counts={counts} unknown={unknownCounts} />
      <BucketGroup group="tracking" counts={counts} unknown={unknownCounts} />

      <div className="text-center">
        <Link href="/findings?queue=all" className="text-sm font-medium" style={{ color: "#64748b" }}>
          Search the full inventory in Finding Explorer →
        </Link>
      </div>
    </>
  );
}
