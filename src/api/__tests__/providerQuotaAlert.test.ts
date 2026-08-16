/**
 * providerQuotaAlert.test.ts — classifier + once-per-process dedupe.
 *
 * Mirrors the alerting.test.ts / authAnomaly.test.ts patterns: mock
 * sendSecurityAlert via vi.mock to assert it's invoked (or not) with
 * the right payload shape, without exercising the real webhook fetch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendSecurityAlertSpy } = vi.hoisted(() => ({
  sendSecurityAlertSpy: vi.fn()
}));

vi.mock("../infra/alerting.js", () => ({ sendSecurityAlert: sendSecurityAlertSpy }));

import {
  instrumentAnthropicClient,
  isProviderQuotaError,
  maybeAlertProviderQuotaError,
  resetProviderQuotaAlertStateForTest
} from "../infra/providerQuotaAlert.js";

beforeEach(() => {
  sendSecurityAlertSpy.mockReset();
  sendSecurityAlertSpy.mockResolvedValue(undefined);
  resetProviderQuotaAlertStateForTest();
});

// ---------------------------------------------------------------------------
// Classifier: shape-by-shape coverage
// ---------------------------------------------------------------------------

describe("isProviderQuotaError", () => {
  it("classifies Anthropic RateLimitError as anthropic/rate_limit", () => {
    class RateLimitError extends Error {}
    const err = new RateLimitError("Rate limit exceeded");
    Object.defineProperty(err, "status", { value: 429 });

    expect(isProviderQuotaError(err)).toEqual({
      provider: "anthropic",
      kind: "rate_limit"
    });
  });

  it("classifies Anthropic BadRequestError with credit-balance message as anthropic/credit_balance", () => {
    class BadRequestError extends Error {}
    const err = new BadRequestError(
      "Your credit balance is too low to access the Anthropic API."
    );
    Object.defineProperty(err, "status", { value: 400 });

    expect(isProviderQuotaError(err)).toEqual({
      provider: "anthropic",
      kind: "credit_balance"
    });
  });

  it("classifies OpenAI insufficient_quota (top-level code) as openai/insufficient_quota", () => {
    const err = Object.assign(new Error("You exceeded your current quota"), {
      status: 429,
      code: "insufficient_quota"
    });

    expect(isProviderQuotaError(err)).toEqual({
      provider: "openai",
      kind: "insufficient_quota"
    });
  });

  it("classifies OpenAI insufficient_quota (nested error.code) as openai/insufficient_quota", () => {
    const err = Object.assign(new Error("You exceeded your current quota"), {
      status: 429,
      error: { code: "insufficient_quota", type: "insufficient_quota" }
    });

    expect(isProviderQuotaError(err)).toEqual({
      provider: "openai",
      kind: "insufficient_quota"
    });
  });

  it("returns null for unrelated errors (random 500, generic Error)", () => {
    expect(isProviderQuotaError(new Error("kaboom"))).toBeNull();

    class APIError extends Error {}
    const e500 = new APIError("Internal Server Error");
    Object.defineProperty(e500, "status", { value: 500 });
    expect(isProviderQuotaError(e500)).toBeNull();

    expect(isProviderQuotaError(null)).toBeNull();
    expect(isProviderQuotaError(undefined)).toBeNull();
    expect(isProviderQuotaError("not an error")).toBeNull();
  });

  it("returns null for a BadRequestError with no credit-balance language (e.g. malformed request)", () => {
    class BadRequestError extends Error {}
    const err = new BadRequestError("messages.0.content is required");
    Object.defineProperty(err, "status", { value: 400 });

    expect(isProviderQuotaError(err)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// maybeAlertProviderQuotaError: dedupe + non-quota no-op
// ---------------------------------------------------------------------------

describe("maybeAlertProviderQuotaError", () => {
  it("fires sendSecurityAlert with provider_quota_exhausted on the first quota error", async () => {
    class RateLimitError extends Error {}
    const err = new RateLimitError("rate limit");

    await maybeAlertProviderQuotaError(err);

    expect(sendSecurityAlertSpy).toHaveBeenCalledTimes(1);
    expect(sendSecurityAlertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "provider_quota_exhausted",
        summary: expect.stringContaining("anthropic"),
        detail: expect.objectContaining({
          provider: "anthropic",
          kind: "rate_limit"
        })
      })
    );
  });

  it("dedupes — second quota error in the same process does NOT fire a second alert", async () => {
    class RateLimitError extends Error {}
    class BadRequestError extends Error {}

    await maybeAlertProviderQuotaError(new RateLimitError("first"));

    const second = new BadRequestError("Your credit balance is too low");
    await maybeAlertProviderQuotaError(second);

    expect(sendSecurityAlertSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire on a non-quota error", async () => {
    await maybeAlertProviderQuotaError(new Error("unrelated"));
    await maybeAlertProviderQuotaError({ status: 500, message: "kaboom" });
    await maybeAlertProviderQuotaError(null);

    expect(sendSecurityAlertSpy).not.toHaveBeenCalled();
  });

  it("swallows a webhook send failure rather than masking the caller's error", async () => {
    sendSecurityAlertSpy.mockRejectedValueOnce(new Error("webhook down"));
    class RateLimitError extends Error {}

    await expect(
      maybeAlertProviderQuotaError(new RateLimitError("rate limit"))
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Client instrumentation: the wrap must be INVISIBLE to the SDK
// ---------------------------------------------------------------------------
//
// The original wrapper was `async (...args) => { try { return await original() } ... }`.
// That is correct-looking and was shipped untested, but it silently replaced the
// SDK's APIPromise with a plain Promise. `messages.stream()` calls
// `.withResponse()` on whatever `create()` returns, so every streaming Ask turn
// died with "messages.create(...).withResponse is not a function" — and because
// the plain Promise was then never consumed, the underlying provider error
// became an unhandledRejection, which the server turns into drain-and-exit.

describe("instrumentAnthropicClient", () => {
  /** Stand-in for the SDK's APIPromise: a Promise carrying extra methods. */
  function apiPromise<T>(value: Promise<T>) {
    return Object.assign(value, {
      withResponse: () => value.then((data) => ({ data, response: { status: 200 } })),
    });
  }

  it("preserves non-Promise methods on the returned object (APIPromise shape)", async () => {
    const client = {
      messages: {
        create: (..._args: any[]) => apiPromise(Promise.resolve({ content: [] })),
      },
    };

    instrumentAnthropicClient(client as any);
    const returned = client.messages.create({});

    expect(typeof (returned as any).withResponse).toBe("function");
    await expect((returned as any).withResponse()).resolves.toMatchObject({
      response: { status: 200 },
    });
  });

  it("still surfaces the original error to the caller unchanged", async () => {
    const boom = new Error("provider exploded");
    const client = {
      messages: { create: (..._args: any[]) => apiPromise(Promise.reject(boom)) },
    };

    instrumentAnthropicClient(client as any);

    await expect(client.messages.create({})).rejects.toBe(boom);
  });

  it("alerts on a quota error seen through the wrap", async () => {
    class RateLimitError extends Error {}
    const err = new RateLimitError("Rate limit exceeded");
    Object.defineProperty(err, "status", { value: 429 });

    const client = {
      messages: { create: (..._args: any[]) => apiPromise(Promise.reject(err)) },
    };
    instrumentAnthropicClient(client as any);

    await expect(client.messages.create({})).rejects.toBe(err);
    // The alert subscriber runs independently of the caller's rejection.
    await new Promise((r) => setImmediate(r));

    expect(sendSecurityAlertSpy).toHaveBeenCalledTimes(1);
  });

  it("does not produce an unhandled rejection when the caller ignores the result", async () => {
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => seen.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      const client = {
        messages: {
          create: (..._args: any[]) =>
            apiPromise(Promise.reject(new Error("ignored by caller"))),
        },
      };
      instrumentAnthropicClient(client as any);

      // Caller drops the promise on the floor, exactly as the SDK did when
      // `.withResponse()` threw before the value was ever awaited.
      const dropped = client.messages.create({});
      dropped.catch(() => {});

      await new Promise((r) => setTimeout(r, 20));
      expect(seen).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
