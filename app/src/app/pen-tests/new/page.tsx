import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import NewPenTestClient from "./NewPenTestClient";

// Server-component gate. Recording a penetration test is an assessment-family
// governance act (the engine's POST /api/pen-test-engagements is
// requireEntitlement("premium")), so this page is gated identically to the
// /pen-tests list. The form itself is a client component (NewPenTestClient);
// gating here means a sub-platform user gets a clean /dashboard redirect on
// direct navigation instead of a rendered shell whose submit would 403.
export default async function NewPenTestPage() {
  const session = await getSession();

  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  return <NewPenTestClient />;
}
