import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import NewAiSystemClient from "./NewAiSystemClient";

// Server wrapper — mirrors the Vendor create flow's structure (server page reads
// the session + searchParams, renders the client form). The AI-system create
// surface is NOT platform-gated (its list page and createAiSystem action are
// token-only — entitlement is enforced by the engine POST /api/ai-systems), so
// this wrapper intentionally keeps that access model: only the unauthenticated
// redirect, no isPlatformUser gate, to avoid regressing the existing workflow.
export default async function NewAiSystemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  // Framed as a registry asset-type flow when opened from /assets — the back link
  // returns to the Asset Registry instead of the AI Systems list. Form unchanged.
  const fromRegistry = (await searchParams).from === "registry";

  return fromRegistry ? (
    <NewAiSystemClient backHref="/assets" backLabel="Assets" />
  ) : (
    <NewAiSystemClient />
  );
}
