import { describe, it, expect } from "vitest";
import {
  classifyTranscribeOutcome,
  statusForOutcome,
  rootCauseHint,
  type TranscribeObservation,
  type TranscribeOutcome,
} from "../lib/voiceTranscribeDiagnostics.js";

const base: TranscribeObservation = {
  hasApiKey: true,
  multerErrorCode: null,
  hasFile: true,
  fileSize: 10_000,
  openaiThrew: false,
  unexpectedThrew: false,
};

describe("classifyTranscribeOutcome", () => {
  it("returns ok for a normal accepted file with a key", () => {
    expect(classifyTranscribeOutcome(base)).toBe("ok");
  });

  it("classifies a multer fileFilter rejection as unsupported_audio_type (cause D)", () => {
    expect(
      classifyTranscribeOutcome({ ...base, multerErrorCode: "unsupported_audio_type" })
    ).toBe("unsupported_audio_type");
  });

  it("classifies the multer size-limit code as file_too_large", () => {
    expect(
      classifyTranscribeOutcome({ ...base, multerErrorCode: "LIMIT_FILE_SIZE" })
    ).toBe("file_too_large");
  });

  it("upload rejection takes precedence over a missing key", () => {
    expect(
      classifyTranscribeOutcome({
        ...base,
        hasApiKey: false,
        multerErrorCode: "unsupported_audio_type",
      })
    ).toBe("unsupported_audio_type");
  });

  it("reports transcription_unavailable when the engine has no OpenAI key", () => {
    expect(classifyTranscribeOutcome({ ...base, hasApiKey: false })).toBe(
      "transcription_unavailable"
    );
  });

  it("reports no_audio when no file part arrived", () => {
    expect(classifyTranscribeOutcome({ ...base, hasFile: false })).toBe("no_audio");
  });

  it("reports empty_audio for a 0-byte file (cause C)", () => {
    expect(classifyTranscribeOutcome({ ...base, fileSize: 0 })).toBe("empty_audio");
  });

  it("reports openai_error when the transcription call threw (cause F)", () => {
    expect(classifyTranscribeOutcome({ ...base, openaiThrew: true })).toBe("openai_error");
  });

  it("reports unexpected_exception for any other throw", () => {
    expect(classifyTranscribeOutcome({ ...base, unexpectedThrew: true })).toBe(
      "unexpected_exception"
    );
  });
});

describe("statusForOutcome", () => {
  const cases: Array<[TranscribeOutcome, number]> = [
    ["ok", 200],
    ["transcription_unavailable", 503],
    ["unsupported_audio_type", 415],
    ["file_too_large", 413],
    ["no_audio", 400],
    ["empty_audio", 400],
    ["openai_error", 500],
    ["unexpected_exception", 500],
  ];
  it.each(cases)("maps %s → HTTP %i", (outcome, status) => {
    expect(statusForOutcome(outcome)).toBe(status);
  });
});

describe("rootCauseHint", () => {
  it("points format rejection at cause D", () => {
    expect(rootCauseHint("unsupported_audio_type")).toMatch(/^D:/);
  });
  it("points empty/short capture at cause C", () => {
    expect(rootCauseHint("empty_audio")).toMatch(/^C:/);
    expect(rootCauseHint("no_audio")).toMatch(/^C:/);
  });
  it("points an OpenAI failure at cause F", () => {
    expect(rootCauseHint("openai_error")).toMatch(/^F:/);
  });
});
