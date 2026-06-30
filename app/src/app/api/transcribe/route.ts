import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { getSessionOptions, type SessionData } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const session = await getIronSession<SessionData>(cookieStore, getSessionOptions());
    const token = session.jwtToken ?? session.apiKey ?? null;

    if (!token) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // Forward the multipart audio to the engine server-side.
    // We must not set Content-Type manually — fetch sets it with the
    // correct multipart boundary when given a FormData body.
    const formData = await request.formData();

    // Forward the voice diagnostic correlation id (non-sensitive) so one iPad
    // attempt is traceable browser → app → engine.
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "x-api-key": token,
    };
    const diagnosticId = request.headers.get("x-voice-diagnostic-id");
    if (diagnosticId) headers["x-voice-diagnostic-id"] = diagnosticId;

    const engineRes = await fetch(`${ENGINE_URL}/api/ask/transcribe`, {
      method: "POST",
      headers,
      body: formData,
    });

    if (!engineRes.ok) {
      const err = await engineRes.json().catch(() => ({ error: "transcription_failed" }));
      return NextResponse.json(err, { status: engineRes.status });
    }

    const data = await engineRes.json() as { text: string };
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "transcription_failed" }, { status: 500 });
  }
}
