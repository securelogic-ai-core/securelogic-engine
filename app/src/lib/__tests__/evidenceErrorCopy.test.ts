/**
 * evidenceErrorCopy.test.ts — SL-EVID-1.
 *
 * One mapper, used by every evidence upload surface. Two guarantees under test:
 *
 *   1. The customer never sees a raw internal code. Three of the four upload
 *      surfaces used to render `Could not upload the file: storage_unavailable`
 *      verbatim.
 *   2. The copy names an ACTIONABLE condition without naming our
 *      infrastructure. "R2", "bucket", "env var" and friends are not the
 *      customer's problem and must not appear.
 */

import { describe, it, expect } from "vitest";
import {
  evidenceUploadErrorMessage,
  vendorDocumentFailureMessage,
  vendorAssuranceUploadErrorMessage,
} from "../evidenceErrorCopy";

/** Anything that names our infrastructure rather than the customer's situation. */
const INFRA_LEAK =
  /\b(R2|S3|bucket|blob|env var|environment variable|ANTHROPIC_API_KEY|AccessDenied|SDK|endpoint)\b/i;

const UPLOAD_CODES = [
  "unsupported_file_type",
  "file_content_mismatch",
  "file_too_large",
  "request_body_too_large",
  "empty_file",
  "invalid_multipart_body",
  "invalid_content_length",
  "content_length_required",
  "storage_unavailable",
  "blob_put_failed",
  "evidence_create_failed",
  "evidence_upload_failed",
  "org_storage_quota_exceeded",
  "not_authenticated",
  "api_key_required",
  "invalid_token",
  "session_invalidated",
  "read_only_access",
  "insufficient_entitlement",
  "organization_context_missing",
  "auth_unavailable",
  "source_record_not_found",
  "engine_unavailable",
];

describe("evidenceUploadErrorMessage", () => {
  it.each(UPLOAD_CODES)("maps %s to prose, never echoing the code", (code) => {
    const message = evidenceUploadErrorMessage(code);

    expect(message).not.toContain(code);
    expect(message).not.toMatch(/_/); // internal codes are snake_case
    expect(message.length).toBeGreaterThan(10);
    expect(message).not.toMatch(INFRA_LEAK);
  });

  it("tells the customer what to do when storage is unavailable", () => {
    const message = evidenceUploadErrorMessage("storage_unavailable");

    // Actionable: the reference path still works, and this is not their fault.
    expect(message.toLowerCase()).toContain("reference");
    expect(message).not.toMatch(INFRA_LEAK);
  });

  it("distinguishes 'storage is not available' from 'the save failed, retry'", () => {
    expect(evidenceUploadErrorMessage("storage_unavailable")).not.toBe(
      evidenceUploadErrorMessage("blob_put_failed"),
    );
  });

  it("interpolates the accepted-type list when one is supplied", () => {
    const message = evidenceUploadErrorMessage("unsupported_file_type", "PDF, PNG");

    expect(message).toContain("PDF, PNG");
  });

  it("falls back to safe prose for an unrecognised code", () => {
    const message = evidenceUploadErrorMessage("some_new_code_nobody_mapped");

    expect(message).not.toContain("some_new_code_nobody_mapped");
    expect(message).not.toMatch(INFRA_LEAK);
    expect(message.length).toBeGreaterThan(10);
  });

  it("strips a suffixed detail before matching (engine errors arrive as 'code: detail')", () => {
    expect(evidenceUploadErrorMessage("file_too_large: 40MB")).toBe(
      evidenceUploadErrorMessage("file_too_large"),
    );
  });
});

