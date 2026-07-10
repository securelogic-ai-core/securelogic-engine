/**
 * WorkFirstFindings.tsx — the work-first Findings surface (ERIP). Presentational
 * server component; all logic lives in the pure workQueues.ts helpers.
 *
 * Interaction model: work completion, not record discovery. The default (home)
 * view is organized around operational queues and decision buckets — Overdue SLA,
 * Unassigned, Needs decision, High & Critical, In mitigation, Accepted risk —
 * plus entity search ("findings for Microsoft") and a short "Next up" list.
 * Individual findings are supporting objects reached by drilling into a queue,
 * a search, or the Decision Workspace. Rendered ONLY under
 * SECURELOGIC_RISK_WORKSPACE_ENABLED; flag-off keeps the legacy list page.
 */

import Link from "next/link";
import type { Finding, EntityFindingsResponse } from "@/lib/api";
import { FindingCard } from "@/components/FindingCard";
import {
  WORK_QUEUES,
  openWorkCount,
  type WorkQueueId,
  type WorkQueueDef,
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

function QueueCard({ def, count }: { def: WorkQueueDef; count: number }) {
  const hot = def.urgent && count > 0;
  return (
    <Link
      href={`/findings?queue=${def.id}`}
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
        <span className="text-2xl font-bold" style={{ color: hot ? "#fca5a5" : count > 0 ? "#f1f5f9" : "#334155" }}>
          {count}
        </span>
      </div>
      <p className="text-xs" style={{ color: "#64748b" }}>
        {def.ask}
      </p>
      <p className="text-xs mt-2 font-medium" style={{ color: count > 0 ? "#00c4b4" : "#334155" }}>
        {count > 0 ? "Work the queue →" : "Clear"}
      </p>
    </Link>
  );
}

export default function WorkFirstFindings({
  mode,
  counts,
  next,
  queue,
  queueFindings,
  entityQuery,
  entityResult,
}: {
  mode: "home" | "queue" | "entity";
  counts: Record<Exclude<WorkQueueId, "all">, number>;
  next: Finding[];
  queue?: WorkQueueDef;
  queueFindings?: Finding[];
  entityQuery?: string;
  entityResult?: EntityFindingsResponse | null;
}) {
  if (mode === "queue" && queue) {
    const members = queueFindings ?? [];
    return (
      <>
        <div className="mb-6">
          <Link href="/findings" className="text-sm font-medium" style={{ color: "#00c4b4" }}>
            ← Work queues
          </Link>
        </div>
        <div className="mb-6">
          <h2 className="text-lg font-bold" style={{ color: "#f1f5f9" }}>
            {queue.label}
            <span className="ml-2 text-sm font-normal" style={{ color: "#64748b" }}>
              {members.length} shown
            </span>
          </h2>
          <p className="text-sm" style={{ color: "#94a3b8" }}>{queue.ask}</p>
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
              <FindingCard key={f.id} finding={f} revalidateUrl={`/findings?queue=${queue.id}`} workspace />
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
            ← Work queues
          </Link>
          <EntitySearchForm initial={entityQuery} />
        </div>
        {!res ? (
          <div className="rounded-xl border p-10 text-center" style={CARD}>
            <p className="text-sm" style={{ color: "#94a3b8" }}>
              Entity search isn&apos;t available right now. Use the work queues, or try again shortly.
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

  // HOME — work queues + entity search + next up. No scrolling record list.
  const totalWork = openWorkCount(counts);
  return (
    <>
      <div className="mb-6">
        <EntitySearchForm />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {WORK_QUEUES.map((q) => (
          <QueueCard key={q.id} def={q} count={counts[q.id as Exclude<WorkQueueId, "all">]} />
        ))}
      </div>

      {totalWork === 0 ? (
        <div className="rounded-xl border p-10 text-center mb-8" style={{ ...CARD, borderColor: "rgba(34,197,94,0.2)" }}>
          <p className="text-sm font-semibold mb-1" style={{ color: "#86efac" }}>
            All clear — no findings need a decision right now.
          </p>
          <p className="text-xs" style={{ color: "#64748b" }}>
            New intelligence, assessments, and reviews land here as work when they affect your organization.
          </p>
        </div>
      ) : (
        next.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
                Next up
              </h2>
              <span className="text-xs" style={{ color: "#475569" }}>
                most urgent first
              </span>
            </div>
            <div className="space-y-3">
              {next.map((f) => (
                <FindingCard key={f.id} finding={f} revalidateUrl="/findings" workspace />
              ))}
            </div>
          </section>
        )
      )}

      <div className="text-center">
        <Link href="/findings?queue=all" className="text-sm font-medium" style={{ color: "#64748b" }}>
          Browse all findings →
        </Link>
      </div>
    </>
  );
}
