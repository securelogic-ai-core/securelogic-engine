import { describe, it, expect, vi } from "vitest";
import {
  isContentTypeEnforcementExempt,
  enforceJsonContentType,
} from "../lib/contentTypeAllowlist.js";

// Every route that sends a non-JSON body (raw webhooks, multipart uploads, SAML
// form posts). A missing entry here 415s the route at the gate — which is the
// bug this list now guards against. Keep in sync with the predicate.
const NON_JSON_ENDPOINTS = [
  "/webhooks/lemon",
  "/webhooks/email/resend",
  "/api/vendor-assessments/analyze-document",
  "/api/vendor-assurance/documents",
  "/api/sso/acme/acs",
  "/api/ask/transcribe", // ← voice audio upload (the regression)
];

describe("isContentTypeEnforcementExempt", () => {
  it("exempts every multipart / non-JSON upload endpoint", () => {
    for (const url of NON_JSON_ENDPOINTS) {
      expect(isContentTypeEnforcementExempt(url), url).toBe(true);
    }
  });

  it("exempts the Ask voice transcription upload (regression: this was the 415 bug)", () => {
    expect(isContentTypeEnforcementExempt("/api/ask/transcribe")).toBe(true);
    expect(isContentTypeEnforcementExempt("/api/ask/transcribe?x=1")).toBe(true);
  });

  it("does NOT exempt the JSON Ask query endpoint (still must send application/json)", () => {
    expect(isContentTypeEnforcementExempt("/api/ask")).toBe(false);
  });

  it("does NOT exempt unrelated JSON routes", () => {
    expect(isContentTypeEnforcementExempt("/api/vendors")).toBe(false);
    expect(isContentTypeEnforcementExempt("/api/risks")).toBe(false);
    expect(isContentTypeEnforcementExempt("/api/transcribe")).toBe(false); // app-proxy path, not the engine route
  });

  it("is not fooled by the transcribe substring appearing elsewhere", () => {
    expect(isContentTypeEnforcementExempt("/api/evil/api/ask/transcribe")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// enforceJsonContentType middleware — drives the real guard with fake req/res.
// ---------------------------------------------------------------------------

function run(req: { method: string; originalUrl: string; headers?: Record<string, string> }) {
  const next = vi.fn();
  const res = {
    statusCode: 0 as number,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  enforceJsonContentType(
    { headers: {}, ...req } as never,
    res as never,
    next as never
  );
  return { next, res };
}

describe("enforceJsonContentType", () => {
  it("415s a non-JSON body on a NON-exempt route", () => {
    const { next, res } = run({
      method: "POST",
      originalUrl: "/api/vendors",
      headers: { "content-type": "multipart/form-data; boundary=x" },
    });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(415);
    expect(res.body).toEqual({ error: "unsupported_media_type" });
  });

  it("REGRESSION: lets multipart audio through to /api/ask/transcribe (never 415)", () => {
    const { next, res } = run({
      method: "POST",
      originalUrl: "/api/ask/transcribe",
      headers: { "content-type": "multipart/form-data; boundary=abc" },
    });
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).not.toBe(415);
  });

  it("lets multipart through every exempt upload endpoint", () => {
    for (const url of NON_JSON_ENDPOINTS) {
      const { next, res } = run({
        method: "POST",
        originalUrl: url,
        headers: { "content-type": "multipart/form-data; boundary=x" },
      });
      expect(next, url).toHaveBeenCalledOnce();
      expect(res.statusCode, url).not.toBe(415);
    }
  });

  it("allows a JSON body on a non-exempt route", () => {
    const { next, res } = run({
      method: "POST",
      originalUrl: "/api/vendors",
      headers: { "content-type": "application/json" },
    });
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });

  it("ignores GET (no body method)", () => {
    const { next, res } = run({ method: "GET", originalUrl: "/api/vendors" });
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });

  it("allows a missing Content-Type through (no body to mis-parse)", () => {
    const { next, res } = run({ method: "POST", originalUrl: "/api/vendors" });
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(0);
  });
});
