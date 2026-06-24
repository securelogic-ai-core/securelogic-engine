import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// alertPrimitives imports infra/postgres (which throws at import without
// DATABASE_URL). Mock it like the rest of the unit suite (briefEmailSender.test).
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() },
  withTenant: (_orgId: string, fn: () => Promise<unknown>) => fn(),
}));

import {
  getFromAddress,
  getAppBaseUrl,
  htmlEscape,
  getResend,
} from "../lib/alerting/alertPrimitives.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env["NEWSLETTER_FROM_EMAIL"];
  delete process.env["APP_BASE_URL"];
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getFromAddress", () => {
  it("defaults to the noreply sender when NEWSLETTER_FROM_EMAIL is unset", () => {
    expect(getFromAddress()).toBe("SecureLogic AI <noreply@securelogicai.com>");
  });
  it("uses NEWSLETTER_FROM_EMAIL when set (trimmed)", () => {
    process.env["NEWSLETTER_FROM_EMAIL"] = "  Briefs <briefs@securelogicai.com>  ";
    expect(getFromAddress()).toBe("Briefs <briefs@securelogicai.com>");
  });
});

describe("getAppBaseUrl", () => {
  it("defaults to the app origin when APP_BASE_URL is unset", () => {
    expect(getAppBaseUrl()).toBe("https://app.securelogicai.com");
  });
  it("uses APP_BASE_URL and strips a trailing slash", () => {
    process.env["APP_BASE_URL"] = "https://staging.example.com/";
    expect(getAppBaseUrl()).toBe("https://staging.example.com");
  });
});

describe("htmlEscape", () => {
  it("escapes &, <, >, and \"", () => {
    expect(htmlEscape(`<a href="x">Tom & "Jerry"</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; &quot;Jerry&quot;&lt;/a&gt;"
    );
  });
});

describe("getResend", () => {
  it("throws (not at import, at call time) when RESEND_API_KEY is unset", () => {
    delete process.env["RESEND_API_KEY"];
    expect(() => getResend()).toThrow(/RESEND_API_KEY is not configured/);
  });
});
