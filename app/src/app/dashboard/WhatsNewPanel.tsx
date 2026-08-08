import type { AuthMeResponse } from "@/lib/api";
import { WAVE_1_RELEASE } from "@/lib/whatsNew";
import { WhatsNewClient } from "./WhatsNewClient";

/**
 * WhatsNewPanel — server-side gate for the Wave 1 orientation panel.
 *
 * Visible when ALL of:
 *   - the Wave 1 change actually happened in THIS environment
 *     (SECURELOGIC_RISK_WORKSPACE_ENABLED === "true")
 *   - we have a per-user identity to dismiss against (authMe !== null)
 *   - the user has not already dismissed it
 *
 * THE FLAG GATE IS THE POINT, NOT A FORMALITY.
 *
 * The panel announces that surfaces moved into the navigation. Under the legacy
 * IA those surfaces are NOT in the navigation, so showing this text there would
 * send customers looking for menu items that do not exist — actively worse than
 * saying nothing. The gate gives the panel the same lifecycle as the change it
 * describes: it cannot appear before the promotion, and it disappears if the
 * promotion is rolled back.
 *
 * `risk_workspace` is the correct flag to key on because it is the one that
 * changes the navigation, which is what every item in the release notes refers
 * to. Keying on the briefing flag instead would let the panel appear while the
 * menu was still legacy.
 *
 * Legacy API-key sessions have no per-user identity, so there is nothing to
 * dismiss against and the panel is withheld rather than shown un-dismissably —
 * same rule as IndustryTemplatesBanner.
 */
export function WhatsNewPanel({ authMe }: { authMe: AuthMeResponse | null }) {
  if (process.env.SECURELOGIC_RISK_WORKSPACE_ENABLED !== "true") return null;
  if (authMe === null) return null;

  const dismissed =
    Array.isArray(authMe.dismissedBannerKeys) &&
    authMe.dismissedBannerKeys.includes(WAVE_1_RELEASE.bannerKey);
  if (dismissed) return null;

  return <WhatsNewClient release={WAVE_1_RELEASE} />;
}
