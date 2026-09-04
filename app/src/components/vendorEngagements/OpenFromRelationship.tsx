"use client";

/**
 * OpenFromRelationship — Vendor Onboarding 2.0 (VO-10).
 *
 * The canonical way to open an assessment is FROM a classified relationship:
 * the engagement inherits the derived classification and joint tier and the
 * customer is not asked the intake again. This sits above the pre-2.0 intake
 * form on /vendor-engagements/new so a vendor that already has classified
 * relationships is never re-asked by default.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { VendorRelationship } from "@/lib/api";
import { TIER_LABELS } from "@/lib/vendorRelationshipIntake";
import { openAssessmentForRelationship } from "@/app/actions/vendorRelationships";

export default function OpenFromRelationship({ vendorId, relationships }: { vendorId: string; relationships: VendorRelationship[] }): JSX.Element | null {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const classified = relationships.filter((r) => r.classification_state === "classified" && r.status === "active");
  const awaiting = relationships.filter((r) => r.classification_state === "intake_required" && r.status === "active");
  if (relationships.length === 0) return null;

  return (
    <section style={{ marginBottom: 24, padding: 16, border: "1px solid #1e3a8a", borderRadius: 8, background: "rgba(30,58,138,0.12)" }}>
      <h2 style={{ fontSize: 15, margin: 0, color: "#e5e7eb" }}>Open from a classified relationship</h2>
      <p style={{ color: "#9ca3af", fontSize: 13, margin: "6px 0 12px" }}>
        The engagement inherits the relationship&apos;s derived Criticality, Inherent risk and Assessment tier. Nothing is asked twice.
      </p>
      {classified.length === 0 ? (
        <p style={{ color: "#fde68a", fontSize: 13 }}>
          {awaiting.length} relationship{awaiting.length === 1 ? "" : "s"} awaiting factual intake.{" "}
          <Link href={`/vendors/${encodeURIComponent(vendorId)}#relationships`} style={{ color: "#93c5fd" }}>Record intake on the vendor page →</Link>
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
          {classified.map((r) => (
            <li key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 10px", border: "1px solid #334155", borderRadius: 6 }}>
              <div>
                <div style={{ fontSize: 13, color: "#e5e7eb" }}>{r.name}{r.is_primary && <span style={{ marginLeft: 8, fontSize: 10, color: "#86efac" }}>PRIMARY</span>}</div>
                <div style={{ fontSize: 11, color: "#9ca3af" }}>Criticality {r.criticality_band} · Inherent {r.inherent_band} · {TIER_LABELS[r.assessment_tier ?? ""] ?? r.assessment_tier}</div>
              </div>
              <button type="button" disabled={pending} style={{ fontSize: 12, color: "#93c5fd", background: "rgba(30,58,138,0.25)", border: "1px solid #334155", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}
                onClick={() => {
                  setError(null);
                  start(async () => {
                    // A rejected action call is reported here, never thrown into the route.
                    let res: Awaited<ReturnType<typeof openAssessmentForRelationship>>;
                    try {
                      res = await openAssessmentForRelationship(vendorId, r.id);
                    } catch {
                      setError("The request did not reach SecureLogic, so nothing was opened. Check your connection and try again.");
                      return;
                    }
                    if (!res.ok) { setError(res.error); return; }
                    if (res.engagementId) router.push(`/vendor-engagements/${res.engagementId}`);
                  });
                }}>
                {pending ? "Opening…" : "Open assessment"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p style={{ marginTop: 8, fontSize: 12, color: "#fca5a5" }}>{error}</p>}
      {classified.length > 0 && (
        <p style={{ color: "#6b7280", fontSize: 12, margin: "12px 0 0" }}>The form below is the pre-2.0 path: it re-asks the intake and scores with the previous methodology.</p>
      )}
    </section>
  );
}
