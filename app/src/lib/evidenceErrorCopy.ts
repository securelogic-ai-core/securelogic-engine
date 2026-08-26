/**
 * evidenceErrorCopy.ts — SL-EVID-1. The single place that turns an engine
 * error code into something a customer can read and act on.
 *
 * WHY THIS EXISTS
 *   The mapping used to live inside `components/findings/FindingEvidenceSection`,
 *   so exactly one of the four evidence-upload surfaces had it. The control,
 *   obligation and AI-system forms each rendered
 *   `Could not upload the file: ${res.error}` — i.e. they printed the raw
 *   internal code (`storage_unavailable`, `blob_put_failed`) straight at the
 *   customer.
 *
 * TWO RULES, and the tests enforce both:
 *   1. Never echo the code. A snake_case token is an implementation detail.
 *   2. Never name our infrastructure. "R2", "bucket", "env var" and the model
 *      provider's key name tell the reader nothing they can act on, and
 *      describe systems they have no relationship with. Say what happened, what
 *      still works, and who fixes it.
 *
 * These functions are pure and dependency-free so both server and client
 * components can import them.
 */

/** The default accepted-type list, mirroring components/findings/findingEvidencePayload. */
const DEFAULT_ACCEPTED_LABEL = "PDF, PNG, JPG, TXT, CSV, DOCX, XLSX, PPTX";

const GENERIC_UPLOAD_FAILURE =
  "Could not upload the file. Try again, or add a reference instead.";

/**
 * Customer-facing copy for an evidence FILE UPLOAD failure.
 *
 * `raw` may arrive as a bare code or as `code: detail` — the engine appends
 * detail on some paths — so only the leading token is matched and the detail is
 * discarded rather than displayed.
 */
export function evidenceUploadErrorMessage(
  raw: string,
  acceptedLabel: string = DEFAULT_ACCEPTED_LABEL,
): string {
  const code = raw.split(":")[0]?.trim() ?? raw;

  switch (code) {
    // — Invalid file: the file itself is rejected. —
    case "unsupported_file_type":
    case "file_content_mismatch":
      return `That file type isn't accepted. Allowed: ${acceptedLabel}.`;
    case "file_too_large":
    case "request_body_too_large":
      return "That file is too large (max 25 MB). Choose a smaller file, or add a reference instead.";
    case "empty_file":
      return "That file is empty.";

    // — Transport / malformed request: the bytes didn't arrive intact. —
    case "invalid_multipart_body":
    case "invalid_content_length":
    case "content_length_required":
      return "The file couldn't be sent. Try again, or add a reference instead.";

    // — Configuration unavailable: file storage isn't switched on here. The
    //   customer did nothing wrong and retrying will not help, so the copy
    //   points at the path that still works and at who can fix it. —
    case "storage_unavailable":
      return "File storage isn't available on this workspace yet, so the file wasn't saved. Add a reference instead, or ask your administrator to enable file storage.";

    // — Storage failure: storage exists but the write/record failed. Retrying
    //   is reasonable here, which is why this is not the same message. —
    case "blob_put_failed":
    case "evidence_create_failed":
    case "evidence_upload_failed":
      return "The file couldn't be saved. Try again shortly, or add a reference instead.";

    case "org_storage_quota_exceeded":
      return "Your organization's evidence storage limit has been reached.";

    // — Authorization: session expired or insufficient permission. —
    case "not_authenticated":
    case "api_key_required":
    case "invalid_token":
    case "session_invalidated":
      return "Your session has expired. Sign in again and retry.";
    case "read_only_access":
    case "insufficient_entitlement":
    case "organization_context_missing":
      return "You don't have permission to upload evidence on this account.";
    case "auth_unavailable":
      return "Sign-in is temporarily unavailable. Try again shortly.";

    // — Not found / connectivity. —
    case "source_record_not_found":
      return "That record could not be found — reload and try again.";
    case "engine_unavailable":
      return "Couldn't reach the server. Try again shortly, or add a reference instead.";

    default:
      return GENERIC_UPLOAD_FAILURE;
  }
}

/**
 * The `processing_error_code` values that mean "object storage", not "your
 * document". Callers use this to avoid captioning a storage fault
 * "Extraction failed" — no extraction was attempted.
 */
export const STORAGE_DOCUMENT_ERROR_CODES: ReadonlySet<string> = new Set([
  "storage_unavailable",
  "storage_error",
]);

