/**
 * corsOrigins — the engine allows the production origins AND the origin of
 * the deployment's own APP_BASE_URL, exactly, with no wildcard. Regression for
 * the staging engine refusing its own staging app (the SSO availability check
 * on the login page failed CORS on every load; WebKit raised it as a page error).
 */
import { describe, expect, it } from "vitest";
import { buildAllowedOrigins, isAllowedOrigin, ownAppOrigin, PRODUCTION_ORIGINS } from "../lib/corsOrigins.js";

describe("ownAppOrigin", () => {
  it("derives the exact https origin, dropping any path or trailing slash", () => {
    expect(ownAppOrigin("https://securelogic-app-staging.onrender.com/")).toBe("https://securelogic-app-staging.onrender.com");
    expect(ownAppOrigin("https://app.securelogicai.com/dashboard")).toBe("https://app.securelogicai.com");
  });
  it("yields nothing for unset, blank, unparseable or non-https values", () => {
    expect(ownAppOrigin(undefined)).toBeNull();
    expect(ownAppOrigin("   ")).toBeNull();
    expect(ownAppOrigin("not a url")).toBeNull();
    expect(ownAppOrigin("http://localhost:3000")).toBeNull();
  });
});

describe("buildAllowedOrigins", () => {
  it("production: APP_BASE_URL is already a production origin — the allowlist is unchanged", () => {
    const allowed = buildAllowedOrigins({ APP_BASE_URL: "https://app.securelogicai.com" });
    expect([...allowed].sort()).toEqual([...PRODUCTION_ORIGINS].sort());
  });
  it("staging: the staging app origin is added — exactly one, no wildcard", () => {
    const allowed = buildAllowedOrigins({ APP_BASE_URL: "https://securelogic-app-staging.onrender.com" });
    expect(allowed.has("https://securelogic-app-staging.onrender.com")).toBe(true);
    expect(allowed.size).toBe(PRODUCTION_ORIGINS.length + 1);
  });
  it("unset APP_BASE_URL: production origins only", () => {
    expect(buildAllowedOrigins({}).size).toBe(PRODUCTION_ORIGINS.length);
  });
});

describe("isAllowedOrigin", () => {
  const allowed = buildAllowedOrigins({ APP_BASE_URL: "https://securelogic-app-staging.onrender.com" });
  it("the deployment's own app origin is allowed outside dev", () => {
    expect(isAllowedOrigin("https://securelogic-app-staging.onrender.com", { allowed, isDev: false })).toBe(true);
  });
  it("production origins stay allowed; anything else is refused, exactly", () => {
    expect(isAllowedOrigin("https://app.securelogicai.com", { allowed, isDev: false })).toBe(true);
    expect(isAllowedOrigin("https://securelogic-app-staging.onrender.com.evil.example", { allowed, isDev: false })).toBe(false);
    expect(isAllowedOrigin("http://securelogic-app-staging.onrender.com", { allowed, isDev: false })).toBe(false);
    expect(isAllowedOrigin("https://evil.example", { allowed, isDev: false })).toBe(false);
  });
  it("no Origin header (same-origin / non-browser) is allowed", () => {
    expect(isAllowedOrigin(undefined, { allowed, isDev: false })).toBe(true);
  });
  it("dev-shaped origins are allowed only in dev", () => {
    expect(isAllowedOrigin("http://localhost:3000", { allowed, isDev: true })).toBe(true);
    expect(isAllowedOrigin("http://localhost:3000", { allowed, isDev: false })).toBe(false);
  });
});
