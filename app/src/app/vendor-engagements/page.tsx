import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { vendorAssuranceEnabled } from "@/lib/vendorAssuranceFeatureFlag";
import { isPlatformEntitled } from "@/lib/entitlements";
import {
  listVendorEngagements,
  ENGAGEMENT_SORTS,
  type VendorEngagementListRow,
  type AttentionReason,
  type EngagementSort,
} from "@/lib/api";
import {
  ENGAGEMENT_STATES,
  ENGAGEMENT_STATE_LABELS,
  isEngagementState,
  isReviewOverdue,
  bandColors,
  analysisCoverageCopy,
  ATTENTION_REASON_CHIPS,
  ATTENTION_REASON_LABELS,
  ATTENTION_TONE_COLORS,
  DISPOSITION_LABELS,
  ENGAGEMENT_SORT_LABELS,
  attentionTone,
} from "@/lib/vendorEngagements";

/**
 * /vendor-engagements — the reviewer's queue over the Vendor Assurance
 * engagement spine. The engine orders by highest residual (then inherent), so
 * the vendor that matters is on top, not the one that arrived last. Rows carry
 * the monitoring sweeps' signals: review_overdue and
 * reassessment_recommended_at.
 *
 * WA-4 adds the triage half: a DERIVED "needs attention" state with the
 * canonical reasons behind it, a whitelisted sort, and the latest human
 * disposition. Every control is a query parameter and every link carries the
 * whole current query forward, so filtering then sorting then paging does not
 * silently drop what you already chose.
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

/**
 * Build a link that KEEPS the rest of the query.
 *
 * The alternative — each control linking to only its own parameter — quietly
 * discards the others, so choosing a sort throws away the filter the analyst
 * just set. Passing `undefined` clears one key; everything else survives.
 */
function withQuery(
  current: Record<string, string | undefined>,
  changes: Record<string, string | undefined>
): string {
  const merged: Record<string, string | undefined> = { ...current, ...changes };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v !== undefined && v !== "") params.set(k, v);
  }
  const qs = params.toString();
  return `/vendor-engagements${qs ? `?${qs}` : ""}`;
}

