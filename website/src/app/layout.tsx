import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.securelogicai.com";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.securelogicai.com";

export const metadata: Metadata = {
  title: {
    default: "SecureLogic AI — Unified Risk Intelligence Platform",
    template: "%s | SecureLogic AI",
  },
  description:
    "SecureLogic AI is a Unified Risk Intelligence Platform that helps organizations see, understand, and act on their total risk exposure across vendors, controls, compliance frameworks, and AI systems.",
  metadataBase: new URL(SITE_URL),
  openGraph: {
    siteName: "SecureLogic AI",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col font-sans">
        <Nav appUrl={APP_URL} />
        <main className="flex-1">{children}</main>
        <Footer appUrl={APP_URL} />
      </body>
    </html>
  );
}
