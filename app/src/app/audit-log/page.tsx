import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getAuditLog, getAuditLogEventTypes } from "@/lib/api";
import AuditLogTable from "./AuditLogTable";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    event_type?: string;
    date_from?: string;
    date_to?: string;
  }>;
}) {
  const session = await getSession();

  if (!session.jwtToken) redirect("/login");
  if (session.userRole !== "admin") redirect("/dashboard");

  const sp         = await searchParams;
  const page       = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const event_type = sp.event_type || undefined;
  const date_from  = sp.date_from  || undefined;
  const date_to    = sp.date_to    || undefined;

  const [auditData, eventTypes] = await Promise.all([
    getAuditLog(session.jwtToken, { page, limit: 50, event_type, date_from, date_to }),
    getAuditLogEventTypes(session.jwtToken),
  ]);

  const events      = auditData?.events      ?? [];
  const total       = auditData?.total       ?? 0;
  const totalPages  = auditData?.total_pages ?? 1;
  const hasFilters  = !!(event_type || date_from || date_to);

  const exportParams = new URLSearchParams();
  if (event_type) exportParams.set("event_type", event_type);
  if (date_from)  exportParams.set("date_from",  date_from);
  if (date_to)    exportParams.set("date_to",    date_to);
  const exportHref = `/api/export/audit-log${exportParams.toString() ? `?${exportParams.toString()}` : ""}`;

  const from = total === 0 ? 0 : (page - 1) * 50 + 1;
  const to   = Math.min(page * 50, total);

  return (
    <div className="max-w-7xl mx-auto px-6 py-10" style={{ color: "#f1f5f9" }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: "#f1f5f9" }}>
            Audit Log
          </h1>
          <p className="text-sm" style={{ color: "#94a3b8" }}>
            Security and activity events for your organization.
          </p>
        </div>
        <a
          href={exportHref}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors hover:opacity-80"
          style={{ background: "#0d1626", border: "1px solid #1e2d45", color: "#94a3b8" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Export CSV
        </a>
      </div>

      {/* Filter bar */}
      <form action="/audit-log" method="GET" className="flex flex-wrap items-end gap-3 mb-6">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>
            Event Type
          </label>
          <select
            name="event_type"
            defaultValue={event_type ?? ""}
            className="rounded-lg px-3 py-2 text-sm border outline-none"
            style={{ background: "#0d1626", borderColor: "#1e2d45", color: "#f1f5f9", minWidth: "200px" }}
          >
            <option value="" style={{ background: "#0d1626" }}>All events</option>
            {(eventTypes ?? []).map((et) => (
              <option key={et} value={et} style={{ background: "#0d1626" }}>
                {et}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>
            From
          </label>
          <input
            type="date"
            name="date_from"
            defaultValue={date_from ?? ""}
            className="rounded-lg px-3 py-2 text-sm border outline-none"
            style={{ background: "#0d1626", borderColor: "#1e2d45", color: "#f1f5f9" }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#64748b" }}>
            To
          </label>
          <input
            type="date"
            name="date_to"
            defaultValue={date_to ?? ""}
            className="rounded-lg px-3 py-2 text-sm border outline-none"
            style={{ background: "#0d1626", borderColor: "#1e2d45", color: "#f1f5f9" }}
          />
        </div>

        <button
          type="submit"
          className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          style={{ background: "#00c4b4", color: "#0a0f1a" }}
        >
          Filter
        </button>

        {hasFilters && (
          <Link
            href="/audit-log"
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ color: "#64748b" }}
          >
            Clear
          </Link>
        )}
      </form>

      {/* Table */}
      {events.length === 0 ? (
        <div
          className="rounded-xl p-16 text-center"
          style={{ background: "#0d1626", border: "1px solid #1e2d45" }}
        >
          <p className="text-base font-medium mb-1" style={{ color: "#94a3b8" }}>
            No audit events found.
          </p>
          {hasFilters && (
            <p className="text-sm" style={{ color: "#475569" }}>
              Try adjusting your filters.
            </p>
          )}
        </div>
      ) : (
        <AuditLogTable events={events} />
      )}

      {/* Pagination */}
      {total > 0 && (
        <div className="mt-6 flex items-center justify-between gap-4">
          <p className="text-sm" style={{ color: "#64748b" }}>
            Showing {from}–{to} of {total.toLocaleString()} events
          </p>
          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Link
                href={buildPageHref(page - 1, event_type, date_from, date_to)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
                style={{ background: "#0d1626", border: "1px solid #1e2d45", color: "#94a3b8" }}
              >
                ← Previous
              </Link>
            ) : (
              <span className="px-3 py-1.5 rounded-lg text-sm opacity-30" style={{ color: "#64748b" }}>
                ← Previous
              </span>
            )}
            <span className="text-sm px-3" style={{ color: "#64748b" }}>
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? (
              <Link
                href={buildPageHref(page + 1, event_type, date_from, date_to)}
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
                style={{ background: "#0d1626", border: "1px solid #1e2d45", color: "#94a3b8" }}
              >
                Next →
              </Link>
            ) : (
              <span className="px-3 py-1.5 rounded-lg text-sm opacity-30" style={{ color: "#64748b" }}>
                Next →
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function buildPageHref(
  page: number,
  event_type?: string,
  date_from?: string,
  date_to?: string
): string {
  const p = new URLSearchParams();
  p.set("page", String(page));
  if (event_type) p.set("event_type", event_type);
  if (date_from)  p.set("date_from",  date_from);
  if (date_to)    p.set("date_to",    date_to);
  return `/audit-log?${p.toString()}`;
}
