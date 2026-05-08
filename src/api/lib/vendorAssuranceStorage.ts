/**
 * vendorAssuranceStorage.ts — Domain wrapper over blobStorage.ts.
 *
 * This module owns the vendor-assurance object key shape:
 *   org/{organizationId}/vendor-assurance/{documentId}/original.pdf
 *
 * Route handlers MUST go through this module — never call blobStorage.ts
 * directly — so the key shape stays in one place and changes affect every
 * caller atomically.
 */

import {
  putObject,
  getObjectStream,
  getSignedReadUrl,
  deleteObject,
  buildObjectKey
} from "./blobStorage.js";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";

const PDF_TTL_SECONDS = 60;

function relativeKey(documentId: string): string {
  return `vendor-assurance/${documentId}/original.pdf`;
}

export function vendorAssuranceObjectKey(organizationId: string, documentId: string): string {
  return buildObjectKey(organizationId, relativeKey(documentId));
}

export async function putVendorAssurancePdf(args: {
  organizationId: string;
  documentId: string;
  bytes: Uint8Array | Buffer;
}): Promise<{ key: string; byteSize: number }> {
  return putObject({
    organizationId: args.organizationId,
    relativeKey: relativeKey(args.documentId),
    bytes: args.bytes,
    contentType: "application/pdf"
  });
}

export async function getVendorAssurancePdfStream(args: {
  organizationId: string;
  documentId: string;
}): Promise<GetObjectCommandOutput> {
  return getObjectStream({
    organizationId: args.organizationId,
    key: vendorAssuranceObjectKey(args.organizationId, args.documentId)
  });
}

export async function getVendorAssurancePdfSignedUrl(args: {
  organizationId: string;
  documentId: string;
}): Promise<{ url: string; ttlSeconds: number; expiresAt: Date }> {
  return getSignedReadUrl({
    organizationId: args.organizationId,
    key: vendorAssuranceObjectKey(args.organizationId, args.documentId),
    ttlSeconds: PDF_TTL_SECONDS
  });
}

export async function deleteVendorAssurancePdf(args: {
  organizationId: string;
  documentId: string;
}): Promise<void> {
  return deleteObject({
    organizationId: args.organizationId,
    key: vendorAssuranceObjectKey(args.organizationId, args.documentId)
  });
}
