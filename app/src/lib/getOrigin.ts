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
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    // Behind a proxy, x-forwarded-proto is authoritative. Its ABSENCE means we
    // are not behind one — local development — so the request's own scheme is
    // the right answer. Defaulting to https there handed the browser an
    // https:// URL for an http:// dev server (#823). Inert in staging and
    // production, where Render always sets the header.
    const proto = forwardedProto ?? new URL(request.url).protocol.replace(":", "");
    return `${proto}://${host}`;
  }
  return new URL(request.url).origin;
}
