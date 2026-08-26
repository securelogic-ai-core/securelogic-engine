/**
 * blobStorageReadiness.ts — SL-EVID-1. The single authority on "is object
 * storage actually usable, and when it isn't, whose problem is it?"
 *
 * WHY THIS EXISTS
 *   Three call sites used to attribute an object-storage failure to the
 *   customer's document:
 *     - routes/vendorAssuranceDocuments.ts — the R2 PUT at upload
 *     - lib/vendorAssuranceExtractionRunner.ts — the R2 GET before parsing
 *     - workers/vendorExtractionWorker.ts — the same GET, out of process
 *   All three wrote `processing_error_code = 'pdf_unparseable'`, so an org
 *   whose engine simply had no R2 credentials was told its SOC 2 report was
 *   corrupt. The document was fine. The bucket was missing.
 *
 *   `classifyStorageFailure` is the shared verdict those three sites now use.
 *   It NEVER returns a content-fault code: a failure thrown out of the storage
 *   layer is a storage fault, including the ones we do not recognise.
 *
 * READINESS IS NOT CONFIGURATION
 *   `readBlobStorageEnv()` answers "are the five variables present and well
 *   shaped". That is necessary and nowhere near sufficient — the production
 *   symptom this package chases is credentials that exist and a bucket that
 *   cannot be reached. `checkBlobStorageReadiness()` therefore issues a real
 *   HeadBucket round trip and only then reports `ready`.
 *
 * WHAT THE PROBE MAY SAY OUT LOUD
 *   Its result is surfaced on `/health`, which is UNAUTHENTICATED. The returned
 *   object carries a bare state and nothing else — no bucket, no endpoint, no
 *   account id, no SDK message. The diagnostic detail goes to the log, where it
 *   is already privileged.
 */

import { HeadBucketCommand } from "@aws-sdk/client-s3";
import {
  readBlobStorageEnv,
  getBlobStorageClient,
} from "./blobStorageConfig.js";
import { logger } from "../infra/logger.js";

/** How the storage layer failed, in the terms the caller has to act on. */
export type StorageFailureKind =
  /** The operator has not wired storage up (absent or malformed config). */
  | "not_configured"
  /** Storage is configured but the call did not land (auth, DNS, bucket, timeout). */
  | "unreachable"
  /** Thrown by the storage layer, cause unrecognised. Still a storage fault. */
  | "unknown";

/**
 * The two `processing_error_code` values a storage fault may be recorded as.
 * Deliberately disjoint from every content code in
 * `VendorExtractionErrorCode` — that disjointness is the fix.
 */
export type StorageDocumentErrorCode = "storage_unavailable" | "storage_error";

export type StorageFailureVerdict = {
  kind: StorageFailureKind;
  /** What to persist on the document row. Never a content code. */
  documentErrorCode: StorageDocumentErrorCode;
  /** What the HTTP caller gets. 503 means "come back when the operator has fixed it". */
  httpStatus: 503 | 500;
  /** The stable API error string, matching the vocabulary routes/evidence.ts already uses. */
  apiError: "storage_unavailable" | "blob_put_failed";
};

const NOT_CONFIGURED_ERROR_NAMES = new Set([
  "BlobStorageNotConfiguredError",
  "BlobStorageMalformedConfigError",
]);

/**
 * S3/R2 fault names that mean "configured, but the call did not land". Auth
 * failures sit here rather than under `not_configured` on purpose: a rotated
 * or revoked key is present and well-shaped, so the env check cannot see it —
 * only a round trip can.
 */
const UNREACHABLE_ERROR_NAMES = new Set([
  "AccessDenied",
  "InvalidAccessKeyId",
  "SignatureDoesNotMatch",
  "NoSuchBucket",
  "NotFound",
  "PermanentRedirect",
  "TimeoutError",
  "RequestTimeout",
  "NetworkingError",
  "CredentialsProviderError",
]);

const UNREACHABLE_ERROR_CODES = new Set([
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EPIPE",
]);

/**
 * Classify a failure thrown out of the object-storage layer.
 *
 * The contract callers rely on: the returned `documentErrorCode` is ALWAYS a
 * storage code. There is no input for which this function attributes the
 * failure to the customer's file.
 */
