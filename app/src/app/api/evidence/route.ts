import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

/**
 * Proxies GET/POST /api/evidence — the generic evidence surface.
 *
 * The engine has accepted `source_type: "finding"` since 20260420, and POST even
 * recomputes the finding's operational_status on write (routes/evidence.ts:242).
 * What was missing was any browser-reachable path to it: the findings UI could
 * only ever *read* a count. For an org enforcing `require_evidence_gate` that was
 * a deadlock — a finding whose Actions were all closed could never reach
 * `remediated`, because nothing in the product could create the evidence row the
 * gate waits for. This proxy is the missing half.
 *
 * Generic rather than /findings/:id/evidence: the engine route is already
 * source-type-agnostic and validates the source record's org ownership itself, so
 * a per-source proxy would be duplication. Controls and obligations read through
 * the same engine route today.
 *
 * Evidence is immutable by design (routes/evidence.ts has no DELETE), so there is
 * no detach here — unlike risks, which has a bespoke soft-detach route.
 */

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const sourceType = request.nextUrl.searchParams.get("source_type");
  const sourceId = request.nextUrl.searchParams.get("source_id");
  if (!sourceType || !sourceId) {
    return NextResponse.json({ error: "source_type_and_source_id_required" }, { status: 400 });
  }

  const qs = new URLSearchParams({ source_type: sourceType, source_id: sourceId });

  let upstream: Response;
  try {
    upstream = await fetch(`${ENGINE_URL}/api/evidence?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }
  const body = await upstream.json().catch(() => ({ error: "invalid_json" }));
  return NextResponse.json(body, { status: upstream.status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const payload = await request.json().catch(() => ({}));

  let upstream: Response;
  try {
    upstream = await fetch(`${ENGINE_URL}/api/evidence`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }
  const body = await upstream.json().catch(() => ({ error: "invalid_json" }));
  return NextResponse.json(body, { status: upstream.status });
}
