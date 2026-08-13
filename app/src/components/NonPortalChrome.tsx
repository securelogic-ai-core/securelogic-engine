"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Hides the internal app chrome (header nav, footer) on the external vendor
 * portal (/portal/...). The portal is a standalone surface for a third party's
 * compliance contact: it must show NO internal navigation and no links into
 * the app — including when an internal user with a live app session opens a
 * portal link in the same browser.
 *
 * Presentation-only: session enforcement is unchanged (middleware treats
 * /portal as public; the engine enforces the portal cookie on every API call).
 */
export default function NonPortalChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/portal" || pathname.startsWith("/portal/")) return null;
  return <>{children}</>;
}
