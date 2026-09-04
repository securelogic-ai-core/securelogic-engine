/**
 * engineBaseUrl — the ONE place the app turns "where is the engine" into a URL.
 *
 * Why this exists: the staging app's browser-facing engine URL was configured
 * with a trailing slash, and every call site built `${ENGINE_URL}/api/...`,
 * which produced `https://host//api/sso/check-domain`. Chromium logged a CORS
 * error for it; WebKit raised it as a page exception on every login-page load.
 * The value was wrong AND the code trusted it byte-for-byte. Configuration is
 * allowed to be untidy; URL construction is not allowed to depend on that.
 *
 * Two environment variables, two readers:
 * - `ENGINE_API_URL`          server-side (route handlers, server actions, lib/api)
 * - `NEXT_PUBLIC_ENGINE_URL`  browser-side (inlined by Next at build time; it must
 *                             be referenced as a literal `process.env.NEXT_PUBLIC_…`
 *                             member access, which it is below)
 *
 * The dev fallback is localhost — NEVER a production host — so a missing value in
 * a staging build fails locally instead of silently routing to production.
 */

export const ENGINE_DEV_FALLBACK = "http://localhost:4000";

/**
 * Trim whitespace and strip every trailing slash. An empty or unset value
 * yields the fallback (also normalized). Only the trailing boundary is touched:
 * a base URL with a path prefix (`https://host/engine`) survives intact.
 */
export function normalizeBaseUrl(raw: string | null | undefined, fallback: string): string {
  const candidate = (raw ?? "").trim();
  const chosen = candidate.length > 0 ? candidate : fallback;
  return chosen.trim().replace(/\/+$/, "");
}

/**
 * Join a base URL and a path with EXACTLY one slash at the boundary, whatever
 * either side carries. `joinEngineUrl("https://h/", "/api/x")` → `https://h/api/x`;
 * `joinEngineUrl("https://h", "api/x")` → the same.
 */
export function joinEngineUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** Server-side engine base URL (`ENGINE_API_URL`), normalized. */
export function engineBaseUrl(): string {
  return normalizeBaseUrl(process.env.ENGINE_API_URL, ENGINE_DEV_FALLBACK);
}

/** Browser-facing engine base URL (`NEXT_PUBLIC_ENGINE_URL`), normalized. */
export function browserEngineBaseUrl(): string {
  return normalizeBaseUrl(process.env.NEXT_PUBLIC_ENGINE_URL, ENGINE_DEV_FALLBACK);
}
