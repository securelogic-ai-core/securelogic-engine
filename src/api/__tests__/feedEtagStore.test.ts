/**
 * feedEtagStore.test.ts — Redis-backed ETag persistence.
 *
 * Covers the contract the MITRE adapters depend on:
 *   - getEtag returns null when REDIS_URL is unset.
 *   - getEtag returns null when Redis is configured but throws.
 *   - getEtag returns the stored value on success.
 *   - setEtag silently no-ops when REDIS_URL is unset.
 *   - setEtag silently no-ops when Redis is configured but throws.
 *   - setEtag silently no-ops on empty input.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../infra/redis.js", () => ({
  redisReady: true,
  ensureRedisConnected: vi.fn()
}));

import { getEtag, setEtag } from "../lib/feedEtagStore.js";
import * as redisModule from "../infra/redis.js";

const mockedEnsure = vi.mocked(redisModule.ensureRedisConnected);

beforeEach(() => {
  mockedEnsure.mockReset();
  // Default: redisReady true. Individual tests flip this when relevant.
  Object.defineProperty(redisModule, "redisReady", {
    configurable: true,
    get: () => true
  });
});

describe("getEtag", () => {
  it("returns null when redisReady is false (no REDIS_URL)", async () => {
    Object.defineProperty(redisModule, "redisReady", {
      configurable: true,
      get: () => false
    });

    const result = await getEtag("any-key");

    expect(result).toBeNull();
    expect(mockedEnsure).not.toHaveBeenCalled();
  });

  it("returns the stored value on a successful read", async () => {
    mockedEnsure.mockResolvedValueOnce({
      get: vi.fn(async () => 'W/"abc"')
    } as never);

    const result = await getEtag("mitre:attack:etag");

    expect(result).toBe('W/"abc"');
  });

  it("returns null when Redis returns no value for the key", async () => {
    mockedEnsure.mockResolvedValueOnce({
      get: vi.fn(async () => null)
    } as never);

    const result = await getEtag("never-set");

    expect(result).toBeNull();
  });

  it("returns null and does not throw when ensureRedisConnected throws", async () => {
    mockedEnsure.mockRejectedValueOnce(new Error("Redis connect timeout"));

    const result = await getEtag("any");

    expect(result).toBeNull();
  });

  it("returns null and does not throw when client.get throws", async () => {
    mockedEnsure.mockResolvedValueOnce({
      get: vi.fn(async () => {
        throw new Error("network blip");
      })
    } as never);

    const result = await getEtag("any");

    expect(result).toBeNull();
  });
});

describe("setEtag", () => {
  it("no-ops when redisReady is false (no REDIS_URL)", async () => {
    Object.defineProperty(redisModule, "redisReady", {
      configurable: true,
      get: () => false
    });

    await setEtag("key", '"etag"');

    expect(mockedEnsure).not.toHaveBeenCalled();
  });

  it("no-ops when the etag value is empty", async () => {
    await setEtag("key", "");

    // Defensive against upstream omitting an ETag header — adapter passes ""
    // through and we should not waste a round-trip storing it.
    expect(mockedEnsure).not.toHaveBeenCalled();
  });

  it("calls client.set on a normal write", async () => {
    const setFn = vi.fn(async () => "OK");
    mockedEnsure.mockResolvedValueOnce({ set: setFn } as never);

    await setEtag("mitre:attack:etag", 'W/"new"');

    expect(setFn).toHaveBeenCalledWith("mitre:attack:etag", 'W/"new"');
  });

  it("does not throw when ensureRedisConnected fails", async () => {
    mockedEnsure.mockRejectedValueOnce(new Error("connect failed"));

    await expect(setEtag("k", "v")).resolves.toBeUndefined();
  });

  it("does not throw when client.set fails", async () => {
    mockedEnsure.mockResolvedValueOnce({
      set: vi.fn(async () => {
        throw new Error("write failed");
      })
    } as never);

    await expect(setEtag("k", "v")).resolves.toBeUndefined();
  });
});
