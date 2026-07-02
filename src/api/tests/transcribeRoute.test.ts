import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// The engine must have an OpenAI key for getOpenAIClient() to build a client.
process.env.OPENAI_API_KEY = "test-key";

// Pass-through auth/entitlement so we can exercise the upload pipeline without a
// DB. (Mocking these modules also means their real postgres imports never load.)
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (req: any, _res: any, next: any) => {
    req.organizationId = "11111111-1111-4111-8111-111111111111";
    next();
  },
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (req: any, _res: any, next: any) => {
    req.organizationContext = { organizationId: "11111111-1111-4111-8111-111111111111" };
    next();
  },
}));
vi.mock("../middleware/requireEntitlement.js", () => ({
  requireEntitlement: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("express-rate-limit", () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
  ipKeyGenerator: (ip: string) => ip,
}));
vi.mock("../infra/providerQuotaAlert.js", () => ({
  instrumentOpenAIClient: (c: unknown) => c,
  instrumentAnthropicClient: (c: unknown) => c,
}));

// Whisper stub — returns fixed text without any network call.
const transcribeCreate = vi.fn(async () => ({ text: "what are my top risks" }));
vi.mock("openai", () => ({
  default: class {
    audio = { transcriptions: { create: transcribeCreate } };
  },
}));

import transcribeRouter from "../routes/transcribe.js";
import { enforceJsonContentType } from "../lib/contentTypeAllowlist.js";

function makeApp() {
  const app = express();
  // Real content-type guard in front, exactly as production mounts it.
  app.use(enforceJsonContentType);
  app.use("/api", transcribeRouter);
  return app;
}

const app = makeApp();

beforeEach(() => {
  transcribeCreate.mockClear();
});

describe("POST /api/ask/transcribe — voice upload pipeline", () => {
  it("transcribes audio/webm; codecs=opus (the exact MIME from the iPad VOICE-DIAG)", async () => {
    const res = await request(app)
      .post("/api/ask/transcribe")
      .attach("audio", Buffer.from("fake-opus-bytes"), {
        filename: "recording.webm",
        contentType: "audio/webm; codecs=opus",
      });

    expect(res.status).toBe(200);
    expect(res.body.text).toBe("what are my top risks");
    expect(res.body.correlationId).toBeDefined();
    expect(transcribeCreate).toHaveBeenCalledOnce();
  });

  it("transcribes audio/mp4 (Safari/iOS container)", async () => {
    const res = await request(app)
      .post("/api/ask/transcribe")
      .attach("audio", Buffer.from("fake-aac-bytes"), {
        filename: "recording.mp4",
        contentType: "audio/mp4",
      });
    expect(res.status).toBe(200);
    expect(res.body.text).toBe("what are my top risks");
  });

  it("passes the content-type guard (never 415 unsupported_media_type)", async () => {
    const res = await request(app)
      .post("/api/ask/transcribe")
      .attach("audio", Buffer.from("x"), {
        filename: "recording.webm",
        contentType: "audio/webm; codecs=opus",
      });
    expect(res.status).not.toBe(415);
    expect(res.body.error).not.toBe("unsupported_media_type");
  });

  it("rejects a genuinely unsupported type with 415 unsupported_audio_type (route-level, classified)", async () => {
    const res = await request(app)
      .post("/api/ask/transcribe")
      .attach("audio", Buffer.from("not audio"), {
        filename: "note.txt",
        contentType: "text/plain",
      });
    expect(res.status).toBe(415);
    expect(res.body.error).toBe("unsupported_audio_type");
    expect(res.body.correlationId).toBeDefined();
    expect(transcribeCreate).not.toHaveBeenCalled();
  });

  it("returns 400 no_audio when no file part is present", async () => {
    const res = await request(app).post("/api/ask/transcribe").field("notaudio", "x");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("no_audio");
  });

  it("echoes the correlation id header for end-to-end tracing", async () => {
    const res = await request(app)
      .post("/api/ask/transcribe")
      .set("x-voice-diagnostic-id", "cid-test-123")
      .attach("audio", Buffer.from("fake-opus-bytes"), {
        filename: "recording.webm",
        contentType: "audio/webm; codecs=opus",
      });
    expect(res.status).toBe(200);
    expect(res.body.correlationId).toBe("cid-test-123");
  });
});
