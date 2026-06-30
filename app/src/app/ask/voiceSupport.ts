/**
 * voiceSupport.ts — capability detection for the Ask "Voice" input feature.
 *
 * Pure, dependency-free decision logic (no React / no Next imports) so it can
 * be unit-tested under the repo-root vitest run without a browser. `AskClient`
 * builds a `VoiceEnv` snapshot from `navigator` / `window` at runtime via
 * `readVoiceEnv()` and feeds it to `detectVoiceSupport()`.
 *
 * Gating policy: CAPABILITY DETECTION ONLY
 * ----------------------------------------
 * Voice input depends on the browser `MediaRecorder` + `getUserMedia` APIs and
 * an OpenAI Whisper transcription round-trip on the engine. We offer voice
 * whenever the browser genuinely has those capabilities and a supported
 * recording format (webm or mp4). We do **not** blacklist any browser or device
 * by name — iPad / iOS Safari record `audio/webm; codecs=opus` (or `audio/mp4`)
 * just fine, and the real iPad failure was a server-side content-type guard
 * (since fixed), not a device limitation.
 *
 * If a browser truly lacks the APIs, detection returns `supported: false` with
 * the specific reason and the UI hides the mic with a clear "type instead"
 * note. The runtime `getUserMedia`/`MediaRecorder` try/catch in AskClient
 * remains as defense-in-depth for anything that passes this check but still
 * fails mid-record (surfaced via the voice diagnostic).
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
  | "no_media_devices"
  | "no_media_recorder"
  | "no_supported_mime";

export type VoiceSupport =
  | { supported: true }
  | { supported: false; reason: VoiceUnsupportedReason };

export const VOICE_UNSUPPORTED_MESSAGE =
  "Voice input is not yet supported on this browser. Please type your question instead.";

/**
 * Decide whether to offer voice input — capability only, no browser/device
 * name checks. Offered when getUserMedia + MediaRecorder (with isTypeSupported)
 * + a supported recording format (webm or mp4) are present.
 */
export function detectVoiceSupport(env: VoiceEnv): VoiceSupport {
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
