import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { vendorAssuranceEnabled } from "@/lib/vendorAssuranceFeatureFlag";
import { isPlatformEntitled } from "@/lib/entitlements";
import {
  getVendorEngagement,
  getVendorEngagementResponses,
  listVendorEngagementEvidence,
  listVendorEngagementComments,
  type VendorEngagementDetail,
  type VendorEngagementQuestionnaire,
  VENDOR_ASSESSMENT_DOMAINS,
  VENDOR_ASSESSMENT_DOMAIN_LABELS,
  type VendorEngagementEvidenceRow,
  type VendorEngagementComment,
} from "@/lib/api";
import {
  ENGAGEMENT_STATE_LABELS,
  isEngagementState,
  isReviewOverdue,
  bandColors,
  analysisCoverageCopy,
  type EngagementState,
} from "@/lib/vendorEngagements";
import EngagementActionPanel from "@/components/vendorEngagements/EngagementActionPanel";
import EvidenceSection from "@/components/vendorEngagements/EvidenceSection";
import ResponsesSection from "@/components/vendorEngagements/ResponsesSection";
import CommentsSection from "@/components/vendorEngagements/CommentsSection";

/**
 * /vendor-engagements/[id] — the reviewer's workspace for one engagement.
 *
 * The engine's state machine is the single authority on what can happen next;
 * this page offers only the actions it would allow and explains every locked
 * one. The coverage badge renders through analysisCoverageCopy so
 * `deterministic_only` can never masquerade as a clean pass.
 */

const DECISION_LABELS: Record<string, string> = {
  approved: "Approved",
  approved_with_conditions: "Approved with conditions",
  rejected: "Rejected",
  terminated: "Terminated",
};

function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function BandChip({
  label,
  band,
  score,
}: {
  label: string;
  band: string | null;
  score?: number | null;
}) {
  const c = bandColors(band);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </span>
      <span
        style={{
          display: "inline-block",
          padding: "3px 12px",
          borderRadius: 999,
          fontSize: 13,
          background: c.bg,
          color: c.fg,
          border: `1px solid ${c.border}`,
          whiteSpace: "nowrap",
        }}
      >
        {band ?? "Not computed"}
        {band && typeof score === "number" ? ` · ${score}` : ""}
      </span>
    </div>
  );
}

