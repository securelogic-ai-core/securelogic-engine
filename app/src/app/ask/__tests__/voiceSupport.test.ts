import { describe, it, expect } from "vitest";
import {
  detectVoiceSupport,
  isIOS,
  VOICE_UNSUPPORTED_MESSAGE,
  type VoiceEnv,
} from "../voiceSupport";

// A fully-capable desktop browser (e.g. Chrome on Windows/Linux).
const CAPABLE: VoiceEnv = {
  hasMediaDevices: true,
  hasMediaRecorder: true,
  canCheckTypes: true,
  supportsWebm: true,
  supportsMp4: true,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  platform: "Win32",
  maxTouchPoints: 0,
};

describe("isIOS", () => {
  it("detects an iPhone by userAgent", () => {
    expect(
      isIOS({
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        platform: "iPhone",
        maxTouchPoints: 5,
      })
    ).toBe(true);
  });

  it("detects a legacy iPad by userAgent", () => {
    expect(
      isIOS({
        userAgent:
          "Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X) AppleWebKit/605.1.15",
        platform: "iPad",
        maxTouchPoints: 5,
      })
    ).toBe(true);
  });

  it("detects iPadOS 13+ masquerading as desktop Safari (MacIntel + touch)", () => {
    expect(
      isIOS({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 5,
      })
    ).toBe(true);
  });

  it("does NOT classify a real Mac (MacIntel, no touch) as iOS", () => {
    expect(
      isIOS({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        platform: "MacIntel",
        maxTouchPoints: 0,
      })
    ).toBe(false);
  });
});

describe("detectVoiceSupport", () => {
  it("supports a fully-capable desktop browser", () => {
    expect(detectVoiceSupport(CAPABLE)).toEqual({ supported: true });
  });

  it("supports a browser that only supports mp4 (no webm)", () => {
    expect(
      detectVoiceSupport({ ...CAPABLE, supportsWebm: false, supportsMp4: true })
    ).toEqual({ supported: true });
  });

  it("gates iPadOS off even when every capability flag is true", () => {
    // The iPad case: getUserMedia + MediaRecorder + mp4 all present, but we
    // deliberately treat iOS as unsupported until the Whisper path is proven.
    const ipad: VoiceEnv = {
      ...CAPABLE,
      supportsWebm: false,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
      platform: "MacIntel",
      maxTouchPoints: 5,
    };
    expect(detectVoiceSupport(ipad)).toEqual({ supported: false, reason: "ios" });
  });

  it("gates an iPhone off", () => {
    expect(
      detectVoiceSupport({
        ...CAPABLE,
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
        platform: "iPhone",
        maxTouchPoints: 5,
      })
    ).toEqual({ supported: false, reason: "ios" });
  });

  it("reports missing getUserMedia", () => {
    expect(detectVoiceSupport({ ...CAPABLE, hasMediaDevices: false })).toEqual({
      supported: false,
      reason: "no_media_devices",
    });
  });

  it("reports missing MediaRecorder", () => {
    expect(detectVoiceSupport({ ...CAPABLE, hasMediaRecorder: false })).toEqual({
      supported: false,
      reason: "no_media_recorder",
    });
  });

  it("reports MediaRecorder present but isTypeSupported missing", () => {
    expect(detectVoiceSupport({ ...CAPABLE, canCheckTypes: false })).toEqual({
      supported: false,
      reason: "no_media_recorder",
    });
  });

  it("reports no supported mime when neither webm nor mp4 is available", () => {
    expect(
      detectVoiceSupport({ ...CAPABLE, supportsWebm: false, supportsMp4: false })
    ).toEqual({ supported: false, reason: "no_supported_mime" });
  });
});

describe("VOICE_UNSUPPORTED_MESSAGE", () => {
  it("is the clear, agreed launch copy", () => {
    expect(VOICE_UNSUPPORTED_MESSAGE).toContain(
      "Voice input is not yet supported on this browser"
    );
  });
});
