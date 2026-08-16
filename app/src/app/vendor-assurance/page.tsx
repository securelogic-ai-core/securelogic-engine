import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { isPlatformEntitled } from "@/lib/entitlements";
import {
  listVendorEngagements,
  listVendorAssuranceDocuments,
  type VendorEngagementListRow,
} from "@/lib/api";
import {
  ENGAGEMENT_STATE_LABELS,
  isEngagementState,
  isTerminal,
} from "@/lib/vendorEngagements";

/**
 * /vendor-assurance — the Vendor Assurance landing page.
 *
 * This route did not exist. `/vendor-assurance/queue` and
 * `/vendor-assurance/[documentId]` were the only children, so the bare path
 * 404'd, and the ONLY nav entry pointed at the document queue — one evidence
 * step presented as if it were the product. The engagement spine
 * (/vendor-engagements) was fully built and reachable only by typing the URL:
 * nav-orphaned in every IA variant, and with the legacy-writes flag on, the
 * vendor detail page offered the retired point-in-time CTAs instead of the
 * engagement one. Net effect: a complete third-party assurance workflow that no
 * signed-in user could find.
 *
 * This page is the entry point for that lifecycle, not a new capability: it
 * reads the same two org-scoped engine endpoints the child pages already use
 * and links onward. Every number here is a count of real rows for the caller's
 * organization — no placeholders, no synthesized state.
 */

/** The lifecycle, grouped by who is holding the work right now. */
const STAGE_GROUPS = [
  {
    key: "setup",
    label: "Being scoped",
    hint: "Intake and inherent risk — you are defining the engagement.",
    states: ["draft", "scoping", "scoped"],
  },
  {
    key: "vendor",
    label: "With the vendor",
    hint: "Questionnaire issued through the portal — waiting on their response.",
    states: ["issued", "in_progress"],
  },
  {
    key: "review",
    label: "Awaiting your review",
    hint: "Responses and evidence are in and need internal review.",
    states: ["submitted", "in_review", "clarification_requested", "analysis_complete", "decision_pending"],
  },
  {
    key: "monitoring",
    label: "Decided and monitoring",
    hint: "Residual risk recorded, decision made, on a review cadence.",
    states: ["decided", "monitoring"],
  },
] as const;

function Tile({
  href,
  value,
  label,
  hint,
  accent,
}: {
  href: string;
  value: number | string;
  label: string;
  hint: string;
  accent?: string;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        padding: 20,
        borderRadius: 10,
        border: "1px solid #374151",
        background: "rgba(31,41,55,0.5)",
        color: "#e5e7eb",
        textDecoration: "none",
      }}
    >
      <div style={{ fontSize: 30, fontWeight: 600, color: accent ?? "#e5e7eb", lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 8 }}>{label}</div>
      <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>{hint}</div>
    </Link>
  );
}

