import type { ReactNode } from "react";
import { AuthReturnLink } from "./AuthReturnLink";

/**
 * Shared layout for the auth routes. Renders the page unchanged and appends the
 * server-rendered Return-to-Dashboard link (visible only to authenticated
 * sessions). Each auth route's layout.tsx re-exports this so the escape hatch
 * is mounted consistently without touching the (client) page/form code.
 */
export default function AuthReturnLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <AuthReturnLink />
    </>
  );
}
