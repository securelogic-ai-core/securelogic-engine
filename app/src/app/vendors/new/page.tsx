import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import NewVendorClient from "./NewVendorClient";

// Server-component gate. The vendor surface is a Platform pillar (rank 4 /
// premium — §D entitlement reconciliation), so this page is gated identically
// to the rest of /vendors. The form itself is a client component
// (NewVendorClient); gating here means a rank-2 user gets a clean /dashboard
// redirect on direct navigation instead of a rendered shell whose submit would
// 403 against the now-premium POST /api/vendors.
export default async function NewVendorPage() {
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  return <NewVendorClient />;
}
