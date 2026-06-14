/**
 * dataExportStorage.ts — Domain wrapper over blobStorage.ts for GDPR/CCPA
 * export bundles (data-rights-worker, PR #3).
 *
 * This module owns the export-bundle object key shape:
 *   org/{organizationId}/data-exports/{exportId}.zip
 *
 * Callers (the data-rights worker) MUST go through this module — never call
 * blobStorage.ts directly — so the key shape stays in one place, exactly as
 * vendorAssuranceStorage.ts owns the vendor-assurance key shape.
 *
 * The bundle is streamed to R2 via a managed multipart upload (see
 * blobStorage.createObjectWriteStream): runExport pipes its zip archive into the
 * returned `stream`, and `done` resolves with the final key + byte size once R2
 * has the whole object. Peak memory stays bounded — the export engine's
 * streaming discipline (PR #2a–#2d) is preserved all the way to storage.
 */

import {
  createObjectWriteStream,
  buildObjectKey,
  type ObjectWriteHandle
} from "./blobStorage.js";

const CONTENT_TYPE = "application/zip";

/** The relative key (org prefix is attached by blobStorage). */
function relativeKey(exportId: string): string {
  return `data-exports/${exportId}.zip`;
}

/** Absolute R2 key for one export bundle (org/{orgId}/data-exports/{exportId}.zip). */
export function dataExportObjectKey(organizationId: string, exportId: string): string {
  return buildObjectKey(organizationId, relativeKey(exportId));
}

/**
 * Open a streaming multipart upload for an export bundle. The worker pipes the
 * zip archive into `handle.stream`; `handle.done` resolves with the R2 key +
 * byte size after the upload completes; `handle.abort()` tears down the in-flight
 * multipart upload on failure so no orphan parts linger.
 */
export function createDataExportWriteStream(args: {
  organizationId: string;
  exportId: string;
}): ObjectWriteHandle {
  return createObjectWriteStream({
    organizationId: args.organizationId,
    relativeKey: relativeKey(args.exportId),
    contentType: CONTENT_TYPE
  });
}
