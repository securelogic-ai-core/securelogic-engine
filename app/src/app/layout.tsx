import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { getSession } from "@/lib/session";
import { getIdleSeconds } from "@/lib/sessionPolicy";
import { penTestEnabled } from "@/lib/penTestFeatureFlag";
import { riskAcceptanceEnabled } from "@/lib/riskAcceptanceFeatureFlag";
import { vendorAssuranceEnabled } from "@/lib/vendorAssuranceFeatureFlag";
import { getConsentStatus } from "@/lib/api";
import IdleLogout from "@/components/IdleLogout";
import ConsentInterstitial from "@/components/ConsentInterstitial";
import NonPortalChrome from "@/components/NonPortalChrome";

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

  // Feature-flagged nav items (fail-closed). Runtime env — a restart applies it, no
  // rebuild. The engine's own flag still 404s every ECL route independently, so nav
  // visibility is presentation only; this is the app half of the two-switch model.
  const navFlags = {
    enterprise_context: process.env.SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED === "true",
    asset_registry: process.env.SECURELOGIC_ASSET_REGISTRY_ENABLED === "true",
    risk_intelligence: process.env.SECURELOGIC_RISK_INTELLIGENCE_ENABLED === "true",
    // Enterprise Risk Workspace IA/nav (ERIP Packages 1+2) — DARK (default off).
    // Flips the header to the enterprise-workflow information architecture and the
    // "Review Suggested Links" queue reskin. Flag off = legacy nav byte-for-byte.
    risk_workspace: process.env.SECURELOGIC_RISK_WORKSPACE_ENABLED === "true",
    // The Briefing (Briefing Initiative B1) — DARK (default off). Relabels the
    // workspace nav's home entry "Briefing"; only takes effect together with
    // risk_workspace (the legacy nav is never touched).
    briefing: process.env.SECURELOGIC_DASHBOARD_BRIEFING_ENABLED === "true",
    // Pen-test capability (PEN-1 / T2-I) — DARK (default off). ACTIVATION, not
    // entitlement: the Risk group is already platform-gated, and this is the
    // separate switch for whether Pen Tests is exposed at all. Same key the
    // engine reads, so hiding the nav entry never leaves a live route behind it.
    pen_test: penTestEnabled(),
    // Risk-acceptance capability (NAV-1 / P1-C) — DARK (default off). ACTIVATION
    // for the "Approvals" entry in both nav models. Same key the engine reads, so
    // the nav never advertises Approvals while /api/risk-acceptances 404s.
    risk_acceptance: riskAcceptanceEnabled(),
    // Vendor Assurance capability (VA-NAV-1) — ACTIVATION for the "Vendor
    // Assurance" group in both nav models. Same key the engine reads (and the
    // same resolver, including its non-production default), so the nav never
    // advertises the engagement spine while its engine routes 404.
    vendor_assurance: vendorAssuranceEnabled(),
  };

  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col bg-brand-bg text-slate-100" suppressHydrationWarning>
        {/* The external vendor portal (/portal) is a standalone surface: no
            internal nav, no links into the app. NonPortalChrome hides the
            header/footer there and renders them unchanged everywhere else. */}
        <NonPortalChrome>
          <Header
            isAuthenticated={isAuthenticated}
            isPlatformUser={isPlatformUser}
            isPremiumUser={isPremiumUser}
            isAdminUser={isAdminUser}
            isSsoEligible={isSsoEligible}
            navFlags={navFlags}
            organizationName={session.organizationName}
            userName={session.name}
            userEmail={session.email}
            userRole={session.userRole}
          />
        </NonPortalChrome>
        <main className="flex-1">{children}</main>
        {consent.consentRequired && (
          <ConsentInterstitial missingDocuments={consent.missingDocuments} />
        )}
        {isAuthenticated && <IdleLogout idleSeconds={getIdleSeconds()} />}
        <NonPortalChrome>
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
        </NonPortalChrome>
      </body>
    </html>
  );
}
