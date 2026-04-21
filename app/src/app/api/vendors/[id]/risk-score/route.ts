import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    const token = session.jwtToken ?? session.apiKey ?? null;
    if (!token) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const res = await fetch(
      `${ENGINE_URL}/api/vendors/${encodeURIComponent(id)}/risk-score`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );

    const body = await res.json();
    return NextResponse.json(body, { status: res.status });
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
