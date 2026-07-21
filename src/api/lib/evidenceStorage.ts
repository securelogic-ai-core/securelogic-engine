/**
 * evidenceStorage.ts — Domain wrapper over blobStorage.ts for Remediation
 * Evidence file attachments.
 *
 * Owns the evidence object key shape:
 *   org/{organizationId}/evidence/{evidenceId}/original
 *
 * Route handlers MUST go through this module — never call blobStorage.ts
 * directly — so the key shape stays in one place. blobStorage enforces the
 * org/{orgId}/ prefix at its boundary (TENANT_ISOLATION_STANDARD §5), so a
 * cross-tenant key is impossible to construct here.
 *
 * Downloads are served ONLY via short-lived, single-org pre-signed URLs
 * (TTL ≤ MAX_SIGNED_URL_TTL_SECONDS). There is no public object URL.
 */

import {
  putObject,
  getSignedReadUrl,
  deleteObject,
  buildObjectKey,
} from "./blobStorage.js";

/** Short signed-URL lifetime — long enough to open/download, short enough that a
 *  leaked URL is useless almost immediately. blobStorage clamps to 120s anyway. */
const EVIDENCE_URL_TTL_SECONDS = 90;

function relativeKey(evidenceId: string): string {
  return `evidence/${evidenceId}/original`;
}

export function evidenceObjectKey(organizationId: string, evidenceId: string): string {
  return buildObjectKey(organizationId, relativeKey(evidenceId));
}

export async function putEvidenceFile(args: {
  organizationId: string;
  evidenceId: string;
  bytes: Uint8Array | Buffer;
  contentType: string;
  /** The already-sanitized display filename (no control chars / path). */
  filename: string;
}): Promise<{ key: string; byteSize: number }> {
  return putObject({
    organizationId: args.organizationId,
    relativeKey: relativeKey(args.evidenceId),
    bytes: args.bytes,
    contentType: args.contentType,
    // Force download rather than inline render — a hard stop against any file
    // whose bytes are attacker-controlled (e.g. text with markup) executing in
    // the browser — and preserve the original filename on save. Quotes/backslashes
    // are stripped so the header value cannot be broken out of (the filename was
    // already stripped of control chars incl. CR/LF upstream).
    contentDisposition: `attachment; filename="${args.filename.replace(/["\\]/g, "")}"`,
  });
}

export async function getEvidenceFileSignedUrl(args: {
  organizationId: string;
  evidenceId: string;
}): Promise<{ url: string; ttlSeconds: number; expiresAt: Date }> {
  return getSignedReadUrl({
    organizationId: args.organizationId,
    key: evidenceObjectKey(args.organizationId, args.evidenceId),
    ttlSeconds: EVIDENCE_URL_TTL_SECONDS,
  });
}

/** Best-effort cleanup when a row INSERT fails after the blob was written — so a
 *  failed upload leaves neither a DB row nor an orphaned object. */
export async function deleteEvidenceFile(args: {
  organizationId: string;
  evidenceId: string;
}): Promise<void> {
  return deleteObject({
    organizationId: args.organizationId,
    key: evidenceObjectKey(args.organizationId, args.evidenceId),
  });
}