export function isStorageFailure(code: string | null | undefined): boolean {
  return typeof code === "string" && STORAGE_DOCUMENT_ERROR_CODES.has(code);
}

/**
 * Customer-facing copy for a FAILED VENDOR-ASSURANCE DOCUMENT
 * (`vendor_assurance_documents.processing_error_code`).
 *
 * The storage codes are the point of SL-EVID-1. Before it, a document whose
 * bytes never reached storage was recorded as `pdf_unparseable`, so the page
 * told the customer their SOC 2 report was corrupt. These two codes say the
 * opposite, explicitly: the document was never read, so nothing is known — or
 * implied — about it.
 *
 * `detail` is accepted so callers cannot be tempted to render the stored
 * detail themselves; it is deliberately NOT interpolated into the output,
 * because the persisted detail has historically carried SDK wording.
 */
export function vendorDocumentFailureMessage(
  code: string | null,
  _detail: string | null,
): string {
  switch (code) {
    // — SL-EVID-1: storage, not content. —
    case "storage_unavailable":
      return "Secure document storage isn't available for this workspace, so this document wasn't saved. No content was read from it — the document itself is fine. Ask your administrator to enable document storage, then upload it again.";
    case "storage_error":
      return "This document couldn't be saved to secure storage. No content was read from it — the document itself is fine. Upload it again shortly.";

    // — Genuine content faults: unchanged behaviour. —
    case "pdf_image_only":
      return "This PDF appears to be a scan or image only, so there was no selectable text to read. Upload a text-bearing PDF — a version exported from the original document rather than scanned.";
    case "pdf_unparseable":
      return "This PDF could not be read. It may be corrupt, password-protected, or in an unsupported format. Try re-exporting it and uploading again.";

    // — Extraction faults. The provider and its key name are ours, not the
    //   customer's, so neither is named. —
    case "llm_unavailable":
      return "Automated extraction isn't available on this workspace yet, so the document was saved but not analyzed. Ask your administrator to enable document analysis.";
    case "llm_invalid_json":
      return "Automated extraction returned a result we couldn't use. Upload the document again to retry.";
    case "llm_failed":
      return "Automated extraction didn't complete. Upload the document again to retry.";

    default:
      return "This document couldn't be processed. Upload it again, and contact support if it keeps failing.";
  }
}

/**
 * Customer-facing copy for the VENDOR-ASSURANCE DOCUMENT UPLOAD form on the
 * vendor detail page — the actual entry point of the "upload a SOC 2" flow.
 *
 * Returns `null` for an unrecognised code ON PURPOSE. That form deliberately
 * appends the HTTP status for codes it cannot name, so an operator can tell an
 * auth failure from a routing failure from a dark feature flag off a single
 * screenshot. Returning null preserves that diagnostic instead of swallowing it
 * behind generic prose.
 */
export function vendorAssuranceUploadErrorMessage(code: string): string | null {
  switch (code) {
    // — SL-EVID-1: without this the form rendered
    //   "Upload failed (storage_unavailable). [HTTP 503]" at the customer. —
    case "storage_unavailable":
      return "Secure document storage isn't available on this workspace yet, so the document wasn't saved. Your file is fine — ask your administrator to enable document storage, then upload it again.";
    case "blob_put_failed":
      return "The document couldn't be saved to secure storage. Try again in a moment.";

    // — Pre-existing vocabulary, preserved verbatim. —
    case "no_file_uploaded":
      return "Choose a PDF file before submitting.";
    case "unsupported_file_type":
      return "Only PDF files are accepted.";
    case "file_too_large":
      return "PDF exceeds the 25 MB upload limit.";
    case "vendor_not_found":
      return "Vendor was not found for this organization.";
    case "vendor_id_must_be_uuid":
      return "Vendor ID is invalid.";
    case "invalid_document_type_hint":
      return "Document type is not a recognized SOC report type.";
    case "original_filename_required":
      return "File name could not be read — re-select the PDF.";
    case "upload_failed":
      return "Upload failed. Please try again.";
    case "form_data_invalid":
      return "The upload was rejected before it reached the server. Re-select the file and try again.";
    case "unauthenticated":
      return "Session expired. Please sign in and retry.";
    case "not_found":
      return "Vendor Assurance isn't enabled on this workspace yet.";

    default:
      return null;
  }
}
