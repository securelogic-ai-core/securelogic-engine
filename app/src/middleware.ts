import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "sl_session";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/briefs",
  "/account",
  "/vendors",
  "/ai-systems",
  "/controls",
];

/**
 * Lightweight session guard.
 *
 * If the session cookie is absent, redirect to /login.
 * Full cookie decryption and validation happens inside each
 * Server Component via getSession() — middleware only checks
 * cookie presence to avoid edge-runtime crypto overhead.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) return NextResponse.next();

  const session = request.cookies.get(COOKIE_NAME);
  if (!session?.value) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/briefs/:path*",
    "/account/:path*",
    "/vendors/:path*",
    "/ai-systems/:path*",
    "/controls/:path*",
  ],
};
