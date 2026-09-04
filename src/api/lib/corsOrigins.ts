/**
 * corsOrigins — which browser origins may call the engine directly.
 *
 * The allowlist was a hard-coded set of the three production origins. That is
 * correct for production and silently wrong for every other deployment: the
 * staging engine (which runs with isDev=false, like production) refused its
 * own staging app's origin, so the login page's SSO availability check —
 * the one browser-direct call on the sign-in path — failed CORS on every
 * load. Chromium logged it; WebKit raised it as a page error.
 *
 * The deployment already declares where its app lives: `APP_BASE_URL` is the
 * canonical, env-driven app URL (SSO callbacks, billing return URLs, recovery
 * emails all reuse it). Its origin is therefore allowed too. In production
 * that origin is `https://app.securelogicai.com`, already in the set — the
 * production allowlist does not change. No wildcard is introduced: one exact
 * origin, derived from configuration the deployment already trusts, and only
 * over https outside dev.
 */

export const PRODUCTION_ORIGINS: readonly string[] = [
  "https://www.securelogicai.com",
  "https://securelogicai.com",
  "https://app.securelogicai.com",
];

// Dev origins: github.dev previews (*.app.github.dev) plus localhost variants.
export const DEV_ORIGIN_RE =
  /^https:\/\/[a-z0-9-]+-[a-z0-9]+-[a-z0-9]+\.app\.github\.dev$|^https?:\/\/localhost(:\d+)?$|^https?:\/\/127\.0\.0\.1(:\d+)?$/;

/**
 * The exact origin of APP_BASE_URL, or null when unset, unparseable, or not
 * https (an http app origin is a dev shape and is covered by DEV_ORIGIN_RE
 * when isDev — never allowed on its own).
 */
export function ownAppOrigin(appBaseUrl: string | undefined | null): string | null {
  const raw = (appBaseUrl ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Exact-match allowlist: production origins plus this deployment's own app origin. */
export function buildAllowedOrigins(env: { APP_BASE_URL?: string | undefined } = { APP_BASE_URL: process.env.APP_BASE_URL }): Set<string> {
  const allowed = new Set<string>(PRODUCTION_ORIGINS);
  const own = ownAppOrigin(env.APP_BASE_URL);
  if (own) allowed.add(own);
  return allowed;
}

/**
 * The cors() `origin` decision. Absent Origin (same-origin / non-browser) is
 * allowed; otherwise exact allowlist membership, or a dev-shaped origin when
 * the process runs in dev.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  opts: { allowed: ReadonlySet<string>; isDev: boolean }
): boolean {
  if (!origin) return true;
  if (opts.allowed.has(origin)) return true;
  if (opts.isDev && DEV_ORIGIN_RE.test(origin)) return true;
  return false;
}
