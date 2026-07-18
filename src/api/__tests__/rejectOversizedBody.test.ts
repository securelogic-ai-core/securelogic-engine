import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { rejectOversizedBody } from "../middleware/rejectOversizedBody.js";

const JSON_LIMIT = 256 * 1024;
const MULTIPART_LIMIT = 32 * 1024 * 1024;

function makeReq(opts: {
  method?: string;
  contentLength?: string | undefined;
  contentType?: string | undefined;
  url?: string;
}): Request {
  const headers: Record<string, string | undefined> = {};
  if (opts.contentLength !== undefined) headers["content-length"] = opts.contentLength;
  if (opts.contentType !== undefined) headers["content-type"] = opts.contentType;
  return {
    method: opts.method ?? "POST",
    originalUrl: opts.url ?? "/api/evidence/upload",
    headers,
  } as unknown as Request;
}

function makeRes(): {
  res: Response;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = {
    status,
    getHeader: () => undefined,
  } as unknown as Response;
  return { res, status, json };
}

describe("rejectOversizedBody", () => {
  it("blocks a JSON body over the 256 KB ceiling", () => {
    const req = makeReq({
      contentType: "application/json",
      contentLength: String(JSON_LIMIT + 1),
    });
    const { res, status, json } = makeRes();
    const next = vi.fn() as NextFunction;

    rejectOversizedBody(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "bad_request",
        details: { reason: "request_body_too_large", maxBytes: JSON_LIMIT },
      })
    );
  });

  it("ALLOWS a multipart upload above 256 KB (the evidence-upload regression)", () => {
    const req = makeReq({
      contentType: "multipart/form-data; boundary=----abc123",
      contentLength: String(5 * 1024 * 1024), // 5 MB PNG — well over 256 KB
    });
    const { res, status } = makeRes();
    const next = vi.fn() as NextFunction;

    rejectOversizedBody(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("still blocks a multipart body above the 32 MB backstop", () => {
    const req = makeReq({
      contentType: "multipart/form-data; boundary=----abc123",
      contentLength: String(MULTIPART_LIMIT + 1),
    });
    const { res, status, json } = makeRes();
    const next = vi.fn() as NextFunction;

    rejectOversizedBody(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "bad_request",
        details: { reason: "request_body_too_large", maxBytes: MULTIPART_LIMIT },
      })
    );
  });

  it("allows a small JSON body", () => {
    const req = makeReq({ contentType: "application/json", contentLength: "1024" });
    const { res, status } = makeRes();
    const next = vi.fn() as NextFunction;

    rejectOversizedBody(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("passes GET requests through untouched", () => {
    const req = makeReq({ method: "GET", contentLength: String(MULTIPART_LIMIT * 2) });
    const { res, status } = makeRes();
    const next = vi.fn() as NextFunction;

    rejectOversizedBody(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it("rejects an invalid Content-Length", () => {
    const req = makeReq({ contentType: "application/json", contentLength: "not-a-number" });
    const { res, status, json } = makeRes();
    const next = vi.fn() as NextFunction;

    rejectOversizedBody(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ details: { reason: "invalid_content_length" } })
    );
  });
});
