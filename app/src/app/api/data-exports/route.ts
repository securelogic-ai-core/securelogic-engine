/**
 * BFF proxy for self-service data exports (GDPR/CCPA, user_self scope).
 *
 * Both handlers read the JWT from the iron-session cookie (never exposed to the
 * browser) and forward it as Authorization: Bearer to the engine. The browser
 * only ever talks to this same-origin route — it never sees the token and never
 * calls the engine directly.
 *
 * JWT-only by design: a legacy API-key session has no `jwtToken`, so these
 * return 401 here without a round-trip. The privacy page hides the export
 * surface for those sessions (the engine would answer 403 jwt_required anyway).
 *
 *   POST → engine POST /api/data-exports — request an export.
 *          Passes through 202 {jobId,status,scope} and 409 export_already_pending.
 *   GET  → engine GET  /api/data-exports — list my requests + bundles.
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<NextResponse> {
  const session = await getSession();
  const jwtToken = session.jwtToken;
  if (!jwtToken) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let engineRes: Response;
  try {
    engineRes = await fetch(`${ENGINE_URL}/api/data-exports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwtToken}`, "Content-Type": "application/json" },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  // Pass the engine's status + body straight through: 202 {jobId,status,scope}
  // on success, 409 {error:"export_already_pending"} when one is already queued.
  const body = await engineRes.json().catch(() => ({}));
  return NextResponse.json(body, { status: engineRes.status });
}

export async function GET(): Promise<NextResponse> {
  const session = await getSession();
  const jwtToken = session.jwtToken;
  if (!jwtToken) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let engineRes: Response;
  try {
    engineRes = await fetch(`${ENGINE_URL}/api/data-exports`, {
      method: "GET",
      headers: { Authorization: `Bearer ${jwtToken}` },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  const body = await engineRes.json().catch(() => ({}));
  return NextResponse.json(body, { status: engineRes.status });
}
