import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { isPlatformEntitled } from "@/lib/entitlements";
import { listVendorEngagements, type VendorEngagementListRow } from "@/lib/api";
import {
  ENGAGEMENT_STATES,
  ENGAGEMENT_STATE_LABELS,
  isEngagementState,
  isReviewOverdue,
  bandColors,
  analysisCoverageCopy,
} from "@/lib/vendorEngagements";

/**
 * /vendor-engagements — the reviewer's queue over the Vendor Assurance
 * engagement spine. The engine orders by highest residual (then inherent), so
 * the vendor that matters is on top, not the one that arrived last. Rows carry
 * the monitoring sweeps' signals: review_overdue and
 * reassessment_recommended_at.
 */

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function BandChip({ band, score }: { band: string | null; score?: number | null }) {
  if (!band) return <span style={{ color: "#6b7280" }}>—</span>;
  const c = bandColors(band);
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 12,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.border}`,
        whiteSpace: "nowrap",
      }}
    >
      {band}
      {typeof score === "number" ? ` · ${score}` : ""}
    </span>
  );
}

function StateChip({ status }: { status: string }) {
  const label = isEngagementState(status) ? ENGAGEMENT_STATE_LABELS[status] : status;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 12,
        background: "rgba(31,41,55,0.7)",
        color: "#d1d5db",
        border: "1px solid #374151",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

export default async function VendorEngagementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  if (!isPlatformEntitled(session.entitlementLevel)) redirect("/dashboard");

  const sp = await searchParams;
  const statusFilter = isEngagementState(sp.status) ? sp.status : undefined;

  const data = await listVendorEngagements(token, {
    ...(statusFilter !== undefined ? { status: statusFilter } : {}),
    limit: 100,
  });
  const engagements: VendorEngagementListRow[] = data?.engagements ?? [];

  return (
    <main style={{ padding: "32px", maxWidth: 1280, margin: "0 auto", color: "#e5e7eb" }}>
      <header
        style={{
          marginBottom: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>Vendor Engagements</h1>
          <p style={{ color: "#9ca3af", marginTop: 8, maxWidth: 720 }}>
            Assurance engagements across your vendors — inherent risk from intake, a
            tier-scoped questionnaire issued through the vendor portal, reviewed responses,
            residual risk, decision, and continuous monitoring. Ordered by highest risk first.
          </p>
        </div>
        <Link
          href="/vendor-engagements/new"
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            background: "#2563eb",
            color: "#fff",
            textDecoration: "none",
            fontSize: 14,
            whiteSpace: "nowrap",
          }}
        >
          New engagement
        </Link>
      </header>

      <section style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {ENGAGEMENT_STATES.map((s) => {
          const active = statusFilter === s;
          return (
            <Link
              key={s}
              href={`/vendor-engagements?status=${encodeURIComponent(s)}`}
              style={{
                padding: "5px 11px",
                borderRadius: 999,
                border: "1px solid #374151",
                background: active ? "rgba(59,130,246,0.2)" : "transparent",
                color: active ? "#93c5fd" : "#9ca3af",
                textDecoration: "none",
                fontSize: 12,
              }}
            >
              {ENGAGEMENT_STATE_LABELS[s]}
            </Link>
          );
        })}
        {statusFilter !== undefined && (
          <Link
            href="/vendor-engagements"
            style={{ padding: "5px 11px", color: "#9ca3af", fontSize: 12 }}
          >
            Clear filter
          </Link>
        )}
      </section>

      {engagements.length === 0 && (
        <div style={{ padding: 24, border: "1px dashed #374151", borderRadius: 8, color: "#9ca3af" }}>
          {statusFilter !== undefined
            ? "No engagements in this state."
            : "No vendor engagements yet. Open one to compute inherent risk from a structured intake and issue a tier-scoped questionnaire to the vendor."}
        </div>
      )}

      {engagements.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #374151" }}>
              <th style={{ padding: "8px 12px" }}>Engagement</th>
              <th style={{ padding: "8px 12px" }}>Vendor</th>
              <th style={{ padding: "8px 12px" }}>State</th>
              <th style={{ padding: "8px 12px" }}>Tier</th>
              <th style={{ padding: "8px 12px" }}>Inherent</th>
              <th style={{ padding: "8px 12px" }}>Residual</th>
              <th style={{ padding: "8px 12px" }}>Next review</th>
              <th style={{ padding: "8px 12px" }}>Signals</th>
              <th style={{ padding: "8px 12px" }}></th>
            </tr>
          </thead>
          <tbody>
            {engagements.map((e) => {
              const overdue = e.review_overdue || isReviewOverdue(e.next_review_due);
              const coverage = e.analysis_coverage
                ? analysisCoverageCopy(e.analysis_coverage)
                : null;
              return (
                <tr key={e.id} style={{ borderBottom: "1px solid #1f2937" }}>
                  <td style={{ padding: "10px 12px" }}>
                    <Link
                      href={`/vendor-engagements/${e.id}`}
                      style={{ color: "#e5e7eb", textDecoration: "none" }}
                    >
                      {e.title ?? `${e.vendor_name} assurance review`}
                    </Link>
                    <div style={{ color: "#6b7280", fontSize: 12, marginTop: 2 }}>
                      {e.engagement_type} · opened {fmtDate(e.created_at)}
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <Link href={`/vendors/${e.vendor_id}`} style={{ color: "#93c5fd" }}>
                      {e.vendor_name}
                    </Link>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <StateChip status={e.status} />
                  </td>
                  <td style={{ padding: "10px 12px", color: "#9ca3af" }}>
                    {e.assessment_tier ?? "—"}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <BandChip band={e.inherent_rating} score={e.inherent_score} />
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <BandChip band={e.residual_rating} score={e.residual_score} />
                  </td>
                  <td style={{ padding: "10px 12px", color: overdue ? "#fca5a5" : "#9ca3af" }}>
                    {fmtDate(e.next_review_due)}
                    {overdue && (
                      <span
                        style={{
                          marginLeft: 8,
                          padding: "1px 8px",
                          borderRadius: 999,
                          fontSize: 11,
                          background: "rgba(127,29,29,0.25)",
                          color: "#fca5a5",
                          border: "1px solid #b91c1c",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Review overdue
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {e.reassessment_recommended_at && (
                        <span
                          style={{
                            padding: "1px 8px",
                            borderRadius: 999,
                            fontSize: 11,
                            background: "rgba(161,98,7,0.2)",
                            color: "#fcd34d",
                            border: "1px solid #a16207",
                            whiteSpace: "nowrap",
                            alignSelf: "flex-start",
                          }}
                          title={`Reassessment recommended ${fmtDate(e.reassessment_recommended_at)}`}
                        >
                          Reassessment recommended
                        </span>
                      )}
                      {coverage && coverage.tone === "warn" && (
                        <span
                          style={{
                            padding: "1px 8px",
                            borderRadius: 999,
                            fontSize: 11,
                            background: "rgba(161,98,7,0.2)",
                            color: "#fcd34d",
                            border: "1px solid #a16207",
                            whiteSpace: "nowrap",
                            alignSelf: "flex-start",
                          }}
                          title={coverage.detail}
                        >
                          {coverage.label}
                        </span>
                      )}
                      {!e.reassessment_recommended_at && (!coverage || coverage.tone === "ok") && (
                        <span style={{ color: "#4b5563", fontSize: 12 }}>—</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <Link href={`/vendor-engagements/${e.id}`} style={{ color: "#93c5fd" }}>
                      Open →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
