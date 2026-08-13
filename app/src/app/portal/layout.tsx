import type { Metadata } from "next";
import PortalShell from "./PortalShell";

/**
 * External vendor portal layout. A standalone surface: the root layout's app
 * chrome is suppressed on /portal (see NonPortalChrome), and PortalShell
 * renders the portal's own minimal header instead — the requesting
 * organization's name, never internal navigation.
 */

export const metadata: Metadata = {
  title: "Vendor Assurance Portal — SecureLogic AI",
  description: "Respond to a security and compliance assessment request.",
  robots: { index: false, follow: false },
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}