export function classifyStorageFailure(err: unknown): StorageFailureVerdict {
  const name = (err as { name?: unknown } | null)?.name;
  const code = (err as { code?: unknown } | null)?.code;

  if (typeof name === "string" && NOT_CONFIGURED_ERROR_NAMES.has(name)) {
    return {
      kind: "not_configured",
      documentErrorCode: "storage_unavailable",
      httpStatus: 503,
      apiError: "storage_unavailable",
    };
  }

  const unreachable =
    (typeof name === "string" && UNREACHABLE_ERROR_NAMES.has(name)) ||
    (typeof code === "string" && UNREACHABLE_ERROR_CODES.has(code));

  if (unreachable) {
    return {
      kind: "unreachable",
      documentErrorCode: "storage_error",
      httpStatus: 500,
      apiError: "blob_put_failed",
    };
  }

  return {
    kind: "unknown",
    documentErrorCode: "storage_error",
    httpStatus: 500,
    apiError: "blob_put_failed",
  };
}

/**
 * What gets PERSISTED as `processing_error_detail` for a storage fault.
 *
 * This column is rendered on the customer-facing document page, so it must not
 * carry the SDK's message — "blob storage is not configured (R2 env vars are
 * absent)" names our infrastructure and tells the reader nothing they can act
 * on. These strings say what happened and who can fix it, and nothing else.
 */
export const STORAGE_FAILURE_DETAIL: Record<StorageDocumentErrorCode, string> = {
  storage_unavailable:
    "Secure document storage is not available for this workspace, so the file was not saved. No content was read from the document.",
  storage_error:
    "The file could not be saved to secure document storage. No content was read from the document.",
};

// ─── Readiness probe ─────────────────────────────────────────────────────────

export type BlobStorageReadiness =
  | { state: "not_configured" }
  | { state: "misconfigured" }
  | { state: "ready" }
  | { state: "unreachable" };

/**
 * How long a probe result is trusted. `/health` is unauthenticated and Render
 * polls it continuously, so an uncached probe would turn the health endpoint
 * into an unauthenticated amplifier against R2.
 */
export const READINESS_CACHE_MS = 30_000;

/** A probe that hangs must not hold a health check open. */
const PROBE_TIMEOUT_MS = 3_000;

let cached: { at: number; value: BlobStorageReadiness } | null = null;
let inFlight: Promise<BlobStorageReadiness> | null = null;

/** Test seam: drop the memoized verdict. */
export function resetBlobStorageReadinessCache(): void {
  cached = null;
  inFlight = null;
}

async function probe(): Promise<BlobStorageReadiness> {
  const env = readBlobStorageEnv();

  if (env.state === "absent") return { state: "not_configured" };

  if (env.state === "malformed") {
    // The reason names environment variables, so it is logged and not returned.
    logger.warn(
      { event: "blob_storage_misconfigured", reason: env.reason },
      "Object storage env is present but malformed — uploads will be refused",
    );
    return { state: "misconfigured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const { client, config } = getBlobStorageClient();
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }), {
      abortSignal: controller.signal,
    });
    return { state: "ready" };
  } catch (err) {
    logger.error(
      { event: "blob_storage_unreachable", kind: classifyStorageFailure(err).kind, err },
      "Object storage is configured but the bucket could not be reached",
    );
    return { state: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve current storage readiness, memoized for `READINESS_CACHE_MS`.
 *
 * `ready` is only ever returned off the back of a completed HeadBucket call —
 * the presence of configuration is never sufficient.
 */
export async function checkBlobStorageReadiness(
  opts: { force?: boolean } = {},
): Promise<BlobStorageReadiness> {
  const now = Date.now();

  if (!opts.force && cached !== null && now - cached.at < READINESS_CACHE_MS) {
    return cached.value;
  }

  // Collapse concurrent callers onto one round trip.
  if (!opts.force && inFlight !== null) return inFlight;

  const run = probe()
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });

  inFlight = run;
  return run;
}

/**
 * Boot diagnostic. Never fatal: production has run without object storage
 * since launch, so exiting here would take the engine down rather than
 * surface the gap. It logs at the severity the state deserves and returns the
 * verdict so the caller can assert on it.
 */
export async function logBlobStorageReadinessAtStartup(): Promise<BlobStorageReadiness> {
  const readiness = await checkBlobStorageReadiness({ force: true });

  switch (readiness.state) {
    case "ready":
      logger.info(
        { event: "startup_storage_ready" },
        "Object storage reachable — evidence and vendor-assurance uploads are available",
      );
      break;
    case "not_configured":
      logger.warn(
        { event: "startup_storage_not_configured" },
        "Object storage is not configured — evidence and vendor-assurance file uploads will be refused (references still work)",
      );
      break;
    case "misconfigured":
      logger.error(
        { event: "startup_storage_misconfigured" },
        "Object storage configuration is incomplete — file uploads will be refused",
      );
      break;
    case "unreachable":
      logger.error(
        { event: "startup_storage_unreachable" },
        "Object storage is configured but unreachable — file uploads will fail until connectivity is restored",
      );
      break;
  }

  return readiness;
}
