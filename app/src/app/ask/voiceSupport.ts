/**
 * voiceSupport.ts — capability detection for the Ask "Voice" input feature.
 *
 * Pure, dependency-free decision logic (no React / no Next imports) so it can
 * be unit-tested under the repo-root vitest run without a browser. `AskClient`
 * builds a `VoiceEnv` snapshot from `navigator` / `window` at runtime via
 * `readVoiceEnv()` and feeds it to `detectVoiceSupport()`.
 *
 * Why this gate exists
 * --------------------
 * Voice input depends on the browser `MediaRecorder` + `getUserMedia` APIs and
 * an OpenAI Whisper transcription round-trip on the engine. On iPad / iOS
 * Safari (every iOS browser is WebKit under the hood):
 *   - `MediaRecorder` support is version-dependent and was historically absent;
 *   - `audio/webm` is not supported (only `audio/mp4`); and
 *   - iOS-produced `mp4` has not been validated end-to-end against Whisper on
 *     real hardware.
 * Until that path is proven reliable, we deliberately treat iOS/iPadOS as
 * unsupported and surface a clear "type instead" message rather than letting a
 * user hit a silent recording/transcription failure. (Sprint 2 — voice.)
 *
 * The runtime `getUserMedia`/`MediaRecorder` try/catch in AskClient remains as
 * defense-in-depth for browsers that pass this check but still fail mid-record.
 */

export type VoiceEnv = {
  /** `navigator.mediaDevices.getUserMedia` exists and is callable. */
  hasMediaDevices: boolean;
  /** `window.MediaRecorder` is defined. */
  hasMediaRecorder: boolean;
  /** `MediaRecorder.isTypeSupported` is a callable function. */
  canCheckTypes: boolean;
  supportsWebm: boolean;
  supportsMp4: boolean;
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
};

export type VoiceUnsupportedReason =
  | "ios"
  | "no_media_devices"
  | "no_media_recorder"
  | "no_supported_mime";

export type VoiceSupport =
  | { supported: true }
  | { supported: false; reason: VoiceUnsupportedReason };

export const VOICE_UNSUPPORTED_MESSAGE =
  "Voice input is not yet supported on this browser. Please type your question instead.";

/**
 * Detect iOS / iPadOS. iPadOS 13+ reports a desktop-Safari `userAgent` and a
 * `platform` of "MacIntel", so the touch-point heuristic is required to tell a
 * real Mac (0–1 touch points) from an iPad (>1).
 */
export function isIOS(
  env: Pick<VoiceEnv, "userAgent" | "platform" | "maxTouchPoints">
): boolean {
  const ua = env.userAgent || "";
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  if (env.platform === "MacIntel" && env.maxTouchPoints > 1) return true;
  return false;
}

/**
 * Decide whether to offer voice input. Order matters: iOS is gated off first
 * (deliberate pre-launch limitation), then genuine capability gaps.
 */
export function detectVoiceSupport(env: VoiceEnv): VoiceSupport {
  if (isIOS(env)) return { supported: false, reason: "ios" };
  if (!env.hasMediaDevices) return { supported: false, reason: "no_media_devices" };
  if (!env.hasMediaRecorder || !env.canCheckTypes) {
    return { supported: false, reason: "no_media_recorder" };
  }
  if (!env.supportsWebm && !env.supportsMp4) {
    return { supported: false, reason: "no_supported_mime" };
  }
  return { supported: true };
}

/**
 * Read a `VoiceEnv` snapshot from the live browser. Returns an all-false
 * (unsupported) snapshot during SSR so callers can run it unconditionally.
 */
export function readVoiceEnv(): VoiceEnv {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return {
      hasMediaDevices: false,
      hasMediaRecorder: false,
      canCheckTypes: false,
      supportsWebm: false,
      supportsMp4: false,
      userAgent: "",
      platform: "",
      maxTouchPoints: 0,
    };
  }

  const MR = (window as unknown as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  const canCheckTypes = !!MR && typeof MR.isTypeSupported === "function";

  return {
    hasMediaDevices: !!(
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function"
    ),
    hasMediaRecorder: !!MR,
    canCheckTypes,
    supportsWebm: canCheckTypes ? MR!.isTypeSupported("audio/webm") : false,
    supportsMp4: canCheckTypes ? MR!.isTypeSupported("audio/mp4") : false,
    userAgent: navigator.userAgent || "",
    platform:
      (navigator as unknown as { platform?: string }).platform || "",
    maxTouchPoints: navigator.maxTouchPoints || 0,
  };
}
