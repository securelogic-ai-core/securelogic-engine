import { getSession } from "@/lib/session";
import { resolveReturnLink } from "./authReturnLink";

/**
 * Server-rendered "Return to Dashboard" escape hatch for the auth pages.
 *
 * Auth pages render a full-bleed card with no app chrome; an already-signed-in
 * visitor who lands on one (stale bookmark, external link, or a token flow such
 * as reset-password / accept-invite) would otherwise be stranded with no way
 * back into the product.
 *
 * The session cookie is httpOnly, so the signed-in state is read here on the
 * server (no client-side session detection). Unauthenticated visitors render
 * nothing — they have no dashboard to return to, and a link that just looped
 * them back to /login would be noise. Mounted via each auth route's layout so
 * placement is identical across AuthCard and non-AuthCard (accept-invite) pages.
 */
export async function AuthReturnLink() {
  const session = await getSession();
  const link = resolveReturnLink(session);
  if (!link) return null;

  return (
    <a
      href={link.href}
      style={{
        position: "fixed",
        top: "18px",
        left: "20px",
        zIndex: 10,
        fontSize: "14px",
        fontWeight: 500,
        color: "#00c4b4",
        textDecoration: "none",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {link.label}
    </a>
  );
}
