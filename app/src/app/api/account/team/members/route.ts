import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

/**
 * Browser-callable proxy for GET /api/team/members on the engine.
 *
 * Used by client components (e.g. UserPicker) that need the current
 * org's roster for owner/assignee selection. Pages that already load
 * team data server-side should keep doing that and pass it down as
 * props rather than calling this route.
 */
export async function GET() {
  const session = await getSession();
  const token = session.jwtToken;

  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${ENGINE_URL}/api/team/members`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
