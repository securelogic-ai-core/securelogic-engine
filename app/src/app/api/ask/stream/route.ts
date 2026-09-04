/**
 * Same-origin SSE proxy for Ask streaming (Launch Completion 3).
 *
 * The Ask page calls the engine through server actions, which return exactly
 * one value and therefore cannot stream. This route handler is the streaming
 * path: it authenticates from the iron-session (mirroring the transcribe
 * proxy), forwards the question to the engine's POST /api/ask/stream, and
 * pipes the SSE body back UNBUFFERED — `engineRes.body` is handed to the
 * Response directly. Buffering here (the vendor-portal proxy's arrayBuffer
 * approach) would collapse the stream into one late flush and defeat it.
 *
 * When the engine has streaming dark (404), the client falls back to the
 * non-streaming server action — but normally it never gets here: the page
 * reads SECURELOGIC_ASK_STREAMING_ENABLED at render (two-switch model) and
 * doesn't attempt the stream at all.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { getSessionOptions, type SessionData } from "@/lib/session";
import { engineBaseUrl } from "@/lib/engineBaseUrl";

const ENGINE_URL = engineBaseUrl();

/** Orchestration is capped at 6 model rounds; 3 minutes bounds a hung engine. */
const STREAM_TIMEOUT_MS = 180_000;

export async function POST(request: Request): Promise<Response> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, getSessionOptions());
  const token = session.jwtToken ?? session.apiKey ?? null;

  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: string;
  try {
    body = JSON.stringify(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

  let engineRes: Response;
  try {
    engineRes = await fetch(`${ENGINE_URL}/api/ask/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body,
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeoutId);
    return NextResponse.json({ error: "ask_unavailable" }, { status: 502 });
  }

  if (!engineRes.ok || !engineRes.body) {
    clearTimeout(timeoutId);
    const err = await engineRes
      .json()
      .catch(() => ({ error: "ask_failed" }));
    return NextResponse.json(err, { status: engineRes.status });
  }

  // Pipe the SSE stream through, clearing the watchdog when it ends. The
  // engine bounds the stream's lifetime; the abort above only covers a hang.
  const upstream = engineRes.body;
  const stream = new ReadableStream({
    async start(streamController) {
      const reader = upstream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          streamController.enqueue(value);
        }
        streamController.close();
      } catch (err) {
        streamController.error(err);
      } finally {
        clearTimeout(timeoutId);
      }
    },
    cancel(reason) {
      clearTimeout(timeoutId);
      void upstream.cancel(reason);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
