import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { isPlatformEntitled } from "@/lib/entitlements";
import { getOrgSettings } from "@/lib/api";
import { AskClient } from "./AskClient";

export default async function AskPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  // Ask is a PLATFORM surface (ruling 2026-08-15). Every Ask route on the
  // engine — /ask, /ask/stream, /ask/conversations, /ask/conversations/:id —
  // sits behind requireEntitlement("premium"), so a lower tier gets a 403 from
  // the first question onward.
  //
  // Without this gate the page rendered in full for a professional-tier user:
  // the textarea, the pitch ("Ask anything about your risk posture in plain
  // English") and example prompts like "Show me my critical active findings",
  // with no upgrade state anywhere — every one of which 403s. A paying customer
  // was walked into a dead end. Verified on staging with a professional tenant;
  // see the §2.5 ruling and W-7 in
  // docs/validation/lc-integrated-staging-walkthrough.md.
  //
  // Redirect rather than an upsell panel, because that is what every other
  // platform page here already does (vendor-assurance:105, vendor-engagements,
  // findings, risks). A one-off upgrade screen on this page alone would be a
  // second, inconsistent answer to a question the app has already settled.
  if (!isPlatformEntitled(session.entitlementLevel)) redirect("/dashboard");

  // Two-switch model (LC-3): the app decides at render whether to attempt the
  // SSE path at all, so a dark engine flag costs zero probe requests. The
  // engine's own flag still gates the endpoint (404) independently.
  const streamingEnabled = process.env.SECURELOGIC_ASK_STREAMING_ENABLED === "true";

  // Voice governance (ASK-C, LC-4). Kill switch defaults ON (live capability);
  // the tenant setting defaults enabled when absent (engine predating the
  // column). Engine-side enforcement on the transcribe route is authoritative
  // regardless of what renders here.
  const voiceKillSwitchOn = process.env.SECURELOGIC_ASK_VOICE_ENABLED !== "false";
  const orgSettings = voiceKillSwitchOn ? await getOrgSettings(token) : null;
  const voiceEnabled = voiceKillSwitchOn && orgSettings?.voice_input_enabled !== false;

  // LC-4 realtime loop (spoken readback, browser-local) — dark launch.
  const readbackEnabled =
    voiceEnabled && process.env.SECURELOGIC_ASK_VOICE_REALTIME_ENABLED === "true";

  return (
    <AskClient
      streamingEnabled={streamingEnabled}
      voiceEnabled={voiceEnabled}
      readbackEnabled={readbackEnabled}
    />
  );
}
