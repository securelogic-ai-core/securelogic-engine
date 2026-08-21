"use client";

/**
 * AffectedAssetsPanel.tsx — where a vulnerability meets the estate.
 *
 * THE COUNTS ARE THE POINT. "Affected assets: 17 · Active: 12 · No longer
 * observed: 5" is the sentence this whole package exists to make true, and it is
 * the one an executive reads. So the counts come from a server-side grouped
 * aggregate over every occurrence, NOT from the page of rows below them —
 * counting the visible page would quietly report 25 for a finding on 4,000
 * hosts, and it would look right.
 *
 * "NO ASSET RECORDED" IS A STATE, NOT MISSING DATA. A vulnerability with no
 * occurrence is a legitimate, permanently supported record — an advisory nobody
 * has mapped to hardware yet is still worth tracking. It is shown as a fact
 * about the record rather than as an error or an empty table, for the same
 * reason RiskRegisterPanel shows "standalone" rather than nagging.
 *
 * ACTIVE ≠ AFFECTED, AND "NO LONGER OBSERVED" ≠ FIXED. The numbers are
 * deliberately given different words. One is something a scan stopped seeing,
 * the other is something a person fixed, and collapsing them is how a
 * vulnerability product starts overstating its own effectiveness.
 */

import Link from "next/link";

import type { FindingOccurrence, OccurrenceRollup } from "@/lib/api";

const PRESENCE_LABEL: Record<string, string> = {
  present: "Active",
  absent: "No longer observed",
  remediated: "Remediated",
};

const PRESENCE_COLOR: Record<string, string> = {
  present: "#fca5a5",
  absent: "#94a3b8",
  remediated: "#86efac",
};

function fmt(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="text-2xl font-bold" style={{ color }}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide" style={{ color: "#64748b" }}>
        {label}
      </div>
    </div>
  );
}

export function AffectedAssetsPanel({
  findingId,
  occurrences,
  rollup,
  limit,
  offset,
}: {
  findingId: string;
  occurrences: FindingOccurrence[];
  rollup: OccurrenceRollup;
  limit: number;
  offset: number;
}) {
  const hasMore = rollup.affected > offset + occurrences.length;
  const pageHref = (o: number) =>
    `/findings/${findingId}?occ_offset=${Math.max(0, o)}#affected-assets`;

  return (
    <section
      id="affected-assets"
      className="bg-brand-surface border border-brand-line rounded-xl p-5"
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#94a3b8" }}>
            Affected assets
          </h2>
          {rollup.affected === 0 ? (
            <p className="text-xs mt-1" style={{ color: "#64748b" }}>
              No asset recorded for this vulnerability. That is a valid state — an
              advisory can be tracked before anyone has mapped it to hardware.
            </p>
          ) : (
            <p className="text-xs mt-1" style={{ color: "#64748b" }}>
              Where this vulnerability has been observed across your estate.
            </p>
          )}
        </div>
      </div>

      {rollup.affected > 0 && (
        <>
          <div className="flex flex-wrap gap-6 mb-4">
            <Stat label="Affected assets" value={rollup.affected} color="#e2e8f0" />
            <Stat label="Active" value={rollup.active} color="#fca5a5" />
            <Stat label="No longer observed" value={rollup.absent} color="#94a3b8" />
            <Stat label="Remediated" value={rollup.remediated} color="#86efac" />
            {rollup.recurring > 0 && (
              <Stat label="Recurring" value={rollup.recurring} color="#fcd34d" />
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  {["Asset", "Type", "Presence", "First seen", "Last seen", "Recurrence"].map((h) => (
                    <th key={h} className="text-left py-2 pr-4 font-semibold" style={{ color: "#475569" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {occurrences.map((o) => (
                  <tr key={o.id} className="border-t border-brand-line">
                    <td className="py-2 pr-4" style={{ color: "#cbd5e1" }}>
                      <Link href={`/assets/${o.asset_id}`} className="hover:underline" style={{ color: "#cbd5e1" }}>
                        {o.asset_id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="py-2 pr-4" style={{ color: "#94a3b8" }}>{o.asset_type ?? "—"}</td>
                    <td className="py-2 pr-4 font-semibold" style={{ color: PRESENCE_COLOR[o.presence_status] ?? "#94a3b8" }}>
                      {PRESENCE_LABEL[o.presence_status] ?? o.presence_status}
                    </td>
                    <td className="py-2 pr-4" style={{ color: "#94a3b8" }}>{fmt(o.first_seen_at)}</td>
                    <td className="py-2 pr-4" style={{ color: "#94a3b8" }}>{fmt(o.last_seen_at)}</td>
                    <td className="py-2 pr-4" style={{ color: "#94a3b8" }}>
                      {o.reappeared_count > 0 ? `Returned ${o.reappeared_count}×` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(offset > 0 || hasMore) && (
            <div className="flex items-center gap-3 mt-4">
              {offset > 0 && (
                <Link href={pageHref(offset - limit)} className="text-xs hover:underline" style={{ color: "#94a3b8" }}>
                  ← Previous
                </Link>
              )}
              <span className="text-xs" style={{ color: "#64748b" }}>
                {offset + 1}–{offset + occurrences.length} of {rollup.affected}
              </span>
              {hasMore && (
                <Link href={pageHref(offset + limit)} className="text-xs hover:underline" style={{ color: "#94a3b8" }}>
                  Next →
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
