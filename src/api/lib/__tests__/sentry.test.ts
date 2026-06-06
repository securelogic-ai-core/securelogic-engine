import { describe, it, expect, beforeEach } from "vitest";

import { initSentry, isSentryEnabled, scrubEvent } from "../sentry.js";

describe("sentry init", () => {
  beforeEach(() => {
    // Ensure the no-op path: never init a real client in unit tests.
    delete process.env.SENTRY_DSN_ENGINE;
  });

  it("is a no-op when SENTRY_DSN_ENGINE is unset", () => {
    expect(() => initSentry()).not.toThrow();
    expect(isSentryEnabled()).toBe(false);
  });

  it("is idempotent (a second call does not throw and stays disabled)", () => {
    initSentry();
    expect(() => initSentry()).not.toThrow();
    expect(isSentryEnabled()).toBe(false);
  });

  it("scrubEvent strips request body + sensitive headers and redacts nested secret fields", () => {
    const event = {
      request: {
        data: { password: "hunter2", note: "keep-shape" },
        headers: {
          Authorization: "Bearer abc",
          Cookie: "session=xyz",
          "X-Api-Key": "sk-live-123",
          "User-Agent": "vitest",
        },
        cookies: { session: "xyz" },
      },
      extra: {
        nested: {
          token: "t0ken",
          api_key: "ak-1",
          session_token: "st-1",
          mfaCode: "000000",
          refresh_token: "rt-1",
          safe: "visible",
        },
      },
    };

    const scrubbed = scrubEvent(event as Record<string, unknown>) as typeof event;

    // Request body removed wholesale.
    expect(scrubbed.request.data).toBeUndefined();
    // Parsed cookies removed.
    expect(scrubbed.request.cookies).toBeUndefined();

    // Sensitive headers removed; benign header preserved.
    expect(scrubbed.request.headers.Authorization).toBeUndefined();
    expect(scrubbed.request.headers.Cookie).toBeUndefined();
    expect(scrubbed.request.headers["X-Api-Key"]).toBeUndefined();
    expect(scrubbed.request.headers["User-Agent"]).toBe("vitest");

    // Nested secret-named fields redacted (separator-insensitive); safe field kept.
    expect(scrubbed.extra.nested.token).toBe("[Filtered]");
    expect(scrubbed.extra.nested.api_key).toBe("[Filtered]");
    expect(scrubbed.extra.nested.session_token).toBe("[Filtered]");
    expect(scrubbed.extra.nested.mfaCode).toBe("[Filtered]");
    expect(scrubbed.extra.nested.refresh_token).toBe("[Filtered]");
    expect(scrubbed.extra.nested.safe).toBe("visible");
  });
});
