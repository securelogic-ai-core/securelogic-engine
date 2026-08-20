import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import {
  getMe,
  getAuthMe,
  getRiskById,
  getRiskTreatments,
  getRiskScale,
  getFindings,
  getRiskSettingsServer,
  getRiskSupportingFindings,
} from "@/lib/api";
import { RiskDetailClient } from "./RiskDetailClient";

export default async function RiskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const me = await getMe(token);
  const entitlementLevel = me?.entitlementLevel ?? "starter";
  const isPlatformUser = ["premium", "platform", "team"].includes(entitlementLevel);
  if (!isPlatformUser) redirect("/dashboard");

  // Four parallel fetches:
  //   1. risk row     — for header, metadata grid, treatment-approach prose
  //   2. treatments   — read-only list of risk_treatments rows for this risk
  //   3. scale levels — display-preset relabeling
  //   4. linked active findings — title + severity per finding (intelligence
  //      endpoint only gives counts; this fetch fills in detail)
  // Fifth fetch — org cadence policy (RR-5). Drives the
  // "(org default)" subtitle on the Review Cadence card. The endpoint
  // always returns four rating keys (defaults if no row); a null
  // response here is rare (network) and the card falls back to the
  // documented defaults via residual_rating lookup.
  // Sixth fetch — the caller's role (getAuthMe needs a JWT; API-key sessions
  // resolve to null role). Drives approver-only affordances in the lifecycle
  // panel; the engine remains the authority regardless of what the UI shows.
  const [risk, treatmentsData, scale, findingsData, riskSettings, authMe, supportingFindings] = await Promise.all([
    getRiskById(token, id),
    getRiskTreatments(token, { risk_id: id, limit: 50 }),
    getRiskScale(token),
    // Server-scoped (source_id = this risk), so this is NOT the cap-before-filter
    // defect the other detail pages had — the filter runs in the database. But the
    // page IS bounded at 50, so the exact `total` travels with it and the card
    // discloses when it is showing a subset, rather than quietly ending at 50.
    getFindings(token, { source_type: "risk", source_id: id, active: true, limit: 50 }),
    getRiskSettingsServer(token),
    session.jwtToken ? getAuthMe(session.jwtToken) : Promise.resolve(null),
    // The findings that EVIDENCE this entry — distinct from the findings above,
    // which were raised FROM it. One is "this risk produced work", the other is
    // "this is why we believe the risk is real". Conflating them would let an
    // entry look evidenced by findings it generated itself.
    getRiskSupportingFindings(token, id),
  ]);
  const userRole = authMe?.role ?? null;

  if (!risk) notFound();

  // Documented defaults — kept in sync with src/api/lib/riskCadence.ts
  // DEFAULT_CADENCE_BY_RATING. Used as the fallback when the engine's
  // settings endpoint returns null (degraded path), so the cadence card
  // can still render an "(org default)" subtitle.
  const DEFAULT_CADENCE_BY_RATING: Record<string, number> = {
    Critical: 30, High: 60, Moderate: 90, Low: 180,
  };
  const effectiveCadenceByRating =
    riskSettings?.cadence_by_rating ?? DEFAULT_CADENCE_BY_RATING;

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="mb-6">
        <Link href="/risks" style={{ color: "#60a5fa", fontSize: 13, textDecoration: "none" }}>
          ← Risk Register
        </Link>
      </div>

      {supportingFindings.length > 0 && (
        <section
          style={{
            background: "#0f172a", border: "1px solid #1e293b", borderRadius: "12px",
            padding: "20px", marginBottom: "16px",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "13px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Supporting findings ({supportingFindings.length})
          </h2>
          <p style={{ margin: "4px 0 12px", fontSize: "12px", color: "#64748b" }}>
            The evidence this register entry rests on.
          </p>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "8px" }}>
            {supportingFindings.map((f) => (
              <li key={f.finding_id} style={{ border: "1px solid #1e293b", borderRadius: "8px", padding: "10px 12px" }}>
                <Link href={`/findings/${f.finding_id}`} style={{ color: "#5eead4", fontSize: "14px", fontWeight: 600, textDecoration: "none" }}>
                  {f.finding_title}
                </Link>
                <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#64748b" }}>
                  {f.finding_severity} · {f.finding_status} · {f.finding_source_type.replace(/_/g, " ")}
                  {f.link_type === "promoted" && " · this entry was promoted from it"}
                </p>
                {f.note && (
                  <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#94a3b8", fontStyle: "italic" }}>
                    {f.note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <RiskDetailClient
        risk={risk}
        treatments={treatmentsData?.treatments ?? []}
        findings={findingsData?.findings ?? []}
        findingsTotal={findingsData?.total ?? findingsData?.findings.length ?? 0}
        scaleLevels={scale?.levels ?? []}
        effectiveCadenceByRating={effectiveCadenceByRating}
        userRole={userRole}
      />
    </div>
  );
}