export default async function VendorAssurancePage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  // Same gate as /vendor-engagements — this page must never become a way to see
  // engagement counts an unentitled caller could not open.
  if (!isPlatformEntitled(session.entitlementLevel)) redirect("/dashboard");

  const [engagementData, documentData] = await Promise.all([
    listVendorEngagements(token, { limit: 200 }),
    listVendorAssuranceDocuments(token, { limit: 200 }),
  ]);

  const engagements: VendorEngagementListRow[] = engagementData?.engagements ?? [];
  const documents = documentData?.documents ?? [];

  const countFor = (states: readonly string[]) =>
    engagements.filter((e) => states.includes(e.status)).length;

  const openCount = engagements.filter(
    (e) => !isEngagementState(e.status) || !isTerminal(e.status)
  ).length;
  const overdueCount = engagements.filter((e) => e.review_overdue).length;
  const reassessCount = engagements.filter((e) => e.reassessment_recommended_at).length;
  const docsNeedingReview = documents.filter(
    (d) => d.processing_status === "extracted" || d.processing_status === "manual_review_requested"
  ).length;

  return (
    <main style={{ padding: "32px", maxWidth: 1280, margin: "0 auto", color: "#e5e7eb" }}>
      <header
        style={{
          marginBottom: 28,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0 }}>Vendor Assurance</h1>
          <p style={{ color: "#9ca3af", marginTop: 8, maxWidth: 760 }}>
            Third-party assurance end to end: inherent risk from intake, a tier-scoped
            questionnaire issued to the vendor through their portal, reviewed responses and
            evidence, findings and actions, residual risk, a recorded decision, and continuous
            monitoring until reassessment.
          </p>
        </div>
        <Link
          href="/vendor-engagements/new"
          style={{
            padding: "10px 18px",
            borderRadius: 6,
            background: "#2563eb",
            color: "#fff",
            textDecoration: "none",
            fontSize: 14,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          Start an engagement
        </Link>
      </header>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px" }}>Where the work is</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
          }}
        >
          {STAGE_GROUPS.map((g) => (
            <Tile
              key={g.key}
              href={`/vendor-engagements?status=${g.states[0]}`}
              value={countFor(g.states)}
              label={g.label}
              hint={g.hint}
            />
          ))}
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px" }}>Needs attention</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
          }}
        >
          <Tile
            href="/vendor-engagements"
            value={overdueCount}
            label="Reviews overdue"
            hint="Monitoring engagements past their next review date."
            accent={overdueCount > 0 ? "#f87171" : undefined}
          />
          <Tile
            href="/vendor-engagements"
            value={reassessCount}
            label="Reassessment recommended"
            hint="Intelligence raised a signal against the vendor since the last decision."
            accent={reassessCount > 0 ? "#fbbf24" : undefined}
          />
          <Tile
            href="/vendor-assurance/queue"
            value={docsNeedingReview}
            label="Documents to review"
            hint="Extracted vendor evidence awaiting reviewer approval."
            accent={docsNeedingReview > 0 ? "#fbbf24" : undefined}
          />
          <Tile
            href="/vendor-engagements"
            value={openCount}
            label="Open engagements"
            hint="Everything not closed, cancelled, or expired."
          />
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 12px" }}>Most recent</h2>
        {engagements.length === 0 ? (
          <div
            style={{
              padding: 24,
              borderRadius: 10,
              border: "1px dashed #374151",
              background: "rgba(31,41,55,0.35)",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>No engagements yet</div>
            <p style={{ color: "#9ca3af", fontSize: 14, margin: "0 0 14px", maxWidth: 640 }}>
              An engagement is the unit of vendor assurance work. Start one against a vendor to
              capture inherent risk, issue a questionnaire to their portal, review what comes
              back, and record a decision.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link
                href="/vendor-engagements/new"
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  background: "#2563eb",
                  color: "#fff",
                  textDecoration: "none",
                  fontSize: 14,
                }}
              >
                Start an engagement
              </Link>
              <Link
                href="/vendors"
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "1px solid #374151",
                  color: "#93c5fd",
                  textDecoration: "none",
                  fontSize: 14,
                }}
              >
                Browse vendors
              </Link>
            </div>
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {engagements.slice(0, 8).map((e) => (
              <li
                key={e.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 14px",
                  borderRadius: 8,
                  border: "1px solid #374151",
                  background: "rgba(31,41,55,0.4)",
                  marginBottom: 8,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <Link
                    href={`/vendor-engagements/${e.id}`}
                    style={{ color: "#93c5fd", textDecoration: "none", fontWeight: 600 }}
                  >
                    {e.title ?? `${e.vendor_name} assurance review`}
                  </Link>
                  <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 2 }}>
                    {e.vendor_name}
                    {" · "}
                    {isEngagementState(e.status) ? ENGAGEMENT_STATE_LABELS[e.status] : e.status}
                    {e.residual_rating ? ` · residual ${e.residual_rating}` : ""}
                  </div>
                </div>
                {e.review_overdue && (
                  <span style={{ color: "#f87171", fontSize: 12, fontWeight: 600 }}>
                    Review overdue
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div style={{ marginTop: 14 }}>
          <Link href="/vendor-engagements" style={{ color: "#93c5fd", fontSize: 14 }}>
            View all engagements →
          </Link>
        </div>
      </section>
    </main>
  );
}
