import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    const token = session.jwtToken ?? session.apiKey ?? null;
    if (!token) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const res = await fetch(
      `${ENGINE_URL}/api/vendors/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      }
    );

    const responseBody = await res.json();
    return NextResponse.json(responseBody, { status: res.status });
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
