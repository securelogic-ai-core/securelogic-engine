/**
 * engineBaseUrl — the engine base URL is normalized regardless of how it was
 * configured, and a joined URL has exactly one slash at the path boundary.
 *
 * Regression for the staging login page fetching
 * `https://engine//api/sso/check-domain` because NEXT_PUBLIC_ENGINE_URL ended in
 * a slash: Chromium logged a CORS error, WebKit raised a page exception.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ENGINE_DEV_FALLBACK,
  browserEngineBaseUrl,
  engineBaseUrl,
  joinEngineUrl,
  normalizeBaseUrl,
} from "../engineBaseUrl";

const ONE_SLASH_BOUNDARY = /^https:\/\/engine\.example\/api\/sso\/check-domain\?email=a%40b\.c$/;

describe("normalizeBaseUrl", () => {
  it("strips a trailing slash", () => {
    expect(normalizeBaseUrl("https://engine.example/", ENGINE_DEV_FALLBACK)).toBe("https://engine.example");
  });
  it("leaves a base without a trailing slash untouched", () => {
    expect(normalizeBaseUrl("https://engine.example", ENGINE_DEV_FALLBACK)).toBe("https://engine.example");
  });
  it("strips several trailing slashes and surrounding whitespace", () => {
    expect(normalizeBaseUrl("  https://engine.example///  ", ENGINE_DEV_FALLBACK)).toBe("https://engine.example");
  });
  it("keeps a path prefix — only the trailing boundary is normalized", () => {
    expect(normalizeBaseUrl("https://host/engine/", ENGINE_DEV_FALLBACK)).toBe("https://host/engine");
  });
  it("falls back when unset or blank, and normalizes the fallback too", () => {
    expect(normalizeBaseUrl(undefined, ENGINE_DEV_FALLBACK)).toBe("http://localhost:4000");
    expect(normalizeBaseUrl("   ", "http://localhost:4000/")).toBe("http://localhost:4000");
    expect(normalizeBaseUrl("", "")).toBe("");
  });
});

describe("joinEngineUrl — exactly one slash at the path boundary", () => {
  const cases: Array<[string, string]> = [
    ["https://engine.example/", "/api/sso/check-domain?email=a%40b.c"],
    ["https://engine.example", "/api/sso/check-domain?email=a%40b.c"],
    ["https://engine.example///", "///api/sso/check-domain?email=a%40b.c"],
    ["https://engine.example", "api/sso/check-domain?email=a%40b.c"],
  ];
  for (const [base, path] of cases) {
    it(`${JSON.stringify(base)} + ${JSON.stringify(path)}`, () => {
      const url = joinEngineUrl(base, path);
      expect(url).toMatch(ONE_SLASH_BOUNDARY);
      expect(url).not.toContain("//api");
    });
  }
});

describe("environment readers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("ENGINE_API_URL with a trailing slash → normalized server base", () => {
    vi.stubEnv("ENGINE_API_URL", "https://engine.example/");
    expect(engineBaseUrl()).toBe("https://engine.example");
    expect(joinEngineUrl(engineBaseUrl(), "/api/sso/check-domain?email=a%40b.c")).toMatch(ONE_SLASH_BOUNDARY);
  });
  it("ENGINE_API_URL without a trailing slash → the same base", () => {
    vi.stubEnv("ENGINE_API_URL", "https://engine.example");
    expect(engineBaseUrl()).toBe("https://engine.example");
    expect(joinEngineUrl(engineBaseUrl(), "/api/sso/check-domain?email=a%40b.c")).toMatch(ONE_SLASH_BOUNDARY);
  });
  it("NEXT_PUBLIC_ENGINE_URL with and without a trailing slash → the same browser base", () => {
    vi.stubEnv("NEXT_PUBLIC_ENGINE_URL", "https://engine.example/");
    const withSlash = browserEngineBaseUrl();
    vi.stubEnv("NEXT_PUBLIC_ENGINE_URL", "https://engine.example");
    expect(browserEngineBaseUrl()).toBe(withSlash);
    expect(withSlash).toBe("https://engine.example");
  });
  it("unset → the localhost dev fallback, never a production host", () => {
    vi.stubEnv("ENGINE_API_URL", "");
    vi.stubEnv("NEXT_PUBLIC_ENGINE_URL", "");
    expect(engineBaseUrl()).toBe("http://localhost:4000");
    expect(browserEngineBaseUrl()).toBe("http://localhost:4000");
  });
});
