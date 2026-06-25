import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.securelogicai.com";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.securelogicai.com";

export const metadata: Metadata = {
  title: {
    default: "SecureLogic AI — Cyber Risk Intelligence. Delivered Weekly.",
    template: "%s | SecureLogic AI",
  },
  description:
    "SecureLogic AI helps security teams turn cyber, vendor, AI governance, and compliance signals into clear, prioritized action.",
  metadataBase: new URL(SITE_URL),
  openGraph: {
    siteName: "SecureLogic AI",
    type: "website",
    title: "SecureLogic AI — Cyber Risk Intelligence. Delivered Weekly.",
    description:
      "SecureLogic AI helps security teams turn cyber, vendor, AI governance, and compliance signals into clear, prioritized action.",
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
