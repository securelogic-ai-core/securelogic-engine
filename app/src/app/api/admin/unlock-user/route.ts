import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_URL ?? "https://securelogic-engine.onrender.com";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session.jwtToken) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as { user_id?: unknown };

    const res = await fetch(`${ENGINE_URL}/api/auth/admin/unlock-user`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${session.jwtToken}`,
      },
      body: JSON.stringify({ user_id: body.user_id }),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "unlock_failed" }, { status: 500 });
  }
}
