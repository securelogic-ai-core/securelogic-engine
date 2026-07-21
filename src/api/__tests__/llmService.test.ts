/**
 * llmService.test.ts — ERIP F1: the shared LLM service. Fake client only —
 * never the network. Covers graceful degradation, text extraction, refusal,
 * JSON extraction/validation, and the availability probe.
 */

import { describe, expect, it } from "vitest";
import {
  completeText,
  completeJson,
  extractJson,
  llmAvailable,
  type RawLlmClient
} from "../lib/llm/llmService.js";

function fakeClient(reply: {
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string | null;
  model?: string;
  throws?: string;
}): RawLlmClient {
  return {
    messages: {
      create: async () => {
        if (reply.throws) throw new Error(reply.throws);
        return {
          content: reply.content ?? [{ type: "text", text: "" }],
          stop_reason: reply.stop_reason ?? "end_turn",
          model: reply.model ?? "claude-sonnet-4-6"
        };
      }
    }
  };
}

describe("completeText", () => {
  it("degrades gracefully when no client is configured (null)", async () => {
    const r = await completeText({ messages: [{ role: "user", content: "hi" }], maxTokens: 10 }, { client: null });
    expect(r).toMatchObject({ ok: false, code: "llm_unavailable" });
  });

  it("returns joined text on success", async () => {
    const client = fakeClient({ content: [{ type: "text", text: "Hello " }, { type: "text", text: "world" }] });
    const r = await completeText({ messages: [{ role: "user", content: "x" }], maxTokens: 10 }, { client });
    expect(r).toMatchObject({ ok: true, text: "Hello world" });
  });

  it("surfaces a safety refusal distinctly", async () => {
    const client = fakeClient({ stop_reason: "refusal", content: [] });
    const r = await completeText({ messages: [{ role: "user", content: "x" }], maxTokens: 10 }, { client });
    expect(r).toMatchObject({ ok: false, code: "llm_refused" });
  });

  it("maps a thrown error to llm_failed", async () => {
    const client = fakeClient({ throws: "boom" });
    const r = await completeText({ messages: [{ role: "user", content: "x" }], maxTokens: 10 }, { client });
    expect(r).toMatchObject({ ok: false, code: "llm_failed", detail: "boom" });
  });

  it("empty completion is llm_failed", async () => {
    const client = fakeClient({ content: [{ type: "text", text: "   " }] });
    const r = await completeText({ messages: [{ role: "user", content: "x" }], maxTokens: 10 }, { client });
    expect(r).toMatchObject({ ok: false, code: "llm_failed" });
  });
});

describe("extractJson", () => {
  it("pulls a fenced JSON object out of prose", () => {
    expect(extractJson('Here it is:\n```json\n{"a":1}\n```\nDone')).toBe('{"a":1}');
  });
  it("pulls a bare object", () => {
    expect(extractJson('prefix {"a": {"b": 2}} suffix')).toBe('{"a": {"b": 2}}');
  });
  it("handles braces inside strings", () => {
    expect(extractJson('{"a": "}{ not a brace"}')).toBe('{"a": "}{ not a brace"}');
  });
  it("pulls an array", () => {
    expect(extractJson("[1, 2, 3]")).toBe("[1, 2, 3]");
  });
  it("returns null when there is no JSON", () => {
    expect(extractJson("no json here")).toBeNull();
  });
});

describe("completeJson", () => {
  const client = fakeClient({ content: [{ type: "text", text: '{"score": 42, "label": "high"}' }] });

  it("parses and validates", async () => {
    const r = await completeJson(
      { messages: [{ role: "user", content: "x" }], maxTokens: 50 },
      (raw) => {
        const o = raw as { score: number; label: string };
        if (typeof o.score !== "number") throw new Error("bad score");
        return o;
      },
      { client }
    );
    expect(r).toMatchObject({ ok: true, value: { score: 42, label: "high" } });
  });

  it("degrades to llm_invalid_json on a validation failure", async () => {
    const r = await completeJson(
      { messages: [{ role: "user", content: "x" }], maxTokens: 50 },
      () => {
        throw new Error("shape mismatch");
      },
      { client }
    );
    expect(r).toMatchObject({ ok: false, code: "llm_invalid_json" });
  });

  it("degrades to llm_invalid_json when no JSON is present", async () => {
    const noJson = fakeClient({ content: [{ type: "text", text: "sorry, no json" }] });
    const r = await completeJson({ messages: [{ role: "user", content: "x" }], maxTokens: 50 }, (raw) => raw, {
      client: noJson
    });
    expect(r).toMatchObject({ ok: false, code: "llm_invalid_json" });
  });

  it("propagates unavailable", async () => {
    const r = await completeJson({ messages: [{ role: "user", content: "x" }], maxTokens: 50 }, (raw) => raw, {
      client: null
    });
    expect(r).toMatchObject({ ok: false, code: "llm_unavailable" });
  });
});

describe("llmAvailable", () => {
  it("reflects ANTHROPIC_API_KEY presence", () => {
    expect(llmAvailable({} as NodeJS.ProcessEnv)).toBe(false);
    expect(llmAvailable({ ANTHROPIC_API_KEY: "  " } as NodeJS.ProcessEnv)).toBe(false);
    expect(llmAvailable({ ANTHROPIC_API_KEY: "sk-x" } as NodeJS.ProcessEnv)).toBe(true);
  });
});
