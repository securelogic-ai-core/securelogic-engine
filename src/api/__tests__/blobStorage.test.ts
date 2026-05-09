/**
 * blobStorage.test.ts — Phase 0 prefix-guard, TTL clamp, key-shape tests.
 *
 * The R2 SDK is mocked at the @aws-sdk boundary. The single most important
 * assertion in this file: prefix and argument validation MUST happen BEFORE
 * any SDK call. Tests verify that by spying on the mocked S3Client and
 * asserting send() was never invoked when validation should have rejected.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const sendSpy = vi.fn();
const getSignedUrlSpy = vi.fn();
const s3ClientCtorArgs: Array<unknown> = [];

vi.mock("@aws-sdk/client-s3", async () => {
  // PutObjectCommand / GetObjectCommand / DeleteObjectCommand only need to be
  // identifiable constructors so callers can pass instances to send().
  class PutObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class GetObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class DeleteObjectCommand {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  }
  class S3Client {
    send = sendSpy;
    constructor(input: unknown) {
      s3ClientCtorArgs.push(input);
    }
  }
  return { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: (...args: unknown[]) => getSignedUrlSpy(...args)
}));

// Imports must follow the vi.mock declarations.
import {
  putObject,
  getObjectStream,
  getSignedReadUrl,
  deleteObject,
  buildObjectKey,
  BlobStorageKeyPrefixError,
  BlobStorageInvalidArgumentError,
  MAX_SIGNED_URL_TTL_SECONDS
} from "../lib/blobStorage.js";
import {
  readBlobStorageEnv,
  getBlobStorageClient,
  _resetBlobStorageClientForTests,
  BlobStorageNotConfiguredError,
  BlobStorageMalformedConfigError
} from "../lib/blobStorageConfig.js";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

function setR2Env(): void {
  process.env["R2_ACCOUNT_ID"] = "test-account-id";
  process.env["R2_ACCESS_KEY_ID"] = "AKIA-test-access-key";
  process.env["R2_SECRET_ACCESS_KEY"] = "test-secret-access-key-1234567890";
  process.env["R2_BUCKET"] = "test-bucket";
  process.env["R2_ENDPOINT"] = "https://example.r2.cloudflarestorage.com";
}

function clearR2Env(): void {
  delete process.env["R2_ACCOUNT_ID"];
  delete process.env["R2_ACCESS_KEY_ID"];
  delete process.env["R2_SECRET_ACCESS_KEY"];
  delete process.env["R2_BUCKET"];
  delete process.env["R2_ENDPOINT"];
}

beforeEach(() => {
  sendSpy.mockReset();
  sendSpy.mockResolvedValue({});
  getSignedUrlSpy.mockReset();
  getSignedUrlSpy.mockResolvedValue("https://signed.example/url");
  s3ClientCtorArgs.length = 0;
  _resetBlobStorageClientForTests();
  setR2Env();
});

// ---------------------------------------------------------------------------
// Prefix guard runs BEFORE any SDK call (the load-bearing test in this file).
// ---------------------------------------------------------------------------

describe("prefix guard runs before SDK calls", () => {
  it("putObject rejects relativeKey beginning with 'org/' before any send()", async () => {
    await expect(
      putObject({
        organizationId: ORG_A,
        relativeKey: `org/${ORG_A}/whatever.bin`,
        bytes: Buffer.from("x"),
        contentType: "application/octet-stream"
      })
    ).rejects.toBeInstanceOf(BlobStorageInvalidArgumentError);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("getObjectStream rejects key not prefixed with org/{orgId}/ before any send()", async () => {
    await expect(
      getObjectStream({ organizationId: ORG_A, key: `org/${ORG_B}/foo.bin` })
    ).rejects.toBeInstanceOf(BlobStorageKeyPrefixError);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("getSignedReadUrl rejects mismatched-org key before any signing call", async () => {
    await expect(
      getSignedReadUrl({
        organizationId: ORG_A,
        key: `org/${ORG_B}/foo.bin`,
        ttlSeconds: 60
      })
    ).rejects.toBeInstanceOf(BlobStorageKeyPrefixError);
    expect(getSignedUrlSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("deleteObject rejects mismatched-org key before any send()", async () => {
    await expect(
      deleteObject({ organizationId: ORG_A, key: `org/${ORG_B}/foo.bin` })
    ).rejects.toBeInstanceOf(BlobStorageKeyPrefixError);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("getObjectStream rejects bare key with no org/ prefix at all", async () => {
    await expect(
      getObjectStream({ organizationId: ORG_A, key: "loose-key.bin" })
    ).rejects.toBeInstanceOf(BlobStorageKeyPrefixError);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TTL clamp + TTL ≤ 0 rejection.
// ---------------------------------------------------------------------------

describe("getSignedReadUrl TTL handling", () => {
  it("clamps TTL > MAX to MAX (120)", async () => {
    const result = await getSignedReadUrl({
      organizationId: ORG_A,
      key: `org/${ORG_A}/file.bin`,
      ttlSeconds: 99999
    });
    expect(result.ttlSeconds).toBe(MAX_SIGNED_URL_TTL_SECONDS);
    expect(getSignedUrlSpy).toHaveBeenCalledTimes(1);
    const call = getSignedUrlSpy.mock.calls[0];
    expect(call?.[2]).toEqual({ expiresIn: MAX_SIGNED_URL_TTL_SECONDS });
  });

  it("does not clamp TTL within range", async () => {
    const result = await getSignedReadUrl({
      organizationId: ORG_A,
      key: `org/${ORG_A}/file.bin`,
      ttlSeconds: 30
    });
    expect(result.ttlSeconds).toBe(30);
  });

  it("rejects ttlSeconds = 0 before any signing call", async () => {
    await expect(
      getSignedReadUrl({
        organizationId: ORG_A,
        key: `org/${ORG_A}/file.bin`,
        ttlSeconds: 0
      })
    ).rejects.toBeInstanceOf(BlobStorageInvalidArgumentError);
    expect(getSignedUrlSpy).not.toHaveBeenCalled();
  });

  it("rejects ttlSeconds < 0 before any signing call", async () => {
    await expect(
      getSignedReadUrl({
        organizationId: ORG_A,
        key: `org/${ORG_A}/file.bin`,
        ttlSeconds: -1
      })
    ).rejects.toBeInstanceOf(BlobStorageInvalidArgumentError);
    expect(getSignedUrlSpy).not.toHaveBeenCalled();
  });

  it("rejects non-finite ttlSeconds", async () => {
    await expect(
      getSignedReadUrl({
        organizationId: ORG_A,
        key: `org/${ORG_A}/file.bin`,
        ttlSeconds: Number.NaN
      })
    ).rejects.toBeInstanceOf(BlobStorageInvalidArgumentError);
    expect(getSignedUrlSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// organizationId validation.
// ---------------------------------------------------------------------------

describe("organizationId validation", () => {
  it("rejects empty organizationId", async () => {
    await expect(
      putObject({
        organizationId: "",
        relativeKey: "x.bin",
        bytes: Buffer.from("x"),
        contentType: "application/octet-stream"
      })
    ).rejects.toBeInstanceOf(BlobStorageInvalidArgumentError);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only organizationId", async () => {
    await expect(
      getObjectStream({ organizationId: "   ", key: `org/${ORG_A}/x.bin` })
    ).rejects.toBeInstanceOf(BlobStorageInvalidArgumentError);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("rejects organizationId with leading whitespace", async () => {
    await expect(
      getObjectStream({ organizationId: ` ${ORG_A}`, key: `org/${ORG_A}/x.bin` })
    ).rejects.toBeInstanceOf(BlobStorageInvalidArgumentError);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("rejects non-UUID organizationId", async () => {
    await expect(
      getObjectStream({ organizationId: "not-a-uuid", key: `org/${ORG_A}/x.bin` })
    ).rejects.toBeInstanceOf(BlobStorageInvalidArgumentError);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Happy paths confirm the wrapper does call through after validation.
// ---------------------------------------------------------------------------

describe("happy paths reach the SDK", () => {
  it("putObject builds the correct absolute key and invokes send()", async () => {
    const result = await putObject({
      organizationId: ORG_A,
      relativeKey: "vendor-assurance/abc/original.pdf",
      bytes: Buffer.from("hello"),
      contentType: "application/pdf"
    });
    expect(result.key).toBe(`org/${ORG_A}/vendor-assurance/abc/original.pdf`);
    expect(result.byteSize).toBe(5);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const cmd = sendSpy.mock.calls[0]?.[0] as { input: { Bucket: string; Key: string } };
    expect(cmd.input.Bucket).toBe("test-bucket");
    expect(cmd.input.Key).toBe(`org/${ORG_A}/vendor-assurance/abc/original.pdf`);
  });

  it("deleteObject sends after validation", async () => {
    await deleteObject({
      organizationId: ORG_A,
      key: `org/${ORG_A}/file.bin`
    });
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// buildObjectKey shape rules.
// ---------------------------------------------------------------------------

describe("buildObjectKey", () => {
  it("attaches the org prefix to a relative key", () => {
    expect(buildObjectKey(ORG_A, "foo/bar.bin")).toBe(`org/${ORG_A}/foo/bar.bin`);
  });

  it("rejects empty relativeKey", () => {
    expect(() => buildObjectKey(ORG_A, "")).toThrow(BlobStorageInvalidArgumentError);
  });

  it("rejects relativeKey starting with '/'", () => {
    expect(() => buildObjectKey(ORG_A, "/foo.bin")).toThrow(BlobStorageInvalidArgumentError);
  });

  it("rejects relativeKey containing '..'", () => {
    expect(() => buildObjectKey(ORG_A, "foo/../bar.bin")).toThrow(BlobStorageInvalidArgumentError);
  });

  it("rejects relativeKey already prefixed with 'org/'", () => {
    expect(() => buildObjectKey(ORG_A, `org/${ORG_A}/foo.bin`)).toThrow(
      BlobStorageInvalidArgumentError
    );
  });
});

// ---------------------------------------------------------------------------
// Config loader: discriminated state.
// ---------------------------------------------------------------------------

describe("readBlobStorageEnv", () => {
  it("returns 'absent' when no R2 vars are set", () => {
    clearR2Env();
    expect(readBlobStorageEnv().state).toBe("absent");
  });

  it("returns 'configured' when all vars are set and well-formed", () => {
    setR2Env();
    const state = readBlobStorageEnv();
    expect(state.state).toBe("configured");
    if (state.state === "configured") {
      expect(state.config.bucket).toBe("test-bucket");
      expect(state.config.endpoint).toMatch(/^https:\/\//);
    }
  });

  it("returns 'malformed' on partial config", () => {
    setR2Env();
    delete process.env["R2_BUCKET"];
    const state = readBlobStorageEnv();
    expect(state.state).toBe("malformed");
    if (state.state === "malformed") {
      expect(state.reason).toMatch(/R2_BUCKET/);
    }
  });

  it("returns 'malformed' on non-https endpoint", () => {
    setR2Env();
    process.env["R2_ENDPOINT"] = "http://insecure.example/";
    const state = readBlobStorageEnv();
    expect(state.state).toBe("malformed");
  });

  it("returns 'malformed' on suspicious-short secret", () => {
    setR2Env();
    process.env["R2_SECRET_ACCESS_KEY"] = "short";
    const state = readBlobStorageEnv();
    expect(state.state).toBe("malformed");
  });
});

describe("getBlobStorageClient", () => {
  it("throws BlobStorageNotConfiguredError when env is absent", () => {
    clearR2Env();
    _resetBlobStorageClientForTests();
    expect(() => getBlobStorageClient()).toThrow(BlobStorageNotConfiguredError);
  });

  it("throws BlobStorageMalformedConfigError when env is partial", () => {
    setR2Env();
    delete process.env["R2_BUCKET"];
    _resetBlobStorageClientForTests();
    expect(() => getBlobStorageClient()).toThrow(BlobStorageMalformedConfigError);
  });

  it("returns a client when env is configured", () => {
    setR2Env();
    _resetBlobStorageClientForTests();
    const { client, config } = getBlobStorageClient();
    expect(client).toBeDefined();
    expect(config.bucket).toBe("test-bucket");
  });

  it("constructs the S3Client with R2-compatible checksum options", () => {
    // Pins the SDK >=3.730 checksum-default override that keeps R2 from
    // returning bare 401 Unauthorized on PUT. See blobStorageConfig.ts comment.
    setR2Env();
    _resetBlobStorageClientForTests();
    s3ClientCtorArgs.length = 0;
    getBlobStorageClient();
    expect(s3ClientCtorArgs).toHaveLength(1);
    const ctorInput = s3ClientCtorArgs[0] as Record<string, unknown>;
    expect(ctorInput.requestChecksumCalculation).toBe("WHEN_REQUIRED");
    expect(ctorInput.responseChecksumValidation).toBe("WHEN_REQUIRED");
    expect(ctorInput.forcePathStyle).toBe(true);
  });
});
