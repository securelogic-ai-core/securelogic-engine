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
import {
  OPS_GROUP_LABELS,
  bucketsInGroup,
  bucketHref,
  dueWorkCount,
  type OpsBucketDef,
  type OpsBucketId,
  type OpsBucketGroup,
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
        placeholder="Search by vendor, AI system, control, or obligation — e.g. Microsoft"
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
}: {
  group: OpsBucketGroup;
  counts: Record<OpsBucketId, number>;
  unknown: OpsBucketId[];
}) {
  const buckets = bucketsInGroup(group);
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
  bucket,
  bucketFindings,
  bucketTotal,
  entityQuery,
  entityResult,
}: {
  mode: "home" | "bucket" | "entity";
  counts: Record<OpsBucketId, number>;
  unknownCounts: OpsBucketId[];
  bucket?: OpsBucketDef;
  bucketFindings?: Finding[];
  bucketTotal?: number;
  entityQuery?: string;
  entityResult?: EntityFindingsResponse | null;
}) {
  if (mode === "bucket" && bucket) {
    const members = bucketFindings ?? [];
    const total = bucketTotal ?? members.length;
    return (
      <>
        <div className="mb-6">
          <Link href="/findings" className="text-sm font-medium" style={{ color: "#00c4b4" }}>
            ← Operations center
          </Link>
        </div>
        <div className="mb-6">
          <h2 className="text-lg font-bold" style={{ color: "#f1f5f9" }}>
            {bucket.label}
            <span className="ml-2 text-sm font-normal" style={{ color: "#64748b" }}>
              {total} in queue{members.length < total ? ` · showing ${members.length}` : ""}
            </span>
          </h2>
          <p className="text-sm" style={{ color: "#94a3b8" }}>{bucket.ask}</p>
        </div>
        {members.length === 0 ? (
          <div className="rounded-xl border p-10 text-center" style={{ ...CARD, borderColor: "rgba(34,197,94,0.2)" }}>
            <p className="text-sm font-semibold" style={{ color: "#86efac" }}>
              Queue clear — nothing waiting here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {members.map((f) => (
              <FindingCard key={f.id} finding={f} revalidateUrl={`/findings?bucket=${bucket.id}`} workspace />
            ))}
          </div>
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
            ← Operations center
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
                  <FindingCard key={f.id} finding={f} revalidateUrl={`/findings?entity=${encodeURIComponent(res.query)}`} workspace />
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
      <div className="mb-6">
        <EntitySearchForm />
      </div>

      {due === 0 && unknownCounts.length === 0 && (
        <div className="rounded-xl border p-6 text-center mb-8" style={{ ...CARD, borderColor: "rgba(34,197,94,0.2)" }}>
          <p className="text-sm font-semibold mb-1" style={{ color: "#86efac" }}>
            All clear — no decision work is due right now.
          </p>
          <p className="text-xs" style={{ color: "#64748b" }}>
            New intelligence, assessments, and reviews land here as work when they affect your organization.
          </p>
        </div>
      )}

      <BucketGroup group="decisions" counts={counts} unknown={unknownCounts} />
      <BucketGroup group="domains" counts={counts} unknown={unknownCounts} />
      <BucketGroup group="tracking" counts={counts} unknown={unknownCounts} />

      <div className="text-center">
        <Link href="/findings?queue=all" className="text-sm font-medium" style={{ color: "#64748b" }}>
          Browse all findings →
        </Link>
      </div>
    </>
  );
}
