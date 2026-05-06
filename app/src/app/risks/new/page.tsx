import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getMe, getRiskScale } from "@/lib/api";
import { CreateRiskClient } from "./CreateRiskClient";

export default async function NewRiskPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const me = await getMe(token);
  const entitlementLevel = me?.entitlementLevel ?? "starter";
  const isPlatformUser = ["premium", "platform", "team"].includes(entitlementLevel);
  if (!isPlatformUser) redirect("/dashboard");

  // Pull the org's display preset so the impact / risk_rating dropdowns
  // can show the customer's relabeled values.
  const scale = await getRiskScale(token);

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <div className="mb-6">
        <Link href="/risks" style={{ color: "#60a5fa", fontSize: 13, textDecoration: "none" }}>
          ← Risk Register
        </Link>
        <h1 className="text-2xl font-bold mt-2" style={{ color: "#f1f5f9" }}>
          Add Risk
        </h1>
        <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
          Add a new entry to the risk register. You can edit the rating and
          treatment later.
        </p>
      </div>

      <CreateRiskClient
        scaleLevels={scale?.levels ?? []}
        organizationId={me?.organizationId ?? ""}
      />
    </div>
  );
}
