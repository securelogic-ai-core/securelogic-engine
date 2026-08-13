import AcceptClient from "./AcceptClient";

/**
 * Invite landing: /portal/accept/[token].
 *
 * Server wrapper only — it unwraps the route param and hands the token to the
 * client exchange flow. The token appears in this URL exactly once (the
 * emailed link); the client exchanges it for an httpOnly cookie and replaces
 * the URL, and the token is never rendered or persisted anywhere.
 */
export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <AcceptClient token={token} />;
}
