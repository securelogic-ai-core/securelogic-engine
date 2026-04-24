/**
 * Resolves the public-facing origin from request headers.
 *
 * Behind a reverse proxy (Render), request.url contains the internal
 * Next.js host (e.g. localhost:3000). The real external origin lives
 * in the x-forwarded-proto and x-forwarded-host headers set by the
 * proxy. Without these, a redirect Location header points at the
 * internal host and the browser needs a second hop to resolve the
 * real URL.
 */
export function getOrigin(request: Request): string {
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) return `${proto}://${host}`;
  return new URL(request.url).origin;
}
