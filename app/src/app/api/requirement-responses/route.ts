import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { engineBaseUrl } from "@/lib/engineBaseUrl";

const ENGINE_URL = engineBaseUrl();

export async function POST(request: Request) {
  try {
    const session = await getSession();
    const token = session.jwtToken ?? session.apiKey ?? null;
    if (!token) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

    const body = await request.json();

    const res = await fetch(`${ENGINE_URL}/api/requirement-responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
