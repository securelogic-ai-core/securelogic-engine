import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getOrgSettings } from "@/lib/api";
import { AskClient } from "./AskClient";

export default async function AskPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

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
