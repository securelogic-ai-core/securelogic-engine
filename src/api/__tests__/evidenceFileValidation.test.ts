/**
 * evidenceFileValidation.test.ts — the security-critical allowlist + magic-byte
 * checks for Remediation Evidence uploads. Pure, no I/O.
 */
import { describe, it, expect } from "vitest";
import {
  validateEvidenceFile,
  isAllowedUploadMime,
  sanitizeFilename,
  MAX_EVIDENCE_FILE_BYTES,
} from "../lib/evidenceFileValidation.js";

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]); // OOXML container
const TXT = Buffer.from("2026-07-18 patch applied, verified\n", "utf8");
const TXT_WITH_NUL = Buffer.from([0x68, 0x69, 0x00, 0x62, 0x69, 0x6e]);

describe("validateEvidenceFile — allowlist + magic bytes", () => {
  it("accepts a real PDF declared as application/pdf", () => {
    const r = validateEvidenceFile({ declaredMime: "application/pdf", buffer: PDF, size: PDF.length, originalName: "proof.pdf" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mime).toBe("application/pdf");
      expect(r.ext).toBe("pdf");
      expect(r.filename).toBe("proof.pdf");
    }
  });

  it("accepts PNG, JPG (incl. image/jpg alias), TXT, CSV, and OOXML docx", () => {
    expect(validateEvidenceFile({ declaredMime: "image/png", buffer: PNG, size: PNG.length, originalName: "s.png" }).ok).toBe(true);
    expect(validateEvidenceFile({ declaredMime: "image/jpg", buffer: JPG, size: JPG.length, originalName: "s.jpg" }).ok).toBe(true);
    expect(validateEvidenceFile({ declaredMime: "text/plain", buffer: TXT, size: TXT.length, originalName: "log.txt" }).ok).toBe(true);
    expect(validateEvidenceFile({ declaredMime: "text/csv", buffer: TXT, size: TXT.length, originalName: "d.csv" }).ok).toBe(true);
    expect(
      validateEvidenceFile({
        declaredMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: ZIP, size: ZIP.length, originalName: "ticket.docx",
      }).ok
    ).toBe(true);
  });

  it("REJECTS a disallowed MIME (e.g. an executable / zip)", () => {
    const r = validateEvidenceFile({ declaredMime: "application/x-msdownload", buffer: PDF, size: PDF.length, originalName: "x.exe" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unsupported_file_type");
  });

  it("REJECTS content that does not match the declared type (PNG bytes as PDF)", () => {
    const r = validateEvidenceFile({ declaredMime: "application/pdf", buffer: PNG, size: PNG.length, originalName: "fake.pdf" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("file_content_mismatch");
  });

  it("REJECTS binary smuggled as text (NUL byte)", () => {
    const r = validateEvidenceFile({ declaredMime: "text/plain", buffer: TXT_WITH_NUL, size: TXT_WITH_NUL.length, originalName: "x.txt" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("file_content_mismatch");
  });

  it("REJECTS an oversized file", () => {
    const r = validateEvidenceFile({ declaredMime: "application/pdf", buffer: PDF, size: MAX_EVIDENCE_FILE_BYTES + 1, originalName: "big.pdf" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("file_too_large");
  });

  it("REJECTS an empty file", () => {
    const r = validateEvidenceFile({ declaredMime: "application/pdf", buffer: Buffer.alloc(0), size: 0, originalName: "empty.pdf" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("empty_file");
  });
});

describe("sanitizeFilename — safe display name (traversal is impossible; the key never uses it)", () => {
  it("strips any path, keeping only the basename", () => {
    expect(sanitizeFilename("../../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Windows\\evil.docx")).toBe("evil.docx");
  });
  it("drops control characters and leading dots, caps length, falls back", () => {
    expect(sanitizeFilename("a\tb.txt")).toBe("ab.txt"); // control char stripped
    expect(sanitizeFilename("...hidden")).toBe("hidden");
    expect(sanitizeFilename(123 as unknown)).toBe("upload");
    expect(sanitizeFilename("")).toBe("upload");
    expect(sanitizeFilename("x".repeat(400)).length).toBe(255);
  });
});

describe("isAllowedUploadMime", () => {
  it("accepts canonical + alias MIME strings, rejects others", () => {
    expect(isAllowedUploadMime("application/pdf")).toBe(true);
    expect(isAllowedUploadMime("image/jpg")).toBe(true);
    expect(isAllowedUploadMime("application/pdf; charset=binary")).toBe(true);
    expect(isAllowedUploadMime("application/zip")).toBe(false);
    expect(isAllowedUploadMime(undefined)).toBe(false);
  });
});
