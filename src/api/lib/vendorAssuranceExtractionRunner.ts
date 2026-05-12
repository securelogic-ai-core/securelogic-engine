/**
 * vendorAssuranceExtractionRunner.ts
 *
 * Phase 1 staging-first compromise. In-process, single-document, bounded-volume
 * execution model. Production-grade architecture (durable queue, dedicated
 * worker, retry policy, concurrency control) is an explicit follow-on package.
 * Do not promote this runner to production without that work.
 *
 * The runner is invoked from the upload handler via setImmediate so the POST
 * returns 202 quickly; it then walks status transitions on
 * vendor_assurance_documents in this order:
 *   pending → extracting → extracted        (success)
 *   pending → extracting → extraction_failed (any failure)
 *
 * On success it INSERTs vendor_assurance_extractions and bulk-inserts
 * vendor_assurance_extraction_spans inside one transaction.
 *
 * No re-extraction flow exists. A failed document requires re-upload to
 * retry. The status-transition path is one-way.
 */

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { writeAuditEvent } from "./auditLog.js";
import { getVendorAssurancePdfStream } from "./vendorAssuranceStorage.js";
import { extractPdfText } from "./vendorAssurancePdfExtractor.js";
import { runSocExtraction, RAW_EXCERPT_BYTES, type SocExtractionResult } from "./claudeSocExtractor.js";

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (body == null) throw new Error("empty body");
  // S3 SDK Body in Node is an AsyncIterable<Uint8Array>.
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function markExtracting(documentId: string, organizationId: string): Promise<void> {
  await pg.query(
    `UPDATE vendor_assurance_documents
        SET processing_status = 'extracting',
            updated_at = NOW()
      WHERE id = $1 AND organization_id = $2 AND processing_status = 'pending'`,
    [documentId, organizationId]
  );
}

async function markFailed(
  documentId: string,
  organizationId: string,
  errorCode: string,
  errorDetail: string,
  rawResponseExcerpt?: string | null
): Promise<void> {
  // rawResponseExcerpt is only supplied on the llm_invalid_json paths (a model
  // response was received but did not parse / did not validate). It is already
  // bounded by the extractor; re-truncate to the same RAW_EXCERPT_BYTES budget
  // the success path uses on vendor_assurance_extractions, defensively. NULL on
  // every other failure path (pdf_unparseable, llm_failed, unhandled).
  const rawExcerpt =
    typeof rawResponseExcerpt === "string" && rawResponseExcerpt.length > 0
      ? rawResponseExcerpt.slice(0, RAW_EXCERPT_BYTES)
      : null;
  await pg.query(
    `UPDATE vendor_assurance_documents
        SET processing_status = 'extraction_failed',
            processing_error_code = $3,
            processing_error_detail = $4,
            raw_response_excerpt = $5,
            updated_at = NOW()
      WHERE id = $1 AND organization_id = $2`,
    [documentId, organizationId, errorCode, errorDetail.slice(0, 4000), rawExcerpt]
  );
  writeAuditEvent({
    organizationId,
    eventType: "vendor_assurance.extraction.failed",
    resourceType: "vendor_assurance_document",
    resourceId: documentId,
    payload: {
      error_code: errorCode,
      error_detail: errorDetail.slice(0, 500),
      raw_response_excerpt_present: rawExcerpt !== null
    }
  });
}

