import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { AskClient } from "./AskClient";

export default async function AskPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  // Two-switch model (LC-3): the app decides at render whether to attempt the
  // SSE path at all, so a dark engine flag costs zero probe requests. The
  // engine's own flag still gates the endpoint (404) independently.
  const streamingEnabled = process.env.SECURELOGIC_ASK_STREAMING_ENABLED === "true";

  return <AskClient streamingEnabled={streamingEnabled} />;
}
