/**
 * blobStorageConfig.ts — Cloudflare R2 configuration loader.
 *
 * Phase 0 of the vendor-assurance-intelligence build sequence ships the blob
 * primitive. This module owns env loading and S3 client construction (R2 is
 * S3-API compatible; we use @aws-sdk/client-s3 against the R2 endpoint).
 *
 * Posture:
 *   - Env vars are OPTIONAL at boot — production engine intentionally has no
 *     R2 wired up in this package; staging is the only consumer.
 *   - When env vars are PRESENT, they MUST validate cleanly. Malformed values
 *     throw at module load. Callers see a typed error if they call into the
 *     wrapper without configuration; the engine itself does not fail-closed
 *     on a missing-but-not-required block.
 *
 * No customer data flows through this module. Only the wrapper in
 * blobStorage.ts ever touches bytes.
 */

import { S3Client } from "@aws-sdk/client-s3";

export type BlobStorageConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
};

const REQUIRED_KEYS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_ENDPOINT"
] as const;

export type BlobStorageEnvState =
  | { state: "absent" }
  | { state: "configured"; config: BlobStorageConfig }
  | { state: "malformed"; reason: string };

/**
 * Inspect process.env without side effects. Returns a discriminated state so
 * callers can decide what to do (boot wants 'absent' to be OK; runtime callers
 * want 'configured' or a typed failure).
 */
export function readBlobStorageEnv(env: NodeJS.ProcessEnv = process.env): BlobStorageEnvState {
  const present = REQUIRED_KEYS.filter((k) => {
    const v = env[k];
    return typeof v === "string" && v.trim().length > 0;
  });

  if (present.length === 0) return { state: "absent" };

  if (present.length !== REQUIRED_KEYS.length) {
    const missing = REQUIRED_KEYS.filter((k) => !present.includes(k));
    return {
      state: "malformed",
      reason: `partial R2 config: missing ${missing.join(", ")}`
    };
  }

  const accountId = (env["R2_ACCOUNT_ID"] ?? "").trim();
  const accessKeyId = (env["R2_ACCESS_KEY_ID"] ?? "").trim();
  const secretAccessKey = (env["R2_SECRET_ACCESS_KEY"] ?? "").trim();
  const bucket = (env["R2_BUCKET"] ?? "").trim();
  const endpoint = (env["R2_ENDPOINT"] ?? "").trim();

  if (!/^https:\/\/[^\s]+$/.test(endpoint)) {
    return { state: "malformed", reason: "R2_ENDPOINT must be an https URL" };
  }
  if (bucket.length === 0 || /\s/.test(bucket)) {
    return { state: "malformed", reason: "R2_BUCKET must be non-empty and contain no whitespace" };
  }
  if (accessKeyId.length < 10) {
    return { state: "malformed", reason: "R2_ACCESS_KEY_ID looks invalid" };
  }
  if (secretAccessKey.length < 16) {
    return { state: "malformed", reason: "R2_SECRET_ACCESS_KEY looks invalid" };
  }

  return {
    state: "configured",
    config: { accountId, accessKeyId, secretAccessKey, bucket, endpoint }
  };
}

let cachedClient: S3Client | null = null;
let cachedConfig: BlobStorageConfig | null = null;

export class BlobStorageNotConfiguredError extends Error {
  constructor() {
    super("blob storage is not configured (R2 env vars are absent)");
    this.name = "BlobStorageNotConfiguredError";
  }
}

export class BlobStorageMalformedConfigError extends Error {
  constructor(reason: string) {
    super(`blob storage env is malformed: ${reason}`);
    this.name = "BlobStorageMalformedConfigError";
  }
}

/**
 * Returns a memoized S3Client wired for R2, plus the config. Throws
 * BlobStorageNotConfiguredError when env is absent and
 * BlobStorageMalformedConfigError when env is present-but-invalid.
 *
 * Module-load behavior: this function is NOT invoked at import time.
 * blobStorage.ts calls it lazily on first use. That keeps test environments
 * free of accidental SDK construction.
 */
export function getBlobStorageClient(): { client: S3Client; config: BlobStorageConfig } {
  if (cachedClient !== null && cachedConfig !== null) {
    return { client: cachedClient, config: cachedConfig };
  }

  const state = readBlobStorageEnv();
  if (state.state === "absent") throw new BlobStorageNotConfiguredError();
  if (state.state === "malformed") throw new BlobStorageMalformedConfigError(state.reason);

  cachedConfig = state.config;
  cachedClient = new S3Client({
    region: "auto",
    endpoint: state.config.endpoint,
    credentials: {
      accessKeyId: state.config.accessKeyId,
      secretAccessKey: state.config.secretAccessKey
    },
    forcePathStyle: true
  });

  return { client: cachedClient, config: cachedConfig };
}

/**
 * Test-only reset hook. Tests that mutate process.env between cases call this
 * to drop the memoized client. Not exported via index — call via direct import.
 */
export function _resetBlobStorageClientForTests(): void {
  cachedClient = null;
  cachedConfig = null;
}

/**
 * Boot-time validator. Called from validateEnv-style startup paths in a future
 * package. In Phase 0 it is invoked only by the smoke script. Returns void on
 * success; throws on malformed config; tolerates absent.
 */
export function assertBlobStorageBootValid(): void {
  const state = readBlobStorageEnv();
  if (state.state === "malformed") {
    throw new BlobStorageMalformedConfigError(state.reason);
  }
}
