/**
 * Base URL of the public marketing website (securelogic-website), used by the
 * app whenever it links OUT to marketing/legal pages — the Header logo/home
 * link and the consent legal links (terms / privacy / ai-policy).
 *
 * Environment-dependent and BUILD-TIME: `NEXT_PUBLIC_*` values are inlined when
 * the app is compiled, so each app service must set NEXT_PUBLIC_SITE_URL to its
 * OWN marketing site at build time and be REBUILT for a change to take effect —
 * a running container cannot be re-pointed by flipping the env var.
 *   - Prod app     → https://www.securelogicai.com
 *   - Staging app  → the staging marketing URL
 *                    (https://securelogic-website-staging.onrender.com)
 *
 * The `?? "https://www.securelogicai.com"` fallback is the repo's ratified,
 * drift-guard-blessed form (scripts/check-env-url-drift.mjs) and matches
 * website/src/app/layout.tsx. It keeps PROD deterministically correct even if
 * the env var is ever unset; the staging build MUST set the var to avoid
 * linking staging users back to the production marketing site.
 */
export function getSiteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.securelogicai.com").replace(/\/+$/, "");
}
