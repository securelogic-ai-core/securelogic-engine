/**
 * blobStorage.ts — Cloudflare R2 wrapper. Phase 0 of the
 * vendor-assurance-intelligence build sequence.
 *
 * Hard rule (TENANT_ISOLATION_STANDARD.md §5):
 *   Every object key MUST be prefixed with `org/{organizationId}/`.
 *   This module enforces the prefix at the wrapper boundary BEFORE any I/O,
 *   so a caller cannot accidentally write a key that crosses tenants.
 *
 * Pre-signed URLs:
 *   - Single-org by construction (the key carries the org prefix).
 *   - TTL is clamped to MAX_SIGNED_URL_TTL_SECONDS (120). Callers asking for
 *     longer get the clamp; callers asking for ≤ 0 get a typed rejection.
 *
 * No customer-data writers exist in Phase 0. The first consumer is
 * vendorAssuranceStorage.ts in Phase 1.
 */

import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand
} from "@aws-sdk/client-s3";
import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getBlobStorageClient } from "./blobStorageConfig.js";

export const MAX_SIGNED_URL_TTL_SECONDS = 120;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class BlobStorageKeyPrefixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlobStorageKeyPrefixError";
  }
}

export class BlobStorageInvalidArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlobStorageInvalidArgumentError";
  }
}

function assertValidOrganizationId(organizationId: string): void {
  if (typeof organizationId !== "string") {
    throw new BlobStorageInvalidArgumentError("organizationId must be a string");
  }
  const trimmed = organizationId.trim();
  if (trimmed.length === 0) {
    throw new BlobStorageInvalidArgumentError("organizationId must not be empty");
  }
  if (trimmed !== organizationId) {
    throw new BlobStorageInvalidArgumentError(
      "organizationId must not contain leading/trailing whitespace"
    );
  }
  if (!UUID_RE.test(organizationId)) {
    throw new BlobStorageInvalidArgumentError("organizationId must be a UUID");
  }
}

function expectedPrefix(organizationId: string): string {
  return `org/${organizationId}/`;
}

/**
 * Build the absolute object key from an organizationId + relative key. The
 * relative key MUST NOT itself start with `org/` — callers supply the path
 * AFTER the org prefix, and this function attaches the prefix.
 */
export function buildObjectKey(organizationId: string, relativeKey: string): string {
  assertValidOrganizationId(organizationId);
  if (typeof relativeKey !== "string" || relativeKey.length === 0) {
    throw new BlobStorageInvalidArgumentError("relativeKey must be non-empty");
  }
  if (relativeKey.startsWith("/")) {
    throw new BlobStorageInvalidArgumentError("relativeKey must not start with '/'");
  }
  if (relativeKey.startsWith("org/")) {
    throw new BlobStorageInvalidArgumentError(
      "relativeKey must not begin with 'org/' — the wrapper attaches the prefix"
    );
  }
  if (relativeKey.includes("..")) {
    throw new BlobStorageInvalidArgumentError("relativeKey must not contain '..'");
  }
  return `${expectedPrefix(organizationId)}${relativeKey}`;
}

/**
 * Hard guard: assert the absolute key starts with the org prefix. Called as
 * the FIRST line of every public method, before any SDK construction or
 * network call. Tests assert this ordering by spying on the SDK mock.
 */
function assertKeyBelongsToOrg(organizationId: string, key: string): void {
  assertValidOrganizationId(organizationId);
  if (typeof key !== "string" || key.length === 0) {
    throw new BlobStorageKeyPrefixError("key must be non-empty");
  }
  const prefix = expectedPrefix(organizationId);
  if (!key.startsWith(prefix)) {
    throw new BlobStorageKeyPrefixError(
      `key '${key}' does not start with required prefix '${prefix}'`
    );
  }
}

export type PutObjectArgs = {
  organizationId: string;
  /** Absolute key (org/{orgId}/...) OR a relative key — relative is preferred. */
  relativeKey: string;
  bytes: Uint8Array | Buffer;
  contentType: string;
};

export type PutObjectResult = {
  key: string;
  byteSize: number;
};

export async function putObject(args: PutObjectArgs): Promise<PutObjectResult> {
  const key = buildObjectKey(args.organizationId, args.relativeKey);
  assertKeyBelongsToOrg(args.organizationId, key);

  if (!(args.bytes instanceof Uint8Array) && !Buffer.isBuffer(args.bytes)) {
    throw new BlobStorageInvalidArgumentError("bytes must be a Uint8Array or Buffer");
  }
  if (typeof args.contentType !== "string" || args.contentType.length === 0) {
    throw new BlobStorageInvalidArgumentError("contentType must be non-empty");
  }

  const { client, config } = getBlobStorageClient();
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: args.bytes,
      ContentType: args.contentType
    })
  );

  return { key, byteSize: args.bytes.byteLength };
}

export type GetObjectArgs = {
  organizationId: string;
  /** Absolute key — must already include the org prefix. */
  key: string;
};

export async function getObjectStream(args: GetObjectArgs): Promise<GetObjectCommandOutput> {
  assertKeyBelongsToOrg(args.organizationId, args.key);
  const { client, config } = getBlobStorageClient();
  return client.send(
    new GetObjectCommand({ Bucket: config.bucket, Key: args.key })
  );
}

export type SignedReadUrlArgs = {
  organizationId: string;
  key: string;
  ttlSeconds: number;
};

export async function getSignedReadUrl(args: SignedReadUrlArgs): Promise<{
  url: string;
  ttlSeconds: number;
  expiresAt: Date;
}> {
  if (typeof args.ttlSeconds !== "number" || !Number.isFinite(args.ttlSeconds)) {
    throw new BlobStorageInvalidArgumentError("ttlSeconds must be a finite number");
  }
  if (args.ttlSeconds <= 0) {
    throw new BlobStorageInvalidArgumentError("ttlSeconds must be > 0");
  }
  assertKeyBelongsToOrg(args.organizationId, args.key);

  const ttlSeconds = Math.min(Math.floor(args.ttlSeconds), MAX_SIGNED_URL_TTL_SECONDS);

  const { client, config } = getBlobStorageClient();
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: config.bucket, Key: args.key }),
    { expiresIn: ttlSeconds }
  );

  return {
    url,
    ttlSeconds,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000)
  };
}

export type DeleteObjectArgs = {
  organizationId: string;
  key: string;
};

export async function deleteObject(args: DeleteObjectArgs): Promise<void> {
  assertKeyBelongsToOrg(args.organizationId, args.key);
  const { client, config } = getBlobStorageClient();
  await client.send(
    new DeleteObjectCommand({ Bucket: config.bucket, Key: args.key })
  );
}
