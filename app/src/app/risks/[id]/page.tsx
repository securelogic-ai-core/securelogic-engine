import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import {
  getMe,
  getRiskById,
  getRiskTreatments,
  getRiskScale,
  getFindings,
  getRiskSettingsServer,
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
  //   4. linked open findings — title + severity per finding (intelligence
  //      endpoint only gives counts; this fetch fills in detail)
  // Fifth fetch — org cadence policy (RR-5). Drives the
  // "(org default)" subtitle on the Review Cadence card. The endpoint
  // always returns four rating keys (defaults if no row); a null
  // response here is rare (network) and the card falls back to the
  // documented defaults via residual_rating lookup.
  const [risk, treatmentsData, scale, findingsData, riskSettings] = await Promise.all([
    getRiskById(token, id),
    getRiskTreatments(token, { risk_id: id, limit: 50 }),
    getRiskScale(token),
    getFindings(token, { source_type: "risk", source_id: id, status: "open", limit: 50 }),
    getRiskSettingsServer(token),
  ]);

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

      <RiskDetailClient
        risk={risk}
        treatments={treatmentsData?.treatments ?? []}
        findings={findingsData?.findings ?? []}
        scaleLevels={scale?.levels ?? []}
        effectiveCadenceByRating={effectiveCadenceByRating}
      />
    </div>
  );
}
