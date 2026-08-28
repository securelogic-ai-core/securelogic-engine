/**
 * VendorProvenancePanel.tsx — T1-B. The return path of the Vendor Assurance chain.
 *
 * THE POINT IS THE RETURN JOURNEY. Getting from a CUEC to its Finding already
 * worked; getting back did not. A reader who lands on a promoted finding — from
 * the queue, from a search, from a link in a report — could see only the words
 * "Vendor Assessment" and had no way to reach the vendor, the report, the
 * obligation, or the person who decided we do not meet it. This panel is that way
 * back, and it is what VA-3 gate 12 asks for.
 *
 * VERBATIM CUEC TEXT, NOT A SUMMARY. The obligation is quoted exactly as
 * extracted. A paraphrase of a contractual requirement is a different
 * requirement, and this is the artifact an auditor reads over someone's shoulder.
 *
 * THE BASIS IS THE STRONGEST PART, SO IT IS SHOWN. `gap_basis` is snapshotted at
 * the moment of decision — which controls the CUEC was mapped to and what their
 * implementation status was THEN. Controls change; a determination made in March
 * must stay explainable in September. Rendering today's control status here
 * instead would quietly rewrite history, which is the exact thing the snapshot
 * exists to prevent.
 *
 * RENDERED ONLY FOR FINDINGS WITH A VENDOR SPINE BEHIND THEM. The endpoint
 * distinguishes "vendor_assessment" and "not_applicable" as real answers rather
 * than errors, but a panel headed "Vendor Assurance provenance" saying "not
 * applicable" on every unrelated finding is noise, not honesty. Absence is
 * reported by the API; the UI simply declines to occupy space it cannot fill.
 *
 * VA-10 — THE ENGAGEMENT ARM. An engagement-promoted finding renders the other
 * return journey: vendor -> engagement -> requirement, the promotion-time
 * severity basis (snapshot, stamped with the methodology version), and the
 * CURRENT source response, labeled as current. Per the supersede-on-pass
 * ruling (2026-08-22), a control that now reports pass/not_applicable never
 * closes the finding — this panel is one of the places that divergence is
 * NAMED for the human who decides.
 *
 * Server component on purpose: no state, no handlers, nothing to hydrate. The
 * sibling AffectedAssetsPanel carries "use client" with zero interactive hooks —
 * incidental rather than required — so this does not follow it there.
 */

import Link from "next/link";

import type { FindingVendorProvenance } from "@/lib/api";

const DETERMINATION_LABEL: Record<string, string> = {
  gap: "We don't meet this",
  satisfied: "We meet this",
  not_applicable: "Doesn't apply to us",
  pending: "Not yet reviewed",
  reviewed_no_match: "Reviewed — no matching control (deprecated)",
};

const DETERMINATION_COLOR: Record<string, string> = {
  gap: "#fca5a5",
  satisfied: "#86efac",
  not_applicable: "#94a3b8",
  pending: "#fcd34d",
  reviewed_no_match: "#94a3b8",
};

type MappedControl = {
  control_id?: string;
  control_name?: string;
  implementation_status?: string | null;
};

/** Defensive: `basis` is JSONB and shaped by the writer, so nothing is assumed. */
function readMappedControls(basis: unknown): MappedControl[] {
  if (!basis || typeof basis !== "object") return [];
  const raw = (basis as Record<string, unknown>)["mapped_controls"];
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is MappedControl => !!c && typeof c === "object");
}

function readBasisKind(basis: unknown): string | null {
  if (!basis || typeof basis !== "object") return null;
  const v = (basis as Record<string, unknown>)["basis"];
  return typeof v === "string" ? v : null;
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "#94a3b8",
  marginBottom: 4,
};

const ENGAGEMENT_TYPE_LABEL: Record<string, string> = {
  initial: "Initial assessment",
  periodic: "Periodic reassessment",
  triggered: "Triggered reassessment",
  targeted: "Targeted assessment",
};

