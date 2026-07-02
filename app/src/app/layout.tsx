import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { getSession } from "@/lib/session";
import { getIdleSeconds } from "@/lib/sessionPolicy";
import { getConsentStatus } from "@/lib/api";
import IdleLogout from "@/components/IdleLogout";
import ConsentInterstitial from "@/components/ConsentInterstitial";

export const metadata: Metadata = {
  title: "SecureLogic AI — Intelligence Brief",
  description:
    "Weekly risk intelligence for security, compliance, and AI governance leaders.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const isAuthenticated = Boolean(session.jwtToken ?? session.apiKey);

  // Legal-consent gate. For JWT sessions, probe whether the user still owes
  // consent to any current-version policy document; if so, render a blocking
  // interstitial over the page. Only JWT sessions are checked — legacy API-key
  // sessions are not gated (matches the engine's requireConsent scope). The
  // probe fails open, so a transient engine error never walls off the app.
  const consent = session.jwtToken
    ? await getConsentStatus(session.jwtToken)
    : ({ consentRequired: false } as const);
  // entitlementLevel is stored in the session by the auth-login route at login time.
  // It may be stale after a Stripe upgrade until a session refresh — but nav visibility
  // is non-security-critical; actual page/API access is gated at the page level.
  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" || entitlementLevel === "platform" || entitlementLevel === "team";
  const isPremiumUser =
    entitlementLevel === "premium" || entitlementLevel === "professional" ||
    entitlementLevel === "platform" || entitlementLevel === "team";
  const isSsoEligible =
    entitlementLevel === "professional" || entitlementLevel === "premium" ||
    entitlementLevel === "platform" || entitlementLevel === "team" ||
    entitlementLevel === "standard";
  const isAdminUser = session.userRole === "admin";

  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col bg-brand-bg text-slate-100" suppressHydrationWarning>
        <Header
          isAuthenticated={isAuthenticated}
          isPlatformUser={isPlatformUser}
          isPremiumUser={isPremiumUser}
          isAdminUser={isAdminUser}
          isSsoEligible={isSsoEligible}
          organizationName={session.organizationName}
          userName={session.name}
          userEmail={session.email}
          userRole={session.userRole}
        />
        <main className="flex-1">{children}</main>
        {consent.consentRequired && (
          <ConsentInterstitial missingDocuments={consent.missingDocuments} />
        )}
        {isAuthenticated && <IdleLogout idleSeconds={getIdleSeconds()} />}
        <footer className="border-t border-brand-line bg-brand-surface mt-16">
          <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
            <span className="text-slate-400 text-sm">
              © {new Date().getFullYear()} SecureLogic AI. All rights reserved.
            </span>
            <span className="text-slate-500 text-xs font-medium uppercase tracking-wide">
              Enterprise Risk Intelligence
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
