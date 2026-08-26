/**
 * blobStorageReadiness.test.ts — SL-EVID-1.
 *
 * Two things are under test, and they are the whole point of the package:
 *
 *   1. `classifyStorageFailure` — an object-storage fault must be classified as
 *      a STORAGE fault. It must never be allowed to masquerade as a content
 *      fault, because `pdf_unparseable` tells a customer "your document is
 *      broken" when the truth is "our bucket isn't wired up".
 *
 *   2. `checkBlobStorageReadiness` — readiness must NOT be inferred from the
 *      presence of environment variables. Five correctly-shaped R2 vars
 *      pointing at a bucket that cannot be reached is exactly the failure this
 *      package exists to surface, so the probe issues a real HeadBucket call
 *      and reports `unreachable` when it fails.
 *
 * The SDK is mocked at the @aws-sdk boundary (same shape as blobStorage.test.ts).
 * Every case re-imports through `vi.resetModules()` because both the S3 client
 * and the readiness result are memoized at module scope.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendSpy = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  class PutObjectCommand {
    input: unknown;
    constructor(input: unknown) { this.input = input; }
  }
  class GetObjectCommand {
    input: unknown;
    constructor(input: unknown) { this.input = input; }
  }
  class DeleteObjectCommand {
    input: unknown;
    constructor(input: unknown) { this.input = input; }
  }
  class HeadBucketCommand {
    input: unknown;
    constructor(input: unknown) { this.input = input; }
  }
  class S3Client {
    send = sendSpy;
    constructor(_input: unknown) { /* no-op */ }
  }
  return { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: vi.fn() }));

vi.mock("../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

const VALID_R2_ENV = {
  R2_ACCOUNT_ID: "acct-1234567890",
  R2_ACCESS_KEY_ID: "AKIAEXAMPLE12345",
  R2_SECRET_ACCESS_KEY: "0123456789abcdef0123456789abcdef",
  R2_BUCKET: "securelogic-evidence",
  R2_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
} as const;

/** Fresh module graph + a clean env, so memoized client/readiness never leak between cases. */
async function loadReadiness(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const k of Object.keys(VALID_R2_ENV)) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  return import("../lib/blobStorageReadiness.js");
}

beforeEach(() => {
  sendSpy.mockReset();
});

describe("classifyStorageFailure — a storage fault is never a content fault", () => {
  it("classifies 'not configured' as an operator-actionable storage_unavailable (503)", async () => {
    const { classifyStorageFailure } = await loadReadiness();
    const { BlobStorageNotConfiguredError } = await import("../lib/blobStorageConfig.js");

    const verdict = classifyStorageFailure(new BlobStorageNotConfiguredError());

    expect(verdict.kind).toBe("not_configured");
    expect(verdict.documentErrorCode).toBe("storage_unavailable");
    expect(verdict.httpStatus).toBe(503);
    expect(verdict.apiError).toBe("storage_unavailable");
  });

  it("classifies malformed config as storage_unavailable, not as a parse problem", async () => {
    const { classifyStorageFailure } = await loadReadiness();
    const { BlobStorageMalformedConfigError } = await import("../lib/blobStorageConfig.js");

    const verdict = classifyStorageFailure(
      new BlobStorageMalformedConfigError("R2_ENDPOINT must be an https URL"),
    );

    expect(verdict.kind).toBe("not_configured");
    expect(verdict.documentErrorCode).toBe("storage_unavailable");
    expect(verdict.httpStatus).toBe(503);
  });

  it.each([
    ["AccessDenied"],
    ["InvalidAccessKeyId"],
    ["SignatureDoesNotMatch"],
    ["NoSuchBucket"],
    ["TimeoutError"],
  ])("classifies the S3 fault %s as an unreachable-storage fault (500)", async (name) => {
    const { classifyStorageFailure } = await loadReadiness();
    const err = Object.assign(new Error("boom"), { name });

    const verdict = classifyStorageFailure(err);

    expect(verdict.kind).toBe("unreachable");
    expect(verdict.documentErrorCode).toBe("storage_error");
    expect(verdict.httpStatus).toBe(500);
    expect(verdict.apiError).toBe("blob_put_failed");
  });

  it.each([["ENOTFOUND"], ["ECONNREFUSED"], ["ETIMEDOUT"], ["EAI_AGAIN"]])(
    "classifies the network fault %s as unreachable storage",
    async (code) => {
      const { classifyStorageFailure } = await loadReadiness();
      const err = Object.assign(new Error("network"), { code });

      expect(classifyStorageFailure(err).kind).toBe("unreachable");
      expect(classifyStorageFailure(err).documentErrorCode).toBe("storage_error");
    },
  );

  it("still records an UNRECOGNISED storage-layer error as storage_error — never pdf_unparseable", async () => {
    const { classifyStorageFailure } = await loadReadiness();

    const verdict = classifyStorageFailure(new Error("something nobody predicted"));

    expect(verdict.kind).toBe("unknown");
    // The whole regression: an unknown fault thrown out of the storage layer is
    // still a storage fault. It must not be attributed to the customer's file.
    expect(verdict.documentErrorCode).toBe("storage_error");
    expect(verdict.documentErrorCode).not.toBe("pdf_unparseable");
    expect(verdict.httpStatus).toBe(500);
  });

  it("never leaks the underlying infrastructure message in the classification", async () => {
    const { classifyStorageFailure } = await loadReadiness();
    const { BlobStorageNotConfiguredError } = await import("../lib/blobStorageConfig.js");

    const verdict = classifyStorageFailure(new BlobStorageNotConfiguredError());

    expect(JSON.stringify(verdict)).not.toMatch(/R2_/);
    expect(JSON.stringify(verdict)).not.toMatch(/env var/i);
  });
});

