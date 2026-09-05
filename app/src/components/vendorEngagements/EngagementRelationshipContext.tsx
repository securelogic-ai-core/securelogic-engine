/**
 * EngagementRelationshipContext — Vendor Onboarding 2.0 (VO-11) + WA-2.
 *
 * Which relationship / service this engagement assesses, and the derived
 * classification it was opened at — Criticality and Inherent risk as PEERS,
 * the joint Assessment tier, and the applicable domains the questionnaire was
 * composed over. Every value is the STORED one the engine recorded; nothing
 * is recalculated here. A customer reads this and never needs the API to know
 * what an engagement is about.
 *
 * WA-2 adds the "Why this rating?" disclosure. VO-11 deliberately showed the
 * bands and sent the reader to the vendor page for the basis; the owner
 * walkthrough found that an analyst reviewing an engagement could see it was
 * rated Critical and had no way to defend that from where they were standing.
 * The disclosure renders the SAME stored envelopes through the SAME component
 * the vendor page uses — collapsed by default, because the bands are the
 * headline and the arithmetic is the follow-up question.
 *
 * A pre-2.0 engagement has no relationship: it says so, and manufactures
 * nothing.
 */
import Link from "next/link";
import type { VendorEngagementRelationshipContext as Ctx, VendorEngagementQuestionnaire } from "@/lib/api";
import { VENDOR_ASSESSMENT_DOMAINS, VENDOR_ASSESSMENT_DOMAIN_LABELS } from "@/lib/api";
import { TIER_LABELS } from "@/lib/vendorRelationshipIntake";
import ClassificationBasisPanel from "@/components/vendorRisk/ClassificationBasisPanel";

const BAND_COLOR: Record<string, string> = { Critical: "#fca5a5", High: "#fdba74", Moderate: "#fde68a", Low: "#86efac" };

function Cell({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 120 }}>
      <span style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
      <span style={{ fontSize: 13, color: "#d1d5db" }}>{children}</span>
    </div>
  );
}

export default function EngagementRelationshipContext({
  vendorId, vendorName, relationship, methodologyVersion, domains,
}: {
  vendorId: string;
  vendorName: string;
  relationship: Ctx | null;
  methodologyVersion: string;
  domains: VendorEngagementQuestionnaire["domains"];
}): JSX.Element {
  const box: React.CSSProperties = { marginTop: 14, padding: "12px 14px", border: "1px solid #1e3a8a", borderRadius: 8, background: "rgba(30,58,138,0.10)" };
  if (!relationship) {
    return (
      <section style={box} aria-label="Relationship under assessment">
        <span style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Relationship under assessment</span>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "#9ca3af" }}>
          This engagement was opened before Vendor Onboarding 2.0 and is not linked to a relationship. It was scored under methodology {methodologyVersion}; its rating is shown below as recorded and is not re-derived.
          {" "}<Link href={`/vendors/${encodeURIComponent(vendorId)}#relationships`} style={{ color: "#93c5fd" }}>Classify {vendorName}&apos;s relationships →</Link>
        </p>
      </section>
    );
  }
  const raised = relationship.tier_calculated_minimum && relationship.assessment_tier && relationship.tier_calculated_minimum !== relationship.assessment_tier;
  const active = domains ? VENDOR_ASSESSMENT_DOMAINS.filter((d) => (domains[d] ?? 0) > 0) : [];
  const hasBasis = Boolean(
    relationship.criticality_basis || relationship.inherent_basis || relationship.tier_basis
  );
  return (
    <section style={box} aria-label="Relationship under assessment">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        <div>
          <span style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Relationship under assessment</span>
          <div style={{ fontSize: 15, color: "#e5e7eb", marginTop: 2 }}>
            <Link href={`/vendors/${encodeURIComponent(vendorId)}#relationships`} style={{ color: "#e5e7eb" }}>{relationship.name}</Link>
            {relationship.is_primary && <span style={{ marginLeft: 8, fontSize: 10, color: "#86efac" }}>PRIMARY</span>}
            <span style={{ color: "#9ca3af", fontSize: 13 }}> · {vendorName}</span>
          </div>
          {relationship.service_description && <div style={{ fontSize: 12, color: "#9ca3af" }}>{relationship.service_description}</div>}
        </div>
        <span style={{ fontSize: 11, color: "#6b7280" }}>
          classified {relationship.classification_computed_at ? new Date(relationship.classification_computed_at).toISOString().slice(0, 10) : "—"} · criticality v{relationship.criticality_methodology_version} · inherent v{relationship.inherent_methodology_version}
        </span>
      </div>
      <div style={{ display: "flex", gap: 24, marginTop: 10, flexWrap: "wrap" }}>
        <Cell label="Criticality">
          <span style={{ color: relationship.criticality_band ? BAND_COLOR[relationship.criticality_band] : "#6b7280" }}>{relationship.criticality_band ?? "—"}</span>
          {relationship.criticality_score !== null && <span style={{ color: "#6b7280" }}> · {relationship.criticality_score}</span>}
        </Cell>
        <Cell label="Inherent risk">
          <span style={{ color: relationship.inherent_band ? BAND_COLOR[relationship.inherent_band] : "#6b7280" }}>{relationship.inherent_band ?? "—"}</span>
          {relationship.inherent_score !== null && <span style={{ color: "#6b7280" }}> · {relationship.inherent_score}</span>}
        </Cell>
        <Cell label="Assessment tier">
          {relationship.assessment_tier ? TIER_LABELS[relationship.assessment_tier] ?? relationship.assessment_tier : "—"}
          {raised && <span style={{ color: "#93c5fd", fontSize: 12 }}> (policy raised from {TIER_LABELS[relationship.tier_calculated_minimum!]})</span>}
        </Cell>
        <Cell label="Applicable domains">
          {active.length > 0 ? active.map((d) => `${VENDOR_ASSESSMENT_DOMAIN_LABELS[d]} ${domains![d]}`).join(" · ") : "Not scoped yet"}
        </Cell>
      </div>

      {/*
        WA-2. Collapsed by default: the bands are the headline, the arithmetic
        is the follow-up. Absent entirely when the relationship has no stored
        basis (a pre-basis classification), rather than an empty panel that
        would read as "assessed, with no reasons".
      */}
      {hasBasis && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, color: "#93c5fd" }}>
            Why this rating?
          </summary>
          <ClassificationBasisPanel
            criticalityBasis={relationship.criticality_basis}
            criticalityArithmeticBand={relationship.criticality_arithmetic_band}
            criticalityBand={relationship.criticality_band}
            inherentBasis={relationship.inherent_basis}
            inherentArithmeticBand={relationship.inherent_arithmetic_band}
            inherentBand={relationship.inherent_band}
            tierBasis={relationship.tier_basis}
            tierCalculatedMinimum={relationship.tier_calculated_minimum}
            assessmentTier={relationship.assessment_tier}
          />
          <p style={{ margin: "8px 0 0", fontSize: 11, color: "#6b7280" }}>
            SecureLogic derived this from the factual intake recorded for the
            relationship. To change it, correct the facts and record the intake
            again on{" "}
            <Link href={`/vendors/${encodeURIComponent(vendorId)}#relationships`} style={{ color: "#93c5fd" }}>
              the vendor
            </Link>
            ; ratings are never edited directly.
          </p>
        </details>
      )}
    </section>
  );
}