export default async function VendorEngagementPage({
  params,
}: {
  params: Promise<{ id: string }>;
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

  const { id } = await params;

  const [detail, evidenceResp, commentsResp, responsesResp] = await Promise.all([
    getVendorEngagement(token, id) as Promise<{
      engagement: VendorEngagementDetail;
      questionnaire: VendorEngagementQuestionnaire;
    } | null>,
    listVendorEngagementEvidence(token, id) as Promise<{
      evidence: VendorEngagementEvidenceRow[];
      count: number;
    } | null>,
    listVendorEngagementComments(token, id) as Promise<{
      comments: VendorEngagementComment[];
      count: number;
    } | null>,
    getVendorEngagementResponses(token, id),
  ]);

  if (!detail) {
    return (
      <main style={{ padding: 32, maxWidth: 1100, margin: "0 auto", color: "#e5e7eb" }}>
        <Link href="/vendor-engagements" style={{ color: "#93c5fd", fontSize: 13 }}>
          ← Vendor engagements
        </Link>
        <div style={{ padding: 24, marginTop: 16, border: "1px dashed #374151", borderRadius: 8, color: "#9ca3af" }}>
          Engagement not found (or Vendor Assurance is not enabled for this environment).
        </div>
      </main>
    );
  }

  const e = detail.engagement;
  const q = detail.questionnaire;
  const state: EngagementState = isEngagementState(e.status) ? e.status : "draft";
  const stateLabel = isEngagementState(e.status) ? ENGAGEMENT_STATE_LABELS[e.status] : e.status;
  const coverage = e.analysis_coverage ? analysisCoverageCopy(e.analysis_coverage) : null;
  const overdue = state === "monitoring" && isReviewOverdue(e.next_review_due);
  const evidence = evidenceResp?.evidence ?? [];
  const comments = commentsResp?.comments ?? [];

  return (
    <main style={{ padding: 32, maxWidth: 1100, margin: "0 auto", color: "#e5e7eb" }}>
      <Link href="/vendor-engagements" style={{ color: "#93c5fd", fontSize: 13 }}>
        ← Vendor engagements
      </Link>

      <header style={{ margin: "12px 0 24px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 26, fontWeight: 600, margin: 0 }}>
            {e.title ?? `${e.vendor_name} assurance review`}
          </h1>
          <span
            style={{
              padding: "3px 12px",
              borderRadius: 999,
              fontSize: 13,
              background: "rgba(37,99,235,0.15)",
              color: "#93c5fd",
              border: "1px solid rgba(37,99,235,0.4)",
              whiteSpace: "nowrap",
            }}
          >
            {stateLabel}
          </span>
        </div>
        <p style={{ color: "#9ca3af", marginTop: 6, fontSize: 14 }}>
          <Link href={`/vendors/${e.vendor_id}`} style={{ color: "#93c5fd" }}>
            {e.vendor_name}
          </Link>{" "}
          · {e.engagement_type} engagement · tier {e.assessment_tier ?? "—"} · opened{" "}
          {fmtDate(e.created_at)} · methodology {e.methodology_version}
        </p>

        <div style={{ display: "flex", gap: 24, marginTop: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <BandChip label="Inherent" band={e.inherent_rating} score={e.inherent_score} />
          <BandChip label="Residual" band={e.residual_rating} score={e.residual_score} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Effectiveness
            </span>
            <span style={{ fontSize: 13, color: "#d1d5db", padding: "3px 0" }}>
              {typeof e.effectiveness_score === "number" ? e.effectiveness_score : "Not computed"}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Questionnaire
            </span>
            <span style={{ fontSize: 13, color: "#d1d5db", padding: "3px 0" }}>
              {q.scoped === 0
                ? "Not scoped"
                : `${q.answered}/${q.scoped} answered · ${q.mandatory} mandatory`}
            </span>
            {q.domains ? (
              <span style={{ fontSize: 12, color: "#9ca3af" }} title="Questions by assessment domain (VA-Q2)">
                {VENDOR_ASSESSMENT_DOMAINS.filter((d) => q.domains![d] > 0)
                  .map((d) => `${VENDOR_ASSESSMENT_DOMAIN_LABELS[d]} ${q.domains![d]}`)
                  .join(" · ")}
              </span>
            ) : null}
          </div>
          {coverage && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Analysis coverage
              </span>
              <span
                title={coverage.detail}
                style={{
                  display: "inline-block",
                  padding: "3px 12px",
                  borderRadius: 999,
                  fontSize: 13,
                  whiteSpace: "nowrap",
                  background: coverage.tone === "ok" ? "rgba(22,101,52,0.2)" : "rgba(161,98,7,0.2)",
                  color: coverage.tone === "ok" ? "#86efac" : "#fcd34d",
                  border: `1px solid ${coverage.tone === "ok" ? "#166534" : "#a16207"}`,
                }}
              >
                {coverage.tone === "warn" ? "⚠ " : ""}
                {coverage.label}
              </span>
            </div>
          )}
        </div>

        {coverage && coverage.tone === "warn" && (
          <div
            style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: 6,
              background: "rgba(161,98,7,0.12)",
              border: "1px solid #a16207",
              color: "#fcd34d",
              fontSize: 13,
            }}
          >
            {coverage.detail}
          </div>
        )}

        {e.inherent_override_rationale && (
          <div style={{ marginTop: 12, color: "#9ca3af", fontSize: 13 }}>
            Inherent rating overridden by a reviewer
            {e.inherent_overridden_at ? ` on ${fmtDate(e.inherent_overridden_at)}` : ""}:{" "}
            <span style={{ color: "#d1d5db" }}>{e.inherent_override_rationale}</span>
            {e.inherent_arithmetic_rating && e.inherent_arithmetic_rating !== e.inherent_rating && (
              <> (calculated band: {e.inherent_arithmetic_rating})</>
            )}
          </div>
        )}

        {e.reassessment_recommended_at && (
          <div
            style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: 6,
              background: "rgba(161,98,7,0.12)",
              border: "1px solid #a16207",
              color: "#fcd34d",
              fontSize: 13,
            }}
          >
            Reassessment recommended {fmtDate(e.reassessment_recommended_at)}
            {e.reassessment_reason ? ` — ${e.reassessment_reason}` : ""}. Recording a periodic
            review or opening a new engagement answers this signal.
          </div>
        )}
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {(e.decision || state === "monitoring" || e.next_review_due) && (
          <section
            style={{
              padding: 20,
              borderRadius: 8,
              border: "1px solid #1f2937",
              background: "rgba(15,23,42,0.5)",
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px" }}>
              Decision &amp; monitoring
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
              {e.decision ? (
                <div>
                  <span style={{ color: "#e5e7eb", fontWeight: 600 }}>
                    {DECISION_LABELS[e.decision] ?? e.decision}
                  </span>
                  <span style={{ color: "#9ca3af" }}>
                    {" "}
                    · recorded {fmtDate(e.decided_at)}
                    {e.decision_expires_at ? ` · expires ${fmtDate(e.decision_expires_at)}` : ""}
                  </span>
                  {e.decision_rationale && (
                    <div style={{ color: "#9ca3af", marginTop: 4 }}>{e.decision_rationale}</div>
                  )}
                </div>
              ) : (
                <div style={{ color: "#9ca3af" }}>No decision recorded yet.</div>
              )}
              {(state === "monitoring" || e.next_review_due) && (
                <div style={{ color: overdue ? "#fca5a5" : "#9ca3af" }}>
                  Next review due {fmtDate(e.next_review_due)}
                  {e.review_cadence_days ? ` (every ${e.review_cadence_days} days)` : ""}
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
                      }}
                    >
                      Review overdue
                    </span>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        <EngagementActionPanel
          engagementId={e.id}
          state={state}
          inherentRating={e.inherent_rating}
        />

        <ResponsesSection responses={responsesResp} loadFailed={responsesResp === null} />

        <EvidenceSection engagementId={e.id} evidence={evidence} />

        <CommentsSection engagementId={e.id} state={state} comments={comments} />
      </div>
    </main>
  );
}
