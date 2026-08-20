/**
 * getOrigin.test.ts — origin resolution behind a proxy and in local dev (#823).
 *
 * The helper existed and was correct for the proxied case, but defaulted the
 * scheme to https when x-forwarded-proto was absent. That is only ever the case
 * when there is NO proxy — local development — where it handed callers an
 * https:// URL for an http:// dev server.
 */
import { describe, it, expect } from "vitest";
import { getOrigin } from "@/lib/getOrigin";

const req = (url: string, headers: Record<string, string>) => new Request(url, { headers });

describe("getOrigin", () => {
  it("prefers the forwarded host over the internal one", () => {
    expect(getOrigin(req("https://localhost:10000/x", {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "securelogic-app-staging.onrender.com",
      host: "localhost:10000",
    }))).toBe("https://securelogic-app-staging.onrender.com");
  });

  it("honours the forwarded protocol", () => {
    expect(getOrigin(req("http://localhost:10000/x", {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "app.example.com",
    }))).toBe("https://app.example.com");
  });

  it("local dev: no proxy headers -> the request's OWN scheme, not https", () => {
    expect(getOrigin(req("http://localhost:3000/x", { host: "localhost:3000" })))
      .toBe("http://localhost:3000");
  });

  it("local dev over https stays https", () => {
    expect(getOrigin(req("https://localhost:3000/x", { host: "localhost:3000" })))
      .toBe("https://localhost:3000");
  });

  it("falls back to the request origin when there is no host header at all", () => {
    expect(getOrigin(new Request("https://fallback.example.com/x"))).toContain("fallback.example.com");
  });
});
