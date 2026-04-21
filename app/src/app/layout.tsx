import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { getSession } from "@/lib/session";
import IdleLogout from "@/components/IdleLogout";

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
        {isAuthenticated && <IdleLogout />}
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
