/**
 * voiceTranscribeDiagnostics.ts — pure classification for the Ask voice
 * transcription endpoint, so one iPad attempt yields an unambiguous cause.
 *
 * Maps an observed request/outcome to a single diagnostic outcome code. Pure
 * and free of infra imports so it is unit-tested without a database or the
 * Express route. The route (routes/transcribe.ts) gathers the inputs, calls
 * this, logs the result with the correlation id, and returns the code.
 *
 * Never receives or returns audio content, secrets, or user PII.
 */

export type TranscribeOutcome =
  | "ok"
  | "transcription_unavailable" // OpenAI key not configured on the engine
  | "unsupported_audio_type" // multer fileFilter rejected the MIME/extension (cause D)
  | "file_too_large" // multer size limit (cause C, oversized)
  | "no_audio" // no file part reached the engine (cause C)
  | "empty_audio" // file present but 0 bytes (cause C)
  | "openai_error" // OpenAI/Whisper threw (cause F)
  | "unexpected_exception"; // anything else

export type TranscribeObservation = {
  hasApiKey: boolean;
  /** multer error code if the upload middleware rejected the file, else null. */
  multerErrorCode: string | null;
  hasFile: boolean;
  fileSize: number;
  /** true once the OpenAI transcription call has thrown. */
  openaiThrew: boolean;
  /** true if an exception was thrown outside the OpenAI call. */
  unexpectedThrew: boolean;
};

/**
 * Precedence is deliberate and mirrors the order the route can observe things:
 *   1. upload-middleware rejections (we never even see a usable file)
 *   2. server not configured for transcription
 *   3. missing / empty audio
 *   4. OpenAI failure
 *   5. unexpected exception
 *   6. success
 */
export function classifyTranscribeOutcome(o: TranscribeObservation): TranscribeOutcome {
  if (o.multerErrorCode === "LIMIT_FILE_SIZE") return "file_too_large";
  if (o.multerErrorCode) return "unsupported_audio_type";
  if (!o.hasApiKey) return "transcription_unavailable";
  if (!o.hasFile) return "no_audio";
  if (o.fileSize <= 0) return "empty_audio";
  if (o.openaiThrew) return "openai_error";
  if (o.unexpectedThrew) return "unexpected_exception";
  return "ok";
}

/** HTTP status the route returns for each outcome. */
export function statusForOutcome(outcome: TranscribeOutcome): number {
  switch (outcome) {
    case "ok":
      return 200;
    case "transcription_unavailable":
      return 503;
    case "unsupported_audio_type":
      return 415;
    case "file_too_large":
      return 413;
    case "no_audio":
    case "empty_audio":
      return 400;
    case "openai_error":
    case "unexpected_exception":
      return 500;
  }
}

/** Which of the candidate root causes (A–F) an outcome points at — for logs/operators. */
export function rootCauseHint(outcome: TranscribeOutcome): string {
  switch (outcome) {
    case "unsupported_audio_type":
      return "D: transcription endpoint rejected the format (MIME/extension allow-list)";
    case "file_too_large":
    case "no_audio":
    case "empty_audio":
      return "C: empty / short / oversized capture";
    case "openai_error":
      return "F: OpenAI/Whisper failure";
    case "transcription_unavailable":
      return "config: engine missing OPENAI_API_KEY";
    case "unexpected_exception":
      return "unexpected server exception";
    case "ok":
      return "ok";
  }
}
