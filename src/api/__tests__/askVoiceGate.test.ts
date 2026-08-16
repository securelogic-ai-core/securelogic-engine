/**
 * askVoiceGate.test.ts — the ASK-C voice gate's enforceable dimensions (LC-4).
 *
 * Maps 1:1 onto docs/validation/ask-c-voice-gate.md:
 *   C-1  tenant disablement is enforced ENGINE-side (403, audio never parsed)
 *   C-7  authorization equivalence — the transcribe chain carries every gate
 *        the text Ask chain carries, in order (structural + behavioral)
 *   C-8  every transcription audits ask.voice.transcribed with shape, never
 *        content
 *   C-9  the independent voice kill switch (default ON; literal "false")
 *        404s the route and un-advertises /status; killing Ask kills voice
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  auditEvents: [] as Array<Record<string, unknown>>,
  whisperCalls: 0,
  orgVoiceEnabled: true as boolean,
  seatDenies: false,
}));

vi.mock("openai", () => ({
  default: class {
    audio = {
      transcriptions: {
        create: vi.fn(async () => {
          h.whisperCalls += 1;
          return { text: "how many findings do I have" };
        }),
      },
    };
  },
}));
vi.mock("../infra/providerQuotaAlert.js", () => ({
  instrumentOpenAIClient: (c: unknown) => c,
  instrumentAnthropicClient: (c: unknown) => c,
}));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: vi.fn((e: Record<string, unknown>) => { h.auditEvents.push(e); }),
}));
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (req: Record<string, unknown>, _s: unknown, next: () => void) => {
    req.apiKey = { id: "key-1", organization_id: ORG };
    req.userId = "user-1";
    next();
  },
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (req: Record<string, unknown>, _s: unknown, next: () => void) => {
    req.organizationContext = {
      organizationId: ORG,
      entitlementLevel: "premium",
      voiceInputEnabled: h.orgVoiceEnabled,
    };
    next();
  },
}));
vi.mock("../middleware/requireSeat.js", () => ({
  denyContributor: () => (_r: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }, next: () => void) => {
    if (h.seatDenies) {
      res.status(403).json({ error: "seat_denied" });
      return;
    }
    next();
  },
}));

import transcribeRouter from "../routes/transcribe.js";

const app = () => {
  const a = express();
  a.use("/api", transcribeRouter);
  return a;
};

const postAudio = () =>
  request(app())
    .post("/api/ask/transcribe")
    .attach("audio", Buffer.from("fake-webm-bytes"), {
      filename: "recording.webm",
      contentType: "audio/webm",
    });

beforeEach(() => {
  vi.clearAllMocks();
  h.auditEvents = [];
  h.whisperCalls = 0;
  h.orgVoiceEnabled = true;
  h.seatDenies = false;
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.SECURELOGIC_ASK_ENABLED;
  delete process.env.SECURELOGIC_ASK_VOICE_ENABLED;
  delete process.env.SECURELOGIC_ASK_VOICE_REALTIME_ENABLED;
});

// ─── C-9: the independent kill switch ───────────────────────────────────────

describe("ASK-C C-9 — independent voice kill switch", () => {
  it("defaults ON; only the literal 'false' disables (live capability)", async () => {
    const { askVoiceEnabled, askVoiceRealtimeEnabled } = await import(
      "../lib/ask/askVoiceFeatureFlag.js"
    );
    expect(askVoiceEnabled({})).toBe(true);
    expect(askVoiceEnabled({ SECURELOGIC_ASK_VOICE_ENABLED: "false" })).toBe(false);
    expect(askVoiceEnabled({ SECURELOGIC_ASK_VOICE_ENABLED: "0" })).toBe(true);
    // The realtime loop is the opposite: NEW behavior, dark by default.
    expect(askVoiceRealtimeEnabled({})).toBe(false);
    expect(askVoiceRealtimeEnabled({ SECURELOGIC_ASK_VOICE_REALTIME_ENABLED: "true" })).toBe(true);
  });

  it("killed voice 404s before any audio processing", async () => {
    process.env.SECURELOGIC_ASK_VOICE_ENABLED = "false";
    const res = await postAudio();
    expect(res.status).toBe(404);
    expect(h.whisperCalls).toBe(0);
    expect(h.auditEvents).toHaveLength(0);
  });

  it("killing Ask kills voice with it (voice exists only to feed Ask)", async () => {
    process.env.SECURELOGIC_ASK_ENABLED = "false";
    const res = await postAudio();
    expect(res.status).toBe(404);
    expect(h.whisperCalls).toBe(0);
  });

  it("/status stops advertising a killed capability", async () => {
    let res = await request(app()).get("/api/ask/transcribe/status");
    expect(res.body.configured).toBe(true);
    process.env.SECURELOGIC_ASK_VOICE_ENABLED = "false";
    res = await request(app()).get("/api/ask/transcribe/status");
    expect(res.body.configured).toBe(false);
  });
});

// ─── C-1: tenant disablement, enforced engine-side ──────────────────────────

describe("ASK-C C-1 — tenant voice disablement", () => {
  it("a disabled tenant gets 403 voice_disabled_for_org and Whisper is never called", async () => {
    h.orgVoiceEnabled = false;
    const res = await postAudio();
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("voice_disabled_for_org");
    expect(h.whisperCalls).toBe(0);
    expect(h.auditEvents).toHaveLength(0);
  });

  it("an enabled tenant transcribes normally", async () => {
    const res = await postAudio();
    expect(res.status).toBe(200);
    expect(res.body.text).toBe("how many findings do I have");
    expect(h.whisperCalls).toBe(1);
  });
});

// ─── C-7: authorization equivalence with text Ask ───────────────────────────

describe("ASK-C C-7 — authorization equivalence", () => {
  it("the chain carries every text-Ask gate in order (structural)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "..", "routes", "transcribe.ts"), "utf8");
    const chain = /router\.post\(\s*"\/ask\/transcribe",([\s\S]*?)async \(req, res\)/.exec(src)![1]!;
    const order = [
      "askFeatureFlag",
      "voiceFeatureFlag",
      "requireApiKey",
      "attachOrganizationContext",
      'requireEntitlement("premium")',
      "denyContributor()",
      "requireOrgVoiceEnabled",
      "transcribeRateLimit",
    ];
    let last = -1;
    for (const gate of order) {
      const at = chain.indexOf(gate);
      expect(at, `${gate} missing from the transcribe chain`).toBeGreaterThan(-1);
      expect(at, `${gate} out of order in the transcribe chain`).toBeGreaterThan(last);
      last = at;
    }
  });

  it("a contributor seat cannot spend voice processing (behavioral)", async () => {
    h.seatDenies = true;
    const res = await postAudio();
    expect(res.status).toBe(403);
    expect(h.whisperCalls).toBe(0);
  });
});

// ─── C-8: audit — shape, never content ──────────────────────────────────────

describe("ASK-C C-8 — transcription is auditable, content-free", () => {
  it("success writes ask.voice.transcribed with sizes and provider, never the text", async () => {
    const res = await postAudio();
    expect(res.status).toBe(200);

    const ev = h.auditEvents.find((e) => e.eventType === "ask.voice.transcribed")!;
    expect(ev).toBeTruthy();
    expect(ev.organizationId).toBe(ORG);
    const payload = ev.payload as Record<string, unknown>;
    expect(payload.audio_bytes).toBeGreaterThan(0);
    expect(payload.provider).toBe("openai_whisper");
    expect(payload.transcript_length).toBe("how many findings do I have".length);
    // The content stays out of the ledger — the Ask precedent.
    expect(JSON.stringify(ev)).not.toContain("how many findings");
  });

  it("failures do not fabricate a processing record", async () => {
    delete process.env.OPENAI_API_KEY;
    const res = await postAudio();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(h.auditEvents).toHaveLength(0);
  });
});
