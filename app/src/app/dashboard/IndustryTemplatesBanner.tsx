import Link from "next/link";
import type { AuthMeResponse } from "@/lib/api";
import { DismissBannerButton } from "./DismissBannerButton";

const BANNER_KEY = "industry-templates-banner";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * IndustryTemplatesBanner
 *
 * Visible when ALL of:
 *   - SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED env var is "true" OR
 *     NODE_ENV !== "production" (the same gate the engine route uses)
 *   - User is within their first 7 days post-signup (users.created_at)
 *   - User has not dismissed this banner key
 *
 * The env gate is checked server-side via process.env in this component
 * (Next.js server runtime). When the gate is closed the banner returns
 * null — same shape as a server-rendered "this banner does not apply".
 *
 * The user-creation-date and dismissed-keys come from authMe (extended
 * /api/auth/me payload). When authMe is null (legacy API-key sessions)
 * the banner is hidden — those sessions don't have a per-user identity
 * to dismiss against.
 */
export function IndustryTemplatesBanner({
  authMe,
}: {
  authMe: AuthMeResponse | null;
}) {
  if (!templatesGateOpen()) return null;
  if (authMe === null) return null;

  if (Array.isArray(authMe.dismissedBannerKeys) && authMe.dismissedBannerKeys.includes(BANNER_KEY)) {
    return null;
  }

  if (authMe.userCreatedAt === undefined || authMe.userCreatedAt === null) return null;
  const createdMs = new Date(authMe.userCreatedAt).getTime();
  if (!Number.isFinite(createdMs)) return null;
  if (Date.now() - createdMs > SEVEN_DAYS_MS) return null;

  return (
    <div
      className="mb-4 flex items-center justify-between gap-4 rounded-xl px-5 py-4 flex-wrap"
      style={{
        background: "rgba(96,165,250,0.06)",
        border: "1px solid rgba(96,165,250,0.25)",
      }}
    >
      <div>
        <p className="text-sm font-semibold mb-0.5" style={{ color: "#60a5fa" }}>
          Get started faster — load an industry template
        </p>
        <p className="text-xs" style={{ color: "#94a3b8" }}>
          Pre-built bundles of vendors, obligations, and controls scoped to
          your industry. Edit, delete, or extend after loading.
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Link
          href="/templates"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold"
          style={{ background: "#2563eb", color: "white" }}
        >
          Browse templates →
        </Link>
        <DismissBannerButton bannerKey={BANNER_KEY} />
      </div>
    </div>
  );
}

function templatesGateOpen(): boolean {
  if (process.env.SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED === "true") return true;
  if (process.env.NODE_ENV !== "production") return true;
  return false;
}