function Chip({
  label,
  tone,
  title,
}: {
  label: string;
  tone: "high" | "medium" | "low";
  title?: string;
}) {
  const c = ATTENTION_TONE_COLORS[tone];
  return (
    <span
      title={title}
      style={{
        padding: "1px 8px",
        borderRadius: 999,
        fontSize: 11,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.border}`,
        whiteSpace: "nowrap",
        alignSelf: "flex-start",
      }}
    >
      {label}
    </span>
  );
}

/**
 * The reasons, in the engine's order, with counts.
 *
 * Deliberately NOT a bare red badge: ruling E is that an analyst must be able
 * to see WHY without opening the engagement. The count is on the chip because
 * "3 not in place" and "1 not in place" are different queue items.
 */
function AttentionChips({ reasons, counts }: { reasons: AttentionReason[]; counts: Record<AttentionReason, number> }) {
  if (reasons.length === 0) {
    return <span style={{ color: "#4b5563", fontSize: 12 }}>Nothing outstanding</span>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {reasons.map((r) => (
        <Chip
          key={r}
          tone={attentionTone(r)}
          label={counts[r] > 1 ? `${counts[r]} · ${ATTENTION_REASON_CHIPS[r]}` : ATTENTION_REASON_CHIPS[r]}
          title={ATTENTION_REASON_LABELS[r]}
        />
      ))}
    </div>
  );
}

const PAGE_SIZE = 50;

export default async function VendorEngagementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  // VA-NAV-1 activation gate — precedes session and entitlement on purpose:
  // a disabled capability answers notFound() to everyone, never the
  // entitlement redirect, so a probe cannot tell "off" from "not yours".
  // Same key and resolver as the engine, which 404s the API independently.
  if (!vendorAssuranceEnabled()) notFound();
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  if (!isPlatformEntitled(session.entitlementLevel)) redirect("/dashboard");

  const sp = await searchParams;
  const statusFilter = isEngagementState(sp.status) ? sp.status : undefined;
  const attentionOnly = sp.needs_attention === "true";
  const undisposedOnly = sp.undisposed === "true";
  const offset = Math.max(Number(sp.offset ?? 0) || 0, 0);

  const data = await listVendorEngagements(token, {
    ...(statusFilter !== undefined ? { status: statusFilter } : {}),
    ...(sp.sort !== undefined ? { sort: sp.sort } : {}),
    ...(sp.order !== undefined ? { order: sp.order } : {}),
    ...(attentionOnly ? { needsAttention: true } : {}),
    ...(undisposedOnly ? { undisposed: true } : {}),
    limit: PAGE_SIZE,
    offset,
  });
  const engagements: VendorEngagementListRow[] = data?.engagements ?? [];

  // The ENGINE's answer, not what we think we asked for — an unknown sort falls
  // back server-side, and the controls must reflect what actually happened.
  //
  // `query` is optional-chained, not just `data`: during a staged deploy the app
  // can be newer than the engine, and an engine that predates WA-4 answers this
  // list without a `query` block at all. Reading through it unguarded turns that
  // ordinary version skew into a crashed page for every analyst.
  const activeSort: EngagementSort = data?.query?.sort ?? "risk";
  const activeOrder: "asc" | "desc" = data?.query?.order ?? "desc";
  const hasMore = data?.has_more ?? false;

  // Carried onto every control link so one choice never discards another.
  const q: Record<string, string | undefined> = {
    ...(statusFilter !== undefined ? { status: statusFilter } : {}),
    sort: activeSort,
    order: activeOrder,
    ...(attentionOnly ? { needs_attention: "true" } : {}),
    ...(undisposedOnly ? { undisposed: "true" } : {}),
  };
  const attentionCount = engagements.filter((e) => e.attention?.needs_attention).length;

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
              href={withQuery(q, { status: active ? undefined : s, offset: undefined })}
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
            href={withQuery(q, { status: undefined, offset: undefined })}
            style={{ padding: "5px 11px", color: "#9ca3af", fontSize: 12 }}
          >
            Clear state
          </Link>
        )}
      </section>

      {/* WA-4 — triage controls. Needs Attention is DERIVED, so this filters on
          the assessment's actual state rather than on a flag somebody set. */}
      <section
        style={{
          marginBottom: 16,
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
          paddingBottom: 14,
          borderBottom: "1px solid #1f2937",
        }}
      >
        <Link
          href={withQuery(q, { needs_attention: attentionOnly ? undefined : "true", offset: undefined })}
          style={{
            padding: "5px 11px",
            borderRadius: 999,
            border: `1px solid ${attentionOnly ? "#b91c1c" : "#374151"}`,
            background: attentionOnly ? "rgba(127,29,29,0.25)" : "transparent",
            color: attentionOnly ? "#fca5a5" : "#9ca3af",
            textDecoration: "none",
            fontSize: 12,
          }}
        >
          Needs attention{!attentionOnly && attentionCount > 0 ? ` · ${attentionCount} on this page` : ""}
        </Link>

        <Link
          href={withQuery(q, { undisposed: undisposedOnly ? undefined : "true", offset: undefined })}
          style={{
            padding: "5px 11px",
            borderRadius: 999,
            border: `1px solid ${undisposedOnly ? "#2563eb" : "#374151"}`,
            background: undisposedOnly ? "rgba(37,99,235,0.2)" : "transparent",
            color: undisposedOnly ? "#93c5fd" : "#9ca3af",
            textDecoration: "none",
            fontSize: 12,
          }}
        >
          Not yet dispositioned
        </Link>

        <span style={{ color: "#4b5563", fontSize: 12, marginLeft: 4 }}>Sort</span>
        {ENGAGEMENT_SORTS.map((srt) => {
          const active = activeSort === srt;
          // Clicking the active sort flips its direction; clicking another
          // switches to it and lets the engine choose that sort's natural one.
          const changes: Record<string, string | undefined> = active
            ? { sort: srt, order: activeOrder === "desc" ? "asc" : "desc", offset: undefined }
            : { sort: srt, order: undefined, offset: undefined };
          return (
            <Link
              key={srt}
              href={withQuery(q, changes)}
              style={{
                padding: "5px 11px",
                borderRadius: 6,
                border: "1px solid #374151",
                background: active ? "rgba(59,130,246,0.2)" : "transparent",
                color: active ? "#93c5fd" : "#9ca3af",
                textDecoration: "none",
                fontSize: 12,
              }}
            >
              {ENGAGEMENT_SORT_LABELS[srt] ?? srt}
              {active ? (activeOrder === "desc" ? " ↓" : " ↑") : ""}
            </Link>
          );
        })}
      </section>

      {engagements.length === 0 && (
        <div style={{ padding: 24, border: "1px dashed #374151", borderRadius: 8, color: "#9ca3af" }}>
          {attentionOnly
            ? "Nothing is waiting on an analyst. Clear the filter to see the rest of the portfolio."
            : undisposedOnly
              ? "Every engagement here has a recorded disposition."
              : statusFilter !== undefined
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
              <th style={{ padding: "8px 12px" }}>Needs attention</th>
              <th style={{ padding: "8px 12px" }}>Disposition</th>
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
                    <AttentionChips
                      reasons={e.attention?.reasons ?? []}
                      counts={e.attention?.counts ?? ({} as Record<AttentionReason, number>)}
                    />
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    {e.disposition ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ color: "#d1d5db", fontSize: 12 }}>
                          {DISPOSITION_LABELS[e.disposition.disposition] ?? e.disposition.disposition}
                        </span>
                        <span style={{ color: "#6b7280", fontSize: 11 }}>
                          {e.disposition.disposed_by ?? "—"} · {fmtDate(e.disposition.disposed_at)}
                        </span>
                        {/* The decision is kept and flagged, never discarded. */}
                        {e.disposition.stale && (
                          <Chip
                            tone="medium"
                            label="Assessment moved since"
                            title="This decision was recorded against an earlier state of the assessment. It still stands; record a new one if it no longer holds."
                          />
                        )}
                      </div>
                    ) : e.attention?.needs_attention ? (
                      <span style={{ color: "#9ca3af", fontSize: 12 }}>Awaiting review</span>
                    ) : (
                      <span style={{ color: "#4b5563", fontSize: 12 }}>—</span>
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

      {(offset > 0 || hasMore) && (
        <nav style={{ marginTop: 16, display: "flex", gap: 12, alignItems: "center", fontSize: 13 }}>
          {offset > 0 ? (
            <Link
              href={withQuery(q, { offset: offset - PAGE_SIZE > 0 ? String(offset - PAGE_SIZE) : undefined })}
              style={{ color: "#93c5fd" }}
            >
              ← Previous
            </Link>
          ) : (
            <span style={{ color: "#4b5563" }}>← Previous</span>
          )}
          <span style={{ color: "#6b7280" }}>
            {offset + 1}–{offset + engagements.length}
          </span>
          {hasMore ? (
            <Link href={withQuery(q, { offset: String(offset + PAGE_SIZE) })} style={{ color: "#93c5fd" }}>
              Next →
            </Link>
          ) : (
            <span style={{ color: "#4b5563" }}>Next →</span>
          )}
        </nav>
      )}

      <p style={{ marginTop: 20, color: "#6b7280", fontSize: 12, maxWidth: 760 }}>
        Needs Attention is derived from the assessment itself and is not a flag anyone sets or clears.
        It is triage: no response state creates a finding on its own, and promoting one to the findings
        and remediation lifecycle stays an explicit action on the engagement.
      </p>
    </main>
  );
}
