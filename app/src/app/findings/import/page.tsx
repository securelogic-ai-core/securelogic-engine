import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { FindingsImportClient } from "./FindingsImportClient";
import { findingsHomeLabel } from "@/lib/navigation";

export default async function FindingsImportPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const riskWorkspaceOn = process.env.SECURELOGIC_RISK_WORKSPACE_ENABLED === "true";
  return (
    <FindingsImportClient
      homeLabel={findingsHomeLabel(riskWorkspaceOn)}
      explorerCta={riskWorkspaceOn ? "Open Finding Explorer →" : "View all findings →"}
    />
  );
}