const RESPONSE_LABEL: Record<string, string> = {
  pass: "Pass",
  fail: "Fail",
  partial: "Partial",
  not_applicable: "Not applicable",
  not_assessed: "Not assessed",
};

const RESPONSE_COLOR: Record<string, string> = {
  pass: "#86efac",
  fail: "#fca5a5",
  partial: "#fcd34d",
  not_applicable: "#94a3b8",
  not_assessed: "#94a3b8",
};

function EngagementProvenance({
  data,
}: {
  data: NonNullable<FindingVendorProvenance["engagement_provenance"]>;
}) {
  const { vendor, engagement, requirement, severity_rationale, current_response } =
    data;
  const decidedAt = engagement.decided_at
    ? new Date(engagement.decided_at).toLocaleDateString()
    : null;
  const responseAsOf = current_response?.as_of
    ? new Date(current_response.as_of).toLocaleDateString()
    : null;
  // The supersede-on-pass ruling: name the divergence where the human decides.
  const sourceNoLongerAsserts =
    current_response != null &&
    (current_response.status === "pass" ||
      current_response.status === "not_applicable");

  return (
    <section
      style={{
        border: "1px solid #1e293b",
        borderRadius: 10,
        padding: 16,
        marginBottom: 16,
        background: "#0b1220",
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 4px" }}>
        Where this came from
      </h2>
      <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 14px" }}>
        This finding was promoted from a control gap in a vendor engagement
        questionnaire.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div>
          <div style={labelStyle}>Vendor</div>
          <Link href={`/vendors/${vendor.id}`} style={{ color: "#93c5fd" }}>
            {vendor.name}
          </Link>
        </div>
        <div>
          <div style={labelStyle}>Engagement</div>
          <Link
            href={`/vendor-engagements/${engagement.id}`}
            style={{ color: "#93c5fd" }}
          >
            {engagement.title ??
              ENGAGEMENT_TYPE_LABEL[engagement.engagement_type] ??
              engagement.engagement_type}
          </Link>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            {engagement.status.replace(/_/g, " ")}
            {engagement.decision
              ? ` · ${engagement.decision.replace(/_/g, " ")}${
                  decidedAt ? ` (${decidedAt})` : ""
                }`
              : ""}
          </div>
        </div>
        <div>
          <div style={labelStyle}>Requirement</div>
          {requirement ? (
            <>
              <span style={{ color: "#e2e8f0", fontWeight: 600 }}>
                {requirement.reference ?? "unreferenced"}
              </span>
              {requirement.title ? (
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                  {requirement.title}
                </div>
              ) : null}
            </>
          ) : (
            <span style={{ fontSize: 12, color: "#94a3b8" }}>
              not recorded
            </span>
          )}
        </div>
      </div>

      {severity_rationale ? (
        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Severity basis at promotion</div>
          <div style={{ fontSize: 13, color: "#e2e8f0" }}>
            {severity_rationale}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
            Stamped when the finding was promoted (methodology{" "}
            {engagement.methodology_version}). The source may have moved on;
            this has not.
          </div>
        </div>
      ) : null}

      <div>
        <div style={labelStyle}>Current source response</div>
        {current_response ? (
          <>
            <span
              style={{
                color: RESPONSE_COLOR[current_response.status] ?? "#e2e8f0",
                fontWeight: 600,
              }}
            >
              {RESPONSE_LABEL[current_response.status] ??
                current_response.status}
            </span>
            <span style={{ fontSize: 11, color: "#64748b" }}>
              {responseAsOf ? ` · as of ${responseAsOf}` : ""}
              {current_response.responder_type
                ? ` · by ${current_response.responder_type}`
                : ""}
            </span>
            {sourceNoLongerAsserts ? (
              <div
                style={{
                  fontSize: 12,
                  color: "#fcd34d",
                  marginTop: 6,
                  padding: "6px 10px",
                  borderLeft: "3px solid #b45309",
                  background: "#1c1408",
                }}
              >
                The source no longer asserts this gap. That does not close the
                finding — closure remains a human decision through the normal
                gate.
              </div>
            ) : null}
          </>
        ) : (
          <span style={{ fontSize: 12, color: "#94a3b8" }}>
            No current response recorded for this control.
          </span>
        )}
      </div>
    </section>
  );
}

export function VendorProvenancePanel({
  data,
}: {
  data: FindingVendorProvenance | null;
}) {
  if (!data) return null;
  if (data.source === "vendor_engagement" && data.engagement_provenance) {
    return <EngagementProvenance data={data.engagement_provenance} />;
  }
  if (data.source !== "vendor_assurance_cuec" || !data.provenance) {
    return null;
  }

  const { vendor, document, cuec, determination } = data.provenance;
  const controls = readMappedControls(determination.basis);
  const basisKind = readBasisKind(determination.basis);
  const decidedAt = determination.decided_at
    ? new Date(determination.decided_at).toLocaleDateString()
    : null;
  const decidedBy =
    determination.decided_by?.name ?? determination.decided_by?.email ?? null;

  return (
    <section
      style={{
        border: "1px solid #1e293b",
        borderRadius: 10,
        padding: 16,
        marginBottom: 16,
        background: "#0b1220",
      }}
    >
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: "0 0 4px" }}>
        Where this came from
      </h2>
      <p style={{ fontSize: 12, color: "#94a3b8", margin: "0 0 14px" }}>
        This finding was promoted from a complementary user entity control in a
        vendor&rsquo;s assurance report.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div>
          <div style={labelStyle}>Vendor</div>
          <Link href={`/vendors/${vendor.id}`} style={{ color: "#93c5fd" }}>
            {vendor.name}
          </Link>
        </div>
        <div>
          <div style={labelStyle}>Source document</div>
          <Link
            href={`/vendor-assurance/${document.id}`}
            style={{ color: "#93c5fd" }}
          >
            {document.original_filename}
          </Link>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            {document.document_type_hint ?? "document"} ·{" "}
            <span title={document.sha256}>
              sha256 {document.sha256.slice(0, 12)}…
            </span>
          </div>
        </div>
        <div>
          <div style={labelStyle}>Determination</div>
          <span
            style={{
              color: DETERMINATION_COLOR[determination.review_status] ?? "#e2e8f0",
              fontWeight: 600,
            }}
          >
            {DETERMINATION_LABEL[determination.review_status] ??
              determination.review_status}
          </span>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            {decidedBy ? `by ${decidedBy}` : "reviewer not recorded"}
            {decidedAt ? ` · ${decidedAt}` : ""}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={labelStyle}>
          The obligation (CUEC {cuec.ordinal}, as written)
        </div>
        <blockquote
          style={{
            margin: 0,
            padding: "8px 12px",
            borderLeft: "3px solid #334155",
            background: "#0f172a",
            fontSize: 13,
            lineHeight: 1.5,
            color: "#e2e8f0",
          }}
        >
          {cuec.text}
        </blockquote>
      </div>

      {determination.reason ? (
        <div style={{ marginBottom: 12 }}>
          <div style={labelStyle}>Why the reviewer decided this</div>
          <div style={{ fontSize: 13, color: "#e2e8f0" }}>
            {determination.reason}
          </div>
        </div>
      ) : null}

      <div>
        <div style={labelStyle}>Basis at the time of the decision</div>
        {controls.length === 0 ? (
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            {basisKind === "reviewer_judgement_no_mapped_control"
              ? "No control was mapped to this obligation. The reviewer decided on judgement alone."
              : "No basis was recorded."}
          </div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {controls.map((c, i) => (
              <li key={c.control_id ?? i} style={{ marginBottom: 2 }}>
                {c.control_name ?? c.control_id ?? "unnamed control"}
                {c.implementation_status ? (
                  <span style={{ color: "#94a3b8" }}>
                    {" "}
                    — {c.implementation_status.replace(/_/g, " ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>
          Snapshotted when the determination was made. Controls change; this does
          not.
        </div>
      </div>
    </section>
  );
}
