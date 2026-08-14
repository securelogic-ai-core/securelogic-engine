/**
 * askStream.ts — client-side consumer of the Ask SSE endpoint (LC-3).
 *
 * POSTs to the same-origin proxy (/api/ask/stream) and parses the engine's
 * event stream. EventSource cannot POST, so this is a fetch-reader parse.
 *
 * Contract with the engine (src/api/routes/ask.ts, handleWithToolsStream):
 *
 *   round      a model turn began — RESET the preview text; a turn that ended
 *              in tool calls produced interim prose the next turn supersedes.
 *   delta      append a text fragment to the preview.
 *   tool_call  one authorized-retrieval step completed; UI activity signal.
 *   final      the authoritative response, byte-shape-identical to the
 *              non-streaming JSON body. ALWAYS replaces the preview — the
 *              provenance pass may have re-rendered the prose after the last
 *              delta.
 *   error      terminal failure after headers were sent.
 *
 * Outcomes are a closed union so AskClient can branch exhaustively:
 * `fallback` means "this deployment does not stream" (endpoint dark → 404) and
 * the caller should run the non-streaming server action instead — silently.
 */

import type { AskResponse } from "@/lib/api";

export type AskStreamHandlers = {
  onRound: () => void;
  onDelta: (text: string) => void;
  onToolCall: (tool: string, authorized: boolean) => void;
};

export type AskStreamOutcome =
  | { kind: "final"; data: AskResponse }
  | { kind: "error"; status: number; code?: string; message?: string }
  | { kind: "fallback" };

/**
 * Incremental SSE frame parser. Feed it decoded chunks in arrival order; it
 * invokes the callback once per complete `event:`/`data:` frame. Handles
 * frames split across chunk boundaries (the normal case under TCP) and both
 * \n\n and \r\n\r\n frame delimiters. Multi-`data:`-line frames are joined
 * with \n per the SSE spec, though the engine never emits them.
 */
export function createSseParser(
  onFrame: (event: string, data: string) => void
): (chunk: string) => void {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const boundary = buffer.search(/\r?\n\r?\n/);
      if (boundary === -1) break;
      const rawFrame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
      let event = "message";
      const dataLines: string[] = [];
      for (const line of rawFrame.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length > 0) onFrame(event, dataLines.join("\n"));
    }
  };
}

export async function streamAsk(
  question: string,
  conversationId: string | null,
  handlers: AskStreamHandlers,
  fetchImpl: typeof fetch = fetch
): Promise<AskStreamOutcome> {
  let res: Response;
  try {
    res = await fetchImpl("/api/ask/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        conversationId ? { question, conversation_id: conversationId } : { question }
      ),
    });
  } catch {
    return { kind: "error", status: 0, code: "network_error" };
  }

  // 404/405: the endpoint is dark on this deployment (flag off, or an older
  // engine). Not an error the user should see — use the non-streaming path.
  if (res.status === 404 || res.status === 405) return { kind: "fallback" };

  if (!res.ok) {
    let body: { error?: string; message?: string } = {};
    try {
      body = (await res.json()) as { error?: string; message?: string };
    } catch {
      // non-JSON error body — status alone still routes the message table
    }
    return { kind: "error", status: res.status, code: body.error, message: body.message };
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream") || !res.body) {
    // Something between us and the engine rewrote the response; the
    // non-streaming path still works, so use it rather than failing the turn.
    return { kind: "fallback" };
  }

  let outcome: AskStreamOutcome | null = null;

  const parse = createSseParser((event, data) => {
    if (outcome) return; // terminal frame already seen; ignore trailing noise
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // a malformed frame is dropped, not fatal — final decides
    }
    const record = parsed as Record<string, unknown>;
    switch (event) {
      case "round":
        handlers.onRound();
        break;
      case "delta":
        if (typeof record.text === "string") handlers.onDelta(record.text);
        break;
      case "tool_call":
        if (typeof record.tool === "string") {
          handlers.onToolCall(record.tool, record.authorized === true);
        }
        break;
      case "final":
        outcome = { kind: "final", data: parsed as AskResponse };
        break;
      case "error":
        outcome = {
          kind: "error",
          status: 502,
          code: typeof record.error === "string" ? record.error : "ask_failed",
          ...(typeof record.message === "string" ? { message: record.message } : {}),
        };
        break;
    }
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parse(decoder.decode(value, { stream: true }));
      if (outcome) break;
    }
  } catch {
    if (!outcome) return { kind: "error", status: 0, code: "stream_interrupted" };
  }

  // A stream that ended without a terminal frame is a failure, not a success
  // with empty text — the preview must never be mistaken for the answer.
  return outcome ?? { kind: "error", status: 0, code: "stream_interrupted" };
}
