import { describe, it, expect } from "vitest";
import {
  buildDiagnosticCode,
  emptyDiagnostic,
  newCorrelationId,
  type VoiceDiagnostic,
} from "../voiceDiagnostics";

describe("newCorrelationId", () => {
  it("returns a non-empty string and is reasonably unique", () => {
    const a = newCorrelationId();
    const b = newCorrelationId();
    expect(a).toBeTruthy();
    expect(typeof a).toBe("string");
    expect(a).not.toBe(b);
  });
});

describe("buildDiagnosticCode", () => {
  it("renders a compact, non-sensitive one-liner with every key field", () => {
    const d: VoiceDiagnostic = {
      ...emptyDiagnostic("cid-123"),
      capability: "supported",
      selectedMimeType: "audio/webm",
      recorderMimeType: "audio/webm; codecs=opus",
      blobType: "audio/webm; codecs=opus",
      blobSize: 115417,
      filenameExt: "webm",
      uploadStatus: 200,
      stage: "ok",
      errorCode: null,
      errorMessage: null,
    };
    const code = buildDiagnosticCode(d);
    expect(code).toContain("VOICE-DIAG");
    expect(code).toContain("cid=cid-123");
    expect(code).toContain("stage=ok");
    expect(code).toContain("cap=supported");
    expect(code).toContain("sel=audio/webm");
    expect(code).toContain("rec=audio/webm; codecs=opus");
    expect(code).toContain("blob=audio/webm; codecs=opus/115417B");
    expect(code).toContain("ext=webm");
    expect(code).toContain("http=200");
  });

  it("renders an error-attempt line with the failure code", () => {
    const d: VoiceDiagnostic = {
      ...emptyDiagnostic("cid-err"),
      capability: "supported",
      selectedMimeType: "audio/webm",
      recorderMimeType: "audio/webm; codecs=opus",
      blobType: "audio/webm; codecs=opus",
      blobSize: 115417,
      filenameExt: "webm",
      uploadStatus: 415,
      stage: "transcribe",
      errorCode: "unsupported_media_type",
      errorMessage: "This audio format isn't supported.",
    };
    const code = buildDiagnosticCode(d);
    expect(code).toContain("stage=transcribe");
    expect(code).toContain("http=415");
    expect(code).toContain("code=unsupported_media_type");
    // The human-readable message is NOT embedded (non-sensitive code only).
    expect(code).not.toContain("isn't supported");
  });

  it("renders dashes for empty/null fields instead of leaking 'null'/''", () => {
    const code = buildDiagnosticCode(emptyDiagnostic("cid-x"));
    expect(code).toContain("sel=-");
    expect(code).toContain("rec=-");
    expect(code).toContain("http=-");
    expect(code).toContain("code=-");
    expect(code).not.toContain("null");
  });
});
