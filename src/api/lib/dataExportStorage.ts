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
  getSignedReadUrl,
  buildObjectKey,
  type ObjectWriteHandle
} from "./blobStorage.js";

const CONTENT_TYPE = "application/zip";

/**
 * Download-link TTL for an export bundle. Clamped by blobStorage to
 * MAX_SIGNED_URL_TTL_SECONDS (120s) — short-lived ON PURPOSE: the durable
 * credential the subject holds is the download TOKEN (7-day, O-9), and the
 * route mints a fresh ≤120s signed URL on each download. No long-lived presigned
 * URL is ever stored or emailed (O-9). This mirrors vendorAssuranceStorage.
 */
const DOWNLOAD_SIGNED_URL_TTL_SECONDS = 120;

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

/**
 * Mint a short-lived (≤120s) single-org signed download URL for a stored export
 * bundle. The caller passes the EXACT key recorded in
 * `data_export_files.r2_key`; blobStorage re-asserts the key belongs to
 * `organizationId` before signing, so a row from org A can never produce a URL
 * for org B's bytes. The download routes 302-redirect to this URL — the engine
 * never proxies the bundle bytes (bounded memory; same pattern as
 * vendorAssuranceStorage's PDF download).
 */
export async function getDataExportSignedUrl(args: {
  organizationId: string;
  r2Key: string;
}): Promise<{ url: string; ttlSeconds: number; expiresAt: Date }> {
  return getSignedReadUrl({
    organizationId: args.organizationId,
    key: args.r2Key,
    ttlSeconds: DOWNLOAD_SIGNED_URL_TTL_SECONDS
  });
}
