import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { VendorImportClient } from "./ImportClient";

export default async function VendorImportPage() {
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  return <VendorImportClient />;
}
