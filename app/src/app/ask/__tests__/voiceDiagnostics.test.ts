import { describe, it, expect } from "vitest";
import {
  buildDiagnosticCode,
  emptyDiagnostic,
  isStagingHost,
  newCorrelationId,
  type VoiceDiagnostic,
} from "../voiceDiagnostics";

describe("isStagingHost", () => {
  it("treats staging Render hosts as diagnostic mode", () => {
    expect(isStagingHost("securelogic-app-staging.onrender.com")).toBe(true);
  });
  it("treats localhost / 127.0.0.1 as diagnostic mode", () => {
    expect(isStagingHost("localhost")).toBe(true);
    expect(isStagingHost("127.0.0.1")).toBe(true);
  });
  it("does NOT treat production hosts as diagnostic mode", () => {
    expect(isStagingHost("securelogicai.com")).toBe(false);
    expect(isStagingHost("app.securelogicai.com")).toBe(false);
    expect(isStagingHost("")).toBe(false);
  });
});

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
      diagnosticMode: true,
      capability: "unsupported:ios",
      selectedMimeType: "audio/mp4",
      recorderMimeType: "audio/mp4",
      blobType: "audio/mp4",
      blobSize: 10342,
      filenameExt: "mp4",
      uploadStatus: 500,
      stage: "transcribe",
      errorCode: "openai_error",
      errorMessage: "Failed to transcribe audio.",
    };
    const code = buildDiagnosticCode(d);
    expect(code).toContain("VOICE-DIAG");
    expect(code).toContain("cid=cid-123");
    expect(code).toContain("mode=diag");
    expect(code).toContain("stage=transcribe");
    expect(code).toContain("cap=unsupported:ios");
    expect(code).toContain("sel=audio/mp4");
    expect(code).toContain("rec=audio/mp4");
    expect(code).toContain("blob=audio/mp4/10342B");
    expect(code).toContain("ext=mp4");
    expect(code).toContain("http=500");
    expect(code).toContain("code=openai_error");
    // No PII / audio / secrets — and the human error message is NOT embedded.
    expect(code).not.toContain("Failed to transcribe");
  });

  it("renders dashes for empty/null fields instead of leaking 'null'/''", () => {
    const code = buildDiagnosticCode(emptyDiagnostic("cid-x"));
    expect(code).toContain("mode=normal");
    expect(code).toContain("sel=-");
    expect(code).toContain("rec=-");
    expect(code).toContain("http=-");
    expect(code).toContain("code=-");
    expect(code).not.toContain("null");
  });
});