describe("vendorDocumentFailureMessage — the vendor-assurance document page", () => {
  it("says storage, not parsing, when the document was never read", () => {
    const message = vendorDocumentFailureMessage("storage_unavailable", null);

    expect(message).not.toMatch(/pars|corrupt|unreadable|damaged/i);
    expect(message).not.toMatch(INFRA_LEAK);
    // The reader must understand their document is fine.
    expect(message.toLowerCase()).toMatch(/not (yet )?(been )?read|no content was read|was not saved/);
  });

  it("still explains a genuine parse failure as a document problem", () => {
    const message = vendorDocumentFailureMessage("pdf_unparseable", null);

    expect(message).toMatch(/pars|read/i);
    expect(message).not.toMatch(INFRA_LEAK);
  });

  it("still explains a scanned/image-only document", () => {
    expect(vendorDocumentFailureMessage("pdf_image_only", null)).toMatch(/scan|image/i);
  });

  it("does not leak the model provider or key name when extraction is unconfigured", () => {
    const message = vendorDocumentFailureMessage("llm_unavailable", null);

    expect(message).not.toMatch(INFRA_LEAK);
    expect(message).not.toMatch(/anthropic/i);
  });

  it("never renders a stored raw detail verbatim, even when one is present", () => {
    const message = vendorDocumentFailureMessage(
      "storage_error",
      "blob put: blob storage is not configured (R2 env vars are absent)",
    );

    expect(message).not.toMatch(INFRA_LEAK);
    expect(message).not.toContain("blob put");
  });

  it("falls back to safe prose for an unknown code with no detail", () => {
    const message = vendorDocumentFailureMessage("something_unmapped", null);

    expect(message).not.toContain("something_unmapped");
    expect(message.length).toBeGreaterThan(10);
    expect(message).not.toMatch(INFRA_LEAK);
  });

  it("never echoes the raw code for any known code", () => {
    for (const code of [
      "pdf_unparseable",
      "pdf_image_only",
      "llm_unavailable",
      "llm_invalid_json",
      "llm_failed",
      "storage_unavailable",
      "storage_error",
    ]) {
      expect(vendorDocumentFailureMessage(code, null)).not.toContain(code);
    }
  });
});

describe("vendorAssuranceUploadErrorMessage — the SOC 2 upload form on the vendor page", () => {
  it("maps storage_unavailable instead of printing the code with an HTTP status", () => {
    const message = vendorAssuranceUploadErrorMessage("storage_unavailable");

    expect(message).not.toContain("storage_unavailable");
    expect(message).not.toMatch(/HTTP/);
    expect(message).not.toMatch(INFRA_LEAK);
    // Actionable: the customer's document is fine and someone else fixes this.
    expect(message!.toLowerCase()).toMatch(/administrator|not available/);
  });

  it("keeps blob_put_failed as a retryable message, distinct from storage_unavailable", () => {
    const a = vendorAssuranceUploadErrorMessage("storage_unavailable");
    const b = vendorAssuranceUploadErrorMessage("blob_put_failed");

    expect(a).not.toBe(b);
    expect(b).not.toMatch(INFRA_LEAK);
  });

  it("preserves the existing labels for the file-validation codes", () => {
    expect(vendorAssuranceUploadErrorMessage("unsupported_file_type")).toMatch(/PDF/);
    expect(vendorAssuranceUploadErrorMessage("file_too_large")).toMatch(/25 MB/);
    expect(vendorAssuranceUploadErrorMessage("vendor_not_found")).toMatch(/[Vv]endor/);
  });

  it("returns null for a code it does not know, so the caller keeps its operator diagnostics", () => {
    expect(vendorAssuranceUploadErrorMessage("some_unmapped_code")).toBeNull();
  });

  it("never leaks infrastructure wording for any mapped code", () => {
    for (const code of [
      "no_file_uploaded",
      "unsupported_file_type",
      "file_too_large",
      "vendor_not_found",
      "vendor_id_must_be_uuid",
      "invalid_document_type_hint",
      "original_filename_required",
      "storage_unavailable",
      "blob_put_failed",
      "upload_failed",
      "form_data_invalid",
      "unauthenticated",
      "not_found",
    ]) {
      const message = vendorAssuranceUploadErrorMessage(code);
      expect(message, code).not.toBeNull();
      expect(message!, code).not.toMatch(INFRA_LEAK);
      expect(message!, code).not.toContain(code);
    }
  });
});