describe("checkBlobStorageReadiness — configured is not the same as reachable", () => {
  it("reports not_configured when no R2 env is present, without touching the network", async () => {
    const { checkBlobStorageReadiness } = await loadReadiness({});

    await expect(checkBlobStorageReadiness()).resolves.toEqual({ state: "not_configured" });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("reports misconfigured on partial env, without touching the network", async () => {
    const { checkBlobStorageReadiness } = await loadReadiness({
      R2_BUCKET: VALID_R2_ENV.R2_BUCKET,
      R2_ENDPOINT: VALID_R2_ENV.R2_ENDPOINT,
    });

    await expect(checkBlobStorageReadiness()).resolves.toEqual({ state: "misconfigured" });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("reports ready ONLY after a real HeadBucket round trip succeeds", async () => {
    sendSpy.mockResolvedValueOnce({});
    const { checkBlobStorageReadiness } = await loadReadiness({ ...VALID_R2_ENV });

    await expect(checkBlobStorageReadiness()).resolves.toEqual({ state: "ready" });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const command = sendSpy.mock.calls[0]?.[0] as { input?: { Bucket?: string } };
    expect(command?.input?.Bucket).toBe(VALID_R2_ENV.R2_BUCKET);
  });

  it("reports unreachable when the env is perfectly shaped but the bucket cannot be reached", async () => {
    // THE case this package exists for: presence-only checks would call this healthy.
    sendSpy.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "AccessDenied" }));
    const { checkBlobStorageReadiness } = await loadReadiness({ ...VALID_R2_ENV });

    await expect(checkBlobStorageReadiness()).resolves.toEqual({ state: "unreachable" });
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("memoizes the probe so an unauthenticated /health cannot be used to hammer R2", async () => {
    sendSpy.mockResolvedValue({});
    const { checkBlobStorageReadiness } = await loadReadiness({ ...VALID_R2_ENV });

    await checkBlobStorageReadiness();
    await checkBlobStorageReadiness();
    await checkBlobStorageReadiness();

    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("re-probes when the caller explicitly forces a refresh", async () => {
    sendSpy.mockResolvedValue({});
    const { checkBlobStorageReadiness } = await loadReadiness({ ...VALID_R2_ENV });

    await checkBlobStorageReadiness();
    await checkBlobStorageReadiness({ force: true });

    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  it("never returns config detail that could be read off an unauthenticated endpoint", async () => {
    sendSpy.mockRejectedValueOnce(Object.assign(new Error("x"), { name: "NoSuchBucket" }));
    const { checkBlobStorageReadiness } = await loadReadiness({ ...VALID_R2_ENV });

    const readiness = await checkBlobStorageReadiness();

    expect(Object.keys(readiness)).toEqual(["state"]);
    expect(JSON.stringify(readiness)).not.toContain(VALID_R2_ENV.R2_BUCKET);
    expect(JSON.stringify(readiness)).not.toContain(VALID_R2_ENV.R2_ENDPOINT);
  });
});
