import { describe, it, expect } from "vitest";
import {
  detectVoiceSupport,
  VOICE_UNSUPPORTED_MESSAGE,
  type VoiceEnv,
} from "../voiceSupport";

// A fully-capable browser.
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

const IPAD_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";

describe("detectVoiceSupport — capability only, no browser/device name gating", () => {
  it("offers voice on a fully-capable desktop browser", () => {
    expect(detectVoiceSupport(CAPABLE)).toEqual({ supported: true });
  });

  it("offers voice when only mp4 is supported (no webm)", () => {
    expect(
      detectVoiceSupport({ ...CAPABLE, supportsWebm: false, supportsMp4: true })
    ).toEqual({ supported: true });
  });

  it("offers voice on a CAPABLE iPad — never blacklisted by name", () => {
    // iPadOS 13+ masquerades as MacIntel + touch; with the APIs present it is
    // fully supported. This is the re-enable: capability, not device name.
    const ipad: VoiceEnv = {
      ...CAPABLE,
      supportsMp4: true,
      userAgent: IPAD_UA,
      platform: "MacIntel",
      maxTouchPoints: 5,
    };
    expect(detectVoiceSupport(ipad)).toEqual({ supported: true });
  });

  it("offers voice on a CAPABLE iPhone — never blacklisted by name", () => {
    expect(
      detectVoiceSupport({
        ...CAPABLE,
        userAgent: IPHONE_UA,
        platform: "iPhone",
        maxTouchPoints: 5,
      })
    ).toEqual({ supported: true });
  });

  it("hides voice only on a genuine capability gap — missing getUserMedia", () => {
    expect(detectVoiceSupport({ ...CAPABLE, hasMediaDevices: false })).toEqual({
      supported: false,
      reason: "no_media_devices",
    });
  });

  it("hides voice when MediaRecorder is missing — even on an iPad UA", () => {
    expect(
      detectVoiceSupport({
        ...CAPABLE,
        hasMediaRecorder: false,
        userAgent: IPAD_UA,
        platform: "MacIntel",
        maxTouchPoints: 5,
      })
    ).toEqual({ supported: false, reason: "no_media_recorder" });
  });

  it("hides voice when isTypeSupported is unavailable", () => {
    expect(detectVoiceSupport({ ...CAPABLE, canCheckTypes: false })).toEqual({
      supported: false,
      reason: "no_media_recorder",
    });
  });

  it("hides voice when neither webm nor mp4 is supported", () => {
    expect(
      detectVoiceSupport({ ...CAPABLE, supportsWebm: false, supportsMp4: false })
    ).toEqual({ supported: false, reason: "no_supported_mime" });
  });
});

describe("VOICE_UNSUPPORTED_MESSAGE", () => {
  it("is the clear fallback copy", () => {
    expect(VOICE_UNSUPPORTED_MESSAGE).toContain(
      "Voice input is not yet supported on this browser"
    );
  });
});
