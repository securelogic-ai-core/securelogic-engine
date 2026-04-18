import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { RisksImportClient } from "./RisksImportClient";

export default async function RisksImportPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  return <RisksImportClient />;
}
