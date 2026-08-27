import { notFound, redirect } from "next/navigation";
import { penTestEnabled } from "@/lib/penTestFeatureFlag";
import { getSession } from "@/lib/session";
import NewPenTestClient from "./NewPenTestClient";

// Server-component gate. Recording a penetration test is an assessment-family
// governance act (the engine's POST /api/pen-test-engagements is
// requireEntitlement("premium")), so this page is gated identically to the
// /pen-tests list. The form itself is a client component (NewPenTestClient);
// gating here means a sub-platform user gets a clean /dashboard redirect on
// direct navigation instead of a rendered shell whose submit would 403.
export default async function NewPenTestPage() {
  // ACTIVATION gate, checked BEFORE the entitlement redirect below. The two
  // controls answer different questions and fail differently on purpose: a
  // disabled capability is notFound() (the page does not exist for anyone,
  // whatever their tier), an unentitled user is redirect("/dashboard") (the
  // page exists, this account may not use it). Direct navigation to the URL is
  // the bypass this closes — the nav entry is hidden by the same flag, and the
  // engine 404s the API underneath, so all three doors are shut by one key.
  if (!penTestEnabled()) notFound();

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
