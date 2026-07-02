/**
 * voiceDiagnostics.ts — temporary, non-sensitive diagnostics for Ask voice.
 *
 * Purpose
 * -------
 * We do not yet KNOW why voice transcription fails on iPad — the candidate
 * causes are A platform/browser capability, B our MIME/filename/blob handling,
 * C empty/short capture, D transcription-endpoint rejection, E mic permission,
 * F OpenAI/Whisper failure. This module captures just enough non-sensitive
 * signal to tell those apart from a single real attempt, traced end-to-end by a
 * correlation id (browser → app proxy → engine).
 *
 * Pure and dependency-free so the repo-root vitest run can test it without a
 * browser. NOTHING here logs audio content, secrets, or user PII — only codes,
 * mime strings, byte sizes, an HTTP status, and a random correlation id.
 */

/** Header that carries the correlation id from the browser through to the engine. */
export const VOICE_DIAGNOSTIC_HEADER = "x-voice-diagnostic-id";

/** Where in the voice flow an attempt ended. */
export type VoiceErrorStage =
  | "ok"
  | "capability" // never reached recording (no MediaRecorder/getUserMedia)
  | "permission" // user denied the mic
  | "capture" // recorded nothing usable (empty/short)
  | "upload" // network call to /api/transcribe failed
  | "transcribe" // engine returned a non-2xx
  | "empty_result"; // 200 but no text

export type VoiceDiagnostic = {
  correlationId: string;
  /** Summary of the capability decision, e.g. "supported" or "unsupported:no_media_recorder". */
  capability: string;
  /** mimeType we asked MediaRecorder for ("" = browser default). */
  selectedMimeType: string;
  /** mediaRecorder.mimeType actually produced. */
  recorderMimeType: string;
  /** Blob.type of the assembled recording. */
  blobType: string;
  /** Blob.size in bytes. */
  blobSize: number;
  /** Filename extension we tagged the upload with. */
  filenameExt: string;
  /** HTTP status from /api/transcribe, or null if we never got a response. */
  uploadStatus: number | null;
  stage: VoiceErrorStage;
  /** Server- or client-assigned error code, or null on success. */
  errorCode: string | null;
  errorMessage: string | null;
};

export function emptyDiagnostic(correlationId: string): VoiceDiagnostic {
  return {
    correlationId,
    capability: "unknown",
    selectedMimeType: "",
    recorderMimeType: "",
    blobType: "",
    blobSize: 0,
    filenameExt: "",
    uploadStatus: null,
    stage: "ok",
    errorCode: null,
    errorMessage: null,
  };
}

/**
 * A compact, single-line, screenshot-friendly code summarising an attempt.
 * Contains only non-sensitive fields. Example:
 *   VOICE-DIAG cid=ab12 mode=diag stage=transcribe cap=unsupported:ios
 *   sel=audio/mp4 rec=audio/mp4 blob=audio/mp4/10342B ext=mp4 http=500 code=openai_error
 */
export function buildDiagnosticCode(d: VoiceDiagnostic): string {
  const dash = (s: string | number | null) =>
    s === null || s === "" ? "-" : String(s);
  return [
    "VOICE-DIAG",
    `cid=${dash(d.correlationId)}`,
    `stage=${dash(d.stage)}`,
    `cap=${dash(d.capability)}`,
    `sel=${dash(d.selectedMimeType)}`,
    `rec=${dash(d.recorderMimeType)}`,
    `blob=${dash(d.blobType)}/${d.blobSize}B`,
    `ext=${dash(d.filenameExt)}`,
    `http=${dash(d.uploadStatus)}`,
    `code=${dash(d.errorCode)}`,
  ].join(" ");
}

/** Random, non-PII correlation id. Prefers crypto.randomUUID; falls back for non-secure/local contexts. */
export function newCorrelationId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
  } catch {
    // fall through to the non-crypto fallback
  }
  // Non-secure-context fallback. Uniqueness, not unpredictability, is all we
  // need for a trace id. (Math.random is acceptable for a correlation id.)
  return "vd-" + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}
