/**
 * voiceGovernance.test.ts — the pure client half of the ASK-C gate (LC-4).
 *
 * The latch's failure modes must all err toward MORE disclosure (no storage,
 * throwing storage → disclose again), and readback must be a pure enhancement
 * (unavailable synthesis → false, never a throw that breaks the answer flow).
 */
import { describe, it, expect, vi } from "vitest";

import {
  needsVoiceDisclosure,
  acknowledgeVoiceDisclosure,
  speakAnswer,
  stopSpeaking,
  VOICE_DISCLOSURE_STORAGE_KEY,
  VOICE_DISCLOSURE_TEXT,
} from "../voiceGovernance";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("voice disclosure latch (ASK-C C-2)", () => {
  it("discloses before first use, latches after acknowledgment", () => {
    const storage = memoryStorage();
    expect(needsVoiceDisclosure(storage)).toBe(true);
    acknowledgeVoiceDisclosure(storage);
    expect(needsVoiceDisclosure(storage)).toBe(false);
    expect(storage.data.get(VOICE_DISCLOSURE_STORAGE_KEY)).toBe("true");
  });

  it("no storage → always disclose; consent is never assumed", () => {
    expect(needsVoiceDisclosure(null)).toBe(true);
  });

  it("throwing storage errs toward disclosure on read AND swallows on write", () => {
    const throwing = {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(needsVoiceDisclosure(throwing)).toBe(true);
    expect(() => acknowledgeVoiceDisclosure(throwing)).not.toThrow();
  });

  it("the disclosure names the three governed facts", () => {
    // Provider, non-storage of audio, transcript-becomes-question. If this
    // text changes, the change must keep all three or the C-2 evidence lapses.
    expect(VOICE_DISCLOSURE_TEXT).toContain("OpenAI");
    expect(VOICE_DISCLOSURE_TEXT).toContain("not stored");
    expect(VOICE_DISCLOSURE_TEXT).toContain("Ask question");
  });
});

describe("spoken readback (LC-4 realtime loop)", () => {
  it("speaks via the provided synthesis, cancelling any prior utterance first", () => {
    const calls: string[] = [];
    const synth = {
      cancel: vi.fn(() => calls.push("cancel")),
      speak: vi.fn(() => calls.push("speak")),
    };
    vi.stubGlobal("SpeechSynthesisUtterance", class {
      constructor(public text: string) {}
    });
    try {
      expect(speakAnswer("You have 2 findings.", synth)).toBe(true);
      expect(calls).toEqual(["cancel", "speak"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns false (never throws) when synthesis is unavailable", () => {
    expect(speakAnswer("text", null)).toBe(false);
    expect(speakAnswer("text", undefined)).toBe(false);
  });

  it("stopSpeaking is safe with and without a synth", () => {
    const synth = { cancel: vi.fn(), speak: vi.fn() };
    expect(() => stopSpeaking(synth)).not.toThrow();
    expect(synth.cancel).toHaveBeenCalled();
    expect(() => stopSpeaking(null)).not.toThrow();
  });
});