async function persistExtractionAndMarkExtracted(
  documentId: string,
  organizationId: string,
  result: Extract<SocExtractionResult, { ok: true }>
): Promise<{ extractionId: string; spanCount: number; fieldCount: number }> {
  const client = await pg.connect();
  try {
    await client.query("BEGIN");

    const insertExtraction = await client.query<{ id: string }>(
      `INSERT INTO vendor_assurance_extractions (
         organization_id, document_id, model_id, prompt_version, raw_response_excerpt, fields
       )
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id`,
      [
        organizationId,
        documentId,
        result.modelId,
        result.promptVersion,
        result.rawExcerpt,
        JSON.stringify(result.fields)
      ]
    );
    const extractionId = insertExtraction.rows[0]!.id;

    if (result.spans.length > 0) {
      // Bulk insert with parameter expansion.
      const values: unknown[] = [];
      const placeholders: string[] = [];
      let p = 1;
      for (const span of result.spans) {
        placeholders.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
        values.push(
          organizationId,
          extractionId,
          span.field_name,
          span.page_number,
          span.char_start,
          span.char_end,
          span.quote
        );
      }
      await client.query(
        `INSERT INTO vendor_assurance_extraction_spans
           (organization_id, extraction_id, field_name, page_number, char_start, char_end, quote)
         VALUES ${placeholders.join(", ")}`,
        values
      );
    }

    await client.query(
      `UPDATE vendor_assurance_documents
          SET processing_status = 'extracted',
              processing_error_code = NULL,
              processing_error_detail = NULL,
              updated_at = NOW()
        WHERE id = $1 AND organization_id = $2`,
      [documentId, organizationId]
    );

    await client.query("COMMIT");

    return {
      extractionId,
      spanCount: result.spans.length,
      fieldCount: Object.keys(result.fields).length
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run the in-process extraction for one document. Caller schedules this via
 * setImmediate from the upload handler; this function MUST swallow its own
 * errors (status is recorded on the document row instead) so an unhandled
 * promise rejection cannot crash the engine process.
 */
export async function runExtraction(args: {
  documentId: string;
  organizationId: string;
  documentTypeHint: string | null;
}): Promise<void> {
  const { documentId, organizationId, documentTypeHint } = args;

  try {
    await markExtracting(documentId, organizationId);

    writeAuditEvent({
      organizationId,
      eventType: "vendor_assurance.extraction.started",
      resourceType: "vendor_assurance_document",
      resourceId: documentId,
      payload: { document_type_hint: documentTypeHint }
    });

    // 1. Pull the PDF bytes from R2.
    let pdfBytes: Buffer;
    try {
      const obj = await getVendorAssurancePdfStream({ organizationId, documentId });
      pdfBytes = await streamToBuffer(obj.Body);
    } catch (err) {
      const detail = (err as Error)?.message ?? "blob fetch failed";
      await markFailed(documentId, organizationId, "pdf_unparseable", `blob fetch: ${detail}`);
      return;
    }

    // 2. Parse text.
    const parsed = await extractPdfText(pdfBytes);
    if (!parsed.ok) {
      await markFailed(documentId, organizationId, parsed.errorCode, parsed.detail);
      return;
    }

    // 3. Call the LLM.
    const extracted = await runSocExtraction({
      organizationId,
      documentText: parsed.text,
      documentTypeHint
    });
    if (!extracted.ok) {
      await markFailed(
        documentId,
        organizationId,
        extracted.errorCode,
        extracted.detail,
        extracted.rawExcerpt
      );
      return;
    }

    // 4. Persist transactionally and mark extracted.
    const persisted = await persistExtractionAndMarkExtracted(
      documentId,
      organizationId,
      extracted
    );

    writeAuditEvent({
      organizationId,
      eventType: "vendor_assurance.extraction.completed",
      resourceType: "vendor_assurance_document",
      resourceId: documentId,
      payload: {
        extraction_id: persisted.extractionId,
        field_count: persisted.fieldCount,
        span_count: persisted.spanCount,
        model_id: extracted.modelId,
        prompt_version: extracted.promptVersion
      }
    });

    logger.info(
      {
        event: "vendor_assurance_extraction_completed",
        organizationId,
        documentId,
        extractionId: persisted.extractionId,
        fieldCount: persisted.fieldCount,
        spanCount: persisted.spanCount
      },
      "Vendor-assurance extraction completed"
    );
  } catch (err) {
    // Last-resort catch — the runner must never throw. Record the failure on
    // the document row so the UI shows a typed error.
    const detail = (err as Error)?.stack ?? (err as Error)?.message ?? "unknown";
    logger.error(
      {
        event: "vendor_assurance_extraction_runner_unhandled",
        organizationId,
        documentId,
        err: detail
      },
      "Vendor-assurance extraction runner caught unhandled error"
    );
    try {
      await markFailed(documentId, organizationId, "llm_failed", `unhandled: ${detail.slice(0, 500)}`);
    } catch {
      /* ignore — best effort */
    }
  }
}

/**
 * Schedule the runner without awaiting. The upload handler calls this; it
 * returns immediately so the POST can respond 202. setImmediate ensures the
 * scheduled work does not block the request loop tick.
 */
export function scheduleExtraction(args: {
  documentId: string;
  organizationId: string;
  documentTypeHint: string | null;
}): void {
  setImmediate(() => {
    void runExtraction(args);
  });
}
