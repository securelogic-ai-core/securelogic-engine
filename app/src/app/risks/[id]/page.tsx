import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import {
  getMe,
  getRiskById,
  getRiskTreatments,
  getRiskScale,
  getFindings,
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
  const [risk, treatmentsData, scale, findingsData] = await Promise.all([
    getRiskById(token, id),
    getRiskTreatments(token, { risk_id: id, limit: 50 }),
    getRiskScale(token),
    getFindings(token, { source_type: "risk", source_id: id, status: "open", limit: 50 }),
  ]);

  if (!risk) notFound();

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
      />
    </div>
  );
}
