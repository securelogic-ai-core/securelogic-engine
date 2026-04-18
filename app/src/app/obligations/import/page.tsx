import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ObligationsImportClient } from "./ObligationsImportClient";

export default async function ObligationsImportPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  return <ObligationsImportClient />;
}
