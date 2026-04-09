import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { getSession } from "@/lib/session";

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
  const isAuthenticated = Boolean(session.apiKey);

  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col bg-slate-50 text-slate-900" suppressHydrationWarning>
        <Header
          isAuthenticated={isAuthenticated}
          organizationName={session.organizationName}
        />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-slate-200 bg-white mt-16">
          <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between">
            <span className="text-slate-400 text-sm">
              © {new Date().getFullYear()} SecureLogic AI. All rights reserved.
            </span>
            <span className="text-slate-300 text-xs font-medium uppercase tracking-wide">
              Enterprise Risk Intelligence
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
