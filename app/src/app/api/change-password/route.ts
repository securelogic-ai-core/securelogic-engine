import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_URL ?? "https://securelogic-engine.onrender.com";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session.jwtToken) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      current_password?: unknown;
      new_password?: unknown;
    };

    const res = await fetch(`${ENGINE_URL}/api/auth/change-password`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${session.jwtToken}`,
      },
      body: JSON.stringify({
        current_password: body.current_password,
        new_password:     body.new_password,
      }),
    });

    const data = await res.json() as { success?: boolean; token?: string; error?: string };

    // If the engine issued a fresh JWT, update the iron-session so the
    // current device is not immediately invalidated by the iat check.
    if (res.ok && typeof data.token === "string") {
      session.jwtToken = data.token;
      await session.save();
    }

    return NextResponse.json({ success: data.success, error: data.error }, { status: res.status });
  } catch {
    return NextResponse.json({ error: "change_password_failed" }, { status: 500 });
  }
}
