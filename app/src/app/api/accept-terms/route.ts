import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { acceptTerms, type ConsentDocumentType } from "@/lib/api";

const VALID_DOCS: ConsentDocumentType[] = [
  "terms_of_service",
  "privacy_policy",
  "ai_transparency_policy",
];

/**
 * BFF proxy for recording legal consent. Reads the JWT from the iron-session
 * cookie (never exposed to the browser) and forwards to the engine's
 * POST /api/auth/accept-terms.
 *
 * Note: the engine's accept-terms route is NOT behind requireConsent, so this
 * call can never trip the consent gate — no interstitial loop.
 */
export async function POST(request: Request) {
  const session = await getSession();
  const jwtToken = session.jwtToken;
  if (!jwtToken) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  // Optional, sanitized passthrough. Omitted → engine defaults to all missing.
  let acceptedDocuments: ConsentDocumentType[] | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as { acceptedDocuments?: unknown };
    if (Array.isArray(body.acceptedDocuments)) {
      acceptedDocuments = body.acceptedDocuments.filter(
        (d): d is ConsentDocumentType => typeof d === "string" && VALID_DOCS.includes(d as ConsentDocumentType)
      );
    }
  } catch {
    // Treat an unparseable body as "no explicit list" → accept all missing.
  }

  const result = await acceptTerms(jwtToken, acceptedDocuments);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
