import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { AiSystemsImportClient } from "./AiSystemsImportClient";

export default async function AiSystemsImportPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  return <AiSystemsImportClient />;
}
